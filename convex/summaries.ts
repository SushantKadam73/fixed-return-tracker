/**
 * Pre-computed read models for the website.
 *
 * The site never scans the rateCards table directly. Instead, whenever a bank's cards
 * change, we rebuild that bank's summary and patch its entry in the per-product
 * "current:<product>" documents. This keeps Convex reads small (free-tier friendly)
 * and makes pages fast.
 */
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { FIXED_DURATIONS, rateForTenure } from "../lib/tenure";
import type { Product, RateRow } from "../lib/domain";

const PRODUCTS: Product[] = ["fd", "fd_bulk", "rd", "savings", "nre", "nro", "fcnr", "tax_saver"];
const RETAIL_REFERENCE_AMOUNT = 1_00_000; // ₹1 lakh: reference amount for key-rate history lines

async function putSummary(ctx: MutationCtx, key: string, payload: unknown) {
  const existing = await ctx.db
    .query("summaries")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (existing) await ctx.db.patch(existing._id, { payload, updatedAt: Date.now() });
  else await ctx.db.insert("summaries", { key, payload, updatedAt: Date.now() });
}

async function getSummary(ctx: MutationCtx, key: string): Promise<Doc<"summaries"> | null> {
  return await ctx.db
    .query("summaries")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

function keyRates(rows: RateRow[], customer: "general" | "senior") {
  const out: Record<string, number | null> = {};
  for (const d of FIXED_DURATIONS) {
    out[d.key] = rateForTenure(rows, d.days, { amount: RETAIL_REFERENCE_AMOUNT, customer })?.rate ?? null;
  }
  return out;
}

function cardMeta(c: Doc<"rateCards">) {
  return {
    effectiveFrom: c.effectiveFrom ?? null,
    validTo: c.validTo ?? null,
    observedAt: c.observedAt,
    observedFrom: c.observedFrom ?? null,
    observedTo: c.observedTo ?? null,
    sourceType: c.sourceType,
    sourceUrl: c.sourceUrl,
    archiveUrl: c.archiveUrl ?? null,
    confidence: c.confidence,
  };
}

async function buildBank(ctx: MutationCtx, bankSlug: string) {
  const bank = await ctx.db
    .query("banks")
    .withIndex("by_slug", (q) => q.eq("slug", bankSlug))
    .first();
  const products: Record<string, unknown> = {};
  const currentByProduct: Record<string, Doc<"rateCards"> | null> = {};
  for (const product of PRODUCTS) {
    const cards = await ctx.db
      .query("rateCards")
      .withIndex("by_bank_product_effective", (q) => q.eq("bankSlug", bankSlug).eq("product", product))
      .collect();
    if (cards.length === 0) continue;
    const current = cards.find((c) => c.isCurrent) ?? null;
    currentByProduct[product] = current;
    const sortKey = (c: Doc<"rateCards">) => c.effectiveFrom ?? c.observedFrom ?? c.observedAt;
    const versions = [...cards]
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
      .map((c) => ({
        ...cardMeta(c),
        isCurrent: c.isCurrent,
        general: product === "savings" ? null : keyRates(c.rows, "general"),
        senior: product === "savings" ? null : keyRates(c.rows, "senior"),
        baseSavingsRate:
          product === "savings" && c.savingsSlabs && c.savingsSlabs.length > 0
            ? [...c.savingsSlabs].sort((a, b) => a.balanceMin - b.balanceMin)[0].rate
            : null,
      }));
    products[product] = {
      current: current
        ? { ...cardMeta(current), rows: current.rows, savingsSlabs: current.savingsSlabs ?? null, slabMethod: current.slabMethod ?? null, notes: current.notes ?? [] }
        : null,
      versions,
    };
  }
  const terms = await ctx.db
    .query("productTerms")
    .withIndex("by_bank_product", (q) => q.eq("bankSlug", bankSlug))
    .collect();
  return { bank, products, terms: terms.map((t) => ({ product: t.product, observedAt: t.observedAt, sourceUrl: t.sourceUrl, terms: t.terms })), currentByProduct };
}

/** Rebuild one bank's summary and its entries in the per-product current tables. */
export const refreshBank = internalMutation({
  args: { bankSlug: v.string() },
  handler: async (ctx, { bankSlug }) => {
    const built = await buildBank(ctx, bankSlug);
    const { currentByProduct, ...payload } = built;
    await putSummary(ctx, `bank:${bankSlug}`, payload);
    for (const product of PRODUCTS) {
      const key = `current:${product}`;
      const existing = await getSummary(ctx, key);
      const banks = { ...((existing?.payload as { banks?: Record<string, unknown> } | undefined)?.banks ?? {}) };
      const card = currentByProduct[product];
      if (card && built.bank) {
        banks[bankSlug] = {
          name: built.bank.name,
          shortName: built.bank.shortName,
          group: built.bank.group,
          ...cardMeta(card),
          rows: card.rows,
          savingsSlabs: card.savingsSlabs ?? null,
          slabMethod: card.slabMethod ?? null,
        };
      } else {
        delete banks[bankSlug];
      }
      if (existing || card) await putSummary(ctx, key, { banks });
    }
  },
});

/** Bank directory (names, groups, lineage, which products have data). */
export const refreshDirectory = internalMutation({
  args: {},
  handler: async (ctx) => {
    const banks = await ctx.db.query("banks").collect();
    const sources = await ctx.db.query("sources").collect();
    const entries = banks.map((b) => ({
      slug: b.slug,
      name: b.name,
      shortName: b.shortName,
      group: b.group,
      status: b.status,
      tracking: b.tracking,
      founded: b.founded ?? null,
      website: b.website ?? null,
      mergedInto: b.mergedInto ?? null,
      mergedOn: b.mergedOn ?? null,
      sources: sources
        .filter((s) => s.bankSlug === b.slug)
        .map((s) => ({ key: s.key, products: s.products, url: s.url, lastSuccessAt: s.lastSuccessAt ?? null, failing: s.consecutiveFailures > 0 })),
    }));
    await putSummary(ctx, "banks", { banks: entries });
  },
});

/** Full rebuild (after large imports). Runs bank by bank to stay within mutation limits. */
export const refreshAllBanks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const banks = await ctx.db.query("banks").collect();
    for (const [i, b] of banks.entries()) {
      await ctx.scheduler.runAfter(i * 200, internal.summaries.refreshBank, { bankSlug: b.slug });
    }
    await ctx.scheduler.runAfter(banks.length * 200 + 500, internal.summaries.refreshDirectory, {});
  },
});

/** Refresh the summaries of just these banks (after an import changed their files), then the directory. */
export const refreshBanks = internalMutation({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }) => {
    for (const [i, bankSlug] of slugs.entries()) {
      await ctx.scheduler.runAfter(i * 200, internal.summaries.refreshBank, { bankSlug });
    }
    await ctx.scheduler.runAfter(slugs.length * 200 + 500, internal.summaries.refreshDirectory, {});
  },
});
