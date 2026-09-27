/**
 * Aggregates the per-group adapter maps. Each group file exports `adapters` — a map from
 * adapter name (as used in data/sources/sources.json) to the adapter function.
 */
import type { Adapter } from "../types";
import { adapters as d1 } from "./group-d1";
import { adapters as d2 } from "./group-d2";

export const groupAdapters: Record<string, Adapter> = {
  ...d1,
  ...d2,
};
