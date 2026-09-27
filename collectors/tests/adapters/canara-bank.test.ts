import { describe, expect, it } from "vitest";
import { canaraBankBulk, canaraBankFd, canaraBankSavings } from "../../src/adapters/canara-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const CRORE = 1e7;
const fdUrl = "https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.";

describe("Canara Bank adapter", () => {
  it("reads the retail card: domestic General/Senior x Callable/Non-Callable, plus Retail Green Deposits", async () => {
    const out = await canaraBankFd(ctxFromFixture({ key: "canara-bank:fd", bankSlug: "canara-bank", url: fdUrl }, "canara-bank/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-03-17");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(45);
    // This domestic table is only reachable via the local cheerio workaround in
    // canara-bank.ts (extractTables skips its enclosing wrapper) — a non-empty, valid card
    // here is itself the regression check for that workaround.
  });

  it("reads specific domestic rates: general/senior, callable/non-callable, and the 444/555-day named tenures", async () => {
    const out = await canaraBankFd(ctxFromFixture({ key: "canara-bank:fd", bankSlug: "canara-bank", url: fdUrl }, "canara-bank/fd_retail.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const find = (minDays: number, customer: string, callable: boolean, amountMin = 0) =>
      fd.rows.find((r) => r.tenureMinDays === minDays && r.customer === customer && r.callable === callable && r.amountMin === amountMin);

    expect(find(365, "general", true)?.rate).toBe(6.25);
    expect(find(365, "senior", false, CRORE + 1)?.rate).toBe(6.85);
    const nc444senior = fd.rows.find((r) => r.tenureMinDays === 444 && r.customer === "senior" && r.callable === false);
    expect(nc444senior?.rate).toBe(7.1);
    const c555general = fd.rows.find((r) => r.tenureMinDays === 555 && r.customer === "general" && r.callable === true);
    expect(c555general).toMatchObject({ rate: 6.6, special: true, tenureLabel: "555 Days ##" });

    const green = fd.rows.find((r) => r.schemeName === "Canara Retail Green Deposit" && r.tenureMinDays === 1111);
    expect(green).toMatchObject({ rate: 6.1, callable: true, special: true });
  });

  it("derives RD from the FD card because the bank's RD page states the rate equals term-deposit rates", async () => {
    const out = await canaraBankFd(ctxFromFixture({ key: "canara-bank:fd", bankSlug: "canara-bank", url: fdUrl }, "canara-bank/fd_retail.html"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(rd.rows.length).toBeGreaterThan(0);
    expect(rd.notes?.some((n) => /applicable to term deposits/i.test(n))).toBe(true);
  });

  it("reads the bulk card: ₹3cr-1000cr+ slabs (callable + non-callable) and Bulk Green Deposits", async () => {
    const out = await canaraBankBulk(ctxFromFixture({ key: "canara-bank:fd_bulk", bankSlug: "canara-bank", url: fdUrl }, "canara-bank/fd_retail.html"));
    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(231);

    const band1 = bulk.rows.find((r) => r.tenureMinDays === 7 && r.callable === true && r.amountMin === 3 * CRORE);
    expect(band1).toMatchObject({ amountMax: 10 * CRORE, rate: 3 });
    const lastBand = bulk.rows.find((r) => r.tenureMinDays === 7 && r.callable === true && r.amountMax === null);
    expect(lastBand?.rate).toBe(3.5); // "Above 1000 Crore"
    const green = bulk.rows.filter((r) => r.schemeName === "Canara Bulk Green Deposit" && r.tenureMinDays === 2222);
    expect(green.map((r) => [r.callable, r.rate, r.amountMin, r.amountMax])).toEqual([
      [true, 4.95, 3 * CRORE, null],
      [false, 5, 3 * CRORE, null],
    ]);
  });

  it("reads savings slabs", async () => {
    const out = await canaraBankSavings(
      ctxFromFixture({ key: "canara-bank:savings", bankSlug: "canara-bank", url: "https://www.canarabank.bank.in/domestic/nro/nre-savings-bank-deposits" }, "canara-bank/savings.html"),
    );
    const savings = out.cards[0];
    expect(savings.effectiveFrom).toBe("2026-09-05");
    expect(savings.slabMethod).toBe("unknown");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(10);
    expect(savings.savingsSlabs?.[0]).toEqual({ balanceMin: 0, balanceMax: 50 * 1e5, rate: 2.5, residency: "resident" });
    expect(savings.savingsSlabs?.at(-1)).toEqual({ balanceMin: 2000 * CRORE, balanceMax: null, rate: 4, residency: "resident" });
  });
});
