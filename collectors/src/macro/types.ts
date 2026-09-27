/**
 * Contracts for the macro/non-bank collectors (Government schemes, provident funds,
 * inflation, NPS NAVs, RBI policy rates, RBI's bank list).
 *
 * A task is pure with respect to the filesystem: it fetches (via ctx.fetch), parses,
 * compares against the CURRENT committed data (via ctx.read*) and returns proposed
 * `changes`. It never writes files itself — collectors/src/run-macro.ts applies changes,
 * so every write happens in one audited place and `--dry-run` can report without touching
 * the repo.
 */
import type { FetchedDoc, SourceFormat } from "../types";

export type Evidence = "primary" | "secondary";

/** One source attempt, recorded for the human-readable run report. */
export interface SourceAttempt {
  url: string;
  ok: boolean;
  status?: number;
  error?: string;
}

/** A period to append to data/schemes/<scheme>.json (small-savings, epf, gpf, frsb). */
export interface SchemePeriod {
  effectiveFrom: string; // YYYY-MM-DD
  effectiveTo: string | null;
  rate: number | null;
  note: string | null;
  sourceUrl: string;
  evidence: Evidence;
  crossCheckUrl?: string | null;
}

export interface SchemePeriodChange {
  kind: "scheme_period";
  scheme: string; // matches data/schemes/<scheme>.json
  period: SchemePeriod;
}

/** A point to append to data/series/<key>.json `points` (or `textual`). */
export interface SeriesPointChange {
  kind: "series_point";
  seriesKey: string; // matches data/series/<key>.json's "key"
  target: "points" | "textual";
  /** Matches that file's existing tuple shape exactly, e.g. [date, value] or [date, value, value]. */
  point: unknown[];
  /** Only for target "textual": a {date, text} row instead of a numeric point. */
  textual?: { date: string; text: string };
  /** Appended to the file's own top-level `notes` array (already free text in these files) instead of widening the point tuple — e.g. to flag an approximated date. */
  appendNote?: string;
}

/** Rows to append to one of the NPS Tier-I sample CSVs. */
export interface NpsRowsChange {
  kind: "nps_rows";
  file: string; // e.g. "sbi_scheme_e_tieri.csv"
  rows: Array<{ date: string; nav: number; scheme_code: string }>;
  schemeCodes: string[]; // full set of scheme codes now seen for this series (for _samples.json)
  sourceUrl: string;
}

/** A fresh snapshot for data/banks/_watch.json (never edits banks.json itself). */
export interface BanksWatchChange {
  kind: "banks_watch";
  checkedAt: string;
  sourceUrl: string;
  groups: Record<string, string[]>; // group -> bank names, as currently listed by RBI
  additions: Array<{ group: string; name: string }>;
  removals: Array<{ group: string; name: string }>;
}

export type Change = SchemePeriodChange | SeriesPointChange | NpsRowsChange | BanksWatchChange;

export interface TaskResult {
  task: string;
  /** True once at least one source was fetched and parsed without error (even with zero new changes). */
  ok: boolean;
  sourcesTried: SourceAttempt[];
  /** The source that actually produced the data used below (if any). */
  usedSourceUrl?: string;
  changes: Change[];
  warnings: string[];
  /** Set when every source failed; this is what makes the task a "failure" in the run report. */
  error?: string;
}

export interface MacroTaskContext {
  today: string; // YYYY-MM-DD, IST
  root: string; // repo root (data/ lives at <root>/data)
  fetch: (url: string, format?: SourceFormat) => Promise<FetchedDoc>;
}

export type MacroTask = (ctx: MacroTaskContext) => Promise<TaskResult>;

export interface TaskCheck {
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastChangeAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}
