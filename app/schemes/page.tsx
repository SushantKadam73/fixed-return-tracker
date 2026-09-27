import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { formatDateIST, formatRate } from "@/lib/format";
import { SHORT_NAMES, getSchemes, schemeStatus, type Scheme } from "@/lib/schemes";

export const metadata: Metadata = {
  title: "Government savings schemes — PPF, SSY, SCSS, NSC, EPF rates and history",
  description: "Current and historical interest rates for PPF, Sukanya Samriddhi, SCSS, NSC, KVP, Post Office deposits, EPF, VPF, GPF and RBI Floating Rate Savings Bonds.",
};

const GROUPS: Array<{ title: string; description: string; categories: Scheme["category"][] }> = [
  { title: "Small savings schemes", description: "Rates notified by the Ministry of Finance, reviewed every quarter.", categories: ["small_savings"] },
  { title: "Provident funds", description: "EPF is declared once a year by EPFO; VPF earns the same rate; GPF is notified for Central Government employees.", categories: ["provident_fund"] },
  { title: "RBI bonds", description: "Coupon resets every six months, linked to the NSC rate.", categories: ["bond"] },
];

function StatusCell({ s }: { s: Scheme }) {
  const st = schemeStatus(s);
  if (st.kind === "current") {
    return (
      <div>
        <p className="num font-semibold">{st.rate !== null ? formatRate(st.rate) : st.maturityMonths ? `doubles in ${st.maturityMonths} months` : "—"}</p>
        <p className="text-xs text-muted">since {formatDateIST(st.since)}{st.until ? ` · notified up to ${formatDateIST(st.until)}` : ""}</p>
      </div>
    );
  }
  if (st.kind === "closed") {
    return (
      <div>
        <p className="num text-muted">{formatRate(st.lastRate)}</p>
        <Badge>closed {formatDateIST(st.closedOn)}</Badge>
      </div>
    );
  }
  return (
    <div>
      <p className="num font-semibold">{formatRate(st.lastRate)}</p>
      <Badge tone="warning" title="The last notified period has ended and the next rate has not been published yet">
        awaiting next notification
      </Badge>
    </div>
  );
}

export default async function SchemesPage() {
  const schemes = await getSchemes();
  return (
    <div>
      <PageHeader
        title="Government savings schemes"
        lede="Current rates and the full history of every Government-backed fixed-return scheme — from PPF's 4.8% in 1968 to today — with the notification behind each number."
      />
      {schemes.length === 0 ? <Notice tone="warning">Scheme data is not available right now.</Notice> : null}
      {GROUPS.map((g) => {
        const rows = schemes.filter((s) => g.categories.includes(s.category));
        if (rows.length === 0) return null;
        return (
          <Section key={g.title} title={g.title} description={g.description}>
            <div className="scroll-x rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Scheme</th>
                    <th className="px-4 py-2 font-medium">Current rate</th>
                    <th className="px-4 py-2 font-medium">History from</th>
                    <th className="px-4 py-2 font-medium">Periods</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.key} className="border-t border-border hover:bg-surface">
                      <td className="px-4 py-3">
                        <Link href={`/schemes/${s.key}`} className="font-medium hover:text-accent">
                          {SHORT_NAMES[s.key] ?? s.name}
                        </Link>
                        <p className="text-xs text-muted">{s.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusCell s={s} />
                      </td>
                      <td className="num px-4 py-3">{formatDateIST(s.periods[0]?.from)}</td>
                      <td className="num px-4 py-3">{s.periods.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
      <p className="text-xs text-muted">
        Sources: Ministry of Finance / Department of Economic Affairs notifications, National Savings Institute, EPFO, RBI press releases.
        Periods marked secondary rest on compilations and are cross-checked where possible.
      </p>
    </div>
  );
}
