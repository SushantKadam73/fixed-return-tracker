/**
 * Server-side data access for pages.
 *
 * Reads pre-computed summaries from Convex and caches them in Next.js. The cache is
 * refreshed on demand (Convex calls /api/revalidate after new data arrives) and at most
 * once a day otherwise — which keeps Convex traffic tiny. If Convex is not configured or
 * unreachable, pages fall back to the snapshot files committed in /data by the collectors,
 * so the site still works (clearly labelled with its as-of date).
 */
import "server-only";
import { unstable_cache } from "next/cache";
import { ConvexHttpClient } from "convex/browser";
import { promises as fs } from "node:fs";
import path from "node:path";
import { api } from "@/convex/_generated/api";
import { todayIST } from "./format";

export const DATA_TAG = "tracker-data";
const DAY_SECONDS = 24 * 60 * 60;

async function readSnapshot<T>(name: string): Promise<T | null> {
  try {
    const file = path.join(process.cwd(), "data", "snapshots", `${name.replace(/[:/]/g, "__")}.json`);
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Convex summary by key; throws on transport errors so failures are never cached. */
async function fromConvex<T>(key: string): Promise<{ payload: T; updatedAt: number } | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  const client = new ConvexHttpClient(url);
  const doc = await client.query(api.public.summary, { key });
  return doc ? { payload: doc.payload as T, updatedAt: doc.updatedAt } : null;
}

type SummaryResult<T> = { payload: T; updatedAt: number | null; origin: "convex" | "snapshot" } | null;

/**
 * Convex reads are cached (tag-revalidated when Convex reports new data, otherwise daily). The
 * cache key includes the deployment, because Next's data cache outlives deployments and a new
 * deployment must never serve summaries cached by an older one.
 */
const DEPLOYMENT = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? "local";
const cachedConvex = unstable_cache(async (key: string) => fromConvex<unknown>(key), ["convex-summary-v2", DEPLOYMENT], {
  tags: [DATA_TAG],
  revalidate: DAY_SECONDS,
});

/**
 * A summary document by key (e.g. "current:fd", "bank:sbi", "banks"), with its origin.
 * Committed snapshots are read directly (cheap, and always the ones shipped with this deployment).
 */
export async function getSummary<T>(key: string): Promise<SummaryResult<T>> {
  const snap = await readSnapshot<{ payload: T; updatedAt?: number }>(key);
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      let live = await cachedConvex(key);
      if (live && typeof live.payload === "object" && live.payload !== null && "partitions" in live.payload) {
        const keys = (live.payload as { partitions: unknown }).partitions;
        if (!Array.isArray(keys) || !keys.every((partition) => typeof partition === "string" && partition.startsWith(`${key}:`)) || keys.length > 8) throw new Error("Invalid summary partitions");
        const parts = await Promise.all(keys.map((partition) => cachedConvex(partition)));
        const banks = Object.assign({}, ...parts.map((part) => (part?.payload as { banks?: object } | undefined)?.banks ?? {}));
        live = { payload: { banks }, updatedAt: live.updatedAt };
      }
      if (live && usableSummary(key, live.payload)) {
        if (key.startsWith("current:") && snap && usableSummary(key, snap.payload)) {
          const bankMap = (value: unknown) => (value as { banks: Record<string, { effectiveFrom?: string | null; observedAt: string }> }).banks;
          const banks = { ...bankMap(snap.payload) };
          for (const [slug, card] of Object.entries(bankMap(live.payload))) {
            const date = card.effectiveFrom ?? card.observedAt;
            if (date <= todayIST() && (!banks[slug] || date >= (banks[slug].effectiveFrom ?? banks[slug].observedAt))) banks[slug] = card;
          }
          return { payload: { banks } as T, updatedAt: live.updatedAt, origin: "convex" };
        }
        return { payload: live.payload as T, updatedAt: live.updatedAt, origin: "convex" };
      }
    } catch {
      /* Convex unreachable: fall back to the committed snapshot */
    }
  }
  return snap ? { payload: snap.payload, updatedAt: snap.updatedAt ?? null, origin: "snapshot" } : null;
}

function usableSummary(key: string, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const value = payload as Record<string, unknown>;
  if (key === "banks") return Array.isArray(value.banks) && value.banks.length > 0;
  if (key.startsWith("current:")) {
    if (!value.banks || typeof value.banks !== "object" || Array.isArray(value.banks)) return false;
    return Object.values(value.banks).some((card) => card && typeof card === "object" &&
      typeof card.observedAt === "string" && (card.effectiveFrom ?? card.observedAt) <= todayIST() &&
      (Array.isArray(card.rows) || Array.isArray(card.savingsSlabs)));
  }
  if (key.startsWith("bank:")) return !!value.bank && !!value.products && Object.keys(value.products as object).length > 0;
  return Object.keys(value).length > 0;
}

export interface LiveStatus {
  sources: Array<{ key: string; lastAttemptAt: number | null; lastSuccessAt: number | null; lastChangeAt: number | null; consecutiveFailures: number; lastError: string | null }>;
  alerts: Array<{ key: string; severity: string; message: string; openedAt: number; lastSeenAt: number; count: number }>;
  runs: Array<{ job: string; status: string; startedAt: number; finishedAt: number | null }>;
  macro: { checks: Record<string, { lastSuccessAt: string | null; consecutiveFailures: number; lastError: string | null }>; observations: Record<string, { value: number; observedAt: string; sourceUrl: string; effectiveFrom: string | null }> } | null;
}

const cachedStatus = unstable_cache(async (): Promise<LiveStatus | null> => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  return url ? await new ConvexHttpClient(url).query(api.public.status, {}) : null;
}, ["tracker-status", DEPLOYMENT], { revalidate: 900, tags: [DATA_TAG] });

export async function getLiveStatus(): Promise<LiveStatus | null> {
  try { return await cachedStatus(); } catch { return null; }
}

/** A committed dataset file under /data (bank master list, scheme histories, macro series...). */
export async function readDataset<T>(relativePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(process.cwd(), "data", relativePath), "utf8")) as T;
  } catch {
    return null;
  }
}

type Check = { lastSuccessAt: string | null; consecutiveFailures: number };
type DirectoryBank = { slug: string; sources: Array<{ key: string; products: string[]; lastSuccessAt: number | null; failing: boolean }> };

/**
 * When each bank's pages were last read successfully, per product (ISO date strings).
 * From Convex's directory summary when available, else the committed data/rates/_checks.json.
 */
export async function getFreshness(): Promise<Record<string, Record<string, string | null>>> {
  const out: Record<string, Record<string, string | null>> = {};
  const dir = await getSummary<{ banks: DirectoryBank[] }>("banks");
  if (dir?.origin === "convex") {
    for (const b of dir.payload.banks) {
      for (const s of b.sources) for (const p of s.products) out[b.slug] = { ...(out[b.slug] ?? {}), [p]: s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : null };
    }
    return out;
  }
  const checks = (await readDataset<Record<string, Check>>("rates/_checks.json")) ?? {};
  const sources = (await readDataset<{ sources: Array<{ key: string; bankSlug: string; products: string[] }> }>("sources/sources.json"))?.sources ?? [];
  for (const s of sources) {
    const c = checks[s.key];
    for (const p of s.products) out[s.bankSlug] = { ...(out[s.bankSlug] ?? {}), [p]: c?.lastSuccessAt ?? null };
  }
  return out;
}
