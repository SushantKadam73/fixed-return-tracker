import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

type Endpoint = "/ingest" | "/run-complete" | "/macro-status";
interface Envelope { id: string; endpoint: Endpoint; body: Record<string, unknown>; createdAt: string }
const directory = (root: string) => path.join(root, "data", "pipeline", "outbox");
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Contains only normalized public facts and checks, never URLs or authorization secrets from configuration. */
export function enqueue(root: string, endpoint: Endpoint, body: Record<string, unknown>): string {
  const id = createHash("sha256").update(JSON.stringify({ endpoint, body })).digest("hex");
  const dir = directory(root);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.json`);
  if (!existsSync(file)) {
    const envelope: Envelope = { id, endpoint, body, createdAt: new Date().toISOString() };
    writeFileSync(`${file}.tmp`, `${JSON.stringify(envelope)}\n`);
    renameSync(`${file}.tmp`, file);
  }
  return id;
}

export function pendingDeliveries(root: string): number {
  return existsSync(directory(root)) ? readdirSync(directory(root)).filter((file) => file.endsWith(".json")).length : 0;
}

/** Bounded replay. Stable receipt IDs make a timeout after acceptance safe to retry. */
export async function flushOutbox(root: string): Promise<{ delivered: number; pending: number; rejected: number }> {
  const base = process.env.CONVEX_SITE_URL;
  const secret = process.env.INGEST_SECRET;
  if (!base || !secret) throw new Error("Publication requires CONVEX_SITE_URL and INGEST_SECRET; use --no-post for a local-only run.");
  const url = new URL(base);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site") || url.pathname !== "/") throw new Error("CONVEX_SITE_URL must be the HTTPS .convex.site deployment base URL.");
  const dir = directory(root);
  if (!existsSync(dir)) return { delivered: 0, pending: 0, rejected: 0 };
  const items = readdirSync(dir).filter((file) => file.endsWith(".json"))
    .map((file) => ({ file, envelope: JSON.parse(readFileSync(path.join(dir, file), "utf8")) as Envelope }))
    .sort((a, b) => a.envelope.createdAt.localeCompare(b.envelope.createdAt));
  let delivered = 0;
  let rejected = 0;
  for (const { file, envelope } of items.slice(0, 250)) {
    if (!["/ingest", "/run-complete", "/macro-status"].includes(envelope.endpoint)) throw new Error("Invalid outbox endpoint");
    let acknowledged = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${url.origin}${envelope.endpoint}`, {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
          body: JSON.stringify({ ...envelope.body, receiptId: envelope.id }), signal: AbortSignal.timeout(60_000),
        });
        if (response.status === 401 || response.status === 403) throw new Error(`Convex authentication failed (HTTP ${response.status}); queued deliveries retained.`);
        if (response.status === 400 || response.status === 422) {
          const quarantine = path.join(root, "data", "pipeline", "quarantine");
          mkdirSync(quarantine, { recursive: true });
          renameSync(path.join(dir, file), path.join(quarantine, file));
          rejected++;
          acknowledged = true;
          break;
        }
        if (!response.ok) {
          if (response.status !== 429 && response.status < 500) throw new Error(`Convex publication failed (HTTP ${response.status})`);
          const retryAfter = Number(response.headers.get("retry-after"));
          if (attempt < 2) await wait(Math.min(30_000, Math.max(2000 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
          continue;
        }
        const result = await response.json() as { outcome?: string; ok?: boolean };
        if (!result.ok && !["unchanged", "new_card", "error", "superseded"].includes(result.outcome ?? "")) throw new Error("Convex response did not acknowledge this delivery");
        unlinkSync(path.join(dir, file));
        delivered++;
        acknowledged = true;
        break;
      } catch (error) {
        if (error instanceof Error && /authentication|acknowledge|publication failed/.test(error.message)) throw error;
        if (attempt < 2) await wait(2000 * 2 ** attempt + Math.random() * 500);
      }
    }
    // Preserve ordering: an unavailable endpoint cannot allow a later run receipt to report success.
    if (!acknowledged) break;
  }
  return { delivered, pending: pendingDeliveries(root), rejected };
}
