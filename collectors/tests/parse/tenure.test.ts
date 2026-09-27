/**
 * Focused coverage for the tenure gaps closed in parseTenure (see tenure.ts): a bare "Upto X
 * days"/"Up to X days" on its own, a bare "< 1 year", "X <= tenure < Y"-style comparison chains,
 * and "X days to < Y" (word forms already existed; the shared code just needed the symbol form
 * and the comparison-chain form). collectors/tests/parse.test.ts keeps the original, pre-existing
 * tenure cases.
 */
import { describe, expect, it } from "vitest";
import { parseTenure } from "../../src/parse/tenure";

const r = (label: string) => {
  const x = parseTenure(label);
  return x ? [x.minDays, x.maxDays] : null;
};

describe("'upto X' / 'up to X' on its own is an inclusive range, not a point tenure", () => {
  it.each([
    ["Upto 7 days", [1, 7]],
    ["Up to 7 days", [1, 7]],
    ["upto 1 year", [1, 365]],
    ["Upto 6 Months", [1, 183]],
  ])("%s", (label, expected) => {
    expect(r(label as string)).toEqual(expected);
  });

  it("is a range (point: false), unlike a bare duration", () => {
    expect(parseTenure("Upto 7 days")).toEqual({ minDays: 1, maxDays: 7, point: false });
    expect(parseTenure("7 days")).toEqual({ minDays: 7, maxDays: 7, point: true });
  });
});

describe("a bare '< 1 year' (no lower bound stated)", () => {
  it.each([
    ["< 1 year", [1, 364]],
    ["<1 year", [1, 364]],
    ["< 6 months", [1, 182]],
  ])("%s", (label, expected) => {
    expect(r(label as string)).toEqual(expected);
  });
});

describe("comparison-chain forms ('1 year <= tenure < 2 years' and similar)", () => {
  it.each([
    ["1 year <= tenure < 2 years", [365, 729]],
    ["1 Year <= Tenure < 2 Years", [365, 729]],
    ["185 days <= tenure < 1 year", [185, 364]],
    ["1 year < tenure <= 2 years", [366, 730]],
    ["1 year <= tenure <= 2 years", [365, 730]],
    ["1 year < tenure < 2 years", [366, 729]],
    ["1 year <= T < 2 years", [365, 729]], // any placeholder word works, not just "tenure"
    ["1 year ≤ tenure < 2 years", [365, 729]], // unicode ≤ too
  ])("%s", (label, expected) => {
    expect(r(label as string)).toEqual(expected);
  });

  it("still refuses a chain whose bounds are inverted", () => {
    expect(parseTenure("2 years <= tenure < 1 year")).toBeNull();
  });
});

describe("'X days to < Y' (bare '<' as the upper bound of a two-sided range)", () => {
  it.each([
    ["185 days to < 1 year", [185, 364]],
    ["46 days to < 90 days", [46, 89]],
  ])("%s", (label, expected) => {
    expect(r(label as string)).toEqual(expected);
  });
});

describe("negative cases still refuse to guess", () => {
  it.each([["Upto"], ["Upto tenure"], ["Senior citizens only"], [""]])("%s", (label) => {
    expect(parseTenure(label)).toBeNull();
  });
});

describe("parseTenure: forms reported by the history researchers", () => {
  it('reads "X & above less than Y" (no "but") as X inclusive to below Y', () => {
    expect(parseTenure("3 years & above less than 5 years")).toEqual({ minDays: 1095, maxDays: 1824, point: false });
    expect(parseTenure("1 year and above less than 2 years")).toEqual({ minDays: 365, maxDays: 729, point: false });
  });
  it('reads "Mths" / "Mth" / "mos" as months', () => {
    expect(parseTenure("13 Mths to 24 Mths")).toEqual({ minDays: 395, maxDays: 730, point: false });
    expect(parseTenure("6 Mths to 12 Mths")).toEqual({ minDays: 183, maxDays: 365, point: false });
    // Beyond the 10-year horizon the tracker models: refused rather than squeezed into range.
    expect(parseTenure("121 Mths and Above")).toBeNull();
  });
});
