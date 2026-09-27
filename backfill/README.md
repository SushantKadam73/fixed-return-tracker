# Backfill scripts — official bank rate archives

Each script below turns one bank's **own** published historical-rate archive into dated
`RateCard`s in `data/rates/<bank>/<product>.json`, via `storeHistoricalCard` (validates,
de-duplicates by content hash + date, never overwrites — a rejected card just doesn't get
added). All cards use `sourceType: "bank_archive"` and `confidence: "high"` unless a script's
own notes say otherwise. Raw downloaded archives are cached under
`/agent/workspace/private/archives/<bank>/` (outside the repo, per project convention); small
"facts only" intermediate JSON (no interpreted rates) lives under `backfill/intermediate/`.

No period's value is ever interpolated or guessed: wherever a source is ambiguous or a cell
can't be read, the affected row/card is skipped and logged to stdout, not filled in.

## 1. SBI — retail term deposits (`sbi` / `fd`)

- **Scripts**: `sbi-fd-archive.py` (downloads the XLSX, extracts facts to
  `intermediate/sbi-fd-rows.json`) → `sbi-fd-archive.ts` (turns that JSON into cards).
- **URL**: `https://sbi.bank.in/documents/26242/65574/15122025_Historical+Retail+Term+Deposit+Rates.xlsx/f21a3209-472b-b629-80e8-e558982d4000?t=1765802246329`
  (found via the "Domestic Term Deposit Interest Rate: Historical Data" link on
  https://sbi.bank.in/web/interest-rates/interest-rates/deposit-rates). The URL embeds an
  upload token that will change the next time SBI republishes the file — if the script starts
  404ing, re-find the current link from that deposit-rates page.
- **Coverage**: General Public retail domestic term deposit, 2008-01-04 → 2025-07-15, 91
  revisions.
- **Products/customers**: `fd` only, `customer: "general"` only — the workbook has no
  senior-citizen column (senior rates only ever appear on the bank's live page, ~3 years back).
- **Caveats**:
  - The retail/bulk amount threshold (₹15 lakh → ₹1 crore → ₹2 crore → ₹3 crore over the
    years) is only annotated on some columns. Where printed, the card's rows use that band;
    where not printed, `amountMin: 0, amountMax: null` with a note.
  - Two revisions share the printed effective date 2017-04-29 under two different bucket
    structures — both are kept as separate cards (they genuinely differ).
  - A few tenure labels in the workbook are shorthand ("46-90", "91 -180", "181 to < 1 year")
    that `parseTenure` cannot read unaided; they are expanded to the full label used elsewhere
    in the *same* workbook for the *same* bucket (never guessed — see the script's comments).
- **Re-run**: `python3 backfill/sbi-fd-archive.py && npx tsx backfill/sbi-fd-archive.ts`

## 2. SBI — savings account (`sbi` / `savings`)

- **Script**: `sbi-savings-archive.ts` (single TypeScript script — downloads the PDF itself).
- **URL**: `https://sbi.bank.in/documents/26242/65574/211022-SAV+INT+HIST.pdf/d898ad9a-28b3-b74a-77e9-b0b5d6907bfa?t=1666333463298`
  (same deposit-rates page as above). Same caveat about the token in the URL.
- **Coverage**: 2000-04-01 → 2022-10-15, 9 revisions. The PDF has not been updated since
  15-10-2022 even though SBI's savings rate has changed since (later revisions only appear on
  the live page).
- **Caveats**:
  - Two rows ("03.05.2011" and "31.07.2017") print two values ("3.50% to 4.00%") with an
    **empty** Balance column — the source does not say what balance splits the two values, so
    both revisions are skipped and logged rather than assigning an invented boundary.
  - Extracted with `pdftotext -layout` (already on this box) rather than `unpdf`: unpdf's
    (pdf.js) text-stream order scrambles this table's row-spanned date cells into an
    unreconstructable order (verified by inspection); `pdftotext -layout`'s X/Y-position
    reconstruction reproduces the table exactly as rendered.
- **Re-run**: `npx tsx backfill/sbi-savings-archive.ts`

## 3. HDFC Bank — retail FD, below the bulk threshold (`hdfc-bank` / `fd`)

- **Script**: `hdfc-fd-archive.ts`.
- **URL**: `https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/Historical-FD-Rates-Less-than-Rs-3-Crs.pdf`
  (found via the "Historic Rates" hub at https://www.hdfc.bank.in/interest-rates).
- **Coverage**: General Public only, 2010-07-30 → 2026-03-06, 81 revisions across 8 dated
  blocks. The bank's own "retail" amount threshold changes within the file (printed as a
  heading — "Less than 1 Cr" until 2018, "Less Than 2 Cr" from 2019 onward) and is read with
  `parseAmountBand`, not assumed.
- **Caveats**: a handful of individual rows (3 tenure buckets in the 2015–2018 block, plus one
  row each in a 2020–2022 and a 2023–2025 block — see the script's own printed `SKIP` lines) do
  not resolve to exactly one rate per dated column even after rejoining the PDF's line-wrapped
  labels; those specific rows are skipped and logged. Every other row/column parses cleanly.
- **Re-run**: `npx tsx backfill/hdfc-fd-archive.ts`

## 4. HDFC Bank — savings account (`hdfc-bank` / `savings`)

- **Script**: `hdfc-savings-archive.ts`.
- **URL**: `https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/historic-saving-account-interest-rates.pdf`
  (same "Historic Rates" hub).
- **Coverage**: 2003-03-01 → present (open-ended "24/06/2025 onwards"), 11 printed effective
  date ranges, up to 4 balance tiers. `observedFrom`/`observedTo` are set from the printed
  range (this archive is the one case among the four where the source states one).
- **Caveats — read before re-running**:
  - The balance-tier boundaries for this file are **transcribed from the rendered PDF page**,
    not parsed from extracted text. Several rows use a table cell that visually spans two or
    three of the four tier columns (one merged "3.50%" cell covering "Below 50L" *and*
    "50L-500Cr" for 2003–2011, for instance); both `pdftotext -layout` and `unpdf` keep the
    printed values but drop which columns a merged cell spans, so the column boundaries cannot
    be read back out of plain text without guessing. This was resolved once, by hand, by
    rendering the PDF to an image (`pdftoppm`) and reading the true spans directly — every
    number in `hdfc-savings-archive.ts`'s `ROWS` table is exactly what the PDF prints. If HDFC
    revises this file, `ROWS` needs updating the same way (render the new page, re-read it).
  - Two periods (2019-01-07..2020-04-14 and 2020-04-15..2020-06-10) print their ≥ Rs 500 crore
    tier as "RBI Repo Rate + 2bps", not a fixed percentage — that tier is omitted (not
    computed) for those two cards, with a note; the other tier(s) for those periods are kept.
- **Re-run**: `npx tsx backfill/hdfc-savings-archive.ts`

## 5. Punjab National Bank — savings account (`punjab-national-bank` / `savings`)

- **Script**: `pnb-savings-archive.ts`.
- **URL**: `https://pnb.bank.in/Interest-Rates-Deposit.html` — PNB has no separate historical
  file; the live "Saving Deposit Interest Rate" section embeds ~14 years of past revisions as
  hidden tab panels (one small table per "w.e.f. DATE" tab), including the current rate.
- **Coverage**: 2011-05-03 → 2025-10-01, 17 dated panels (16 historical + the current one).
- **Caveats**:
  - This is a **live-page-inline** archive, not a maintained downloadable file: a PNB
    redesign could remove or restructure these tab panels without notice. Re-running this
    script after such a redesign will likely need `isSavingsHistoryGrid`/`ownDateOf` in
    `pnb-savings-archive.ts` updated to match the new markup.
  - Each panel's own date is inferred as the *last* "w.e.f. DATE" token accumulated in
    `extractTables`' `context` string for that panel (PNB's tab labels are DOM siblings of the
    panel, not inside it). Verified correct by checking the 17 resulting dates run in strictly
    descending chronological order, exactly like a "current, then progressively older" tab
    strip.
  - Balance-band labels use a few notations `parseAmountBand` doesn't parse unaided — a bare
    leading "<"/">" symbol, and "<=" for an inclusive upper bound. Both are spelled out as the
    words `parseAmountBand` already recognises ("below "/"above "/"to upto") before parsing;
    see the script's `normalizeComparison` for the exact substitutions (mechanical, not a
    guess — the numbers and comparisons themselves are untouched).
- **Re-run**: `npx tsx backfill/pnb-savings-archive.ts`

## Not attempted

Per the research notes (`/agent/workspace/research/history/history_summary.md` and
`history_feasibility.json`), SBI and HDFC Bank are the only two banks with genuine multi-year
*downloadable* historical deposit-rate archives, and PNB is the only other bank with a
multi-year archive of any kind (inline on its live page). No other bank in scope publishes a
comparable official archive — the remaining ~38 banks surveyed show only the current rate plus
at most 1–3 prior revisions inline, which is not a distinct "archive" to script against.

## Internet Archive backfill (`backfill/wayback/`)

Rebuilds rate cards from Internet Archive copies of banks' own rate pages, for every bank and
merged predecessor. Cards get `sourceType: "web_archive"`, `observedFrom`/`observedTo` (the first
and last capture that showed those exact rates) and the capture's `archiveUrl` as evidence;
`effectiveFrom` is kept only when the page states it and it is not later than the first capture.

- **Targets** live per history group in `wayback/targets/<group>.json` (`psb-a`, `psb-b`, `pvt-a`,
  `pvt-b`, `sfb`): `{ url, product, amountMax?, from?, to?, parser?, note? }`.
- **Parsers**: `wayback/generic-parse.ts` reads plain "tenure | rate" tables and refuses anything
  ambiguous. Layout-specific readers live in `wayback/parsers/<group>.ts` (key
  `"<bankSlug>/<layout>"`, referenced from a target's `parser`), registered through
  `wayback/parser-registry.ts`, each with a fixture test in `backfill/tests/`.
- **Run**: `npx tsx backfill/wayback/run.ts --group <g> [--bank <slug>] [--url <text>] [--out <staging dir>] [--dry-run] [--verbose] [--stride 3]`.
  One CDX call lists monthly captures with content digests. Identical digests are read once. Pages
  with few distinct versions are read exactly, and pages whose bytes change every month are sampled
  every `--stride` months, with bisection wherever neighbouring samples differ. Re-running a
  target replaces its earlier archive cards, so parser fixes never leave duplicates.
- **Politeness**: every request goes through `wayback/cdx.ts`, which enforces one request per
  `WAYBACK_GAP_MS` (default 3 s) **across all processes** sharing the cache directory
  (`/agent/workspace/private/wayback`, never committed), and makes every job back off together on
  HTTP 429/5xx. Use `wayback/explore.ts` (`discover`, `captures`, `fetch`, `cdx`) for exploration so
  it shares the same limit.
- **Staging and merge**: history jobs store into a staging root (`--out`), outside the repo. After
  review, `npx tsx backfill/merge-staged.ts --from <staging dir>` merges them into `data/rates/`,
  re-validating every card. Archive cards replace earlier cards from the same URL, other historical
  cards are de-duplicated by content and date, and live cards are never taken from staging.
- **Notes**: each history group keeps a running source and gap log in `backfill/notes/<group>.md`.
