import { describe, expect, it } from "vitest";
import { bankOfIndiaFd } from "../../src/adapters/bank-of-india";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

// bankofindia.bank.in / .co.in block every automated client (403 + Cloudflare challenge — see
// file header). This fixture is a Wayback Machine snapshot of the bank's own page, used only
// to build/test this adapter; the registered source is `active: false`.
const url = "https://bankofindia.bank.in/interest-rate/rupee-term-deposit-rate";

describe("Bank of India adapter (built/tested against an archived copy — live source is blocked)", () => {
  it("reads the retail (<3cr) and bulk (3-10cr) rates from the one shared table", async () => {
    const out = await bankOfIndiaFd(ctxFromFixture({ key: "bank-of-india:fd", bankSlug: "bank-of-india", url }, "bank-of-india/fd_retail_bulk.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const bulk = out.cards.find((c) => c.product === "fd_bulk")!;
    expect(fd.effectiveFrom).toBe("2025-06-16");
    expect(bulk.effectiveFrom).toBe("2025-06-16");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(fd.rows.every((r) => r.customer === "general")).toBe(true);

    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.5);
    expect(rateForTenure(fd.rows, 450, g)?.rate).toBe(6.7); // "450 Days (Star Vaibhav)"
    expect(fd.rows.find((r) => r.tenureMinDays === 450)?.schemeName).toBe("Star Vaibhav");
    expect(rateForTenure(fd.rows, 500, g)?.rate).toBe(6.45); // "Above 1 Year to less than 2 Years (except 450 Days)"
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(6.0); // "8 years & above to 10 Years"

    const gBulk = { amount: 5 * 1e7, customer: "general" as const };
    expect(rateForTenure(bulk.rows, 365, gBulk)?.rate).toBe(6.5);
    expect(rateForTenure(bulk.rows, 450, gBulk)?.rate).toBe(6.25);
    expect(fd.notes?.some((n) => /SENIOR CITIZEN/i.test(n))).toBe(true);
  });

  it("also reads the current live table (captured via a real browser session on 2026-09-27 — see file header): Star Vaibhav (450 days) has since been discontinued from this ladder", async () => {
    const out = await bankOfIndiaFd(ctxFromFixture({ key: "bank-of-india:fd", bankSlug: "bank-of-india", url }, "bank-of-india/fd_retail_bulk_live.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    const bulk = out.cards.find((c) => c.product === "fd_bulk")!;
    expect(fd.effectiveFrom).toBe("2026-05-18");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(fd.rows).toHaveLength(15);
    expect(bulk.rows).toHaveLength(15);
    expect(fd.rows.some((r) => r.schemeName === "Star Vaibhav")).toBe(false); // no longer on this ladder

    const g = { amount: 1_00_000, customer: "general" as const };
    expect(rateForTenure(fd.rows, 365, g)?.rate).toBe(6.5); // "1 Year"
    expect(rateForTenure(fd.rows, 3000, g)?.rate).toBe(6.0); // "8 years & above to up to 10 Years"
    const gBulk = { amount: 5 * 1e7, customer: "general" as const };
    expect(rateForTenure(bulk.rows, 10, gBulk)?.rate).toBe(4.5); // "7 days to 14 days"
  });
});
