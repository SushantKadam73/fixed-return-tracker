import { describe, expect, it } from "vitest";
import type { RateRow } from "@/lib/domain";
import { TENURE_BUCKETS, bestInBucket, bucketForDays, rateForTenure, toDays } from "@/lib/tenure";

const base = { amountMin: 0, amountMax: 3_00_00_000, residency: "resident" as const, callable: true };
const rows: RateRow[] = [
  { ...base, tenureMinDays: 365, tenureMaxDays: 729, tenureLabel: "1 year to less than 2 years", customer: "general", rate: 6.25 },
  { ...base, tenureMinDays: 444, tenureMaxDays: 444, tenureLabel: "444 days", special: true, schemeName: "Amrit Vrishti", customer: "general", rate: 6.45 },
  { ...base, tenureMinDays: 365, tenureMaxDays: 729, tenureLabel: "1 year to less than 2 years", customer: "senior", rate: 6.75 },
  { ...base, tenureMinDays: 730, tenureMaxDays: 1094, tenureLabel: "2 years to less than 3 years", customer: "general", rate: 6.4 },
];
const general = { amount: 1_00_000, customer: "general" as const };
const bucket = (key: string) => TENURE_BUCKETS.find((b) => b.key === key)!;

describe("tenure buckets", () => {
  it("places special tenures where the user expects", () => {
    expect(bucketForDays(444)?.key).toBe("m12_15");
    expect(bucketForDays(555)?.key).toBe("m18_21");
    expect(bucketForDays(365)?.key).toBe("m12_15");
    expect(bucketForDays(729)?.key).toBe("m21_24");
    expect(bucketForDays(730)?.key).toBe("y2_3");
  });
  it("buckets are contiguous and non-overlapping", () => {
    for (let i = 1; i < TENURE_BUCKETS.length; i++) {
      expect(TENURE_BUCKETS[i].minDays).toBe(TENURE_BUCKETS[i - 1].maxDays + 1);
    }
  });
  it("converts months to bank-style days", () => {
    expect(toDays({ months: 12 })).toBe(365);
    expect(toDays({ years: 2 })).toBe(730);
  });
});

describe("normalised comparison", () => {
  it("picks the special tenure when it pays more, and flags it", () => {
    const r = bestInBucket(rows, bucket("m12_15"), general);
    expect(r.rate).toBe(6.45);
    expect(r.tenureLabel).toBe("444 days");
    expect(r.specificTenureOnly).toBe(true);
  });
  it("falls back to the regular slab where no special tenure exists", () => {
    const r = bestInBucket(rows, bucket("m15_18"), general);
    expect(r.rate).toBe(6.25);
    expect(r.coversWholeBucket).toBe(true);
    expect(r.specificTenureOnly).toBe(false);
  });
  it("never mixes customer types", () => {
    expect(bestInBucket(rows, bucket("m15_18"), { amount: 1_00_000, customer: "senior" }).rate).toBe(6.75);
  });
  it("reports not offered instead of zero", () => {
    const r = bestInBucket(rows, bucket("d7_45"), general);
    expect(r.status).toBe("not_offered");
    expect(r.rate).toBeNull();
  });
  it("respects amount bands", () => {
    expect(bestInBucket(rows, bucket("m12_15"), { amount: 5_00_00_000, customer: "general" }).status).toBe("not_offered");
  });
  it("finds the rate for an exact tenure", () => {
    expect(rateForTenure(rows, 444, general)?.rate).toBe(6.45);
    expect(rateForTenure(rows, 500, general)?.rate).toBe(6.25);
    expect(rateForTenure(rows, 30, general)).toBeNull();
  });
});
