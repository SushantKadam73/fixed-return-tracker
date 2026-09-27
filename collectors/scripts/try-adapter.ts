/**
 * Try one adapter against the live page (or a saved file) without touching the store.
 *   npx tsx collectors/scripts/try-adapter.ts <module> <adapterName> <bankSlug> <url|file> [html|pdf|browser]
 * Example:
 *   npx tsx collectors/scripts/try-adapter.ts ./collectors/src/adapters/group-a1.ts canara-bank.fd canara-bank https://www.canarabank.bank.in/term-deposits-rate-of-interest-p.a.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { todayIST } from "../../lib/format";
import { hasErrors, validateCard } from "../../lib/validate";
import { fetchDoc } from "../src/fetch";
import type { Adapter, FetchedDoc, SourceFormat } from "../src/types";

async function main() {
  const [, , modulePath, adapterName, bankSlug, target, format = "html"] = process.argv;
  const mod = (await import(pathToFileURL(path.resolve(modulePath)).href)) as { adapters: Record<string, Adapter> };
  const adapter = mod.adapters[adapterName];
  if (!adapter) throw new Error(`adapter ${adapterName} not exported by ${modulePath}`);
  let doc: FetchedDoc;
  if (existsSync(target)) {
    doc = { url: target, finalUrl: target, status: 200, contentType: "text/html", text: readFileSync(target, "utf8"), fetchedAt: Date.now() };
  } else {
    doc = await fetchDoc(target, format as SourceFormat);
  }
  const out = await adapter({
    source: { key: `${bankSlug}:try`, bankSlug, products: [], url: target, format: format as SourceFormat, runner: "github", adapter: adapterName, cadence: "daily", active: true },
    doc,
    today: todayIST(),
    fetch: (url, f, init) => fetchDoc(url, f ?? "html", 3, init),
  });
  for (const card of out.cards) {
    const issues = validateCard(card);
    console.log(`\n${card.product} · effective ${card.effectiveFrom ?? "not stated"} · ${card.rows.length} rows · ${card.savingsSlabs?.length ?? 0} slabs · ${hasErrors(issues) ? "INVALID" : "valid"}`);
    for (const i of issues) console.log(`  ${i.level}: ${i.message}`);
    for (const r of card.rows.slice(0, 60)) console.log(`  ${String(r.tenureMinDays).padStart(4)}-${String(r.tenureMaxDays).padEnd(4)} ${r.customer.padEnd(12)} ${r.amountMin}-${r.amountMax ?? "∞"} ${r.callable === false ? "non-callable" : ""} ${r.rate}  «${r.tenureLabel}»${r.schemeName ? ` [${r.schemeName}]` : ""}`);
    for (const s of card.savingsSlabs ?? []) console.log(`  slab ${s.balanceMin}-${s.balanceMax ?? "∞"} ${s.rate}% (${card.slabMethod})`);
    for (const n of card.notes ?? []) console.log(`  note: ${n}`);
  }
  for (const w of out.warnings ?? []) console.log(`warning: ${w}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
