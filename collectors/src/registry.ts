/**
 * Adapter registry and source list.
 * Group files keep bank adapters independent so they can be developed and tested in parallel.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Adapter, SourceDef } from "./types";
import { sbiBulk, sbiRetail, sbiSavings } from "./adapters/sbi";
import { groupAdapters } from "./adapters";

export const adapters: Record<string, Adapter> = {
  "sbi.retail": sbiRetail,
  "sbi.bulk": sbiBulk,
  "sbi.savings": sbiSavings,
  ...groupAdapters,
};

export function loadSources(root = process.cwd()): SourceDef[] {
  const file = path.join(root, "data", "sources", "sources.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { sources: SourceDef[] };
  return parsed.sources;
}
