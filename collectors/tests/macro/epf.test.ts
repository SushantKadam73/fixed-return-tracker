import { describe, expect, it } from "vitest";
import { parseEpfText } from "../../src/macro/epf";
import { fixture } from "./helpers";

describe("parseEpfText (genuine PIB and EPFO circular text)", () => {
  it("classifies a CBT recommendation as a recommendation, not a declaration", () => {
    const signal = parseEpfText(fixture("pib_epf_cbt_recommendation.txt"));
    expect(signal).toEqual({ fyStart: 2025, rate: 8.25, kind: "recommendation" });
  });

  it("classifies an EPFO 'Declaration of Rate of Interest' circular as an actual declaration", () => {
    const signal = parseEpfText(fixture("epfo_circular_declaration.txt"));
    expect(signal).toEqual({ fyStart: 2024, rate: 8.25, kind: "declaration" });
  });

  it("returns null when neither a rate nor a financial year can be found", () => {
    expect(parseEpfText("The Board discussed several matters today.")).toBeNull();
  });
});
