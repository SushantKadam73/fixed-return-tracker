/**
 * Internet Archive helpers: CDX discovery and snapshot fetching with a polite rate limit and
 * a local cache (raw copies stay in /agent/workspace/private — never committed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const UA = "FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker; historical deposit-rate research)";
export const CACHE_DIR = process.env.WAYBACK_CACHE ?? path.resolve(process.cwd(), "..", "private", "wayback");
const GAP_MS = Number(process.env.WAYBACK_GAP_MS ?? 3000);
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function politeGet(url: string, attempts = 4): Promise<Response> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    const wait = last + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      err = e;
      await sleep(30_000 * (i + 1)); // back off hard: the archive is a shared public resource
    }
  }
  throw err instanceof Error ? err : new Error(String(err));
}

export interface Capture {
  timestamp: string; // YYYYMMDDhhmmss
  original: string;
  status: string;
  digest: string;
}

/** CDX query; returns captures (optionally one per month). */
export async function cdx(params: Record<string, string>): Promise<Capture[]> {
  const qs = new URLSearchParams({ output: "json", fl: "timestamp,original,statuscode,digest", ...params });
  const res = await politeGet(`https://web.archive.org/cdx/search/cdx?${qs}`);
  const text = await res.text();
  if (!text.trim().startsWith("[")) return [];
  const rows = JSON.parse(text) as string[][];
  return rows.slice(1).map(([timestamp, original, status, digest]) => ({ timestamp, original, status, digest }));
}

/** Monthly captures (HTTP 200 only) of an exact URL. */
export async function monthlyCaptures(url: string, from = "1996", to = "2026"): Promise<Capture[]> {
  const caps = await cdx({ url, from, to, filter: "statuscode:200", collapse: "timestamp:6" });
  return caps;
}

/** Candidate URLs under a domain whose path suggests deposit or interest-rate content. */
export async function discoverRateUrls(domain: string, limit = 2000): Promise<Array<{ url: string; first: string; last: string; count: number }>> {
  const caps = await cdx({ url: `${domain}/*`, filter: "original:.*(interest|deposit|rate|fd|term|saving).*", collapse: "urlkey", limit: String(limit), fl: "timestamp,original,statuscode,digest" });
  const by = new Map<string, { url: string; first: string; last: string; count: number }>();
  for (const c of caps) {
    const key = c.original.replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "");
    const e = by.get(key) ?? { url: c.original, first: c.timestamp, last: c.timestamp, count: 0 };
    e.first = e.first < c.timestamp ? e.first : c.timestamp;
    e.last = e.last > c.timestamp ? e.last : c.timestamp;
    e.count++;
    by.set(key, e);
  }
  return [...by.values()].sort((a, b) => a.first.localeCompare(b.first));
}

/** Original HTML of a capture (id_ mode = no archive toolbar), cached on disk. */
export async function snapshot(c: Pick<Capture, "timestamp" | "original">): Promise<{ html: string; archiveUrl: string }> {
  const archiveUrl = `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;
  const safe = c.original.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 150);
  const file = path.join(CACHE_DIR, safe, `${c.timestamp}.html`);
  if (existsSync(file)) return { html: readFileSync(file, "utf8"), archiveUrl };
  const res = await politeGet(archiveUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  // Old Indian bank pages were often windows-1252 / ISO-8859-1; decode leniently.
  const html = new TextDecoder(/charset=utf-?8/i.test(res.headers.get("content-type") ?? "") ? "utf-8" : "latin1").decode(buf);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  return { html, archiveUrl };
}

export function tsToDate(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
