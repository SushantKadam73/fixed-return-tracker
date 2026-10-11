import type { Metadata } from "next";
import { Badge, Notice, PageHeader, Section } from "@/components/ui";
import { sourceState } from "@/lib/health";
import { getLiveStatus, readDataset } from "@/lib/data";
import { formatDateTimeIST } from "@/lib/format";

export const metadata: Metadata = { title: "Data status", description: "When each official source was last read and whether it succeeded." };

type Source = { key: string; bankSlug: string; products: string[]; url: string; format: string; runner: string; cadence: string; active: boolean; notes?: string };
type Check = { lastAttemptAt: string | number | null; lastSuccessAt: string | number | null; lastChangeAt: string | number | null; consecutiveFailures: number; lastError: string | null };

export const revalidate = 900;

export default async function StatusPage() {
  const sources = (await readDataset<{ sources: Source[] }>("sources/sources.json"))?.sources ?? [];
  const checks = (await readDataset<Record<string, Check>>("rates/_checks.json")) ?? {};
  const live = await getLiveStatus();
  if (live?.sources.length) for (const check of live.sources) checks[check.key] = check;
  const macroChecks = live?.macro?.checks ?? (await readDataset<Record<string, Check>>("macro/_checks.json")) ?? {};
  const active = sources.filter((s) => s.active);
  const inactive = sources.filter((s) => !s.active);
  const failing = active.filter((s) => (checks[s.key]?.consecutiveFailures ?? 0) > 0);
  const stale = active.filter((source) => sourceState(checks[source.key], source.cadence) === "stale");
  return (
    <div>
      <PageHeader title="Data status" lede="Every official page the tracker reads, when it was last read, and whether it worked. When a read fails, the last good rates stay on the site and are marked stale." />
      <div className="mb-8 flex flex-wrap gap-2 text-sm">
        <Badge tone="accent">{active.length} active sources</Badge>
        <Badge tone={failing.length ? "warning" : "positive"}>{failing.length} failing</Badge>
        <Badge tone={stale.length ? "warning" : "positive"}>{stale.length} stale</Badge>
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
                    <td className="num px-4 py-2 whitespace-nowrap">{c?.lastSuccessAt ? formatDateTimeIST(new Date(c.lastSuccessAt).toISOString()) : "—"}</td>
                    <td className="num px-4 py-2 whitespace-nowrap">{c?.lastChangeAt ? formatDateTimeIST(new Date(c.lastChangeAt).toISOString()) : "—"}</td>
                    <td className="px-4 py-2">
                      {sourceState(c, s.cadence) === "ok" ? <Badge tone="positive">ok</Badge> : <Badge tone="warning">{sourceState(c, s.cadence)}</Badge>}
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
      <Section title="Government and RBI collection">
        <ul className="space-y-2 text-sm">
          {Object.entries(macroChecks).map(([task, check]) => <li key={task}><strong>{task}</strong> · {sourceState(check, "daily")} · last verified {check.lastSuccessAt ? formatDateTimeIST(new Date(check.lastSuccessAt).toISOString()) : "never"}{check.lastError ? <p className="text-muted">{check.lastError}</p> : null}</li>)}
        </ul>
      </Section>
      {live?.runs.length ? <Section title="Recent runs"><ul className="space-y-1 text-sm">{live.runs.map((run) => <li key={`${run.job}:${run.startedAt}`}>{run.job} · {run.status} · {formatDateTimeIST(new Date(run.startedAt).toISOString())}</li>)}</ul></Section> : null}
      <Notice>Daily collection is scheduled for 06:17 IST, with recovery at 12:43 IST. Scheduling can be delayed. {live?.sources.length ? "Health is read from Convex and cached for up to 15 minutes." : "Convex health is unavailable or unseeded; these checks came with this website deployment."}</Notice>
    </div>
  );
}
