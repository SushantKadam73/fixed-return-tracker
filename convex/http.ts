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

http.route({
  path: "/bootstrap",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const result = await ctx.runAction(internal.seed.importAll, {});
    return json({ ok: true, ...result });
  }),
});

http.route({
  path: "/sync",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json();
    if (body.revision !== undefined && !/^[a-f0-9]{40}$/.test(body.revision)) return json({ error: "Invalid dataset commit" }, 400);
    const result = await ctx.runAction(internal.seed.importSeriesAndRates, { revision: body.revision });
    await ctx.scheduler.runAfter(30_000, internal.notify.revalidateSite, {});
    return json({ ok: result.errors.length === 0, ...result }, result.errors.length ? 503 : 200);
  }),
});

http.route({
  path: "/macro-status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json();
    return json(await ctx.runMutation(internal.monitor.recordMacroStatus, {
      receiptId: body.receiptId, checks: body.checks, observations: body.observations, fetchedAt: body.fetchedAt,
    }));
  }),
});

/** One source's collection result: { sourceKey, fetchedAt, httpStatus?, contentHash?, error?, cards: [] } */
http.route({
  path: "/ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!authorised(req)) return json({ error: "unauthorised" }, 401);
    const body = await req.json();
    const result = await ctx.runMutation(internal.ingest.recordSourceResult, {
      receiptId: body.receiptId,
      sourceKey: body.sourceKey,
      fetchedAt: body.fetchedAt ?? Date.now(),
      httpStatus: body.httpStatus,
      contentHash: body.contentHash,
      error: body.error,
      cards: body.cards ?? [],
    });
    return json(result, result.outcome === "rejected" ? 422 : 200);
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
      receiptId: body.receiptId,
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
