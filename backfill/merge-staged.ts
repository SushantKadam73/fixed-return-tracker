/**
 * Merge historical rate cards from a staging directory into the repo store.
 *
 *   npx tsx backfill/merge-staged.ts --from ../private/history-staging/Chronicle1 [--bank sbi] [--dry-run]
 *
 * History jobs write into a staging root (<dir>/data/rates/<bank>/<product>.json) so they can run
 * in parallel with the live collector and be reviewed first. Merging rules:
 *   - web_archive cards: all cards reconstructed from one archived URL replace that URL's earlier
 *     archive cards for the bank/product (re-runs stay idempotent);
 *   - other historical sources (bank archives, RBI publications, press, filings): added unless an
 *     identical card for the same date already exists;
 *   - live (bank_official) cards are never merged from staging.
 * Every card is validated again on the way in.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RateCard } from "../lib/domain";
import { replaceArchiveCards, storeHistoricalCard, type ProductFile } from "../collectors/src/store";

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const from = opt("--from");
const onlyBank = opt("--bank");
const dryRun = args.includes("--dry-run");
const root = path.resolve(opt("--root") ?? process.cwd());

function stripStored(c: RateCard & { contentHash?: string }): RateCard {
  const { contentHash: _hash, ...card } = c;
  void _hash;
  return card;
}

function main() {
  if (!from) throw new Error("--from <staging dir> is required");
  const dir = path.join(path.resolve(from), "data", "rates");
  if (!existsSync(dir)) throw new Error(`no staged rates in ${dir}`);
  const master = JSON.parse(readFileSync(path.join(root, "data", "banks", "banks.json"), "utf8")) as {
    banks: Array<{ slug: string }>;
    predecessors: Array<{ slug: string }>;
  };
  const known = new Set([...master.banks, ...master.predecessors].map((b) => b.slug));
  for (const bank of readdirSync(dir, { withFileTypes: true })) {
    if (!bank.isDirectory() || (onlyBank && bank.name !== onlyBank)) continue;
    if (!known.has(bank.name)) console.warn(`warning: ${bank.name} is not in data/banks/banks.json (banks or predecessors)`);
    for (const f of readdirSync(path.join(dir, bank.name)).filter((x) => x.endsWith(".json"))) {
      const pf = JSON.parse(readFileSync(path.join(dir, bank.name, f), "utf8")) as ProductFile;
      const cards = pf.cards.map(stripStored);
      const archive = new Map<string, RateCard[]>();
      const other: RateCard[] = [];
      let live = 0;
      for (const c of cards) {
        if (c.sourceType === "bank_official") live++;
        else if (c.sourceType === "web_archive") archive.set(c.sourceUrl, [...(archive.get(c.sourceUrl) ?? []), c]);
        else other.push(c);
      }
      const summary = { bank: pf.bankSlug, product: pf.product, archiveUrls: archive.size, archiveCards: 0, removed: 0, otherInserted: 0, unchanged: 0, rejected: [] as string[], skippedLive: live };
      if (!dryRun) {
        for (const [url, list] of archive) {
          // Replace only the span these staged cards cover (another era of the same URL stays).
          const dates = list.map((c) => c.observedFrom ?? c.effectiveFrom ?? c.observedAt).sort();
          const ends = list.map((c) => c.observedTo ?? c.observedFrom ?? c.effectiveFrom ?? c.observedAt).sort();
          const r = replaceArchiveCards(root, pf.bankSlug, pf.product, url, list, { from: dates[0], to: ends.at(-1) });
          summary.archiveCards += r.inserted;
          summary.removed += r.removed;
          summary.rejected.push(...r.rejected);
        }
        for (const c of other) {
          const r = storeHistoricalCard(root, c);
          if (r.outcome === "inserted") summary.otherInserted++;
          else if (r.outcome === "unchanged") summary.unchanged++;
          else summary.rejected.push(`${c.effectiveFrom ?? c.observedFrom ?? "?"}: ${r.issues.map((i) => i.message).join("; ")}`);
        }
      } else {
        summary.archiveCards = [...archive.values()].reduce((n, l) => n + l.length, 0);
        summary.otherInserted = other.length;
      }
      console.log(JSON.stringify(summary));
    }
  }
}

main();
