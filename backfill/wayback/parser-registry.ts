/**
 * Registry of custom historical parsers for page layouts the generic reader cannot handle.
 * Each history group keeps its own module in ./parsers/ so parallel work never collides.
 */
import type { HistoricalParser } from "./types";
import { parsers as psbA } from "./parsers/psb-a";
import { parsers as psbB } from "./parsers/psb-b";
import { parsers as pvtA } from "./parsers/pvt-a";
import { parsers as pvtB } from "./parsers/pvt-b";
import { parsers as sfb } from "./parsers/sfb";

export type { HistoricalParser } from "./types";

export const customParsers: Record<string, HistoricalParser> = { ...psbA, ...psbB, ...pvtA, ...pvtB, ...sfb };
