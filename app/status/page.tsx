import type { Metadata } from "next";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { readDataset } from "@/lib/data";
import { formatDateTimeIST } from "@/lib/format";

export const metadata: Metadata = { title: "Data status", description: "When each official source was last read and whether it succeeded." };

type Source = { key: string; bankSlug: string; products: string[]; url: string; format: string; runner: string; cadence: string; active: boolean; notes?: string };
type Check = { lastAttemptAt: string; lastSuccessAt: string | null; lastChangeAt: string | null; consecutiveFailures: number; lastError: string | null };

export default async function StatusPage() {
  const sources = (await readDataset<{ sources: Source[] }>("sources/sources.json"))?.sources ?? [];
  const checks = (await readDataset<Record<string, Check>>("rates/_checks.json")) ?? {};
  const active = sources.filter((s) => s.active);
  const inactive = sources.filter((s) => !s.active);
  const failing = active.filter((s) => (checks[s.key]?.consecutiveFailures ?? 0) > 0);
  return (
    <div>
      <PageHeader title="Data status" lede="Every official page the tracker reads, when it was last read, and whether it worked. When a read fails, the last good rates stay on the site and are marked stale." />
      <div className="mb-8 flex flex-wrap gap-2 text-sm">
        <Badge tone="accent">{active.length} active sources</Badge>
        <Badge tone={failing.length ? "warning" : "positive"}>{failing.length} failing</Badge>
        <Badge>{inactive.length} not yet collectable</Badge>
      </div>
      <Section title="Active sources">
        <div className="scroll-x rounded-lg border border-border">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Source</th>
                <th className="px-4 py-2 font-medium">Last success</th>
                <th className="px-4 py-2 font-medium">Last change</th>
                <th className="px-4 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {active.map((s) => {
                const c = checks[s.key];
                return (
                  <tr key={s.key} className="border-t border-border align-top">
                    <td className="px-4 py-2">
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:text-accent">
                        {s.key}
                      </a>
                      <p className="text-xs text-muted">{s.products.join(", ")} · {s.cadence} · {s.format}</p>
                    </td>
                    <td className="num px-4 py-2 whitespace-nowrap">{c?.lastSuccessAt ? formatDateTimeIST(c.lastSuccessAt) : "—"}</td>
                    <td className="num px-4 py-2 whitespace-nowrap">{c?.lastChangeAt ? formatDateTimeIST(c.lastChangeAt) : "—"}</td>
                    <td className="px-4 py-2">
                      {!c ? <Badge>not run yet</Badge> : c.consecutiveFailures > 0 ? <Badge tone="warning">{c.consecutiveFailures} failure(s)</Badge> : <Badge tone="positive">ok</Badge>}
                      {c?.lastError ? <p className="mt-1 max-w-sm text-xs text-muted">{c.lastError}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      {inactive.length > 0 ? (
        <Section title="Not yet collectable" description="These official pages block automated reading from our runners or need extra work. Their rates are shown only once they can be read from the bank itself.">
          <ul className="space-y-1 text-sm">
            {inactive.map((s) => (
              <li key={s.key}>
                <span className="font-medium">{s.key}</span> <span className="text-muted">— {s.notes ?? "pending"}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Notice>The daily run starts at 07:00 IST; bulk-deposit pages are read again at 10:20 IST on working days, after banks post them (RBI requires this by 10:10 AM from 1 Oct 2026).</Notice>
    </div>
  );
}
