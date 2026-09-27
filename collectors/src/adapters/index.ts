/**
 * Aggregates the per-group adapter maps. Each group file exports `adapters` — a map from
 * adapter name (as used in data/sources/sources.json) to the adapter function.
 */
import type { Adapter } from "../types";

export const groupAdapters: Record<string, Adapter> = {};
