import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { idfcFirstBulk, idfcFirstFd, idfcFirstSavings } from "../../src/adapters/idfc-first-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXTURES = path.join(__dirname, "..", "..", "fixtures");
const INDEX_URL = "https://www.idfcfirst.bank.in/interest-rate";

/** IDFC FIRST's rate tables are all PDFs whose current link must be discovered from the
 * "Interest Rates" index page each run (see adapter file header) — so, like ICICI, the test
 * context needs a working `ctx.fetch` that serves the right PDF-text fixture per URL. */
function ctxFromIndex(key: string, pdfFixtureByKeyword: Record<string, string>): AdapterContext {
  const html = readFileSync(path.join(FIXTURES, "idfc-first-bank/index.html"), "utf8");
  const src: SourceDef = { key, bankSlug: "idfc-first-bank", products: [], url: INDEX_URL, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
  return {
    source: src,
    today: "2026-09-27",
    doc: { url: INDEX_URL, finalUrl: INDEX_URL, status: 200, contentType: "text/html", text: html, fetchedAt: Date.now() },
    fetch: async (url, format): Promise<FetchedDoc> => {
      const hit = Object.entries(pdfFixtureByKeyword).find(([kw]) => url.includes(kw));
      if (!hit) throw new Error(`unexpected fetch in test: ${url}`);
      return { url, finalUrl: url, status: 200, contentType: format === "pdf" ? "application/pdf" : "text/plain", text: readFileSync(path.join(FIXTURES, hit[1]), "utf8"), fetchedAt: Date.now() };
    },
  };
}

describe("IDFC FIRST Bank adapter", () => {
  it("discovers the current retail PDF and reads FD + Tax Saver + Green Deposit + RD from it", async () => {
    const ctx = ctxFromIndex("idfc-first-bank:fd", { "Retail-Deposits": "idfc-first-bank/retail.txt" });
    const out = await idfcFirstFd(ctx);
    const fd = out.cards.find((c) => c.product === "fd")!;
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(fd.effectiveFrom).toBe("2026-09-01");
    expect(fd.sourceUrl).toContain("Retail-Deposits-1st-September-2026.pdf");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.25); // 7 - 29 days
    expect(rateForTenure(fd.rows, 500, g)?.rate).toBe(7.1); // 500 days - 3 years
    expect(rateForTenure(fd.rows, 500, s)?.rate).toBe(7.35);
    const taxSaver = fd.rows.find((r) => r.schemeName?.includes("Tax Saver"));
    expect(taxSaver?.tenureMinDays).toBe(1825);
    const green = fd.rows.find((r) => r.schemeName?.includes("Green") && r.customer === "general");
    expect(green?.tenureMinDays).toBe(375);
    expect(green?.rate).toBe(7.0);

    expect(rd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 730, g)?.rate).toBe(7.1); // 24 months, not derived from FD
    expect(rateForTenure(rd.rows, 730, s)?.rate).toBe(7.35);
  });

  it("discovers the current bulk PDF and reads the ₹3-27.50 crore card (callable + non-callable)", async () => {
    const ctx = ctxFromIndex("idfc-first-bank:bulk", { "deposits-Rs-3-crs-and-above": "idfc-first-bank/bulk.txt" });
    const out = await idfcFirstBulk(ctx);
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-09-09");
    expect(hasErrors(validateCard(c))).toBe(false);
    expect(rateForTenure(c.rows, 370, { amount: 4e7, customer: "general", callable: false })?.rate).toBe(6.5);
    expect(rateForTenure(c.rows, 370, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(6.0);
    expect(rateForTenure(c.rows, 370, { amount: 6e7, customer: "general", callable: false })?.rate).toBe(6.5);
    expect(rateForTenure(c.rows, 370, { amount: 2e10, customer: "general", callable: false })).toBeNull(); // > ₹27.5cr, out of scope
  });

  it("discovers the current savings PDF and reads incremental slabs from the bank's own worked example", async () => {
    const ctx = ctxFromIndex("idfc-first-bank:savings", { "Savings-Deposits-wef1st-Sep-2026": "idfc-first-bank/savings.txt" });
    const out = await idfcFirstSavings(ctx);
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-01");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 300001, rate: 2.5, residency: "resident" },
      { balanceMin: 300001, balanceMax: 2500001, rate: 7.0, residency: "resident" },
      { balanceMin: 2500001, balanceMax: 50000001, rate: 6.25, residency: "resident" },
      { balanceMin: 50000001, balanceMax: null, rate: 5.0, residency: "resident" },
    ]);
  });
});
