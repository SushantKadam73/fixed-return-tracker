import { readFileSync } from "node:fs";
import path from "node:path";
import type { FetchedDoc, SourceFormat } from "../../src/types";
import type { MacroTaskContext } from "../../src/macro/types";

export function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "..", "..", "fixtures", "macro", name), "utf8");
}

/** Repo root, computed relative to this test file so it works regardless of vitest's cwd. */
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/** A MacroTaskContext whose fetch() serves fixture text for known URLs and throws for anything else. Read-only against the real repo data (task modules never write). */
export function ctxWithFixtures(byUrl: Record<string, string>, today = "2026-09-27"): MacroTaskContext {
  return {
    today,
    root: REPO_ROOT,
    fetch: async (url: string, _format?: SourceFormat): Promise<FetchedDoc> => {
      const text = byUrl[url];
      if (text === undefined) throw Object.assign(new Error(`no fixture stubbed for ${url}`), { status: 404 });
      return { url, finalUrl: url, status: 200, contentType: "text/html", text, fetchedAt: Date.parse(`${today}T06:00:00Z`) };
    },
  };
}
