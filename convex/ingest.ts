/**
 * Ingestion: the only way rate cards enter the database.
 *
 * Collectors (Convex actions, GitHub Actions, or the VPS) report one result per source.
 * Each card is checked (lib/validate.ts). A valid card that differs from the current one
 * becomes the new current card; the old card gets an end date. An invalid or partial card
 * is rejected, the last good card stays current, and an alert is opened.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { rateCardInput } from "./validators";
import { canonicalRows, hasErrors, validateCard } from "../lib/validate";
import { hash64 } from "../lib/hash";
import type { RateCard } from "../lib/domain";

const FAILURES_BEFORE_ALERT = 3;

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function openAlert(ctx: MutationCtx, key: string, severity: "info" | "warning" | "error", message: string) {
  const now = Date.now();
  const existing = await ctx.db
    .query("alerts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .filter((q) => q.eq(q.field("resolvedAt"), undefined))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { lastSeenAt: now, count: existing.count + 1, message, severity });
  } else {
    await ctx.db.insert("alerts", { key, severity, message, openedAt: now, lastSeenAt: now, count: 1 });
  }
}

export async function resolveAlert(ctx: MutationCtx, key: string) {
  const open = await ctx.db
    .query("alerts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .filter((q) => q.eq(q.field("resolvedAt"), undefined))
    .collect();
  for (const a of open) await ctx.db.patch(a._id, { resolvedAt: Date.now() });
}

type CardInput = typeof rateCardInput.type;

/** Store one card if it is new. Returns what happened. */
async function upsertCard(
  ctx: MutationCtx,
  card: CardInput,
  opts: { makeCurrent: boolean },
): Promise<"inserted" | "unchanged" | "rejected"> {
  const contentHash = hash64(canonicalRows(card as RateCard));
  const current = opts.makeCurrent
    ? await ctx.db
        .query("rateCards")
        .withIndex("by_bank_product_current", (q) => q.eq("bankSlug", card.bankSlug).eq("product", card.product).eq("isCurrent", true))
        .first()
    : null;

  if (current && current.contentHash === contentHash) {
    // Same rates as before. Freshness lives on the source (lastSuccessAt), so the card is not rewritten.
    return "unchanged";
  }

  const issues = validateCard(card as RateCard, current ? (current as unknown as RateCard) : null);
  if (hasErrors(issues)) {
    await openAlert(
      ctx,
      `card_rejected:${card.bankSlug}:${card.product}`,
      "warning",
      `Rejected ${card.bankSlug} ${card.product} card: ${issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`,
    );
    return "rejected";
  }

  if (!opts.makeCurrent) {
    // Historical import: skip exact duplicates of an already-stored card for the same date.
    const sameDate = await ctx.db
      .query("rateCards")
      .withIndex("by_bank_product_effective", (q) =>
        q.eq("bankSlug", card.bankSlug).eq("product", card.product).eq("effectiveFrom", card.effectiveFrom ?? undefined),
      )
      .collect();
    if (sameDate.some((c) => c.contentHash === contentHash && (c.observedFrom ?? null) === (card.observedFrom ?? null))) return "unchanged";
  }

  await ctx.db.insert("rateCards", {
    bankSlug: card.bankSlug,
    product: card.product,
    effectiveFrom: card.effectiveFrom ?? undefined,
    observedAt: card.observedAt,
    observedFrom: card.observedFrom ?? undefined,
    observedTo: card.observedTo ?? undefined,
    isCurrent: opts.makeCurrent,
    sourceType: card.sourceType,
    sourceUrl: card.sourceUrl,
    archiveUrl: card.archiveUrl ?? undefined,
    confidence: card.confidence,
    contentHash,
    rows: card.rows,
    savingsSlabs: card.savingsSlabs,
    slabMethod: card.slabMethod,
    notes: card.notes,
  });
  if (current) {
    const end = card.effectiveFrom ? dayBefore(card.effectiveFrom) : card.observedAt;
    await ctx.db.patch(current._id, { isCurrent: false, validTo: end });
  }
  await resolveAlert(ctx, `card_rejected:${card.bankSlug}:${card.product}`);
  return "inserted";
}

/** Result of one collector run for one source (live collection). */
export const recordSourceResult = internalMutation({
  args: {
    sourceKey: v.string(),
    fetchedAt: v.number(),
    httpStatus: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    error: v.optional(v.string()),
    cards: v.array(rateCardInput),
  },
  handler: async (ctx, a) => {
    let source = await ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", a.sourceKey))
      .first();
    if (!source) {
      // First report from a source the daily registry import hasn't seen yet: register it minimally.
      const id = await ctx.db.insert("sources", {
        key: a.sourceKey,
        bankSlug: a.sourceKey.split(":")[0],
        kind: "bank_page",
        products: [...new Set(a.cards.map((c) => c.product))],
        url: a.cards[0]?.sourceUrl ?? "",
        format: "html",
        runner: "github",
        adapter: "unknown",
        cadence: "daily",
        active: true,
        consecutiveFailures: 0,
      });
      source = (await ctx.db.get(id))!;
    }

    if (a.error) {
      const failures = source.consecutiveFailures + 1;
      await ctx.db.patch(source._id, { lastAttemptAt: a.fetchedAt, consecutiveFailures: failures, lastError: a.error.slice(0, 500) });
      await ctx.db.insert("captures", { sourceKey: a.sourceKey, fetchedAt: a.fetchedAt, httpStatus: a.httpStatus, outcome: "error", message: a.error.slice(0, 500) });
      if (failures >= FAILURES_BEFORE_ALERT) {
        await openAlert(ctx, `source_failing:${a.sourceKey}`, "error", `${a.sourceKey} failed ${failures} times in a row: ${a.error.slice(0, 200)}`);
      }
      return { outcome: "error" as const };
    }

    let changed = false;
    let rejected = false;
    const today = new Date(a.fetchedAt + 5.5 * 3600_000).toISOString().slice(0, 10); // IST date of the read
    for (const card of a.cards) {
      if (card.effectiveFrom && card.effectiveFrom > today) continue; // scheduled change: not current yet
      const result = await upsertCard(ctx, card, { makeCurrent: true });
      if (result === "inserted") changed = true;
      if (result === "rejected") rejected = true;
    }
    const outcome = rejected ? "rejected" : changed ? "new_card" : "unchanged";
    await ctx.db.insert("captures", { sourceKey: a.sourceKey, fetchedAt: a.fetchedAt, httpStatus: a.httpStatus, contentHash: a.contentHash, outcome });
    await ctx.db.patch(source._id, {
      lastAttemptAt: a.fetchedAt,
      lastSuccessAt: rejected ? source.lastSuccessAt : a.fetchedAt,
      lastChangeAt: changed ? a.fetchedAt : source.lastChangeAt,
      lastContentHash: a.contentHash ?? source.lastContentHash,
      consecutiveFailures: rejected ? source.consecutiveFailures + 1 : 0,
      lastError: rejected ? "card rejected by validation" : undefined,
    });
    if (!rejected) await resolveAlert(ctx, `source_failing:${a.sourceKey}`);
    if (changed && source.bankSlug) {
      await ctx.scheduler.runAfter(0, internal.summaries.refreshBank, { bankSlug: source.bankSlug });
    }
    return { outcome };
  },
});

/** Bulk import of reconstructed history (never becomes "current"). */
export const importHistoricalCards = internalMutation({
  args: { cards: v.array(rateCardInput) },
  handler: async (ctx, a) => {
    const counts = { inserted: 0, unchanged: 0, rejected: 0 };
    for (const card of a.cards) counts[await upsertCard(ctx, card, { makeCurrent: false })]++;
    return counts;
  },
});

/** Register or update a source definition (from the committed source registry). */
export const upsertSource = internalMutation({
  args: {
    key: v.string(),
    bankSlug: v.optional(v.string()),
    kind: v.union(v.literal("bank_page"), v.literal("scheme"), v.literal("series"), v.literal("registry")),
    products: v.array(v.string()),
    url: v.string(),
    format: v.string(),
    runner: v.union(v.literal("convex"), v.literal("github"), v.literal("vps"), v.literal("disabled")),
    adapter: v.string(),
    cadence: v.string(),
    active: v.boolean(),
    robotsAllowed: v.optional(v.boolean()),
    termsNote: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("sources")
      .withIndex("by_key", (q) => q.eq("key", a.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, a);
      return existing._id;
    }
    return await ctx.db.insert("sources", { ...a, consecutiveFailures: 0 });
  },
});

/** Upsert a bank (master list import). */
export const upsertBank = internalMutation({
  args: {
    slug: v.string(),
    name: v.string(),
    shortName: v.string(),
    group: v.union(v.literal("sbi_nationalised"), v.literal("private"), v.literal("sfb"), v.literal("payments")),
    status: v.union(v.literal("active"), v.literal("merged"), v.literal("defunct")),
    tracking: v.union(v.literal("tracked"), v.literal("deferred"), v.literal("historical_only")),
    founded: v.optional(v.string()),
    website: v.optional(v.string()),
    legacyDomains: v.array(v.string()),
    mergedInto: v.optional(v.string()),
    mergedOn: v.optional(v.string()),
    nseSymbol: v.optional(v.string()),
    history: v.array(v.object({ date: v.string(), event: v.string(), evidenceUrl: v.optional(v.string()) })),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const existing: Doc<"banks"> | null = await ctx.db
      .query("banks")
      .withIndex("by_slug", (q) => q.eq("slug", a.slug))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, a);
      return existing._id;
    }
    return await ctx.db.insert("banks", a);
  },
});
