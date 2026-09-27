/**
 * Bank master list (from the committed dataset) and helpers for lineage.
 */
import "server-only";
import { readDataset } from "./data";

export type BankGroupKey = "sbi_nationalised" | "private" | "sfb" | "payments";

export interface BankEntry {
  slug: string;
  name: string;
  shortName: string;
  group: BankGroupKey;
  status: "active";
  tracking: "tracked" | "deferred";
  founded: string | null;
  licenceDate: string | null;
  operationsCommenced: string | null;
  website: string | null;
  legacyDomains: string[];
  hq: string | null;
  nseSymbol: string | null;
  history: Array<{ date: string; event: string; evidenceUrl?: string | null }>;
  evidenceUrls: string[];
  notes: string | null;
}

export interface Predecessor {
  slug: string;
  name: string;
  founded: string | null;
  relation: "merged" | "renamed_or_converted";
  mergedInto: string;
  mergedOn: string | null;
  legacyDomains: string[];
  evidenceUrl: string | null;
  evidence: string;
  notes: string | null;
}

export const GROUP_LABELS: Record<BankGroupKey, string> = {
  sbi_nationalised: "SBI & nationalised banks",
  private: "Private sector banks",
  sfb: "Small finance banks",
  payments: "Payments banks",
};

export const GROUP_ORDER: BankGroupKey[] = ["sbi_nationalised", "private", "sfb", "payments"];

export async function getBankMaster(): Promise<{ banks: BankEntry[]; predecessors: Predecessor[]; checkedAt: string | null }> {
  const d = await readDataset<{ banks: BankEntry[]; predecessors: Predecessor[]; checkedAt?: string }>("banks/banks.json");
  return { banks: d?.banks ?? [], predecessors: d?.predecessors ?? [], checkedAt: d?.checkedAt ?? null };
}

/** All predecessors that ultimately flowed into `slug` (following chains like GTB → OBC → PNB). */
export function lineageOf(slug: string, predecessors: Predecessor[]): Array<Predecessor & { depth: number }> {
  const out: Array<Predecessor & { depth: number }> = [];
  const walk = (target: string, depth: number) => {
    for (const p of predecessors.filter((x) => x.mergedInto === target)) {
      out.push({ ...p, depth });
      walk(p.slug, depth + 1);
    }
  };
  walk(slug, 0);
  return out.sort((a, b) => (a.mergedOn ?? "").localeCompare(b.mergedOn ?? ""));
}

/** "1906", "Sep 1906" or "7 Sep 1906" depending on how precise the founding date is. */
export function formatFounded(value: string | null): string {
  if (!value) return "not reported";
  if (/^\d{4}$/.test(value) || /^\d{4}s$/.test(value)) return value;
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [y, m] = value.split("-");
    return `${new Date(Number(y), Number(m) - 1, 1).toLocaleString("en-IN", { month: "short" })} ${y}`;
  }
  const d = new Date(`${value}T12:00:00+05:30`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
