/**
 * Group a2 adapter registry: Indian Overseas Bank, Punjab & Sind Bank, Punjab National Bank,
 * UCO Bank, Union Bank of India, Bank of India.
 *
 * Exported separately from `collectors/src/adapters/index.ts` (which other groups also touch)
 * so this group's banks can be developed and tested without colliding with other in-progress
 * groups. See `collectors/README.md` for the registry contract.
 */
import type { Adapter } from "../types";
import { bankOfIndiaFd } from "./bank-of-india";
import { iobBulk, iobFd, iobSavings } from "./indian-overseas-bank";
import { psbFd } from "./punjab-and-sind-bank";
import { pnbBulk, pnbFd } from "./punjab-national-bank";
import { ucoBulk, ucoFd } from "./uco-bank";
import { unionBankBulk, unionBankFd } from "./union-bank-of-india";

export const adapters: Record<string, Adapter> = {
  "bank-of-india.fd": bankOfIndiaFd,

  "indian-overseas-bank.fd": iobFd,
  "indian-overseas-bank.bulk": iobBulk,
  "indian-overseas-bank.savings": iobSavings,

  "punjab-and-sind-bank.fd": psbFd,

  "punjab-national-bank.fd": pnbFd,
  "punjab-national-bank.bulk": pnbBulk,

  "uco-bank.fd": ucoFd,
  "uco-bank.bulk": ucoBulk,

  "union-bank-of-india.fd": unionBankFd,
  "union-bank-of-india.bulk": unionBankBulk,
};
