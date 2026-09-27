# pvt-b history research log (Vellum)

Group: IDFC FIRST Bank, J&K Bank, Karnataka Bank, Karur Vysya Bank, Kotak Mahindra Bank,
Nainital Bank, RBL Bank, South Indian Bank, Tamilnad Mercantile Bank, YES Bank.
Predecessor: ING Vysya Bank / Vysya Bank (`ing-vysya-bank`, merged into Kotak 1 Apr 2015).

Staging root: `/agent/workspace/private/history-staging/Vellum`.
Scratch: `/agent/workspace/private/tmp/Vellum`.

Useful prior art found in the repo (not mine to touch, read-only):
- `/agent/workspace/research/banks/wayback_results_g3_private_b.json` and `g3_private_b.md`/`.json` --
  a Phase-1 survey of current live pages + a blind CDX "candidate" dump per domain (mostly noise:
  blog posts, apply-now forms, image/CSS assets, captcha endpoints -- the `filter:.*rate.*` CDX
  query also matches "co-RATE-" substrings like "corporate", so treat every candidate as unverified).
- `/agent/workspace/research/banks/fixtures/south-indian-bank/*.html` -- the survey's saved copies
  of the *current* (bank.in era) live pages; useful for confirming today's page structure without
  spending archive budget.

## South Indian Bank (`south-indian-bank`) -- PRIORITY 1, pilot

### FD (`fd`) -- DONE, 41 cards, earliest 1999-02-20
- **Sources** (both `sourceType: web_archive`, custom parser
  `south-indian-bank/domestic-term-deposit` in `backfill/wayback/parsers/pvt-b.ts`):
  - `southindianbank.com/interest.html`, 1999-2007 window queried: 19 monthly captures found, all
    falling 1999-02-20 .. 2002-12-18 (Wayback has nothing for this exact URL after 2002; the site
    evidently moved to the ASP.NET rate system before being captured again -- see gap below).
    13 cards stored.
  - `southindianbank.com/interestRate/interestRateDetails.aspx?irtID=1`, 2007-2026: 35 monthly
    captures, 28 distinct rate versions, all 28 stored. Span 2007-07-08 .. 2025-08-12 (current).
- **Why a custom parser was needed**: the generic reader (`generic-parse.ts`) classifies a column
  only by customer type (general/senior), never by amount. This page prints one amount tier per
  column-group (e.g. "less than Rs.15 lacs" / "Rs.15 lacs to (incl) Rs.100 lacs", later a single
  "less than Rs.2 crore" tier x General/Senior Citizens). Two tiers both reading as plain "general"
  collide under validateCard's conflicting-rows check whenever their rates differ, and the *whole*
  snapshot gets rejected even though most of the table read fine. Verified this actually happened:
  with the generic reader, irtID=1 alone lost 4 of 28 snapshots (2007-07-08, 2007-12-13,
  2008-09-19, 2010-12-01) to this collision, and every other snapshot silently merged two amount
  tiers under one amountMax=null band. The custom parser reads each column's own header for both
  its amount band (shared `parseAmountBand` helper) and its customer type; after the fix, 0 of 28
  (and 0 of 13) are rejected, and amount tiers are recorded correctly.
  - One page-specific text fixup: "(incl)" (as in "Rs.15.00 lacs to (incl) Rs.100.00 lacs") is
    spelled out as "and including" before calling `parseAmountBand`, the same mechanical-rewrite
    technique `sbi-fd-archive.ts` uses for its own amount annotations -- never touches the numbers.
  - Header-row detection deliberately does NOT reuse the generic reader's "first rate-shaped cell"
    heuristic: several years print an early tenure row ("7 days to 14 days") as all "--" (no rate
    offered yet), which would be mistaken for a header row under that heuristic. Instead this
    parser's header/body split is "leading rows whose first cell is not itself a parseable
    tenure" -- see the parser file's own comments.
  - A "Tax Gain ( 5 Years )" 5-year tax-saver row is embedded in the same table on some captures
    (e.g. 2020-08-04). `parseTenure` strips the parenthesised part, so this row is not a term
    deposit tenure and is silently skipped by design -- it belongs to `product: "tax_saver"`, not
    `fd`, and is not captured by this target. **Lead not pursued**: a `tax_saver` target for the
    same URL would need its own small parser addition to special-case that one row.
- **Vitest coverage**: `backfill/tests/pvt-b.test.ts`, 4 cases against trimmed fixtures in
  `backfill/fixtures/south-indian-bank/` covering the 1999 flat single-column fallback, the Aug
  2000 3-tier no-senior static layout, the 2007 2-tier layout with a non-numeric footnote column,
  and the 2013 tier x General/Senior layout with the "(incl)" and all-dash-row cases.
- **Gap (2003 - mid-2007)**: no captures of either `interest.html` or an `interestRateDetails.aspx`
  URL exist in the Wayback CDX index for this window. Not pursued further (CDX already queried
  the whole 1996-2026 range for both URLs; nothing to bisect if the archive has nothing).
- **Gap (pre-1999)**: `interest.html`'s own earliest capture is 1998-12-07 (see
  `wayback_results_g3_private_b.json`'s `legacyEarliest` for this domain) but that specific capture
  returned no page (checked: CDX lists it as `statuscode:200` but it predates the first capture our
  `monthlyCaptures` query returned -- not re-verified further; low priority given the 1999-02-20
  capture already reads cleanly).

### Savings (`savings`) -- DONE, 7 cards, earliest (bank-specific) 2011-12-25
- **Why not via run.ts**: `run.ts`'s `Target`/`GenericResult` pipeline only carries `RateRow[]`
  (term-deposit rows); it never builds `savingsSlabs`/`slabMethod`, so any savings card pushed
  through it fails `validateCard`'s `no_slabs` check. This matches the existing convention in the
  repo -- SBI, HDFC and PNB's savings archives are *all* dedicated scripts too, never `run.ts`
  targets, regardless of source (PDF, live page, or here, the Wayback archive).
  - Wrote `backfill/south-indian-bank-savings-archive.ts`: same shared, rate-limited `cdx.ts`
    helpers (`monthlyCaptures`/`snapshot`) as everyone else, own slab parsing, stores directly via
    `storeHistoricalCard` into the staging root. Run: `npx tsx backfill/south-indian-bank-savings-archive.ts`.
- **Source**: `southindianbank.com/interestRate/interestRateDetails.aspx?irtID=10` ("DOMESTIC
  SAVINGS ACCOUNT" / later "ALL SAVINGS ACCOUNTS", both "Also Applicable for NRO/NRE Accounts").
  Only captures on/after 2011-10-25 (RBI's savings-rate deregulation) are read -- the pre-2011
  flat RBI-mandated rate is already in the system-wide series and is not duplicated per bank.
  21 captures in scope, 21 parsed, 7 distinct slab structures, 7 cards, 0 rejected.
- **Two layouts**: a flat "Period | Rate" single row (2011-2016: SIB kept a flat rate for years
  after deregulation, e.g. 4.00% through at least March 2015) becomes one slab covering the whole
  balance range; from Nov 2019 onward a proper "End of the day Balance | Rate of Interest" tiered
  table (4-5 balance tiers) is read tier-by-tier with `parseAmountBand` -- no bank-specific text
  fixups were needed for this table's phrasing (unlike the FD page's "(incl)").
  `slabMethod` is recorded as `"unknown"`: the page never states whole-vs-incremental application
  (confirmed against both this archive and the bank's current live page fixture in
  `research/banks/fixtures/south-indian-bank/sib_interest_rates_deposits_27703f89.html`).
- **Notable, not a typo**: effective 2025-08-11 SIB restructured its savings tiers, raising the
  base-tier ceiling from Rs 2 lakh to "less than Rs 1 crore" (2.50%) -- a real, large jump in where
  the lowest tier ends, confirmed by reading the raw page directly (not a parse error).
- **Gap -- Recurring Deposit**: no distinct RD rate table found anywhere. Checked (a) the
  `interestRateList.aspx` accordion index across 2007, 2015, 2017, 2022 captures (irtID map below)
  and (b) the bank's current live rates page fixture -- both mention Recurring Deposits only in
  the premature-withdrawal-penalty clause ("... including Recurring Deposits ..."), never in a
  priced table. Plausibly RD tracks the FD schedule 1:1 but this is not stated anywhere the bank
  publishes, so **no RD cards are stored for South Indian Bank** (would be a guess).
- **Gap/lead -- Bulk deposits**: not pursued. `interestRateList.aspx`'s accordion (from ~2022
  captures) has panels `demo1023` "Bulk Deposit" and `demo1024` "NRE Bulk Deposit" embedded
  directly in that one page -- but these `demo10xx` ids are internal repeater indices, not
  separately fetchable `interestRateDetails.aspx?irtID=` pages (confirmed: irtID never reaches
  four digits in the CDX-discovered set, see below). A future pass could parse the `demo1023`
  panel directly out of `interestRateList.aspx` captures (already fetched from 2022 and 2025 in
  the shared cache) but no historical span before ~2022 was located in the time available.

### irtID map (from `interestRateList.aspx` captures, for whoever picks up NRE/FCNR/RFC next)
2007 (`irtID=`): 1 domestic deposits (FD), 3 FCNR(B), 4 NRE deposits, 5 RFC account,
10 domestic savings, 11 NRE savings. By 2015: 17 RFC savings and 20 "Effective Annualized Rate of
Return" added; 11 (NRE savings) no longer listed separately. By 2022: 22 non-callable deposits,
23 "Domestic Rate of Interest - General" also present. `irtID=19` (found via CDX, captured
2010-2012) is an empty/retired category page -- checked, not worth pursuing. From ~2017 the
`interestRateList.aspx` index page itself switched from linking out to `irtID=` pages to an
accordion embedding every category inline (`data-acc-link="demoN"`, N matching the old irtID
numbers for N<100); the standalone `irtID=` pages kept working in parallel throughout (irtID=1 and
irtID=10 both have captures through 2025).

### Survey cleanup
Deleted 3 `southindianbank.com/blog/fixed-deposit...` blog-post "candidates" from
`targets/pvt-b.json` (not rate tables) per the brief.

## Karnataka Bank (`karnataka-bank`) -- 31 cards, earliest 2002-10-21

- `karnatakabank.com/deporates.htm`, generic parser, FD: 6 captures 2002-2004, all parsed, 5
  stored. Oldest working source for any bank in this group after South Indian Bank.
- `karnatakabank.com/ktk/interestcharttd.jsp` ("interest chart term deposit"), generic parser, FD:
  37 captures 2014-2020 range queried; most captures fail the generic reader ("no rate columns" --
  layout varies a lot across this page's life) but enough parse to add 18 more cards. Net result
  combined with the two targets above: 31 total.
- `karnatakabank.com/personal/term-deposits/interest-rates`, generic parser, FD: 16 captures
  2019-2023, 16 parsed, 8 stored, 3 rejected (senior-citizen column collides with itself --
  probably two senior sub-tiers, e.g. below/above 80 years, both reading as plain "senior"; not
  investigated further -- same class of problem as `jk-bank/current-revised-rate-table` but not
  fixed here for time).
- **Gap 2004-2014**: no working source found. `deposits.htm` (2002-2004, same era as
  `deporates.htm`) fails the generic reader ("first column is not tenures") -- not investigated
  (a second, differently-laid-out old page; likely fixable but not attempted).
- **Not found**: `DepositIntrates.htm` and `kblFDrates.html` both report 0 CDX captures despite
  appearing in the Phase-1 survey's candidate dump and in a fresh `explore.ts discover` run --
  worth re-checking the exact URL casing/query the CDX index actually stores.
- Savings, RD, bulk: not attempted (time).

## J&K Bank (`jk-bank`) -- 8 cards, earliest 2017-01-10

- `jkbank.com/others/common/intrates.php`, custom parser `jk-bank/current-revised-rate-table`
  (`backfill/wayback/parsers/pvt-b.ts`), FD: 9 captures 2017-2020, all 9 parsed, 8 stored, 0
  rejected. **Needed a custom parser**: the page prints an outgoing "Current Interest Rates" and
  incoming "Revised Interest Rates per Annum w.e.f. DATE" column side by side around every rate
  change (a transition notice), plus a non-rate "Deposit Type" column. The generic reader classifies
  both rate columns as plain "general" (both headers contain the word "Rate") and the row conflicts
  whenever they differ -- with the generic reader this target stored only 6/8 cards (2 rejected).
  The custom parser keeps only the "Revised" column (the outgoing "Current" value belongs to an
  earlier snapshot, already captured in its own right) and drops any column whose header contains
  "current". Covered by a vitest case and a trimmed fixture
  (`backfill/fixtures/jk-bank/20200814-intrates.html`).
- **Gap before 2017**: jkbank.com's absolute earliest Wayback capture (any path) is 2001-07-06
  (per the Phase-1 survey's `wayback_results_g3_private_b.json`), but no rate-bearing page was
  found for 2001-2016 in the time available -- `deposits/personal/fixedDepositsScheme.php`
  (2017-2020 captures) and `deposits/personal/recurringDeposit.php` both come back "no table" on
  every capture checked (likely marketing pages, not rate tables, or JS-rendered).
- **Current era**: `informations/rates-quick-glance` (2 captures, 2025) also "no table" -- likely
  JS-rendered like the bank's other modern pages.
- Savings, RD, bulk: not attempted beyond the recurringDeposit.php dead end above.

## Karur Vysya Bank (`karur-vysya-bank`) -- 2 cards (savings + bulk only; FD not yet working)

KVB's site (kvb.co.in) is unusually rich in leads but every *HTML* rate page checked across its
whole history failed the generic reader:
- `deposit.html` (12 captures, 2000-2003): this is a **menu/hub page** linking out to named scheme
  pages ("Domestic Deposits - Interest Rate Chart" is one menu item, not a table on this page
  itself) -- the actual chart lives at a different, not-yet-identified URL. Leads not pursued:
  `intrestrate.asp` / `scriptsintrestrate.asp` / `scripts/depositrates.asp` (all found via
  discover, all from 2006; `depositrates.asp` was tried and came back "no table" on its 5 captures
  -- may itself be a further menu/frame page, not checked).
- `personal/deposits.html` (12 captures, 2010-2014, identical digest the whole time -- a single
  static page never revised in this window): not dry-run in this pass; worth trying, it did not
  appear as a target yet.
- `global/resident_domestic_deposits.aspx`: 0 CDX captures under the exact URL used, despite
  appearing in the discover dump -- likely a query-string or redirect variant issue, not resolved.
- `interest-rates/` (the modern hub, 10 captures 2019-2025): confirmed **JS-rendered on every
  capture** -- zero `<table>` elements and no embedded JSON (`__NEXT_DATA__` etc.) in any of them.
  Matches the Phase-1 live-page survey's finding that KVB's current `deposit-interest-rates-glance`
  page is JS-rendered.
- **Found instead**: KVB exposes several rate tables as small JSON documents behind its own
  `api/v1/...` paths (confirmed by fetching captures directly -- response body is JSON, not HTML).
  Two were usable:
  - `api/v1/savings-interest-rates` (savings): only 1 capture found (2020-11-16, 3 balance
    slabs). Read by a dedicated script, `backfill/karur-vysya-bank-savings-archive.ts` (same
    reason as South Indian Bank's savings -- `run.ts`'s pipeline can't build `savingsSlabs`). 1
    card stored.
  - `api/v1/bulk-deposit-rates` (`fd_bulk`): only 1 capture found (2020-05-28, 10 tenures x 4
    amount tiers x callable/non-callable = 80 rows). Read via `run.ts` using a **new custom
    parser**, `karur-vysya-bank/bulk-deposit-json` (`backfill/wayback/parsers/pvt-b.ts`) -- the
    first parser in this group that reads JSON instead of HTML (the shared `Target`/`GenericResult`
    plumbing doesn't care what `html` actually contains, so this fits the existing pipeline once
    the parser itself does `JSON.parse` instead of `extractTables`). 1 card stored.
  - No equivalent **retail FD** JSON endpoint was found in the time available -- `api/v1` paths
    seen so far: `savings-interest-rates`, `bulk-deposit-rates`, `personal-banking-rates` (2
    captures, not yet fetched), `mclr-deposit-rates`, `nro-deposit-rates`,
    `external-benchmark-rates`. `personal-banking-rates` is the most promising unexplored lead --
    try it next.
- **Gap**: no FD cards at all for KVB yet, despite it being priority #1 per the coverage order.
  Next steps, in order: (1) fetch `api/v1/personal-banking-rates`, (2) try
  `personal/deposits.html` (already has good capture coverage, just not dry-run yet), (3) try
  `depositrates.asp`/`intrestrate.asp` directly.

## Kotak Mahindra Bank (`kotak-mahindra-bank`) -- 0 cards (leads only, not yet stored)

Not stored yet, but found two very promising leads via `explore.ts discover kotak.com`:
- `kotak.com/bank/common/allrates.htm` (2010) and its succesor `allrates.html` (2022) -- a
  consolidated "all rates" page; also `bank/mailers/allrates.htm` (2021) and `allratestd.htm`
  (2011, "all rates term deposit"). Not yet fetched/dry-run.
- `kotak.com/bank/mailers/intrates/get_all_variable_data_latest2.php?section=NRO_Term_Deposit`:
  another bank-run JSON-ish PHP data endpoint (1567 captures under this one collapsed URL key --
  by far the most-captured URL found in this whole pass, though `discoverRateUrls` collapses away
  the query string so this could be many different `section=` values folded together). Not yet
  fetched to confirm its content-type or find the `section=` value that would hold the *domestic*
  retail term deposit (only the NRO one is confirmed from the one query string visible in the
  discover dump); a raw `cdx` query for other `section=` values was queued but not completed this
  session.
- `kotak.com/bank/deposits/term-deposits/term-deposits.html` (2012) -- a plain product page, not
  yet checked.
- Kotak's own `811-savingsaccount-ZeroBalanceAccount/...` micro-site (2019-2025, hundreds of
  captures) is its 811 digital-savings-account marketing funnel, not a rate table -- deliberately
  not added as a target.
- **Not pursued this session** (ran out of time after discovery): dry-running any of the above,
  or checking whether `allrates.htm`/`.html` is server-rendered. This is the single best-looking
  unexplored lead in the whole group -- recommended starting point for whoever picks this up next.

## Nainital Bank (`nainital-bank`) -- 6 cards, earliest 2015-03-30

- `english/interest_rate.aspx`: 4 cards, 2016-04-14 to 2016-12-13.
- `english/interest_rate01.aspx`: 2 cards, 2015-03-30 to 2018-12-13 (only 2 distinct rate
  versions read across 27 captures -- the page barely changed over 3+ years).
- `english/interest_rate1.aspx` also parses (1 group spanning 2016-2018) but was not stored
  separately -- almost certainly the same content as `interest_rate01.aspx` for this period
  (probably an old vs. new URL alias); not de-duplicated/verified, left as a lead rather than
  risking a duplicate card.
- **Gap pre-2016 / the JS-accordion problem**: `deposits.htm` (9 captures, 2008-2010) is **not a
  static HTML table** -- its "Fixed"/"Saving" rate rows are built at runtime by inline JavaScript
  (`fixed.innerHTML = "<tr>...</tr>" + ...` string concatenation inside an accordion widget), so
  there is no real `<table>` in the archived markup for `extractTables` to find. The rates
  themselves (e.g. "8.25% (Quarterly Compounded) on Term Deposits of 450 Days") are visible as
  literal strings in the JS source, but reading them needs a bespoke text/regex parser, not
  attempted here. This is the only lead found for Nainital Bank pre-2014.
- `roi8termdep.htm` and `savingaccount.htm` (both 2009-2012, found via discover) were added as
  targets but not dry-run this session -- try these next for the 2010-2015 gap.
- `recurring_deposit.aspx` (RD): "no table" on every capture checked (55 captures 2016-2022) --
  likely a marketing page, not a rate table.
- `term_deposit.aspx` (current era, 2019-2026): fails ("first column is not tenures") on every
  capture checked -- a modern layout not investigated; this is also the bank's current live page,
  so fixing it would benefit the live collector too.
- `english/saving_account.aspx` (current era savings, added as a target) not yet dry-run.

## RBL Bank (`rbl-bank`) -- 6 cards, earliest 2024-01-16

- `rblbank.com/interest-rates`, generic parser, FD: 17 captures 2022-2025, 12 parsed, 6 stored (2
  early 2022-2023 captures come back "no table" -- possibly JS-rendered before a later redesign,
  not confirmed).
- `interest-rates/savings`: 3 captures 2021-2022, all "no table" (JS-rendered).
- `interest-rates/rd-rates`: 0 CDX captures under the exact URL used (the discover-collapsed URL
  had `?utm_campaign=...` query params attached; the bare path may have never been captured on
  its own -- not resolved).
- **No pre-2014 RBL/Ratnakar Bank web presence exists in the archive.** Checked directly: a raw
  CDX domain query for `ratnakarbank.in` returns only a `cgi-sys/defaultwebpage.cgi` parking page
  (2012-2013) plus a handful of default Apache/cPanel icon files (`icons/back.gif` etc.) -- this
  domain was never a real bank website in Wayback's index, at any point. RBL Bank's own prospectus
  material (see `data/banks/banks.json`'s `rbl-bank` entry) puts the "Ratnakar Bank" -> "RBL Bank"
  rename at 24 Nov 2014; `rblbank.com` itself has its earliest rate-relevant captures from 2014
  (forex-rate PDFs). This looks like a genuine gap, not a research failure -- 1943-2014 for this
  bank is (so far) not recoverable from the web archive at all.
- **Gap 2014-2022**: not investigated (no candidate URLs found yet for this window; RBL's older
  site design between the 2014 rename and the current Angular-ish `rblbank.com/interest-rates`
  hub was not searched).

## South Indian Bank -- see the dedicated section above (the pilot bank). 41 FD cards (1999-2025),
7 savings cards (2011-2025), 1 bulk JSON card for KVB noted above is unrelated.

## Tamilnad Mercantile Bank (`tamilnad-mercantile-bank`) -- 16 cards, earliest 2007-08-09

- `tmb.in/interest_d.htm` ("interest domestic"), generic parser, FD: 30 captures 2007-2009, 27
  parsed, 19 groups, 16 stored (some groups likely collapsed as duplicates by `storeHistoricalCard`
  since it de-dupes by content hash + date), 0 rejected. This is TMB's oldest working source found.
- **Not yet dry-run**: `tmb.in/d_fixeddeposit.htm` (2006-2010, a sibling page from the same era --
  possibly the same content under a different name, or a distinct scheme) and
  `tmb.in/deposit_interest_rates` (2011-2020, the 2011-era CMS redesign's consolidated page) --
  both were added as targets but the group's `--dry-run` batch had not reached them before this
  session's time ran out. These are the two clear next steps: `d_fixeddeposit.htm` might extend
  coverage earlier/fill gaps in 2006-2010, and `deposit_interest_rates` is the best lead for
  2011-2020 (TMB's current site is `tmb.bank.in/personal/deposits/...`, a different, unchecked
  domain generation).
- `d_saving.htm` (savings, 2006-2010) also not yet dry-run.
- **Gap pre-2007**: TMB's Wayback presence for `tmb.in` starts in 2006 (`sdsavings.htm`, a single
  2006-07-04 capture, not yet checked); nothing earlier found in the time available.

## Vysya Bank / ING Vysya Bank (`ing-vysya-bank`, predecessor of Kotak) -- 5 cards, earliest 2003-04-26

- `ingvysyabank.com/Interestrates_fr.shtml`, generic parser, FD: 9 captures 2003-2006, 9 parsed
  (2 rejected by a shared-code heading heuristic that correctly identifies an NRO-account table as
  "another product" and skips it -- see the shared-code note below), 8 groups, 5 stored, 1
  rejected (2005-02-08: senior-vs-general collision, not investigated).
  **Needed a URL fix, not a parser**: `Interestrates.shtml` (no `_fr` suffix) is a **frameset
  shell** with no content of its own -- `<frameset><frame src="Interestrates_fr.shtml">`, confirmed
  by fetching a capture directly. The generic reader correctly reports "no table" for the shell
  (there genuinely is none), which could easily be mistaken for "this page has no rate table" --
  it is the *wrong URL*, not an unparseable page. Same problem fixed for the savings target
  (`savingsbankaccount.shtml` -> `savingsbankaccount_fr.shtml`, not yet dry-run).
- **Vysya Bank's own pre-ING-partnership site (`vysyabank.com`) has no usable content.** Checked
  directly via a raw CDX domain query: the ~15 earliest captures (1999-2001) are a bare Apache
  `mod_autoindex` directory listing (`?D=A`, `?N=D` sort-order query strings; `icons/folder.gif`,
  `icons/back.gif` -- the standard Apache icon set) plus a `404error.html`, not a real website.
  `ingvysyabank.com` (used above) only starts once the ING partnership/rename took effect
  (~2002-2003 per `banks.json`), so 1930-2002 has no found web-archive evidence for this
  predecessor -- likely a genuine, permanent gap (pre-web era for this bank).
- `scripts/fixeddeposit.aspx` (2006-2012): fails a shared-code heading check ("first column is
  not tenures" / heading-score rejection) on every capture sampled -- not investigated further.
- `scripts/savingsbankaccount.aspx`: 0 CDX captures under the exact URL tried.
- **Gap 2006-2015** (up to the Apr 2015 Kotak merger): not investigated.

## YES Bank (`yes-bank`) -- 6 cards, earliest 2007-06-26

- `yesbank.in/fixeddeposit.htm`, generic parser, FD: 17 captures 2005-2010 queried, 15 evaluated,
  11 parsed, 5 groups, 4 stored, 1 rejected (2008-10-13: every single tenure row conflicts on the
  "general" customer -- almost certainly a senior-citizen column being misclassified as a second
  "general" column on that specific capture; not investigated further). The 2005-2006 captures
  ("table 6: first column is not tenures") fail outright -- YES Bank's very first site design
  (bank was licensed May 2004) apparently didn't yet put the retail FD table in a readable
  `<table>`; not investigated.
- `yesbank.in/branch-banking/personal/fixed-deposits.html`, generic parser, FD: 28 captures
  2013-2016, 19 evaluated, 19 parsed, 8 groups, 2 stored, 5 rejected (Dec 2014 - Aug 2015: a
  recurring "two different rates for the same slab ... senior" pattern across several captures,
  naming tenures like "18 Months 8 Days to 18 Months 18 Days" -- this table structure looks like
  it has **two senior-citizen sub-columns** for different special/named tenures that both read as
  plain "senior"; would need the same kind of per-column investigation as the J&K fix, not done
  here for time).
- **Gap 2010-2013 and 2016-present**: not investigated. Known leads for later eras (found via
  discover, added as targets, not yet dry-run): `personal-banking/yes-individual/deposits/
  fixed-deposit-residents` (2016-2021, 18 captures) for FD; `savings.htm` (2005-2010) and
  `branch-banking/personal/savings-account.html` (2013-2016) and `personal-banking/
  yes-individual/savings-account` (2018-2023) for savings; `branch-banking/personal/
  recurring-deposits.html` (2013-2016) and `personal-banking/yes-individual/deposits/
  recurring-deposit` (2019-2023) for RD. None of these five targets were dry-run this session.

## IDFC FIRST Bank (`idfc-first-bank`) -- 0 cards; systematic finding, not a research gap

**Every single candidate page checked across the bank's entire life returns "no table"**, on both
domain generations:
- `idfcbank.com` (2015-2018, the original name from the bank's October 2015 launch):
  `personal-banking/personal-banking-fixed-deposit.html`, `personal-banking/fixed-deposit.html`,
  `personal-banking/savings-account/interest-rates.html`, `personal-banking/
  recurring-deposit-account.html` -- 6-8 captures each, every one "no table".
- `idfcfirstbank.com` (2019-2024, post Capital First merger): `accounts-and-deposits/
  fixed-deposit-business.html`, `banking-products/accounts/fixed-deposit.html`,
  `banking-products/accounts/rate-of-interest.html` (this one fails with "first column is not
  tenures" rather than "no table", so it does have *some* table, just not a tenure one -- possibly
  a disclosures/definitions table above the real rate widget), `banking-products/accounts/
  recurring-deposit-account.html`, `banking-products/accounts/sa-interest-rate.html`,
  `business-banking/accounts-and-deposits/fixed-deposit-business.html` -- 3-6 captures each, all
  effectively empty of tenure/rate tables.
- This strongly suggests IDFC (First) Bank has used a JavaScript-rendered rate widget (Adobe
  Experience Manager, given the `/content/dam/...` paths visible in the wider discover dump) for
  its *entire* public web history, not just the current site -- consistent with the Phase-1
  live-page survey's note that other large-bank AEM sites in this project are JS-rendered.
- **Leads not pursued**: `idfcfirstbank.com/interest-rate.html` (singular, 2019, 1 capture) and
  `content/dam/IDFCFirstBank/Interest-Rates/proposed-offer-rate.pdf` (2019) -- a PDF would need a
  PDF-extraction approach (like the SBI/HDFC scripts), not the wayback HTML pipeline; not tried in
  the time available. This PDF is the single most promising remaining lead for IDFC.

## Shared-code observations (not mine to fix -- reported per project rules)

1. **`collectors/src/parse/common.ts`'s `parseDate`** allows a comma between MONTH and YEAR
   ("December 1st, 2010" parses fine, via `([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})`) but *not* between
   DAY and MONTH ("1st, July 2007" fails, because `(\d{1,2})[\s-]+([a-z]{3,9})[\s,-]+(\d{4})`
   requires whitespace/dash, not a comma, right after the day). South Indian Bank's own earliest
   `interestRateDetails.aspx?irtID=1` captures (2007-2008) use exactly the DAY-comma-MONTH phrasing
   and so get `effectiveFrom: null` (confidence downgraded to "low") even though the source states
   a date -- correctly conservative (no guess), but avoidable with a one-character regex change.
2. **The same file's `parseAmountBand`** treats "above X to upto Y" (two numbers, a "to") and a
   lone "upto Y" inconsistently: the standalone case gets `max: Y+1` (inclusive), but the two-number
   "to upto Y" case does not get the `+1`, while a lone "above X" *does* get `min: X+1` (exclusive).
   Seen concretely on Karur Vysya Bank's own savings-slab text: "up to Rs.1 Lakh" -> `max: 100001`,
   but "above Rs.1 Lakh to up to Rs.10 Lakhs" -> `max: 1000000` and "above Rs.10Lakhs" ->
   `min: 1000001` -- leaving the exact value 10,00,000 in neither adjacent slab. Immaterial for
   real balances but worth knowing about if anyone relies on exact boundary arithmetic.
3. Sometime during this session, `generic-parse.ts`'s table-selection logic gained a heading-based
   heuristic (a candidate table is skipped with a message like `heading "..." looks like another
   product (score -3)` when the text immediately preceding the table suggests it's for a different
   account type, e.g. NRO) -- this is not something I added; noting it here only because a couple
   of this group's dry-run logs reference it and it visibly improved the ING Vysya Bank result
   (correctly rejecting an NRO table that an earlier run had apparently accepted).

## Archive budget notes

Sessions on 2026-09-27 saw heavy, sustained contention: at any given time, 5-10 other researcher
processes (psb-a/psb-b/pvt-a/sfb groups, plus the live collector) were hitting the same shared
1-req/3s limiter concurrently, so a single CDX call sometimes took several minutes to get a turn.
Budget spent on this pass, roughly: ~15 `discover` calls (one per domain: karnatakabank.com,
kvb.co.in, tmb.in, jkbank.com, nainitalbank.co.in, vysyabank.com, ingvysyabank.com, rblbank.com,
ratnakarbank.in, kotak.com, yesbank.in, idfcbank.com, idfcfirstbank.com, plus a re-check of
nainitalbank.co.in), ~35 `captures`/`cdx` calls, and several hundred snapshot fetches across ~50
targets that were dry-run or stored -- all now cached locally under `/agent/workspace/private/
wayback/`, so re-runs of anything above should be fast and free for whoever continues this work.
