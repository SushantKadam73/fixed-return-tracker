import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { unityBulk, unityFd, unityHistory, unitySavings } from "../../src/adapters/unity-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceFormat } from "../../src/types";

const FIXTURE_DIR = path.join(__dirname, "..", "..", "fixtures");
const read = (rel: string) => readFileSync(path.join(FIXTURE_DIR, rel), "utf8");

const ARCHIVE_FIXTURES: Record<string, string> = {
  "https://unity.bank.in/docs/policies/website-disclosure-effective-02-july-2026.pdf": "unity-sfb/disclosure-jul2026.txt",
  "https://unity.bank.in/docs/policies/website-disclosure-effective-13-april-2026.pdf": "unity-sfb/disclosure-apr2026.txt",
};

async function fakeFetch(url: string, format?: SourceFormat): Promise<FetchedDoc> {
  const rel = ARCHIVE_FIXTURES[url];
  if (!rel) throw new Error(`fixture not mocked for ${url}`);
  return { url, finalUrl: url, status: 200, contentType: format === "pdf" ? "application/pdf" : "text/html", text: read(rel), fetchedAt: Date.now() };
}

const FD_PAGE_URL = "https://unity.bank.in/personal-banking/deposits/fixed-deposit";

function ctx(): AdapterContext {
  const text = read("unity-sfb/fd-product-page.html");
  return {
    source: { key: "unity-sfb:fd", bankSlug: "unity-sfb", products: [], url: FD_PAGE_URL, format: "html", runner: "github", adapter: "", cadence: "daily", active: true },
    doc: { url: FD_PAGE_URL, finalUrl: FD_PAGE_URL, status: 200, contentType: "text/html", text, fetchedAt: Date.now() },
    today: "2026-09-27",
    fetch: fakeFetch,
  };
}

const g = { amount: 1_00_000, customer: "general" as const };
const s = { amount: 1_00_000, customer: "senior" as const };

describe("Unity SFB adapter", () => {
  it("discovers the current dated disclosure PDF from the stable FD page and reads its FD section", async () => {
    const out = await unityFd(ctx());
    const fd = out.cards[0];
    expect(fd.sourceUrl).toBe("https://unity.bank.in/docs/policies/website-disclosure-effective-02-july-2026.pdf");
    expect(fd.effectiveFrom).toBe("2026-06-11");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(rateForTenure(fd.rows, 501, g)?.rate).toBe(7.8); // named special tenure
    expect(rateForTenure(fd.rows, 501, s)?.rate).toBe(8.3);
    expect(rateForTenure(fd.rows, 501, g)?.special).toBe(true);
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(7.5); // exact "12 Months" promo point
    // The "12 Months - 1 Day" duplicate-artifact line must not appear as its own row.
    expect(fd.rows.some((r) => /12 months.*1 day$/i.test(r.tenureLabel))).toBe(false);
  });

  it("reads the savings section as slabMethod unknown (not stated by the PDF)", async () => {
    const out = await unitySavings(ctx());
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2025-08-19");
    expect(card.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 4.5, residency: "resident", note: "Upto 1 lakh" },
      { balanceMin: 100001, balanceMax: 1000001, rate: 6, residency: "resident", note: ">1 lakh-10 lakh" },
      { balanceMin: 1000001, balanceMax: null, rate: 7, residency: "resident", note: ">10 lakh" },
    ]);
  });

  it("reads callable + non-callable bulk bands and derives the callable senior rate from the bank's own +50bps statement", async () => {
    const out = await unityBulk(ctx());
    const bulk = out.cards[0];
    expect(bulk.product).toBe("fd_bulk");
    expect(bulk.effectiveFrom).toBe("2026-07-02");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    const band5to10crCallableGeneral = { amount: 6 * 1e7, customer: "general" as const, callable: true as const };
    expect(rateForTenure(bulk.rows, 70, band5to10crCallableGeneral)?.rate).toBe(6.5); // 61-90 days, >=5cr-<10cr band
    expect(rateForTenure(bulk.rows, 70, { ...band5to10crCallableGeneral, customer: "senior" })?.rate).toBe(7.0); // +0.50 derived
    expect(rateForTenure(bulk.rows, 70, { ...band5to10crCallableGeneral, customer: "senior", callable: false })).toBeNull(); // no senior for non-callable
    expect(bulk.notes?.some((n) => /derived: general\+0\.50%/i.test(n) || /50 bps more/i.test(n))).toBe(true);
  });

  it("unityHistory reads every dated disclosure PDF it can reach as bank_archive cards", async () => {
    const out = await unityHistory(ctx());
    expect(out.cards.length).toBe(6); // 2 dated PDFs x (fd, savings, fd_bulk)
    expect(out.cards.every((c) => c.sourceType === "bank_archive")).toBe(true);
    expect(out.cards.every((c) => hasErrors(validateCard(c)) === false)).toBe(true);
    const urls = new Set(out.cards.map((c) => c.sourceUrl));
    expect(urls).toEqual(new Set(Object.keys(ARCHIVE_FIXTURES)));
    const aprFd = out.cards.find((c) => c.product === "fd" && c.sourceUrl.includes("13-april-2026"))!;
    expect(aprFd.effectiveFrom).toBe("2026-02-09");
    const julFd = out.cards.find((c) => c.product === "fd" && c.sourceUrl.includes("02-july-2026"))!;
    expect(julFd.effectiveFrom).toBe("2026-06-11");
  });
});
