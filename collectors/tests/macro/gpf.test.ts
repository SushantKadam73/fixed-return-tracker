import { describe, expect, it } from "vitest";
import { run } from "../../src/macro/gpf";
import { ctxWithFixtures } from "./helpers";

describe("gpf run() against the real repo (read-only)", () => {
  it("has nothing to mirror before PPF confirms the next quarter", async () => {
    // ppf.json's committed history runs through 2026-09-30, exactly matching gpf.json's own
    // last row — so the next quarter GPF needs (Q3 FY2026-27) is not yet confirmed by PPF
    // either, and the task should say so rather than fabricate a period. Because nothing is
    // due yet, it should not even attempt a network call.
    const ctx = ctxWithFixtures({}, "2026-09-27");
    const result = await run(ctx);
    expect(result.ok).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.sourcesTried).toHaveLength(0);
    expect(result.warnings.join(" ")).toMatch(/PPF has not yet confirmed/);
  });
});
