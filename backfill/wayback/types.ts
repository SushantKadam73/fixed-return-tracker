/**
 * Shared types for the Internet Archive backfill (kept separate so parser modules and the
 * runner can import them without circular imports).
 */
import type { Product, RateRow } from "../../lib/domain";

export interface Target {
  bankSlug: string;
  /** Official page as archived (scheme optional), e.g. "sbi.co.in/portal/web/interest-rates/deposit-rates". */
  url: string;
  product: Product;
  amountMax?: number | null;
  from?: string; // YYYY (or YYYYMM)
  to?: string; // YYYY (or YYYYMM)
  /** Key in customParsers; default is the generic table reader. */
  parser?: string;
  note?: string;
}

export interface GenericResult {
  rows: RateRow[];
  effectiveFrom: string | null;
  tablesRead: number;
  skipped: string[];
  /** Heading text just above the table that was read (recorded in the card notes for review). */
  context?: string;
}

/**
 * A custom historical parser for one bank/era page layout. It receives the archived page text
 * (for PDFs: `Buffer.from(text, "latin1")` gives the original bytes) and must return only rows
 * it read with confidence; anything ambiguous goes into `skipped`, never into `rows`.
 */
export type HistoricalParser = (html: string, target: Target) => GenericResult | Promise<GenericResult>;
