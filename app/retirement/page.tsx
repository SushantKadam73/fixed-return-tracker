import type { Metadata } from "next";
import { promises as fs } from "node:fs";
import path from "node:path";
import { RetirementSimulator } from "@/components/retirement/simulator";
import { Notice, PageHeader } from "@/components/ui";
import { todayIST } from "@/lib/format";
import { getSchemes } from "@/lib/schemes";
import { getSeries } from "@/lib/series";

export const metadata: Metadata = {
  title: "Retirement simulator — PPF, EPF, VPF and NPS",
  description: "Compare PPF, EPF + VPF and NPS with the rates actually notified in the past and your own assumptions for the future, in nominal and today's money.",
};

/** First NAV of every month from a committed NAV history CSV (keeps the page light). */
async function monthlyNav(file: string): Promise<Array<[string, number]>> {
  try {
    const text = await fs.readFile(path.join(process.cwd(), "data", "series", "nps", file), "utf8");
    const seen = new Set<string>();
    const out: Array<[string, number]> = [];
    for (const line of text.split("\n").slice(1)) {
      const [date, nav] = line.split(",");
      if (!date || !nav) continue;
      const m = date.slice(0, 7);
      if (seen.has(m)) continue;
      seen.add(m);
      out.push([date, Number(nav)]);
    }
    return out;
  } catch {
    return [];
  }
}

export default async function RetirementPage() {
  const schemes = await getSchemes();
  const toPeriods = (key: string) => (schemes.find((s) => s.key === key)?.periods ?? []).map((p) => ({ from: p.from, to: p.to, rate: p.rate }));
  const latest = (key: string) => [...(schemes.find((s) => s.key === key)?.periods ?? [])].reverse().find((p) => p.rate !== null)?.rate ?? null;
  const [E, C, G, cpi] = await Promise.all([
    monthlyNav("sbi_scheme_e_tieri.csv"),
    monthlyNav("sbi_scheme_c_tieri.csv"),
    monthlyNav("sbi_scheme_g_tieri.csv"),
    getSeries<[string, number, number]>("cpi_iw_chained"),
  ]);
  return (
    <div>
      <PageHeader
        title="Retirement simulator"
        lede="See how PPF, EPF (with VPF) and NPS would grow for your contributions — using the rates and fund values actually recorded in the past, and assumptions you control for the future."
      />
      <RetirementSimulator
        data={{
          today: todayIST().slice(0, 7),
          ppf: toPeriods("ppf"),
          epf: toPeriods("epf"),
          nps: { E, C, G },
          cpi: (cpi?.points ?? []).map(([d, v]) => [d, v] as [string, number]),
          latest: { ppf: latest("ppf"), epf: latest("epf") },
        }}
      />
      <div className="mt-8">
        <Notice>
          NPS rules changed recently (for example, non-Government subscribers may take up to 80% as a lump sum at exit from December 2025, and a multiple-NAV framework started on 1 April 2026). Tax treatment depends on the regime you choose. This is a simulation, not advice.
        </Notice>
      </div>
    </div>
  );
}
