/**
 * Group d2 — Small Finance Banks: Utkarsh, slice, Jana, Shivalik, Unity.
 * Registers every adapter written for this group so registry.ts can pick them up by the
 * `adapter` name used in data/sources/fragments/d2.json.
 *
 * `slice-sfb.history` and `unity-sfb.history` are not wired to any source in d2.json (they
 * read a different, archive-shaped document than the live per-product sources and are meant
 * to be run on demand by a maintainer backfilling history), but are exported here too so
 * they can be invoked by name, e.g. via collectors/scripts/try-adapter.ts.
 */
import type { Adapter } from "../types";
import { utkarshFd, utkarshRd, utkarshSavings } from "./utkarsh-sfb";
import { sliceFd, sliceRd, sliceSavings, sliceHistory } from "./slice-sfb";
import { janaFd, janaBulk, janaRd, janaSavings } from "./jana-sfb";
import { shivalikFd, shivalikRd, shivalikSavings } from "./shivalik-sfb";
import { unityFd, unityBulk, unitySavings, unityHistory } from "./unity-sfb";

export const adapters: Record<string, Adapter> = {
  "utkarsh-sfb.fd": utkarshFd,
  "utkarsh-sfb.rd": utkarshRd,
  "utkarsh-sfb.savings": utkarshSavings,

  "slice-sfb.fd": sliceFd,
  "slice-sfb.rd": sliceRd,
  "slice-sfb.savings": sliceSavings,
  "slice-sfb.history": sliceHistory,

  "jana-sfb.fd": janaFd,
  "jana-sfb.bulk": janaBulk,
  "jana-sfb.rd": janaRd,
  "jana-sfb.savings": janaSavings,

  "shivalik-sfb.fd": shivalikFd,
  "shivalik-sfb.rd": shivalikRd,
  "shivalik-sfb.savings": shivalikSavings,

  "unity-sfb.fd": unityFd,
  "unity-sfb.bulk": unityBulk,
  "unity-sfb.savings": unitySavings,
  "unity-sfb.history": unityHistory,
};
