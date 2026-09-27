import { describe, expect, it } from "vitest";
import { headingScore, readTermTables, tableHeading } from "../wayback/generic-parse";

const table = (rows: string[][]) => `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
const fdRows = (base: number) => [
  ["Period", "Rate of interest"],
  ["7 days to 45 days", `${base}%`],
  ["46 days to 179 days", `${base + 1}%`],
  ["180 days to less than 1 year", `${base + 2}%`],
  ["1 year to less than 2 years", `${base + 3}%`],
];

describe("tableHeading", () => {
  it("keeps only the text after the previous table's last rate, capped to 120 characters", () => {
    expect(tableHeading("Overnight 14.25% 1 Month 14.30% Fixed Deposit")).toBe("Fixed Deposit");
    expect(tableHeading(`${"x".repeat(200)} Domestic term deposits`).length).toBeLessThanOrEqual(120);
  });
});

describe("headingScore", () => {
  it("prefers the product's own table and refuses lending, NRI-only and variant tables", () => {
    expect(headingScore("Rate of interest on domestic term deposits", "fd")).toBe(2);
    expect(headingScore("For Domestic & NRE*/NRO Retail Fixed Deposits (for amounts less than INR 2 Crore)", "fd")).toBe(2);
    expect(headingScore("RATE OF INTEREST ON NRE TERM DEPOSITS:", "fd")).toBeLessThan(0);
    expect(headingScore("Marginal Cost of Funds based Lending Rate (MCLR) with effect from Sep 15, 2018", "fd")).toBeLessThan(0);
    expect(headingScore("2. For Senior Citizen (for amounts less than INR 2 Crore)", "fd")).toBeLessThan(0);
    expect(headingScore("1.a) Non-callable Rates for Retail Fixed deposits of INR >=1 Crore", "fd")).toBeLessThan(0);
    expect(headingScore("Interest Rates", "fd")).toBe(0);
  });
});

describe("readTermTables", () => {
  it("skips an MCLR table that comes before the fixed deposit table", () => {
    const html = `<h3>Marginal Cost of Funds based Lending Rates (MCLR)</h3>${table([
      ["Tenure", "MCLR Rates"],
      ["1 Month", "14.30%"],
      ["3 Months", "14.50%"],
      ["6 Months", "14.65%"],
      ["1 Year", "14.80%"],
    ])}<h3>Fixed Deposit</h3>${table(fdRows(4))}`;
    const r = readTermTables(html, { amountMax: null, product: "fd" });
    expect(r.rows.map((x) => x.rate)).toEqual([4, 5, 6, 7]);
    expect(r.context).toContain("Fixed Deposit");
  });

  it("does not read an NRE table as domestic deposits, and ignores yield columns", () => {
    const nreFirst = `<p>Rate of interest on NRE term deposits:</p>${table(fdRows(9))}`;
    expect(readTermTables(nreFirst, { amountMax: null, product: "fd" }).rows).toHaveLength(0);
    const withYield = `<p>Domestic FD Rates</p>${table([
      ["Tenure", "Interest rate", "Annualised Yield"],
      ["181 - 210 days", "5.25%", "5.32%"],
      ["211 - 270 days", "5.25%", "5.32%"],
      ["271 - 364 days", "5.25%", "5.32%"],
      ["1 year to 18 months", "6.60%", "6.77%"],
    ])}`;
    expect(readTermTables(withYield, { amountMax: null, product: "fd" }).rows.map((x) => x.rate)).toEqual([5.25, 5.25, 5.25, 6.6]);
  });
});
