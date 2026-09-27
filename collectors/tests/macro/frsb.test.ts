import { describe, expect, it } from "vitest";
import { extractCoupon, crossCheckAgainstPressRelease, run } from "../../src/macro/frsb";
import { ctxWithFixtures } from "./helpers";

describe("extractCoupon (genuine RBI press-release wording)", () => {
  it("reads the coupon from real FRSB 2020(T) press-release text", () => {
    const text =
      "Floating Rate Savings Bonds, 2020 (Taxable)- FRSB 2020 (T), the coupon/interest rate of the bond would be reset half yearly... " +
      "coupon rate on FRSB 2020 (T) for the period July 01, 2026, to December 31, 2026, and payable on January 01, 2027, remains at 8.05% (7.70%+0.35%), unchanged from the previous half-year.";
    expect(extractCoupon(text)).toBe(8.05);
  });

  it("cross-checks the documented formula's output against that real text", () => {
    // Real RBI press releases always pair "coupon rate ... remains at X%" (extractCoupon
    // anchors on "coupon...rate" so it can't mistake the 7.70%/0.35% inside the parenthetical
    // for the coupon itself); a bare "remains at 8.05%" fragment is not what RBI actually
    // publishes, so this reuses the same genuine clause as the test above.
    const text =
      "the coupon rate on FRSB 2020 (T) for the period July 01, 2026, to December 31, 2026, and payable on " +
      "January 01, 2027, remains at 8.05% (7.70%+0.35%), unchanged from the previous half-year.";
    expect(crossCheckAgainstPressRelease(text, 8.05).matches).toBe(true);
    expect(crossCheckAgainstPressRelease(text, 7.7).matches).toBe(false);
  });
});

describe("frsb run() against the real repo (read-only)", () => {
  it("has nothing to compute until NSC confirms a rate for the next half-year", async () => {
    // frsb_2020.json's last row runs through 2026-12-31; the next half-year it needs is
    // Jan-Jun 2027, which requires NSC's Jan-Mar 2027 quarter — not yet confirmed in nsc.json.
    const ctx = ctxWithFixtures({}, "2026-09-27");
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/NSC has not yet confirmed/);
  });
});
