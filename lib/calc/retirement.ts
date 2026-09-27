/**
 * Retirement scheme simulations (PPF, EPF + VPF, NPS).
 *
 * Past months use the officially notified rates / real NAVs; months after the last known
 * data use the saver's own assumptions (always editable, never hidden). If a past month has
 * no published rate, the simulation stops and reports the gap instead of guessing.
 *
 * Month keys are "YYYY-MM". Indian financial year runs April–March.
 */

export interface RatePeriod {
  from: string; // YYYY-MM-DD
  to: string | null; // YYYY-MM-DD inclusive
  rate: number | null;
}

export interface YearRow {
  fy: string; // "2024-25"
  contributed: number;
  interest: number;
  balance: number;
  rateNote: string; // "7.10%" or "assumed 7.00%" or "mixed"
}

export interface SimResult {
  rows: YearRow[];
  contributed: number;
  interest: number;
  balance: number;
  /** Set when the simulation had to stop because a past rate/NAV is missing. */
  gap: string | null;
  usedAssumption: boolean;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

export function monthsBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((s) => s.split("-").map(Number));
  return (b[0] - a[0]) * 12 + (b[1] - a[1]);
}

export function fyOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Rate in force in a given month (by the month's 1st day), or the assumption after the last known period. */
export function rateForMonth(periods: RatePeriod[], month: string, assumed: number): { rate: number | null; assumed: boolean } {
  const day = `${month}-01`;
  if (periods.length === 0) return { rate: assumed, assumed: true }; // pure projection
  const hit = periods.find((p) => p.from <= day && (p.to === null || p.to >= day));
  if (hit) return { rate: hit.rate, assumed: false };
  const lastEnd = periods.reduce<string | null>((m, p) => (p.to && (!m || p.to > m) ? p.to : m), null);
  const lastOpen = periods.some((p) => p.to === null);
  if (!lastOpen && lastEnd && day > lastEnd) return { rate: assumed, assumed: true };
  return { rate: null, assumed: false }; // before the scheme's data starts, or a genuine gap
}

function finishYear(rows: YearRow[], fy: string, contributed: number, interest: number, balance: number, notes: Set<string>) {
  rows.push({ fy, contributed, interest, balance, rateNote: notes.size === 1 ? [...notes][0] : "mixed" });
}

/**
 * PPF: interest is calculated monthly on the lowest balance between the 5th and the end of
 * the month and credited once a year on 31 March. Deposits are assumed to be made by the 5th.
 */
export function simulatePPF(o: { start: string; end: string; monthly: number; aprilLumpSum?: number; periods: RatePeriod[]; futureRate: number; opening?: number }): SimResult {
  const rows: YearRow[] = [];
  let balance = o.opening ?? 0;
  let yearInterest = 0;
  let yearContrib = 0;
  let totalContrib = 0;
  let totalInterest = 0;
  let usedAssumption = false;
  let notes = new Set<string>();
  const n = monthsBetween(o.start, o.end);
  for (let i = 0; i <= n; i++) {
    const month = addMonths(o.start, i);
    const isApril = month.endsWith("-04");
    let deposit = o.monthly;
    if (isApril && o.aprilLumpSum) deposit += o.aprilLumpSum;
    balance += deposit;
    yearContrib += deposit;
    totalContrib += deposit;
    const { rate, assumed } = rateForMonth(o.periods, month, o.futureRate);
    if (rate === null) return { rows, contributed: totalContrib, interest: totalInterest, balance, gap: `No published PPF rate for ${month}`, usedAssumption };
    usedAssumption ||= assumed;
    notes.add(assumed ? `assumed ${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`);
    yearInterest += (balance * rate) / 1200;
    const endOfFy = month.endsWith("-03") || i === n;
    if (endOfFy) {
      const credited = Math.round(yearInterest); // PPF interest is rounded to the rupee when credited
      balance += credited;
      totalInterest += credited;
      finishYear(rows, fyOf(month), yearContrib, credited, balance, notes);
      yearInterest = 0;
      yearContrib = 0;
      notes = new Set();
    }
  }
  return { rows, contributed: totalContrib, interest: totalInterest, balance, gap: null, usedAssumption };
}

/** EPF contribution split from basic pay (+DA): employee 12%; employer 12% minus the EPS share (8.33% of pay capped at ₹15,000). */
export function epfMonthlyFromPay(basicPlusDa: number, vpfPercent = 0) {
  const employee = basicPlusDa * 0.12;
  const eps = Math.min(basicPlusDa, 15_000) * 0.0833;
  const employer = basicPlusDa * 0.12 - eps;
  const vpf = (basicPlusDa * vpfPercent) / 100;
  return { employee, employer, eps, vpf, intoEpf: employee + employer + vpf };
}

/**
 * EPF (and VPF, which earns the same declared rate): interest on the monthly running balance,
 * credited at the end of each financial year at that year's declared rate.
 */
export function simulateEPF(o: {
  start: string;
  end: string;
  monthlyIntoEpf: (month: string) => number;
  periods: RatePeriod[];
  futureRate: number;
  opening?: number;
}): SimResult {
  const rows: YearRow[] = [];
  let balance = o.opening ?? 0;
  let runningSum = 0; // sum of month-end balances for the year (excluding this year's interest)
  let yearContrib = 0;
  let totalContrib = 0;
  let totalInterest = 0;
  let usedAssumption = false;
  let notes = new Set<string>();
  const n = monthsBetween(o.start, o.end);
  for (let i = 0; i <= n; i++) {
    const month = addMonths(o.start, i);
    const c = o.monthlyIntoEpf(month);
    balance += c;
    yearContrib += c;
    totalContrib += c;
    runningSum += balance;
    const endOfFy = month.endsWith("-03") || i === n;
    if (endOfFy) {
      const { rate, assumed } = rateForMonth(o.periods, month, o.futureRate);
      if (rate === null) return { rows, contributed: totalContrib, interest: totalInterest, balance, gap: `No declared EPF rate for FY ${fyOf(month)}`, usedAssumption };
      usedAssumption ||= assumed;
      notes.add(assumed ? `assumed ${rate.toFixed(2)}%` : `${rate.toFixed(2)}%`);
      const interest = (runningSum * rate) / 1200;
      balance += interest;
      totalInterest += interest;
      finishYear(rows, fyOf(month), yearContrib, interest, balance, notes);
      runningSum = 0;
      yearContrib = 0;
      notes = new Set();
    }
  }
  return { rows, contributed: totalContrib, interest: totalInterest, balance, gap: null, usedAssumption };
}

/**
 * NPS: each monthly contribution buys units of each asset class at that month's NAV (last
 * available NAV on or before the 1st business days of the month). After the last NAV, units
 * grow at the saver's assumed annual return for that asset class.
 */
export function simulateNPS(o: {
  start: string;
  end: string;
  monthly: number;
  allocation: Array<{ key: string; weight: number; navs: Array<[string, number]>; futureReturn: number }>;
}): SimResult {
  const rows: YearRow[] = [];
  const units = new Map<string, number>();
  const navCache = new Map<string, Map<string, number>>();
  let totalContrib = 0;
  let yearContrib = 0;
  let usedAssumption = false;
  let lastValue = 0;
  let yearStartValue = 0;
  const n = monthsBetween(o.start, o.end);

  const navOn = (key: string, navs: Array<[string, number]>, futureReturn: number, month: string): { nav: number | null; assumed: boolean } => {
    let byMonth = navCache.get(key);
    if (!byMonth) {
      byMonth = new Map();
      for (const [d, v] of navs) {
        const m = d.slice(0, 7);
        if (!byMonth.has(m)) byMonth.set(m, v); // first NAV in each month
      }
      navCache.set(key, byMonth);
    }
    const hit = byMonth.get(month);
    if (hit !== undefined) return { nav: hit, assumed: false };
    const lastMonth = navs.length ? navs[navs.length - 1][0].slice(0, 7) : null;
    if (lastMonth && month > lastMonth) {
      const base = byMonth.get(lastMonth) ?? navs[navs.length - 1][1];
      const k = monthsBetween(lastMonth, month);
      return { nav: base * Math.pow(1 + futureReturn / 100, k / 12), assumed: true };
    }
    return { nav: null, assumed: false };
  };

  for (let i = 0; i <= n; i++) {
    const month = addMonths(o.start, i);
    let value = 0;
    for (const a of o.allocation) {
      const { nav, assumed } = navOn(a.key, a.navs, a.futureReturn, month);
      if (nav === null) return { rows, contributed: totalContrib, interest: lastValue - totalContrib, balance: lastValue, gap: `No NAV for ${a.key} in ${month}`, usedAssumption };
      usedAssumption ||= assumed;
      const add = (o.monthly * a.weight) / nav;
      units.set(a.key, (units.get(a.key) ?? 0) + add);
      value += (units.get(a.key) ?? 0) * nav;
    }
    totalContrib += o.monthly;
    yearContrib += o.monthly;
    lastValue = value;
    if (month.endsWith("-03") || i === n) {
      rows.push({ fy: fyOf(month), contributed: yearContrib, interest: value - yearStartValue - yearContrib, balance: value, rateNote: "market-linked" });
      yearStartValue = value;
      yearContrib = 0;
    }
  }
  return { rows, contributed: totalContrib, interest: lastValue - totalContrib, balance: lastValue, gap: null, usedAssumption };
}
