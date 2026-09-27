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

## Macro collectors (government schemes, provident funds, inflation, NPS, RBI)

Non-bank data — PPF/SSY/SCSS/NSC/KVP/POMIS/PO deposits, EPF/VPF/GPF, FRSB 2020(T), CPI-IW, CPI-Combined, NPS
Tier-I sample NAVs, RBI policy rates and RBI's Banks-in-India list — lives under `src/macro/`, one task module
per source family, wired into `src/run-macro.ts`. The contract (`src/macro/types.ts`) is stricter than the bank
adapters': a task only ever *reads* `data/schemes/*.json` / `data/series/*.json` / `data/banks/banks.json` and
returns proposed `Change[]`; `run-macro.ts` is the only code that writes, and it does so by editing the raw file
text in place (`src/macro/store.ts`) rather than a `JSON.parse`/mutate/`JSON.stringify` round-trip of the whole
file — the latter silently reformats every *other* value too (JS has no int/float distinction, so a pre-existing
`178.0` would become `178` — see git history on `data/series/cpi_iw_chained.json` from before this was fixed).
Every write is append-only and idempotent by date; nothing here ever edits or deletes an existing row.

### What each task reads

| Task | Source (URL, format) | Writes to |
| --- | --- | --- |
| `small-savings` | NSI master table `nsiindia.gov.in/InternalPage.aspx?Id_Pk=132` (HTML) → DEA OM listing `dea.gov.in/budget-division/475` (HTML page linking a PDF) → India Post `indiapost.gov.in/.../post-office-saving-schemes.aspx` (HTML), tried in that order, first to confirm the target quarter wins | `data/schemes/{ppf,ssy,scss,nsc,kvp,pomis,po_td_1y,po_td_2y,po_td_3y,po_td_5y,po_rd,po_sb}.json` |
| `epf` | EPFO circulars `epfindia.gov.in/site_docs/PDFs/Circulars` (HTML; the domain now redirects to `epfo.gov.in`) → PIB Labour Ministry releases `pib.gov.in/allRel.aspx?menuid=1&min=27` (HTML), first to show a *declaration* (not a CBT recommendation) for a newer FY wins | `data/schemes/epf.json` (`vpf.json` mirrors this at read time in `lib/schemes.ts`, not written separately) |
| `gpf` | Same DEA listing as `small-savings` for GPF's own resolution PDF; falls back to mechanically mirroring PPF's newly-confirmed rate (documented Finance Ministry practice since 1986) once `ppf.json` covers the quarter GPF needs | `data/schemes/gpf.json` |
| `frsb` | None fetched — coupon = NSC rate (from `data/schemes/nsc.json`, itself set by `small-savings`) + 0.35%, per Govt Notification F.No.4(10)-B(W&M)/2020 para 13(ii). (RBI also publishes a confirming press release each half-year at `rbi.org.in`, but there's no safe way to discover that release's exact `prid` without guessing, so it's not fetched — see "Known gaps") | `data/schemes/frsb_2020.json` |
| `cpi-iw` | Labour Bureau homepage `labourbureau.gov.in/` (HTML) — the "CPI-IW \[General Index]" widget (latest 2 months) plus the "Press Note CPI- IW for `<Month Year>`" link in the recent-uploads ticker, for `sourceUrl` only | `data/series/cpi_iw_chained.json` |
| `cpi-combined` | MoSPI eSankhyiki API `api.mospi.gov.in/api/getCPIIndex?Series=Current_series_2024&Format=JSON` (JSON; optional bearer token from `api/login` using `MOSPI_API_EMAIL`/`MOSPI_API_PASSWORD` — unauthenticated calls are capped at the first 10 records per the API's own manual) | `data/series/cpi_combined_monthly_2024base.json` |
| `nps-nav` | NPS Trust `npstrust.org.in/scheme-wise-nav-report-excel?navcatdataxls=PFM001&navyearselxls=all&navsubdataxls=<scheme code>` (tab-separated text, mislabelled `.xls`), once per tracked scheme code | `data/series/nps/{sbi_scheme_e,c,g,a}_tieri.csv` |
| `rbi-rates` | RBI homepage `rbi.org.in/` (HTML) — the "Current Rates" accordion, bounded by `<!-- CURRENT RATES START/END -->` comments | `data/series/rbi_{repo,sdf,msf,bank,crr,slr}_rate.json` (USD/INR is parsed but only logged — there's no daily FX series file to append a spot rate to) |
| `rbi-bank-list` | RBI "Banks in India" `rbi.org.in/commonman/english/scripts/BanksInIndia.aspx` (HTML) | `data/banks/_watch.json` only — **never** `data/banks/banks.json` itself; additions/removals are for a human to review and apply by hand |

### Publication calendar / cadence

- **Small savings (PPF, SSY, SCSS, NSC, KVP, POMIS, PO TD/RD/SB) and GPF**: reset quarterly (Apr-Jun, Jul-Sep,
  Oct-Dec, Jan-Mar) by a single DEA Office Memorandum covering all schemes at once. Historically notified in the
  last few days of the *previous* quarter (e.g. the Oct-Dec 2026 OM is expected around 30 Sept 2026) — a few days
  *before* it takes effect. `small-savings.ts` starts checking `PRE_ANNOUNCEMENT_WINDOW_DAYS` (3) days ahead of
  the quarter boundary specifically to catch that, and records the new period with its real (future)
  `effectiveFrom` immediately; `lib/schemes.ts`'s `schemeStatus` only treats a period as "current" once its own
  `from` has actually arrived, so the site correctly shows it as "awaiting" until then, with no extra code needed
  per-run. `gpf.ts` mirrors PPF quarter-for-quarter and picks this up automatically once `ppf.json` has it.
- **EPF**: once per financial year. The CBT *recommends* a rate (PIB, usually Feb-Mar) — not yet a declaration —
  and the Finance Ministry ratifies it later (historically anywhere from a few months later to the following
  Sept/Oct), backdated to 1 April. `epf.ts` only ever records the ratified declaration.
- **FRSB 2020(T)**: half-yearly reset, 1 Jan and 1 Jul, mechanically NSC + 0.35% — so it becomes computable the
  moment that half-year's NSC rate is confirmed (i.e. right after a `small-savings` run that includes NSC).
- **CPI-IW**: monthly. Month M's index is released on the **last working day of month M+1** (e.g. July's index
  around 31 August) — the homepage widget itself typically lags a further few weeks behind the press note before
  it's picked up here, which is why the widget was showing July as the latest reading as late as 27 Sept.
- **CPI-Combined**: monthly, MoSPI's stated release schedule is around the 12th of month M+1 (per its published
  calendar); the API itself was returning `HTTP 502` from every endpoint as of 2026-09-27 (a genuine upstream
  outage, confirmed with a direct `curl`, not a sandbox-specific block).
- **NPS NAVs**: every day the market is open (Mon-Fri, excluding NSE holidays) — no NAV is published on
  weekends, which is expected, not a failure.
- **RBI policy rates**: change only on an MPC decision (bi-monthly meetings, roughly Feb/Apr/Jun/Aug/Oct/Dec) or
  an ad hoc RBI notification (CRR/SLR); the homepage always reflects the current values, so checking daily is
  cheap and correct even though real changes are rare.
- **RBI Banks-in-India list**: changes only on a licence, merger or rename — no schedule; daily checks are cheap
  and the task never edits `banks.json` itself regardless of what it finds.

### Running

```bash
npx tsx collectors/src/run-macro.ts                    # every macro task, live, writes changes
npx tsx collectors/src/run-macro.ts --dry-run           # fetch + parse + report, writes nothing
npx tsx collectors/src/run-macro.ts --task epf          # a single task (see src/run-macro.ts's TASKS map for names)
npx vitest run collectors/tests/macro                   # unit tests against committed fixtures, no network
```

Each task's outcome (last attempt/success time, consecutive failures, last error, last time it actually changed
something) is recorded in `data/macro/_checks.json` regardless of whether it succeeded — one failing source
never stops the others, and the process only exits non-zero if *every* task failed outright.

### Daily GitHub Actions step

```yaml
- name: Run macro collectors
  run: npx tsx collectors/src/run-macro.ts
  env:
    MOSPI_API_EMAIL: ${{ secrets.MOSPI_API_EMAIL }}       # optional — unauthenticated cpi-combined calls still work, capped at 10 rows
    MOSPI_API_PASSWORD: ${{ secrets.MOSPI_API_PASSWORD }}
- name: Commit data changes
  run: |
    git config user.name "fixed-return-tracker-bot"
    git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
    git add data/schemes data/series data/banks/_watch.json data/macro/_checks.json
    if git diff --cached --quiet; then
      echo "No macro changes."
    else
      git commit -m "data: macro $(TZ=Asia/Kolkata date +%F)"
      git pull --rebase
      git push
    fi
```

Suggested schedule: once daily is enough (nothing here changes more than once a day; `small-savings`/`gpf` are
nearly free to run daily since they skip the network entirely outside their pre-announcement window) — e.g.
`cron: "0 2 * * *"` (07:30 IST), shortly after the bank-rates job in `ops/workflows/collect.yml`.

### Known gaps (safe no-ops, not silent guesses)

- **epf**: both `epfindia.gov.in` (redirects to `epfo.gov.in`) and `pib.gov.in` returned `HTTP 403` from this
  sandbox on 2026-09-27 — an Akamai/WAF "Access Denied" page (confirmed: identical requests via `curl` with the
  same User-Agent succeed, so it's a client-fingerprint block on this sandbox's network path specifically, not a
  dead source). GitHub Actions' network path may not be blocked the same way; if it still is, the next option is
  `"format": "browser"` (Playwright — not installed in this sandbox, so untested here).
- **cpi-combined**: `api.mospi.gov.in` returned `HTTP 502` on every endpoint as of 2026-09-27 (verified with a
  direct `curl`, independent of this codebase) — a genuine upstream outage. The task already treats this as
  `ok: true` with zero changes and a warning, not a task failure, so it self-heals the moment MoSPI is back.
- **frsb**: never fetches a confirming press release (no safe way to discover its `prid` without guessing); the
  formula (NSC + 0.35%) is applied directly and the result is marked `evidence: "secondary"` until someone adds
  the real `crossCheckUrl` by hand.
- **rbi-bank-list**: by design, differences are only ever written to `data/banks/_watch.json` for a human to
  review — never applied to `data/banks/banks.json` automatically.
