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
import { acquireCollectorLease } from "./lease";
import { enqueue, flushOutbox, pendingDeliveries } from "./delivery";
import { normaliseCard } from "../../lib/normalise-card";
import { currentOfficialCard } from "../../lib/current-card";
import { hasErrors, validateCard } from "../../lib/validate";
import { hash64 } from "../../lib/hash";
import { todayIST } from "../../lib/format";
import type { RateCard } from "../../lib/domain";
import { closeBrowser, fetchDoc, PLAIN_BROWSER_UA } from "./fetch";
import { adapters, loadSources } from "./registry";
import { buildSnapshots } from "./snapshots";
import { loadProduct, loadChecks, saveChecks, storeLiveCard, storeTerms } from "./store";
import type { FetchInit, ProductTerms, Runner, SourceDef } from "./types";

interface Args {
  sources: string[];
  banks: string[];
  cadence: string | null;
  runner: Runner | "all";
  dryRun: boolean;
  post: boolean;
  retryFailed: boolean;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { sources: [], banks: [], cadence: null, runner: "github", dryRun: false, post: true, retryFailed: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--source") a.sources.push(argv[++i]);
    else if (v === "--bank") a.banks.push(argv[++i]);
    else if (v === "--cadence") a.cadence = argv[++i];
    else if (v === "--runner") a.runner = argv[++i] as Args["runner"];
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--retry-failed") a.retryFailed = true;
    else if (v === "--no-post") a.post = false;
    else if (v === "--root") a.root = argv[++i];
  }
  return a;
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
    if (args.post && !args.dryRun) enqueue(args.root, "/ingest", { sourceKey: src.key, fetchedAt: now.getTime(), httpStatus, error: message, cards: [] });
    return { source: src.key, status: "error", detail: message.slice(0, 160) };
  };

  // Per-source User-Agent override, applied to the page and to any related document the adapter fetches.
  const withUa = (init?: FetchInit): FetchInit => ({ ...init, browser: src.browser, headers: { ...(src.userAgent === "browser" ? { "user-agent": PLAIN_BROWSER_UA } : {}), ...init?.headers } });
  if (src.robotsAllowed === false) return fail("Automated collection is disabled by the source access policy");
  let doc;
  try {
    doc = await fetchDoc(src.url, src.format, 3, withUa());
  } catch (e) {
    return fail(`fetch: ${(e as Error).message}`, (e as { status?: number }).status);
  }
  let cards: RateCard[];
  let terms: ProductTerms[] = [];
  const today = todayIST(now);
  try {
    const out = await adapter({ source: src, doc, today, fetch: (url, format, init) => fetchDoc(url, format ?? "html", 3, withUa(init)) });
    terms = out.terms ?? [];
    // A pre-announced change (effective date in the future) must not become "current" early.
    // It is picked up automatically once its effective date arrives, because the page still shows it.
    const future = out.cards.filter((c) => c.effectiveFrom !== null && c.effectiveFrom > today);
    for (const c of future) console.log(`  holding ${c.bankSlug} ${c.product} card effective ${c.effectiveFrom} until it takes effect`);
    cards = out.cards.filter((c) => !(c.effectiveFrom !== null && c.effectiveFrom > today)).map(normaliseCard);
    if (new Set(cards.map((card) => card.product)).size !== cards.length) throw new Error("Duplicate product cards from one source");
    if (cards.length === 0) throw new Error("No applicable rate cards; last good data retained.");
    for (const card of cards) {
      if (card.bankSlug !== src.bankSlug || !src.products.includes(card.product) || card.sourceType !== "bank_official") throw new Error("Card does not match registered bank/product/source type");
      const previous = currentOfficialCard(loadProduct(args.root, card.bankSlug, card.product).cards, today);
      const issues = validateCard(card, previous);
      if (hasErrors(issues)) throw new Error(issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("; "));
    }
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
      enqueue(args.root, "/ingest", { sourceKey: src.key, fetchedAt: now.getTime(), httpStatus: doc.status, contentHash: hash64(doc.text), cards });
    }
  }
  if (rejected.length > 0) return fail(`validation: ${rejected.join(" | ")}`, doc.status);
  // Deposit terms stated on the same page (senior premium, penalties, minimums...), kept per product.
  if (!args.dryRun && terms.length > 0) storeTerms(args.root, src.bankSlug, { key: src.key, url: src.url }, terms, today);
  check.consecutiveFailures = 0;
  check.lastError = null;
  check.lastSuccessAt = now.toISOString();
  if (changed) check.lastChangeAt = now.toISOString();
  checks[src.key] = check;
  const summary = cards.map((c) => `${c.product}:${c.rows.length || c.savingsSlabs?.length || 0}`).join(" ");
  return { source: src.key, status: changed ? "changed" : "ok", detail: `${summary} eff ${cards[0]?.effectiveFrom ?? "?"}` };
}

let releaseLease: (() => void) | undefined;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun) releaseLease = acquireCollectorLease(args.root);
  const startedAt = Date.now();
  const all = loadSources(args.root);
  const checks = loadChecks(args.root);
  const selected = all.filter(
    (s) =>
      s.active &&
      (args.runner === "all" || s.runner === args.runner) &&
      (args.sources.length === 0 || args.sources.includes(s.key)) &&
      (args.banks.length === 0 || args.banks.includes(s.bankSlug)) &&
      (args.cadence === null || s.cadence === args.cadence) &&
      (!args.retryFailed || (checks[s.key]?.consecutiveFailures ?? 0) > 0 || !checks[s.key]?.lastSuccessAt || Date.now() - Date.parse(checks[s.key].lastSuccessAt!) > 36 * 3600_000),
  );
  if (selected.length === 0 && args.retryFailed) {
    if (args.post && !args.dryRun) await flushOutbox(args.root);
    console.log("No failed or overdue sources require recovery");
    return;
  }
  if (selected.length === 0) throw new Error("No active sources match the requested scope");
  if (args.post && !args.dryRun) await flushOutbox(args.root);
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
    const job = args.cadence === "bulk_daily" ? "collect:bulk" : args.retryFailed || args.sources.length || args.banks.length ? "collect:recovery" : "collect:daily";
    const publication = await flushOutbox(args.root);
    const status = publication.pending || publication.rejected || failed === lines.length ? "failed" : failed || stats.noAdapter ? "partial" : "ok";
    enqueue(args.root, "/run-complete", { job, runner: args.runner, startedAt, status, stats: { ...stats, ...publication } });
    const receipt = await flushOutbox(args.root);
    if (receipt.pending || publication.rejected) process.exitCode = 1;
  }
  // Report partial failures to Actions after preserving accepted data and pending deliveries.
  if (failed > 0 || stats.noAdapter > 0 || (args.post && !args.dryRun && pendingDeliveries(args.root) > 0)) process.exitCode = 1;
}

main().finally(async () => { await closeBrowser(); releaseLease?.(); }).catch((e) => {
  console.error(e);
  process.exit(1);
});
