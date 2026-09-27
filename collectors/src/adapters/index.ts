/**
 * Aggregates the per-group adapter maps. Each group file exports `adapters` — a map from
 * adapter name (as used in data/sources/sources.json) to the adapter function.
 */
import type { Adapter } from "../types";
import { adapters as a1 } from "./group-a1";
import { adapters as a2 } from "./group-a2";
import { adapters as b2 } from "./group-b2";
import { adapters as c1 } from "./group-c1";
import { adapters as d1 } from "./group-d1";
import { adapters as d2 } from "./group-d2";

export const groupAdapters: Record<string, Adapter> = {
  ...a1,
  ...a2,
  ...b2,
  ...c1,
  ...d1,
  ...d2,
};
