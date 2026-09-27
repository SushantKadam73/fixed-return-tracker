import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { axisBulk, axisFd, axisRd, axisSavings } from "../../src/adapters/axis-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXDIR = path.join(__dirname, "..", "..", "fixtures", "axis-bank");
const read = (name: string) => readFileSync(path.join(FIXDIR, name), "utf8");

/**
 * Axis's retail/bulk FD tables live in a PDF discovered from the HTML index page, so this
 * context's `fetch` returns the saved PDF-text fixture for any URL the adapter asks for
 * (the discovered link itself is asserted separately below).
 */
function ctx(url: string, htmlFixture: string, pdfFixture?: string): AdapterContext {
  const source: SourceDef = { key: "axis-bank:try", bankSlug: "axis-bank", products: [], url, format: "html", runner: "github", adapter: "", cadence: "daily", active: true };
  const doc: FetchedDoc = { url, finalUrl: url, status: 200, contentType: "text/html", text: read(htmlFixture), fetchedAt: Date.parse("2026-09-27T06:00:00Z") };
  return {
    source,
    today: "2026-09-27",
    doc,
    fetch: async (fetchUrl: string): Promise<FetchedDoc> => {
      if (!pdfFixture) throw new Error(`unexpected fetch of ${fetchUrl}`);
      return { url: fetchUrl, finalUrl: fetchUrl, status: 200, contentType: "application/pdf", text: read(pdfFixture), fetchedAt: Date.now() };
    },
  };
}

const CRORE = 1e7;
const FD_URL = "https://www.axis.bank.in/deposits/fixed-deposits/fd-interest-rates";
const RD_URL = "https://www.axis.bank.in/deposits/recurring-deposits/interest-rates";
const SAVINGS_URL = "https://www.axis.bank.in/accounts/savings-account/savings-account-interest-rate";

describe("Axis Bank adapter", () => {
  it("discovers the dated PDF link and reads the retail FD card", async () => {
    const out = await axisFd(ctx(FD_URL, "fd_index.html", "domestic_fd.txt"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-26");
    expect(fd.sourceUrl).toBe("https://www.axis.bank.in/docs/default-source/default-document-library/interest-rates/domestic-fixed-deposits-26-september-26.pdf");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(72); // 18 tenures x (general/senior x <3cr/3-5cr)
    expect(rateForTenure(fd.rows, 365, { amount: 1_00_000, customer: "general" })?.rate).toBe(6.25); // "1 year – 1 year 10 days"
    expect(rateForTenure(fd.rows, 365, { amount: 1_00_000, customer: "senior" })?.rate).toBe(6.75);
    expect(rateForTenure(fd.rows, 365, { amount: 4 * CRORE, customer: "general" })?.rate).toBe(6.15); // 3cr-<5cr band
    // "18 Months < 2 years" (normalised from the bare "<") should cover 548-729 days.
    expect(rateForTenure(fd.rows, 600, { amount: 1_00_000, customer: "general" })?.rate).toBe(6.5);
    expect(rateForTenure(fd.rows, 600, { amount: 1_00_000, customer: "senior" })?.rate).toBe(7);
    expect(rateForTenure(fd.rows, 547, { amount: 1_00_000, customer: "general" })?.rate).toBe(6.45); // just below, "15 months < 18 months"
    expect(rateForTenure(fd.rows, 3650, { amount: 1_00_000, customer: "senior" })?.rate).toBe(7.25); // "5 years to 10 years"
  });

  it("collapses the identical ₹25cr-and-above sub-bands and reads the bulk card", async () => {
    const out = await axisBulk(ctx(FD_URL, "fd_index.html", "domestic_fd.txt"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-26");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(72); // 18 tenures x (general/senior x 5-25cr/25cr+)
    // "61 days - 87 days": the ₹5-25cr band differs from every ₹25cr+ sub-band, which all agree.
    expect(rateForTenure(bulk.rows, 70, { amount: 6 * CRORE, customer: "general" })?.rate).toBe(4.15);
    expect(rateForTenure(bulk.rows, 70, { amount: 30 * CRORE, customer: "general" })?.rate).toBe(4.65);
    expect(rateForTenure(bulk.rows, 70, { amount: 30 * CRORE, customer: "senior" })?.rate).toBe(5.15);
    expect(rateForTenure(bulk.rows, 3650, { amount: 50 * CRORE, customer: "senior" })?.rate).toBe(7.1);
    expect(rateForTenure(bulk.rows, 10, { amount: 1_00_000, customer: "general" })).toBeNull(); // below the ₹5cr bulk threshold
  });

  it("reads the RD card from its own table (not derived from FD)", async () => {
    const out = await axisRd(ctx(RD_URL, "rd.html"));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2025-12-22");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows).toHaveLength(24); // 12 tenures x general/senior
    expect(rateForTenure(rd.rows, 183, { amount: 5000, customer: "general" })?.rate).toBe(5.5); // 6 months
    expect(rateForTenure(rd.rows, 365, { amount: 5000, customer: "senior" })?.rate).toBe(6.75); // 12 months
    expect(rateForTenure(rd.rows, 3650, { amount: 5000, customer: "senior" })?.rate).toBe(7.25); // 120 months
    expect(rd.notes?.some((n) => /own table/i.test(n))).toBe(true);
  });

  it("reads the savings slab, skipping the MIBOR-linked top slab", async () => {
    const out = await axisSavings(ctx(SAVINGS_URL, "savings.html"));
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-04-03");
    expect(savings.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: 2000 * CRORE, rate: 2.5, residency: "resident" }]);
    expect(savings.slabMethod).toBe("unknown");
    expect(savings.notes?.some((n) => /MIBOR/i.test(n))).toBe(true);
    expect(hasErrors(validateCard(savings))).toBe(false);
  });
});
