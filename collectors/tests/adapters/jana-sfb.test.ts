import { describe, expect, it } from "vitest";
import { janaBulk, janaFd, janaRd, janaSavings } from "../../src/adapters/jana-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const source = { key: "jana-sfb:fd", bankSlug: "jana-sfb", url: "https://www.jana.bank.in/interest-rates/" };
const fixture = "jana-sfb/interest-rates.html";
const g = { amount: 1_00_000, customer: "general" as const };
const s = { amount: 1_00_000, customer: "senior" as const };

describe("Jana SFB adapter", () => {
  it("reads the retail FD table (own effective date)", async () => {
    const out = await janaFd(ctxFromFixture(source, fixture));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.length).toBe(24); // 12 tenure buckets x general/senior
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.5); // 7-14 days
    expect(rateForTenure(fd.rows, 200, g)?.rate).toBe(6.5); // 181-270 days
    expect(rateForTenure(fd.rows, 200, s)?.rate).toBe(7.0); // +0.50, not flat everywhere
    expect(rateForTenure(fd.rows, 10, s)?.rate).toBe(3.5); // 7-180 days: no senior premium at all
    expect(rateForTenure(fd.rows, 800, g)?.rate).toBe(8.0); // >2-3 years (1095 days)
    expect(rateForTenure(fd.rows, 800, s)?.rate).toBe(8.3); // +0.30, not +0.50
  });

  it("reads the FD Plus / Bulk tenure x crore-band grid (its own effective date)", async () => {
    const out = await janaBulk(ctxFromFixture(source, fixture));
    const bulk = out.cards[0];
    expect(bulk.product).toBe("fd_bulk");
    expect(bulk.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows.length).toBe(70); // 14 tenure rows x 5 published crore bands (>50cr is "Contact Branch")
    expect(rateForTenure(bulk.rows, 10, { amount: 3 * 1e7, customer: "general", callable: false })?.rate).toBe(4.25); // exactly ₹3cr
    expect(rateForTenure(bulk.rows, 10, { amount: 4 * 1e7, customer: "general", callable: false })?.rate).toBe(4.25); // >3-5cr band
    expect(rateForTenure(bulk.rows, 10, { amount: 600 * 1e7, customer: "general", callable: false })).toBeNull(); // >50cr: contact branch
    expect(bulk.rows.every((r) => r.callable === false)).toBe(true);
  });

  it("reads the RD table (own effective date, not derived from FD)", async () => {
    const out = await janaRd(ctxFromFixture(source, fixture));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows.length).toBe(22); // 11 tenure buckets x general/senior
    expect(rateForTenure(rd.rows, 800, g)?.rate).toBe(8.0); // >24-36 months
    expect(rd.notes?.some((n) => /own recurring-deposit card/i.test(n))).toBe(true);
  });

  it("reads the incremental savings slabs (own, older effective date)", async () => {
    const out = await janaSavings(ctxFromFixture(source, fixture));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-05-07");
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 100001, rate: 2.5, residency: "resident", note: "Up to Rs. 1 Lakh" },
      { balanceMin: 100001, balanceMax: 500001, rate: 3.5, residency: "resident", note: "More than Rs. 1 Lakh and Up to Rs. 5 Lakhs" },
      { balanceMin: 500001, balanceMax: 1000001, rate: 4.5, residency: "resident", note: "More than Rs. 5 Lakhs and Up to Rs. 10 Lakhs" },
      { balanceMin: 1000001, balanceMax: 5000001, rate: 6.75, residency: "resident", note: "More than Rs. 10 Lakhs and Up to Rs. 50 Lakhs" },
      { balanceMin: 5000001, balanceMax: 100000001, rate: 7, residency: "resident", note: "More than Rs. 50 Lakhs and Up to Rs. 10 Crores" },
      { balanceMin: 100000001, balanceMax: 200000001, rate: 7, residency: "resident", note: "More than Rs. 10 Crores and Up to Rs. 20 Crores" },
    ]);
  });
});
