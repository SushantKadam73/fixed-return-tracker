/**
 * Custom historical parsers for Indian Bank, Indian Overseas Bank, Punjab & Sind Bank, Punjab National Bank, UCO Bank, Union Bank of India and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/psb-b.json.
 */
import type { HistoricalParser } from "../types";

export const parsers: Record<string, HistoricalParser> = {};
