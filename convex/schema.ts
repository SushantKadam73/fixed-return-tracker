/**
 * Fixed Return Tracker — database schema.
 *
 * Design notes (plain language):
 * - A "rate card" is one bank's published table for one product (FD, RD, savings...)
 *   as it stood on a date. Cards are never edited in place: when a bank changes its
 *   rates, a new card is added and the previous one gets an end date. That keeps the
 *   full history and makes every number traceable to its source.
 * - Old history (reconstructed from RBI records, bank archives and web-archive copies)
 *   lives in the same table, labelled with a weaker source type and confidence.
 * - The website reads small pre-computed "summaries" rather than scanning big tables,
 *   which keeps usage inside Convex's free limits.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  bankGroup,
  confidence,
  product,
  rateRow,
  runner,
  savingsSlab,
  slabMethod,
  sourceType,
} from "./validators";

export default defineSchema({
  /** Every bank the tracker knows about, including merged predecessors (for lineage). */
  banks: defineTable({
    slug: v.string(),
    name: v.string(),
    shortName: v.string(),
    group: bankGroup,
    status: v.union(v.literal("active"), v.literal("merged"), v.literal("defunct")),
    /** tracked = live collection; deferred = later release; historical_only = merged bank. */
    tracking: v.union(v.literal("tracked"), v.literal("deferred"), v.literal("historical_only")),
    founded: v.optional(v.string()),
    website: v.optional(v.string()),
    legacyDomains: v.array(v.string()),
    mergedInto: v.optional(v.string()),
    mergedOn: v.optional(v.string()),
    nseSymbol: v.optional(v.string()),
    history: v.array(v.object({ date: v.string(), event: v.string(), evidenceUrl: v.optional(v.string()) })),
    notes: v.optional(v.string()),
  })
    .index("by_slug", ["slug"])
    .index("by_group", ["group"]),

  /** Registry of every page/file we read, with the runner that reads it and its health. */
  sources: defineTable({
    key: v.string(), // e.g. "sbi:fd", "scheme:small-savings", "series:cpi"
    bankSlug: v.optional(v.string()),
    kind: v.union(v.literal("bank_page"), v.literal("scheme"), v.literal("series"), v.literal("registry")),
    products: v.array(v.string()),
    url: v.string(),
    format: v.string(), // html | pdf | json | browser
    runner: runner,
    adapter: v.string(),
    cadence: v.string(), // daily | bulk_daily | weekly | monthly | quarterly
    active: v.boolean(),
    robotsAllowed: v.optional(v.boolean()),
    termsNote: v.optional(v.string()),
    lastAttemptAt: v.optional(v.number()),
    lastSuccessAt: v.optional(v.number()),
    lastChangeAt: v.optional(v.number()),
    lastContentHash: v.optional(v.string()),
    consecutiveFailures: v.number(),
    lastError: v.optional(v.string()),
  })
    .index("by_key", ["key"])
    .index("by_runner", ["runner", "active"]),

  /** Short-lived fetch log (pruned after 60 days). Raw page copies are stored privately, not here. */
  captures: defineTable({
    sourceKey: v.string(),
    fetchedAt: v.number(),
    httpStatus: v.optional(v.number()),
    contentHash: v.optional(v.string()),
    outcome: v.union(v.literal("unchanged"), v.literal("new_card"), v.literal("rejected"), v.literal("error")),
    message: v.optional(v.string()),
  }).index("by_source_time", ["sourceKey", "fetchedAt"]),

  /** Versioned, sourced rate cards — current and historical. */
  rateCards: defineTable({
    bankSlug: v.string(),
    product: product,
    effectiveFrom: v.optional(v.string()), // as stated by the source
    validTo: v.optional(v.string()), // filled when superseded by a newer card
    observedAt: v.string(), // date read (live) or captured (archive)
    observedFrom: v.optional(v.string()), // reconstructed history: in force at least from...
    observedTo: v.optional(v.string()), // ...to
    isCurrent: v.boolean(),
    sourceType: sourceType,
    sourceUrl: v.string(),
    archiveUrl: v.optional(v.string()),
    confidence: confidence,
    contentHash: v.string(), // hash of the normalised rows, used to ignore unchanged re-reads
    rows: v.array(rateRow),
    savingsSlabs: v.optional(v.array(savingsSlab)),
    slabMethod: v.optional(slabMethod),
    notes: v.optional(v.array(v.string())),
  })
    .index("by_bank_product_current", ["bankSlug", "product", "isCurrent"])
    .index("by_bank_product_effective", ["bankSlug", "product", "effectiveFrom"])
    .index("by_current_product", ["isCurrent", "product"]),

  /** Product conditions that are not rates: penalties, minimums, compounding, credit timing. */
  productTerms: defineTable({
    bankSlug: v.string(),
    product: product,
    observedAt: v.string(),
    sourceUrl: v.string(),
    terms: v.object({
      minAmount: v.optional(v.number()),
      maxAmount: v.optional(v.number()),
      bulkThreshold: v.optional(v.number()),
      seniorPremium: v.optional(v.string()),
      seniorPremiumCap: v.optional(v.string()),
      superSeniorPremium: v.optional(v.string()),
      prematurePenalty: v.optional(v.string()),
      compounding: v.optional(v.string()),
      interestCredit: v.optional(v.string()),
      rdRules: v.optional(v.string()),
      other: v.optional(v.array(v.string())),
    }),
  }).index("by_bank_product", ["bankSlug", "product"]),

  /** Government small-savings, provident-fund and bond schemes. */
  schemes: defineTable({
    key: v.string(),
    name: v.string(),
    category: v.union(v.literal("small_savings"), v.literal("provident_fund"), v.literal("bond"), v.literal("pension")),
    description: v.optional(v.string()),
    conventions: v.optional(v.array(v.string())),
    sourceUrl: v.optional(v.string()),
  }).index("by_key", ["key"]),

  schemeRates: defineTable({
    scheme: v.string(),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    rate: v.optional(v.number()), // absent when only a maturity period was published (e.g. early KVP)
    maturityMonths: v.optional(v.number()),
    note: v.optional(v.string()),
    sourceUrl: v.string(),
    evidence: v.union(v.literal("primary"), v.literal("secondary")),
    crossCheckUrl: v.optional(v.string()),
  }).index("by_scheme_from", ["scheme", "effectiveFrom"]),

  /** Macro series: CPI, CPI-IW, policy rates, bond yields, gold price, income, FX... */
  series: defineTable({
    key: v.string(),
    name: v.string(),
    unit: v.string(),
    frequency: v.union(v.literal("daily"), v.literal("monthly"), v.literal("quarterly"), v.literal("annual"), v.literal("fiscal_year"), v.literal("event")),
    publisher: v.string(),
    sourceUrl: v.string(),
    notes: v.optional(v.array(v.string())),
    lastObservation: v.optional(v.string()),
  }).index("by_key", ["key"]),

  seriesPoints: defineTable({
    series: v.string(),
    date: v.string(),
    value: v.number(),
    status: v.optional(v.union(v.literal("provisional"), v.literal("final"))),
  }).index("by_series_date", ["series", "date"]),

  /** Dataset files last imported from the repo, by content hash (unchanged files are skipped). */
  importState: defineTable({
    path: v.string(),
    hash: v.string(),
    importedAt: v.number(),
  }).index("by_path", ["path"]),

  /** Pre-computed read models for the website (one document per key). */
  summaries: defineTable({
    key: v.string(),
    payload: v.any(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Collector / import run log. */
  jobRuns: defineTable({
    job: v.string(),
    runner: v.string(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    status: v.union(v.literal("running"), v.literal("ok"), v.literal("partial"), v.literal("failed")),
    stats: v.optional(v.any()),
    error: v.optional(v.string()),
  }).index("by_job_time", ["job", "startedAt"]),

  /** Open problems the operator should know about (also mirrored to GitHub issues). */
  alerts: defineTable({
    key: v.string(),
    severity: v.union(v.literal("info"), v.literal("warning"), v.literal("error")),
    message: v.string(),
    openedAt: v.number(),
    lastSeenAt: v.number(),
    count: v.number(),
    resolvedAt: v.optional(v.number()),
    githubIssue: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_resolved", ["resolvedAt"]),
});
