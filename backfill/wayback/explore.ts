/**
 * Exploration helpers for the Internet Archive, sharing the backfill's rate limit and cache.
 * Use these instead of calling web.archive.org directly, so parallel jobs stay polite together.
 *
 *   npx tsx backfill/wayback/explore.ts discover sbi.co.in            # candidate rate-page URLs on a domain
 *   npx tsx backfill/wayback/explore.ts captures sbi.co.in/deposit.htm 1998 2004
 *   npx tsx backfill/wayback/explore.ts fetch 19991012000000 sbi.co.in/deposit.htm   # prints the cached file path
 *   npx tsx backfill/wayback/explore.ts cdx 'url=sbi.co.in/*&filter=original:.*rate.*&collapse=urlkey&limit=500'
 */
import path from "node:path";
import { CACHE_DIR, cdx, discoverRateUrls, monthlyCaptures, snapshot } from "./cdx";

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === "discover") {
    for (const r of await discoverRateUrls(a, Number(b ?? 3000))) console.log(`${r.first.slice(0, 8)}  ${r.last.slice(0, 8)}  ${String(r.count).padStart(5)}  ${r.url}`);
  } else if (cmd === "captures") {
    for (const x of await monthlyCaptures(a, b ?? "1996", c ?? "2026")) console.log(`${x.timestamp}  ${x.digest}  ${x.original}`);
  } else if (cmd === "fetch") {
    const { html, archiveUrl } = await snapshot({ timestamp: a, original: b });
    const safe = b.replace(/^https?:\/\//, "").replace(/[^a-zA-Z0-9.-]+/g, "_").slice(0, 150);
    console.log(JSON.stringify({ archiveUrl, cached: path.join(CACHE_DIR, safe, `${a}.html`), bytes: html.length }));
  } else if (cmd === "cdx") {
    const params = Object.fromEntries(new URLSearchParams(a));
    for (const x of await cdx(params)) console.log(`${x.timestamp}  ${x.status}  ${x.digest}  ${x.original}`);
  } else {
    console.error("usage: explore.ts discover <domain> [limit] | captures <url> [from] [to] | fetch <timestamp> <url> | cdx '<query>'");
    process.exit(2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
