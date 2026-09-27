/**
 * Public read API used by the website. Everything here is read-only.
 */
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { product } from "./validators";

/** A pre-computed summary document, e.g. "current:fd", "bank:sbi", "banks", "schemes", "series:cpi". */
export const summary = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const doc = await ctx.db
      .query("summaries")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();
    return doc ? { payload: doc.payload, updatedAt: doc.updatedAt } : null;
  },
});

/** Full historical rate cards for one bank and product, newest first, paginated. */
export const rateCardHistory = query({
  args: { bankSlug: v.string(), product, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { bankSlug, product, paginationOpts }) => {
    return await ctx.db
      .query("rateCards")
      .withIndex("by_bank_product_effective", (q) => q.eq("bankSlug", bankSlug).eq("product", product))
      .order("desc")
      .paginate(paginationOpts);
  },
});

/** Scheme rate history (PPF, SSY, EPF...). */
export const schemeRates = query({
  args: { scheme: v.string() },
  handler: async (ctx, { scheme }) => {
    return await ctx.db
      .query("schemeRates")
      .withIndex("by_scheme_from", (q) => q.eq("scheme", scheme))
      .collect();
  },
});

/** Points of one macro series (CPI, repo rate, 10-year G-sec...). */
export const seriesPoints = query({
  args: { series: v.string(), from: v.optional(v.string()) },
  handler: async (ctx, { series, from }) => {
    return await ctx.db
      .query("seriesPoints")
      .withIndex("by_series_date", (q) => (from ? q.eq("series", series).gte("date", from) : q.eq("series", series)))
      .collect();
  },
});

/** Collector health for the status page. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    const sources = await ctx.db.query("sources").collect();
    const alerts = await ctx.db
      .query("alerts")
      .withIndex("by_resolved", (q) => q.eq("resolvedAt", undefined))
      .collect();
    return {
      sources: sources.map((s) => ({
        key: s.key,
        bankSlug: s.bankSlug ?? null,
        products: s.products,
        runner: s.runner,
        active: s.active,
        cadence: s.cadence,
        lastAttemptAt: s.lastAttemptAt ?? null,
        lastSuccessAt: s.lastSuccessAt ?? null,
        lastChangeAt: s.lastChangeAt ?? null,
        consecutiveFailures: s.consecutiveFailures,
        lastError: s.lastError ?? null,
      })),
      alerts: alerts.map((a) => ({ key: a.key, severity: a.severity, message: a.message, openedAt: a.openedAt, lastSeenAt: a.lastSeenAt, count: a.count })),
    };
  },
});
