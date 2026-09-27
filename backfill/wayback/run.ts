/**
 * Rebuild a bank's historical rate cards from Internet Archive copies of its official pages.
 *
 *   npx tsx backfill/wayback/run.ts --bank south-indian-bank            # all targets for the bank
 *   npx tsx backfill/wayback/run.ts --bank sbi --dry-run --limit 10      # try without storing
 *
 * Targets (official URLs, product, amount band, optional custom parser) live in
 * backfill/wayback/targets.json. Consecutive monthly captures with identical rates are merged
 * into one card "in force at least between observedFrom and observedTo".
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Product, RateCard, RateRow } from "../../lib/domain";
import { hash64 } from "../../lib/hash";
import { canonicalRows } from "../../lib/validate";
import { storeHistoricalCard } from "../../collectors/src/store";
import { monthlyCaptures, snapshot, tsToDate } from "./cdx";
import { readTermTables } from "./generic-parse";
import { customParsers } from "./parsers";

export interface Target {
  bankSlug: string;
  url: string;
  product: Product;
  amountMax?: number | null;
  from?: string; // YYYY
  to?: string; // YYYY
  parser?: string; // key in customParsers; default generic
  note?: string;
}

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const bank = opt("--bank");
const dryRun = args.includes("--dry-run");
const limit = Number(opt("--limit") ?? Infinity);
const root = path.resolve(opt("--root") ?? process.cwd());

const targets = (JSON.parse(readFileSync(path.join(root, "backfill", "wayback", "targets.json"), "utf8")) as { targets: Target[] }).targets.filter(
  (t) => !bank || t.bankSlug === bank,
);

type Group = { hash: string; rows: RateRow[]; effectiveFrom: string | null; first: string; last: string; archiveUrl: string };

async function runTarget(t: Target) {
  const caps = (await monthlyCaptures(t.url, t.from ?? "1996", t.to ?? "2026")).slice(0, limit);
  const parse = t.parser ? customParsers[t.parser] : undefined;
  const groups: Group[] = [];
  let ok = 0;
  const skipped: string[] = [];
  for (const c of caps) {
    let html: string;
    let archiveUrl: string;
    try {
      ({ html, archiveUrl } = await snapshot(c));
    } catch (e) {
      skipped.push(`${c.timestamp}: fetch ${(e as Error).message}`);
      continue;
    }
    const res = parse ? parse(html, t) : readTermTables(html, { amountMax: t.amountMax ?? null });
    if (res.rows.length === 0) {
      skipped.push(`${c.timestamp}: ${res.skipped.slice(0, 2).join("; ") || "no table"}`);
      continue;
    }
    ok++;
    const card = { rows: res.rows } as Pick<RateCard, "rows">;
    const hash = hash64(canonicalRows(card as RateCard));
    const date = tsToDate(c.timestamp);
    const prev = groups.at(-1);
    if (prev && prev.hash === hash) {
      prev.last = date;
      prev.effectiveFrom = prev.effectiveFrom ?? res.effectiveFrom;
    } else {
      groups.push({ hash, rows: res.rows, effectiveFrom: res.effectiveFrom, first: date, last: date, archiveUrl });
    }
  }
  let stored = 0;
  let rejected = 0;
  for (const g of groups) {
    const card: RateCard = {
      bankSlug: t.bankSlug,
      product: t.product,
      // A page's "w.e.f." date is only trusted if it is not after the capture date.
      effectiveFrom: g.effectiveFrom && g.effectiveFrom <= g.first ? g.effectiveFrom : null,
      observedAt: new Date().toISOString().slice(0, 10),
      observedFrom: g.first,
      observedTo: g.last,
      sourceType: "web_archive",
      sourceUrl: t.url,
      archiveUrl: g.archiveUrl,
      confidence: g.effectiveFrom ? "medium" : "low",
      rows: g.rows,
      notes: [`Reconstructed from Internet Archive copies of the bank's official page captured ${g.first} to ${g.last}.`, ...(t.note ? [t.note] : [])],
    };
    if (dryRun) continue;
    const r = storeHistoricalCard(root, card);
    if (r.outcome === "inserted") stored++;
    if (r.outcome === "rejected") rejected++;
  }
  return { url: t.url, captures: caps.length, parsed: ok, groups: groups.length, stored, rejected, span: groups.length ? `${groups[0].first} → ${groups.at(-1)!.last}` : "-", skipped: skipped.slice(0, 5) };
}

async function main() {
  for (const t of targets) {
    try {
      const r = await runTarget(t);
      console.log(JSON.stringify({ bank: t.bankSlug, product: t.product, ...r }));
    } catch (e) {
      console.log(JSON.stringify({ bank: t.bankSlug, url: t.url, error: (e as Error).message }));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
