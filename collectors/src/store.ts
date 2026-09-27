/**
 * Repo-backed store of rate cards: data/rates/<bank>/<product>.json.
 * A card is appended only when the rates change, so git history doubles as an audit log.
 * Health of each source lives in one small file (data/rates/_checks.json).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Product, RateCard } from "../../lib/domain";
import type { ProductTerms } from "./types";
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

/**
 * Normalise a card before hashing and storing:
 *  - collapse stray whitespace/newlines in tenure labels (labels are not part of the content hash);
 *  - drop rows that repeat another row exactly apart from the label (some archived pages print
 *    the same slab twice);
 *  - close exact 1-rupee gaps between adjacent amount bands. Banks write "Rs 3 crore to Rs 10 crore"
 *    followed by "above Rs 10 crore"; read label by label the first band ends just below 10 crore
 *    and the second starts just above it, leaving exactly Rs 10 crore in neither. The pair shows
 *    the boundary amount belongs to the lower band, so the lower band's (exclusive) end is moved
 *    up by one rupee. Nothing else is changed.
 */
export function normaliseCard(card: RateCard): RateCard {
  const seen = new Set<string>();
  const rows = card.rows
    .map((r) => ({ ...r, tenureLabel: r.tenureLabel.replace(/\s+/g, " ").trim() }))
    .filter((r) => {
      const { tenureLabel: _label, ...rest } = r;
      void _label;
      const key = JSON.stringify(rest, Object.keys(rest).sort());
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = [r.tenureMinDays, r.tenureMaxDays, r.customer, r.residency, r.callable, r.payout, r.schemeName ?? ""].join("|");
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.amountMin - b.amountMin);
    for (let i = 0; i + 1 < sorted.length; i++) {
      const cur = sorted[i];
      if (cur.amountMax !== null && sorted[i + 1].amountMin === cur.amountMax + 1) cur.amountMax = sorted[i + 1].amountMin;
    }
  }
  let savingsSlabs = card.savingsSlabs;
  if (savingsSlabs && savingsSlabs.length > 1) {
    savingsSlabs = savingsSlabs.map((s) => ({ ...s }));
    const byRes = new Map<string, typeof savingsSlabs>();
    for (const s of savingsSlabs) byRes.set(s.residency, [...(byRes.get(s.residency) ?? []), s]);
    for (const list of byRes.values()) {
      const sorted = [...list].sort((a, b) => a.balanceMin - b.balanceMin);
      for (let i = 0; i + 1 < sorted.length; i++) {
        const cur = sorted[i];
        if (cur.balanceMax !== null && sorted[i + 1].balanceMin === cur.balanceMax + 1) cur.balanceMax = sorted[i + 1].balanceMin;
      }
    }
  }
  return { ...card, rows, ...(savingsSlabs ? { savingsSlabs } : {}) };
}
const normaliseLabels = normaliseCard;

export type StoreOutcome = { outcome: "inserted" | "unchanged" | "rejected"; issues: ValidationIssue[] };

/** Live card: becomes the latest version if rates changed and it passes validation. */
export function storeLiveCard(root: string, input: RateCard): StoreOutcome {
  const card = normaliseLabels(input);
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
export function storeHistoricalCard(root: string, input: RateCard): StoreOutcome {
  const card = normaliseLabels(input);
  const pf = loadProduct(root, card.bankSlug, card.product);
  const contentHash = hash64(canonicalRows(card));
  if (pf.cards.some((c) => c.contentHash === contentHash && cardDate(c) === cardDate(card))) return { outcome: "unchanged", issues: [] };
  const issues = validateCard(card, null);
  if (hasErrors(issues)) return { outcome: "rejected", issues };
  pf.cards.push({ ...card, contentHash });
  saveProduct(root, pf);
  return { outcome: "inserted", issues };
}

/**
 * Replace the web-archive cards previously reconstructed from `sourceUrl` for this bank and
 * product (within the given date window) with a fresh set, so re-running a backfill target (e.g.
 * after a parser fix) never leaves duplicates. Cards that fail validation are skipped and reported.
 */
export function replaceArchiveCards(
  root: string,
  bankSlug: string,
  product: Product,
  sourceUrl: string,
  cards: RateCard[],
  /**
   * Only earlier cards whose date falls in this window are replaced (YYYY-MM-DD, inclusive), so two
   * targets reading different eras of one long-lived URL never wipe each other's cards.
   */
  window?: { from?: string | null; to?: string | null },
): { inserted: number; removed: number; rejected: string[] } {
  const pf = loadProduct(root, bankSlug, product);
  const before = pf.cards.length;
  const inWindow = (c: StoredCard) => {
    const d = c.observedFrom ?? c.effectiveFrom ?? c.observedAt;
    return (!window?.from || d >= window.from) && (!window?.to || d <= window.to);
  };
  pf.cards = pf.cards.filter((c) => !(c.sourceType === "web_archive" && c.sourceUrl === sourceUrl && inWindow(c)));
  const removed = before - pf.cards.length;
  const rejected: string[] = [];
  let inserted = 0;
  for (const input of cards) {
    const card = normaliseLabels(input);
    const issues = validateCard(card, null);
    if (hasErrors(issues)) {
      rejected.push(`${card.observedFrom ?? card.effectiveFrom ?? "?"}: ${issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`);
      continue;
    }
    pf.cards.push({ ...card, contentHash: hash64(canonicalRows(card)) });
    inserted++;
  }
  if (inserted > 0 || removed > 0) saveProduct(root, pf);
  return { inserted, removed, rejected };
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

/**
 * Deposit terms per bank and product (senior premium and its cap, minimum amount, premature
 * withdrawal penalty, compounding, RD rules...) as stated on the bank's page:
 * data/terms/<bank>.json. A product's entry changes (with a new recordedOn date) only when the
 * terms themselves change, so daily runs do not rewrite the file.
 */
export interface TermsEntry {
  terms: Omit<ProductTerms, "product">;
  sourceKey: string;
  sourceUrl: string;
  recordedOn: string;
  contentHash: string;
}
export interface TermsFile {
  bankSlug: string;
  products: Partial<Record<Product, TermsEntry>>;
}

const termsPath = (root: string, bankSlug: string) => path.join(root, "data", "terms", `${bankSlug}.json`);

export function loadTerms(root: string, bankSlug: string): TermsFile {
  const file = termsPath(root, bankSlug);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as TermsFile) : { bankSlug, products: {} };
}

export function storeTerms(root: string, bankSlug: string, source: { key: string; url: string }, terms: ProductTerms[], today: string): number {
  const tf = loadTerms(root, bankSlug);
  let changed = 0;
  for (const t of terms) {
    const { product, ...rest } = t;
    const clean = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined && v !== null && v !== "")) as Omit<ProductTerms, "product">;
    if (Object.keys(clean).length === 0) continue;
    const contentHash = hash64(JSON.stringify(clean, Object.keys(clean).sort()));
    const prev = tf.products[product];
    if (prev && prev.contentHash === contentHash && prev.sourceUrl === source.url) continue;
    tf.products[product] = { terms: clean, sourceKey: source.key, sourceUrl: source.url, recordedOn: today, contentHash };
    changed++;
  }
  if (changed > 0) {
    mkdirSync(path.dirname(termsPath(root, bankSlug)), { recursive: true });
    writeFileSync(termsPath(root, bankSlug), `${JSON.stringify(tf, null, 1)}\n`);
  }
  return changed;
}
