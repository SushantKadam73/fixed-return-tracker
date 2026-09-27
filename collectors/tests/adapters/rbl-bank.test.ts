import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rblBulk, rblBulkCallable, rblBulkNonCallable, rblFd, rblRd, rblSavings } from "../../src/adapters/rbl-bank";
import { validateCard, hasErrors } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import { ctxFromFixture } from "../helpers";

const hubUrl = "https://www.rbl.bank.in/interest-rates";

describe("RBL Bank adapter", () => {
  it("reads the retail FD card (callable + non-callable + tax saver)", async () => {
    const out = await rblFd(ctxFromFixture({ key: "rbl-bank:fd", bankSlug: "rbl-bank", url: hubUrl }, "rbl-bank/interest_rates_hub.html"));
    const fd = out.cards.find((c) => c.product === "fd")!;
    expect(fd.effectiveFrom).toBe("2026-09-08");
    expect(hasErrors(validateCard(fd))).toBe(false);

    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    const ss = { amount: 1_00_000, customer: "super_senior" as const };
    expect(rateForTenure(fd.rows, 10, g)?.rate).toBe(3.5); // 7-14 days
    expect(rateForTenure(fd.rows, 600, s)?.rate).toBe(7.7); // 18-36 months, "Highest" marker stripped
    expect(rateForTenure(fd.rows, 600, ss)?.rate).toBe(7.95);

    // Non-callable card only exists from ₹1 crore and below ₹3 crore.
    const nc = fd.rows.filter((r) => r.callable === false);
    expect(nc.length).toBeGreaterThan(0);
    expect(nc.every((r) => r.amountMin === 1_00_00_000 && r.amountMax === 3 * 1e7)).toBe(true);
    expect(rateForTenure(nc, 600, { amount: 1_00_00_000, customer: "general", callable: false })?.rate).toBe(7.25);

    // Tax saver row (parenthesised duration, handled by hand).
    const taxSaver = fd.rows.filter((r) => /tax saving/i.test(r.tenureLabel));
    expect(taxSaver.map((r) => [r.tenureMinDays, r.customer, r.rate]).sort()).toEqual(
      [
        [1825, "general", 6.7],
        [1825, "senior", 7.2],
        [1825, "super_senior", 7.45],
      ].sort(),
    );
  });

  it("reads savings slabs with incremental method", async () => {
    const out = await rblSavings(ctxFromFixture({ key: "rbl-bank:savings", bankSlug: "rbl-bank", url: hubUrl }, "rbl-bank/interest_rates_hub.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-06-18");
    expect(card.slabMethod).toBe("incremental");
    expect(card.savingsSlabs).toEqual([
      { balanceMin: 0, balanceMax: 5_00_001, rate: 3.0, residency: "resident" },
      { balanceMin: 5_00_001, balanceMax: 10_00_001, rate: 5.0, residency: "resident" },
      { balanceMin: 10_00_001, balanceMax: 7_50_00_001, rate: 6.0, residency: "resident" },
      { balanceMin: 7_50_00_001, balanceMax: null, rate: 5.5, residency: "resident" },
    ]);
  });

  it("reads the RD card straight from the bank's own table (not derived)", async () => {
    const out = await rblRd(ctxFromFixture({ key: "rbl-bank:rd", bankSlug: "rbl-bank", url: hubUrl }, "rbl-bank/interest_rates_hub.html"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-08");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(rateForTenure(card.rows, 200, { amount: 1000, customer: "general" })?.rate).toBe(5.5); // 6-7 months, domestic
    expect(rateForTenure(card.rows, 200, { amount: 1000, customer: "senior" })?.rate).toBe(6.0);
    // NRE has no rate below 12 months (explicit "NA" in the table) — must not be invented.
    expect(rateForTenure(card.rows, 200, { amount: 1000, customer: "general", residency: "nre" })).toBeNull();
    expect(rateForTenure(card.rows, 600, { amount: 1000, customer: "general", residency: "nre" })?.rate).toBe(7.2);
    expect(rateForTenure(card.rows, 600, { amount: 1000, customer: "general", residency: "nro" })?.rate).toBe(7.2);
  });

  it("reads the daily callable bulk FD PDF", async () => {
    const out = await rblBulkCallable(ctxFromFixture({ key: "rbl-bank:bulk_callable", bankSlug: "rbl-bank", url: "https://webassets.rbl.bank.in/document/pdfs/callable-bulk-fd-rates.pdf", format: "pdf" }, "rbl-bank/bulk_callable.txt"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(rateForTenure(card.rows, 8, { amount: 3.2 * 1e7, customer: "general" })?.rate).toBe(3.95);
    // The narrow ₹5.60–5.75cr tier is genuinely a different (lower) rate, not a parsing artefact.
    expect(rateForTenure(card.rows, 8, { amount: 5.7 * 1e7, customer: "general" })?.rate).toBe(3.0);
    expect(rateForTenure(card.rows, 8, { amount: 2 * 1e7, customer: "general" })).toBeNull(); // below ₹3cr bulk threshold
    expect(card.rows.every((r) => r.callable === true)).toBe(true);
  });

  it("reads the daily non-callable bulk FD PDF", async () => {
    const out = await rblBulkNonCallable(ctxFromFixture({ key: "rbl-bank:bulk_noncallable", bankSlug: "rbl-bank", url: "https://webassets.rbl.bank.in/document/pdfs/non-callable-bulk-fd-rates.pdf", format: "pdf" }, "rbl-bank/bulk_noncallable.txt"));
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(rateForTenure(card.rows, 400, { amount: 3.2 * 1e7, customer: "general" })?.rate).toBe(6.85);
    expect(card.rows.every((r) => r.callable === false)).toBe(true);
  });

  it("combines the callable and non-callable bulk PDFs into one fd_bulk card", async () => {
    const ctx = ctxFromFixture({ key: "rbl-bank:fd_bulk", bankSlug: "rbl-bank", url: "https://webassets.rbl.bank.in/document/pdfs/callable-bulk-fd-rates.pdf", format: "pdf" }, "rbl-bank/bulk_callable.txt");
    const ncText = readFileSync(path.join(__dirname, "..", "..", "fixtures", "rbl-bank", "bulk_noncallable.txt"), "utf8");
    ctx.fetch = async (url) => {
      expect(url).toBe("https://webassets.rbl.bank.in/document/pdfs/non-callable-bulk-fd-rates.pdf");
      return { url, finalUrl: url, status: 200, contentType: "application/pdf", text: ncText, fetchedAt: ctx.doc.fetchedAt };
    };
    const out = await rblBulk(ctx);
    expect(out.cards).toHaveLength(1);
    const card = out.cards[0];
    expect(card.product).toBe("fd_bulk");
    expect(card.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(card))).toBe(false);
    expect(rateForTenure(card.rows, 8, { amount: 3.2 * 1e7, customer: "general", callable: true })?.rate).toBe(3.95);
    expect(rateForTenure(card.rows, 400, { amount: 3.2 * 1e7, customer: "general", callable: false })?.rate).toBe(6.85);
    expect(card.rows.some((r) => r.callable === true) && card.rows.some((r) => r.callable === false)).toBe(true);
  });
});
