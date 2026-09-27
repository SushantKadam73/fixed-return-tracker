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
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    try {
      const live = await cachedConvex(key);
      if (live) return { payload: live.payload as T, updatedAt: live.updatedAt, origin: "convex" };
    } catch {
      /* Convex unreachable: fall back to the committed snapshot */
    }
  }
  const snap = await readSnapshot<{ payload: T; updatedAt?: number }>(key);
  return snap ? { payload: snap.payload, updatedAt: snap.updatedAt ?? null, origin: "snapshot" } : null;
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
