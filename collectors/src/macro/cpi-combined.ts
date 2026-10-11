/** CPI Combined: a failed or empty response never advances verification. */
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
    if (!Number.isInteger(r.Year) || !Number.isInteger(r.Month) || r.Month < 1 || r.Month > 12 || !Number.isFinite(r.Index) || r.Index <= 0) continue;
    if (r.Series && !/2024/.test(r.Series)) continue;
    out.push({ month: `${r.Year}-${String(r.Month).padStart(2, "0")}`, value: r.Index });
  }
  return out;
}

async function mospiLogin(ctx: MacroTaskContext): Promise<string | null> {
  const email = process.env.MOSPI_API_EMAIL;
  const password = process.env.MOSPI_API_PASSWORD;
  if (!email || !password) return null; // no credentials configured — see README "known gaps"
  const doc = await ctx.fetch(MOSPI_LOGIN_URL, "json", { method: "POST", body: JSON.stringify({ email, password }) });
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
  const known = new Map(series.points.map((p) => [String(p[0]), Number(p[1])]));

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
    const doc = await ctx.fetch(url, "json", token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
    result.sourcesTried.push({ url, ok: true, status: doc.status });
    const json = JSON.parse(doc.text);
    const parsed = parseMospiCpiCombined(json);
    if (parsed.length === 0) throw new Error("MoSPI response contained no valid CPI Combined 2024-base observations");
    result.ok = true;
    const rows = parsed.filter((r) => known.get(r.month) !== r.value && r.month <= ctx.today.slice(0, 7));
    for (const r of rows) {
      const change: SeriesPointChange = { kind: "series_point", seriesKey: "cpi_combined_monthly_2024base", target: "points", point: [r.month, r.value] };
      result.changes.push(change);
    }
    result.usedSourceUrl = url;
    if (rows.length === 0) result.warnings.push("MoSPI API reachable but returned no new months.");
  } catch (e) {
    result.sourcesTried.push({ url, ok: false, status: (e as { status?: number }).status, error: (e as Error).message });
    result.ok = false;
    result.error = `MoSPI CPI collection failed: ${(e as Error).message}`;
  }
  return result;
}
