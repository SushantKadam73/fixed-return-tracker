/**
 * Polite HTTP client for official sources: browser-like headers, timeouts, bounded retries
 * with backoff, and PDF text extraction. A real browser (Playwright) is used only for
 * sources marked `browser`, and only where it is installed (GitHub Actions / VPS).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";
import type { FetchedDoc, FetchInit, SourceFormat } from "./types";

/**
 * Plain browser User-Agent without our identifying token, for the few official sites whose
 * firewall silently drops unknown client tokens (opted into per source with userAgent: "browser",
 * always with the reason in the source's notes).
 */
export const PLAIN_BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map<string, number>();

async function politeWait(url: string, gapMs = 2000) {
  const host = new URL(url).host;
  const last = lastHit.get(host) ?? 0;
  const wait = last + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** Bot-protection interstitials that return HTTP 200 but no real content. */
export function detectChallenge(html: string): string | null {
  const head = html.slice(0, 20_000).toLowerCase();
  const markers: Array<[RegExp, string]> = [
    [/shieldsquare|radware|perfdrive/, "Radware/ShieldSquare bot protection"],
    [/cf-challenge|cf_chl_|challenge-platform|just a moment\.\.\./, "Cloudflare challenge"],
    [/<title>\s*access denied\s*<\/title>|errors\.edgesuite\.net/, "Akamai access denied"],
    [/h-captcha|hcaptcha\.com|g-recaptcha|recaptcha\/api/, "captcha"],
  ];
  for (const [re, label] of markers) if (re.test(head)) return label;
  return null;
}

export class FetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function pdfToText(bytes: ArrayBuffer): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

const MAX_BYTES = 15 * 1024 * 1024;
const documents = new Map<string, Promise<FetchedDoc>>();
const cacheDir = process.env.COLLECTOR_CACHE_DIR ?? path.join(process.cwd(), ".collector-cache");
let browser: Browser | undefined;
let requests = 0;
const startedAt = Date.now();
const deadlineMs = Math.min(40 * 60_000, Number(process.env.COLLECTOR_MAX_RUN_MS) || 30 * 60_000);
const originFailures = new Map<string, number>();

export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close();
  browser = undefined;
}

async function browserFetch(url: string, init?: FetchInit): Promise<FetchedDoc> {
  if (!browser) {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
  }
  const page = await browser.newPage({ userAgent: init?.headers?.["user-agent"] ?? UA, locale: "en-IN" });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const status = response?.status() ?? 0;
    if (status < 200 || status >= 300) throw Object.assign(new FetchError(`HTTP ${status}`, status), { final: status < 500 && status !== 429 });
    // A normal product-tab interaction; never attempt to solve a captcha or access-denial page.
    const challenge = detectChallenge(await page.content());
    if (challenge) throw Object.assign(new FetchError(`blocked by ${challenge}`, status), { final: true });
    if (init?.browser?.clickText) await page.getByText(init.browser.clickText, { exact: true }).first().click({ timeout: 15_000 });
    await page.waitForSelector(init?.browser?.waitForSelector ?? "table", { timeout: 20_000 });
    const text = await page.content();
    if (Buffer.byteLength(text) > MAX_BYTES) throw Object.assign(new FetchError("Browser response exceeds 15 MB"), { final: true });
    return { url, finalUrl: page.url(), status, contentType: "text/html", text, fetchedAt: Date.now() };
  } finally { await page.close(); }
}

async function bytesBounded(response: Response): Promise<ArrayBuffer> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) throw Object.assign(new FetchError("Response exceeds 15 MB"), { final: true });
  const reader = response.body?.getReader();
  if (!reader) throw new FetchError("Empty response body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) { await reader.cancel(); throw Object.assign(new FetchError("Response exceeds 15 MB"), { final: true }); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes.buffer;
}

interface CachedDoc { doc: FetchedDoc; etag?: string; lastModified?: string }

export function fetchDoc(url: string, format: SourceFormat = "html", attempts = 3, init?: FetchInit): Promise<FetchedDoc> {
  const sensitive = init?.method === "POST" || Object.keys(init?.headers ?? {}).some((header) => /authorization|cookie/i.test(header));
  const key = createHash("sha256").update(JSON.stringify({ url, format, init })).digest("hex");
  if (!sensitive && documents.has(key)) return documents.get(key)!;
  const operation = fetchDocument(url, format, Math.min(3, Math.max(1, attempts)), init, sensitive ? null : key);
  if (!sensitive) documents.set(key, operation);
  return operation;
}

async function fetchDocument(url: string, format: SourceFormat, attempts: number, init: FetchInit | undefined, cacheKey: string | null): Promise<FetchedDoc> {
  const file = cacheKey && format !== "browser" ? path.join(cacheDir, `${cacheKey}.json`) : null;
  let cached: CachedDoc | null = null;
  if (file && existsSync(file)) { try { cached = JSON.parse(readFileSync(file, "utf8")) as CachedDoc; } catch { /* invalid local cache: request a full response */ } }
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    let retryMs = 2000 * 2 ** i + Math.random() * 500;
    const origin = new URL(url).origin;
    try {
      if (Date.now() - startedAt > deadlineMs) throw Object.assign(new FetchError("Collector time budget exhausted; defer remaining sources"), { final: true });
      if ((originFailures.get(origin) ?? 0) >= 3) throw Object.assign(new FetchError("Origin circuit is open after repeated transient failures; retry in the next run"), { final: true });
      if (++requests > 350) throw Object.assign(new FetchError("Collector request budget exhausted (350 attempts/run)"), { final: true });
      await politeWait(url);
      if (format === "browser") {
        const document = await browserFetch(url, init);
        originFailures.delete(origin);
        return document;
      }
      const response = await fetch(url, {
        method: init?.method ?? "GET", body: init?.body,
        headers: {
          "user-agent": UA, accept: format === "pdf" ? "application/pdf,*/*" : "text/html,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-IN,en;q=0.9", ...(init?.body ? { "content-type": "application/json" } : {}),
          ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
          ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}), ...init?.headers,
        }, redirect: "follow", signal: AbortSignal.timeout(45_000),
      });
      if (response.status === 304 && cached) return { ...cached.doc, fetchedAt: Date.now() };
      if (!response.ok) {
        const after = response.headers.get("retry-after");
        if (after) retryMs = Math.min(30_000, Math.max(retryMs, /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - Date.now()));
        throw Object.assign(new FetchError(`HTTP ${response.status}`, response.status), { final: response.status < 500 && response.status !== 429 });
      }
      const contentType = response.headers.get("content-type") ?? "";
      const bytes = await bytesBounded(response);
      const isPdf = format === "pdf" || contentType.includes("pdf");
      const text = isPdf ? await pdfToText(bytes) : new TextDecoder().decode(bytes);
      const challenge = isPdf ? null : detectChallenge(text);
      if (challenge) throw Object.assign(new FetchError(`blocked by ${challenge}`, response.status), { final: true });
      const doc = { url, finalUrl: response.url, status: response.status, contentType, text, fetchedAt: Date.now() };
      if (file) {
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(file, JSON.stringify({ doc, etag: response.headers.get("etag") ?? undefined, lastModified: response.headers.get("last-modified") ?? undefined }));
      }
      originFailures.delete(origin);
      return doc;
    } catch (error) {
      lastErr = error;
      const status = (error as { status?: number }).status;
      if (status === 429 || (status !== undefined && status >= 500) || (error instanceof TypeError && error.message === "fetch failed")) originFailures.set(origin, (originFailures.get(origin) ?? 0) + 1);
      if ((error as { final?: boolean }).final) break;
      if (i + 1 < attempts) await sleep(retryMs);
    }
  }
  throw lastErr instanceof Error ? lastErr : new FetchError(String(lastErr));
}
