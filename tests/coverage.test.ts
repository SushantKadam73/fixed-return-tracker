import { describe, expect, it } from "vitest";
import { bankCoverage, productCoverage, regulatedPeriods } from "../lib/coverage";
import type { StoredCard } from "../lib/summary-build";

const card = (over: Partial<StoredCard>): StoredCard => ({
  bankSlug: "x",
  product: "fd",
  effectiveFrom: null,
  observedAt: "2026-09-27",
  sourceType: "bank_official",
  sourceUrl: "https://example.bank.in/rates",
  confidence: "high",
  rows: [],
  contentHash: "h",
  ...over,
});

describe("productCoverage", () => {
  it("expects bank-specific FD evidence only from deregulation (22 Oct 1997) for an old bank", () => {
    const cards = [
      card({ sourceType: "bank_archive", effectiveFrom: "2008-01-04" }),
      card({ sourceType: "bank_archive", effectiveFrom: "2012-02-01" }),
      card({ sourceType: "bank_official", effectiveFrom: "2026-06-16" }),
    ];
    const c = productCoverage("fd", cards, { founded: "1955-07-01", endDate: "2026-09-27" });
    expect(c.expectedFrom).toBe("1997-10-22");
    expect(c.earliest).toBe("2008-01-04");
    expect(c.latest).toBe("2026-09-27");
    // Archive revisions run until the next one, so the only gap is before the first card.
    expect(c.gaps).toEqual([{ from: "1997-10-22", to: "2008-01-03", days: 3726, kind: "before_first" }]);
    expect(c.byGranularity).toEqual({ exact: 3, window: 0, snapshot: 0 });
    expect(c.live).toBe(true);
  });

  it("reports a gap between archive observation windows that are far apart", () => {
    const cards = [
      card({ sourceType: "web_archive", observedFrom: "2001-01-10", observedTo: "2001-06-30" }),
      card({ sourceType: "web_archive", observedFrom: "2003-02-01", observedTo: "2003-03-01" }),
    ];
    const c = productCoverage("fd", cards, { founded: "1929", endDate: "2003-12-31" });
    expect(c.gaps.map((g) => [g.kind, g.from, g.to])).toEqual([
      ["before_first", "1997-10-22", "2001-01-09"],
      ["between", "2001-07-01", "2003-01-31"],
      ["after_last", "2003-03-02", "2003-12-31"],
    ]);
    expect(c.byGranularity.window).toBe(2);
  });

  it("uses the founding date for banks created after deregulation, and savings deregulation for savings", () => {
    const fd = productCoverage("fd", [card({ observedAt: "2026-09-27" })], { founded: "2017-04-23", endDate: "2026-09-27" });
    expect(fd.expectedFrom).toBe("2017-04-23");
    expect(fd.gaps[0]).toMatchObject({ kind: "before_first", from: "2017-04-23", to: "2026-09-26" });
    const sb = productCoverage("savings", [], { founded: "1906", endDate: "2026-09-27" });
    expect(sb.expectedFrom).toBe("2011-10-25");
    expect(sb.gaps).toEqual([{ from: "2011-10-25", to: "2026-09-27", days: 5451, kind: "none" }]);
  });
});

describe("regulatedPeriods and bankCoverage", () => {
  it("gives no regulated term-deposit period to a bank founded after 1997, but a savings one until 2011", () => {
    expect(regulatedPeriods("2004-05-01", "2026-09-27")).toEqual({ termDeposits: null, savings: { from: "2004-05-01", to: "2011-10-24" } });
    expect(regulatedPeriods("2021-11-01", "2026-09-27")).toEqual({ termDeposits: null, savings: null });
  });

  it("stops a predecessor's expected period the day before its merger", () => {
    const cov = bankCoverage({ slug: "sbt", name: "State Bank of Travancore", founded: "1945-09-12", mergedInto: "sbi", mergedOn: "2017-04-01" }, {}, "2026-09-27");
    expect(cov.kind).toBe("predecessor");
    const fd = cov.products.find((p) => p.product === "fd")!;
    expect(fd.expectedTo).toBe("2017-03-31");
    expect(fd.gaps[0]).toMatchObject({ kind: "none", from: "1997-10-22", to: "2017-03-31" });
    expect(cov.regulated.termDeposits).toEqual({ from: "1945-09-12", to: "1997-10-21" });
  });
});
