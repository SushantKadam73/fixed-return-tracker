/** Reproducible public facts, downloads and change feeds; no extra requests to banks. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { allProductFiles } from "../collectors/src/store";
import { buildSnapshots } from "../collectors/src/snapshots";
import { currentOfficialCard } from "../lib/current-card";
import { todayIST } from "../lib/format";

const root = process.cwd();
const data = path.join(root, "data");
buildSnapshots(root);
const sha = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const walk = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const file = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(file) : entry.name.endsWith(".json") && !entry.name.startsWith("_checks") ? [file] : [];
});
const files = ["banks", "sources", "rates", "terms", "schemes", "series"].flatMap((folder) => existsSync(path.join(data, folder)) ? walk(path.join(data, folder)) : [])
  .concat(readdirSync(path.join(data, "snapshots")).filter((file) => file.startsWith("current__")).map((file) => path.join(data, "snapshots", file)))
  .map((file) => ({ path: path.relative(data, file).split(path.sep).join("/"), sha256: sha(readFileSync(file)), bytes: readFileSync(file).length }))
  .sort((a, b) => a.path.localeCompare(b.path));
const releaseId = sha(JSON.stringify(files));
const out = path.join(data, "exports");
mkdirSync(out, { recursive: true });
const previousFile = path.join(out, "manifest.json");
const previous = existsSync(previousFile) ? JSON.parse(readFileSync(previousFile, "utf8")) as { releaseId: string; generatedAt: string } : null;
const generatedAt = previous?.releaseId === releaseId ? previous.generatedAt : new Date().toISOString();
const master = JSON.parse(readFileSync(path.join(data, "banks", "banks.json"), "utf8")) as { banks: Array<{ slug: string; name: string; tracking: string }> };
const banks = new Map(master.banks.filter((bank) => bank.tracking === "tracked").map((bank) => [bank.slug, bank.name]));
const products = allProductFiles(root);
const headers = ["bank_slug", "bank", "product", "tenure_label", "tenure_min_days", "tenure_max_days", "amount_min_inr", "amount_max_exclusive_inr", "customer", "residency", "callable", "payout", "quoted_rate_percent_pa", "effective_from", "observed_at", "source_url", "slab_method", "row_effective_from", "row_note"];
const rows: unknown[][] = [];
const current: Record<string, unknown> = {};
const changes: Array<{ id: string; url: string; title: string; date_published: string; content_text: string }> = [];
for (const file of products) {
  if (!banks.has(file.bankSlug)) continue;
  const card = currentOfficialCard(file.cards, todayIST());
  if (card) {
    current[`${file.bankSlug}:${file.product}`] = card;
    for (const row of card.rows) rows.push([file.bankSlug, banks.get(file.bankSlug), file.product, row.tenureLabel, row.tenureMinDays, row.tenureMaxDays, row.amountMin, row.amountMax, row.customer, row.residency, row.callable, row.payout, row.rate, card.effectiveFrom, card.observedAt, card.sourceUrl, null, row.effectiveFrom ?? card.effectiveFrom, row.note ?? null]);
    for (const slab of card.savingsSlabs ?? []) rows.push([file.bankSlug, banks.get(file.bankSlug), file.product, null, null, null, slab.balanceMin, slab.balanceMax, "general", slab.residency, null, null, slab.rate, card.effectiveFrom, card.observedAt, card.sourceUrl, card.slabMethod ?? "unknown", card.effectiveFrom, slab.note ?? null]);
  }
  for (const version of file.cards.filter((item) => item.sourceType === "bank_official" && (item.effectiveFrom ?? item.observedAt) <= todayIST())) {
    changes.push({ id: `${file.bankSlug}:${file.product}:${version.effectiveFrom ?? version.observedAt}:${version.contentHash}`,
      url: `https://fixed-return-tracker.vercel.app/banks/${file.bankSlug}`,
      title: `${banks.get(file.bankSlug)} ${file.product.toUpperCase()} rate revision`,
      date_published: `${version.observedAt}T00:00:00+05:30`,
      content_text: `Published schedule effective ${version.effectiveFrom ?? "date not stated"}; first observed ${version.observedAt}. Source: ${version.sourceUrl}. This is an observed revision, not a claim about every historical change.` });
  }
}
const csv = (cell: unknown) => {
  let text = cell == null ? "" : String(cell);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
writeFileSync(path.join(out, "current.csv"), [headers, ...rows].map((row) => row.map(csv).join(",")).join("\r\n") + "\r\n");
writeFileSync(path.join(out, "current.json"), JSON.stringify({ releaseId, generatedAt, rates: current }) + "\n");
const items = [...new Map(changes.map((item) => [item.id, item])).values()].sort((a, b) => b.date_published.localeCompare(a.date_published) || a.id.localeCompare(b.id)).slice(0, 50);
writeFileSync(path.join(out, "feed.json"), JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Fixed Return Tracker rate changes", home_page_url: "https://fixed-return-tracker.vercel.app", feed_url: "https://fixed-return-tracker.vercel.app/feed.json", items }) + "\n");
const xml = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
writeFileSync(path.join(out, "feed.xml"), `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fixed Return Tracker rate changes</title><link>https://fixed-return-tracker.vercel.app</link><description>Observed changes to official bank rate schedules</description>${items.map((item) => `<item><guid isPermaLink="false">${xml(item.id)}</guid><title>${xml(item.title)}</title><link>${xml(item.url)}</link><pubDate>${new Date(item.date_published).toUTCString()}</pubDate><description>${xml(item.content_text)}</description></item>`).join("")}</channel></rss>\n`);
const downloads = ["current.csv", "current.json", "feed.json", "feed.xml"].map((file) => ({ path: file, sha256: sha(readFileSync(path.join(out, file))) }));
writeFileSync(previousFile, JSON.stringify({ schemaVersion: 1, releaseId, generatedAt, rows: rows.length, files, downloads, note: "Release identifies committed facts. Source-check health is separate. Unknown fields are empty, not inferred. Historical gaps remain gaps." }, null, 2) + "\n");
console.log(`Release ${releaseId.slice(0, 12)}: ${rows.length} published rows, ${files.length} source datasets`);
