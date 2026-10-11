export interface SourceHealth {
  lastSuccessAt: string | number | null;
  consecutiveFailures: number;
}

const DAY = 86_400_000;
export const STALE_AFTER: Record<string, number> = {
  daily: 3 * DAY, bulk_daily: 3 * DAY, weekly: 10 * DAY,
  monthly: 40 * DAY, quarterly: 100 * DAY, annual: 400 * DAY,
};

export function sourceState(check: SourceHealth | undefined, cadence: string, now = Date.now()): "never" | "failing" | "stale" | "ok" {
  if ((check?.consecutiveFailures ?? 0) > 0) return "failing";
  if (!check?.lastSuccessAt) return "never";
  const last = typeof check.lastSuccessAt === "number" ? check.lastSuccessAt : Date.parse(check.lastSuccessAt);
  return !Number.isFinite(last) || now - last > (STALE_AFTER[cadence] ?? 7 * DAY) ? "stale" : "ok";
}
