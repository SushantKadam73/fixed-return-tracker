/**
 * Custom historical parsers for IDFC FIRST, J&K Bank, Karnataka Bank, Karur Vysya, Kotak Mahindra, Nainital, RBL, South Indian Bank, Tamilnad Mercantile, YES Bank and their merged predecessors.
 * Key convention: "<bankSlug>/<era-or-layout>", e.g. "sbi/2003-portal". Reference the key from a
 * target's "parser" field in backfill/wayback/targets/pvt-b.json.
 */
import type { HistoricalParser } from "../types";

export const parsers: Record<string, HistoricalParser> = {};
