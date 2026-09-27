import Link from "next/link";
import { PageHeader, Section, Card } from "@/components/ui";

export default function Home() {
  return (
    <div>
      <PageHeader
        title="Fixed-return rates in India, with their full history"
        lede="FD, RD and savings account rates from 44 banks, small-savings schemes, EPF, PPF and NPS — with the date and source behind every number, and what that money is really worth after inflation."
      />
      <Section title="Explore">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["/deposits", "FD & RD rates", "Compare banks by tenure, amount and customer type."],
            ["/savings", "Savings accounts", "Interest you would earn on your balance."],
            ["/banks", "Banks", "Every bank's current card and rate history."],
            ["/schemes", "Government schemes", "PPF, SSY, SCSS, NSC, EPF and more."],
            ["/real-value", "Real value of money", "What an amount was worth then and now."],
            ["/calculators", "Calculators", "FD, RD and savings interest."],
          ].map(([href, title, text]) => (
            <Link key={href} href={href}>
              <Card className="h-full hover:bg-surface">
                <p className="font-medium">{title}</p>
                <p className="mt-1 text-sm text-muted">{text}</p>
              </Card>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
