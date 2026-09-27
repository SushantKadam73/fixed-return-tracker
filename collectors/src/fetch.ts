/**
 * Polite HTTP client for official sources: browser-like headers, timeouts, bounded retries
 * with backoff, and PDF text extraction. A real browser (Playwright) is used only for
 * sources marked `browser`, and only where it is installed (GitHub Actions / VPS).
 */
import type { FetchedDoc, SourceFormat } from "./types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 FixedReturnTracker/1.0 (+https://github.com/SushantKadam73/fixed-return-tracker)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastHit = new Map<string, number>();

async function politeWait(url: string, gapMs = 1500) {
  const host = new URL(url).host;
  const last = lastHit.get(host) ?? 0;
  const wait = last + gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
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

async function browserFetch(url: string): Promise<FetchedDoc> {
  // Optional dependency: installed only on runners that need it.
  // Minimal structural type so the project compiles without Playwright installed.
  type Page = { goto(url: string, o: { waitUntil: string; timeout: number }): Promise<{ status(): number } | null>; content(): Promise<string>; url(): string };
  type Browser = { newPage(o: { userAgent: string; locale: string }): Promise<Page>; close(): Promise<void> };
  const mod = "playwright";
  const { chromium } = (await import(/* webpackIgnore: true */ mod)) as { chromium: { launch(o: { headless: boolean }): Promise<Browser> } };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA, locale: "en-IN" });
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    const html = await page.content();
    return { url, finalUrl: page.url(), status: res?.status() ?? 0, contentType: "text/html", text: html, fetchedAt: Date.now() };
  } finally {
    await browser.close();
  }
}

export async function fetchDoc(url: string, format: SourceFormat = "html", attempts = 3): Promise<FetchedDoc> {
  if (format === "browser") return browserFetch(url);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      await politeWait(url);
      const res = await fetch(url, {
        headers: {
          "user-agent": UA,
          accept: format === "pdf" ? "application/pdf,*/*" : "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
          "accept-language": "en-IN,en;q=0.9",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(45_000),
      });
      const contentType = res.headers.get("content-type") ?? "";
      if (res.status === 429 || res.status >= 500) throw new FetchError(`HTTP ${res.status}`, res.status);
      if (!res.ok) {
        // 4xx is not retried: blocked or moved pages need attention, not hammering.
        throw Object.assign(new FetchError(`HTTP ${res.status}`, res.status), { final: true });
      }
      const isPdf = format === "pdf" || contentType.includes("pdf");
      const text = isPdf ? await pdfToText(await res.arrayBuffer()) : await res.text();
      return { url, finalUrl: res.url, status: res.status, contentType, text, fetchedAt: Date.now() };
    } catch (e) {
      lastErr = e;
      if ((e as { final?: boolean }).final) break;
      await sleep(2000 * 2 ** i);
    }
  }
  throw lastErr instanceof Error ? lastErr : new FetchError(String(lastErr));
}
