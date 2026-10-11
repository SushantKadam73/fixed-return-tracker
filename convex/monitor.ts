/**
 * Health monitoring: stale sources, run log, and housekeeping.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { openAlert, resolveAlert } from "./ingest";
import { STALE_AFTER } from "../lib/health";

const DAY = 24 * 60 * 60 * 1000;
/** How long a source may go without a successful read before we raise an alert. */

export const checkStaleness = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sources = await ctx.db.query("sources").collect();
    let stale = 0;
    for (const s of sources) {
      if (!s.active || s.runner === "disabled") continue;
      const limit = STALE_AFTER[s.cadence] ?? 7 * DAY;
      const last = s.lastSuccessAt ?? 0;
      const key = `stale:${s.key}`;
      if (now - last > limit) {
        stale++;
        const since = s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString().slice(0, 10) : "never";
        await openAlert(ctx, key, "warning", `${s.key} has no successful read since ${since} (cadence ${s.cadence}). The site keeps showing the last good data, marked stale.`);
      } else {
        await resolveAlert(ctx, key);
      }
    }
    return { checked: sources.length, stale };
  },
});

export const recordRun = internalMutation({
  args: {
    receiptId: v.optional(v.string()),
    job: v.string(),
    runner: v.string(),
    startedAt: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("failed")),
    stats: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const { receiptId, ...run } = a;
    if (receiptId && await ctx.db.query("deliveryReceipts").withIndex("by_key", (q) => q.eq("key", receiptId)).first()) return;
    await ctx.db.insert("jobRuns", { ...run, finishedAt: Date.now() });
    if (receiptId) await ctx.db.insert("deliveryReceipts", { key: receiptId, acceptedAt: Date.now(), result: { ok: true } });
    if (a.status !== "ok") await openAlert(ctx, `run_failed:${a.job}`, "error", `${a.job} run on ${a.runner} ${a.status}`);
    else await resolveAlert(ctx, `run_failed:${a.job}`);
  },
});

export const recordMacroStatus = internalMutation({
  args: { receiptId: v.optional(v.string()), checks: v.any(), observations: v.any(), fetchedAt: v.number() },
  handler: async (ctx, a) => {
    if (a.receiptId && await ctx.db.query("deliveryReceipts").withIndex("by_key", (q) => q.eq("key", a.receiptId!)).first()) return { ok: true };
    const existing = await ctx.db.query("summaries").withIndex("by_key", (q) => q.eq("key", "macro:health")).first();
    if (!existing || existing.updatedAt <= a.fetchedAt) {
      const data = { payload: { checks: a.checks, observations: a.observations }, updatedAt: a.fetchedAt };
      if (existing) await ctx.db.patch(existing._id, data);
      else await ctx.db.insert("summaries", { key: "macro:health", ...data });
    }
    if (a.receiptId) await ctx.db.insert("deliveryReceipts", { key: a.receiptId, acceptedAt: Date.now(), result: { ok: true } });
    return { ok: true };
  },
});

/** Delete fetch-log rows older than 60 days, in small batches. */
export const pruneCaptures = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 60 * DAY;
    const old = await ctx.db
      .query("captures")
      .filter((q) => q.lt(q.field("fetchedAt"), cutoff))
      .take(500);
    for (const c of old) await ctx.db.delete(c._id);
    const receipts = await ctx.db.query("deliveryReceipts").withIndex("by_time", (q) => q.lt("acceptedAt", cutoff)).take(500);
    for (const receipt of receipts) await ctx.db.delete(receipt._id);
    const runs = await ctx.db.query("jobRuns").filter((q) => q.lt(q.field("startedAt"), cutoff)).take(200);
    for (const run of runs) await ctx.db.delete(run._id);
    return { deleted: old.length, receipts: receipts.length, runs: runs.length };
  },
});
