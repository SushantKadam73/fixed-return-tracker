import { describe, expect, it } from "vitest";
import { kotakBulk, kotakFd, kotakRd, kotakSavings } from "../../src/adapters/kotak-mahindra-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.kotak.bank.in/en/rates/interest-rates.html"; // kotak.com redirects here (confirmed live 2026-09-27)
const src = { key: "kotak-mahindra-bank:try", bankSlug: "kotak-mahindra-bank", url, format: "browser" as const };
const fixture = "kotak-mahindra-bank/interest-rates.html";

describe("Kotak Mahindra Bank adapter", () => {
  it("reads the retail FD card (general + senior, below ₹3cr)", async () => {
    const out = await kotakFd(ctxFromFixture(src, fixture));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-09-23");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(2.75);
    expect(rateForTenure(fd.rows, 10, s)?.rate).toBe(3.25);
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.35); // 365 - <15 months
    expect(rateForTenure(fd.rows, 3000, s)?.rate).toBe(6.75); // 5-10 years
    expect(fd.rows.length).toBe(36); // 18 tenures x 2 customer types
  });

  it("reads the bulk card (₹3-5cr Regular/Senior + ₹5cr-300cr+ tiers, callable and non-callable)", async () => {
    const out = await kotakBulk(ctxFromFixture({ ...src, key: "kotak-mahindra-bank:fd_bulk" }, fixture));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-23");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * 1e7, customer: "general", callable: true })?.rate).toBe(2.75); // 3-5cr general
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * 1e7, customer: "senior", callable: true })?.rate).toBe(2.75); // 3-5cr senior
    expect(rateForTenure(bulk.rows, 10, { amount: 6 * 1e7, customer: "general", callable: true })?.rate).toBe(3.5); // 5-10cr
    expect(rateForTenure(bulk.rows, 275, { amount: 150 * 1e7, customer: "general", callable: true })?.rate).toBe(5); // 271-279 days, 100-300cr
    // Non-callable ₹3-5cr tier is entirely "NA" on the page (never published) — must not appear.
    expect(bulk.rows.some((r) => r.callable === false && r.amountMin === 3 * 1e7 && r.amountMax === 5 * 1e7)).toBe(false);
    // Non-callable ₹10-25cr at 91 days IS published (5.95%).
    const nc = bulk.rows.find((r) => r.callable === false && r.amountMin === 10 * 1e7 && r.tenureMinDays === 91);
    expect(nc?.rate).toBe(5.95);
    expect(rateForTenure(bulk.rows, 10, { amount: 1e5, customer: "general", callable: true })).toBeNull(); // below bulk threshold
  });

  it("reads RD from Kotak's own explicit RD table (not derived)", async () => {
    const out = await kotakRd(ctxFromFixture({ ...src, key: "kotak-mahindra-bank:rd" }, fixture));
    const rd = out.cards[0];
    expect(rd.product).toBe("rd");
    expect(rd.effectiveFrom).toBe("2026-09-23");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 365, { amount: 1000, customer: "general" })?.rate).toBe(6.35); // 12 months
    expect(rateForTenure(rd.rows, 365, { amount: 1000, customer: "senior" })?.rate).toBe(6.85);
    expect(rd.notes?.some((n) => /not derived/i.test(n))).toBe(true);
  });

  it("reads savings (flat 2.5% for resident, NRE and NRO)", async () => {
    const out = await kotakSavings(ctxFromFixture({ ...src, key: "kotak-mahindra-bank:savings" }, fixture));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2025-07-09");
    expect(c.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: null, rate: 2.5, residency: "resident" },
      { balanceMin: 0, balanceMax: null, rate: 2.5, residency: "nre" },
      { balanceMin: 0, balanceMax: null, rate: 2.5, residency: "nro" },
    ]);
    expect(hasErrors(validateCard(c))).toBe(false);
  });
});
