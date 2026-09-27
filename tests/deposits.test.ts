import { describe, expect, it } from "vitest";
import { fdMaturity, fdPayout, rdMaturity, realRate, savingsBlendedRate, savingsYearInterest } from "@/lib/calc/deposits";
import { inflationAdjust } from "@/lib/calc/real-value";
import type { SavingsSlab } from "@/lib/domain";

describe("FD maths", () => {
  it("compounds quarterly for one year", () => {
    const r = fdMaturity(1_00_000, 7, 365);
    expect(r.method).toBe("quarterly_compounding");
    expect(r.maturity).toBeCloseTo(107185.9, 0);
    expect(r.effectiveAnnualYield).toBeCloseTo(7.186, 2);
  });
  it("uses simple interest for short deposits", () => {
    const r = fdMaturity(1_00_000, 6, 90);
    expect(r.method).toBe("simple");
    expect(r.interest).toBeCloseTo(1479.45, 1);
  });
  it("pays discounted monthly interest", () => {
    expect(fdPayout(1_00_000, 7, "quarterly")).toBeCloseTo(1750, 6);
    expect(fdPayout(1_00_000, 7, "monthly")).toBeCloseTo(579.9, 1);
  });
});

describe("RD maths", () => {
  it("matches the usual bank RD result", () => {
    const r = rdMaturity(1000, 7, 12);
    expect(r.deposited).toBe(12000);
    expect(r.maturity).toBeGreaterThan(12450);
    expect(r.maturity).toBeLessThan(12480);
  });
});

describe("savings slabs", () => {
  const slabs: SavingsSlab[] = [
    { balanceMin: 0, balanceMax: 10_00_000, rate: 2.7, residency: "resident" },
    { balanceMin: 10_00_000, balanceMax: null, rate: 3.0, residency: "resident" },
  ];
  it("blends incremental slabs", () => {
    expect(savingsBlendedRate(20_00_000, slabs, "incremental")).toBeCloseTo(2.85, 6);
  });
  it("applies the whole-balance slab", () => {
    expect(savingsBlendedRate(20_00_000, slabs, "whole")).toBe(3.0);
  });
  it("credits interest quarterly", () => {
    const i = savingsYearInterest(1_00_000, slabs, "whole");
    expect(i).toBeGreaterThan(2700);
    expect(i).toBeLessThan(2730);
  });
});

describe("real value", () => {
  it("adjusts by the index ratio", () => {
    const r = inflationAdjust(1000, "2000-01", "2020-01", [
      { date: "2000-01", value: 100 },
      { date: "2020-01", value: 300 },
    ]);
    expect(r?.equivalent).toBe(3000);
    expect(r?.annualisedInflationPct).toBeCloseTo(5.65, 1);
  });
  it("returns null rather than guessing a missing period", () => {
    expect(inflationAdjust(1000, "1999-01", "2020-01", [{ date: "2020-01", value: 300 }])).toBeNull();
  });
  it("computes real rates", () => {
    expect(realRate(7, 5)).toBeCloseTo(1.905, 2);
  });
});
