import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { karurVysyaBankBulk, karurVysyaBankFd, karurVysyaBankSavings } from "../../src/adapters/karur-vysya-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://www.kvb.bank.in/manager/api/v1/nro-deposit-rates";

describe("Karur Vysya Bank adapter", () => {
  it("reads the retail FD card (general + senior, Green Deposits and Flexi Term Deposit)", async () => {
    const out = await karurVysyaBankFd(ctxFromFixture({ key: "karur-vysya-bank:fd", bankSlug: "karur-vysya-bank", url: fdUrl, format: "json" }, "karur-vysya-bank/nro.json"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-08");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(4); // 7-14 days
    expect(rateForTenure(fd.rows, 333, g)?.rate).toBe(7); // special point tenure
    expect(rateForTenure(fd.rows, 333, g)?.special).toBe(true);
    expect(rateForTenure(fd.rows, 333, s)?.rate).toBe(7.5);
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(7.2); // special point tenure
    expect(rateForTenure(fd.rows, 300, g)?.rate).toBe(6.4); // "271 Days to 332 days" beats Flexi's 3.25% for the same day
    expect(rateForTenure(fd.rows, 100, s)).toBeNull(); // senior table has no row below 333 days
    expect(rateForTenure(fd.rows, 350, g)?.rate).toBe(6.4); // "334 Days to less than 1 year"

    const green = fd.rows.filter((r) => r.schemeName === "Green Deposits" && r.customer === "general");
    expect(green).toHaveLength(2); // resident + nro, same published number
    for (const row of green) {
      expect(row.tenureMinDays).toBe(2345);
      expect(row.tenureMaxDays).toBe(2345);
      expect(row.rate).toBe(6.25);
    }
    expect(fd.rows.some((r) => /tax shield/i.test(r.tenureLabel))).toBe(false);

    // Flexi Term Deposit: requested by the page's own JS, clearly labelled by the API as its
    // own block, general public only, duplicated across residency like the general rate.
    const flexi = fd.rows.filter((r) => r.schemeName === "Flexi Term Deposit");
    expect(flexi).toHaveLength(2); // resident + nro
    for (const row of flexi) {
      expect(row.tenureMinDays).toBe(300);
      expect(row.tenureMaxDays).toBe(300);
      expect(row.rate).toBe(3.25);
      expect(row.customer).toBe("general");
    }
    expect(flexi.some((r) => r.residency === "resident")).toBe(true);
    expect(flexi.some((r) => r.residency === "nro")).toBe(true);
    expect(fd.rows.some((r) => r.schemeName === "Flexi Term Deposit" && r.customer === "senior")).toBe(false);
  });

  it('labels the general-public rows "resident" AND "nro" (API title: "Resident / NRO Deposits"), but keeps senior-citizen rows Resident-only (NRI-excluded)', async () => {
    const out = await karurVysyaBankFd(ctxFromFixture({ key: "karur-vysya-bank:fd", bankSlug: "karur-vysya-bank", url: fdUrl, format: "json" }, "karur-vysya-bank/nro.json"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(hasErrors(validateCard(fd))).toBe(false);

    const generalResident = fd.rows.filter((r) => r.customer === "general" && r.residency === "resident");
    const generalNro = fd.rows.filter((r) => r.customer === "general" && r.residency === "nro");
    const seniorRows = fd.rows.filter((r) => r.customer === "senior");
    expect(generalResident).toHaveLength(18); // 16 tenures + Green Deposits + Flexi Term Deposit
    expect(generalNro).toHaveLength(18);
    expect(seniorRows.every((r) => r.residency === "resident")).toBe(true); // never "nro"
    expect(seniorRows).toHaveLength(8); // 7 tenures + Green Deposits (no senior Flexi figure)

    // Same tenure, same rate, only residency differs — not two independently-sourced numbers.
    const nroSeven = generalNro.find((r) => r.tenureMinDays === 7);
    const residentSeven = generalResident.find((r) => r.tenureMinDays === 7);
    expect(nroSeven?.rate).toBe(residentSeven?.rate);
    expect(nroSeven?.rate).toBe(4);

    expect(fd.notes?.some((n) => /resident \/ nro deposits/i.test(n))).toBe(true);
  });

  it('throws if the API\'s own "title" no longer reads "Resident / NRO Deposits" (residency scope can no longer be confirmed)', async () => {
    const json = readFileSync(join(__dirname, "../../fixtures/karur-vysya-bank/nro.json"), "utf8").replace('"title": "Resident / NRO Deposits"', '"title": "Resident Deposits"');
    await expect(
      karurVysyaBankFd({
        source: { key: "karur-vysya-bank:fd", bankSlug: "karur-vysya-bank", products: [], url: fdUrl, format: "json", runner: "github", adapter: "karur-vysya-bank.fd", cadence: "daily", active: true },
        doc: { url: fdUrl, finalUrl: fdUrl, status: 200, contentType: "application/json", text: json, fetchedAt: Date.now() },
        today: "2026-09-27",
        fetch: async () => {
          throw new Error("not used");
        },
      }),
    ).rejects.toThrow(/resident \/ nro deposits/i);
  });

  it("throws on invalid JSON rather than guess", async () => {
    await expect(
      karurVysyaBankFd({
        source: { key: "karur-vysya-bank:fd", bankSlug: "karur-vysya-bank", products: [], url: fdUrl, format: "json", runner: "github", adapter: "karur-vysya-bank.fd", cadence: "daily", active: true },
        doc: { url: fdUrl, finalUrl: fdUrl, status: 200, contentType: "application/json", text: "not json", fetchedAt: Date.now() },
        today: "2026-09-27",
        fetch: async () => {
          throw new Error("not used");
        },
      }),
    ).rejects.toThrow(/not valid JSON/i);
  });

  it("derives RD from FD because KVB's policy states RD rates equal FD rates, keeping both residencies and excluding named/special schemes", async () => {
    const out = await karurVysyaBankFd(ctxFromFixture({ key: "karur-vysya-bank:fd", bankSlug: "karur-vysya-bank", url: fdUrl, format: "json" }, "karur-vysya-bank/nro.json"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(rd.rows.length).toBeGreaterThan(0);
    expect(rd.notes?.some((n) => /derived/i.test(n) && /differential pricing/i.test(n))).toBe(true);
    expect(rd.rows.some((r) => r.residency === "nro")).toBe(true);
    expect(rd.rows.some((r) => r.customer === "senior" && r.residency === "nro")).toBe(false);
    expect(rd.rows.some((r) => r.schemeName === "Flexi Term Deposit")).toBe(false); // special rows are excluded
    expect(rd.rows.some((r) => r.schemeName === "Green Deposits")).toBe(false);
  });

  it("reads the bulk card (6 amount tiers x premature-allowed/not-allowed)", async () => {
    const out = await karurVysyaBankBulk(ctxFromFixture({ key: "karur-vysya-bank:fd_bulk", bankSlug: "karur-vysya-bank", url: "https://www.kvb.bank.in/manager/api/v1/bulk-deposit-rates", format: "json" }, "karur-vysya-bank/bulk.json"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-27");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(rateForTenure(bulk.rows, 10, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(4); // 7-14 days, 3-5cr tier
    expect(rateForTenure(bulk.rows, 365, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(6.75); // 12 months, 3-5cr allowed
    expect(rateForTenure(bulk.rows, 365, { amount: 4e7, customer: "general", callable: false })?.rate).toBe(7.0); // 12 months, 3-5cr not-allowed
    expect(rateForTenure(bulk.rows, 365, { amount: 6e7, customer: "general", callable: true })?.rate).toBe(7.0); // 12 months, 5-10cr allowed
    expect(rateForTenure(bulk.rows, 20, { amount: 150 * 1e7, customer: "general", callable: true })?.rate).toBe(5.9); // 15-30 days, 100cr+ tier
    expect(rateForTenure(bulk.rows, 10, { amount: 1e5, customer: "general", callable: true })).toBeNull(); // below bulk threshold
    // "271 to < 1 Year" — bulk-specific missing-unit tenure label, must still resolve.
    expect(rateForTenure(bulk.rows, 300, { amount: 4e7, customer: "general", callable: true })?.rate).toBe(6.25);
  });

  it("reads savings slabs (9 bands, prefix-stripped amount parsing)", async () => {
    const out = await karurVysyaBankSavings(ctxFromFixture({ key: "karur-vysya-bank:savings", bankSlug: "karur-vysya-bank", url: "https://www.kvb.bank.in/manager/api/v1/savings-interest-rates", format: "json" }, "karur-vysya-bank/savings.json"));
    const c = out.cards[0];
    expect(c.effectiveFrom).toBe("2026-01-15");
    expect(c.slabMethod).toBe("unknown");
    expect(c.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100_001, rate: 2, residency: "resident" },
      { balanceMin: 100_001, balanceMax: 500_000, rate: 2, residency: "resident" },
      { balanceMin: 500_000, balanceMax: 1_000_000, rate: 2.5, residency: "resident" },
      { balanceMin: 1_000_000, balanceMax: 1_00_00_000, rate: 3, residency: "resident" },
      { balanceMin: 1_00_00_000, balanceMax: 50_00_00_000, rate: 3.25, residency: "resident" },
      { balanceMin: 50_00_00_000, balanceMax: 100_00_00_000, rate: 5, residency: "resident" },
      { balanceMin: 100_00_00_000, balanceMax: 150_00_00_000, rate: 5, residency: "resident" },
      { balanceMin: 150_00_00_000, balanceMax: 250_00_00_000, rate: 5, residency: "resident" },
      { balanceMin: 250_00_00_000, balanceMax: null, rate: 6.75, residency: "resident" },
    ]);
    expect(hasErrors(validateCard(c))).toBe(false);
  });
});
