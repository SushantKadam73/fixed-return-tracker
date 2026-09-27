/**
 * Task `rbi-bank-list`: RBI's own "Banks in India" page, split into the four groups this
 * site tracks (SBI & nationalised, domestic private, small finance banks, payments
 * banks — matching lib/domain.ts's BankGroup). Never edits data/banks/banks.json; writes
 * a same-name diff to data/banks/_watch.json for a maintainer to review. See README.md.
 */
import { cleanText } from "../parse/common";
import type { BanksWatchChange, MacroTaskContext, TaskResult } from "./types";
import { readBanksFile } from "./store";

export const BANKS_IN_INDIA_URL = "https://www.rbi.org.in/commonman/english/scripts/BanksInIndia.aspx";

export type WatchedGroup = "sbi_nationalised" | "private" | "sfb" | "payments";

const SECTION_HEADERS: Array<{ pattern: RegExp; group: WatchedGroup | "ignore" }> = [
  { pattern: /state bank of india/i, group: "sbi_nationalised" },
  { pattern: /nationalised banks/i, group: "sbi_nationalised" },
  { pattern: /private sector banks/i, group: "private" },
  { pattern: /local area banks/i, group: "ignore" },
  { pattern: /small finance banks/i, group: "sfb" },
  { pattern: /payments banks/i, group: "payments" },
  { pattern: /foreign banks/i, group: "ignore" },
];

const NAME_CELL = /<td[^>]*>\s*([A-Z][^<]{2,90}?)\s*<br/gi;

/**
 * parseBanksInIndia matches raw HTML with regex rather than cheerio (see its doc comment),
 * so — unlike every other parser here, which reads text via cheerio's `.text()` and gets
 * entity decoding for free — captured names still contain literal entities exactly as RBI's
 * page writes them (e.g. "Punjab &amp; Sind Bank"). Decode the handful actually seen on this
 * page before comparing against data/banks/banks.json, or every "&"-named bank shows up as a
 * false-positive addition.
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&[mn]dash;/gi, "-")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/**
 * RBI's page mixes markup shapes (the SBI/Nationalised section headers are a bare
 * `<td colspan=4 class="tableheader">`; later sections use `<tr class="tableheader">`
 * wrapping a `<th colspan=4 class="head">`); it also repeats section-header TEXT in a
 * table-of-contents earlier on the page with no `colspan` nearby. This locates each
 * REAL header by requiring "colspan" within 250 characters before the matched text —
 * true for every content header, false for the TOC's plain links.
 */
export function parseBanksInIndia(html: string): Record<WatchedGroup, string[]> {
  const hits: Array<{ index: number; group: WatchedGroup | "ignore" }> = [];
  for (const { pattern, group } of SECTION_HEADERS) {
    const re = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const window = html.slice(Math.max(0, m.index - 250), m.index);
      if (/olspan/.test(window)) {
        hits.push({ index: m.index, group });
        break;
      }
    }
  }
  hits.sort((a, b) => a.index - b.index);

  const groups: Record<WatchedGroup, string[]> = { sbi_nationalised: [], private: [], sfb: [], payments: [] };
  for (let i = 0; i < hits.length; i++) {
    const { index, group } = hits[i];
    if (group === "ignore") continue;
    const chunk = html.slice(index, hits[i + 1]?.index ?? html.length);
    for (const m of chunk.matchAll(NAME_CELL)) {
      const name = cleanText(decodeEntities(m[1])).replace(/,\s*$/, "");
      if (name && !/&nbsp;/i.test(name)) groups[group].push(name);
    }
  }
  return groups;
}

export function normalizeBankName(name: string): string {
  return cleanText(name)
    .toLowerCase()
    .replace(/^the\s+/, "")
    .replace(/\bltd\.?\b/g, "")
    .replace(/\blimited\b/g, "")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "rbi-bank-list", ok: false, sourcesTried: [], changes: [], warnings: [] };
  const banksFile = readBanksFile(ctx.root);
  if (!banksFile) {
    result.error = "data/banks/banks.json not found";
    return result;
  }

  try {
    const doc = await ctx.fetch(BANKS_IN_INDIA_URL);
    result.sourcesTried.push({ url: BANKS_IN_INDIA_URL, ok: true, status: doc.status });
    result.ok = true;
    result.usedSourceUrl = BANKS_IN_INDIA_URL;

    const rbiGroups = parseBanksInIndia(doc.text);
    const total = Object.values(rbiGroups).reduce((n, g) => n + g.length, 0);
    if (total === 0) {
      result.warnings.push("Parsed zero banks from any of the four groups — RBI's page markup may have changed; not writing _watch.json.");
      return result;
    }

    const additions: BanksWatchChange["additions"] = [];
    const removals: BanksWatchChange["removals"] = [];
    for (const group of Object.keys(rbiGroups) as WatchedGroup[]) {
      const rbiNames = rbiGroups[group];
      const rbiNormSet = new Set(rbiNames.map(normalizeBankName));
      const committed = banksFile.banks.filter((b) => b.group === group);
      const committedNormSet = new Set(committed.map((b) => normalizeBankName(b.name)));
      for (const name of rbiNames) if (!committedNormSet.has(normalizeBankName(name))) additions.push({ group, name });
      for (const b of committed) if (!rbiNormSet.has(normalizeBankName(b.name))) removals.push({ group, name: b.name });
    }

    const change: BanksWatchChange = { kind: "banks_watch", checkedAt: ctx.today, sourceUrl: BANKS_IN_INDIA_URL, groups: rbiGroups, additions, removals };
    result.changes.push(change);
    if (additions.length === 0 && removals.length === 0) result.warnings.push("No differences from data/banks/banks.json found.");
    else result.warnings.push(`${additions.length} addition(s), ${removals.length} removal(s) — see data/banks/_watch.json.`);
  } catch (e) {
    result.sourcesTried.push({ url: BANKS_IN_INDIA_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    result.error = `rbi.org.in unreachable: ${(e as Error).message}`;
  }
  return result;
}
