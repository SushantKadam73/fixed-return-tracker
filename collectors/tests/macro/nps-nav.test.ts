import { describe, expect, it } from "vitest";
import { parseNpsTsv, run, NPS_TRUST_BASE } from "../../src/macro/nps-nav";
import { fixture, ctxWithFixtures } from "./helpers";

describe("parseNpsTsv (genuine NPS Trust response, incl. the 1 Apr 2026 scheme-code switch)", () => {
  const rows = parseNpsTsv(fixture("nps_sm001003_excerpt.tsv"));

  it("reads real recent NAVs under the new (post-switch) scheme code", () => {
    expect(rows.find((r) => r.date === "2026-09-25")).toEqual({ date: "2026-09-25", nav: "54.9612", scheme_code: "SM001025" });
  });

  it("reads the exact switchover day: 31 Mar 2026 under the old code, 1 Apr 2026 under the new one, same NAV", () => {
    const mar31 = rows.find((r) => r.date === "2026-03-31");
    const apr1 = rows.find((r) => r.date === "2026-04-01");
    expect(mar31).toEqual({ date: "2026-03-31", nav: "51.6234", scheme_code: "SM001003" });
    expect(apr1).toEqual({ date: "2026-04-01", nav: "51.6234", scheme_code: "SM001025" });
  });

  it("reads the oldest rows (scheme inception, 2009)", () => {
    expect(rows.find((r) => r.date === "2009-05-05")).toEqual({ date: "2009-05-05", nav: "10", scheme_code: "SM001003" });
  });

  it("skips the '...' ellipsis rows used to keep this fixture small, without throwing", () => {
    expect(rows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.date))).toBe(true);
  });
});

describe("nps-nav run() against the real repo (read-only)", () => {
  it("finds every date in the fixture already recorded in sbi_scheme_e_tieri.csv, so proposes no changes", async () => {
    // The committed CSV already runs through 2026-09-25 (the newest date in this fixture),
    // so a genuine live response covering the same window should be a verifiable no-op.
    const seedUrl = `${NPS_TRUST_BASE}?navcatdataxls=PFM001&navyearselxls=all&navsubdataxls=SM001003`;
    const ctx = ctxWithFixtures({ [seedUrl]: fixture("nps_sm001003_excerpt.tsv") });
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    const eTier = result.changes.find((c) => c.kind === "nps_rows" && c.file === "sbi_scheme_e_tieri.csv");
    expect(eTier).toBeUndefined();
  });
});
