/**
 * Build the website's fallback snapshots (data/snapshots/*.json) from the repo rate store,
 * in exactly the shape Convex summaries use, plus the history coverage report
 * (data/snapshots/coverage.json) for every bank and merged predecessor.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bankCoverage, type BankCoverage } from "../../lib/coverage";
import type { Product } from "../../lib/domain";
import { todayIST } from "../../lib/format";
import { currentEntry, productSummary, type StoredCard } from "../../lib/summary-build";
import { allProductFiles, loadTerms } from "./store";

type BankMeta = { slug: string; name: string; shortName: string; group: string; tracking?: string; founded: string | null };
type PredecessorMeta = { slug: string; name: string; founded: string | null; mergedInto: string; mergedOn: string | null; relation: string };

/** Write a snapshot only when its payload changed, so unchanged files keep their updatedAt and stay out of git diffs. */
function writeSnapshot(file: string, payload: unknown, now: number) {
  const body = JSON.stringify(payload);
  if (existsSync(file)) {
    try {
      const prev = JSON.parse(readFileSync(file, "utf8")) as { payload?: unknown };
      if (JSON.stringify(prev.payload) === body) return false;
    } catch {
      /* unreadable previous file: rewrite it */
    }
  }
  writeFileSync(file, `${JSON.stringify({ payload, updatedAt: now })}\n`);
  return true;
}

export function buildSnapshots(root: string) {
  const master = JSON.parse(readFileSync(path.join(root, "data", "banks", "banks.json"), "utf8")) as { banks: BankMeta[]; predecessors: PredecessorMeta[] };
  const meta = new Map(master.banks.map((b) => [b.slug, b]));
  const preds = new Map((master.predecessors ?? []).map((p) => [p.slug, p]));
  // A predecessor shows under the group of the bank its lineage ends in.
  const rootBank = (slug: string): BankMeta | undefined => {
    const seen = new Set<string>();
    let s = slug;
    while (preds.has(s) && !seen.has(s)) {
      seen.add(s);
      s = preds.get(s)!.mergedInto;
    }
    return meta.get(s);
  };
  const files = allProductFiles(root);
  const out = path.join(root, "data", "snapshots");
  mkdirSync(out, { recursive: true });
  const now = Date.now();

  const current: Partial<Record<Product, Record<string, unknown>>> = {};
  const byBank = new Map<string, Record<string, unknown>>();
  const cardsByBank = new Map<string, Partial<Record<Product, StoredCard[]>>>();
  for (const pf of files) {
    const bank = meta.get(pf.bankSlug);
    const pred = preds.get(pf.bankSlug);
    if (!bank && !pred) continue;
    const live = pf.cards.filter((c) => c.sourceType === "bank_official");
    const latest: StoredCard | null = live.at(-1) ?? null;
    const products = byBank.get(pf.bankSlug) ?? {};
    products[pf.product] = productSummary(pf.product, pf.cards, latest);
    byBank.set(pf.bankSlug, products);
    cardsByBank.set(pf.bankSlug, { ...(cardsByBank.get(pf.bankSlug) ?? {}), [pf.product]: pf.cards });
    if (latest && bank) {
      current[pf.product] = current[pf.product] ?? {};
      current[pf.product]![pf.bankSlug] = currentEntry(bank, latest);
    }
  }
  for (const [product, banks] of Object.entries(current)) {
    writeSnapshot(path.join(out, `current__${product}.json`), { banks }, now);
  }
  // Index of stored rate files (used by the Convex dataset import).
  const index = files
    .map((pf) => ({ bankSlug: pf.bankSlug, product: pf.product, cards: pf.cards.length, from: pf.cards[0] ? pf.cards[0].effectiveFrom ?? pf.cards[0].observedFrom ?? pf.cards[0].observedAt : null, to: pf.cards.at(-1)?.effectiveFrom ?? pf.cards.at(-1)?.observedAt ?? null }))
    .sort((a, b) => `${a.bankSlug}/${a.product}`.localeCompare(`${b.bankSlug}/${b.product}`));
  writeFileSync(path.join(root, "data", "rates", "_index.json"), `${JSON.stringify({ files: index }, null, 1)}\n`);
  for (const [slug, products] of byBank) {
    const bank = meta.get(slug);
    const pred = preds.get(slug);
    const bankPayload = bank ?? {
      slug,
      name: pred!.name,
      shortName: pred!.name,
      group: rootBank(slug)?.group ?? null,
      founded: pred!.founded,
      mergedInto: pred!.mergedInto,
      mergedOn: pred!.mergedOn,
      kind: "predecessor",
    };
    const terms = Object.entries(loadTerms(root, slug).products).map(([product, e]) => ({ product, observedAt: e!.recordedOn, sourceUrl: e!.sourceUrl, terms: e!.terms }));
    writeSnapshot(path.join(out, `bank__${slug}.json`), { bank: bankPayload, products, terms }, now);
  }
  // Index of stored terms files (used by the Convex dataset import).
  const termsDir = path.join(root, "data", "terms");
  if (existsSync(termsDir)) {
    const termFiles = readdirSync(termsDir).filter((f) => f.endsWith(".json") && !f.startsWith("_")).map((f) => f.replace(/\.json$/, "")).sort();
    writeFileSync(path.join(termsDir, "_index.json"), `${JSON.stringify({ banks: termFiles }, null, 1)}\n`);
  }

  // History coverage for every in-scope bank and every merged predecessor.
  const today = todayIST();
  const coverage: BankCoverage[] = [];
  for (const b of master.banks) {
    if (b.group === "payments" || b.tracking === "deferred") continue;
    coverage.push(bankCoverage({ slug: b.slug, name: b.name, group: b.group, founded: b.founded }, cardsByBank.get(b.slug) ?? {}, today));
  }
  for (const p of preds.values()) {
    coverage.push(bankCoverage({ slug: p.slug, name: p.name, group: rootBank(p.slug)?.group ?? null, founded: p.founded, mergedInto: p.mergedInto, mergedOn: p.mergedOn }, cardsByBank.get(p.slug) ?? {}, today));
  }
  writeSnapshot(path.join(out, "coverage.json"), { generatedOn: today, banks: coverage }, now);
  return { products: Object.keys(current).length, banks: byBank.size, coverage: coverage.length };
}
