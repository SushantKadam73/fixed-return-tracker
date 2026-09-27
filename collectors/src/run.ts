/**
 * Collector runner.
 *
 *   npx tsx collectors/src/run.ts                 # all active sources for this runner (default: github)
 *   npx tsx collectors/src/run.ts --source sbi:fd # one source
 *   npx tsx collectors/src/run.ts --bank sbi --dry-run
 *   npx tsx collectors/src/run.ts --cadence bulk_daily   # only bulk-rate pages
 *
 * For each source: fetch the official page → adapter → validate → store in data/rates (only
 * when rates changed) → post to Convex (when CONVEX_SITE_URL and INGEST_SECRET are set).
 * Failures never delete data: the last good card stays, the failure is recorded in
 * data/rates/_checks.json and reported to Convex, which raises alerts.
 */
import { hash64 } from "../../lib/hash";
import { todayIST } from "../../lib/format";
import type { RateCard } from "../../lib/domain";
import { fetchDoc } from "./fetch";
import { adapters, loadSources } from "./registry";
import { buildSnapshots } from "./snapshots";
import { loadChecks, saveChecks, storeLiveCard } from "./store";
import type { Runner, SourceDef } from "./types";

interface Args {
  sources: string[];
  banks: string[];
  cadence: string | null;
  runner: Runner | "all";
  dryRun: boolean;
  post: boolean;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { sources: [], banks: [], cadence: null, runner: "github", dryRun: false, post: true, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--source") a.sources.push(argv[++i]);
    else if (v === "--bank") a.banks.push(argv[++i]);
    else if (v === "--cadence") a.cadence = argv[++i];
    else if (v === "--runner") a.runner = argv[++i] as Args["runner"];
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--no-post") a.post = false;
    else if (v === "--root") a.root = argv[++i];
  }
  return a;
}

async function postToConvex(path: string, body: unknown) {
  const base = process.env.CONVEX_SITE_URL;
  const secret = process.env.INGEST_SECRET;
  if (!base || !secret) return { skipped: true };
  const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  return { status: res.status, body: await res.text().catch(() => "") };
}

type Line = { source: string; status: "ok" | "changed" | "rejected" | "error" | "no_adapter"; detail: string };

async function runSource(src: SourceDef, args: Args, checks: ReturnType<typeof loadChecks>): Promise<Line> {
  const now = new Date();
  const check = checks[src.key] ?? { lastAttemptAt: "", lastSuccessAt: null, lastChangeAt: null, consecutiveFailures: 0, lastError: null };
  check.lastAttemptAt = now.toISOString();
  const adapter = adapters[src.adapter];
  if (!adapter) {
    checks[src.key] = { ...check, lastError: `no adapter "${src.adapter}"` };
    return { source: src.key, status: "no_adapter", detail: src.adapter };
  }
  const fail = async (message: string, httpStatus?: number): Promise<Line> => {
    check.consecutiveFailures += 1;
    check.lastError = message.slice(0, 300);
    checks[src.key] = check;
    if (args.post && !args.dryRun) await postToConvex("/ingest", { sourceKey: src.key, fetchedAt: now.getTime(), httpStatus, error: message, cards: [] }).catch(() => undefined);
    return { source: src.key, status: "error", detail: message.slice(0, 160) };
  };

  let doc;
  try {
    doc = await fetchDoc(src.url, src.format);
  } catch (e) {
    return fail(`fetch: ${(e as Error).message}`, (e as { status?: number }).status);
  }
  let cards: RateCard[];
  try {
    const out = await adapter({ source: src, doc, today: todayIST(now), fetch: (url, format) => fetchDoc(url, format ?? "html") });
    cards = out.cards;
  } catch (e) {
    return fail(`adapter: ${(e as Error).message}`, doc.status);
  }

  let changed = false;
  const rejected: string[] = [];
  if (!args.dryRun) {
    for (const card of cards) {
      const r = storeLiveCard(args.root, card);
      if (r.outcome === "inserted") changed = true;
      if (r.outcome === "rejected") rejected.push(`${card.product}: ${r.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
    }
    if (args.post) {
      await postToConvex("/ingest", { sourceKey: src.key, fetchedAt: now.getTime(), httpStatus: doc.status, contentHash: hash64(doc.text), cards }).catch((e) =>
        console.warn(`convex post failed for ${src.key}: ${(e as Error).message}`),
      );
    }
  }
  if (rejected.length > 0) return fail(`validation: ${rejected.join(" | ")}`, doc.status);
  check.consecutiveFailures = 0;
  check.lastError = null;
  check.lastSuccessAt = now.toISOString();
  if (changed) check.lastChangeAt = now.toISOString();
  checks[src.key] = check;
  const summary = cards.map((c) => `${c.product}:${c.rows.length || c.savingsSlabs?.length || 0}`).join(" ");
  return { source: src.key, status: changed ? "changed" : "ok", detail: `${summary} eff ${cards[0]?.effectiveFrom ?? "?"}` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const all = loadSources(args.root);
  const selected = all.filter(
    (s) =>
      s.active &&
      (args.runner === "all" || s.runner === args.runner) &&
      (args.sources.length === 0 || args.sources.includes(s.key)) &&
      (args.banks.length === 0 || args.banks.includes(s.bankSlug)) &&
      (args.cadence === null || s.cadence === args.cadence),
  );
  const checks = loadChecks(args.root);
  const lines: Line[] = [];
  for (const src of selected) {
    const line = await runSource(src, args, checks);
    lines.push(line);
    console.log(`${line.status.padEnd(10)} ${line.source.padEnd(34)} ${line.detail}`);
  }
  if (!args.dryRun) {
    saveChecks(args.root, checks);
    const snap = buildSnapshots(args.root);
    console.log(`snapshots: ${snap.banks} banks, ${snap.products} products`);
  }
  const failed = lines.filter((l) => l.status === "error").length;
  const stats = { sources: lines.length, changed: lines.filter((l) => l.status === "changed").length, failed, noAdapter: lines.filter((l) => l.status === "no_adapter").length };
  console.log(JSON.stringify(stats));
  if (args.post && !args.dryRun) {
    await postToConvex("/run-complete", { job: "collect", runner: args.runner, startedAt, status: failed === 0 ? "ok" : failed === lines.length ? "failed" : "partial", stats }).catch(() => undefined);
  }
  // Exit non-zero only if everything failed, so one broken bank never blocks the others.
  process.exit(lines.length > 0 && failed === lines.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
