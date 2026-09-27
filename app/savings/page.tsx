import type { Metadata } from "next";
import { SavingsComparison, type BankSavings } from "@/components/savings/savings-comparison";
import { Notice, PageHeader } from "@/components/ui";
import { getSummary } from "@/lib/data";
import type { SavingsSlab, SlabMethod } from "@/lib/domain";
import { getSchemes, schemeStatus } from "@/lib/schemes";

export const metadata: Metadata = {
  title: "Savings account interest rates of Indian banks",
  description: "How much interest your savings balance earns at each bank, applying each bank's own slab rules, with official sources.",
};

type Entry = { name: string; group: BankSavings["group"]; effectiveFrom: string | null; observedAt: string; sourceUrl: string; savingsSlabs: SavingsSlab[] | null; slabMethod: SlabMethod | null };

export default async function SavingsPage() {
  const s = await getSummary<{ banks: Record<string, Entry> }>("current:savings");
  const banks: BankSavings[] = Object.entries(s?.payload?.banks ?? {})
    .filter(([, e]) => e.savingsSlabs && e.savingsSlabs.length > 0)
    .map(([slug, e]) => ({ slug, name: e.name, group: e.group, effectiveFrom: e.effectiveFrom, observedAt: e.observedAt, sourceUrl: e.sourceUrl, slabs: e.savingsSlabs ?? [], method: e.slabMethod ?? "unknown" }));
  const po = (await getSchemes()).find((x) => x.key === "po_sb");
  const poStatus = po ? schemeStatus(po) : null;
  const poRate = poStatus ? (poStatus.kind === "current" ? poStatus.rate : poStatus.lastRate) : null;
  return (
    <div>
      <PageHeader
        title="Savings accounts"
        lede="Enter your usual balance to see the interest each bank would pay in a year. Banks use different slab rules, so the headline rate alone can mislead."
      />
      {banks.length === 0 ? <Notice tone="warning">Savings rates are being collected. They will appear after the first daily run.</Notice> : <SavingsComparison banks={banks} postOfficeRate={poRate} />}
    </div>
  );
}
