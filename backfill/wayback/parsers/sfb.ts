/**
 * Custom historical parsers for the eleven small finance banks and their predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/sfb.json.
 */
import type { HistoricalParser } from "../types";

export const parsers: Record<string, HistoricalParser> = {};
