/**
 * Custom historical parsers for SBI, Bank of Baroda, Bank of India, Bank of Maharashtra, Canara Bank, Central Bank of India and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/psb-a.json.
 */
import type { HistoricalParser } from "../types";

export const parsers: Record<string, HistoricalParser> = {};
