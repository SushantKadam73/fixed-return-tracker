/**
 * Government schemes (small savings, provident funds, RBI bonds): loading and status logic.
 */
import "server-only";
import { getSummary, readDataset } from "./data";
import { todayIST } from "./format";

export interface SchemePeriod {
  from: string;
  to: string | null;
  rate: number | null;
  maturityMonths: number | null;
  note: string | null;
  sourceUrl: string;
  evidence: "primary" | "secondary";
}

export interface Scheme {
  key: string;
  name: string;
  category: "small_savings" | "provident_fund" | "bond" | "pension";
  conventions: string[];
  periods: SchemePeriod[];
  gaps: string[];
}

export const SCHEME_ORDER = [
  "ppf", "ssy", "scss", "nsc", "kvp", "pomis", "po_td_1y", "po_td_2y", "po_td_3y", "po_td_5y", "po_rd", "po_sb", "mssc",
  "epf", "vpf", "gpf", "frsb_2020",
];

export const SHORT_NAMES: Record<string, string> = {
  ppf: "PPF", ssy: "Sukanya Samriddhi", scss: "Senior Citizens' Savings", nsc: "NSC", kvp: "Kisan Vikas Patra",
  pomis: "Post Office MIS", po_td_1y: "Post Office TD · 1 yr", po_td_2y: "Post Office TD · 2 yr", po_td_3y: "Post Office TD · 3 yr",
  po_td_5y: "Post Office TD · 5 yr", po_rd: "Post Office RD · 5 yr", po_sb: "Post Office Savings", mssc: "Mahila Samman",
  epf: "EPF", vpf: "VPF", gpf: "GPF", frsb_2020: "RBI Floating Rate Bond",
};

type DatasetScheme = {
  scheme: string;
  name: string;
  category: Scheme["category"];
  conventions?: Record<string, string> | null;
  gaps?: string[];
  periods: Array<{ effectiveFrom: string; effectiveTo?: string | null; rate?: number | null; maturityMonths?: number; note?: string | null; sourceUrl?: string | null; evidence?: string }>;
};

function fromDataset(d: DatasetScheme): Scheme {
  return {
    key: d.scheme,
    name: d.name,
    category: d.category,
    conventions: Object.entries(d.conventions ?? {}).map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${v}`),
    periods: d.periods.map((p) => ({
      from: p.effectiveFrom,
      to: p.effectiveTo ?? null,
      rate: p.rate ?? null,
      maturityMonths: p.maturityMonths ?? null,
      note: p.note ?? null,
      sourceUrl: p.sourceUrl ?? "",
      evidence: p.evidence === "secondary" ? "secondary" : "primary",
    })),
    gaps: d.gaps ?? [],
  };
}

/** All schemes: Convex summary when available (freshest), else the committed dataset. */
export async function getSchemes(): Promise<Scheme[]> {
  const live = await getSummary<{ schemes: Scheme[] }>("schemes");
  let schemes: Scheme[] = [];
  const committed: Scheme[] = [];
  const index = await readDataset<{ schemes: Array<{ scheme: string }> }>("schemes/_index.json");
  for (const { scheme } of index?.schemes ?? []) {
    const d = await readDataset<DatasetScheme>(`schemes/${scheme}.json`);
    if (d) committed.push(fromDataset(d));
  }
  if (live?.origin === "convex" && live.payload?.schemes?.length) {
    const gaps = new Map(committed.map((s) => [s.key, s.gaps]));
    schemes = live.payload.schemes.map((s) => ({ ...s, gaps: gaps.get(s.key) ?? [] }));
  } else {
    schemes = committed;
  }
  // VPF earns exactly the EPF rate: show EPF's history for it.
  const epf = schemes.find((s) => s.key === "epf");
  schemes = schemes.map((s) => (s.key === "vpf" && epf ? { ...s, periods: epf.periods.map((p) => ({ ...p, note: "VPF earns the EPF rate declared for the year." })) } : s));
  return schemes.sort((a, b) => SCHEME_ORDER.indexOf(a.key) - SCHEME_ORDER.indexOf(b.key));
}

export type SchemeStatus =
  | { kind: "current"; rate: number | null; maturityMonths: number | null; since: string; until: string | null }
  | { kind: "awaiting"; lastRate: number | null; lastPeriodEnd: string } // period ended, next not yet published
  | { kind: "closed"; lastRate: number | null; closedOn: string };

/** Status of a scheme's rate today (IST). */
export function schemeStatus(s: Scheme, today = todayIST()): SchemeStatus {
  const sorted = [...s.periods].sort((a, b) => a.from.localeCompare(b.from));
  const latest = sorted[sorted.length - 1];
  if (!latest) return { kind: "awaiting", lastRate: null, lastPeriodEnd: "" };
  if (s.key === "mssc" && latest.to && latest.to < today) return { kind: "closed", lastRate: latest.rate, closedOn: latest.to };
  if (latest.to && latest.to < today) return { kind: "awaiting", lastRate: latest.rate, lastPeriodEnd: latest.to };
  return { kind: "current", rate: latest.rate, maturityMonths: latest.maturityMonths, since: latest.from, until: latest.to };
}

/** Chart points for a step history: one point at each period start, a gap marker where periods are missing. */
export function schemeChartPoints(s: Scheme): Array<{ date: string; value: number | null }> {
  const sorted = [...s.periods].sort((a, b) => a.from.localeCompare(b.from));
  const points: Array<{ date: string; value: number | null }> = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    points.push({ date: p.from, value: p.rate });
    const next = sorted[i + 1];
    if (p.to && next) {
      const gapStart = new Date(`${p.to}T00:00:00Z`);
      gapStart.setUTCDate(gapStart.getUTCDate() + 1);
      const gap = gapStart.toISOString().slice(0, 10);
      if (gap < next.from) points.push({ date: gap, value: null }); // unpublished stretch
    }
    if (!next && p.to) points.push({ date: p.to, value: p.rate });
  }
  return points;
}
