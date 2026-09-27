/**
 * Group c1 adapter registry: jk-bank, karnataka-bank, karur-vysya-bank, kotak-mahindra-bank,
 * nainital-bank. See each bank's own adapter file for page-specific notes.
 */
import type { Adapter } from "../types";
import { jkBankBulk, jkBankFd, jkBankSavings } from "./jk-bank";
import { karnatakaBankBulk, karnatakaBankFd, karnatakaBankSavings } from "./karnataka-bank";
import { karurVysyaBankBulk, karurVysyaBankFd, karurVysyaBankSavings } from "./karur-vysya-bank";
import { kotakBulk, kotakFd, kotakRd, kotakSavings } from "./kotak-mahindra-bank";
import { nainitalBankFd, nainitalBankSavings } from "./nainital-bank";

export const adapters: Record<string, Adapter> = {
  "jk-bank.fd": jkBankFd,
  "jk-bank.bulk": jkBankBulk,
  "jk-bank.savings": jkBankSavings,
  "karnataka-bank.fd": karnatakaBankFd,
  "karnataka-bank.bulk": karnatakaBankBulk,
  "karnataka-bank.savings": karnatakaBankSavings,
  "karur-vysya-bank.fd": karurVysyaBankFd,
  "karur-vysya-bank.bulk": karurVysyaBankBulk,
  "karur-vysya-bank.savings": karurVysyaBankSavings,
  "kotak-mahindra-bank.fd": kotakFd,
  "kotak-mahindra-bank.bulk": kotakBulk,
  "kotak-mahindra-bank.rd": kotakRd,
  "kotak-mahindra-bank.savings": kotakSavings,
  "nainital-bank.fd": nainitalBankFd,
  "nainital-bank.savings": nainitalBankSavings,
};
