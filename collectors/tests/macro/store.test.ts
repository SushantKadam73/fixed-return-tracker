import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applySchemePeriod, applySeriesPoint, schemeFilePath, seriesFilePath, touchSchemeCheckedAt, touchSeriesCheckedAt } from "../../src/macro/store";

// These exercise the raw-text splicing in store.ts directly (run-macro.ts is the only real
// caller; the other macro/*.test.ts files never reach it, since their run() tests are
// read-only against the committed repo). A scratch root keeps this fully isolated from the
// actual data/ directory.
let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "macro-store-test-"));
  mkdirSync(path.join(root, "data", "schemes"), { recursive: true });
  mkdirSync(path.join(root, "data", "series"), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const seriesFixture = [
  "{",
  ' "key": "demo_series",',
  ' "checkedAt": "2026-09-01",',
  ' "name": "Demo",',
  ' "unit": "index",',
  ' "frequency": "monthly",',
  ' "publisher": "Demo Publisher",',
  ' "points": [',
  '  [',
  '   "2026-04",',
  "   100.0,",
  "   100.0",
  "  ],",
  '  [',
  '   "2026-05",',
  "   101.5,",
  "   101.5",
  "  ]",
  " ],",
  ' "notes": [',
  '  "an existing note"',
  " ]",
  "}",
  "",
].join("\n");

const schemeFixture = [
  "{",
  '  "scheme": "demo",',
  '  "name": "Demo Scheme",',
  '  "category": "small_savings",',
  '  "checkedAt": "2026-09-01",',
  '  "periods": [',
  "    {",
  '      "effectiveFrom": "2026-04-01",',
  '      "effectiveTo": "2026-06-30",',
  '      "rate": 7.0,',
  '      "note": "first",',
  '      "sourceUrl": "https://example.gov.in/a",',
  '      "evidence": "primary",',
  '      "crossCheckUrl": null',
  "    }",
  "  ]",
  "}",
  "",
].join("\n");

describe("applySeriesPoint (raw-text splice)", () => {
  it("appends a new point without touching any other byte, including a pre-existing whole-number float", () => {
    const file = seriesFilePath(root, "demo_series");
    writeFileSync(file, seriesFixture);
    const ok = applySeriesPoint(root, { kind: "series_point", seriesKey: "demo_series", target: "points", point: ["2026-06", 103.25, 103.25] });
    expect(ok).toBe(true);
    const text = readFileSync(file, "utf8");
    // The untouched rows keep their exact original "100.0"/"101.5" formatting.
    expect(text).toContain("100.0,\n   100.0\n  ],");
    expect(text).toContain("101.5,\n   101.5\n  ],"); // now followed by the new point, so it gained a trailing comma
    expect(text).toContain('"2026-06"');
    expect(text).toContain("103.25");
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text).points).toHaveLength(3);
  });

  it("appends a note via the same splice, alongside a point", () => {
    const file = seriesFilePath(root, "demo_series");
    writeFileSync(file, seriesFixture);
    applySeriesPoint(root, { kind: "series_point", seriesKey: "demo_series", target: "points", point: ["2026-06", 103.25, 103.25], appendNote: "a new note" });
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.notes).toEqual(["an existing note", "a new note"]);
    expect(parsed.points.at(-1)).toEqual(["2026-06", 103.25, 103.25]);
  });

  it("returns false and writes nothing when the date is already recorded", () => {
    const file = seriesFilePath(root, "demo_series");
    writeFileSync(file, seriesFixture);
    const before = readFileSync(file, "utf8");
    const ok = applySeriesPoint(root, { kind: "series_point", seriesKey: "demo_series", target: "points", point: ["2026-05", 999, 999] });
    expect(ok).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("falls back to a full rewrite (still correct) when the file doesn't look machine-written", () => {
    const file = seriesFilePath(root, "demo_series");
    writeFileSync(file, "{\n  \"key\": \"demo_series\", \"checkedAt\": \"2026-09-01\", \"name\": \"Demo\", \"unit\": \"index\", \"frequency\": \"monthly\", \"publisher\": \"p\", \"points\": [ [\"2026-05\", 101.5, 101.5] ]\n}\n");
    const ok = applySeriesPoint(root, { kind: "series_point", seriesKey: "demo_series", target: "points", point: ["2026-06", 103.25, 103.25] });
    expect(ok).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.points).toHaveLength(2);
    expect(parsed.points.at(-1)).toEqual(["2026-06", 103.25, 103.25]);
  });
});

describe("touchSeriesCheckedAt (raw-text splice)", () => {
  it("updates only the checkedAt value", () => {
    const file = seriesFilePath(root, "demo_series");
    writeFileSync(file, seriesFixture);
    touchSeriesCheckedAt(root, "demo_series", "2026-09-27");
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"checkedAt": "2026-09-27"');
    expect(text).toContain("100.0,\n   100.0"); // untouched
  });
});

describe("applySchemePeriod (raw-text splice)", () => {
  it("appends a new period without reformatting the existing one's whole-number rate", () => {
    const file = schemeFilePath(root, "demo");
    writeFileSync(file, schemeFixture);
    const ok = applySchemePeriod(root, {
      kind: "scheme_period",
      scheme: "demo",
      period: { effectiveFrom: "2026-07-01", effectiveTo: "2026-09-30", rate: 7.1, note: "second", sourceUrl: "https://example.gov.in/b", evidence: "primary", crossCheckUrl: null },
    });
    expect(ok).toBe(true);
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"rate": 7.0,'); // the existing period's rate keeps its original formatting
    expect(text).toContain('"effectiveFrom": "2026-07-01"');
    const parsed = JSON.parse(text);
    expect(parsed.periods).toHaveLength(2);
  });

  it("falls back to a full rewrite when closing a previously-open period (defensive path)", () => {
    const file = schemeFilePath(root, "demo");
    const openEndedFixture = schemeFixture.replace('"effectiveTo": "2026-06-30",', '"effectiveTo": null,');
    writeFileSync(file, openEndedFixture);
    const ok = applySchemePeriod(root, {
      kind: "scheme_period",
      scheme: "demo",
      period: { effectiveFrom: "2026-07-01", effectiveTo: "2026-09-30", rate: 7.1, note: "second", sourceUrl: "https://example.gov.in/b", evidence: "primary", crossCheckUrl: null },
    });
    expect(ok).toBe(true);
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    expect(parsed.periods[0].effectiveTo).toBe("2026-06-30"); // closed to the day before the new period
    expect(parsed.periods).toHaveLength(2);
  });
});

describe("touchSchemeCheckedAt (raw-text splice)", () => {
  it("updates only the checkedAt value", () => {
    const file = schemeFilePath(root, "demo");
    writeFileSync(file, schemeFixture);
    touchSchemeCheckedAt(root, "demo", "2026-09-27");
    const text = readFileSync(file, "utf8");
    expect(text).toContain('"checkedAt": "2026-09-27"');
    expect(text).toContain('"rate": 7.0,'); // untouched
  });
});
