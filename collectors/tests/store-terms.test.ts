import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadTerms, storeTerms } from "../src/store";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("storeTerms", () => {
  it("records terms per product and rewrites only when they change", () => {
    dir = mkdtempSync(path.join(tmpdir(), "terms-"));
    const src = { key: "x-bank:fd", url: "https://x.bank.in/rates" };
    const terms = [{ product: "fd" as const, seniorPremium: "+0.50%", minAmount: 1000, compounding: undefined }];
    expect(storeTerms(dir, "x-bank", src, terms, "2026-09-27")).toBe(1);
    const first = readFileSync(path.join(dir, "data", "terms", "x-bank.json"), "utf8");
    // Same terms again (even with keys in another order): nothing changes, date stays.
    expect(storeTerms(dir, "x-bank", src, [{ product: "fd", minAmount: 1000, seniorPremium: "+0.50%" }], "2026-09-28")).toBe(0);
    expect(readFileSync(path.join(dir, "data", "terms", "x-bank.json"), "utf8")).toBe(first);
    // Changed premium: new entry with the new recorded date; empty fields are dropped.
    expect(storeTerms(dir, "x-bank", src, [{ product: "fd", minAmount: 1000, seniorPremium: "+0.60%" }], "2026-10-01")).toBe(1);
    const tf = loadTerms(dir, "x-bank");
    expect(tf.products.fd?.recordedOn).toBe("2026-10-01");
    expect(tf.products.fd?.terms).toEqual({ minAmount: 1000, seniorPremium: "+0.60%" });
    expect("compounding" in (tf.products.fd?.terms ?? {})).toBe(false);
  });
});
