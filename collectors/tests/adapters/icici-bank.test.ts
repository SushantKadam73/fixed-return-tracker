import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { iciciFd, iciciRd, iciciSavings } from "../../src/adapters/icici-bank";
import { hasErrors, validateCard } from "../../../lib/validate";
import { rateForTenure } from "../../../lib/tenure";
import type { AdapterContext, FetchedDoc, SourceDef } from "../../src/types";

const FIXTURES = path.join(__dirname, "..", "..", "fixtures");

/** ICICI's FD/RD pages point at a JSON API (see adapter file header) rather than embedding the
 * table in raw HTML, so — unlike the other banks in this group — the test context here must
 * serve a working `ctx.fetch` for that JSON, not just a static `doc`. */
function ctxWithJsonFetch(source: Partial<SourceDef> & Pick<SourceDef, "key" | "bankSlug" | "url">, htmlFixture: string, jsonByKeyword: Record<string, string>): AdapterContext {
  const html = readFileSync(path.join(FIXTURES, htmlFixture), "utf8");
  const src: SourceDef = { products: [], format: "html", runner: "github", adapter: "", cadence: "daily", active: true, ...source };
  return {
    source: src,
    today: "2026-09-27",
    doc: { url: src.url, finalUrl: src.url, status: 200, contentType: "text/html", text: html, fetchedAt: Date.parse("2026-09-27T06:00:00Z") },
    fetch: async (url): Promise<FetchedDoc> => {
      const hit = Object.entries(jsonByKeyword).find(([kw]) => url.includes(kw));
      if (!hit) throw new Error(`unexpected fetch in test: ${url}`);
      return { url, finalUrl: url, status: 200, contentType: "application/json", text: readFileSync(path.join(FIXTURES, hit[1]), "utf8"), fetchedAt: Date.now() };
    },
  };
}

describe("ICICI Bank adapter", () => {
  it("reads the retail FD card from the discovered JSON endpoint", async () => {
    const ctx = ctxWithJsonFetch({ key: "icici-bank:fd", bankSlug: "icici-bank", url: "https://www.icici.bank.in/personal-banking/deposits/fixed-deposit/fd-interest-rates" }, "icici-bank/fd-page.html", {
      "fd-interest-rate.json": "icici-bank/fd-interest-rate.json",
    });
    const out = await iciciFd(ctx);
    const fd = out.cards[0];
    expect(fd.effectiveFrom).toBe("2026-09-25");
    expect(hasErrors(validateCard(fd))).toBe(false);
    expect(fd.rows.every((r) => r.amountMax === 3e7)).toBe(true);
    const g = { amount: 1_00_000, customer: "general" as const };
    const s = { amount: 1_00_000, customer: "senior" as const };
    expect(rateForTenure(fd.rows, 100, g)?.rate).toBe(4.5); // "91 to 184 Days"
    expect(rateForTenure(fd.rows, 200, g)?.rate).toBe(5.5); // "185 to < 1 Year" (normalised bare "185")
    expect(rateForTenure(fd.rows, 200, s)?.rate).toBe(6.0);
    expect(rateForTenure(fd.rows, 1826, g)?.rate).toBe(6.5); // "5 Years 1 Day to 10 Years"
    expect(rateForTenure(fd.rows, 1826, s)?.rate).toBe(7.0);
    const taxSaver = fd.rows.find((r) => r.schemeName?.includes("Tax Saver") && r.customer === "senior");
    expect(taxSaver?.tenureMinDays).toBe(1825);
    expect(taxSaver?.rate).toBe(7.1);
  });

  it("reads the RD card from its own JSON endpoint", async () => {
    const ctx = ctxWithJsonFetch({ key: "icici-bank:rd", bankSlug: "icici-bank", url: "https://www.icici.bank.in/personal-banking/deposits/recurring-deposits/rd-interest-rates" }, "icici-bank/rd-page.html", {
      "rd-interest-rate.json": "icici-bank/rd-interest-rate.json",
    });
    const out = await iciciRd(ctx);
    const rd = out.cards[0];
    expect(rd.effectiveFrom).toBe("2025-12-29");
    expect(hasErrors(validateCard(rd))).toBe(false);
    expect(rateForTenure(rd.rows, 10, { amount: 5000, customer: "general" })?.rate).toBe(4.5);
    expect(rateForTenure(rd.rows, 10, { amount: 5000, customer: "senior" })?.rate).toBe(5.0);
    expect(rateForTenure(rd.rows, 1100, { amount: 5000, customer: "senior" })?.rate).toBe(7.1); // 1096d-1826d
  });

  it("reads the flat savings rate", async () => {
    const ctx: AdapterContext = {
      source: { key: "icici-bank:savings", bankSlug: "icici-bank", products: [], url: "https://www.icici.bank.in/personal-banking/accounts/savings-account/interest-rates", format: "html", runner: "github", adapter: "", cadence: "daily", active: true },
      today: "2026-09-27",
      doc: { url: "x", finalUrl: "x", status: 200, contentType: "text/html", text: readFileSync(path.join(FIXTURES, "icici-bank/savings.html"), "utf8"), fetchedAt: Date.now() },
      fetch: async () => {
        throw new Error("network disabled in tests");
      },
    };
    const out = await iciciSavings(ctx);
    const card = out.cards[0];
    expect(card.effectiveFrom).toBe("2025-06-26");
    expect(card.slabMethod).toBe("whole");
    expect(card.savingsSlabs).toEqual([{ balanceMin: 0, balanceMax: null, rate: 2.5, residency: "resident" }]);
  });
});
