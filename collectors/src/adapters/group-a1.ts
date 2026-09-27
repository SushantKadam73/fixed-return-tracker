/**
 * Group a1 adapter registry: Bank of Baroda, Bank of Maharashtra, Canara Bank,
 * Central Bank of India, Indian Bank.
 *
 * Exported separately from `collectors/src/adapters/index.ts` (which other groups also touch)
 * so this group's banks can be developed and tested without colliding with other in-progress
 * groups. See `collectors/README.md` for the registry contract.
 */
import type { Adapter } from "../types";
import { bankOfBarodaBulk, bankOfBarodaFd, bankOfBarodaSavings, bankOfBarodaTaxSaver } from "./bank-of-baroda";
import { bankOfMaharashtraBulk, bankOfMaharashtraFd, bankOfMaharashtraSavings } from "./bank-of-maharashtra";
import { canaraBankBulk, canaraBankFd, canaraBankSavings } from "./canara-bank";
import { centralBankOfIndiaBulk, centralBankOfIndiaFd, centralBankOfIndiaSavings } from "./central-bank-of-india";
import { indianBankBulk, indianBankFd, indianBankSavings } from "./indian-bank";

export const adapters: Record<string, Adapter> = {
  "bank-of-baroda.fd": bankOfBarodaFd,
  "bank-of-baroda.bulk": bankOfBarodaBulk,
  "bank-of-baroda.savings": bankOfBarodaSavings,
  "bank-of-baroda.tax_saver": bankOfBarodaTaxSaver,

  "bank-of-maharashtra.fd": bankOfMaharashtraFd,
  "bank-of-maharashtra.bulk": bankOfMaharashtraBulk,
  "bank-of-maharashtra.savings": bankOfMaharashtraSavings,

  "canara-bank.fd": canaraBankFd,
  "canara-bank.bulk": canaraBankBulk,
  "canara-bank.savings": canaraBankSavings,

  "central-bank-of-india.fd": centralBankOfIndiaFd,
  "central-bank-of-india.bulk": centralBankOfIndiaBulk,
  "central-bank-of-india.savings": centralBankOfIndiaSavings,

  "indian-bank.fd": indianBankFd,
  "indian-bank.bulk": indianBankBulk,
  "indian-bank.savings": indianBankSavings,
};
