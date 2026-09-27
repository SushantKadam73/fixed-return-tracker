import { describe, expect, it } from "vitest";
import { parseRbiCurrentRates, run, RBI_HOME_URL } from "../../src/macro/rbi-rates";
import { fixture, ctxWithFixtures } from "./helpers";

describe("parseRbiCurrentRates (genuine 'Current Rates' box, captured live on 2026-09-27)", () => {
  const parsed = parseRbiCurrentRates(fixture("rbi_home.html"));

  it("reads every policy rate and reserve ratio", () => {
    expect(parsed.values).toEqual({ repo: 5.25, sdf: 5.0, msf: 5.5, bank_rate: 5.5, crr: 3.0, slr: 18.0, usdinr: 95.8918 });
  });

  it("reads the 'As at' snapshot date", () => {
    expect(parsed.asAt).toBe("2026-09-25");
  });

  it("ignores a decoy 'Bank Rate' figure that sits outside the CURRENT RATES START/END markers", () => {
    const decoy = `<table><tr><td>Bank Rate</td><td>99.99%</td></tr></table>${fixture("rbi_home.html")}`;
    expect(parseRbiCurrentRates(decoy).values.bank_rate).toBe(5.5);
  });
});

describe("rbi-rates run() against the real repo (read-only)", () => {
  it("finds every series already matches the committed data, so proposes no changes", async () => {
    // data/series/rbi_{repo,sdf,msf,bank_rate,crr,slr}_rate.json all already end on
    // exactly these values as of the 2026-09-27 research pass, so a live parse of the
    // homepage on the same date should be a genuine, verifiable no-op.
    const ctx = ctxWithFixtures({ [RBI_HOME_URL]: fixture("rbi_home.html") });
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.warnings.some((w) => /INR\/USD reference/.test(w))).toBe(true);
  });
});
