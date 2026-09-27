import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { RateRow } from "../../lib/domain";
import { parsers } from "../wayback/parsers/pvt-b";
import type { Target } from "../wayback/types";

const fixture = (bank: string, name: string) => readFileSync(path.join(__dirname, "..", "fixtures", bank, name), "utf8");
const sibFixture = (name: string) => fixture("south-indian-bank", name);

const target: Target = { bankSlug: "south-indian-bank", url: "southindianbank.com/x", product: "fd" };
const parse = parsers["south-indian-bank/domestic-term-deposit"];

function row(rows: RateRow[], tenureLabel: string, customer: RateRow["customer"], amountMin: number): RateRow | undefined {
  return rows.find((r) => r.tenureLabel === tenureLabel && r.customer === customer && r.amountMin === amountMin);
}

describe("south-indian-bank/domestic-term-deposit", () => {
  it("reads the 2007 layout: two real amount tiers plus a non-numeric 'ask treasury' footnote column", async () => {
    const res = await parse(sibFixture("20070708-domestic-deposits.html"), target);
    expect(res.skipped).toEqual([]);
    expect(res.rows).toHaveLength(6); // 3 tenures x 2 real rate columns; the footnote column has no parseable rate anywhere
    expect(row(res.rows, "46 days to 90 days", "general", 0)).toMatchObject({ amountMax: 1500000, rate: 5 });
    expect(row(res.rows, "46 days to 90 days", "general", 1500000)).toMatchObject({ amountMax: 5000000, rate: 5.25 });
    expect(row(res.rows, "91 days to 179 days", "general", 0)).toMatchObject({ amountMax: 1500000, rate: 6 });
    expect(row(res.rows, "91 days to 179 days", "general", 1500000)).toMatchObject({ amountMax: 5000000, rate: 6.25 });
    // No row carries the footnote column's amount band (Rs.50 lacs & above) -- every one of its
    // cells is a fragment of a running "ask treasury" sentence, never a rate.
    expect(res.rows.some((r) => r.amountMin === 5000000)).toBe(false);
    // Known shared-code gap (not this parser's): collectors/src/parse/common.ts's parseDate only
    // allows a comma between MONTH and YEAR ("December 1st, 2010"), not between DAY and MONTH
    // ("1st, July 2007"), which is exactly how this particular page phrases its earliest dates.
    expect(res.effectiveFrom).toBeNull();
  });

  it("reads the 2013 layout: amount tier x General/Senior Citizens sub-columns, '(incl)' upper bound, and an all-dash tenure row", async () => {
    const res = await parse(sibFixture("20130117-domestic-deposits.html"), target);
    expect(res.effectiveFrom).toBe("2013-01-01");
    expect(res.rows).toHaveLength(12); // 3 dated tenures x 4 columns; "7 days to 14 days" is all "--" and contributes nothing
    expect(res.rows.some((r) => r.tenureLabel === "7 days to 14 days")).toBe(false);
    expect(row(res.rows, "15 days to 45 days", "general", 0)).toMatchObject({ amountMax: 1500000, rate: 4 });
    expect(row(res.rows, "15 days to 45 days", "senior", 0)).toMatchObject({ amountMax: 1500000, rate: 4.5 });
    // "(incl)" is mechanically read as "and including": the upper tier's band is inclusive of
    // exactly Rs.1,00,00,000, i.e. amountMax is one rupee past it.
    expect(row(res.rows, "46 days to 90 days", "general", 1500000)).toMatchObject({ amountMax: 10000001, rate: 4.5 });
    expect(row(res.rows, "46 days to 90 days", "senior", 1500000)).toMatchObject({ amountMax: 10000001, rate: 5 });
  });

  it("reads the Aug-2000 static layout: three unlabelled amount tiers, no senior column", async () => {
    const res = await parse(sibFixture("20000816-interest.html"), target);
    expect(res.effectiveFrom).toBe("2000-07-17");
    expect(res.rows).toHaveLength(9); // 3 tenures x 3 amount tiers
    expect(res.rows.every((r) => r.customer === "general")).toBe(true);
    expect(row(res.rows, "46 days upto and including 90 days", "general", 0)).toMatchObject({ amountMax: 1500001, rate: 6.5 });
    // The middle tier's own header is "Rs 15 Lacs upto 100 Lacs" -- "upto" written as one word is
    // an inclusive upper bound, same as spaced "up to" (shared parseAmountBand convention), so
    // this tier's amountMax is one rupee past Rs.1,00,00,000, not exactly at it.
    expect(row(res.rows, "46 days upto and including 90 days", "general", 1500000)).toMatchObject({ amountMax: 10000001, rate: 7 });
    expect(row(res.rows, "46 days upto and including 90 days", "general", 10000000)).toMatchObject({ amountMax: null, rate: 7.25 });
  });

  it("falls back to one uncapped tier when the table has a single rate column with no amount phrase (1999)", async () => {
    const res = await parse(sibFixture("19990220-interest.html"), target);
    expect(res.rows).toHaveLength(4); // the "Saving Bank Account" row is not a term-deposit tenure and is skipped
    expect(res.rows.every((r) => r.customer === "general" && r.amountMin === 0 && r.amountMax === null)).toBe(true);
    expect(row(res.rows, "15 days upto and including 45 days", "general", 0)).toMatchObject({ rate: 6 });
    expect(row(res.rows, "Above 1 year, upto and including 2 years", "general", 0)).toMatchObject({ rate: 11 });
  });
});

describe("jk-bank/current-revised-rate-table", () => {
  const jkTarget: Target = { bankSlug: "jk-bank", url: "jkbank.com/x", product: "fd" };
  const jkParse = parsers["jk-bank/current-revised-rate-table"];

  it("keeps only the 'Revised' rate and drops the outgoing 'Current' column and the 'Deposit Type' column", async () => {
    const res = await jkParse(fixture("jk-bank", "20200814-intrates.html"), jkTarget);
    expect(res.rows).toHaveLength(4); // 4 tenure rows x 1 kept column (Revised) -- Current and Deposit Type both dropped
    expect(res.rows.every((r) => r.customer === "general")).toBe(true);
    expect(row(res.rows, "271 days to less than 1 Year", "general", 0)).toMatchObject({ rate: 4.5 });
    expect(row(res.rows, "1 year to less than 2 years", "general", 0)).toMatchObject({ rate: 5.1 });
    expect(row(res.rows, "2 years to less than 3 years", "general", 0)).toMatchObject({ rate: 5.2 });
    // The outgoing "Current" values (4.75, 5.25, 5.30) must never appear as separate rows.
    expect(res.rows.some((r) => r.rate === 4.75)).toBe(false);
    expect(res.effectiveFrom).toBe("2020-08-11");
  });
});
