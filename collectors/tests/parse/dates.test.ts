/**
 * Focused coverage for the apostrophe-year gap closed in parseDate (see common.ts): "01 Oct '26"
 * and "1st Oct'26" (and the curly-quote variant). collectors/tests/parse.test.ts keeps the
 * original, pre-existing date and findEffectiveDate cases.
 */
import { describe, expect, it } from "vitest";
import { findEffectiveDate, parseDate } from "../../src/parse/common";

describe("apostrophe years", () => {
  it.each([
    ["01 Oct '26", "2026-10-01"],
    ["1st Oct'26", "2026-10-01"],
    ["1 Oct ’26", "2026-10-01"], // curly right single quote, as pasted from some CMS editors
    ["15 Dec '25", "2025-12-15"],
    ["15-Dec-'25", "2025-12-15"],
  ])("%s", (label, expected) => {
    expect(parseDate(label)).toBe(expected);
  });

  it("still resolves a two-digit apostrophe year to 20xx, never 19xx", () => {
    expect(parseDate("01 Oct '99")).toBe("2099-10-01");
  });

  it("does not mistake the start of a four-digit year for an apostrophe-truncated one", () => {
    // A real bank page (HDFC) styles a full year as "effective 4th Feb '2018" -- a decorative
    // apostrophe directly before a *4*-digit year, not a 2-digit truncation. The 2-digit
    // apostrophe branch must not grab just "20" off the front of "2018" (which would silently
    // produce 2020); refusing this untested shape is correct, not a regression, since it was
    // never parsed before either (a bare apostrophe was never a recognised separator).
    expect(parseDate("4th Feb '2018")).toBeNull();
  });

  it("finds an apostrophe-year effective date on a page", () => {
    expect(findEffectiveDate("Revised rates w.e.f. 01 Oct '26 for all tenures")).toBe("2026-10-01");
    expect(findEffectiveDate("Rates effective from 1st Oct'26 onwards")).toBe("2026-10-01");
  });

  it("findEffectiveDate's own plausibility horizon still rejects an implausible apostrophe year", () => {
    // Today is 2026-09-27 in this test environment; 2099 is far beyond the ~13-month horizon.
    expect(findEffectiveDate("w.e.f. 01 Oct '99")).toBeNull();
  });

  it("refuses a month + apostrophe-year with no day", () => {
    expect(parseDate("Oct '26")).toBeNull();
  });
});
