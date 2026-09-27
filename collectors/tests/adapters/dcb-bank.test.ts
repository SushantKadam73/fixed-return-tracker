import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dcbBulk, dcbFd, dcbSavings } from "../../src/adapters/dcb-bank";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";

const FIXDIR = path.join(__dirname, "..", "..", "fixtures", "dcb-bank");
const read = (name: string) => readFileSync(path.join(FIXDIR, name), "utf8");

/**
 * The DCB rates page is a client-rendered shell (see the adapter's file header); its content
 * comes from three chained same-origin JSON POSTs. This context serves canned fixtures keyed by
 * the POST body's own `url` field (the interceptor's real URL is always the same
 * "/api/api-interceptor" regardless of which virtual path is requested).
 */
function ctx(page: "fd" | "savings"): AdapterContext {
  const url = page === "fd" ? "https://www.dcb.bank.in/rates/fixed-deposit-interest-rate" : "https://www.dcb.bank.in/rates/savings-account-interest-rates";
  const src: SourceDef = { key: `dcb-bank:${page}`, bankSlug: "dcb-bank", products: [], url, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
  return {
    source: src,
    today: "2026-09-27",
    doc: { url, finalUrl: url, status: 200, contentType: "text/html", text: "<html><body></body></html>", fetchedAt: Date.now() },
    fetch: async (fetchUrl: string, _format, init): Promise<FetchedDoc> => {
      if (!init?.body) throw new Error(`unexpected fetch (expected a POST body): ${fetchUrl}`);
      const body = JSON.parse(init.body) as { url: string };
      let file: string;
      if (body.url.includes("rates-sub-nav")) file = page === "fd" ? "sub-nav-fd.json" : "sub-nav-savings.json";
      else if (body.url.includes("/rates?id=")) file = page === "fd" ? "rates-fd.json" : "rates-savings.json";
      else throw new Error(`unexpected virtual path in test: ${body.url}`);
      return { url: fetchUrl, finalUrl: fetchUrl, status: 200, contentType: "application/json", text: read(file), fetchedAt: Date.now() };
    },
  };
}

const CRORE = 1e7;

describe("DCB Bank adapter", () => {
  it("reads the retail FD card (General/Senior/Senior-Plus, ignoring the Yield columns) plus the non-callable >1cr-<3cr rows", async () => {
    const out = await dcbFd(ctx("fd"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-08-04");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    const sp = { amount: 1_00_000, customer: "super_senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.75); // 7-45 days
    expect(rateForTenure(fd.rows, 10, s)?.rate).toBe(4.0);
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.9); // 12 to <15 months
    // "24 months to less than 25 months" carries a "Highest" badge glued onto the rate cell
    // ("7.50%Highest") — stripped so it doesn't break parseRate.
    const highest = rateForTenure(fd.rows, 740, g);
    expect(highest?.rate).toBe(7.5);
    expect(highest?.special).toBeUndefined(); // 730-759 day range, not a single point tenure
    expect(rateForTenure(fd.rows, 740, s)?.rate).toBe(8.0);
    expect(rateForTenure(fd.rows, 740, sp)?.rate).toBe(8.05);
    expect(rateForTenure(fd.rows, 2000, g)?.rate).toBe(7); // "More than 61 months to 120 months"

    // Non-callable >₹1cr-<₹3cr, general only, no senior column.
    const ncGeneral = { amount: 1.5 * CRORE, customer: "general" as const };
    const ncRow = rateForTenure(fd.rows, 400, ncGeneral); // "12 months to less than 15 months"
    expect(ncRow?.rate).toBe(7.45);
    expect(ncRow?.callable).toBe(false);
    expect(rateForTenure(fd.rows, 400, { amount: 1.5 * CRORE, customer: "senior", callable: false })).toBeNull();
  });

  it("reads all four published bulk bands (₹10-<20cr is absent on the bank's own page, not a gap in parsing)", async () => {
    const out = await dcbBulk(ctx("fd"));
    const bulk = out.cards[0];
    expect(bulk.product).toBe("fd_bulk");
    expect(bulk.effectiveFrom).toBe("2026-09-25"); // latest of the four bands' own dates
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "general", callable: true })?.rate).toBe(3); // ₹3-<5cr, 7-14 days
    expect(rateForTenure(bulk.rows, 95, { amount: 4 * CRORE, customer: "general", callable: false })?.rate).toBe(6); // ₹3-<5cr non-callable, 91-119 days
    expect(rateForTenure(bulk.rows, 91, { amount: 6 * CRORE, customer: "general", callable: true })?.rate).toBe(6.65); // ₹5-<10cr, single-day "91 days"
    expect(rateForTenure(bulk.rows, 10, { amount: 2 * CRORE, customer: "general" })).toBeNull(); // below ₹3cr: not a bulk band
    // The ₹10-<20cr gap: neither side of it is offered here.
    expect(rateForTenure(bulk.rows, 10, { amount: 1.5 * CRORE * 10, customer: "general" })).toBeNull();
    // ₹50cr and above (open-ended).
    expect(rateForTenure(bulk.rows, 10, { amount: 100 * CRORE, customer: "general", callable: true })?.rate).toBe(3);
    expect(rateForTenure(bulk.rows, 10, { amount: 100 * CRORE, customer: "general", callable: false })).toBeNull(); // "-" in the source
  });

  it("reads the savings slabs", async () => {
    const out = await dcbSavings(ctx("savings"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-03-06");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toHaveLength(9);
    expect(card.savingsSlabs?.[0]).toMatchObject({ balanceMin: 0, balanceMax: 1_00_001, rate: 1.5 });
    expect(card.savingsSlabs?.at(-1)).toEqual({ balanceMin: 300 * CRORE, balanceMax: null, rate: 5.5, residency: "resident" });
  });
});
