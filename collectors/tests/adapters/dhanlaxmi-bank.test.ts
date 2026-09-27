import { describe, expect, it } from "vitest";
import { dhanlaxmiBulk, dhanlaxmiFd, dhanlaxmiSavings } from "../../src/adapters/dhanlaxmi-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.dhan.bank.in/interest-rates/";
const ctx = () => ctxFromFixture({ key: "dhanlaxmi-bank:try", bankSlug: "dhanlaxmi-bank", url }, "dhanlaxmi-bank/interest-rates.html");

const LAKH = 1e5;
const CRORE = 1e7;

describe("Dhanlaxmi Bank adapter", () => {
  it("reads the retail FD card and derives senior rows only at/above the footnote's floor tenure", async () => {
    const out = await dhanlaxmiFd(ctx());
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-02");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 50_000, customer: "general" as const };
    const s = { amount: 50_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(4); // 7-14 days
    expect(rateForTenure(fd.rows, 10, s)).toBeNull(); // below the 365-day floor: no senior row published
    expect(rateForTenure(fd.rows, 292, g)?.rate).toBe(6.5); // "292 Days" special tenure
    const oneYear = rateForTenure(fd.rows, 400, g); // "1 Year and above upto & inclusive of 2 years"
    expect(oneYear?.rate).toBe(6.25);
    expect(rateForTenure(fd.rows, 400, s)?.rate).toBe(6.75); // +0.50pp, at/above the floor
    expect(rateForTenure(fd.rows, 1111, g)?.rate).toBe(7.25); // "1111 Days" special tenure
    expect(rateForTenure(fd.rows, 1111, s)?.rate).toBe(7.75);
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(6.6); // "Above 5 years upto & inclusive of 10 years"
    expect(rateForTenure(fd.rows, 3000, s)?.rate).toBe(7.1);

    // Retail non-callable, >₹1cr-<₹3cr, one tenure ("12 months to 13 months").
    const ncGeneral = { amount: 1.5 * CRORE, customer: "general" as const };
    const ncRow = rateForTenure(fd.rows, 380, ncGeneral);
    expect(ncRow?.rate).toBe(7);
    expect(ncRow?.callable).toBe(false);
    expect(rateForTenure(fd.rows, 380, { amount: 1.5 * CRORE, customer: "senior" })?.rate).toBe(7.5); // same footnote premium applies
  });

  it("reads both bulk tables (Regular/callable and Non-Callable) with contiguous amount bands despite the page's inconsistent 'upto'/'above' wording at each boundary", async () => {
    const out = await dhanlaxmiBulk(ctx());
    const bulk = out.cards[0];
    expect(bulk.product).toBe("fd_bulk");
    expect(bulk.effectiveFrom).toBe("2026-09-23");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    const midBand = { amount: 4 * CRORE, customer: "general" as const };
    expect(rateForTenure(bulk.rows, 10, { ...midBand, callable: true })?.rate).toBe(4.5); // ₹3-<5cr, 7-14 days
    expect(rateForTenure(bulk.rows, 10, { ...midBand, callable: false })?.rate).toBe(4.5);
    // The ₹10cr / ₹50cr boundaries are worded inconsistently ("upto ₹10cr" then a bare "₹10cr",
    // vs "upto ₹50cr" then "Above ₹50cr") — chainBands() must still make them meet with no gap.
    expect(rateForTenure(bulk.rows, 10, { amount: 10 * CRORE, customer: "general", callable: true })?.rate).toBe(4.5);
    expect(rateForTenure(bulk.rows, 10, { amount: 10 * CRORE + 1, customer: "general", callable: true })?.rate).toBe(4.5);
    expect(rateForTenure(bulk.rows, 10, { amount: 50 * CRORE, customer: "general", callable: true })?.rate).toBe(4.5);
    expect(rateForTenure(bulk.rows, 10, { amount: 50 * CRORE + 1, customer: "general", callable: true })?.rate).toBe(4.5);
    // Non-callable only starts from "12m to 13m" / "370 Days" on this table.
    expect(rateForTenure(bulk.rows, 380, { ...midBand, callable: false })?.rate).toBe(7);
    expect(rateForTenure(bulk.rows, 370, { ...midBand, callable: false })?.rate).toBe(7.1); // "370 Days" special tenure
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * CRORE, customer: "senior" })).toBeNull(); // no senior benefit on bulk
  });

  it("reads the savings slabs (domestic; NRO/NRE publish the same rates per the table's own rows)", async () => {
    const out = await dhanlaxmiSavings(ctx());
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-07-01");
    expect(card.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toHaveLength(8);
    expect(card.savingsSlabs?.[0]).toEqual({ balanceMin: 0, balanceMax: LAKH + 1, rate: 2.5, residency: "resident" });
    // Boundary worded as "upto ₹5 Lakh" then "Above ₹5 Lakh" on the next slab — ₹5,00,000 itself
    // must land in exactly one of them (chainBands(), not the raw "above"/"upto" text).
    expect(card.savingsSlabs?.[1]).toEqual({ balanceMin: LAKH + 1, balanceMax: 5 * LAKH + 1, rate: 2.75, residency: "resident" });
    expect(card.savingsSlabs?.[2].balanceMin).toBe(5 * LAKH + 1);
    expect(card.savingsSlabs?.at(-1)).toEqual({ balanceMin: 100 * CRORE + 1, balanceMax: null, rate: 4, residency: "resident" });
  });
});
