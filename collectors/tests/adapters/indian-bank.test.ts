import { describe, expect, it } from "vitest";
import { indianBankBulk, indianBankFd, indianBankSavings, indianBankTaxSaver } from "../../src/adapters/indian-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
// Confirmed current canonical URL (see file header note in indian-bank.ts): the old
// "/departments/deposit-rates/" path is a dead end (302s to a path that then 502s).
const url = "https://indianbank.bank.in/en/deposit-rates";

describe("Indian Bank adapter", () => {
  it("reads the retail card: General Public rates plus the four named schemes", async () => {
    const out = await indianBankFd(ctxFromFixture({ key: "indian-bank:fd", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-08-04");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(24);

    const oneYear = fd.rows.find((r) => r.tenureMinDays === 365 && !r.schemeName);
    expect(oneYear).toMatchObject({ rate: 6.1, customer: "general" });

    // "IND Supreme 2.0(300 days)" has the day count only inside "(...)" — parseTenure would
    // strip it; the adapter reads it with its own regex (see file header note).
    const supreme = fd.rows.filter((r) => r.schemeName === "IND Supreme 2.0");
    expect(supreme).toHaveLength(1); // its own breakdown table on the bank's page has no rows
    expect(supreme[0]).toMatchObject({ tenureMinDays: 300, rate: 6.2, customer: "general" });
  });

  it("adds Senior/Super Senior rows for IND Green, IND Grow and IND Prosper from their own small tables", async () => {
    const out = await indianBankFd(ctxFromFixture({ key: "indian-bank:fd", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html"));
    const fd = out.cards[0];
    const grow = fd.rows.filter((r) => r.schemeName === "IND Grow");
    expect(grow.map((r) => [r.customer, r.rate]).sort()).toEqual([
      ["general", 6.65],
      ["senior", 7.15],
      ["super_senior", 7.4],
    ]);
    // The bank spells this scheme "Prosper" in the main table and "Proposer" in its own
    // table's heading — both spellings are read as the same scheme.
    const prosper = fd.rows.filter((r) => r.schemeName === "IND Prosper");
    expect(prosper.map((r) => [r.customer, r.rate]).sort()).toEqual([
      ["general", 6.6],
      ["senior", 7.1],
      ["super_senior", 7.35],
    ]);
    expect(fd.notes?.some((n) => /IND Green.*2026-06-05/.test(n))).toBe(true);
  });

  it("reads the bulk card (₹3-5cr, callable + non-callable) with its own date pulled from a heading paragraph outside the table", async () => {
    const out = await indianBankBulk(ctxFromFixture({ key: "indian-bank:fd_bulk", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(28);
    const d7 = bulk.rows.filter((r) => r.tenureMinDays === 7);
    expect(d7.map((r) => [r.callable, r.rate, r.amountMin, r.amountMax])).toEqual([
      [true, 7.5, 3 * CRORE, 5 * CRORE],
      [false, 7.5, 3 * CRORE, 5 * CRORE],
    ]);
  });

  it('derives tax_saver from the retail card\'s "5 year" row, general-public only, per the page\'s own rate-parity statement', async () => {
    const out = await indianBankTaxSaver(ctxFromFixture({ key: "indian-bank:tax_saver", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html"));
    const taxSaver = out.cards[0];
    expect(taxSaver.product).toBe("tax_saver");
    expect(taxSaver.effectiveFrom).toBe("2026-08-04");
    expect(hasErrors(validateCard(taxSaver))).toBe(false);
    expect(taxSaver.rows).toHaveLength(1);
    expect(taxSaver.rows[0]).toMatchObject({ tenureMinDays: 1825, tenureMaxDays: 1825, rate: 6.0, customer: "general", amountMin: 0, amountMax: null });
    expect(taxSaver.notes?.some((n) => /ib tax saver scheme/i.test(n))).toBe(true);
  });

  it("throws if the page no longer states the tax-saver rate-parity rule", async () => {
    const ctx = ctxFromFixture({ key: "indian-bank:tax_saver", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html");
    ctx.doc.text = ctx.doc.text.replace(/IB Tax Saver Scheme/g, "IB Deposit Scheme");
    await expect(indianBankTaxSaver(ctx)).rejects.toThrow(/ib tax saver scheme/i);
  });

  it("reads savings slabs", async () => {
    const out = await indianBankSavings(ctxFromFixture({ key: "indian-bank:savings", bankSlug: "indian-bank", url }, "indian-bank/deposit_rates.html"));
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-07-04");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 10 * 1e5 + 1, rate: 2.5, residency: "resident" },
      { balanceMin: 10 * 1e5 + 1, balanceMax: 200 * CRORE, rate: 2.6, residency: "resident" },
      { balanceMin: 200 * CRORE, balanceMax: 750 * CRORE, rate: 2.65, residency: "resident" },
      { balanceMin: 750 * CRORE, balanceMax: null, rate: 2.8, residency: "resident" },
    ]);
  });
});
