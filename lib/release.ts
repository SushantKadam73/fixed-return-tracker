import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getSummary, readDataset } from "./data";

export interface ReleaseManifest {
  releaseId: string;
  generatedAt: string;
  revision?: string;
  rows: number;
  files: Array<{ path: string; sha256: string; bytes: number }>;
  downloads: Array<{ path: string; sha256: string }>;
}

export async function getRelease(): Promise<ReleaseManifest | null> {
  const live = await getSummary<ReleaseManifest>("release:manifest");
  if (live?.payload.revision && /^[a-f0-9]{40}$/.test(live.payload.revision)) return live.payload;
  return readDataset<ReleaseManifest>("exports/manifest.json");
}

export async function releaseExport(file: "current.csv" | "current.json" | "manifest.json" | "feed.json" | "feed.xml"): Promise<{ body: string; releaseId: string }> {
  const manifest = await getRelease();
  if (!manifest) throw new Error("Release unavailable");
  let body: string;
  if (file === "manifest.json") body = JSON.stringify(manifest, null, 2);
  else if (manifest.revision) {
    const response = await fetch(`https://raw.githubusercontent.com/SushantKadam73/fixed-return-tracker/${manifest.revision}/data/exports/${file}`, {
      cache: "force-cache", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Published export unavailable");
    body = await response.text();
  } else body = await readFile(path.join(process.cwd(), "data", "exports", file), "utf8");
  if (file !== "manifest.json") {
    const expected = manifest.downloads.find((download) => download.path === file)?.sha256;
    if (createHash("sha256").update(body).digest("hex") !== expected) throw new Error("Published export checksum mismatch");
  }
  return { body, releaseId: manifest.releaseId };
}
