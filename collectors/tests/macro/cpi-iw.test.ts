import { describe, expect, it } from "vitest";
import { parseLabourBureauHome, parseMonthLabel, run, LABOUR_BUREAU_HOME_URL } from "../../src/macro/cpi-iw";
import { fixture, ctxWithFixtures } from "./helpers";

describe("parseMonthLabel", () => {
  it.each([
    ["Jul-2026", "2026-07"],
    ["June-2026", "2026-06"],
    ["Jan-2020", "2020-01"],
  ])("%s -> %s", (label, month) => {
    expect(parseMonthLabel(label)).toBe(month);
  });
});

describe("parseLabourBureauHome (genuine homepage widget, captured live on 2026-09-27)", () => {
  const readings = parseLabourBureauHome(fixture("labourbureau_home.html"));

  it("reads the latest two months' General Index (base 2016=100)", () => {
    expect(readings).toEqual(
      expect.arrayContaining([
        { month: "2026-06", value: 151.9, pressNoteUrl: expect.stringContaining("labourbureau.gov.in") },
        { month: "2026-07", value: 153.2, pressNoteUrl: expect.stringContaining("labourbureau.gov.in") },
      ]),
    );
  });

  it("finds the July-2026 press note PDF link next to the widget", () => {
    expect(readings[0].pressNoteUrl).toMatch(/CPI-IWJuly2026/i);
  });
});

describe("cpi-iw run() against the real repo (read-only)", () => {
  it("finds both June and July 2026 already recorded in cpi_iw_chained.json, so proposes no changes", async () => {
    // cpi_iw_chained.json's committed history now runs through 2026-07 (a live run collected
    // both months for real — see collectors/README.md), so a fresh parse of this same
    // homepage snapshot should be a genuine, verifiable no-op rather than proposing the same
    // rows again.
    const ctx = ctxWithFixtures({ [LABOUR_BUREAU_HOME_URL]: fixture("labourbureau_home.html") });
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
  });
});
