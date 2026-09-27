/* eslint-disable */
  /**
   * Generated `api` utility.
   *
   * THIS CODE IS AUTOMATICALLY GENERATED.
   *
   * To regenerate, run `npx convex dev`.
   * @module
   */
  
  import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";
  import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as monitor from "../monitor.js";
import type * as notify from "../notify.js";
import type * as public_ from "../public.js";
import type * as summaries from "../summaries.js";
import type * as validators from "../validators.js";

  /**
   * A utility for referencing Convex functions in your app's API.
   *
   * Usage:
   * ```js
   * const myFunctionReference = api.myModule.myFunction;
   * ```
   */
  declare const fullApi: ApiFromModules<{
    "crons": typeof crons,
"http": typeof http,
"ingest": typeof ingest,
"monitor": typeof monitor,
"notify": typeof notify,
"public": typeof public_,
"summaries": typeof summaries,
"validators": typeof validators,
  }>;
  export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
  export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
  