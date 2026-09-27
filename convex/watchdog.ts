/**
 * Collector watchdog. GitHub pauses scheduled workflows in public repositories after 60 days
 * without activity, and a runner can silently stop for other reasons. Every morning Convex checks
 * that the daily collector reported in (POST /run-complete); if it has not for 26 hours it raises
 * an alert and, when a GitHub token is configured, restarts the workflow through the GitHub API.
 *
 * Optional Convex environment variables:
 *   GITHUB_DISPATCH_TOKEN  fine-grained token for this repository with "Actions: read and write"
 *   GITHUB_REPOSITORY      "owner/repo" (default SushantKadam73/fixed-return-tracker)
 */
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { openAlert, resolveAlert } from "./ingest";

const HOUR = 60 * 60 * 1000;
const ALERT_KEY = "watchdog:collect";

export const lastRunAt = internalQuery({
  args: { job: v.string() },
  handler: async (ctx, { job }) => {
    const run = await ctx.db
      .query("jobRuns")
      .withIndex("by_job_time", (q) => q.eq("job", job))
      .order("desc")
      .first();
    return run?.startedAt ?? null;
  },
});

export const raise = internalMutation({
  args: { message: v.string() },
  handler: async (ctx, { message }) => {
    await openAlert(ctx, ALERT_KEY, "error", message);
  },
});

export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    await resolveAlert(ctx, ALERT_KEY);
  },
});

export const collectorWatchdog = internalAction({
  args: {},
  handler: async (ctx) => {
    const last = await ctx.runQuery(internal.watchdog.lastRunAt, { job: "collect" });
    if (last && Date.now() - last <= 26 * HOUR) {
      await ctx.runMutation(internal.watchdog.clear, {});
      return { overdue: false };
    }
    const token = process.env.GITHUB_DISPATCH_TOKEN;
    const repo = process.env.GITHUB_REPOSITORY ?? "SushantKadam73/fixed-return-tracker";
    let note: string;
    let dispatched = false;
    if (token) {
      const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/collect.yml/dispatches`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "user-agent": "fixed-return-tracker-convex",
        },
        body: JSON.stringify({ ref: "main", inputs: { scope: "all" } }),
      });
      dispatched = res.status === 204;
      note = dispatched ? "Convex restarted the workflow through the GitHub API" : `restarting it through the GitHub API failed (HTTP ${res.status})`;
    } else {
      note = "set GITHUB_DISPATCH_TOKEN in Convex to let it restart the workflow automatically, or run it from the GitHub Actions tab";
    }
    const since = last ? new Date(last).toISOString().slice(0, 10) : "ever";
    await ctx.runMutation(internal.watchdog.raise, { message: `The daily bank-rate collector has not reported since ${since}; ${note}. The site keeps showing the last good data.` });
    return { overdue: true, dispatched };
  },
});
