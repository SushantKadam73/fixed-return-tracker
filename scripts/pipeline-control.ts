export {};
/** Administrative HTTP calls from Actions/VPS; configuration values are never logged. */
const action = process.argv[2];
if (action !== "bootstrap" && action !== "sync") throw new Error("Expected bootstrap or sync");
const base = process.env.CONVEX_SITE_URL;
const secret = process.env.INGEST_SECRET;
if (!base || !secret) throw new Error("Set CONVEX_SITE_URL and INGEST_SECRET in GitHub Actions repository secrets.");
const url = new URL(base);
if (url.protocol !== "https:" || !url.hostname.endsWith(".convex.site")) throw new Error("Invalid Convex HTTP deployment URL");
async function main() {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${url.origin}/${action}`, {
        method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify(action === "sync" ? { revision: process.env.DATASET_REVISION } : {}), signal: AbortSignal.timeout(180_000),
      });
    } catch {
      if (attempt === 2) throw new Error(`${action}: network retry budget exhausted`);
      await new Promise((resolve) => setTimeout(resolve, 3000 * 2 ** attempt));
      continue;
    }
    if (response.ok) { console.log(`${action}: acknowledged`); return; }
    if (response.status < 500 && response.status !== 429) throw new Error(`${action}: HTTP ${response.status}`);
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000 * 2 ** attempt));
  }
  throw new Error(`${action}: retry budget exhausted`);
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
