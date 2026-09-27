/**
 * Custom historical parsers for page layouts the generic reader cannot handle.
 * Each returns the same shape as readTermTables. Add one per bank/era as needed.
 */
import type { GenericResult } from "./generic-parse";
import type { Target } from "./run";

export type HistoricalParser = (html: string, target: Target) => GenericResult;

export const customParsers: Record<string, HistoricalParser> = {};
