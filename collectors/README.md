# Collectors

Collectors read each bank's official rate page and turn it into **rate cards** (see `lib/domain.ts`).

## Contract
- An adapter is `async (ctx) => ({ cards, terms?, warnings? })` (`src/types.ts`). It receives the fetched page in
  `ctx.doc.text` (HTML, JSON, or text extracted from a PDF) and may fetch linked documents with `ctx.fetch`.
- Adapters must **never guess**. If a table, column or tenure label cannot be read, throw (`AdapterError` /
  `ParseError`). The runner keeps the last good card and raises an alert.
- Take the effective date from the table's own header/caption/lead-in text, not from anywhere on the page
  (pages often mention other schemes' dates).
- Rows: tenure in days (use `parseTenure`), amount band in rupees (`parseAmountBand`), customer type, residency,
  callable, rate. Only publish values the bank prints. Derive RD rows from FD rows **only** when the bank states
  RD rates equal FD rates (`deriveRdFromFd`), and say so in `notes`.
- Savings: `savingsSlabs` + `slabMethod` = `incremental` / `whole` only when the page says so; otherwise `unknown`.

## Files per bank
- `src/adapters/<slug>.ts` — the adapter(s), exported and registered in a group file `src/adapters/group-<id>.ts`
  (`export const adapters = { "<slug>.fd": ..., "<slug>.bulk": ..., "<slug>.savings": ... }`).
- `fixtures/<slug>/*.html` — trimmed copies of the pages (`npx tsx collectors/scripts/trim-fixture.ts in out`).
- `tests/adapters/<slug>.test.ts` — asserts real values from the fixture (effective date, a few rates, row counts).
- Source entries go in `data/sources/sources.json` (`key`, `url`, `format`, `runner`, `adapter`, `cadence`).

## Running
```bash
npx tsx collectors/src/run.ts --bank sbi --no-post        # live, store to data/rates, no Convex post
npx tsx collectors/scripts/try-adapter.ts <module> <adapter> <bank> <url|file>   # try without storing
npx vitest run collectors
```

## Blocked or script-rendered pages
- JavaScript-rendered pages: look for the JSON/XHR endpoint or data embedded in the HTML (e.g. `__NEXT_DATA__`)
  first. If none, set `"format": "browser"` (Playwright on GitHub Actions / VPS).
- Pages that block automated clients (captcha/WAF): try GitHub Actions first, then the VPS; if still blocked,
  keep the source `active: false` with a note. Never substitute a third-party copy for the official page.
