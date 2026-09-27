import { describe, expect, it } from "vitest";
import { formatDateIST, formatINR, formatINRCompact, formatRate, formatRateDelta, formatTenureDays, formatUSDCompact, todayIST } from "@/lib/format";

describe("Indian number formatting", () => {
  it("groups rupees the Indian way", () => {
    expect(formatINR(1234567)).toBe("₹12,34,567");
    expect(formatINR(-5000)).toBe("−₹5,000");
    expect(formatINR(null)).toBe("not reported");
  });
  it("uses lakh / crore / lakh crore units", () => {
    expect(formatINRCompact(85000)).toBe("₹85,000");
    expect(formatINRCompact(1234567)).toBe("₹12.35 lakh");
    expect(formatINRCompact(32000000)).toBe("₹3.2 crore");
    expect(formatINRCompact(12_50_00_00_000)).toBe("₹1,250 crore");
    expect(formatINRCompact(1.2e12)).toBe("₹1.2 lakh crore");
  });
  it("uses million / billion for USD", () => {
    expect(formatUSDCompact(1_200_000)).toBe("$1.2 million");
    expect(formatUSDCompact(3_450_000_000)).toBe("$3.45 billion");
    expect(formatUSDCompact(950)).toBe("$950");
  });
  it("formats rates and deltas", () => {
    expect(formatRate(7.1)).toBe("7.10%");
    expect(formatRate(undefined)).toBe("not reported");
    expect(formatRateDelta(0.5)).toBe("+0.50 pp");
    expect(formatRateDelta(-0.25)).toBe("−0.25 pp");
  });
  it("formats IST dates without shifting calendar days", () => {
    expect(formatDateIST("2025-12-15")).toBe("15 Dec 2025");
    expect(todayIST(new Date("2026-09-26T20:00:00Z"))).toBe("2026-09-27");
  });
  it("labels tenures", () => {
    expect(formatTenureDays(444)).toBe("444 days");
    expect(formatTenureDays(730)).toBe("2 years");
  });
});
