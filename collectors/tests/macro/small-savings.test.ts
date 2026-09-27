import { describe, expect, it } from "vitest";
import { parseNsiMasterTable, matchSchemeKey } from "../../src/macro/nsi-table";
import { parseIndiaPostRateTable, isUnchangedNotice, NSI_URL, run } from "../../src/macro/small-savings";
import { fixture, ctxWithFixtures } from "./helpers";

describe("matchSchemeKey", () => {
  it.each([
    ["Savings Account", "po_sb"],
    ["1 Year Time Deposit", "po_td_1y"],
    ["2 Year Time Deposit", "po_td_2y"],
    ["3 Year Time Deposit", "po_td_3y"],
    ["5 Year Time Deposit", "po_td_5y"],
    ["5 Year Recurring Deposit", "po_rd"],
    ["5 Year Senior Citizens Savings Scheme", "scss"],
    ["5 Year Monthly Income Account", "pomis"],
    ["5 Year National Savings Certificate", "nsc"],
    ["Public Provident Fund", "ppf"],
    ["Sukanya Samriddhi Account Scheme", "ssy"],
    ["Kisan Vikas Patra", "kvp"],
  ])("%s -> %s", (label, key) => {
    expect(matchSchemeKey(label)).toBe(key);
  });
});

describe("parseNsiMasterTable (genuine values from the official NSI page, via Exa cache)", () => {
  const rows = parseNsiMasterTable(fixture("nsi_id_pk_132.html"));

  it("reads the current-quarter block (FY2025-26) for every scheme", () => {
    const q2 = rows.filter((r) => r.start === "2025-07-01" && r.end === "2025-09-30");
    expect(q2.length).toBe(12);
    expect(q2.find((r) => r.scheme === "ppf")?.rate).toBe(7.1);
    expect(q2.find((r) => r.scheme === "scss")?.rate).toBe(8.2);
    expect(q2.find((r) => r.scheme === "po_td_1y")?.rate).toBe(6.9);
  });

  it("extracts KVP's doubling period alongside its rate", () => {
    const kvp = rows.find((r) => r.scheme === "kvp" && r.start === "2025-04-01");
    expect(kvp?.rate).toBe(7.5);
    expect(kvp?.maturityMonths).toBe(115);
  });

  it("reads the multi-FY block (FY2022-23 through FY2024-25), including a mid-year rate change", () => {
    const oneYearTd = rows.filter((r) => r.scheme === "po_td_1y" && r.start >= "2022-04-01" && r.start < "2025-04-01");
    expect(oneYearTd).toHaveLength(12);
    expect(oneYearTd.find((r) => r.start === "2022-04-01")?.rate).toBe(5.5);
    expect(oneYearTd.find((r) => r.start === "2023-01-01")?.rate).toBe(6.6); // rate changed mid FY2022-23
    expect(oneYearTd.find((r) => r.start === "2024-04-01")?.rate).toBe(6.9);
    const kvp = rows.find((r) => r.scheme === "kvp" && r.start === "2022-10-01");
    expect(kvp?.rate).toBe(7.0);
    expect(kvp?.maturityMonths).toBe(123);
  });
});

describe("parseIndiaPostRateTable (genuine values via Exa cache of indiapost.gov.in)", () => {
  const parsed = parseIndiaPostRateTable(fixture("india_post_schemes.html"));

  it("reads the w.e.f date range from the table header", () => {
    expect(parsed?.start).toBe("2024-04-01");
    expect(parsed?.end).toBe("2024-06-30");
  });

  it("strips the parenthetical rupee-value asides and reads the real rate", () => {
    const td1y = parsed?.rates.find((r) => r.scheme === "po_td_1y");
    expect(td1y?.rate).toBe(6.9);
    const scss = parsed?.rates.find((r) => r.scheme === "scss");
    expect(scss?.rate).toBe(8.2);
  });

  it("reads KVP's doubling period from the same free-text cell shape as NSI", () => {
    const kvp = parsed?.rates.find((r) => r.scheme === "kvp");
    expect(kvp?.rate).toBe(7.5);
    expect(kvp?.maturityMonths).toBe(115);
  });
});

describe("isUnchangedNotice (genuine India-Post-mirrored DEA OM text, incl. real OCR noise)", () => {
  it("recognises the 'shall remain unchanged' recital even with OCR-mangled words around it", () => {
    expect(isUnchangedNotice(fixture("dea_om_unchanged_q2_fy2026_27.txt"))).toBe(true);
  });

  it("does not fire on ordinary text", () => {
    expect(isUnchangedNotice("The rate has been revised to 7.8% with effect from 1 July 2026.")).toBe(false);
  });
});

describe("run() against the real repo (read-only) with the NSI fixture stubbed in", () => {
  it("fetches NSI, finds no row for the (much later) target quarter, and proposes no changes", async () => {
    // The committed ppf.json already runs through 2026-09-30 (Q2 FY2026-27), so the next
    // quarter run() looks for is Q3 FY2026-27 (Oct-Dec 2026) — later than anything in the
    // fixture's newest block (FY2025-26). run() should still reach out to NSI (proving the
    // fetch/parse wiring works end to end) and come back empty-handed rather than guess.
    const ctx = ctxWithFixtures({ [NSI_URL]: fixture("nsi_id_pk_132.html") }, "2026-10-05");
    const result = await run(ctx);
    expect(result.sourcesTried.some((s) => s.url === NSI_URL && s.ok)).toBe(true);
    expect(result.changes).toHaveLength(0);
  });

  it("does nothing before the next quarter has even started", async () => {
    const ctx = ctxWithFixtures({}, "2026-09-27");
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.sourcesTried).toHaveLength(0);
    expect(result.changes).toHaveLength(0);
  });
});
