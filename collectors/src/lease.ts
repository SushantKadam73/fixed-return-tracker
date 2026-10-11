import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";

/** A second local writer must never overwrite a concurrent runner's health or snapshots. */
export function acquireCollectorLease(root: string): () => void {
  const file = path.join(root, ".collector-lock");
  if (existsSync(file)) {
    const owner = JSON.parse(readFileSync(file, "utf8")) as { pid: number; host: string; startedAt: number };
    let alive = owner.host !== hostname();
    if (!alive) try { process.kill(owner.pid, 0); alive = true; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") alive = true;
    }
    if (alive) throw new Error("Another collector owns this checkout; retry after it completes.");
    unlinkSync(file);
  }
  const identity = JSON.stringify({ pid: process.pid, host: hostname(), startedAt: Date.now() });
  writeFileSync(file, identity, { flag: "wx" });
  return () => { if (existsSync(file) && readFileSync(file, "utf8") === identity) unlinkSync(file); };
}
