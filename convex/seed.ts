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
import { product as productValidator, storedCard } from "./validators";

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
    // Source registry (official pages the collectors read).
    const reg = await getJson<{ sources: Array<{ key: string; bankSlug: string; products: string[]; url: string; format: string; runner: string; adapter: string; cadence: string; active: boolean; robotsAllowed?: boolean; termsNote?: string }> }>("sources/sources.json");
    for (const s of reg.sources) {
      await ctx.runMutation(internal.ingest.upsertSource, clean({
        key: s.key, bankSlug: s.bankSlug, kind: "bank_page" as const, products: s.products, url: s.url, format: s.format,
        runner: (["convex", "github", "vps", "disabled"].includes(s.runner) ? s.runner : "github") as "github",
        adapter: s.adapter, cadence: s.cadence, active: s.active, robotsAllowed: s.robotsAllowed, termsNote: s.termsNote,
      }));
    }
    await ctx.runMutation(internal.summaries.refreshDirectory, {});
    await ctx.runMutation(internal.seed.refreshSchemesSummary, {});
    return { sources: reg.sources.length, banks: banks.banks.length, predecessors: banks.predecessors.length, schemes: index.schemes.length, schemeRows };
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

// ── Macro series and repo rate files ─────────────────────────────────────────

const seriesPoint = v.object({ date: v.string(), value: v.number() });

/** Upsert a series' metadata and points (matched on date). */
export const upsertSeries = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    unit: v.string(),
    frequency: v.union(v.literal("daily"), v.literal("monthly"), v.literal("quarterly"), v.literal("annual"), v.literal("fiscal_year"), v.literal("event")),
    publisher: v.string(),
    sourceUrl: v.string(),
    points: v.array(seriesPoint),
  },
  handler: async (ctx, a) => {
    const meta = { key: a.key, name: a.name, unit: a.unit, frequency: a.frequency, publisher: a.publisher, sourceUrl: a.sourceUrl, lastObservation: a.points.at(-1)?.date };
    const existing = await ctx.db.query("series").withIndex("by_key", (q) => q.eq("key", a.key)).first();
    if (existing) await ctx.db.patch(existing._id, meta);
    else await ctx.db.insert("series", meta);
    const current = await ctx.db.query("seriesPoints").withIndex("by_series_date", (q) => q.eq("series", a.key)).collect();
    const byDate = new Map(current.map((p) => [p.date, p]));
    let inserted = 0;
    for (const p of a.points) {
      const row = byDate.get(p.date);
      if (!row) {
        await ctx.db.insert("seriesPoints", { series: a.key, date: p.date, value: p.value });
        inserted++;
      } else if (row.value !== p.value) {
        await ctx.db.patch(row._id, { value: p.value });
      }
    }
    return { inserted };
  },
});

/** Import a bank product's stored cards from the repo; the latest bank-website card becomes current. */
export const importProductCards = internalMutation({
  args: { bankSlug: v.string(), product: productValidator, cards: v.array(storedCard) },
  handler: async (ctx, a) => {
    const existing = await ctx.db
      .query("rateCards")
      .withIndex("by_bank_product_effective", (q) => q.eq("bankSlug", a.bankSlug).eq("product", a.product))
      .collect();
    const key = (hash: string, date: string | null | undefined) => `${hash}|${date ?? ""}`;
    const have = new Set(existing.map((c) => key(c.contentHash, c.effectiveFrom ?? c.observedFrom ?? c.observedAt)));
    let inserted = 0;
    for (const c of a.cards) {
      if (have.has(key(c.contentHash, c.effectiveFrom ?? c.observedFrom ?? c.observedAt))) continue;
      await ctx.db.insert("rateCards", {
        bankSlug: c.bankSlug,
        product: c.product,
        effectiveFrom: c.effectiveFrom ?? undefined,
        validTo: c.validTo ?? undefined,
        observedAt: c.observedAt,
        observedFrom: c.observedFrom ?? undefined,
        observedTo: c.observedTo ?? undefined,
        isCurrent: false,
        sourceType: c.sourceType,
        sourceUrl: c.sourceUrl,
        archiveUrl: c.archiveUrl ?? undefined,
        confidence: c.confidence,
        contentHash: c.contentHash,
        rows: c.rows,
        savingsSlabs: c.savingsSlabs,
        slabMethod: c.slabMethod,
        notes: c.notes,
      });
      inserted++;
    }
    // Make the newest bank-website card current (collector posts keep it fresh afterwards).
    const all = await ctx.db
      .query("rateCards")
      .withIndex("by_bank_product_effective", (q) => q.eq("bankSlug", a.bankSlug).eq("product", a.product))
      .collect();
    const live = all.filter((c) => c.sourceType === "bank_official").sort((x, y) => (x.effectiveFrom ?? x.observedAt).localeCompare(y.effectiveFrom ?? y.observedAt));
    const newest = live.at(-1);
    for (const c of all) {
      const shouldBe = newest !== undefined && c._id === newest._id;
      if (c.isCurrent !== shouldBe) await ctx.db.patch(c._id, { isCurrent: shouldBe });
    }
    return { inserted };
  },
});

type SeriesFile = { key: string; name: string; unit: string; frequency: string; publisher?: string; sourceUrl?: string; points: Array<[string, number | null, ...unknown[]]> };

/** Import every committed series and every stored rate file, then refresh summaries. */
export const importSeriesAndRates = internalAction({
  args: {},
  handler: async (ctx) => {
    const idx = await getJson<{ series: Array<{ key: string }> }>("series/_index.json");
    const freq = new Set(["daily", "monthly", "quarterly", "annual", "fiscal_year", "event"]);
    let seriesCount = 0;
    for (const { key } of idx.series) {
      const s = await getJson<SeriesFile>(`series/${key}.json`);
      const points = s.points.filter((p) => typeof p[1] === "number").map((p) => ({ date: String(p[0]), value: p[1] as number }));
      for (let i = 0; i < points.length; i += 500) {
        await ctx.runMutation(internal.seed.upsertSeries, {
          key: s.key,
          name: s.name,
          unit: s.unit,
          frequency: (freq.has(s.frequency) ? s.frequency : "event") as "event",
          publisher: s.publisher ?? "",
          sourceUrl: s.sourceUrl ?? "",
          points: points.slice(i, i + 500),
        });
      }
      seriesCount++;
    }
    let files = 0;
    try {
      const rates = await getJson<{ files: Array<{ bankSlug: string; product: string }> }>("rates/_index.json");
      for (const f of rates.files) {
        const pf = await getJson<{ bankSlug: string; product: string; cards: Array<Record<string, unknown>> }>(`rates/${f.bankSlug}/${f.product}.json`);
        for (let i = 0; i < pf.cards.length; i += 40) {
          await ctx.runMutation(internal.seed.importProductCards, {
            bankSlug: pf.bankSlug,
            product: pf.product as "fd",
            cards: pf.cards.slice(i, i + 40) as never,
          });
        }
        files++;
      }
    } catch (e) {
      console.warn(`rate files not imported: ${(e as Error).message}`);
    }
    await ctx.runMutation(internal.summaries.refreshAllBanks, {});
    return { series: seriesCount, rateFiles: files };
  },
});
