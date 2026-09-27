import { describe, expect, it } from "vitest";
import { yesBulk, yesFd, yesRd, yesSavings } from "../../src/adapters/yes-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const allRatesUrl = "https://www.yes.bank.in/sites/web/content/published/api/v1.1/assets/CONT13C66A7E18434B48BC40248F6202F4A4/native/allratesandcharges_pdf.pdf";
const bulkUrl = "https://www.yes.bank.in/sites/web/content/published/api/v1.1/assets/CONTA391B2F09BF64C72BF6C2CD073F98131/native/bulk_fixed_deposit_interest_rates_v1_pdf.pdf";

function ctx(key: string, url: string, fixture: string) {
  return ctxFromFixture({ key, bankSlug: "yes-bank", url, format: "pdf" }, fixture);
}

describe("YES Bank adapter", () => {
  it("reads the retail FD card, fixing the missing 'to' before a bare '<'", async () => {
    const out = await yesFd(ctx("yes-bank:fd", allRatesUrl, "yes-bank/all_rates.txt"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-02");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.25); // 7-14 days
    // "12 months 1 day < 18 months" — parseTenure cannot split this without the "to" we insert.
    expect(rateForTenure(fd.rows, 400, g)?.rate).toBe(6.75);
    expect(rateForTenure(fd.rows, 400, s)?.rate).toBe(7.25);
    // "24 months < 35 months" — same fix, a different row.
    expect(rateForTenure(fd.rows, 800, g)?.rate).toBe(7.0);
    expect(fd.rows.every((r) => r.callable === true)).toBe(true);
  });

  it("reads the Resident RD card from its own explicit table (not derived from FD)", async () => {
    const out = await yesRd(ctx("yes-bank:rd", allRatesUrl, "yes-bank/all_rates.txt"));
    const rd = out.cards[0];
    expect(rd.product).toBe("rd");
    expect(rd.effectiveFrom).toBe("2026-06-02");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 183, { amount: 1000, customer: "general" })?.rate).toBe(6.0); // "6 months"
    expect(rateForTenure(rd.rows, 183, { amount: 1000, customer: "senior" })?.rate).toBe(6.5);
    expect(rateForTenure(rd.rows, 1200, { amount: 1000, customer: "general" })?.rate).toBe(7.0); // "36 months to < 60 months"
    expect(rd.rows.every((r) => r.callable === null)).toBe(true); // prematurity not discussed for RD specifically
  });

  it("reads savings slabs (incremental) and reproduces the bank's own worked example", async () => {
    const out = await yesSavings(ctx("yes-bank:savings", allRatesUrl, "yes-bank/all_rates.txt"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-04-07"); // "7th April'26" — apostrophe 2-digit year
    expect(card.slabMethod).toBe("incremental");
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 1_00_001, rate: 2.5, residency: "resident" },
      { balanceMin: 1_00_001, balanceMax: 25_00_000, rate: 2.5, residency: "resident" },
      { balanceMin: 25_00_000, balanceMax: 100 * 1e7, rate: 3.5, residency: "resident" },
    ]);

    // The PDF's own worked example: a ₹10 crore balance splits into three incremental tranches.
    // "For balances up to INR 1,00,000: 2.50%" / "above 1,00,000 to less than 25,00,000: 2.50%" /
    // "from 25,00,000 to less than 10 Cr: 3.50%".
    const balance = 10 * 1e7; // INR 10 crore
    const slabs = card.savingsSlabs!;
    const breakpoints = [0, slabs[0].balanceMax! - 1, slabs[1].balanceMax!, balance];
    const tranches = slabs.map((s, i) => ({ amount: breakpoints[i + 1] - breakpoints[i], rate: s.rate }));
    expect(tranches).toEqual([
      { amount: 1_00_000, rate: 2.5 },
      { amount: 24_00_000, rate: 2.5 },
      { amount: 9_75_00_000, rate: 3.5 },
    ]);
    expect(tranches.reduce((sum, t) => sum + t.amount, 0)).toBe(balance);
  });

  it("reads the bulk FD card (₹3cr-<5cr, 3 sub-tiers x callable/non-callable x senior/non-senior)", async () => {
    const out = await yesBulk(ctx("yes-bank:bulk", bulkUrl, "yes-bank/bulk_fd.txt"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-06-02");
    expect(hasErrors(validateCard(card))).toBe(false);

    expect(rateForTenure(card.rows, 10, { amount: 3.05 * 1e7, customer: "general", callable: true })?.rate).toBe(3.25);
    // The narrow ₹3.10-3.15cr sub-tier is genuinely a lower rate for some rows, not a mis-parse.
    expect(rateForTenure(card.rows, 50, { amount: 3.05 * 1e7, customer: "general", callable: true })?.rate).toBe(4.5);
    expect(rateForTenure(card.rows, 50, { amount: 3.125 * 1e7, customer: "general", callable: true })?.rate).toBe(4.25);
    expect(rateForTenure(card.rows, 10, { amount: 2 * 1e7, customer: "general" })).toBeNull(); // below ₹3cr
    expect(rateForTenure(card.rows, 10, { amount: 6 * 1e7, customer: "general" })).toBeNull(); // ≥₹5cr not published here
  });
});
