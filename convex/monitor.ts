/**
 * Health monitoring: stale sources, run log, and housekeeping.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { openAlert, resolveAlert } from "./ingest";

const DAY = 24 * 60 * 60 * 1000;
/** How long a source may go without a successful read before we raise an alert. */
const STALE_AFTER: Record<string, number> = {
  daily: 3 * DAY,
  bulk_daily: 3 * DAY,
  weekly: 10 * DAY,
  monthly: 40 * DAY,
  quarterly: 100 * DAY,
  annual: 400 * DAY,
};

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
    job: v.string(),
    runner: v.string(),
    startedAt: v.number(),
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("failed")),
    stats: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert("jobRuns", { ...a, finishedAt: Date.now() });
    if (a.status === "failed") await openAlert(ctx, `run_failed:${a.job}`, "error", `${a.job} run on ${a.runner} failed`);
    else await resolveAlert(ctx, `run_failed:${a.job}`);
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
    return { deleted: old.length };
  },
});
