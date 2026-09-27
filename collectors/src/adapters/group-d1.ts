/**
 * Group d1 — Small Finance Banks: AU, Capital, Equitas, ESAF, Suryoday, Ujjivan.
 * Registry consumed by the runner and by collectors/scripts/try-adapter.ts.
 */
import type { Adapter } from "../types";
import { auSfbFd, auSfbRd, auSfbSavings } from "./au-sfb";
import { capitalSfbFd, capitalSfbSavings } from "./capital-sfb";
import { equitasSfbFd, equitasSfbRd } from "./equitas-sfb";
import { esafSfbFd, esafSfbSavings } from "./esaf-sfb";
import { suryodaySfbFd, suryodaySfbSavings } from "./suryoday-sfb";
import { ujjivanSfbBulk, ujjivanSfbFd, ujjivanSfbRd, ujjivanSfbSavings } from "./ujjivan-sfb";

export const adapters: Record<string, Adapter> = {
  "au-sfb.fd": auSfbFd,
  "au-sfb.rd": auSfbRd,
  "au-sfb.savings": auSfbSavings,
  "capital-sfb.fd": capitalSfbFd,
  "capital-sfb.savings": capitalSfbSavings,
  "equitas-sfb.fd": equitasSfbFd,
  "equitas-sfb.rd": equitasSfbRd,
  "esaf-sfb.fd": esafSfbFd, // also returns the derived RD card (cards[1]) — see esaf-sfb.ts
  "esaf-sfb.savings": esafSfbSavings,
  "suryoday-sfb.savings": suryodaySfbSavings,
  // Not wired to any live source in d1.json: found only via a client-side tab click this
  // project's fetchers can't perform (see suryoday-sfb.ts file header). Registered here so it
  // stays testable and ready for the day fetch.ts supports it.
  "suryoday-sfb.fd": suryodaySfbFd,
  "ujjivan-sfb.fd": ujjivanSfbFd,
  "ujjivan-sfb.rd": ujjivanSfbRd,
  "ujjivan-sfb.savings": ujjivanSfbSavings,
  "ujjivan-sfb.bulk": ujjivanSfbBulk,
};
