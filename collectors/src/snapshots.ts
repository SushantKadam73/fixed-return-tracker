/**
 * Build the website's fallback snapshots (data/snapshots/*.json) from the repo rate store,
 * in exactly the shape Convex summaries use.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Product } from "../../lib/domain";
import { currentEntry, productSummary, type StoredCard } from "../../lib/summary-build";
import { allProductFiles } from "./store";

type BankMeta = { slug: string; name: string; shortName: string; group: string; tracking?: string };

export function buildSnapshots(root: string) {
  const master = JSON.parse(readFileSync(path.join(root, "data", "banks", "banks.json"), "utf8")) as { banks: BankMeta[] };
  const meta = new Map(master.banks.map((b) => [b.slug, b]));
  const files = allProductFiles(root);
  const out = path.join(root, "data", "snapshots");
  mkdirSync(out, { recursive: true });
  const now = Date.now();

  const current: Partial<Record<Product, Record<string, unknown>>> = {};
  const byBank = new Map<string, Record<string, unknown>>();
  for (const pf of files) {
    const bank = meta.get(pf.bankSlug);
    if (!bank) continue;
    const live = pf.cards.filter((c) => c.sourceType === "bank_official");
    const latest: StoredCard | null = live.at(-1) ?? null;
    const products = byBank.get(pf.bankSlug) ?? {};
    products[pf.product] = productSummary(pf.product, pf.cards, latest);
    byBank.set(pf.bankSlug, products);
    if (latest) {
      current[pf.product] = current[pf.product] ?? {};
      current[pf.product]![pf.bankSlug] = currentEntry(bank, latest);
    }
  }
  for (const [product, banks] of Object.entries(current)) {
    writeFileSync(path.join(out, `current__${product}.json`), `${JSON.stringify({ payload: { banks }, updatedAt: now })}\n`);
  }
  // Index of stored rate files (used by the Convex dataset import).
  const index = files
    .map((pf) => ({ bankSlug: pf.bankSlug, product: pf.product, cards: pf.cards.length, from: pf.cards[0] ? pf.cards[0].effectiveFrom ?? pf.cards[0].observedFrom ?? pf.cards[0].observedAt : null, to: pf.cards.at(-1)?.effectiveFrom ?? pf.cards.at(-1)?.observedAt ?? null }))
    .sort((a, b) => `${a.bankSlug}/${a.product}`.localeCompare(`${b.bankSlug}/${b.product}`));
  writeFileSync(path.join(root, "data", "rates", "_index.json"), `${JSON.stringify({ files: index }, null, 1)}\n`);
  for (const [slug, products] of byBank) {
    writeFileSync(path.join(out, `bank__${slug}.json`), `${JSON.stringify({ payload: { bank: meta.get(slug), products, terms: [] }, updatedAt: now })}\n`);
  }
  return { products: Object.keys(current).length, banks: byBank.size };
}
