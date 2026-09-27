/**
 * Display formatting for Indian users: rupees in lakh/crore, USD in million/billion,
 * dates in IST. Keep every user-facing number going through these helpers so the
 * whole site stays consistent.
 */

const LAKH = 1_00_000;
const CRORE = 1_00_00_000;

const inrGrouping = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

/** ₹12,34,567 — full rupee amount with Indian digit grouping. */
export function formatINR(amount: number | null | undefined, opts: { decimals?: number } = {}): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "not reported";
  const decimals = opts.decimals ?? 0;
  const formatter =
    decimals === 0
      ? inrGrouping
      : new Intl.NumberFormat("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const sign = amount < 0 ? "−" : "";
  return `${sign}₹${formatter.format(Math.abs(amount))}`;
}

/**
 * ₹12.35 lakh, ₹3.2 crore, ₹1.2 lakh crore — compact Indian units.
 * Below ₹1 lakh the full amount is shown (₹85,000).
 */
export function formatINRCompact(amount: number | null | undefined, maxDecimals = 2): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "not reported";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs < LAKH) return `${sign}₹${inrGrouping.format(abs)}`;
  const units: Array<[number, string]> = [
    [LAKH * CRORE, "lakh crore"],
    [CRORE, "crore"],
    [LAKH, "lakh"],
  ];
  for (const [size, label] of units) {
    if (abs >= size) {
      const scaled = abs / size;
      const text = trimZeros(scaled.toFixed(scaled >= 100 ? 0 : maxDecimals));
      // Use Indian grouping for large crore figures (₹1,250 crore).
      const grouped = Number(text) >= 1000 ? inrGrouping.format(Number(text)) : text;
      return `${sign}₹${grouped} ${label}`;
    }
  }
  return `${sign}₹${inrGrouping.format(abs)}`;
}

/** $1.2 million, $3.45 billion — international units for USD figures. */
export function formatUSDCompact(amount: number | null | undefined, maxDecimals = 2): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "not reported";
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  const units: Array<[number, string]> = [
    [1e12, "trillion"],
    [1e9, "billion"],
    [1e6, "million"],
  ];
  for (const [size, label] of units) {
    if (abs >= size) return `${sign}$${trimZeros((abs / size).toFixed(maxDecimals))} ${label}`;
  }
  return `${sign}$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(abs)}`;
}

/** 7.10% — interest rates are always shown with two decimals, as banks publish them. */
export function formatRate(rate: number | null | undefined, decimals = 2): string {
  if (rate === null || rate === undefined || Number.isNaN(rate)) return "not reported";
  return `${rate.toFixed(decimals)}%`;
}

/** +0.50 pp / −0.25 pp — differences between two rates, in percentage points. */
export function formatRateDelta(delta: number | null | undefined, decimals = 2): string {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "not reported";
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "±";
  return `${sign}${Math.abs(delta).toFixed(decimals)} pp`;
}

const IST = "Asia/Kolkata";

function toDate(value: string | number | Date): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    // Date-only strings are calendar dates in India; pin them to IST noon so they never shift a day.
    return new Date(`${value}T12:00:00+05:30`);
  }
  return new Date(value);
}

/** 27 Sep 2026 */
export function formatDateIST(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "not reported";
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: IST }).format(date);
}

/** 27 Sep 2026, 10:15 AM IST */
export function formatDateTimeIST(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === "") return "not reported";
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return "not reported";
  const text = new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(date);
  return `${text.replace(/\bam\b/, "AM").replace(/\bpm\b/, "PM")} IST`;
}

/** Today's calendar date in India as YYYY-MM-DD. */
export function todayIST(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Human tenure label from days: "444 days", "1 year", "2 years 6 months" when exact. */
export function formatTenureDays(days: number): string {
  if (days % 365 === 0 && days >= 365) {
    const years = days / 365;
    return `${years} year${years === 1 ? "" : "s"}`;
  }
  return `${days} day${days === 1 ? "" : "s"}`;
}
