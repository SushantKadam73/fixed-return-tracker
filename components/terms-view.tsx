import { formatDateIST, formatINRCompact } from "@/lib/format";

export interface TermsBlock {
  product: string;
  observedAt: string;
  sourceUrl: string;
  terms: {
    minAmount?: number;
    maxAmount?: number;
    bulkThreshold?: number;
    seniorPremium?: string;
    seniorPremiumCap?: string;
    superSeniorPremium?: string;
    prematurePenalty?: string;
    compounding?: string;
    interestCredit?: string;
    rdRules?: string;
    other?: string[];
  };
}

/** Deposit conditions as stated on the bank's own page (senior premium, penalties, minimums...). */
export function TermsList({ block }: { block: TermsBlock }) {
  const t = block.terms;
  const rows: Array<[string, string]> = [];
  if (t.minAmount !== undefined) rows.push(["Minimum deposit", formatINRCompact(t.minAmount)]);
  if (t.maxAmount !== undefined) rows.push(["Maximum deposit", formatINRCompact(t.maxAmount)]);
  if (t.bulkThreshold !== undefined) rows.push(["Bulk deposits from", formatINRCompact(t.bulkThreshold)]);
  if (t.seniorPremium) rows.push(["Senior citizens", t.seniorPremium]);
  if (t.seniorPremiumCap) rows.push(["Senior premium applies up to", t.seniorPremiumCap]);
  if (t.superSeniorPremium) rows.push(["Super senior citizens (80+)", t.superSeniorPremium]);
  if (t.prematurePenalty) rows.push(["Premature withdrawal", t.prematurePenalty]);
  if (t.compounding) rows.push(["Compounding", t.compounding]);
  if (t.interestCredit) rows.push(["Interest credit", t.interestCredit]);
  if (t.rdRules) rows.push(["Recurring deposit rules", t.rdRules]);
  if (rows.length === 0 && !t.other?.length) return null;
  return (
    <div className="mt-4 rounded-lg border border-border p-4">
      <p className="mb-2 text-sm font-medium">Conditions</p>
      {rows.length > 0 ? (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(10rem,auto)_1fr]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {t.other?.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {t.other.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-3 text-xs text-muted">
        As stated on the bank&apos;s page, recorded {formatDateIST(block.observedAt)} ·{" "}
        <a className="text-accent hover:underline" href={block.sourceUrl} target="_blank" rel="noopener noreferrer">
          source
        </a>
        . Confirm with the bank before investing.
      </p>
    </div>
  );
}
