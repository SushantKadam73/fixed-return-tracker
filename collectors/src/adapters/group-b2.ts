/**
 * Group b2 (private banks): federal-bank, hdfc-bank, icici-bank, indusind-bank, idfc-first-bank.
 * Registers every adapter function in this group under the name used by its source entry in
 * data/sources/fragments/b2.json.
 */
import type { Adapter } from "../types";
import { federalFd, federalSavings } from "./federal-bank";
import { hdfcBulk, hdfcFd, hdfcRd, hdfcSavings } from "./hdfc-bank";
import { iciciFd, iciciRd, iciciSavings } from "./icici-bank";
import { idfcFirstBulk, idfcFirstFd, idfcFirstSavings } from "./idfc-first-bank";
import { indusindBulk, indusindFd, indusindSavings } from "./indusind-bank";

export const adapters: Record<string, Adapter> = {
  "federal-bank.fd": federalFd, // also produces the "rd" card (derived — see file header)
  "federal-bank.savings": federalSavings,

  "hdfc-bank.fd": hdfcFd,
  "hdfc-bank.bulk": hdfcBulk,
  "hdfc-bank.rd": hdfcRd,
  "hdfc-bank.savings": hdfcSavings,

  "icici-bank.fd": iciciFd,
  "icici-bank.rd": iciciRd,
  "icici-bank.savings": iciciSavings,

  "indusind-bank.fd": indusindFd,
  "indusind-bank.bulk": indusindBulk,
  "indusind-bank.savings": indusindSavings,

  "idfc-first-bank.fd": idfcFirstFd, // also produces the "rd" card (explicit RD table in the same PDF)
  "idfc-first-bank.bulk": idfcFirstBulk,
  "idfc-first-bank.savings": idfcFirstSavings,
};
