/**
 * Internet Archive helpers: CDX discovery and snapshot fetching with a polite rate limit and
 * a local cache (raw copies stay in /agent/workspace/private — never committed).
 *
 * The rate limit is shared by every process using the same cache directory (a lock directory
 * plus a "last request" file), so several backfill jobs running in parallel still reach the
 * archive at most once per WAYBACK_GAP_MS between them. A 429/5xx from the archive makes all
 * of them back off together.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const UA = "FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker; historical deposit-rate research)";
export const CACHE_DIR = process.env.WAYBACK_CACHE ?? path.resolve(process.cwd(), "..", "private", "wayback");
const GAP_MS = Number(process.env.WAYBACK_GAP_MS ?? 3000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LOCK = path.join(CACHE_DIR, ".throttle.lock");
const LAST = path.join(CACHE_DIR, ".throttle.last");
const BACKOFF = path.join(CACHE_DIR, ".throttle.backoff");

let fetchCount = 0;
/** Number of archive requests this process has made (for efficiency reporting). */
export const archiveRequests = () => fetchCount;

function readNum(file: string): number {
  try {
    return Number(readFileSync(file, "utf8")) || 0;
  } catch {
    return 0;
  }
}

async function withLock<T>(fn: () => T): Promise<T> {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 30_000) rmSync(LOCK, { recursive: true, force: true }); // stale lock
      } catch {
        /* lock vanished between calls */
      }
      await sleep(100 + Math.random() * 200);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
  }
}

/** Wait for this process's turn under the shared rate limit. */
async function acquireSlot(): Promise<void> {
  for (;;) {
    const wait = await withLock(() => {
      const next = Math.max(readNum(LAST) + GAP_MS, readNum(BACKOFF));
      const now = Date.now();
      if (next <= now) {
        writeFileSync(LAST, String(now));
        return 0;
      }
      return next - now;
    });
    if (wait === 0) return;
    await sleep(Math.min(wait, 5_000) + Math.random() * 100);
  }
}

async function backOffAll(ms: number) {
  await withLock(() => {
    const until = Date.now() + ms;
    if (until > readNum(BACKOFF)) writeFileSync(BACKOFF, String(until));
  });
}

async function politeGet(url: string, attempts = 4): Promise<Response> {
  let err: unknown;
  for (let i = 0; i < attempts; i++) {
    await acquireSlot();
    fetchCount++;
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(90_000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      err = e;
      // Back off hard (and make every parallel job back off too): the archive is a shared public resource.
      await backOffAll(30_000 * (i + 1));
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

/** Monthly captures (HTTP 200 only) of an exact URL, oldest first. */
export async function monthlyCaptures(url: string, from = "1996", to = "2026"): Promise<Capture[]> {
  const caps = await cdx({ url, from, to, filter: "statuscode:200", collapse: "timestamp:6" });
  return caps.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
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

const validDigest = (d: string | undefined): d is string => !!d && /^[A-Z2-7]{32}$/.test(d);

/**
 * Original bytes of a capture (id_ mode = no archive toolbar), cached on disk by timestamp and,
 * when the CDX digest is known, by content digest (identical content is fetched only once).
 */
export async function snapshot(c: Pick<Capture, "timestamp" | "original"> & { digest?: string }): Promise<{ html: string; archiveUrl: string }> {
  const archiveUrl = `https://web.archive.org/web/${c.timestamp}id_/${c.original}`;
  const safe = c.original.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 150);
  const file = path.join(CACHE_DIR, safe, `${c.timestamp}.html`);
  const byDigest = validDigest(c.digest) ? path.join(CACHE_DIR, "_by_digest", `${c.digest}.html`) : null;
  if (existsSync(file)) return { html: readFileSync(file, "utf8"), archiveUrl };
  if (byDigest && existsSync(byDigest)) return { html: readFileSync(byDigest, "utf8"), archiveUrl };
  const res = await politeGet(archiveUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  // Old Indian bank pages were often windows-1252 / ISO-8859-1; decode leniently.
  const html = /pdf/i.test(type) ? buf.toString("latin1") : new TextDecoder(/charset=utf-?8/i.test(type) ? "utf-8" : "latin1").decode(buf);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, html);
  if (byDigest) {
    mkdirSync(path.dirname(byDigest), { recursive: true });
    writeFileSync(byDigest, html);
  }
  return { html, archiveUrl };
}

export function tsToDate(ts: string): string {
  return `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
}
