import { describe, expect, it } from "vitest";
import { sliceFd, sliceHistory, sliceRd, sliceSavings } from "../../src/adapters/slice-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const url = "https://slice.bank.in/documents/imp/interest-rates.pdf";
const historyUrl = "https://slice.bank.in/documents/imp/previous_interest_rates.pdf";

describe("slice SFB adapter", () => {
  it("reads the current FD PDF: callable quarterly, monthly and non-callable, latest period only", async () => {
    const out = await sliceFd(ctxFromFixture({ key: "slice-sfb:fd", bankSlug: "slice-sfb", url, format: "pdf" }, "slice-sfb/current_rates.txt"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-08-19");
    expect(hasErrors(validateCard(fd))).toBe(false);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.5); // callable quarterly, 7-29 days
    expect(fd.rows.find((r) => r.payout === "monthly" && r.tenureMinDays === 7)?.rate).toBe(3.49);
    expect(rateForTenure(fd.rows, 3000, s)?.rate).toBe(6.75); // 60 months 1 Day to 120 months
    const nonCallable = { amount: 1.5e7, customer: "general" as const, callable: false as const };
    expect(rateForTenure(fd.rows, 400, nonCallable)?.rate).toBe(7.5); // 12 months 1 Day to 18 months, non-callable
    expect(fd.rows.filter((r) => r.callable === false).length).toBeGreaterThan(0);
  });

  it("reads the RD table from the same PDF (its own card, up to ₹2 crore)", async () => {
    const out = await sliceRd(ctxFromFixture({ key: "slice-sfb:rd", bankSlug: "slice-sfb", url, format: "pdf" }, "slice-sfb/current_rates.txt"));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-08-18");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 300, { amount: 1e5, customer: "general" })?.rate).toBe(6.25); // 9mo1d-12mo
    expect(rateForTenure(rd.rows, 300, { amount: 1e5, customer: "senior" })?.rate).toBe(6.5);
    expect(rd.rows.length).toBe(16); // 8 tenure bands x general/senior
  });

  it("reads the flat, non-slabbed savings rate", async () => {
    const out = await sliceSavings(ctxFromFixture({ key: "slice-sfb:savings", bankSlug: "slice-sfb", url, format: "pdf" }, "slice-sfb/current_rates.txt"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2025-12-05");
    expect(card.slabMethod).toBe("whole");
    expect(card.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 5.25, residency: "resident", note: "Flat rate = 100% of the RBI repo rate at the time, paid daily; not slabbed by balance." }]);
    expect(hasErrors(validateCard(card))).toBe(false);
  });

  it("sliceHistory returns every dated period from the archive PDF, each as bank_archive", async () => {
    const out = await sliceHistory(ctxFromFixture({ key: "slice-sfb:history", bankSlug: "slice-sfb", url: historyUrl, format: "pdf" }, "slice-sfb/previous_rates.txt"));
    const fdCards = out.cards.filter((c) => c.product === "fd");
    const savingsCards = out.cards.filter((c) => c.product === "savings");
    expect(fdCards.every((c) => c.sourceType === "bank_archive")).toBe(true);
    expect(savingsCards.every((c) => c.sourceType === "bank_archive")).toBe(true);
    // 6 closed FD periods (Oct 2024 - Aug 2026) plus the still-open latest one = 7.
    expect(fdCards.length).toBe(7);
    expect(fdCards.map((c) => c.effectiveFrom)).toEqual(["2026-08-19", "2025-09-17", "2025-06-27", "2025-06-10", "2025-04-24", "2025-01-18", "2024-10-27"]);
    expect(fdCards.every((c) => hasErrors(validateCard(c)) === false)).toBe(true);
    const latest = fdCards[0];
    expect(latest.observedTo).toBeNull(); // "Till Date"
    const earliest = fdCards.find((c) => c.effectiveFrom === "2024-10-27")!;
    expect(earliest.observedTo).toBe("2025-01-17");
    // The Oct-2024 period used a ₹5 crore bulk threshold, not ₹3 crore like every later period.
    expect(earliest.rows.some((r) => r.amountMax === 5 * 1e7)).toBe(true);
    expect(savingsCards.length).toBe(5);
    expect(savingsCards.map((c) => c.effectiveFrom)).toEqual(["2025-12-05", "2025-06-06", "2025-04-10", "2025-02-08", "2024-12-19"]);
  });
});
