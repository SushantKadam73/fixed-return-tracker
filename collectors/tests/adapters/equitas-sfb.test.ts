import { describe, expect, it } from "vitest";
import { equitasSfbFd, equitasSfbRd } from "../../src/adapters/equitas-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const fdUrl = "https://equitas.bank.in/personal-banking/save/fixed-deposits/fixed-deposit/";
const rdUrl = "https://equitas.bank.in/personal-banking/save/fixed-deposits/recurring-deposits/";

describe("Equitas SFB adapter", () => {
  it("reads the retail FD card off the div-grid layout, incl. the Maxima FD point tenure", async () => {
    const out = await equitasSfbFd(ctxFromFixture({ key: "equitas-sfb:fd", bankSlug: "equitas-sfb", url: fdUrl }, "equitas-sfb/fd_retail.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-06-16");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(23);

    const g = { amount: 50_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 444, g)?.rate).toBe(7.1);
    expect(rateForTenure(fd.rows, 888, g)?.rate).toBe(7.75);

    const maxima = fd.rows.find((r) => r.schemeName === "Equitas Maxima FD");
    expect(maxima?.tenureMinDays).toBe(1096); // 36 months 1 day
    expect(maxima?.tenureMaxDays).toBe(1096);
    expect(maxima?.rate).toBe(8);
    expect(maxima?.special).toBe(true);

    expect(fd.notes?.some((n) => /0\.50% p\.a\. over the general rate/.test(n))).toBe(true);
  });

  it("reads Equitas's own explicit RD table (not derived from FD)", async () => {
    const out = await equitasSfbRd(ctxFromFixture({ key: "equitas-sfb:rd", bankSlug: "equitas-sfb", url: rdUrl }, "equitas-sfb/rd.html"));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-06-10");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows).toHaveLength(11);
    const g = { amount: 1000, customer: "general" as const };
    expect(rateForTenure(rd.rows, 365, g)?.rate).toBe(7.1); // "12 months"
    expect(rateForTenure(rd.rows, 1095, g)?.rate).toBe(7.1); // "36 Months"
    expect(rateForTenure(rd.rows, 2738, g)?.rate).toBe(7); // "90 Months"
    expect(rd.notes?.some((n) => /own dedicated RD table/.test(n))).toBe(true);
  });
});
