import type { Metadata } from "next";
import { FdCalculator, RdCalculator } from "@/components/calculators/deposit-calculators";
import { Card, Notice, PageHeader, Section } from "@/components/ui";

export const metadata: Metadata = {
  title: "FD and RD calculators",
  description: "Fixed deposit and recurring deposit maturity calculators using the quarterly-compounding conventions Indian banks follow.",
};

export default function CalculatorsPage() {
  return (
    <div>
      <PageHeader
        title="Calculators"
        lede="Estimate maturity values the way Indian banks calculate them: quarterly compounding for deposits of six months or more, simple interest for shorter ones, and discounted monthly payouts."
      />
      <Section title="Fixed deposit" id="fd">
        <Card>
          <FdCalculator />
        </Card>
      </Section>
      <Section title="Recurring deposit" id="rd">
        <Card>
          <RdCalculator />
        </Card>
      </Section>
      <Notice>
        These are estimates. Banks round differently and some use their own day-count rules, so a bank&apos;s own calculator can differ by a
        few rupees. Tax deducted at source (TDS) applies when interest from one bank crosses the yearly threshold; it is not deducted here.
      </Notice>
    </div>
  );
}
