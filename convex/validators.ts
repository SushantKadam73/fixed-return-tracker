/**
 * Convex validators mirroring lib/domain.ts. Every table and function argument that
 * carries a rate uses these, so the database enforces the same vocabulary as the code.
 */
import { v } from "convex/values";

export const bankGroup = v.union(v.literal("sbi_nationalised"), v.literal("private"), v.literal("sfb"), v.literal("payments"));

export const product = v.union(
  v.literal("fd"),
  v.literal("fd_bulk"),
  v.literal("rd"),
  v.literal("savings"),
  v.literal("nre"),
  v.literal("nro"),
  v.literal("fcnr"),
  v.literal("tax_saver"),
);

export const customerType = v.union(
  v.literal("general"),
  v.literal("senior"),
  v.literal("super_senior"),
  v.literal("staff"),
  v.literal("staff_senior"),
  v.literal("women"),
  v.literal("non_individual"),
);

export const residency = v.union(v.literal("resident"), v.literal("nre"), v.literal("nro"), v.literal("fcnr"));

export const payout = v.union(
  v.literal("cumulative"),
  v.literal("monthly"),
  v.literal("quarterly"),
  v.literal("half_yearly"),
  v.literal("yearly"),
  v.literal("at_maturity"),
);

export const sourceType = v.union(
  v.literal("bank_official"),
  v.literal("bank_archive"),
  v.literal("web_archive"),
  v.literal("rbi_prescribed"),
  v.literal("rbi_publication"),
  v.literal("exchange_filing"),
  v.literal("press"),
  v.literal("government"),
);

export const confidence = v.union(v.literal("high"), v.literal("medium"), v.literal("low"));

export const slabMethod = v.union(v.literal("whole"), v.literal("incremental"), v.literal("unknown"));

export const rateRow = v.object({
  tenureMinDays: v.number(),
  tenureMaxDays: v.number(),
  tenureLabel: v.string(),
  special: v.optional(v.boolean()),
  schemeName: v.optional(v.string()),
  amountMin: v.number(),
  amountMax: v.union(v.number(), v.null()),
  customer: customerType,
  residency: residency,
  callable: v.union(v.boolean(), v.null()),
  payout: v.optional(v.union(payout, v.null())),
  rate: v.number(),
  note: v.optional(v.string()),
});

export const savingsSlab = v.object({
  balanceMin: v.number(),
  balanceMax: v.union(v.number(), v.null()),
  rate: v.number(),
  residency: residency,
  note: v.optional(v.string()),
});

/** A rate card as submitted by a collector or a backfill import. */
export const rateCardInput = v.object({
  bankSlug: v.string(),
  product: product,
  effectiveFrom: v.union(v.string(), v.null()),
  observedAt: v.string(),
  observedFrom: v.optional(v.union(v.string(), v.null())),
  observedTo: v.optional(v.union(v.string(), v.null())),
  sourceType: sourceType,
  sourceUrl: v.string(),
  archiveUrl: v.optional(v.union(v.string(), v.null())),
  confidence: confidence,
  rows: v.array(rateRow),
  savingsSlabs: v.optional(v.array(savingsSlab)),
  slabMethod: v.optional(slabMethod),
  notes: v.optional(v.array(v.string())),
});

export const runner = v.union(v.literal("convex"), v.literal("github"), v.literal("vps"), v.literal("disabled"));

/** A card as stored in the repo (data/rates): the input shape plus its content hash and end date. */
export const storedCard = v.object({
  bankSlug: v.string(),
  product: product,
  effectiveFrom: v.union(v.string(), v.null()),
  observedAt: v.string(),
  observedFrom: v.optional(v.union(v.string(), v.null())),
  observedTo: v.optional(v.union(v.string(), v.null())),
  sourceType: sourceType,
  sourceUrl: v.string(),
  archiveUrl: v.optional(v.union(v.string(), v.null())),
  confidence: confidence,
  rows: v.array(rateRow),
  savingsSlabs: v.optional(v.array(savingsSlab)),
  slabMethod: v.optional(slabMethod),
  notes: v.optional(v.array(v.string())),
  contentHash: v.string(),
  validTo: v.optional(v.union(v.string(), v.null())),
});
