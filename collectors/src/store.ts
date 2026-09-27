/**
 * Repo-backed store of rate cards: data/rates/<bank>/<product>.json.
 * A card is appended only when the rates change, so git history doubles as an audit log.
 * Health of each source lives in one small file (data/rates/_checks.json).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Product, RateCard } from "../../lib/domain";
import { hash64 } from "../../lib/hash";
import { canonicalRows, hasErrors, validateCard, type ValidationIssue } from "../../lib/validate";
import { cardDate, type StoredCard } from "../../lib/summary-build";

export interface ProductFile {
  bankSlug: string;
  product: Product;
  cards: StoredCard[];
}

export interface SourceCheck {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastChangeAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

const ratesDir = (root: string) => path.join(root, "data", "rates");

export function productPath(root: string, bankSlug: string, product: Product) {
  return path.join(ratesDir(root), bankSlug, `${product}.json`);
}

export function loadProduct(root: string, bankSlug: string, product: Product): ProductFile {
  const file = productPath(root, bankSlug, product);
  if (!existsSync(file)) return { bankSlug, product, cards: [] };
  return JSON.parse(readFileSync(file, "utf8")) as ProductFile;
}

function saveProduct(root: string, pf: ProductFile) {
  const file = productPath(root, pf.bankSlug, pf.product);
  mkdirSync(path.dirname(file), { recursive: true });
  pf.cards.sort((a, b) => cardDate(a).localeCompare(cardDate(b)));
  writeFileSync(file, `${JSON.stringify(pf, null, 1)}\n`);
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export type StoreOutcome = { outcome: "inserted" | "unchanged" | "rejected"; issues: ValidationIssue[] };

/** Live card: becomes the latest version if rates changed and it passes validation. */
export function storeLiveCard(root: string, card: RateCard): StoreOutcome {
  const pf = loadProduct(root, card.bankSlug, card.product);
  const contentHash = hash64(canonicalRows(card));
  const live = pf.cards.filter((c) => c.sourceType === "bank_official");
  const latest = live.at(-1) ?? null;
  if (latest && latest.contentHash === contentHash) return { outcome: "unchanged", issues: [] };
  const issues = validateCard(card, latest);
  if (hasErrors(issues)) return { outcome: "rejected", issues };
  if (latest && !latest.validTo) latest.validTo = card.effectiveFrom ? dayBefore(card.effectiveFrom) : card.observedAt;
  pf.cards.push({ ...card, contentHash });
  saveProduct(root, pf);
  return { outcome: "inserted", issues };
}

/** Historical card (web archive, bank archive, RBI...): added unless an identical one exists for that date. */
export function storeHistoricalCard(root: string, card: RateCard): StoreOutcome {
  const pf = loadProduct(root, card.bankSlug, card.product);
  const contentHash = hash64(canonicalRows(card));
  if (pf.cards.some((c) => c.contentHash === contentHash && cardDate(c) === cardDate(card))) return { outcome: "unchanged", issues: [] };
  const issues = validateCard(card, null);
  if (hasErrors(issues)) return { outcome: "rejected", issues };
  pf.cards.push({ ...card, contentHash });
  saveProduct(root, pf);
  return { outcome: "inserted", issues };
}

export function loadChecks(root: string): Record<string, SourceCheck> {
  const file = path.join(ratesDir(root), "_checks.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, SourceCheck>) : {};
}

export function saveChecks(root: string, checks: Record<string, SourceCheck>) {
  mkdirSync(ratesDir(root), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(checks).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path.join(ratesDir(root), "_checks.json"), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** Every stored product file (for snapshot building). */
export function allProductFiles(root: string): ProductFile[] {
  const dir = ratesDir(root);
  if (!existsSync(dir)) return [];
  const out: ProductFile[] = [];
  for (const bank of readdirSync(dir, { withFileTypes: true })) {
    if (!bank.isDirectory()) continue;
    for (const f of readdirSync(path.join(dir, bank.name))) {
      if (f.endsWith(".json")) out.push(JSON.parse(readFileSync(path.join(dir, bank.name, f), "utf8")) as ProductFile);
    }
  }
  return out;
}
