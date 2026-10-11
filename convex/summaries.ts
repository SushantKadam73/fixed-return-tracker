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
import { productSummary, currentEntry, type StoredCard } from "../lib/summary-build";
import { currentOfficialCard } from "../lib/current-card";
import { todayIST } from "../lib/format";
import type { Product } from "../lib/domain";

const PRODUCTS: Product[] = ["fd", "fd_bulk", "rd", "savings", "nre", "nro", "fcnr", "tax_saver"];

async function putSummary(ctx: MutationCtx, key: string, payload: unknown) {
  const existing = await ctx.db
    .query("summaries")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (existing && JSON.stringify(existing.payload) === JSON.stringify(payload)) return;
  if (existing) await ctx.db.patch(existing._id, { payload, updatedAt: Date.now() });
  else await ctx.db.insert("summaries", { key, payload, updatedAt: Date.now() });
}

async function getSummary(ctx: MutationCtx, key: string): Promise<Doc<"summaries"> | null> {
  return await ctx.db
    .query("summaries")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
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
    const current = currentOfficialCard(cards, todayIST());
    currentByProduct[product] = current;
    const normalized = cards.map((card): StoredCard => ({ ...card, effectiveFrom: card.effectiveFrom ?? null }));
    const selected = normalized.find((card) => card.contentHash === current?.contentHash && card.observedAt === current.observedAt) ?? null;
    products[product] = productSummary(product, normalized, selected);
  }
  const terms = await ctx.db
    .query("productTerms")
    .withIndex("by_bank_product", (q) => q.eq("bankSlug", bankSlug))
    .collect();
  return { bank, products, terms: terms.map((t) => ({ product: t.product, observedAt: t.observedAt, sourceUrl: t.sourceUrl, terms: t.terms })), currentByProduct };
}

/** Rebuild one bank's summary and its entries in the per-product current tables. */
export const refreshBank = internalMutation({
  args: { bankSlug: v.string(), changedProducts: v.optional(v.array(v.string())) },
  handler: async (ctx, { bankSlug, changedProducts }) => {
    const built = await buildBank(ctx, bankSlug);
    const { currentByProduct, ...payload } = built;
    await putSummary(ctx, `bank:${bankSlug}`, payload);
    for (const product of PRODUCTS) {
      if (changedProducts && !changedProducts.includes(product)) continue;
      const rootKey = `current:${product}`;
      // Bulk cards contain thousands of rows; split by RBI group before reaching Convex's document cap.
      const partitions = ["sbi_nationalised", "private", "sfb"].map((group) => `${rootKey}:${group}`);
      if (product === "fd_bulk") {
        const previous = await getSummary(ctx, rootKey);
        const legacy = (previous?.payload as { banks?: Record<string, { group?: string }> } | undefined)?.banks;
        if (legacy) for (const partition of partitions) {
          const group = partition.slice(rootKey.length + 1);
          const migrated = Object.fromEntries(Object.entries(legacy).filter(([, entry]) => (entry.group ?? "private") === group));
          await putSummary(ctx, partition, { banks: migrated });
        }
      }
      const key = product === "fd_bulk" ? `${rootKey}:${built.bank?.group ?? "private"}` : rootKey;
      const existing = await getSummary(ctx, key);
      const banks = { ...((existing?.payload as { banks?: Record<string, unknown> } | undefined)?.banks ?? {}) };
      const card = currentByProduct[product];
      if (card && built.bank) {
        if (built.bank.status === "active" && built.bank.tracking === "tracked") banks[bankSlug] = currentEntry(built.bank, { ...card, effectiveFrom: card.effectiveFrom ?? null });
        else delete banks[bankSlug];
      } else {
        delete banks[bankSlug];
      }
      if (existing || card) {
        await putSummary(ctx, key, { banks });
        if (product === "fd_bulk") await putSummary(ctx, rootKey, { partitions });
      }
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
