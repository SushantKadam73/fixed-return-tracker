import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Target } from "../wayback/types";
import { parsers } from "../wayback/parsers/psb-a";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "sbi", "1998-12-03-interest.html"), "latin1");
const TERMDEPOSIT_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "sbi", "2001-02-15-termdeposit.html"), "latin1");
const SBP_FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "state-bank-of-patiala", "2003-04-14-interestrate.html"), "latin1");

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
