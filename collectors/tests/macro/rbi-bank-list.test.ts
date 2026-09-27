import { describe, expect, it } from "vitest";
import { normalizeBankName, parseBanksInIndia, run, BANKS_IN_INDIA_URL } from "../../src/macro/rbi-bank-list";
import { fixture, ctxWithFixtures } from "./helpers";

describe("parseBanksInIndia (genuine RBI page, captured live on 2026-09-27)", () => {
  const groups = parseBanksInIndia(fixture("banksinindia.html"));

  it("finds SBI plus every nationalised bank in one group", () => {
    // RBI's own markup has a stray double space ("State Bank of  India"); cleanText collapses
    // all whitespace runs to one, same as it does for every other name on this page, so the
    // parsed name is single-spaced (normalizeBankName's own test below confirms the two forms
    // are treated as equivalent either way).
    expect(groups.sbi_nationalised).toContain("State Bank of India");
    expect(groups.sbi_nationalised).toContain("Bank of Baroda");
    expect(groups.sbi_nationalised).toContain("Canara Bank");
    expect(groups.sbi_nationalised.length).toBeGreaterThanOrEqual(11);
  });

  it("finds domestic private banks (not the TOC's plain-text mention, only the real header)", () => {
    expect(groups.private).toContain("Axis Bank Limited");
    expect(groups.private).toContain("CSB Bank Limited");
  });

  it("finds small finance banks and payments banks in their own groups", () => {
    expect(groups.sfb).toContain("Au Small Finance Bank Limited");
    expect(groups.sfb).toContain("Equitas Small Finance Bank Limited");
    expect(groups.payments).toContain("Airtel Payments Bank Limited");
    expect(groups.payments).toContain("India Post Payments Bank Limited");
  });
});

describe("normalizeBankName", () => {
  it.each([
    ["Au Small Finance Bank Limited", "AU Small Finance Bank"],
    ["State Bank of  India", "State Bank of India"],
    ["The Andaman and Nicobar State Co-operative Bank Ltd.", "andaman and nicobar state co-operative bank"],
  ])("%s ~ %s", (a, b) => {
    expect(normalizeBankName(a)).toBe(normalizeBankName(b));
  });
});

describe("rbi-bank-list run() against the real repo (read-only)", () => {
  it("finds the same banks RBI lists already committed in data/banks/banks.json, in every one of the four groups", async () => {
    const ctx = ctxWithFixtures({ [BANKS_IN_INDIA_URL]: fixture("banksinindia.html") });
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    const change = result.changes.find((c) => c.kind === "banks_watch");
    expect(change).toBeDefined();
    if (change?.kind === "banks_watch") {
      expect(change.additions).toEqual([]);
      expect(change.removals).toEqual([]);
    }
  });
});
