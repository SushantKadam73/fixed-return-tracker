/**
 * Group c2 — RBL Bank, South Indian Bank, Tamilnad Mercantile Bank, YES Bank, IDBI Bank.
 * See each <slug>.ts file for bank-specific notes. Registered here for collectors/src/registry.ts.
 */
import type { Adapter } from "../types";
import { idbiBulk, idbiFd, idbiRd, idbiSavings } from "./idbi-bank";
import { rblBulk, rblBulkCallable, rblBulkNonCallable, rblFd, rblRd, rblSavings } from "./rbl-bank";
import { sibBulk, sibFd, sibSavings } from "./south-indian-bank";
import { tmbBulk, tmbFd, tmbSavings } from "./tamilnad-mercantile-bank";
import { yesBulk, yesFd, yesRd, yesSavings } from "./yes-bank";

export const adapters: Record<string, Adapter> = {
  "rbl-bank.fd": rblFd,
  "rbl-bank.savings": rblSavings,
  "rbl-bank.rd": rblRd,
  "rbl-bank.bulk": rblBulk,
  "rbl-bank.bulk_callable": rblBulkCallable,
  "rbl-bank.bulk_noncallable": rblBulkNonCallable,
  "south-indian-bank.fd": sibFd,
  "south-indian-bank.savings": sibSavings,
  "south-indian-bank.bulk": sibBulk,
  "tamilnad-mercantile-bank.fd": tmbFd,
  "tamilnad-mercantile-bank.savings": tmbSavings,
  "tamilnad-mercantile-bank.bulk": tmbBulk,
  "yes-bank.fd": yesFd,
  "yes-bank.rd": yesRd,
  "yes-bank.savings": yesSavings,
  "yes-bank.bulk": yesBulk,
  "idbi-bank.fd": idbiFd,
  "idbi-bank.rd": idbiRd,
  "idbi-bank.savings": idbiSavings,
  "idbi-bank.bulk": idbiBulk,
};
