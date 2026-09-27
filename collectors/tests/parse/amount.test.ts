/**
 * Focused coverage for the amount-band gaps closed in parseAmountBand (see amount.ts):
 * "crs"/"Crs." as crore, ">"/"<"/"≥"/"≤" boundaries, "up to & including"/"upto and including",
 * "upto" written as one word as an inclusive upper bound, and "above X" behind a prose prefix.
 * collectors/tests/parse.test.ts keeps the original, pre-existing amount-band cases.
 */
import { describe, expect, it } from "vitest";
import { parseAmountBand } from "../../src/parse/amount";

describe("crs / Crs. as crore", () => {
  it.each([
    ["Below Rs. 3 Crs", { min: 0, max: 3e7 }],
    ["Below Rs. 3 Crs.", { min: 0, max: 3e7 }],
    ["Rs. 3 Crs and above", { min: 3e7, max: null }],
    ["Rs.3 Crs to less than Rs.5 Crs", { min: 3e7, max: 5e7 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });

  it("does not mistake an unrelated word ending in a consonant + 'rs' for a currency marker", () => {
    // "yrs" (years) must not be eaten the way the "rs" inside "Crs" used to be.
    expect(parseAmountBand("Rs 3 Crore and above, for long-term depositors (yrs)")).toEqual({ min: 3e7, max: null });
  });
});

describe(">, <, ≥, ≤ boundaries", () => {
  it.each([
    ["> ₹3 Cr", { min: 3e7 + 1, max: null }],
    [">₹3 Cr", { min: 3e7 + 1, max: null }],
    ["< 3 Crore", { min: 0, max: 3e7 }],
    ["<3 Crore", { min: 0, max: 3e7 }],
    ["≥ ₹3 Cr", { min: 3e7, max: null }],
    ["≤ ₹3 Cr", { min: 0, max: 3e7 + 1 }],
    ["> Rs 1 Lakh to ≤ Rs 5 Lakh", { min: 1e5 + 1, max: 5e5 + 1 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });
});

describe("up to & including / upto and including (inclusive upper)", () => {
  it.each([
    ["Up to & Including Rs 5 Lakh", { min: 0, max: 5e5 + 1 }],
    ["Upto and including Rs 5 Lakh", { min: 0, max: 5e5 + 1 }],
    ["Rs 1 Lakh to upto & including Rs 5 Lakh", { min: 1e5, max: 5e5 + 1 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });
});

describe("'upto' written as one word is still an inclusive upper bound", () => {
  it.each([
    // Real bank phrasing (South Indian Bank, read by backfill/wayback/parsers/pvt-b.ts):
    // "Rs 15 Lacs upto 100 Lacs" has no standalone "to" to split on at all.
    ["Rs 15 Lacs upto 100 Lacs", { min: 15e5, max: 1e7 + 1 }],
    ["Above ₹1 Crore upto Rs 3 Crore", { min: 1e7 + 1, max: 3e7 + 1 }],
    ["Rs.3 Crore and upto Rs.5 Crore", { min: 3e7, max: 5e7 + 1 }],
    ["Above Rs.1 Lakh and upto Rs.5 Lakh", { min: 1e5 + 1, max: 5e5 + 1 }],
    // Real bank phrasing (Indian Overseas Bank savings slabs).
    ["Above Rs. 1 lakh and upto Rs. 2000 Crore (Linked to Repo Rate)", { min: 1e5 + 1, max: 2000e7 + 1 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });
});

describe("'above X' recognised behind a prose prefix, not only at the start of the label", () => {
  it.each([
    // Real bank phrasing (DCB Bank).
    ["For deposits of above Rs. 1 Crore and upto Rs. 3 Crore.", { min: 1e7 + 1, max: 3e7 + 1 }],
    ["for single deposit of above ₹ 1 Crore to less than ₹ 3 Crore.", { min: 1e7 + 1, max: 3e7 }],
    ["Minimum single deposit above Rs. 5 Lakh and upto Rs. 10 Lakh", { min: 5e5 + 1, max: 1e6 + 1 }],
  ])("%s", (label, expected) => {
    expect(parseAmountBand(label)).toEqual(expected);
  });
});

describe("negative cases still refuse to guess", () => {
  it.each([
    [""],
    ["Senior citizens"],
    ["Rs 5 Lakh"], // a bare amount with no boundary keyword at all
    ["General rate applies"],
  ])("%s", (label) => {
    expect(parseAmountBand(label)).toBeNull();
  });
});
