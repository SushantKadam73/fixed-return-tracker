import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { GenericResult } from "../wayback/types";
import { _internal } from "../wayback/parsers/sfb";

const target = (bankSlug: string) => ({ bankSlug, url: "x", product: "fd" as const });

const fixture = (bank: string, file: string) => readFileSync(path.join(__dirname, "..", "fixtures", bank, file), "utf8");

// Both parsers under test are synchronous; the HistoricalParser type allows a Promise too, so
// assert the concrete shape here rather than making every `it` block async.
describe("au-sfb/annualized-fd", () => {
  const html = fixture("au-sfb", "20231223050259.html");
  const result = _internal.auAnnualizedFd(html, target("au-sfb")) as GenericResult;

  it("reads the effective date from the page text", () => {
    expect(result.effectiveFrom).toBe("2023-08-16");
  });

  it("reads only the plain rate column, not the Annualized derivative", () => {
    const short = result.rows.find((r) => r.tenureLabel === "7 Days to 1 Month 15 Days");
    expect(short?.rate).toBe(3.75);
    const withAnnualized = result.rows.find((r) => r.tenureLabel === "3 Months 1 Day to 6 Months");
    expect(withAnnualized?.rate).toBe(5.0); // not 5.09 (the Annualized column)
  });

  it("never reads table 1, even though it repeats a table-0 tenure label at a different rate", () => {
    // Table 0 has its own "12 Months 1 Day to 15 Months" row at 7.75%; table 1 repeats a
    // differently-punctuated version of the same label at 7.85% -- reading both would recreate
    // the exact "two different rates for the same slab" conflict this parser exists to avoid.
    const rows = result.rows.filter((r) => /12 Months 1 Day/.test(r.tenureLabel));
    expect(rows).toHaveLength(1);
    expect(rows[0].rate).toBe(7.75);
  });

  it("never reads the Non-callable (table 2) or Monthly Payout (table 3) tables", () => {
    // Both would-be-extra rows use tenure "7 Days to 1 Month 15 Days" too but at different rates
    // (4.25% non-callable, "-" monthly payout) -- only the one genuine general row should exist.
    const dupes = result.rows.filter((r) => r.tenureLabel === "7 Days to 1 Month 15 Days");
    expect(dupes).toHaveLength(1);
    expect(dupes[0].rate).toBe(3.75);
  });

  it("emits general-only rows (no senior column found in the source tables)", () => {
    expect(result.rows.every((r) => r.customer === "general")).toBe(true);
  });
});

describe("jana-sfb/regular-annualized-fd", () => {
  const html = fixture("jana-sfb", "20200803182815.html");
  const result = _internal.janaRegularAnnualizedFd(html, target("jana-sfb")) as GenericResult;

  it("reads the effective date", () => {
    expect(result.effectiveFrom).toBe("2020-08-03");
  });

  it("reads the Regular FD Rate column as general (not FD Plus, not the Annualised derivative)", () => {
    const row = result.rows.find((r) => r.tenureLabel === "91 − 180 days" && r.customer === "general");
    expect(row?.rate).toBe(6.5); // Regular FD Rate; not 6.75 (FD Plus) nor 6.9/6.55 (Annualised)
  });

  it("reads the Senior FD Rate column as senior", () => {
    const row = result.rows.find((r) => r.tenureLabel === "91 − 180 days" && r.customer === "senior");
    expect(row?.rate).toBe(7.0); // Senior FD Rate; not 7.19 (Annualised)
  });

  it("never emits an FD Plus row", () => {
    // FD Plus and Regular FD happen to share the same rate for some tenures (7-14 days: both
    // 4.50%) but differ for others (91-180 days: 6.75% FD Plus vs 6.50% Regular) -- exactly one
    // general row per tenure confirms FD Plus's columns were skipped, not merely coincidentally
    // equal.
    const rows = result.rows.filter((r) => r.customer === "general");
    expect(rows).toHaveLength(3);
  });
});
