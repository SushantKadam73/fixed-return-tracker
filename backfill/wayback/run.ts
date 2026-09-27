/**
 * Rebuild a bank's historical rate cards from Internet Archive copies of its official pages.
 *
 *   npx tsx backfill/wayback/run.ts --group pvt-b --bank south-indian-bank --out ../private/history-staging/me
 *   npx tsx backfill/wayback/run.ts --bank sbi --url deposit-rates --dry-run --verbose
 *
 * Options:
 *   --group <name>    only targets from backfill/wayback/targets/<name>.json
 *   --bank <slug>     only targets for this bank
 *   --url <substr>    only targets whose URL contains this text
 *   --product <p>     only targets for this product
 *   --out <dir>       where cards are stored (<dir>/data/rates/...); default: the repo itself.
 *                     History work stores into a staging directory first; backfill/merge-staged.ts
 *                     merges reviewed results into the repo.
 *   --stride <n>      sampling stride for pages whose content changes every month (default 3)
 *   --dry-run         parse and report, store nothing
 *   --verbose         print every evaluated capture
 *
 * How captures are chosen (the archive is a shared public resource, so fetch as little as possible):
 *   1. One CDX call lists the monthly captures (HTTP 200) with their content digests.
 *   2. Identical digests mean identical bytes, so each distinct digest is fetched at most once.
 *   3. If a page has few distinct digests (static pages, typical before ~2012) every digest is
 *      read: exact month-level change detection at minimal cost.
 *   4. Otherwise (pages with rotating banners change digest every capture) every <stride>-th month
 *      is read, and wherever two neighbouring samples carry different rates the months between
 *      them are bisected until the change is pinned to adjacent captures. A change that reverts
 *      within one stride window can be missed; use --stride 1 for exhaustive reads.
 * Consecutive captures with identical rates become one card "in force at least between
 * observedFrom and observedTo". Re-running a target replaces that target's earlier archive cards,
 * so parser fixes never leave duplicates behind.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RateCard, RateRow } from "../../lib/domain";
import { hash64 } from "../../lib/hash";
import { canonicalRows } from "../../lib/validate";
import { replaceArchiveCards } from "../../collectors/src/store";
import { archiveRequests, monthlyCaptures, snapshot, tsToDate, type Capture } from "./cdx";
import { readTermTables } from "./generic-parse";
import { customParsers } from "./parser-registry";
import type { GenericResult, Target } from "./types";

export type { Target } from "./types";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const root = path.resolve(opt("--root") ?? process.cwd());
const outRoot = path.resolve(opt("--out") ?? root);
const dryRun = args.includes("--dry-run");
const verbose = args.includes("--verbose");
const stride = Math.max(1, Number(opt("--stride") ?? 3));

export function loadTargets(repoRoot: string, group?: string): Array<Target & { group: string }> {
  const dir = path.join(repoRoot, "backfill", "wayback", "targets");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
  const out: Array<Target & { group: string }> = [];
  for (const f of files.sort()) {
    const g = f.replace(/\.json$/, "");
    if (group && g !== group) continue;
    const data = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as { targets: Target[] };
    for (const t of data.targets ?? []) out.push({ ...t, group: g });
  }
  return out;
}

type Eval = { idx: number; hash: string | null; result: GenericResult | null; archiveUrl: string; error?: string };

async function parseCapture(t: Target, c: Capture): Promise<Omit<Eval, "idx">> {
  let html: string;
  let archiveUrl: string;
  try {
    ({ html, archiveUrl } = await snapshot(c));
  } catch (e) {
    return { hash: null, result: null, archiveUrl: "", error: `fetch ${(e as Error).message}` };
  }
  const parse = t.parser ? customParsers[t.parser] : undefined;
  if (t.parser && !parse) throw new Error(`unknown parser "${t.parser}" (register it in backfill/wayback/parsers/<group>.ts)`);
  let res: GenericResult;
  try {
    res = parse ? await parse(html, t) : readTermTables(html, { amountMax: t.amountMax ?? null });
  } catch (e) {
    return { hash: null, result: null, archiveUrl, error: `parse ${(e as Error).message}` };
  }
  if (res.rows.length === 0) return { hash: null, result: res, archiveUrl, error: res.skipped.slice(0, 2).join("; ") || "no table" };
  return { hash: hash64(canonicalRows({ rows: res.rows } as RateCard)), result: res, archiveUrl };
}

async function runTarget(t: Target) {
  const before = archiveRequests();
  const caps = await monthlyCaptures(t.url, t.from ?? "1996", t.to ?? "2026");
  const evals = new Map<number, Eval>();
  const byDigest = new Map<string, Omit<Eval, "idx">>();

  const evaluate = async (i: number) => {
    if (evals.has(i)) return evals.get(i)!;
    const c = caps[i];
    let e = c.digest ? byDigest.get(c.digest) : undefined;
    if (!e) {
      e = await parseCapture(t, c);
      if (c.digest && !e.error?.startsWith("fetch")) byDigest.set(c.digest, e);
    } else {
      // Same bytes as an earlier capture: same rates; point the evidence at this capture.
      e = { ...e, archiveUrl: `https://web.archive.org/web/${c.timestamp}id_/${c.original}` };
    }
    const ev = { idx: i, ...e };
    evals.set(i, ev);
    if (verbose) console.error(`  ${c.timestamp} ${ev.hash ?? "-"} ${ev.error ?? `${ev.result?.rows.length} rows`}`);
    return ev;
  };

  const distinctDigests = new Set(caps.map((c) => c.digest)).size;
  const exact = stride === 1 || distinctDigests <= Math.max(4, caps.length / 2);
  if (exact) {
    // Every capture is evaluated, but only the first capture of each digest is fetched.
    for (let i = 0; i < caps.length; i++) await evaluate(i);
  } else {
    for (let i = 0; i < caps.length; i += stride) await evaluate(i);
    if (caps.length > 0) await evaluate(caps.length - 1);
    // Bisect between neighbouring samples whose rates differ.
    for (let changed = true; changed; ) {
      changed = false;
      const idx = [...evals.keys()].sort((a, b) => a - b);
      for (let k = 0; k + 1 < idx.length; k++) {
        const a = evals.get(idx[k])!;
        const b = evals.get(idx[k + 1])!;
        if (b.idx - a.idx > 1 && a.hash !== b.hash) {
          await evaluate(Math.floor((a.idx + b.idx) / 2));
          changed = true;
        }
      }
    }
  }

  type Group = { hash: string; rows: RateRow[]; effectiveFrom: string | null; first: string; last: string; archiveUrl: string };
  const groups: Group[] = [];
  const skipped: string[] = [];
  let parsed = 0;
  for (const ev of [...evals.values()].sort((a, b) => a.idx - b.idx)) {
    const date = tsToDate(caps[ev.idx].timestamp);
    if (!ev.hash || !ev.result) {
      skipped.push(`${caps[ev.idx].timestamp}: ${ev.error}`);
      continue;
    }
    parsed++;
    const prev = groups.at(-1);
    if (prev && prev.hash === ev.hash) {
      prev.last = date;
      prev.effectiveFrom = prev.effectiveFrom ?? ev.result.effectiveFrom;
    } else {
      groups.push({ hash: ev.hash, rows: ev.result.rows, effectiveFrom: ev.result.effectiveFrom, first: date, last: date, archiveUrl: ev.archiveUrl });
    }
  }

  const observedAt = new Date().toISOString().slice(0, 10);
  const cards: RateCard[] = groups.map((g) => ({
    bankSlug: t.bankSlug,
    product: t.product,
    // A page's "w.e.f." date is only trusted if it is not after the first capture showing it.
    effectiveFrom: g.effectiveFrom && g.effectiveFrom <= g.first ? g.effectiveFrom : null,
    observedAt,
    observedFrom: g.first,
    observedTo: g.last,
    sourceType: "web_archive",
    sourceUrl: t.url,
    archiveUrl: g.archiveUrl,
    confidence: g.effectiveFrom && g.effectiveFrom <= g.first ? "medium" : "low",
    rows: g.rows,
    notes: [`Reconstructed from Internet Archive copies of the bank's official page captured ${g.first} to ${g.last}.`, ...(t.note ? [t.note] : [])],
  }));

  let stored = 0;
  let rejected: string[] = [];
  if (!dryRun && cards.length > 0) {
    const r = replaceArchiveCards(outRoot, t.bankSlug, t.product, t.url, cards);
    stored = r.inserted;
    rejected = r.rejected;
  }
  return {
    url: t.url,
    captures: caps.length,
    distinctDigests,
    mode: exact ? "exact" : `stride-${stride}`,
    evaluated: evals.size,
    archiveRequests: archiveRequests() - before,
    parsed,
    groups: groups.length,
    stored,
    rejected: rejected.slice(0, 5),
    span: groups.length ? `${groups[0].first} → ${groups.at(-1)!.last}` : "-",
    skipped: skipped.slice(0, 5),
  };
}

async function main() {
  const bank = opt("--bank");
  const url = opt("--url");
  const product = opt("--product");
  const targets = loadTargets(root, opt("--group")).filter(
    (t) => (!bank || t.bankSlug === bank) && (!url || t.url.includes(url)) && (!product || t.product === product),
  );
  if (targets.length === 0) console.error("no matching targets");
  for (const t of targets) {
    try {
      const r = await runTarget(t);
      console.log(JSON.stringify({ bank: t.bankSlug, product: t.product, ...r }));
    } catch (e) {
      console.log(JSON.stringify({ bank: t.bankSlug, product: t.product, url: t.url, error: (e as Error).message }));
    }
  }
}

if (process.argv[1] && /wayback[\\/]run\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
