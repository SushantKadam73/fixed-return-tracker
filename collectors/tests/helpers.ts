import { readFileSync } from "node:fs";
import path from "node:path";
import type { AdapterContext, SourceDef } from "../src/types";

/** Build an adapter context from a trimmed fixture under collectors/fixtures. */
export function ctxFromFixture(source: Partial<SourceDef> & Pick<SourceDef, "key" | "bankSlug" | "url">, fixture: string, today = "2026-09-27"): AdapterContext {
  const text = readFileSync(path.join(__dirname, "..", "fixtures", fixture), "utf8");
  const src: SourceDef = { products: [], format: "html", runner: "github", adapter: "", cadence: "daily", active: true, ...source };
  return {
    source: src,
    today,
    doc: { url: src.url, finalUrl: src.url, status: 200, contentType: "text/html", text, fetchedAt: Date.parse(`${today}T06:00:00Z`) },
    fetch: async () => {
      throw new Error("network disabled in tests");
    },
  };
}
