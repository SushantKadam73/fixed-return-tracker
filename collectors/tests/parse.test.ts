import { describe, expect, it } from "vitest";
import { parseTenure } from "../src/parse/tenure";
import { parseAmountBand } from "../src/parse/amount";
import { findEffectiveDate, parseDate, parseRate } from "../src/parse/common";

const r = (label: string) => {
  const x = parseTenure(label);
  return x ? [x.minDays, x.maxDays] : null;
};

describe("tenure labels (real examples from bank pages)", () => {
  it.each([
    ["7 days to 45 days", [7, 45]],
    ["46 days to 179 days", [46, 179]],
    ["211 days to less than 1 year", [211, 364]],
    ["1 Year to less than 2 years", [365, 729]],
    ["2 years to less than 3 years", [730, 1094]],
    ["3 years to less than 5 years", [1095, 1824]],
    ["5 years and up to 10 years", [1825, 3650]],
    ["7-14 Days", [7, 14]],
    ["1 Yr to 399 days", [365, 399]],
    ["401 to 443 days", [401, 443]],
    ["445 Days to 554 Days", [445, 554]],
    ["998 days to 3 Yrs", [998, 1095]],
    ["> 3 Yrs to 10 Yrs", [1096, 3650]],
    ["Above 5 years up to 10 years", [1826, 3650]],
    ["12 months to 15 months", [365, 456]],
    ["15 months 1 day to 18 months", [457, 548]],
    ["1 year 1 day to 2 years", [366, 730]],
    ["271 days & above and less than 1 year", [271, 364]],
    ["181 -270 Days", [181, 270]],
  ])("%s", (label, expected) => {
    expect(r(label)).toEqual(expected);
  });
  it("reads single special tenures as points", () => {
    expect(parseTenure("444 days")).toEqual({ minDays: 444, maxDays: 444, point: true });
    expect(parseTenure("400 Days (Amrit Kalash)")).toEqual({ minDays: 400, maxDays: 400, point: true });
    expect(parseTenure("5 Years")).toEqual({ minDays: 1825, maxDays: 1825, point: true });
  });
  it("handles open-ended labels", () => {
    expect(r("5 years and above")).toEqual([1825, 3650]);
  });
  it("refuses labels it cannot read", () => {
    expect(parseTenure("Senior citizens")).toBeNull();
    expect(parseTenure("")).toBeNull();
  });
});

describe("amount bands", () => {
  it.each([
    ["Below ₹3 Crore", { min: 0, max: 3e7 }],
    ["Less than Rs. 3 crore", { min: 0, max: 3e7 }],
    ["Rs. 3 Crore and above", { min: 3e7, max: null }],
    ["₹3 Cr to less than ₹5 Cr", { min: 3e7, max: 5e7 }],
    ["From Rs.1,00,01,000/- to less than Rs.3,00,00,000/-", { min: 10001000, max: 3e7 }],
    ["Up to Rs 50 Lakhs", { min: 0, max: 5e6 + 1 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });
});

describe("rates and dates", () => {
  it("parses rate cells", () => {
    expect(parseRate("6.25")).toBe(6.25);
    expect(parseRate("7.05*")).toBe(7.05);
    expect(parseRate("6.50 %")).toBe(6.5);
    expect(parseRate("NA")).toBeNull();
    expect(parseRate("-")).toBeNull();
  });
  it("parses Indian dates", () => {
    expect(parseDate("15/12/2025")).toBe("2025-12-15");
    expect(parseDate("15.12.2025")).toBe("2025-12-15");
    expect(parseDate("1st June 2026")).toBe("2026-06-01");
    expect(parseDate("June 1, 2026")).toBe("2026-06-01");
    expect(parseDate("15-Dec-2025")).toBe("2025-12-15");
  });
  it("finds the latest effective date on a page", () => {
    expect(findEffectiveDate("Existing Rates for Public w.e.f. 15/07/2025 | Revised Rates for Public w.e.f.15/12/2025")).toBe("2025-12-15");
    expect(findEffectiveDate("The revised rates ... which will be effective from 1st June 2026 are given below")).toBe("2026-06-01");
  });
});
