import { describe, expect, it } from "vitest";
import { tmbBulk, tmbFd, tmbSavings } from "../../src/adapters/tamilnad-mercantile-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://www.tmb.bank.in/personal/deposits/tmb-basic-fixed-deposit-account";

describe("Tamilnad Mercantile Bank adapter", () => {
  it("reads the retail FD card (callable + non-callable, both named special tenures)", async () => {
    const out = await tmbFd(ctxFromFixture({ key: "tamilnad-mercantile-bank:fd", bankSlug: "tamilnad-mercantile-bank", url }, "tamilnad-mercantile-bank/basic_fd_account.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-04-10");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    const ss = { amount: 1_00_000, customer: "super_senior" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.8); // "1 year"
    expect(rateForTenure(fd.rows, 365, s)?.rate).toBe(7.3);
    expect(rateForTenure(fd.rows, 365, ss)?.rate).toBe(7.4);

    const special456 = fd.rows.find((r) => r.tenureMinDays === 456 && r.customer === "general" && r.callable === true);
    expect(special456?.rate).toBe(7.1);
    expect(special456?.schemeName).toBe("TMB 456 Special Deposit scheme");
    const special567 = fd.rows.find((r) => r.tenureMinDays === 567 && r.customer === "senior" && r.callable === true);
    expect(special567?.rate).toBe(7.7);
    expect(special567?.schemeName).toBe("TMB 567 Special Deposit scheme");

    // Non-callable (>₹1cr, <₹3cr): general is quoted from 91 days; senior/super-senior only from 2 years.
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc.every((r) => r.amountMin === 1_00_00_000 && r.amountMax === 3 * 1e7)).toBe(true);
    expect(rateForTenure(nc, 100, { amount: 1_50_00_000, customer: "general" })?.rate).toBe(5.9);
    expect(rateForTenure(nc, 100, { amount: 1_50_00_000, customer: "senior" })).toBeNull(); // "-" in the table below 2 years
    expect(rateForTenure(nc, 800, { amount: 1_50_00_000, customer: "senior" })?.rate).toBe(7.6); // "2 years to less than 3 years"

    expect(out.cards.some((c) => c.product === "rd")).toBe(false); // no RD table or rate-parity statement anywhere
  });

  it("reads savings slabs (strips the '(p.a)' suffix locally)", async () => {
    const out = await tmbSavings(ctxFromFixture({ key: "tamilnad-mercantile-bank:savings", bankSlug: "tamilnad-mercantile-bank", url }, "tamilnad-mercantile-bank/basic_fd_account.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBeNull(); // no date text next to this table
    expect(card.slabMethod).toBe("unknown");
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 5_00_001, rate: 2.6, residency: "resident" },
      { balanceMin: 5_00_001, balanceMax: 10_00_001, rate: 3.0, residency: "resident" },
      { balanceMin: 10_00_001, balanceMax: 1_00_00_001, rate: 3.25, residency: "resident" },
      { balanceMin: 1_00_00_001, balanceMax: 2_00_00_001, rate: 4.5, residency: "resident" },
      { balanceMin: 2_00_00_001, balanceMax: 10_00_00_001, rate: 6.0, residency: "resident" },
      { balanceMin: 10_00_00_001, balanceMax: 25_00_00_001, rate: 5.5, residency: "resident" },
      { balanceMin: 25_00_00_001, balanceMax: 100_00_00_001, rate: 5.0, residency: "resident" },
      { balanceMin: 100_00_00_001, balanceMax: null, rate: 4.0, residency: "resident" },
    ]);
  });

  it("reads the bulk card (per-tier columns crossed with callable/non-callable)", async () => {
    const out = await tmbBulk(ctxFromFixture({ key: "tamilnad-mercantile-bank:bulk", bankSlug: "tamilnad-mercantile-bank", url }, "tamilnad-mercantile-bank/basic_fd_account.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.rows.every((r) => r.customer === "general")).toBe(true);
    expect(rateForTenure(card.rows, 10, { amount: 3.5 * 1e7, customer: "general", callable: true })?.rate).toBe(4.05);
    expect(rateForTenure(card.rows, 10, { amount: 3.5 * 1e7, customer: "general", callable: false })).toBeNull(); // "–" for short non-callable tenures
    expect(rateForTenure(card.rows, 50, { amount: 3.5 * 1e7, customer: "general", callable: false })?.rate).toBe(5.8); // 46-60 days, non-callable
    expect(rateForTenure(card.rows, 10, { amount: 2 * 1e7, customer: "general" })).toBeNull(); // below ₹3cr bulk threshold
  });
});
