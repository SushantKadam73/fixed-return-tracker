import { describe, expect, it } from "vitest";
import { idbiBulk, idbiFd, idbiRd, idbiSavings } from "../../src/adapters/idbi-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

// www.idbibank.in and www.idbi.bank.in both returned HTTP 502 to every direct-fetch attempt from
// this sandbox on 2026-09-27 (two domain aliases, two retries a few minutes apart); the platform
// browser tool could not hold a stable session for this page in this run either. Built and tested
// from a genuine copy of the same official page instead: the Internet Archive Wayback Machine
// capture at https://web.archive.org/web/20260730071451id_/https://www.idbi.bank.in/interest-rates.aspx
// (captured 2026-07-30, the most recent HTTP-200 capture found via the CDX API on 2026-09-27).
const url = "https://www.idbi.bank.in/interest-rates.aspx";
const ctx = () => ctxFromFixture({ key: "idbi-bank:fd", bankSlug: "idbi-bank", url }, "idbi-bank/interest_rates.html");

describe("IDBI Bank adapter", () => {
  it("reads the retail FD card, including named schemes and the promotional Utsav/Chiranjeevi buckets", async () => {
    const out = await idbiFd(ctx());
    const fd = out.cards[0];
    expect(fd.product).toBe("fd");
    expect(fd.effectiveFrom).toBe("2026-02-23");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 20, g)?.rate).toBe(3.0); // 07-30 days
    expect(rateForTenure(fd.rows, 20, s)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.2); // "1 Year"
    expect(rateForTenure(fd.rows, 365, s)?.rate).toBe(6.7);
    expect(rateForTenure(fd.rows, 500, g)?.rate).toBe(6.25); // ">1 Year to 2 Years (except 555 days & 700 Days)"
    expect(rateForTenure(fd.rows, 3650, g)?.rate).toBe(5.9); // ">7 years to 10 years"
    expect(rateForTenure(fd.rows, 4000, g)).toBeNull(); // beyond the 10-year model; the restricted >10-20yr row is excluded

    // Vasundhara Green Deposit (1111 days) — picked up by the generic pass via schemeNames.
    const vasundhara = fd.rows.filter((r) => r.tenureMinDays === 1111);
    expect(vasundhara.map((r) => [r.customer, r.rate, r.schemeName, r.special]).sort()).toEqual(
      [
        ["general", 6.35, "Vasundhara Green Deposit", true],
        ["senior", 6.85, "Vasundhara Green Deposit", true],
      ].sort(),
    );

    // Tax Saving FD ("5 Years", capital Y) must not collide with the ordinary "5 years" bucket.
    const taxSaving = fd.rows.filter((r) => r.schemeName === "Tax Saving FD");
    expect(taxSaving.map((r) => [r.customer, r.rate, r.tenureMinDays]).sort()).toEqual(
      [
        ["general", 6.25, 1825],
        ["senior", 6.75, 1825],
      ].sort(),
    );
    expect(rateForTenure(fd.rows, 1825, g)?.rate).toBe(6.25); // the ordinary "5 years" bucket is unaffected

    // Aarogya Fixed Deposit (370 days): general only — the source HTML repeats the one figure
    // across both columns via a colspan, which is not a genuine senior premium.
    const aarogya = fd.rows.filter((r) => r.schemeName === "Aarogya Fixed Deposit");
    expect(aarogya).toHaveLength(1);
    expect(aarogya[0].customer).toBe("general");
    expect(aarogya[0].rate).toBe(6.1);
    // 370 days also falls inside the ordinary ">1 Year to 2 Years" bucket, so a senior rate does
    // exist at that day (6.75, from the regular bucket) -- just never one labelled Aarogya.
    expect(fd.rows.some((r) => r.schemeName === "Aarogya Fixed Deposit" && r.customer === "senior")).toBe(false);

    // Utsav FD promotional buckets (555 / 700 days), General + Senior.
    const utsav = fd.rows.filter((r) => r.schemeName === "Utsav FD");
    expect(utsav.map((r) => [r.tenureMinDays, r.customer, r.rate]).sort()).toEqual(
      [
        [555, "general", 6.4],
        [555, "senior", 6.9],
        [700, "general", 6.45],
        [700, "senior", 6.95],
      ].sort(),
    );

    // IDBI Chiranjeevi Super Senior Citizen FD, tied to the same 555/700-day Utsav buckets.
    const chiranjeevi = fd.rows.filter((r) => r.schemeName === "IDBI Chiranjeevi Super Senior Citizen FD");
    expect(chiranjeevi.map((r) => [r.tenureMinDays, r.customer, r.rate]).sort()).toEqual(
      [
        [555, "super_senior", 7.05],
        [700, "super_senior", 7.1],
      ].sort(),
    );
  });

  it("reads the Systematic Savings Plan (SSP) as the RD card, sourced from its own table", async () => {
    const out = await idbiRd(ctx());
    const rd = out.cards[0];
    expect(rd.product).toBe("rd");
    expect(rd.effectiveFrom).toBe("2026-02-23");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows).toHaveLength(14); // 7 maturity slabs x General/Senior

    const g = { amount: 1000, customer: "general" as const };
    const s = { amount: 1000, customer: "senior" as const };
    expect(rateForTenure(rd.rows, 365, g)?.rate).toBe(6.2); // "1 Year" — matches the FD table's own general rate
    expect(rateForTenure(rd.rows, 365, s)?.rate).toBe(6.7);
    expect(rateForTenure(rd.rows, 2000, g)?.rate).toBe(5.95); // ">5 years to 7 years"
    expect(rd.rows.every((r) => r.callable === true)).toBe(true);
  });

  it("reads the savings slabs, excluding the floating MIBOR-linked slabs above ₹500 crore", async () => {
    const out = await idbiSavings(ctx());
    const card = out.cards[0];
    expect(card.product).toBe("savings");
    expect(card.effectiveFrom).toBe("2025-08-18");
    expect(card.slabMethod).toBe("unknown");
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 1_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 1_00_001, balanceMax: 5_00_001, rate: 2.55, residency: "resident" },
      { balanceMin: 5_00_001, balanceMax: 5 * 1e7 + 1, rate: 2.6, residency: "resident" },
      { balanceMin: 5 * 1e7 + 1, balanceMax: 100 * 1e7 + 1, rate: 3.0, residency: "resident" },
      { balanceMin: 100 * 1e7 + 1, balanceMax: 500 * 1e7 + 1, rate: 3.0, residency: "resident" },
    ]);
  });

  it("reads the bulk (≥₹3cr) card, callable + non-callable, with a per-tier amount split", async () => {
    const out = await idbiBulk(ctx());
    const card = out.cards[0];
    expect(card.product).toBe("fd_bulk");
    expect(card.effectiveFrom).toBe("2026-07-29");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.rows.every((r) => r.customer === "general")).toBe(true); // no senior column on either bulk table
    expect(card.rows.filter((r) => r.callable === true)).toHaveLength(105); // 15 callable maturity slabs x 7 amount tiers
    expect(card.rows.filter((r) => r.callable === false)).toHaveLength(49); // 7 non-callable maturity slabs x 7 amount tiers

    expect(rateForTenure(card.rows, 10, { amount: 4 * 1e7, customer: "general", callable: true })?.rate).toBe(4.01); // 7-14 days, ₹3-7.5cr
    expect(rateForTenure(card.rows, 10, { amount: 4 * 1e7, customer: "general", callable: false })).toBeNull(); // non-callable starts at 91 days
    expect(rateForTenure(card.rows, 100, { amount: 4 * 1e7, customer: "general", callable: false })?.rate).toBe(6.41); // 91-180 days, ₹3-7.5cr
    expect(rateForTenure(card.rows, 3000, { amount: 600 * 1e7, customer: "general", callable: true })?.rate).toBe(6.21); // >36mnth-5yr, ≥₹500cr
    expect(rateForTenure(card.rows, 10, { amount: 2 * 1e7, customer: "general" })).toBeNull(); // below ₹3cr bulk threshold
  });
});
