/**
 * Collector contracts. An adapter turns one fetched official page into rate cards.
 * Adapters are pure (no network of their own except via ctx.fetch) so they can be tested
 * against saved fixtures and run unchanged on GitHub Actions, Convex or the VPS.
 */
import type { Product, RateCard } from "../../lib/domain";

export type SourceFormat = "html" | "pdf" | "json" | "browser";
export type Runner = "github" | "convex" | "vps" | "disabled";

export interface SourceDef {
  key: string; // "<bankSlug>:<name>", e.g. "sbi:fd"
  bankSlug: string;
  products: Product[];
  url: string;
  format: SourceFormat;
  runner: Runner;
  adapter: string; // name in the adapter registry
  cadence: "daily" | "bulk_daily" | "weekly" | "monthly" | "quarterly";
  active: boolean;
  robotsAllowed?: boolean;
  termsNote?: string;
  notes?: string;
}

export interface FetchedDoc {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  /** HTML/JSON text, or text extracted from a PDF. */
  text: string;
  fetchedAt: number;
}

export interface ProductTerms {
  product: Product;
  minAmount?: number;
  maxAmount?: number;
  bulkThreshold?: number;
  seniorPremium?: string;
  seniorPremiumCap?: string;
  superSeniorPremium?: string;
  prematurePenalty?: string;
  compounding?: string;
  interestCredit?: string;
  rdRules?: string;
  other?: string[];
}

export interface AdapterContext {
  source: SourceDef;
  doc: FetchedDoc;
  /** Today in IST, YYYY-MM-DD. */
  today: string;
  /** Fetch a related document (e.g. a linked PDF) with the same polite client. */
  fetch: (url: string, format?: SourceFormat) => Promise<FetchedDoc>;
}

export interface AdapterOutput {
  cards: RateCard[];
  terms?: ProductTerms[];
  warnings?: string[];
}

export type Adapter = (ctx: AdapterContext) => Promise<AdapterOutput>;
