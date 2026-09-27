import { describe, expect, it } from "vitest";
import { psbFd } from "../../src/adapters/punjab-and-sind-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { ctxFromFixture } from "../helpers";

const url = "https://punjabandsind.bank.in/content/interestdom";
const NON_CALLABLE_MIN = 1_00_01_000;

describe("Punjab & Sind Bank adapter", () => {
  it("reads the FD card with per-row callable/non-callable and PSB Green Earth scheme names", async () => {
    const out = await psbFd(ctxFromFixture({ key: "punjab-and-sind-bank:fd", bankSlug: "punjab-and-sind-bank", url }, "punjab-and-sind-bank/interestdom.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-06-16");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true); // no senior column printed

    const find = (minDays: number, callable: boolean, amountMin = 0) => fd.rows.find((r) => r.tenureMinDays === minDays && r.callable === callable && r.amountMin === amountMin);
    expect(find(365, true)?.rate).toBe(5.85); // "1 Year"
    expect(find(375, true)?.rate).toBe(6.4); // "375 Days (Callable)"
    expect(find(375, false, NON_CALLABLE_MIN)?.rate).toBe(6.5); // "375 Days (Non-Callable*)"
    expect(find(444, true)?.rate).toBe(6.8);
    expect(find(666, true)?.rate).toBe(6.85);
    expect(find(999, true)?.rate).toBe(6.0);
    expect(find(999, false, NON_CALLABLE_MIN)?.rate).toBe(6.05);
    expect(fd.rows.find((r) => r.tenureMinDays === 375 && r.callable === true)?.special).toBe(true);

    // "22 Month (PSB Green Earth)" — point tenure (22*365/12 rounds to 669 days), rate printed as "5.95($)"
    const greenEarth = fd.rows.find((r) => r.schemeName === "PSB Green Earth" && r.tenureMinDays === 669);
    expect(greenEarth?.rate).toBe(5.95);

    // Bare-"<" labels that the shared parseTenure would otherwise mis-parse (see file header):
    // ">667 < 22 Month" -> the single day 668 (just before the 669-day Green Earth point);
    // "1000 Days - <3 Years" -> (1000,1094).
    expect(find(668, true)).toMatchObject({ tenureMaxDays: 668, rate: 5.85 });
    expect(find(1000, true)).toMatchObject({ tenureMaxDays: 1094, rate: 5.95 });

    expect(fd.notes?.some((n) => /0\.50%/.test(n))).toBe(true);
  });

  it("derives the RD (and NRO/tax-saver) card from the FD rows because PSB states they share the same table", async () => {
    const out = await psbFd(ctxFromFixture({ key: "punjab-and-sind-bank:fd", bankSlug: "punjab-and-sind-bank", url }, "punjab-and-sind-bank/interestdom.html"));
    const rd = out.cards.find((c) => c.product === "rd")!;
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows.every((r) => r.tenureMinDays >= 365 && !r.special && r.callable !== false)).toBe(true);
    expect(rd.notes?.some((n) => /derived/i.test(n))).toBe(true);
    expect(rd.rows.some((r) => r.tenureMinDays === 365 && r.rate === 5.85)).toBe(true);
  });

  it("reads the savings card (5 amount slabs)", async () => {
    const out = await psbFd(ctxFromFixture({ key: "punjab-and-sind-bank:fd", bankSlug: "punjab-and-sind-bank", url }, "punjab-and-sind-bank/interestdom.html"));
    const savings = out.cards.find((c) => c.product === "savings")!;
    expect(savings.effectiveFrom).toBe("2026-02-16");
    expect(hasErrors(validateCard(savings))).toBe(false);
    expect(savings.savingsSlabs).toHaveLength(5);
    expect(savings.savingsSlabs?.[0]).toMatchObject({ balanceMin: 0, rate: 2.2 });
    expect(savings.savingsSlabs?.at(-1)).toMatchObject({ balanceMax: null, rate: 4.7 });
  });
});
