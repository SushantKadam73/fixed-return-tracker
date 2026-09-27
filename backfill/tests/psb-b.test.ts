import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Target } from "../wayback/types";
import { parsers } from "../wayback/parsers/psb-b";

const FIXTURE = readFileSync(path.join(__dirname, "..", "fixtures", "indian-bank", "20090923000000-rate_deposit_domestic.html"), "latin1");

function target(product: Target["product"]): Target {
  return { bankSlug: "indian-bank", url: "www.indianbank.in/rate_deposit_domestic.php", product, parser: "indian-bank/amount-tiered-table" };
}

describe("indian-bank/amount-tiered-table", () => {
  const parse = parsers["indian-bank/amount-tiered-table"];

  it("reads the retail table's two amount-tier columns as separate rows, not as a skipped 'crore' column", async () => {
    const result = await parse(FIXTURE, target("fd"));
    expect(result.effectiveFrom).toBe("2009-08-07");
    // The only "skipped" entries are the page's own nav-menu tables (not tenure tables at all);
    // neither retail-rate table (this one or the bulk one below) is ever skipped.
    expect(result.skipped.every((s) => /first column is not tenures/.test(s))).toBe(true);
    expect(result.skipped.some((s) => /col \d/.test(s))).toBe(false);
    // 5 tenure rows x 2 amount tiers ("Less than Rs.15 lakhs", "Rs.15 lakhs to less than Rs.1 Crore").
    expect(result.rows).toHaveLength(10);
    expect(result.rows.every((r) => r.customer === "general" && r.residency === "resident")).toBe(true);
    const below15L = result.rows.filter((r) => r.amountMax === 1_500_000);
    const to1Cr = result.rows.filter((r) => r.amountMin === 1_500_000 && r.amountMax === 10_000_000);
    expect(below15L).toHaveLength(5);
    expect(to1Cr).toHaveLength(5);
    // Spot-check exact rates visible in the fixture.
    expect(below15L.find((r) => r.tenureLabel === "7days to 14 days")?.rate).toBe(2.5);
    expect(to1Cr.find((r) => r.tenureLabel === "3 years and above")?.rate).toBe(7.25);
    // Neither retail tier's amountMin/amountMax reaches into the bulk table below.
    expect(result.rows.every((r) => r.amountMax !== null && r.amountMax <= 10_000_000)).toBe(true);
  });

  it("reads the second table's 'Rs.1 Crore to Rs.5 Crores' column only for the fd_bulk product", async () => {
    const result = await parse(FIXTURE, target("fd_bulk"));
    expect(result.effectiveFrom).toBe("2009-08-07");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.every((r) => r.amountMin === 10_000_000 && r.amountMax === 50_000_000)).toBe(true);
    expect(result.rows.every((r) => r.customer === "general")).toBe(true);
    const byLabel = Object.fromEntries(result.rows.map((r) => [r.tenureLabel, r.rate]));
    expect(byLabel["7 days to 14 days"]).toBe(2.0);
    expect(byLabel["1 year and above"]).toBe(6.0);
  });

  it("never mixes a retail row into the fd_bulk result or vice versa", async () => {
    const fd = await parse(FIXTURE, target("fd"));
    const bulk = await parse(FIXTURE, target("fd_bulk"));
    const fdLabels = new Set(fd.rows.map((r) => r.tenureLabel));
    const bulkLabels = new Set(bulk.rows.map((r) => r.tenureLabel));
    for (const label of bulkLabels) expect(fdLabels.has(label) && fd.rows.some((r) => r.tenureLabel === label && r.amountMin === 10_000_000)).toBe(false);
  });
});
