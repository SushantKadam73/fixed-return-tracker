/**
 * Custom historical parsers for Axis, Bandhan, CSB, City Union, DCB, Dhanlaxmi, Federal, HDFC Bank, ICICI Bank, IDBI Bank, IndusInd and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/pvt-a.json.
 */
import type { HistoricalParser } from "../types";

export const parsers: Record<string, HistoricalParser> = {};
