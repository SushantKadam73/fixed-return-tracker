/**
 * Imports the committed datasets (data/ in the public GitHub repo) into Convex.
 *
 * Runs daily (see crons.ts) and is idempotent: rows are matched on natural keys, so
 * re-running only applies changes. The repo stays the reviewable source of truth for
 * bank lineage, scheme histories, macro series and reconstructed rate history.
 */
import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";

const DEFAULT_BASE = "https://raw.githubusercontent.com/SushantKadam73/fixed-return-tracker/main/data";
const base = () => process.env.DATASET_BASE_URL ?? DEFAULT_BASE;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/${path}`, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

type BankFile = {
  banks: Array<{
    slug: string; name: string; shortName: string; group: "sbi_nationalised" | "private" | "sfb" | "payments";
    tracking: "tracked" | "deferred"; founded?: string | null; website?: string | null; legacyDomains?: string[];
    nseSymbol?: string | null; history?: Array<{ date: string; event: string; evidenceUrl?: string | null }>; notes?: string | null;
  }>;
  predecessors: Array<{
    slug: string; name: string; founded?: string | null; relation: string; mergedInto: string; mergedOn?: string | null;
    legacyDomains?: string[]; evidenceUrl?: string | null; notes?: string | null;
  }>;
};

type SchemeFile = {
  scheme: string; name: string; category: "small_savings" | "provident_fund" | "bond" | "pension";
  conventions?: Record<string, string> | null;
  periods: Array<{ effectiveFrom: string; effectiveTo?: string | null; rate?: number | null; maturityMonths?: number; note?: string | null; sourceUrl?: string | null; evidence?: string; crossCheckUrl?: string | null }>;
};

const clean = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, val]) => val !== null && val !== undefined)) as T;

export const importAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const banks = await getJson<BankFile>("banks/banks.json");
    for (const b of banks.banks) {
      await ctx.runMutation(internal.ingest.upsertBank, clean({
        slug: b.slug, name: b.name, shortName: b.shortName, group: b.group, status: "active" as const,
        tracking: b.tracking, founded: b.founded ?? undefined, website: b.website ?? undefined,
        legacyDomains: b.legacyDomains ?? [], nseSymbol: b.nseSymbol ?? undefined,
        history: (b.history ?? []).map((h) => clean({ date: h.date, event: h.event, evidenceUrl: h.evidenceUrl ?? undefined })),
        notes: b.notes ?? undefined,
      }));
    }
    const groupOf = new Map(banks.banks.map((b) => [b.slug, b.group]));
    for (const p of banks.predecessors) {
      // Resolve chains (e.g. Global Trust Bank → Oriental Bank of Commerce → PNB) to find the RBI group.
      let target = p.mergedInto;
      for (let i = 0; i < 5 && !groupOf.has(target); i++) target = banks.predecessors.find((x) => x.slug === target)?.mergedInto ?? target;
      await ctx.runMutation(internal.ingest.upsertBank, clean({
        slug: p.slug, name: p.name, shortName: p.name, group: groupOf.get(target) ?? "private",
        status: "merged" as const, tracking: "historical_only" as const, founded: p.founded ?? undefined,
        legacyDomains: p.legacyDomains ?? [], mergedInto: p.mergedInto, mergedOn: p.mergedOn ?? undefined,
        history: p.evidenceUrl ? [{ date: p.mergedOn ?? "", event: `${p.relation === "merged" ? "Merged into" : "Renamed/converted into"} ${p.mergedInto}`, evidenceUrl: p.evidenceUrl }] : [],
        notes: p.notes ?? undefined,
      }));
    }

    const index = await getJson<{ schemes: Array<{ scheme: string }> }>("schemes/_index.json");
    let schemeRows = 0;
    for (const { scheme } of index.schemes) {
      const s = await getJson<SchemeFile>(`schemes/${scheme}.json`);
      await ctx.runMutation(internal.seed.upsertScheme, {
        key: s.scheme, name: s.name, category: s.category,
        conventions: s.conventions ? Object.entries(s.conventions).map(([k, val]) => `${k}: ${val}`) : [],
        periods: s.periods.map((p) => clean({
          effectiveFrom: p.effectiveFrom, effectiveTo: p.effectiveTo ?? undefined, rate: p.rate ?? undefined,
          maturityMonths: p.maturityMonths, note: p.note ?? undefined, sourceUrl: p.sourceUrl ?? "",
          evidence: p.evidence === "secondary" ? ("secondary" as const) : ("primary" as const), crossCheckUrl: p.crossCheckUrl ?? undefined,
        })),
      });
      schemeRows += s.periods.length;
    }
    await ctx.runMutation(internal.summaries.refreshDirectory, {});
    await ctx.runMutation(internal.seed.refreshSchemesSummary, {});
    return { banks: banks.banks.length, predecessors: banks.predecessors.length, schemes: index.schemes.length, schemeRows };
  },
});

const period = v.object({
  effectiveFrom: v.string(),
  effectiveTo: v.optional(v.string()),
  rate: v.optional(v.number()),
  maturityMonths: v.optional(v.number()),
  note: v.optional(v.string()),
  sourceUrl: v.string(),
  evidence: v.union(v.literal("primary"), v.literal("secondary")),
  crossCheckUrl: v.optional(v.string()),
});

/** Upsert a scheme and its rate periods (matched on effectiveFrom). */
export const upsertScheme = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    category: v.union(v.literal("small_savings"), v.literal("provident_fund"), v.literal("bond"), v.literal("pension")),
    conventions: v.array(v.string()),
    periods: v.array(period),
  },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("schemes").withIndex("by_key", (q) => q.eq("key", a.key)).first();
    if (existing) await ctx.db.patch(existing._id, { name: a.name, category: a.category, conventions: a.conventions });
    else await ctx.db.insert("schemes", { key: a.key, name: a.name, category: a.category, conventions: a.conventions });
    const rows = await ctx.db.query("schemeRates").withIndex("by_scheme_from", (q) => q.eq("scheme", a.key)).collect();
    const byFrom = new Map(rows.map((r) => [r.effectiveFrom, r]));
    for (const p of a.periods) {
      const row = byFrom.get(p.effectiveFrom);
      if (row) await ctx.db.patch(row._id, p);
      else await ctx.db.insert("schemeRates", { scheme: a.key, ...p });
    }
  },
});

/** Summary of every scheme: latest rate and full history (small enough to ship in one document). */
export const refreshSchemesSummary = internalMutation({
  args: {},
  handler: async (ctx) => {
    const schemes = await ctx.db.query("schemes").collect();
    const out = [];
    for (const s of schemes) {
      const rows = await ctx.db.query("schemeRates").withIndex("by_scheme_from", (q) => q.eq("scheme", s.key)).collect();
      out.push({
        key: s.key, name: s.name, category: s.category, conventions: s.conventions ?? [],
        periods: rows.map((r) => ({ from: r.effectiveFrom, to: r.effectiveTo ?? null, rate: r.rate ?? null, maturityMonths: r.maturityMonths ?? null, note: r.note ?? null, sourceUrl: r.sourceUrl, evidence: r.evidence })),
      });
    }
    const existing = await ctx.db.query("summaries").withIndex("by_key", (q) => q.eq("key", "schemes")).first();
    if (existing) await ctx.db.patch(existing._id, { payload: { schemes: out }, updatedAt: Date.now() });
    else await ctx.db.insert("summaries", { key: "schemes", payload: { schemes: out }, updatedAt: Date.now() });
  },
});
