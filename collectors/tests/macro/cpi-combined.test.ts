import { describe, expect, it } from "vitest";
import { parseMospiCpiCombined, run } from "../../src/macro/cpi-combined";
import { ctxWithFixtures } from "./helpers";

describe("parseMospiCpiCombined (documented getCPIIndex response shape)", () => {
  it("keeps only the Combined sector and formats YYYY-MM", () => {
    const json = [
      { Year: 2026, Month: 7, Sector: 1, Index: 190.1 }, // rural — excluded
      { Year: 2026, Month: 7, Sector: 2, Index: 195.4 }, // urban — excluded
      { Year: 2026, Month: 7, Sector: 3, Index: 192.3 }, // combined
    ];
    expect(parseMospiCpiCombined(json)).toEqual([{ month: "2026-07", value: 192.3 }]);
  });

  it("also accepts a {data: [...]} wrapper and rows with no Sector field", () => {
    const json = { data: [{ Year: 2026, Month: 8, Index: 193.0 }] };
    expect(parseMospiCpiCombined(json)).toEqual([{ month: "2026-08", value: 193.0 }]);
  });

  it("ignores malformed rows instead of throwing", () => {
    expect(parseMospiCpiCombined([{ Year: 2026 }, {}, null])).toEqual([]);
    expect(parseMospiCpiCombined("not json")).toEqual([]);
  });
});

describe("cpi-combined run() (documented MoSPI API is down as of 2026-09-27 — see README)", () => {
  it("fails gracefully (ok:true, zero changes) when the API is unreachable, instead of counting as a task failure", async () => {
    const ctx = ctxWithFixtures({}); // nothing stubbed -> every fetch throws, simulating the live 502
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/unreachable|outage/i);
  });
});
