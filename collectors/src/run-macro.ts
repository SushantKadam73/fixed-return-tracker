/**
 * Macro/non-bank collector runner: Government scheme rates, provident-fund rates,
 * inflation, NPS NAVs, RBI policy rates and RBI's list of banks.
 *
 *   npx tsx collectors/src/run-macro.ts                 # every task
 *   npx tsx collectors/src/run-macro.ts --task epf       # one task
 *   npx tsx collectors/src/run-macro.ts --dry-run        # fetch + parse + report, write nothing
 *
 * Each task (collectors/src/macro/*.ts) fetches, parses and returns proposed `changes`;
 * this file is the only place that touches the filesystem. Failures never delete data —
 * the last good value stays, the failure is recorded in data/macro/_checks.json — and the
 * process exits non-zero only if every task failed outright (see the per-task README).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fetchDoc } from "./fetch";
import { todayIST } from "../../lib/format";
import type { Change, MacroTask, MacroTaskContext, TaskCheck, TaskResult } from "./macro/types";
import { applySchemePeriod, applySeriesPoint, applyNpsRows, macroDir, touchSchemeCheckedAt, touchSeriesCheckedAt, updateSchemesIndex, updateSeriesIndex, writeBanksWatch } from "./macro/store";

import { run as runSmallSavings } from "./macro/small-savings";
import { run as runEpf } from "./macro/epf";
import { run as runGpf } from "./macro/gpf";
import { run as runFrsb } from "./macro/frsb";
import { run as runCpiIw } from "./macro/cpi-iw";
import { run as runCpiCombined } from "./macro/cpi-combined";
import { run as runRbiRates } from "./macro/rbi-rates";
import { run as runNpsNav } from "./macro/nps-nav";
import { run as runRbiBankList } from "./macro/rbi-bank-list";

const TASKS: Record<string, MacroTask> = {
  "small-savings": runSmallSavings,
  epf: runEpf,
  gpf: runGpf,
  frsb: runFrsb,
  "cpi-iw": runCpiIw,
  "cpi-combined": runCpiCombined,
  "rbi-rates": runRbiRates,
  "nps-nav": runNpsNav,
  "rbi-bank-list": runRbiBankList,
};

interface Args {
  task: string | null;
  dryRun: boolean;
  root: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { task: null, dryRun: false, root: process.cwd() };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--task") a.task = argv[++i];
    else if (v === "--dry-run") a.dryRun = true;
    else if (v === "--root") a.root = argv[++i];
  }
  return a;
}

function checksPath(root: string) {
  return path.join(macroDir(root), "_checks.json");
}

function loadChecks(root: string): Record<string, TaskCheck> {
  const file = checksPath(root);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, TaskCheck>) : {};
}

function saveChecks(root: string, checks: Record<string, TaskCheck>) {
  mkdirSync(macroDir(root), { recursive: true });
  const sorted = Object.fromEntries(Object.entries(checks).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(checksPath(root), `${JSON.stringify(sorted, null, 1)}\n`);
}

/** Applies one proposed change to the repo. Returns true if it actually changed something (vs. an already-known value). */
function applyChange(root: string, today: string, change: Change): boolean {
  switch (change.kind) {
    case "scheme_period": {
      const applied = applySchemePeriod(root, change);
      if (applied) {
        touchSchemeCheckedAt(root, change.scheme, today);
        updateSchemesIndex(root, change.scheme, today);
      }
      return applied;
    }
    case "series_point": {
      const applied = applySeriesPoint(root, change);
      if (applied) {
        touchSeriesCheckedAt(root, change.seriesKey, today);
        updateSeriesIndex(root, change.seriesKey, today);
      }
      return applied;
    }
    case "nps_rows": {
      const appended = applyNpsRows(root, change);
      return appended > 0;
    }
    case "banks_watch": {
      writeBanksWatch(root, change);
      return change.additions.length > 0 || change.removals.length > 0;
    }
  }
}

async function runTask(name: string, task: MacroTask, ctx: MacroTaskContext, dryRun: boolean, checks: Record<string, TaskCheck>): Promise<{ line: string; result: TaskResult; appliedChanges: number }> {
  const now = new Date().toISOString();
  const check: TaskCheck = checks[name] ?? { lastAttemptAt: "", lastSuccessAt: null, lastChangeAt: null, consecutiveFailures: 0, lastError: null };
  check.lastAttemptAt = now;

  let result: TaskResult;
  try {
    result = await task(ctx);
  } catch (e) {
    result = { task: name, ok: false, sourcesTried: [], changes: [], warnings: [], error: `unhandled: ${(e as Error).message}` };
  }

  let appliedChanges = 0;
  if (!dryRun) {
    for (const change of result.changes) if (applyChange(ctx.root, ctx.today, change)) appliedChanges += 1;
  }

  if (result.ok) {
    check.lastSuccessAt = now;
    check.consecutiveFailures = 0;
    check.lastError = null;
  } else {
    check.consecutiveFailures += 1;
    check.lastError = (result.error ?? "unknown error").slice(0, 500);
  }
  if (appliedChanges > 0) check.lastChangeAt = now;
  checks[name] = check;

  const status = !result.ok ? "error" : appliedChanges > 0 ? "changed" : dryRun && result.changes.length > 0 ? "would-change" : "ok";
  const detail = !result.ok ? result.error : result.changes.length > 0 ? `${result.changes.length} change(s) proposed${dryRun ? "" : `, ${appliedChanges} applied`}` : result.warnings[0] ?? "no change";
  const line = `${status.padEnd(12)} ${name.padEnd(16)} ${detail ?? ""}`;
  return { line, result, appliedChanges };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const selected = args.task ? { [args.task]: TASKS[args.task] } : TASKS;
  if (args.task && !TASKS[args.task]) {
    console.error(`Unknown task "${args.task}". Known tasks: ${Object.keys(TASKS).join(", ")}`);
    process.exit(1);
  }

  const ctx: MacroTaskContext = {
    today: todayIST(),
    root: args.root,
    fetch: (url, format) => fetchDoc(url, format ?? "html"),
  };

  const checks = loadChecks(args.root);
  const lines: string[] = [];
  const results: TaskResult[] = [];
  for (const [name, task] of Object.entries(selected)) {
    const { line, result } = await runTask(name, task, ctx, args.dryRun, checks);
    lines.push(line);
    results.push(result);
    console.log(line);
    for (const w of result.warnings) console.log(`             ${w}`);
    for (const s of result.sourcesTried) if (!s.ok) console.log(`             tried ${s.url} -> ${s.error ?? s.status}`);
  }

  if (!args.dryRun) saveChecks(args.root, checks);

  const failed = results.filter((r) => !r.ok).length;
  const stats = { tasks: results.length, changed: results.filter((r) => r.changes.length > 0).length, failed, dryRun: args.dryRun };
  console.log(JSON.stringify(stats));
  process.exit(results.length > 0 && failed === results.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
