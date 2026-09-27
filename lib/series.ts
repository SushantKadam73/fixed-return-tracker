/** Macro series from the committed datasets (data/series). */
import "server-only";
import { readDataset } from "./data";

export interface SeriesFile<P = [string, number]> {
  key: string;
  name: string;
  unit: string;
  frequency: string;
  publisher?: string;
  sourceUrl?: string;
  notes?: string[];
  points: P[];
  [extra: string]: unknown;
}

export async function getSeries<P = [string, number]>(key: string): Promise<SeriesFile<P> | null> {
  return readDataset<SeriesFile<P>>(`series/${key}.json`);
}

/** "2023-24" style fiscal year that contains a YYYY-MM month (Indian FY runs April–March). */
export function fiscalYearOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}
