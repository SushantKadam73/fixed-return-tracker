/**
 * Load small finance banks' own "previous rates" archives into history:
 *  - slice SFB: https://slice.bank.in/documents/imp/previous_interest_rates.pdf (dated FD periods + savings points)
 *  - Unity SFB: past "website disclosure" PDFs (retail FD, savings, bulk) discovered from its FD page
 * Uses the bank adapters' own history parsers; cards are stored as bank_archive history.
 *   npx tsx backfill/sfb-archives.ts
 */
import { todayIST } from "../lib/format";
import { sliceHistory } from "../collectors/src/adapters/slice-sfb";
import { unityHistory } from "../collectors/src/adapters/unity-sfb";
import { fetchDoc } from "../collectors/src/fetch";
import { storeHistoricalCard } from "../collectors/src/store";
import type { Adapter, SourceDef } from "../collectors/src/types";

const root = process.cwd();

async function load(bankSlug: string, url: string, format: "pdf" | "html", adapter: Adapter) {
  const doc = await fetchDoc(url, format);
  const source: SourceDef = { key: `${bankSlug}:history`, bankSlug, products: [], url, format, runner: "github", adapter: "history", cadence: "monthly", active: true };
  const out = await adapter({ source, doc, today: todayIST(), fetch: (u, f) => fetchDoc(u, f ?? "html") });
  const counts = { inserted: 0, unchanged: 0, rejected: 0 };
  for (const card of out.cards) {
    const r = storeHistoricalCard(root, card);
    counts[r.outcome]++;
    if (r.outcome === "rejected") console.log(`  rejected ${card.product} ${card.effectiveFrom}: ${r.issues.map((i) => i.message).join("; ")}`);
  }
  const dates = out.cards.map((c) => c.effectiveFrom ?? c.observedFrom ?? "").filter(Boolean).sort();
  console.log(`${bankSlug}: ${out.cards.length} cards (${dates[0]} → ${dates.at(-1)})`, counts, out.warnings?.length ? `warnings: ${out.warnings.join(" | ")}` : "");
}

async function main() {
  await load("slice-sfb", "https://slice.bank.in/documents/imp/previous_interest_rates.pdf", "pdf", sliceHistory);
  await load("unity-sfb", "https://unity.bank.in/personal-banking/deposits/fixed-deposit", "html", unityHistory);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
