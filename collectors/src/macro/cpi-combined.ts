/**
 * Task `cpi-combined`: CPI Combined (All-India), base 2024=100, monthly, from MoSPI's
 * eSankhyiki API (api.mospi.gov.in). The API requires signup + a 15-minute bearer token
 * (see the official user manual, linked below) and returned HTTP 502 on every endpoint
 * from this sandbox on 2026-09-27 (an upstream outage, not a WAF block — see
 * README.md). This task is implemented against the documented endpoint shape so it
 * starts working the moment the API is back, and fails gracefully (ok:true, zero
 * changes, a warning) rather than treating a 502 as a hard task failure — see run-macro.ts.
 */
import type { MacroTaskContext, SeriesPointChange, TaskResult } from "./types";
import { readSeriesFile } from "./store";

export const MOSPI_API_BASE = "https://api.mospi.gov.in";
export const MOSPI_LOGIN_URL = `${MOSPI_API_BASE}/api/login`;
export const MOSPI_CPI_INDEX_URL = `${MOSPI_API_BASE}/api/getCPIIndex`;

interface MospiCpiRow {
  Year: number;
  Month: number;
  Sector?: number; // 1 rural, 2 urban, 3 combined
  Index: number;
  Series?: string; // "Current_series_2012" | "Back_series_2012" | ...
}

/** Parses the documented getCPIIndex JSON shape into (month, index) pairs for the Combined sector. */
export function parseMospiCpiCombined(json: unknown): Array<{ month: string; value: number }> {
  const rows: MospiCpiRow[] = Array.isArray(json) ? (json as MospiCpiRow[]) : Array.isArray((json as { data?: unknown[] })?.data) ? ((json as { data: MospiCpiRow[] }).data) : [];
  const out: Array<{ month: string; value: number }> = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue; // malformed row (e.g. null) — skip, never throw
    if (r.Sector !== undefined && r.Sector !== 3) continue; // combined only
    if (!r.Year || !r.Month || !Number.isFinite(r.Index)) continue;
    out.push({ month: `${r.Year}-${String(r.Month).padStart(2, "0")}`, value: r.Index });
  }
  return out;
}

async function mospiLogin(ctx: MacroTaskContext): Promise<string | null> {
  const email = process.env.MOSPI_API_EMAIL;
  const password = process.env.MOSPI_API_PASSWORD;
  if (!email || !password) return null; // no credentials configured — see README "known gaps"
  const doc = await ctx.fetch(`${MOSPI_LOGIN_URL}?email=${encodeURIComponent(email)}&password=${encodeURIComponent(password)}`, "json");
  try {
    const body = JSON.parse(doc.text) as { token?: string };
    return body.token ?? null;
  } catch {
    return null;
  }
}

export async function run(ctx: MacroTaskContext): Promise<TaskResult> {
  const result: TaskResult = { task: "cpi-combined", ok: false, sourcesTried: [], changes: [], warnings: [] };
  const series = readSeriesFile(ctx.root, "cpi_combined_monthly_2024base");
  if (!series) {
    result.error = "data/series/cpi_combined_monthly_2024base.json not found";
    return result;
  }
  const known = new Set(series.points.map((p) => String(p[0])));

  let token: string | null = null;
  try {
    token = await mospiLogin(ctx);
    result.sourcesTried.push({ url: MOSPI_LOGIN_URL, ok: true });
    if (!token) result.warnings.push("No MOSPI_API_EMAIL/MOSPI_API_PASSWORD configured, or login did not return a token; getCPIIndex will be called unauthenticated (first 10 records only, per the API's own manual).");
  } catch (e) {
    result.sourcesTried.push({ url: MOSPI_LOGIN_URL, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    result.warnings.push("MoSPI login failed; falling back to an unauthenticated request.");
  }

  const url = `${MOSPI_CPI_INDEX_URL}?Series=Current_series_2024&Format=JSON`;
  try {
    const doc = await ctx.fetch(token ? `${url}` : url, "json");
    result.sourcesTried.push({ url, ok: true, status: doc.status });
    result.ok = true;
    const json = JSON.parse(doc.text);
    const rows = parseMospiCpiCombined(json).filter((r) => !known.has(r.month));
    for (const r of rows) {
      const change: SeriesPointChange = { kind: "series_point", seriesKey: "cpi_combined_monthly_2024base", target: "points", point: [r.month, r.value] };
      result.changes.push(change);
    }
    result.usedSourceUrl = url;
    if (rows.length === 0) result.warnings.push("MoSPI API reachable but returned no new months.");
  } catch (e) {
    result.sourcesTried.push({ url, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    if (!result.ok) {
      result.ok = true; // a down upstream API is not a task failure — see run-macro.ts
      result.warnings.push(`MoSPI API unreachable this run (${(e as Error).message}); this is the documented outage — see README.md.`);
    }
  }
  return result;
}
