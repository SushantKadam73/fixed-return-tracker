import { describe, expect, it } from "vitest";
import { addMonths, epfMonthlyFromPay, fyOf, rateForMonth, simulateEPF, simulateNPS, simulatePPF, type RatePeriod } from "@/lib/calc/retirement";

const ppf71: RatePeriod[] = [{ from: "2020-04-01", to: "2026-09-30", rate: 7.1 }];

describe("helpers", () => {
  it("handles months and financial years", () => {
    expect(addMonths("2025-11", 3)).toBe("2026-02");
    expect(fyOf("2026-03")).toBe("2025-26");
    expect(fyOf("2026-04")).toBe("2026-27");
  });
  it("uses the assumption only after the last known period", () => {
    expect(rateForMonth(ppf71, "2026-09", 6)).toEqual({ rate: 7.1, assumed: false });
    expect(rateForMonth(ppf71, "2026-10", 6)).toEqual({ rate: 6, assumed: true });
    expect(rateForMonth(ppf71, "2019-01", 6)).toEqual({ rate: null, assumed: false });
  });
});

describe("PPF", () => {
  it("matches the standard 15-year result for ₹1.5 lakh deposited each April at 7.1%", () => {
    const r = simulatePPF({ start: "2026-04", end: "2041-03", monthly: 0, aprilLumpSum: 150000, periods: [], futureRate: 7.1 });
    expect(r.gap).toBeNull();
    expect(r.contributed).toBe(2250000);
    expect(r.balance).toBeGreaterThan(4067500);
    expect(r.balance).toBeLessThan(4069500);
    expect(r.rows).toHaveLength(15);
  });
  it("stops at a missing historical rate instead of guessing", () => {
    const r = simulatePPF({ start: "2019-01", end: "2021-03", monthly: 1000, periods: ppf71, futureRate: 7.1 });
    expect(r.gap).toMatch(/2019-01/);
  });
});

describe("EPF", () => {
  it("credits interest on the monthly running balance", () => {
    const r = simulateEPF({ start: "2025-04", end: "2026-03", monthlyIntoEpf: () => 10000, periods: [{ from: "2025-04-01", to: "2026-03-31", rate: 8.25 }], futureRate: 8 });
    expect(r.interest).toBeCloseTo(5362.5, 2);
    expect(r.balance).toBeCloseTo(125362.5, 2);
  });
  it("splits pay into employee, employer and pension shares", () => {
    const s = epfMonthlyFromPay(20000);
    expect(s.employee).toBe(2400);
    expect(s.eps).toBeCloseTo(1249.5, 6);
    expect(s.intoEpf).toBeCloseTo(3550.5, 6);
  });
});

describe("NPS", () => {
  it("values units at NAV and projects after the last NAV", () => {
    const navs: Array<[string, number]> = [
      ["2025-04-01", 10],
      ["2025-05-01", 10],
      ["2025-06-02", 11],
    ];
    const r = simulateNPS({ start: "2025-04", end: "2025-06", monthly: 1000, allocation: [{ key: "E", weight: 1, navs, futureReturn: 10 }] });
    expect(r.gap).toBeNull();
    expect(r.balance).toBeCloseTo((100 + 100) * 11 + 1000, 6);
    const later = simulateNPS({ start: "2025-06", end: "2026-06", monthly: 0, allocation: [{ key: "E", weight: 1, navs, futureReturn: 10 }] });
    expect(later.usedAssumption).toBe(true);
  });
});
