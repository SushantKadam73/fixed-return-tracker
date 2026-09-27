/**
 * Repo-backed I/O for the macro datasets: read helpers (used by tasks to see the current
 * state so they only propose genuinely new values) and apply helpers (used only by
 * run-macro.ts to persist a task's proposed `changes`). Every write appends; nothing here
 * ever deletes or rewrites an existing period/point, and each file keeps its own existing
 * indentation style (schemes/*.json: 2 spaces; series/*.json: 1 space).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BanksWatchChange, NpsRowsChange, SchemePeriod, SchemePeriodChange, SeriesPointChange } from "./types";
import { dayBefore } from "./dates";

const schemesDir = (root: string) => path.join(root, "data", "schemes");
const seriesDir = (root: string) => path.join(root, "data", "series");
const npsDir = (root: string) => path.join(seriesDir(root), "nps");
const banksDir = (root: string) => path.join(root, "data", "banks");
export const macroDir = (root: string) => path.join(root, "data", "macro");

function readJson<T>(file: string): T | null {
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null;
}

function writeJson(file: string, obj: unknown, indent: number) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(obj, null, indent)}\n`);
}

/**
 * A plain read-JSON.parse/mutate/JSON.stringify round-trip silently reformats every OTHER
 * number and string already in the file too — JS has no int/float distinction, so a
 * pre-existing "178.0" becomes "178" (and so on for every sibling row) the moment *anything*
 * else in the file changes. applySchemePeriod/applySeriesPoint/touchSchemeCheckedAt/
 * touchSeriesCheckedAt below splice their specific change into the raw text instead, so every
 * byte outside the actual addition is left exactly as committed. Both helpers return null —
 * and the caller falls back to the ordinary full rewrite — the moment the file's own
 * formatting doesn't match what writeJson() itself would have produced (e.g. a hand edit),
 * so this is never a correctness risk, only a formatting nicety when it applies.
 */
function findMatchingBracket(text: string, openIdx: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splices already-rendered JSON item(s) in just before a top-level array's closing `]`. */
function appendItemsToArray(text: string, key: string, renderedItems: string[], indentUnit: number): string | null {
  const head = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text);
  if (!head) return null;
  const openIdx = head.index + head[0].length - 1;
  const closeIdx = findMatchingBracket(text, openIdx);
  if (closeIdx < 0) return null;
  const lineStart = text.lastIndexOf("\n", closeIdx) + 1;
  const closeIndent = text.slice(lineStart, closeIdx);
  if (!/^ *$/.test(closeIndent)) return null; // closing bracket isn't alone on its own indented line — unexpected shape
  const elementIndent = closeIndent + " ".repeat(indentUnit);
  const blocks = renderedItems.map((raw) =>
    raw
      .split("\n")
      .map((line) => elementIndent + line)
      .join("\n"),
  );
  const inner = text.slice(openIdx + 1, closeIdx);
  const insertion = blocks.join(",\n");
  const patched = /\S/.test(inner) ? `${inner.replace(/\s+$/, "")},\n${insertion}\n${closeIndent}` : `\n${insertion}\n${closeIndent}`;
  return text.slice(0, openIdx + 1) + patched + text.slice(closeIdx);
}

/** Replaces a top-level `"key": "value"` field's value in place. */
function patchTopLevelStringField(text: string, key: string, value: string): string | null {
  const m = new RegExp(`("${key}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`).exec(text);
  if (!m) return null;
  return text.slice(0, m.index) + m[1] + JSON.stringify(value) + text.slice(m.index + m[0].length);
}

function rawTextOf(file: string): string | null {
  return existsSync(file) ? readFileSync(file, "utf8") : null;
}

// ---------- schemes/*.json (2-space indent) ----------

export interface SchemeFile {
  scheme: string;
  name: string;
  category: string;
  checkedAt: string;
  conventions?: Record<string, unknown>;
  periods: SchemePeriod[];
  gaps?: string[];
  notes?: string;
  [k: string]: unknown;
}

export function schemeFilePath(root: string, scheme: string) {
  return path.join(schemesDir(root), `${scheme}.json`);
}

export function readSchemeFile(root: string, scheme: string): SchemeFile | null {
  return readJson<SchemeFile>(schemeFilePath(root, scheme));
}

export function lastSchemePeriod(root: string, scheme: string): SchemePeriod | null {
  const f = readSchemeFile(root, scheme);
  if (!f || f.periods.length === 0) return null;
  return [...f.periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1) ?? null;
}

/**
 * Appends a period — one row per confirmed quarter/half-year/FY, even when its rate is
 * unchanged from the previous row. This matches how these files already record events
 * that were each independently confirmed (e.g. frsb_2020.json's Jul-Dec 2024 and
 * Jan-Jun 2026 rows are both 8.05% but kept separate because RBI issued a distinct
 * press release for each; gpf.json's 2016-04-01/06-30 and 2016-07-01/09-30 rows are both
 * 8.1% for the same reason). The one long multi-year row some files show for 2020-2026
 * reflects a single retrospective NSI citation the original research pass used, not a
 * "merge equal rates" rule to replicate going forward. Also closes the previous last
 * period's `effectiveTo` if it was ever left open (defensive; not expected to trigger in
 * practice, since these files always set a concrete effectiveTo). Returns false if that
 * exact effectiveFrom is already recorded — never rewrites history.
 */
export function applySchemePeriod(root: string, change: SchemePeriodChange): boolean {
  const file = schemeFilePath(root, change.scheme);
  const raw = rawTextOf(file);
  const f = readJson<SchemeFile>(file);
  if (!f) throw new Error(`scheme file not found: ${change.scheme}`);
  if (f.periods.some((p) => p.effectiveFrom === change.period.effectiveFrom)) return false;
  const sorted = [...f.periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const last = sorted.at(-1);
  const closesOpenPeriod = last !== undefined && last.effectiveTo === null;
  if (closesOpenPeriod) {
    const idx = f.periods.indexOf(last!);
    f.periods[idx] = { ...last!, effectiveTo: dayBefore(change.period.effectiveFrom) };
  }
  f.periods.push(change.period);
  f.periods.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

  // Fast path: a plain trailing append (the overwhelmingly common case — see this
  // function's own doc comment) can be spliced into the raw text; anything else (closing a
  // previously-open period, or a period that doesn't sort to the end) falls back below.
  const isTrailingAppend = f.periods.at(-1) === change.period;
  const patched = !closesOpenPeriod && raw && isTrailingAppend ? appendItemsToArray(raw, "periods", [JSON.stringify(change.period, null, 2)], 2) : null;
  if (patched) writeFileSync(file, patched);
  else writeJson(file, f, 2);
  return true;
}

export function touchSchemeCheckedAt(root: string, scheme: string, today: string) {
  const file = schemeFilePath(root, scheme);
  const raw = rawTextOf(file);
  const patched = raw ? patchTopLevelStringField(raw, "checkedAt", today) : null;
  if (patched) {
    writeFileSync(file, patched);
    return;
  }
  const f = readJson<SchemeFile>(file);
  if (!f) return;
  f.checkedAt = today;
  writeJson(file, f, 2);
}

interface SchemesIndex {
  checkedAt: string;
  schemes: Array<{ scheme: string; name: string; category: string; periods: number; from: string; latestRate: number | null }>;
}

export function updateSchemesIndex(root: string, scheme: string, today: string) {
  const idxFile = path.join(schemesDir(root), "_index.json");
  const idx = readJson<SchemesIndex>(idxFile);
  const f = readSchemeFile(root, scheme);
  if (!idx || !f) return;
  const sorted = [...f.periods].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const entry = idx.schemes.find((s) => s.scheme === scheme);
  const computed = { scheme, name: f.name, category: f.category, periods: sorted.length, from: sorted[0]?.effectiveFrom ?? "", latestRate: sorted.at(-1)?.rate ?? null };
  if (entry) Object.assign(entry, computed);
  else idx.schemes.push(computed);
  idx.checkedAt = today;
  writeJson(idxFile, idx, 2);
}

// ---------- series/*.json (1-space indent) ----------

export interface SeriesFile {
  key: string;
  checkedAt: string;
  name: string;
  unit: string;
  frequency: string;
  publisher: string;
  sourceUrl?: string;
  points: unknown[][];
  textual?: Array<{ date: string; text: string }>;
  notes?: string[];
  [k: string]: unknown;
}

export function seriesFilePath(root: string, key: string) {
  return path.join(seriesDir(root), `${key}.json`);
}

export function readSeriesFile(root: string, key: string): SeriesFile | null {
  return readJson<SeriesFile>(seriesFilePath(root, key));
}

/** Appends a point/textual row; returns false if that exact date already exists (never overwrites). */
export function applySeriesPoint(root: string, change: SeriesPointChange): boolean {
  const file = seriesFilePath(root, change.seriesKey);
  const raw = rawTextOf(file);
  const f = readJson<SeriesFile>(file);
  if (!f) throw new Error(`series file not found: ${change.seriesKey}`);

  let arrayKey: "points" | "textual";
  let addedItem: unknown;
  let isTrailingAppend: boolean;
  if (change.target === "textual") {
    const row = change.textual!;
    f.textual = f.textual ?? [];
    if (f.textual.some((t) => t.date === row.date)) return false;
    f.textual.push(row);
    f.textual.sort((a, b) => a.date.localeCompare(b.date));
    arrayKey = "textual";
    addedItem = row;
    isTrailingAppend = f.textual.at(-1) === row;
  } else {
    const date = String(change.point[0]);
    if (f.points.some((p) => String(p[0]) === date)) return false;
    f.points.push(change.point);
    f.points.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    arrayKey = "points";
    addedItem = change.point;
    isTrailingAppend = f.points.at(-1) === change.point;
  }

  let addedNote: string | null = null;
  if (change.appendNote) {
    f.notes = Array.isArray(f.notes) ? f.notes : [];
    if (!f.notes.includes(change.appendNote)) {
      f.notes.push(change.appendNote);
      addedNote = change.appendNote;
    }
  }

  // Fast path: splice the new row (and, if any, the new note) into the raw text; falls back
  // to a full rewrite if the row didn't land at the end (shouldn't happen — every task here
  // only ever fetches the newest period) or the file's shape doesn't match what this module
  // itself would have written.
  let patched: string | null = raw && isTrailingAppend ? appendItemsToArray(raw, arrayKey, [JSON.stringify(addedItem, null, 1)], 1) : null;
  if (patched && addedNote) patched = appendItemsToArray(patched, "notes", [JSON.stringify(addedNote, null, 1)], 1);
  if (patched) writeFileSync(file, patched);
  else writeJson(file, f, 1);
  return true;
}

export function touchSeriesCheckedAt(root: string, key: string, today: string) {
  const file = seriesFilePath(root, key);
  const raw = rawTextOf(file);
  const patched = raw ? patchTopLevelStringField(raw, "checkedAt", today) : null;
  if (patched) {
    writeFileSync(file, patched);
    return;
  }
  const f = readJson<SeriesFile>(file);
  if (!f) return;
  f.checkedAt = today;
  writeJson(file, f, 1);
}

interface SeriesIndex {
  checkedAt: string;
  series: Array<{ key: string; name: string; unit: string; frequency: string; publisher?: string; from: string; to: string; count: number }>;
}

export function updateSeriesIndex(root: string, key: string, today: string) {
  const idxFile = path.join(seriesDir(root), "_index.json");
  const idx = readJson<SeriesIndex>(idxFile);
  const f = readSeriesFile(root, key);
  if (!idx || !f) return;
  const entry = idx.series.find((s) => s.key === key);
  const from = String(f.points[0]?.[0] ?? entry?.from ?? "");
  const to = String(f.points.at(-1)?.[0] ?? entry?.to ?? "");
  const computed = { key, name: f.name, unit: f.unit, frequency: f.frequency, publisher: f.publisher, from, to, count: f.points.length };
  if (entry) Object.assign(entry, computed);
  else idx.series.push(computed);
  idx.checkedAt = today;
  writeJson(idxFile, idx, 1);
}

// ---------- series/nps/*.csv ----------

export interface NpsRow {
  date: string;
  nav: string; // kept as the original text token to avoid float round-tripping
  scheme_code: string;
}

export function npsCsvPath(root: string, file: string) {
  return path.join(npsDir(root), file);
}

export function readNpsCsv(root: string, file: string): { header: string; rows: NpsRow[] } {
  const text = readFileSync(npsCsvPath(root, file), "utf8");
  // Tolerate CRLF on read (these files are committed as LF; a checkout/editor could still
  // reintroduce CRLF) so a stray "\r" never ends up glued onto the last field of a row.
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines[0];
  const rows = lines.slice(1).map((l) => {
    const [date, nav, scheme_code] = l.split(",");
    return { date, nav, scheme_code };
  });
  return { header, rows };
}

/** Appends new dated rows (by date, never overwriting an existing date) and refreshes _samples.json for this file. */
export function applyNpsRows(root: string, change: NpsRowsChange): number {
  const { header, rows } = readNpsCsv(root, change.file);
  const known = new Set(rows.map((r) => r.date));
  let appended = 0;
  for (const r of change.rows) {
    if (known.has(r.date)) continue;
    rows.push({ date: r.date, nav: String(r.nav), scheme_code: r.scheme_code });
    known.add(r.date);
    appended += 1;
  }
  if (appended === 0) return 0;
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const text = `${[header, ...rows.map((r) => `${r.date},${r.nav},${r.scheme_code}`)].join("\n")}\n`;
  writeFileSync(npsCsvPath(root, change.file), text);

  const samplesFile = path.join(npsDir(root), "_samples.json");
  const samples = readJson<{ note: string; series: Record<string, { rows: number; from: string; to: string; schemeCodes: string[]; sourceUrls: string[] }> }>(samplesFile);
  if (samples) {
    const key = change.file.replace(/\.csv$/, "");
    const entry = samples.series[key];
    if (entry) {
      entry.rows = rows.length;
      entry.from = rows[0]?.date ?? entry.from;
      entry.to = rows.at(-1)?.date ?? entry.to;
      entry.schemeCodes = change.schemeCodes;
    }
    writeJson(samplesFile, samples, 2);
  }
  return appended;
}

// ---------- banks/_watch.json ----------

export interface BanksFile {
  checkedAt: string;
  source: string;
  banks: Array<{ slug: string; name: string; group: string; status: string }>;
}

export function readBanksFile(root: string): BanksFile | null {
  return readJson<BanksFile>(path.join(banksDir(root), "banks.json"));
}

export function writeBanksWatch(root: string, change: BanksWatchChange) {
  const file = path.join(banksDir(root), "_watch.json");
  writeJson(
    file,
    {
      checkedAt: change.checkedAt,
      sourceUrl: change.sourceUrl,
      note: "Automated diff of RBI's Banks-in-India page against data/banks/banks.json by (normalised) name. Never applied automatically — review and edit banks.json by hand.",
      additions: change.additions,
      removals: change.removals,
      groupCounts: Object.fromEntries(Object.entries(change.groups).map(([g, names]) => [g, names.length])),
    },
    2,
  );
}
