/**
 * Group b1 — Axis Bank, Bandhan Bank, CSB Bank, City Union Bank, DCB Bank, Dhanlaxmi Bank.
 * Aggregates this group's per-bank adapter modules into the map the runner (and
 * data/sources/fragments/b1.json) looks up adapter names in.
 */
import { axisBulk, axisFd, axisRd, axisSavings } from "./axis-bank";
import { bandhanBulk, bandhanFd, bandhanSavings } from "./bandhan-bank";
import { csbBulk, csbFd, csbSavings } from "./csb-bank";
import { cubBulk, cubFd, cubSavings } from "./city-union-bank";
import { dcbBulk, dcbFd, dcbSavings } from "./dcb-bank";
import { dhanlaxmiBulk, dhanlaxmiFd, dhanlaxmiSavings } from "./dhanlaxmi-bank";
import type { Adapter } from "../types";

export const adapters: Record<string, Adapter> = {
  "axis-bank.fd": axisFd,
  "axis-bank.bulk": axisBulk,
  "axis-bank.rd": axisRd,
  "axis-bank.savings": axisSavings,
  "bandhan-bank.fd": bandhanFd,
  "bandhan-bank.bulk": bandhanBulk,
  "bandhan-bank.savings": bandhanSavings,
  "csb-bank.fd": csbFd,
  "csb-bank.bulk": csbBulk,
  "csb-bank.savings": csbSavings,
  "city-union-bank.fd": cubFd,
  "city-union-bank.bulk": cubBulk,
  "city-union-bank.savings": cubSavings,
  "dcb-bank.fd": dcbFd,
  "dcb-bank.bulk": dcbBulk,
  "dcb-bank.savings": dcbSavings,
  "dhanlaxmi-bank.fd": dhanlaxmiFd,
  "dhanlaxmi-bank.bulk": dhanlaxmiBulk,
  "dhanlaxmi-bank.savings": dhanlaxmiSavings,
};
