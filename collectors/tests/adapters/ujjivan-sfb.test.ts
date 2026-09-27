import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ujjivanSfbBulk, ujjivanSfbFd, ujjivanSfbRd, ujjivanSfbSavings } from "../../src/adapters/ujjivan-sfb";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";
import type { AdapterContext, FetchedDoc } from "../../src/types";

const hubUrl = "https://www.ujjivansfb.bank.in/interest-rates";

describe("Ujjivan SFB adapter", () => {
  it("reads the FD card (Domestic FD + Platina, each keeping its own panel's date)", async () => {
    const out = await ujjivanSfbFd(ctxFromFixture({ key: "ujjivan-sfb:fd", bankSlug: "ujjivan-sfb", url: hubUrl }, "ujjivan-sfb/interest_rates_hub.html"));
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows).toHaveLength(17); // 12 Domestic FD + 5 Platina

    const domestic = { amount: 10_000, customer: "general" as const, callable: true as const };
    const platina = { amount: 1_50_00_000, customer: "general" as const, callable: false as const };
    expect(rateForTenure(fd.rows, 10, domestic)?.rate).toBe(3.5);
    expect(rateForTenure(fd.rows, 180, domestic)?.rate).toBe(6); // point tenure "180 days"
    expect(rateForTenure(fd.rows, 1200, domestic)?.rate).toBe(7.8);
    expect(rateForTenure(fd.rows, 1200, platina)?.rate).toBe(7.9);
    expect(rateForTenure(fd.rows, 10, platina)).toBeNull(); // below the Platina band (>₹1cr)

    expect(fd.notes?.some((n) => /printed as a line inside the rate table/.test(n))).toBe(true);
  });

  it("reads Ujjivan's own dedicated RD table", async () => {
    const out = await ujjivanSfbRd(ctxFromFixture({ key: "ujjivan-sfb:rd", bankSlug: "ujjivan-sfb", url: hubUrl }, "ujjivan-sfb/interest_rates_hub.html"));
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2026-09-01");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rd.rows).toHaveLength(7);
    const g = { amount: 1000, customer: "general" as const };
    expect(rateForTenure(rd.rows, 400, g)?.rate).toBe(7.25);
    expect(rateForTenure(rd.rows, 1200, g)?.rate).toBe(7.8);
  });

  it("reads the savings slabs (gap-free bands from '> X to Y' / '> Z' labels)", async () => {
    const out = await ujjivanSfbSavings(ctxFromFixture({ key: "ujjivan-sfb:savings", bankSlug: "ujjivan-sfb", url: hubUrl }, "ujjivan-sfb/interest_rates_hub.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-06-05"); // Savings alone is still dated separately from FD/RD
    expect(card.slabMethod).toBe("incremental");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 300001, rate: 2.5, residency: "resident" },
      { balanceMin: 300001, balanceMax: 500001, rate: 3, residency: "resident" },
      { balanceMin: 500001, balanceMax: 2500001, rate: 6.5, residency: "resident" },
      { balanceMin: 2500001, balanceMax: 250000001, rate: 6.75, residency: "resident" },
      { balanceMin: 250000001, balanceMax: null, rate: 7.15, residency: "resident" },
    ]);
  });

  it("discovers the dated bulk-deposit PDF link from the stable hub page and reads Callable/Non-Callable rows", async () => {
    const base = ctxFromFixture({ key: "ujjivan-sfb:bulk", bankSlug: "ujjivan-sfb", url: hubUrl }, "ujjivan-sfb/interest_rates_hub.html");
    const pdfText = readFileSync(path.join(__dirname, "../../fixtures/ujjivan-sfb/bulk_deposit_rates.txt"), "utf8");
    let fetchedUrl = "";
    const ctx: AdapterContext = {
      ...base,
      fetch: async (url): Promise<FetchedDoc> => {
        fetchedUrl = url;
        return { url, finalUrl: url, status: 200, contentType: "application/pdf", text: pdfText, fetchedAt: Date.now() };
      },
    };
    const out = await ujjivanSfbBulk(ctx);
    expect(fetchedUrl).toBe("https://www.ujjivansfb.bank.in/assets/bulk_deposit_rates_25_09_26_4f8a399465.pdf");

    const bulk = out.cards[0];
    expect(bulk.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(bulk))).toBe(false);
    expect(bulk.rows).toHaveLength(17 * 4 * 2); // 17 tenor buckets × 4 amount bands × callable/non-callable

    const callable4cr = { amount: 4 * 1e7, customer: "general" as const, callable: true as const };
    const nonCallable4cr = { amount: 4 * 1e7, customer: "general" as const, callable: false as const };
    expect(rateForTenure(bulk.rows, 10, callable4cr)?.rate).toBe(4.8); // 7-14 days, ≥3cr-<5cr, callable
    expect(rateForTenure(bulk.rows, 10, nonCallable4cr)?.rate).toBe(4.9); // same slab, non-callable

    const nonCallable6cr = { amount: 6 * 1e7, customer: "general" as const, callable: false as const };
    expect(rateForTenure(bulk.rows, 420, nonCallable6cr)?.rate).toBe(8.15); // "13 M 1 D to 15 M", ≥5cr-<20cr
  });
});
