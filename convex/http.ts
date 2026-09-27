/**
 * HTTP endpoints for collectors that run outside Convex (GitHub Actions, the VPS) and for
 * one-off imports. Every write endpoint requires `Authorization: Bearer <INGEST_SECRET>`.
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

function authorised(req: Request): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

http.route({
  path: "/health",
  method: "GET",
  handler: httpAction(async () => json({ ok: true, at: new Date().toISOString() })),
});

/** One source's collection result: { sourceKey, fetchedAt, httpStatus?, contentHash?, error?, cards: [] } */
http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json();
    const result = await ctx.runMutation(internal.ingest.recordSourceResult, {
      sourceKey: body.sourceKey,
      fetchedAt: body.fetchedAt ?? Date.now(),
      httpStatus: body.httpStatus,
      contentHash: body.contentHash,
      error: body.error,
      cards: body.cards ?? [],
    });
    return json(result);
  }),
});

/** Historical cards in batches: { cards: [] } */
http.route({
  path: "/import/cards",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json();
    const result = await ctx.runMutation(internal.ingest.importHistoricalCards, { cards: body.cards ?? [] });
    return json(result);
  }),
});

/** Called by a runner after a full collection pass: refresh directory and notify the website. */
http.route({
  path: "/run-complete",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json().catch(() => ({}));
    await ctx.runMutation(internal.monitor.recordRun, {
      job: String(body.job ?? "collect"),
      runner: String(body.runner ?? "github"),
      startedAt: Number(body.startedAt ?? Date.now()),
      status: body.status === "failed" ? "failed" : body.status === "partial" ? "partial" : "ok",
      stats: body.stats ?? null,
    });
    await ctx.scheduler.runAfter(0, internal.summaries.refreshDirectory, {});
    await ctx.scheduler.runAfter(5_000, internal.notify.revalidateSite, {});
    return json({ ok: true });
  }),
});

export default http;
