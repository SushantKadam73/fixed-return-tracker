import Link from "next/link";
import type { Metadata } from "next";
import { Badge, PageHeader, Section } from "@/components/ui";
import { GROUP_LABELS, GROUP_ORDER, formatFounded, getBankMaster, lineageOf } from "@/lib/banks";

export const metadata: Metadata = {
  title: "Banks — SBI, nationalised, private and small finance banks",
  description: "Every bank tracked by the Fixed Return Tracker, with founding dates, merger lineage and links to their official deposit-rate pages.",
};

export default async function BanksPage() {
  const { banks, predecessors, checkedAt } = await getBankMaster();
  return (
    <div>
      <PageHeader
        title="Banks"
        lede={`${banks.filter((b) => b.tracking === "tracked").length} banks tracked across three RBI groups, with ${predecessors.length} merged or renamed predecessors kept for history. Payments banks join in a later release.`}
      />
      {GROUP_ORDER.map((g) => {
        const rows = banks.filter((b) => b.group === g);
        if (rows.length === 0) return null;
        return (
          <Section key={g} title={`${GROUP_LABELS[g]} (${rows.length})`}>
            <div className="scroll-x rounded-lg border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Bank</th>
                    <th className="px-4 py-2 font-medium">Founded</th>
                    <th className="px-4 py-2 font-medium">Merged into it</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((b) => {
                    const merged = lineageOf(b.slug, predecessors).filter((p) => p.relation === "merged");
                    return (
                      <tr key={b.slug} className="border-t border-border hover:bg-surface">
                        <td className="px-4 py-3">
                          <Link href={`/banks/${b.slug}`} className="font-medium hover:text-accent">
                            {b.name}
                          </Link>
                          {b.hq ? <p className="text-xs text-muted">{b.hq}</p> : null}
                        </td>
                        <td className="num px-4 py-3 whitespace-nowrap">{formatFounded(b.founded)}</td>
                        <td className="px-4 py-3 text-xs text-muted">{merged.length > 0 ? merged.map((m) => m.name).join(", ") : "—"}</td>
                        <td className="px-4 py-3">{b.tracking === "tracked" ? <Badge tone="accent">tracked</Badge> : <Badge>later release</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Section>
        );
      })}
      <p className="text-xs text-muted">Bank list per RBI&apos;s “Banks in India” page, checked {checkedAt ?? "recently"}. Founding and merger dates link to primary sources on each bank page.</p>
    </div>
  );
}
