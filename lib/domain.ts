/**
 * Shared domain vocabulary for the Fixed Return Tracker.
 *
 * These types are used by the Convex schema, the collectors (bank page adapters),
 * the backfill scripts and the website, so a rate means exactly the same thing
 * everywhere. Keep them free of framework imports.
 */

/** RBI bank groups covered by the tracker. Payments banks are tracked in a later release. */
export type BankGroup = "sbi_nationalised" | "private" | "sfb" | "payments";

/** What kind of deposit a rate card describes. */
export type Product =
  | "fd" // domestic retail term deposit (below the bulk threshold)
  | "fd_bulk" // domestic bulk term deposit (₹3 crore and above today)
  | "rd" // recurring deposit
  | "savings" // savings bank account
  | "nre" // NRE term deposit
  | "nro" // NRO term deposit
  | "fcnr" // FCNR(B) deposit (foreign currency)
  | "tax_saver"; // 5-year tax-saving term deposit

/** Who the rate applies to. "general" means the ordinary public rate. */
export type CustomerType = "general" | "senior" | "super_senior" | "staff" | "staff_senior" | "women" | "non_individual";

export type Residency = "resident" | "nre" | "nro" | "fcnr";

/** How interest is paid out on a term deposit. */
export type Payout = "cumulative" | "monthly" | "quarterly" | "half_yearly" | "yearly" | "at_maturity";

/**
 * Where a rate came from. Historical rows carry weaker evidence than rows read
 * live from the bank's own page, and the UI labels them accordingly.
 */
export type SourceType =
  | "bank_official" // read directly from the bank's current rate page
  | "bank_archive" // bank's own archived circular / historical page / PDF
  | "web_archive" // Internet Archive copy of the bank's official page
  | "rbi_prescribed" // RBI-prescribed rate that applied to all banks (regulated era)
  | "rbi_publication" // RBI statistical publication (e.g. Handbook ranges)
  | "exchange_filing" // bank's filing with NSE/BSE
  | "press" // dated press report (secondary, last resort)
  | "government"; // Ministry of Finance / EPFO / NSI notification (schemes)

export type Confidence = "high" | "medium" | "low";

/**
 * One row of a published rate card.
 * Tenures are always expressed in days (inclusive range). A single special tenure
 * such as "444 days" has minDays === maxDays and `special: true`.
 * Amounts are in rupees; `amountMax` null means "no upper limit".
 */
export interface RateRow {
  tenureMinDays: number;
  tenureMaxDays: number;
  tenureLabel: string; // exactly as the bank wrote it, e.g. "1 year to less than 2 years"
  special?: boolean; // single-tenure scheme such as 444 days
  schemeName?: string; // e.g. "Amrit Vrishti"
  amountMin: number; // rupees, inclusive
  amountMax: number | null; // rupees, exclusive; null = no cap
  customer: CustomerType;
  residency: Residency;
  callable: boolean | null; // false = non-callable (no premature withdrawal); null = not stated
  payout?: Payout | null;
  rate: number; // % per annum
  note?: string;
}

/** One balance slab of a savings account rate card. */
export interface SavingsSlab {
  balanceMin: number; // rupees, inclusive
  balanceMax: number | null; // rupees, exclusive; null = no cap
  rate: number; // % per annum
  residency: Residency;
  note?: string;
}

/**
 * How a bank applies savings slabs:
 * - "whole": the rate of the slab your balance falls in applies to the entire balance
 * - "incremental": each slice of the balance earns its own slab's rate
 */
export type SlabMethod = "whole" | "incremental" | "unknown";

/** A dated, sourced rate card for one bank and product. */
export interface RateCard {
  bankSlug: string;
  product: Product;
  effectiveFrom: string | null; // YYYY-MM-DD as stated by the source (null if the source gives none)
  observedAt: string; // YYYY-MM-DD when this card was read (live) or captured (archive)
  /** For reconstructed history: the card was in force at least between these dates. */
  observedFrom?: string | null;
  observedTo?: string | null;
  sourceType: SourceType;
  sourceUrl: string;
  archiveUrl?: string | null; // e.g. web.archive.org snapshot URL
  confidence: Confidence;
  rows: RateRow[];
  savingsSlabs?: SavingsSlab[];
  slabMethod?: SlabMethod;
  notes?: string[];
}

/** Small-savings / provident-fund schemes tracked by the site. */
export type SchemeKey =
  | "ppf"
  | "ssy"
  | "scss"
  | "nsc"
  | "kvp"
  | "pomis"
  | "po_td_1y"
  | "po_td_2y"
  | "po_td_3y"
  | "po_td_5y"
  | "po_rd"
  | "po_sb"
  | "mssc"
  | "epf"
  | "vpf"
  | "gpf"
  | "frsb_2020";

export interface SchemeRatePeriod {
  scheme: SchemeKey;
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null; // YYYY-MM-DD inclusive, null = current
  rate: number;
  note?: string;
  sourceUrl: string;
  sourceType: SourceType;
}

/** A point in a time series (inflation index, policy rate, bond yield, gold price...). */
export interface SeriesPoint {
  date: string; // YYYY-MM, YYYY-MM-DD, or fiscal year "1990-91" depending on series frequency
  value: number;
  status?: "provisional" | "final";
}
