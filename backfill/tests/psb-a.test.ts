import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Target } from "../wayback/types";
import { parsers } from "../wayback/parsers/psb-a";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "sbi", "1998-12-03-interest.html"), "latin1");
const TERMDEPOSIT_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "sbi", "2001-02-15-termdeposit.html"), "latin1");
const SBP_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "state-bank-of-patiala", "2003-04-14-interestrate.html"), "latin1");
const BOB_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "bank-of-baroda", "2002-02-04-interest.html"), "latin1");
const BOB_3BAND_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "bank-of-baroda", "2002-10-12-interest.html"), "latin1");
const SBBJ_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "state-bank-of-bikaner-and-jaipur", "2001-03-02-interest.html"), "latin1");
const BOI_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "bank-of-india", "2009-04-13-rupeetermdeposit.html"), "latin1");
const BOB_YIELD_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "bank-of-baroda", "2003-06-20-interest.html"), "latin1");

function target(product: Target["product"]): Target {
  return { bankSlug: "sbi", url: "statebankofindia.com/interest.htm", product };
}

describe("sbi/1998-multi-section", () => {
  const parse = parsers["sbi/1998-multi-section"];

  it("reads the Resident and NRO domestic FD table, not the earlier NRE table", async () => {
    const result = await parse(FIXTURE, target("fd"));
    expect(result.effectiveFrom).toBe("1998-05-01");
    expect(result.skipped).toEqual([]);
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.residency === "resident")).toBe(true);
    expect(result.rows.every((r) => r.customer === "general")).toBe(true);
    // Spot-check exact rates visible in the fixture's "4.RESIDENT AND NRO DEPOSITS" table.
    const byLabel = Object.fromEntries(result.rows.map((r) => [r.tenureLabel, r.rate]));
    expect(byLabel["15 days and upto 45 days"]).toBe(5.0);
    expect(byLabel["1 year to less than 2 years"]).toBe(10.0);
    expect(byLabel["3 years and above"]).toBe(11.5);
    // This is the exact bug a generic (non-custom) parser would hit: the NRE table's "1 year to
    // less than 3 years" row at 10.50% must NOT appear among the resident FD rows.
    expect(byLabel["1 year to less than 3 years"]).toBeUndefined();
  });

  it("tags the same Resident/NRO table as residency nro when asked for the nro product", async () => {
    const result = await parse(FIXTURE, target("nro"));
    expect(result.rows).toHaveLength(6);
    expect(result.rows.every((r) => r.residency === "nro")).toBe(true);
    expect(result.rows.find((r) => r.tenureLabel === "180 days to less than 1 year")?.rate).toBe(8.0);
  });

  it("reads the NRE table separately, bounded before the Resident/NRO section", async () => {
    const result = await parse(FIXTURE, target("nre"));
    expect(result.effectiveFrom).toBe("1998-05-01");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.residency === "nre")).toBe(true);
    const byLabel = Object.fromEntries(result.rows.map((r) => [r.tenureLabel, r.rate]));
    expect(byLabel["6 months to less than 1 year"]).toBe(8.0);
    expect(byLabel["1 year to less than 3 years"]).toBe(10.5);
    expect(byLabel["3 years and above"]).toBe(11.5);
  });

  it("refuses products this page cannot represent (FCNR has no currency dimension; savings duplicates the RBI series)", async () => {
    for (const product of ["fd_bulk", "rd", "savings", "fcnr"] as const) {
      const result = await parse(FIXTURE, target(product));
      expect(result.rows).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
    }
  });
});

describe("sbi/2001-product-page", () => {
  const parse = parsers["sbi/2001-product-page"];

  it("reads the 'Effective from 12th Sept. 2000' table and date the generic reader alone cannot date", async () => {
    const result = await parse(TERMDEPOSIT_FIXTURE, { bankSlug: "sbi", url: "statebankofindia.com/statebank/sbinew/termdeposit.htm", product: "fd" });
    expect(result.effectiveFrom).toBe("2000-09-12");
    expect(result.rows).toHaveLength(6);
    const byLabel = Object.fromEntries(result.rows.map((r) => [r.tenureLabel, r.rate]));
    expect(byLabel["15 days and upto 45 days"]).toBe(5.0);
    expect(byLabel["46 days and upto 179 days"]).toBe(6.25);
    expect(byLabel["180 days to less than 1 year"]).toBe(7.0);
    expect(byLabel["1 year to less than 2 years"]).toBe(8.5);
    expect(byLabel["2 years to less than 3 years"]).toBe(9.0);
    expect(byLabel["3 years and above"]).toBe(10.0);
  });

  it("stores the same rows under the rd product too (the bank's own recurring-deposits page states RD earns interest at Term Deposit rates)", async () => {
    const result = await parse(TERMDEPOSIT_FIXTURE, { bankSlug: "sbi", url: "statebankofindia.com/statebank/sbinew/termdeposit.htm", product: "rd" });
    expect(result.effectiveFrom).toBe("2000-09-12");
    expect(result.rows).toHaveLength(6);
  });
});

describe("state-bank-of-patiala/2003-portal", () => {
  const parse = parsers["state-bank-of-patiala/2003-portal"];

  it("splits the two amount-band rate columns and drops the annualised-yield column", async () => {
    const result = await parse(SBP_FIXTURE, { bankSlug: "state-bank-of-patiala", url: "sbp.co.in/interestrate.htm", product: "fd" });
    expect(result.effectiveFrom).toBe("2003-02-01"); // the deposits table's own date, not the later housing-loan w.e.f. 05.02.2003
    // 4 tenure rows in the fixture x 2 amount bands = 8 rows, minus the below-15L "NIL" cell for
    // the 7-14 day row (only offered to single deposits of Rs 15 lakh and above) = 7.
    expect(result.rows).toHaveLength(7);
    const below15L = result.rows.filter((r) => r.amountMax !== null && r.amountMax <= 1_500_001);
    const above15L = result.rows.filter((r) => r.amountMin >= 1_500_000);
    expect(below15L).toHaveLength(3); // 15-29d, 91-179d, 3yr+ (7-14d has no below-15L rate)
    expect(above15L).toHaveLength(4); // all 4 tenure rows
    expect(result.rows.find((r) => r.tenureLabel === "7 days and upto 14 days @" && r.amountMin >= 1_500_000)?.rate).toBe(4.0);
    expect(result.rows.some((r) => r.tenureLabel === "7 days and upto 14 days @" && r.amountMax !== null && r.amountMax <= 1_500_001)).toBe(false);
    // The "EFFECTIVE ANNUALISED RETURN TO CUSTOMER" column (6.14 for 91-179 days) never appears
    // as a stored rate -- it is a derived yield, not a separate offering, and RateRow has no
    // field for it.
    expect(result.rows.some((r) => r.rate === 6.14)).toBe(false);
  });
});

describe("bank-of-baroda/2002-interest-asp", () => {
  const parse = parsers["bank-of-baroda/2002-interest-asp"];

  it("skips the leading Sr.No column and splits the two 15-lac amount bands, tagged fd/resident", async () => {
    const result = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(result.effectiveFrom).toBe("2002-02-04"); // the deposits table's own date, not the earlier PLR/export-credit ones or the later FCNR/NRE ones
    // 5 tenure rows x 2 amount bands = 10, minus the below-15L "**" cell for the 7-14 day row = 9.
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((r) => r.residency === "resident")).toBe(true);
    const below15L = result.rows.filter((r) => r.amountMax === 1_500_000);
    const above15L = result.rows.filter((r) => r.amountMin === 1_500_000);
    expect(below15L).toHaveLength(4); // 7-14d has no below-15L rate
    expect(above15L).toHaveLength(5);
    expect(result.rows.find((r) => r.tenureLabel === "7 days to 14 days" && r.amountMin === 1_500_000)?.rate).toBe(5.0);
    expect(result.rows.some((r) => r.tenureLabel === "7 days to 14 days" && r.amountMax === 1_500_000)).toBe(false);
    expect(result.rows.find((r) => r.tenureLabel === "3 years and above" && r.amountMax === 1_500_000)?.rate).toBe(8.0);
    // Column 0 (bare row numbers "1".."9") must never be read as a tenure.
    expect(result.rows.some((r) => r.tenureMinDays === 1 && r.tenureMaxDays === 1)).toBe(false);
  });

  it("tags the same shared schedule as residency nro when asked for the nro product (the heading covers both)", async () => {
    const result = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "nro" });
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((r) => r.residency === "nro")).toBe(true);
  });

  it("refuses products this page cannot represent (FCNR has no currency dimension; savings duplicates the RBI series)", async () => {
    for (const product of ["savings", "fcnr", "nre"] as const) {
      const result = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product });
      expect(result.rows).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
    }
  });

  it("regression: a per-band '(w.e.f. DD.MM.YYYY)' note inside the amount-band header must not be read as part of the amount (shared parseAmountBand bug, worked around locally)", async () => {
    // By 2002-10-12 the table had grown a third, open-ended band, and every band's header cell
    // carries its own repeated effective-date note -- parseAmountBand's two-number "a to b"
    // reading would otherwise grab the date's "16.09" as if it were a second rupee amount.
    const fd = await parse(BOB_3BAND_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(fd.rows.every((r) => r.amountMax !== 16.09 && r.amountMin !== 16.09)).toBe(true);
    const below15L = fd.rows.filter((r) => r.amountMax === 1_500_000);
    const midBand = fd.rows.filter((r) => r.amountMin === 1_500_000 && r.amountMax === 50_000_000);
    expect(below15L.length).toBeGreaterThan(0);
    expect(midBand.length).toBeGreaterThan(0);
    expect(fd.rows.find((r) => r.tenureLabel === "3 years and above" && r.amountMax === 1_500_000)?.rate).toBe(7.0);

    const bulk = await parse(BOB_3BAND_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd_bulk" });
    expect(bulk.rows).toHaveLength(3); // 3 tenure rows in the fixture, one open-ended band each
    expect(bulk.rows.every((r) => r.amountMin === 50_000_000 && r.amountMax === null)).toBe(true);
    expect(bulk.rows.find((r) => r.tenureLabel === "15 days to 45 days")?.rate).toBe(5.5);

    // The 2002-02-04 fixture (only two bands, no third) must still report no fd_bulk rows rather
    // than an error.
    const noBulk = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd_bulk" });
    expect(noBulk.rows).toEqual([]);
  });
});

describe("bank-of-baroda/2003-yield-table", () => {
  const parse = parsers["bank-of-baroda/2003-yield-table"];

  it("drops the derived Annualised Yield columns and reads the amount band from the header text (5 crore, not 1 crore this time)", async () => {
    const result = await parse(BOB_YIELD_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(result.effectiveFrom).toBe("2003-06-09"); // this table's own date, not the earlier June-1st PLR date
    // 4 tenure rows x 2 amount bands = 8, minus the below-15L "-" cell for the 7-14 day row = 7.
    expect(result.rows).toHaveLength(7);
    expect(result.rows.every((r) => r.residency === "resident")).toBe(true);
    expect(result.rows.some((r) => r.rate === 4.78 || r.rate === 6.23 || r.rate === 6.52)).toBe(false); // yield figures never stored as rates
    const midBand = result.rows.filter((r) => r.amountMin === 1_500_000);
    expect(midBand).toHaveLength(4);
    expect(midBand[0].amountMax).toBe(50_000_000); // "less than Rs. 5.0 crores", not the earlier table's 1 crore
    expect(result.rows.find((r) => r.tenureLabel.startsWith("7 days to 14 days") && r.amountMin === 1_500_000)?.rate).toBe(4.25);
    // The inline footnote in that same label must not have broken tenure parsing.
    expect(result.rows.find((r) => r.tenureLabel.startsWith("7 days to 14 days"))?.tenureMinDays).toBe(7);
  });

  it("never matches the 2002-era Sr.No-column table (and vice versa)", async () => {
    const oldEra = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(oldEra.rows).toEqual([]);
    const newEraViaOldParser = await parsers["bank-of-baroda/2002-interest-asp"](BOB_YIELD_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(newEraViaOldParser.rows).toEqual([]);
  });
});

describe("state-bank-of-bikaner-and-jaipur/2001-domestic-term-deposit", () => {
  const parse = parsers["state-bank-of-bikaner-and-jaipur/2001-domestic-term-deposit"];
  const target = (product: Target["product"]): Target => ({ bankSlug: "state-bank-of-bikaner-and-jaipur", url: "sbbjbank.com/interest.htm", product });

  it("reads the below-1-crore bands as fd, stripping the '(delta)' suffix from differential-rate cells", async () => {
    const result = await parse(SBBJ_FIXTURE, target("fd"));
    expect(result.effectiveFrom).toBe("2001-02-12"); // the table's own w.e.f., not the unrelated Sept-2000 conclave date
    // 4 tenure rows x 2 below-1-crore bands = 8.
    expect(result.rows).toHaveLength(8);
    expect(result.rows.every((r) => r.residency === "resident")).toBe(true);
    const normal = result.rows.filter((r) => r.amountMax === 1_500_000);
    const differential = result.rows.filter((r) => r.amountMin === 1_500_000 && r.amountMax === 10_000_000);
    expect(normal).toHaveLength(4);
    expect(differential).toHaveLength(4);
    expect(result.rows.find((r) => r.tenureLabel === "15 days & upto 45 Days" && r.amountMax === 1_500_000)?.rate).toBe(5.0);
    // The delta-over-normal-rate suffix "(0.50)" must never be read as part of the rate.
    expect(result.rows.find((r) => r.tenureLabel === "15 days & upto 45 Days" && r.amountMin === 1_500_000)?.rate).toBe(5.5);
    expect(result.rows.some((r) => r.rate === 0.5)).toBe(false);
  });

  it("reads the 1-crore-and-above bands as fd_bulk, and correctly reports no rate where the source prints '****'", async () => {
    const result = await parse(SBBJ_FIXTURE, target("fd_bulk"));
    expect(result.effectiveFrom).toBe("2001-02-12");
    // 4 tenure rows x 2 bulk bands, minus the always-"****" (unpopulated) 5-crore-and-above band = 4.
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((r) => r.amountMin >= 10_000_000)).toBe(true);
    expect(result.rows.some((r) => r.amountMin === 50_000_000)).toBe(false); // every 5cr+ cell in the fixture is "****"
    expect(result.rows.find((r) => r.tenureLabel === "3 years and above")?.rate).toBe(10.25);
  });

  it("refuses products this page cannot represent (title states domestic only)", async () => {
    for (const product of ["nre", "nro", "savings"] as const) {
      const result = await parse(SBBJ_FIXTURE, target(product));
      expect(result.rows).toEqual([]);
      expect(result.skipped.length).toBeGreaterThan(0);
    }
  });
});

describe("bank-of-baroda/interest-asp (combined wrapper, the one actually referenced from targets/psb-a.json)", () => {
  const parse = parsers["bank-of-baroda/interest-asp"];

  it("reads a 2002-era (Sr.No column) capture via the first sub-parser", async () => {
    const result = await parse(BOB_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(result.effectiveFrom).toBe("2002-02-04");
    expect(result.rows).toHaveLength(9);
  });

  it("falls back to the 2003+-era (yield-table) sub-parser when the Sr.No table isn't present", async () => {
    const result = await parse(BOB_YIELD_FIXTURE, { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(result.effectiveFrom).toBe("2003-06-09");
    expect(result.rows).toHaveLength(7);
  });

  it("reports not-found (never guesses) when neither era's table is present", async () => {
    const result = await parse("<html><body><p>no rate table here</p></body></html>", { bankSlug: "bank-of-baroda", url: "bankofbaroda.com/interest.asp", product: "fd" });
    expect(result.rows).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});

describe("bank-of-india/2009-rupeetermdeposit", () => {
  const parse = parsers["bank-of-india/2009-rupeetermdeposit"];

  it("reads only the 'Revised' sub-column of the two below-Rs.1-crore bands as fd, dated from that cell's own w.e.f., not the page's news-ticker date", async () => {
    const result = await parse(BOI_FIXTURE, { bankSlug: "bank-of-india", url: "bankofindia.co.in/rupeetermdeposit.aspx", product: "fd" });
    // Page-top news ticker says "w.e.f. 15.04.2009" for a not-yet-tabulated revision; the table's
    // own "Revised" cells say 19.01.09 -- the latter must be what is stored.
    expect(result.effectiveFrom).toBe("2009-01-19");
    // 4 tenure rows x 2 below-1cr bands = 8 rows; the "(Existing)" sub-columns are never read.
    expect(result.rows).toHaveLength(8);
    expect(result.rows.every((r) => r.residency === "resident" && r.customer === "general")).toBe(true);
    const below15L = result.rows.filter((r) => r.amountMax === 1_500_000);
    const midBand = result.rows.filter((r) => r.amountMin === 1_500_000 && r.amountMax === 10_000_000);
    expect(below15L).toHaveLength(4);
    expect(midBand).toHaveLength(4);
    expect(result.rows.find((r) => r.tenureLabel === "46 days to 90 days" && r.amountMax === 1_500_000)?.rate).toBe(6.0);
    // The "(Existing)" value for this same cell (7.00, pre-revision) must never appear as a rate.
    expect(result.rows.some((r) => r.tenureLabel === "46 days to 90 days" && r.amountMax === 1_500_000 && r.rate === 7.0)).toBe(false);
  });

  it("reads the open-ended 'Rs.1 crore & above' band as fd_bulk", async () => {
    const result = await parse(BOI_FIXTURE, { bankSlug: "bank-of-india", url: "bankofindia.co.in/rupeetermdeposit.aspx", product: "fd_bulk" });
    expect(result.effectiveFrom).toBe("2009-01-19");
    expect(result.rows).toHaveLength(4);
    expect(result.rows.every((r) => r.amountMin === 10_000_000 && r.amountMax === null)).toBe(true);
    expect(result.rows.find((r) => r.tenureLabel === "1 year to less than 2 years")?.rate).toBe(7.5);
  });

  it("refuses products this table cannot represent", async () => {
    const result = await parse(BOI_FIXTURE, { bankSlug: "bank-of-india", url: "bankofindia.co.in/rupeetermdeposit.aspx", product: "rd" });
    expect(result.rows).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
  });
});
