import type { ReactNode } from "react";
import { formatDateIST } from "@/lib/format";

export function PageHeader({ title, lede, children }: { title: string; lede?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-8 space-y-3">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      {lede ? <p className="max-w-3xl text-muted">{lede}</p> : null}
      {children}
    </div>
  );
}

export function Section({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="mb-10 space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {description ? <p className="text-sm text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-bg p-4 ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="num text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type Tone = "neutral" | "accent" | "warning" | "negative" | "positive";
const toneClass: Record<Tone, string> = {
  neutral: "border-border text-muted",
  accent: "border-transparent bg-accent-soft text-accent",
  warning: "border-warning/40 text-warning",
  negative: "border-negative/40 text-negative",
  positive: "border-positive/40 text-positive",
};

export function Badge({ children, tone = "neutral", title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

/** "As of" line shown next to every figure. */
export function AsOf({ date, label = "Data as of", scope }: { date: string | number | null | undefined; label?: string; scope?: string }) {
  return (
    <p className="text-xs text-muted">
      {label} {formatDateIST(date ?? null)}
      {scope ? ` · ${scope}` : ""}
    </p>
  );
}

export function NotReported({ children = "not reported" }: { children?: ReactNode }) {
  return <span className="text-muted italic">{children}</span>;
}

export function Notice({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warning" }) {
  return (
    <div
      className={`rounded-lg border p-4 text-sm ${tone === "warning" ? "border-warning/40 bg-warning/5 text-text" : "border-border bg-surface text-text"}`}
    >
      {children}
    </div>
  );
}

/** Label for the strength of evidence behind a historical figure. */
export function SourceBadge({ sourceType }: { sourceType: string }) {
  const map: Record<string, { label: string; tone: Tone; title: string }> = {
    bank_official: { label: "Bank website", tone: "positive", title: "Read from the bank's current official rate page" },
    bank_archive: { label: "Bank archive", tone: "positive", title: "From the bank's own archived rate circular or page" },
    web_archive: { label: "Web archive", tone: "accent", title: "From an Internet Archive copy of the bank's official page" },
    rbi_prescribed: { label: "RBI-prescribed", tone: "accent", title: "Rate set by RBI for all banks (regulated era)" },
    rbi_publication: { label: "RBI data", tone: "accent", title: "From an RBI statistical publication" },
    exchange_filing: { label: "Exchange filing", tone: "accent", title: "From the bank's filing with NSE/BSE" },
    press: { label: "Press report", tone: "warning", title: "From a dated press report (secondary source)" },
    government: { label: "Govt notification", tone: "positive", title: "From an official Government notification" },
  };
  const m = map[sourceType] ?? { label: sourceType, tone: "neutral" as Tone, title: sourceType };
  return (
    <Badge tone={m.tone} title={m.title}>
      {m.label}
    </Badge>
  );
}
