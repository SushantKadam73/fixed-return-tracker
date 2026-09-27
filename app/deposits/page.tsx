import type { Metadata } from "next";
import { DepositComparison, type BankRates } from "@/components/deposits/deposit-comparison";
import { Notice, PageHeader } from "@/components/ui";
import { getSummary } from "@/lib/data";
import type { RateRow } from "@/lib/domain";
import { todayIST } from "@/lib/format";

export const metadata: Metadata = {
  title: "Compare FD and RD interest rates across Indian banks",
  description: "Fixed and recurring deposit rates of SBI, nationalised, private and small finance banks — by tenure, amount and depositor type, with a normalised-tenure view and official sources.",
};

type Entry = { name: string; shortName: string; group: BankRates["group"]; effectiveFrom: string | null; observedAt: string; sourceUrl: string; rows: RateRow[] };

async function load(product: string): Promise<BankRates[]> {
  const s = await getSummary<{ banks: Record<string, Entry> }>(`current:${product}`);
  return Object.entries(s?.payload?.banks ?? {}).map(([slug, e]) => ({
    slug,
    name: e.name,
    group: e.group,
    effectiveFrom: e.effectiveFrom,
    observedAt: e.observedAt,
    sourceUrl: e.sourceUrl,
    // Resident depositors only on this page; NRE/NRO/FCNR have their own view.
    rows: e.rows.filter((r) => r.residency === "resident"),
  }));
}

export default async function DepositsPage() {
  const [fd, bulk, rd] = await Promise.all([load("fd"), load("fd_bulk"), load("rd")]);
  // Merge bulk rows into each bank's FD rows; amount bands keep them apart.
  const bulkBySlug = new Map(bulk.map((b) => [b.slug, b.rows]));
  const fdMerged = fd.map((b) => ({ ...b, rows: [...b.rows, ...(bulkBySlug.get(b.slug) ?? [])] }));
  return (
    <div>
      <PageHeader
        title="FD & RD rates"
        lede="Compare what each bank publishes for your amount, tenure and age group. Turn on “normalise tenure” to compare banks inside common tenure buckets, including special tenures like 444 or 555 days."
      />
      {fdMerged.length === 0 ? (
        <Notice tone="warning">Current rates are being collected. They will appear here after the first daily run.</Notice>
      ) : (
        <DepositComparison fd={fdMerged} rd={rd} today={todayIST()} />
      )}
    </div>
  );
}
