# psb-a research log (Ledger, continued by Ledger2)

Group: SBI, Bank of Baroda, Bank of India, Bank of Maharashtra, Canara Bank, Central Bank of
India, and their merged predecessors (SBI associates, Bharatiya Mahila Bank, Dena Bank, Vijaya
Bank, Syndicate Bank, Imperial Bank / Presidency banks).

Staging root (Ledger): `/agent/workspace/private/history-staging/Ledger/`
Scratch (Ledger): `/agent/workspace/private/tmp/Ledger/`

Staging root (Ledger2): `/agent/workspace/private/history-staging/Ledger2/`
Scratch (Ledger2): `/agent/workspace/private/tmp/Ledger2/`

## Ledger2 pass -- summary of what changed

Continues from where Ledger left off (see that pass's notes below, unedited except for this new
top section and small in-place additions marked "Ledger2:" under each bank). Highlights, fullest
detail under each bank's own section:
- **Bank of India**: the "26 monthly captures 2012-2017" lead Ledger flagged turned out to be a
  near-empty redirect wrapper (only 2-3 real snapshots) once checked directly -- but the SAME
  domain has a much better, previously-unnoticed target: `bankofindia.co.in/Interestrate.aspx`
  (root path, 2008-2012, many distinct digests) turned out itself to be a navigation hub with no
  rate numbers, but its own nav links to the real table pages, `rupeetermdeposit.aspx` (fd/bulk,
  2009-2012) and `savingbank.aspx` (savings, 2009-2012). A custom parser for
  `rupeetermdeposit.aspx` is written and registered (see below); `savingbank.aspx` is logged as a
  lead only, not run (see "Tooling / process notes" below on why `run.ts` cannot emit savings
  cards at all).
- **Bank of Baroda**: `bankofbaroda.com/interest.asp` -- Ledger's own candidate list -- is a real,
  frequently-revised target across TWO distinct page layouts (2002 and mid-2003-on), both now
  covered by custom parsers and added to `targets/psb-a.json`.
- **Central Bank of India**: a union-association blog reproducing the bank's own Dec-2010 rate
  circular verbatim (citing the bank's own page as its source) yields five new dated press cards
  spanning Aug 2010 to Mar 2012 -- previously this bank had exactly one card (1999) in the whole
  dataset.
- **Dena Bank, Vijaya Bank**: first cards of any kind for both, via dated press (see their own
  sections below); web-archive domains not yet reached in this pass.
- **SBI**: two more dated press cards (2004-11-29, 2007-08-09) narrowing (not closing) the
  2004-2007 gap; the 2000-09 to 2003-01 and 2011-savings gaps are unchanged in this pass (not yet
  reached -- see "Leads not yet pursued" under SBI).
- **Shared-code churn observed, not touched**: `backfill/wayback/generic-parse.ts` and
  `collectors/src/parse/common.ts` were both being actively rewritten by another researcher
  during this pass (uncommitted changes seen mid-edit, including a substantial new
  product-aware table-scoring system and a generic amount-tiered-column reader in
  generic-parse.ts). One `psb-a.test.ts` run briefly saw two of Ledger's own pre-existing
  `sbi/2001-product-page` tests fail with a null `effectiveFrom`; re-running moments later (and
  again after finishing this pass) they pass consistently, confirming it was that other edit
  landing mid-file-write, not a real regression. See "Tooling / process notes" for detail.

Convention below: for each source, record URL, era covered, captures/pages actually read, and
cards produced (or why none were). "Gap" = looked, found nothing storable. "Lead" = found
something promising but not yet pursued (time/budget ran out first).

## SBI

### Web archive: statebankofindia.com/interest.htm (target `psb-a.json`, parser `sbi/1998-multi-section`)
- Wayback has **exactly one** snapshot of this exact URL, ever: `19981203055836`. No other
  timestamp exists for it (checked via `explore.ts captures ... 1996 2005`).
- This single page stacks 6 numbered rate tables (FCNR, NRNR, NRE, Resident+NRO, a one-line
  Savings rate, RFC) with no shared structure. The generic table reader would have silently
  mislabelled the NRE table's rates (10.50%/11.50%/8.00%) as domestic-resident FD rates, because
  it hardcodes `residency: "resident"` and stops at the first table it can parse (which is NRE,
  since it comes before Resident+NRO in document order). Wrote a custom parser
  `backfill/wayback/parsers/psb-a.ts` (`sbi/1998-multi-section`) that reads the page's own
  section headings to route each table correctly. Test: `backfill/tests/psb-a.test.ts`, fixture
  `backfill/fixtures/sbi/1998-12-03-interest.html` (trimmed copy of the real capture).
- Also had to add a small local date reader: this page prints "w.e.f. 01st May '98" (2-digit
  year) and `collectors/src/parse/common.ts`'s `findEffectiveDate`/`parseDate` only recognise
  4-digit years, so they return null here. That's shared code, out of my lane to change, so the
  parser has its own small `localEffectiveDate` fallback, scoped to this parser module only (it
  also covers a second date spelling needed below, "12th Sept. 2000").
- Cards produced (all `web_archive`, `observedFrom`/`observedTo` = 1998-12-03, `effectiveFrom`
  1998-05-01 since the page itself states "w.e.f. 01st May '98" and that's before the capture
  date):
  - `fd` (residency resident): 6 rows, 15 days -> 3 years+, 5.00% -> 11.50%.
  - `nro`: same 6 rows tagged residency nro (page explicitly says "RESIDENT AND NRO DEPOSITS"
    share one schedule).
  - `nre`: 3 rows (6mo-<1yr 8.00%, 1yr-<3yr 10.50%, 3yr+ 11.50%), w.e.f. 01 May '98.
- **Not parsed from this page** (see parser docstring for why): FCNR (4.50-6.50% by currency,
  w.e.f. 2 Nov '98) -- RateRow has no currency dimension. NRNR (11.00%/12.00%, w.e.f. 1 May '98)
  -- no matching Product value (scheme discontinued 2002). RFC -- no matching Product value and
  quoted in USD, not INR. Savings (4.5% p.a., w.e.f. 1 Nov 1994) -- deliberately not emitted: this
  matches the RBI-prescribed uniform savings rate already in
  `data/history/rbi/savings-rate-history.json` for that date (savings was still RBI-regulated
  until 25 Oct 2011), so a bank-specific card would just duplicate the system-wide series.
- **Gap**: no other SBI web capture exists between this Dec 1998 page and the bank's own 2008
  archive (`sbi-fd-archive.ts`, starting 2008-01-04). Tried `sbi.co.in` and `onlinesbi.com`
  discover too (see below) -- neither has a rate-table URL captured before ~2009-2013.

### Web archive discovery run (`explore.ts discover`, one CDX call per domain, capped at 500 URLs, oldest-first)
- `sbi.co.in`: no rate-page URL (matching interest/deposit/rate/fd/term/saving in the path) is
  captured before 2009 (`cmsuser/user.htm?action=rates`, 2009-08-17) — everything earlier is
  aboutus/corpbanking/contactus pages. `action=rates` is a dynamic query-string page; worth a
  `captures` pass later to see how many months of it survive and whether it actually renders a
  rate table server-side (query-string pages often 404 or serve the current-only page when
  replayed from the archive). **Lead, not yet pursued.**
- `statebankofindia.com`: aside from the 1998-12-03 `interest.htm` above, other early captures
  (2000-2001) are `nfdic*.htm`, `termdeposit.htm`/`.asp`, `savingsbankaccount.htm`/`.asp`,
  `recurrdeposits.htm`/`.asp`, `longtermfloating.asp`. These are real per-product rate pages from
  a 2000-2001 site redesign (SBI split `interest.htm` into per-product pages around then).
  `termdeposit.htm` and `recurrdeposits.htm` pursued (see below); `savingsbankaccount.htm`/`.asp`
  have a discovered URL but `captures` returns 0 HTTP-200 snapshots for either in 1999-2004 (the
  page may have 404'd or redirected at crawl time) -- not pursued further, and not a priority
  gap since SBI's own savings archive already covers this era (2000-04-01 onward). `.asp`
  variants of termdeposit/recurrdeposits and `longtermfloating.asp`, `nfdic*.htm` (NRI schemes):
  **leads, not yet pursued**.
- `onlinesbi.com`: nothing before 2006, and everything found is login/corporate-banking chrome,
  not a rate table. Not pursued further.

### Web archive: statebankofindia.com/statebank/sbinew/termdeposit.htm (target `psb-a.json`, parser `sbi/2001-product-page`)
- Wayback has **exactly one** snapshot, `20010215221957`. Clean single "Period | %p.a" table,
  headed "Effective from 12th Sept. 2000" -- the generic table reader reads the 6 rows correctly
  on its own, but `findEffectiveDate`/`parseDate` cannot read "12th Sept. 2000" (the period after
  the abbreviated month breaks the pattern that requires whitespace/comma/hyphen right after the
  month letters). Added to the same local `localEffectiveDate` fallback used for the 1998 page
  (now handles both the 2-digit-year and the abbreviated-month-with-period spellings). Card: `fd`,
  6 rows (15-45d 5.00% .. 3yr+ 10.00%), effectiveFrom 2000-09-12, observed 2001-02-15, confidence
  medium.
- **SBI RD**: the bank's own Recurring Deposit page from the *same capture*
  (`statebankofindia.com/statebank/sbinew/recurrdeposits.htm`, also captured only once, same
  day) is purely descriptive and states plainly: "earn interest on the whole amount at Term
  deposit rates" -- no separate RD rate table exists on that page. Per that explicit statement,
  the identical 6 rows from `termdeposit.htm` are also stored as SBI's `rd` card for
  2000-09-12/2001-02-15 (same target URL, `product: "rd"`, same parser) -- this is SBI's first
  RD card of any kind in the dataset, and it is a direct citation of the bank's own stated policy,
  not an inference.
- `personalbanking/termdeposit.asp` and `recurrdeposits.asp` (other candidate URLs from the same
  discover pass): 0 captures found in 1999-2004.

### Bank's own current-site archive (already loaded, not duplicated here)
- `sbi-fd-archive.ts` / `sbi-savings-archive.ts` already cover FD 2008-01-04..2025-07-15 (91
  cards) and savings 2000-04-01..2022-10-15 (9 cards) via SBI's own downloadable
  historical-rates files. See `backfill/README.md` for details -- not re-described here.

### Gap log (SBI)
- **FD**: web-archive/bank-archive/press coverage now runs 1998-05-01 -> 2000-09-12 -> (press)
  2003-01-13, 2003-05-05, 2003-11-10, 2004-01-01, 2007-12-17 -> 2008-01-04 onward (existing
  bank_archive). Remaining silent stretches: 1998-05 to 2000-09 (no source found), 2000-09 to
  2003-01 (no source found), 2004-01 to 2007-12 (no source found beyond the single dateless
  2002-10-30 Reuters mention already logged above).
- **Savings 2011-10-25 (RBI deregulation) to 2019-05-01 (existing bank_archive)**: not yet
  pursued via web archive. **Lead**: check `sbi.co.in`/`onlinesbi.com` savings-rate pages,
  captures 2011-2019.
- **RD**: one card now exists (2000-09-12, via the Term-Deposit-page citation above). Everything
  else -- 2000 to now, except whatever the live collector already has -- is a gap. **Lead**, not
  otherwise pursued.
- **Bulk (fd_bulk)**: no web-archive or press source pursued yet beyond the single live card.
  **Lead**, not started.

### Press (sourceType `press`, confidence `low`; each card cites one dated article)
See `backfill/psb-a-fd-press.ts` (script) for the exact cards. Sources used (all found via Exa
search, read in full via ExaContents, all give an explicit effective date and explicit rates):
- Rediff 2003-01-09 (SBI cuts rates for longer-end deposits, eff. 13 Jan 2003)
- Rediff 2003-04-30 (SBI cuts PLR and domestic deposit rates, eff. 5 May 2003)
- Rediff 2003-11-08 (SBI to cut deposit rates, eff. 10 Nov 2003)
- Rediff 2003-12-29 (SBI fixes BPLR, cuts term-deposit rate, eff. 1 Jan 2004)
- Times of India 2007-12-13 (SBI cuts deposit rates by 0.25%, eff. 17 Dec 2007) -- see caveat
  below, this article's own numbers are partly self-contradictory.
- Reuters/Rediff 2002-10-30 (SBI cuts deposit rates, eff. ~30 Oct 2002) -- only gives "up to 50
  bps cut, maximum was 7.5% before the cut", no full per-tenor table; used only as a gap-log
  entry, not a card (nothing specific enough to store as a row).

**Caveat on the 2007-12-13 ToI article**: its own text is internally inconsistent for the
1-year-plus buckets -- it says "most maturities cut 0.25% except one year to 549 days, where it
hiked by an identical amount", then separately states "term deposit in between one year-550 days
would come down to 8.5%" AND "One year-549 days fixed deposit rate would rise by 0.25% to
8.25%" for what reads like two different tenor buckets very close to each other (paraphrased
news copy, not a bank-published table). Only the unambiguous rows (15-45 days, 46-270 days, 271
days-1 year, and the retained 2-3yr/3-10yr rates) are stored; the 1yr-550/549-day rows are left
out and this ambiguity is noted on the card rather than guessed at.

### Leads not yet pursued (SBI)
- Parliament (Lok Sabha/Rajya Sabha) questions tabulating SBI-specific deposit rates,
  year-by-year -- searched via Exa, found only PSB-wide deposit/account totals (no rate figures)
  and a Rural Co-op Bank rate question; no SBI-specific rate table found yet in the time
  available. Worth another pass with different search terms (e.g. sansad.in full-text search for
  "State Bank of India" + "rate of interest" + a specific year).
- RBI Bulletin / Annual Report "Structure of Interest Rates" table (Table 74/64/59 depending on
  edition) gives a **range** for "5 major public sector banks" combined, not SBI alone --
  deliberately NOT used as SBI-specific evidence (can't attribute a range across 5 banks to SBI
  specifically). Confirmed this is the same series already excluded by the RBI history dataset's
  own gap notes (`data/history/rbi/regulated-term-deposit-rates.json`, "gapsAndCaveats").
- RD and bulk-deposit history: not started.
- SBI legacy domains not yet explored: `sbi.bank.in`'s predecessor `sbi.co.in`
  `cmsuser/user.htm?action=rates` page (2009-2013 era, dynamic URL) -- see above.

### Ledger2: two more press cards, narrowing (not closing) the 2004-2007 gap
- Rediff, 27 Nov 2004, "SBI hikes home loan rates": buried in a home-loan-rate story, the article
  states SBI "raised interest rates on domestic term deposits by 0.25 to 0.50 per cent across
  various maturities effective from November 29", introduced a NEW 7-14 day bucket at 3.00% and a
  NEW 5-years-and-above bucket at 6.25% (explicitly "to raise long term funds"), and gives 15-45
  days (4.00%), 46-179 days (4.50%) and 180 days-<1yr (5.00%). The article states 1-3yr rates were
  "raised by 0.50 per cent" but does not print the resulting number, so that row is not stored.
  Card: `fd`, effectiveFrom 2004-11-29, 5 rows.
- Oneindia (UNI), 6 Aug 2007, "SBI hikes deposit rates for maturity of 3 to 10 years": full
  dated revision, effective 9 Aug 2007 -- 1yr-<2yr cut to 8.00% (from 8.25%), 2yr-<3yr unchanged
  at 8.25% (printed as such, not inferred), 3-10yr raised to 8.50% (from 8.25%), plus two named
  schemes: "Super Saver Term Deposit" (4-5yr) and "SBI Smart Deposit" (550 days), both cut to
  9.25%. Card: `fd`, effectiveFrom 2007-08-09, 5 rows (3 general-tenor + 2 named-scheme rows).
  Sits about 4 months before the already-stored 2007-12-17 card.
- Both stored via `backfill/psb-a-fd-press-ledger2.ts` (a new file; Ledger's own
  `psb-a-fd-press.ts` is not edited).
- **Still open**: 2000-09 to 2003-01 and most of 2004-2007 remain silent for SBI FD; the
  2011-10-25 (RBI savings deregulation) to 2019-05-01 SBI savings gap is unchanged; RD and
  fd_bulk web-archive/press passes not started. None of these were reached in this pass --
  archive-side effort this pass went to Bank of India/Bank of Baroda per the brief's priority
  order, and Exa search effort went to Central Bank of India/Dena/Vijaya, which had far less
  existing coverage to start from. All are still valid leads for a future pass.

## Bank of Baroda

### Press (sourceType `press`, confidence `low`)
See `backfill/psb-a-fd-press.ts`. Sources (Exa search + ExaContents full read):
- Business Standard 2002-07-24 (published; "Boi, Bob Cut Deposit Rates", eff. 23 Jul 2002)
- Times of India 2003-03-04 (BoB cuts deposit rates 0.25-0.75%, eff. 10 Mar 2003) -- explicit
  amount band (up to Rs 15 lakh vs above Rs 15 lakh, +0.25%).
- Rediff 2003-05-05 ("Bank of Baroda to cut lending rate by 25 bps") -- gives only 2 of the
  domestic-deposit tenors (15-45 days, 3yr+); no explicit effective date stated for the deposit
  side specifically (the lending-rate cut is dated 1 Jun 2003; the deposit-rate change is
  described as happening at the same time but the article doesn't repeat a date for it) --
  **not stored as a card**, logged as a gap/lead only, since the rule is no rate without a date
  the source itself gives.
- Rediff 2004-11-11 (More banks hike deposit rates -- BoB, eff. 16 Nov 2004): full 8-row table
  up to Rs 15 lakh.
- Rediff 2005-04-02 (BoB hikes NRE deposit rates, eff. 4 Apr 2005) -- NRE product; **not
  pursued** (lower priority than domestic fd/savings/rd/bulk per the brief); logged as a lead.

### Web archive
- `bankofbaroda.com` discover (2002 on): `interest.asp` (2002-02-04), `personal/fixed_deposit.asp`,
  `business/bus_fixed_deposit.asp`, `corporate/corporate_corfin_dep_fd.asp`,
  `personal/savingsbankdeposit.asp`, `international/int_dep_timedep_fd.asp` (NRE FD),
  `international/int_dep_saving_nre.asp`/`_nro.asp` -- all 2002 candidates. **Not yet run** through
  `run.ts` (budget spent on SBI first, per priority). `bankofbaroda.in` discover returned only
  e-auction/legal-notice PDFs in the sampled window, nothing rate-related -- not pursued further.

### Gap log / leads
- FD before 2002-07 and 2004-11 (i.e. 1997-2002, 2002-2004, 2005-2007): only the press dates
  above found so far; web-archive candidates above not yet run.
- Savings, RD, bulk: not started.

### Ledger2: web archive -- `bankofbaroda.com/interest.asp` run, two eras/parsers, 4 years covered
Ledger's own candidate list already named this URL; running it turned up TWO successive page
layouts needing two separate custom parsers (both in `backfill/wayback/parsers/psb-a.ts`, keys
`bank-of-baroda/2002-interest-asp` and `bank-of-baroda/2003-yield-table`; fixtures/tests under
those same names in `backfill/fixtures/bank-of-baroda/` and `backfill/tests/psb-a.test.ts`):
- **2002 layout** (`interest.asp`, captures 2002-02-04 to 2002-10-12 read this way -- see below):
  one "DOMESTIC TERM DEPOSITS, NON-RESIDENT (ORDINARY) AND NON-RESIDENT SPECIAL RUPEE(NRSR)
  DEPOSITS" table with a bare leading "Sr.No" column (not the tenure -- the generic reader
  hardcodes column 0 as the tenure column and would reject this table outright, "first column is
  not tenures") and two amount-banded rate columns ("Less than Rs. 15 lacs" / "Rs. 15 lacs to less
  than Rs. 1 crore"). The heading states the schedule covers domestic AND non-resident-ordinary
  deposits together, so identical rows are stored for both `fd` and `nro`. A one-line "SAVINGS
  ACCOUNT INTEREST RATE (% p.a.) 4.00" elsewhere on the same page duplicates the RBI-prescribed
  uniform savings rate for this era and is deliberately not stored (same reasoning as SBI's 1998
  page). FCNR (currency-denominated) and NRNR (no Product value) are not parsed; NRE (amount-
  banded, "Less than Rs. 1 crore" / "Rs. 1 crore & above") is a ready lead for a future pass, not
  pursued here (lower priority than fd/savings/rd/bulk per the brief).
- **2003+ layout** (same URL, `Domestic Term & NRO Deposits(Effective from ...)` heading):
  restyled without the Sr.No column, the upper amount-band boundary moved from 1 crore to 5
  crore (read from the header text itself, not assumed -- and worth re-checking on later
  captures, since nothing here guarantees it stays 5 crore indefinitely), and each amount band
  gained a derived "Annualised Yield" column that RateRow cannot represent (read and dropped,
  same treatment as `state-bank-of-patiala/2003-portal`).
- **A real bug found and fixed along the way, worked around locally, not in shared code**: the
  2002-era table gained a third, open-ended "Rs. 5 crore & above" amount band at some point
  within its own era (present by 2002-10-12; not yet present on 2002-02-04), and that capture's
  header cells print a per-band effective date *inside* the same cell as the amount, e.g. "For
  amount Less than Rs. 15 lacs(w.e.f. 16.09.2002)". `parseAmountBand`
  (`collectors/src/parse/amount.ts`, shared, out of this lane) always takes the first two numbers
  it finds anywhere in the header text for its "a to b" reading, with no idea that a
  parenthesised note isn't part of the amount phrase -- so it read the date's "16.09" as if it
  were a second rupee figure, producing a nonsense band. `validateCard` correctly rejected the
  resulting card ("invalid amount band 1500000–16.09" etc.) so no wrong data reached storage, but
  the capture's real numbers were lost. Worked around with a local `stripDateParentheticals`
  helper in `psb-a.ts` (strips only a parenthetical that itself contains "w.e.f"/"effective" or a
  date-shaped run of digits -- a blanket "drop anything in parentheses", which is what
  `parseTenure` already does for tenure labels, is too aggressive here: the *later* 2003+ layout
  wraps its *entire* band phrase in one pair of parentheses, e.g. "(For less than Rs. 15 lacs)",
  which a blanket strip would delete outright -- confirmed by a regression test that checks both
  shapes). The open-ended band is stored as `fd_bulk` (a third target added for it).
- **Second real bug found and fixed: two targets sharing one URL for the same product clobber
  each other.** Originally this was two separate targets (`bank-of-baroda/2002-interest-asp` and
  `bank-of-baroda/2003-yield-table`) both pointed at the same `interest.asp` URL for `fd`/`nro`.
  `collectors/src/store.ts`'s `replaceArchiveCards` (shared, out of this lane) identifies "this
  target's earlier archive cards to replace" purely by `(bankSlug, product, sourceUrl)`, with no
  notion of which parser produced them -- so running the 2002 target and then the 2003+ target
  (file order) left ONLY the second one's 4 cards; the first one's 3 cards, stored moments
  earlier by the exact same command, were silently gone. **This is a general trap, not specific
  to this pass or this bank**: any group with a page whose layout changed over time at a fixed
  URL, read by two different custom parsers as two different targets, will hit the same silent
  data loss on every re-run. Fixed here by adding one combined wrapper parser,
  `bank-of-baroda/interest-asp` (tries the 2002 shape, falls back to the 2003+ shape), and
  pointing the actual `fd`/`nro`/`fd_bulk` targets at that single key instead -- the two original
  parsers stay individually registered under their own keys too, for their own unit tests. See
  also "Tooling / process notes" below.
- **Confirmed final result** (`npx tsx backfill/wayback/run.ts --group psb-a --bank
  bank-of-baroda --out <staging>`, all 3 targets, real run not dry-run): **7 `fd` cards + 7 `nro`
  cards, 2002-02-04 -> 2004-11-11** (effectiveFrom dates: 2002-02-04, 2002-04-01, 2002-09-16,
  2003-06-09, 2003-11-24, 2003-12-08, 2004-06-14), plus **1 `fd_bulk` card, 2002-09-16**. Every
  capture from 2005-08 onward (through the range's own end, 2006-12/2007) reports "table not
  found" under *both* sub-parsers -- a further, unread THIRD layout change, not investigated
  this pass (see gap/lead note below).
- Not investigated this pass: the THIRD layout the page evidently moves to by 2005-08 (still
  30-plus monthly captures unread, 2005-08 through however far the page's archive history runs
  past 2007), and Ledger's other 2002 BoB candidates (`personal/fixed_deposit.asp`,
  `personal/savingsbankdeposit.asp` -- both have their own monthly-capture runs 2002-2004,
  captures fetched via `explore.ts captures` in this pass but not yet read/parsed).

## Bank of India

### Press
See `backfill/psb-a-fd-press.ts`. Sources:
- Business Standard 2002-07-24 (same article as BoB above; BoI's own numbers, eff. 1 Aug 2002).
- Rediff 2004-11-11 (same article as BoB above; BoI's own numbers, eff. "from Wednesday" =
  10 Nov 2004 -- the article is dated 11 Nov 2004 and says the BoI hike took effect "from
  Wednesday"; 10 Nov 2004 was a Wednesday, so that date is used, sourced from the article text
  itself, not inferred from the calendar) -- 7-row table.
- Financial Express 2007-08-01 (BoI/Canara/Syndicate cut interest on deposits, eff. 1 Aug 2007) --
  only the 1-year bucket (9% from 9.5%) is given for BoI specifically.

### Web archive
- `bankofindia.co.in` discover found strong candidates: `cardrate/ListcardRate.aspx` (2008-09-20),
  `depositservice.aspx`/`1`/`2`/`mar` (2008-2011), `boisavings.aspx` (2009-09-23, savings),
  `depositsch.aspx`/`1`/`2`/`3` (2009-2010), `cardrate/Interestrate.aspx` (2011-10-15), and
  crucially `boi_tz/english/interestrate.aspx` with **26 captures spanning 2012-09-13 to
  2017-10-20** (via the `browser.htm?aspxerrorpath=...` redirect wrapper CDX records it under --
  the real captured URL needs confirming with a `captures` call before using it as a target).
  **Not yet run** -- high-value lead for FD/savings 2008-2017, next priority after finishing the
  press pass for all 6 banks.

### Gap log / leads
- Same as Bank of Baroda: web-archive candidates identified, not yet run through `run.ts`.
  This is the single best remaining lead in the whole group (26 monthly captures of one URL).

### Ledger2: the "26 captures" lead re-checked -- it was mostly the redirect wrapper, but its
### real neighbour URL (`Interestrate.aspx`, then `rupeetermdeposit.aspx`) is much better
Checking `boi_tz/english/interestrate.aspx` directly (a plain CDX query, not `discover`, since
the URL was already known): the exact URL 302-redirects every time it's crawled, and its
`browser.htm?aspxerrorpath=...` wrapper (where the real rendered content actually lands) has
only **2 real captures with content**, 2017-01-28 and 2017-10-20 (plus one more via a same-content,
differently-spelled wrapper path on 2017-04-06) -- not the "26 monthly" Ledger's earlier pass
inferred; that count likely came from a broader keyword match that also swept in unrelated
images/redirects. **These 2-3 captures are still a valid, if thin, 2017 lead** -- not pursued
further this pass in favour of a much better one found on the same domain:
- `bankofindia.co.in/Interestrate.aspx` (root path, no `boi_tz` prefix) has **15 monthly
  captures 2008-09-15 to 2012-08-14 with 8+ distinct digests** -- real rate changes throughout.
  Fetching it, though, showed it is itself a navigation *hub* (a left-nav of links: "Saving Bank
  Deposit Rate" -> `savingbank.aspx`, "Rupee Term Deposit Rate" -> `rupeetermdeposit.aspx", "NRI
  Deposit Rate" -> `nritermdeposit.aspx`), not a rate table -- same dead-end pattern as Bank of
  Maharashtra's `deposit_prod.asp` (see that bank's section). The two real pages it links to:
  - **`rupeetermdeposit.aspx`** (7 captures, 2009-04-13 to 2012-03-15, all distinct digests):
    one domestic-deposit table with **three** amount bands (<15 lacs / 15 lacs-<1 crore / >=1
    crore) -- like state-bank-of-patiala/2003-portal and bank-of-baroda's parsers, this needs a
    custom parser (RateRow can't hold 3 bands from one generic-reader pass). Several captures
    additionally split each band into "(Existing) w.e.f. <old date>" / "Revised w.e.f. <new
    date>" sub-columns (the page shows the just-superseded rate alongside the new one); only the
    "Revised" sub-column is read, dated from that same cell's own printed date -- **not** from
    the page's separate news-ticker blurb elsewhere on the page, which can (and in the one capture
    checked by hand, does) carry a different, not-yet-tabulated date. Custom parser
    `bank-of-india/2009-rupeetermdeposit` in `backfill/wayback/parsers/psb-a.ts`, fixture/tests
    under the same name. The <15-lacs and 15-lacs-<1-crore bands are stored as `fd`; the >=1-crore
    band as `fd_bulk`.
  - **`savingbank.aspx`** (6 captures, 2009-09-23 to 2012-06-08): **not run** -- like every other
    group's savings-web-archive leads (see `psb-b.json`'s own documented example), `run.ts`'s
    `GenericResult`/card-building pipeline has no way to emit `savingsSlabs` (it is rows-only),
    so a savings card needs a bespoke fetch-and-store script instead, not a `run.ts` target. Only
    the 3 captures from 2012-03-15 onward would even be bank-specific-worthy (savings was still
    RBI-regulated before 25 Oct 2011) -- modest value for the bespoke-script effort it would
    take; logged as a lead, not built this pass.
- **Confirmed final result** (`npx tsx backfill/wayback/run.ts --group psb-a --bank
  bank-of-india --out <staging>`, real run not dry-run): **2 `fd` cards + 2 `fd_bulk` cards,
  2009-01-19 -> 2010-02-10** (effectiveFrom dates read from each capture's own "Revised w.e.f."
  cell, not the capture date itself -- the 2009-04-13 capture's rates were actually already in
  force from 2009-01-19). By late 2011 the table's own shape changes again (checked by hand on
  the 2011-10-06 capture): the domestic table splits into TWO tables by tenure range (a short-
  tenor one keeping the "(Existing)/Revised" split but with the upper amount band's own boundary
  changed AGAIN, this time to "Rs.1 crore and above but less than Rs.10 crore" rather than
  open-ended, and a separate longer-tenor table reverting to the older two-band "Annualised
  Rate of Return" style) -- **not pursued further this pass**; a third custom parser variant
  would be needed to reach 2011-2012, logged as a lead rather than attempted, given the group's
  remaining time budget.
- Other candidates Ledger listed (`cardrate/ListcardRate.aspx`, `depositservice.aspx` variants,
  `boisavings.aspx`, `depositsch.aspx` variants, `cardrate/Interestrate.aspx`) not re-checked
  this pass -- `rupeetermdeposit.aspx`/`savingbank.aspx` look like the more central, longer-lived
  pages (linked directly from the bank's own top-level `Interestrate.aspx` hub), so they were
  prioritised first.

## Canara Bank

### Press
See `backfill/psb-a-fd-press.ts`. Sources:
- Rediff 2003-01-21 ("Canara Bank uncorks bounty") -- states only "lowered interest rates on
  domestic term deposits for the period of one year and above by 0.25%, effective from 13
  January 2003"; no absolute rate given, only the change. **Not stored as a normal card**
  (nothing to put in a `rate` field without inventing an absolute number) -- logged as a gap.
- Financial Express 2007-08-01 (BoI/Canara/Syndicate, eff. 1 Aug 2007) -- Canara Centenary
  Deposit Scheme (a named scheme, not the plain card rate), 1-year: 9% (from 9.5%).
- Business Standard 2013-12-03 (Canara Bank cuts term deposit rates) -- this is `fd_bulk`
  (deposits of Rs 1 crore and above), not `fd`: 61-90d 7.75% (from 8.75%), 91-120d 8.50% (from
  9%), 121-179d 8.75% (from 9%), 1yr-<2yr 9% (from 9.10%); +0.50% senior citizen stated
  separately without a number, so senior rows are not fabricated.

### Web archive
- `canarabank.com` discover (500 cap) returned candidates **only from 2016 onward**
  (`english/bank-services/personal-banking/savings-deposits/fixed-deposit`,
  `.../corporate-banking/accounts-deposits/fixed-deposits`, `.../recurring-deposits`) even though
  Canara Bank has had a web presence far earlier -- the domain's earlier pages evidently didn't
  use these interest/deposit/fd/rate keywords in their URLs (frame-based or numeric CGI paths are
  common for late-1990s/2000s Indian bank sites). **Lead**: try a keyword-free `discover` or a
  `cdx` query directly on `canarabank.com/*` without the URL-keyword filter, and check for a
  `canarabank.co.in` or other legacy domain, before concluding there is no earlier Canara capture.

### Gap log / leads
- FD 1997-2003, 2003-2007, 2007-2013: only the single 2003-01-21 press mention (no absolute
  rate) and the 2007-08-01 scheme rate found so far.
- Savings, RD: not started. Bulk: one 2013 card above; earlier bulk history not pursued.

### Ledger2: keyword-free `canarabank.com` sample -- found a promising lead, not yet fetched
Ran a plain `cdx` query on `canarabank.com/*` (no interest/deposit/rate keyword filter,
`collapse=urlkey`, capped at 400 rows -- CDX's own sort order is roughly alphabetical by path, so
400 rows only reaches as far as `English/scripts/B*`; a full survey would need a much higher cap
or several keyword-scoped passes). Two findings:
- The domain's only capture before 2003 is the bare root page (`canarabank.com/`, 1999-10-08);
  everything else in 2003-2004 is SEO-spam/typosquat-era junk (`?term=casinos`,
  `?term=car+financing`, etc. -- not the bank's real site at that time) or gambling-site clutter
  (`7Sultans_Casino.html`) -- consistent with Ledger's own note that the domain may not have been
  under the bank's control, or was parked, before its real 2006+ content shows up.
- **`canarabank.com/English/downloads/FD-KD-RD-NNND-CARD.htm`** -- the filename alone ("FD-KD-RD"
  = Fixed/Kisan/Recurring Deposit, "CARD" being this project's own term for a rate table) is a
  strong candidate this project's own `discoverRateUrls` keyword filter would have caught had the
  filename been lowercase (the filter regex is applied to the raw CDX `original` field, and this
  URL's "FD"/"RD" are uppercase -- worth flagging as a possible reason other useful uppercase-
  cased URLs across ANY bank/group could be silently missed by `discover`, though fixing the
  shared `discoverRateUrls` filter itself is out of this group's lane). It has **20 monthly
  captures, 2008-01-01 to 2012-10-29 -- but every single one shares the exact same content
  digest.** That is a red flag, not a good sign: either the page is a static definitions/FAQ page
  that was never live-updated (most likely, given the name pattered after other Canara
  `*.htm` -Application-form-style static downloads seen in the same directory), or it is a
  one-time archived brochure. **Not fetched/read in this pass** (would cost one more archive
  request under heavy contention at the time) -- worth a quick `fetch` before writing it off
  entirely, but the single-digest-across-5-years signal makes it a low-probability lead.
- Not attempted: a `canarabank.co.in` legacy-domain check, or keyword-scoped passes deeper into
  the alphabet (`C` onward) than this one 400-row sample reached.

## Central Bank of India

### Press
See `backfill/psb-a-fd-press.ts`. Source:
- Rediff 1999-01-14 ("Central Bank of India revises term deposit rates", eff. 18 Jan 1999) --
  **full 8-row table**: 15-29d 5%, 30-60d 6%, 61-90d 7%, 91-179d 8%, 180d-1yr 9%, 1-2yr 10%,
  2-3yr 10.5%, 3yr+ 11.5%. Explicitly states no change to the additional-interest rate on single
  large deposits of Rs 15 lakh and above. This is the earliest bank-specific *domestic* deposit
  rate found anywhere in this pass for any bank in the group (predates even SBI's 1998 archive
  capture's own numbers by not much, but is a full clean table with an explicit date).

### Web archive
- `centralbankofindia.co.in` discover: the background CDX call returned **no matches** for the
  interest/deposit/rate/fd/term/saving keyword filter in the time checked (queue was heavily
  contended by other researchers' parallel jobs at the time). **Not conclusively empty** -- retry
  with a longer/less contended window before concluding there's nothing.

### Gap log / leads
- Everything except the single 1999-01-14 press card is a gap: FD 1997-1999, 1999-2026 (no other
  source at all yet, including no live/current card in data/rates for this bank in this pass --
  confirm with the live collector's own coverage before treating pre-1999 as unrecoverable).
  Savings, RD, bulk: not started.

### Ledger2: five more press cards (Aug 2010 - Mar 2012), all sourced from one union blog
Found via Exa search (not the retried `centralbankofindia.co.in` discover above, which was not
re-attempted this pass -- still an open lead). Source: Central Bank Officers' Association
(Andhra Pradesh) blog, `cboaapunit.blogspot.com`, posted 1 Dec 2010, reproducing the bank's own
w.e.f. 09.12.2010 rate circular **verbatim as a table**, explicitly citing the bank's own page as
its source (`centralbankofindia.co.in/site/Interest.aspx` -- printed on the blog post itself,
not independently confirmed via the Internet Archive in this pass, see below). Stored as
`sourceType: "press"` / `confidence: "low"` like every other press card in this project (it is a
secondary re-print, not the bank's own site), via `backfill/psb-a-fd-press-ledger2.ts`:
- `fd_bulk` (>= Rs 1 crore), effectiveFrom 2010-08-09: the circular's own "Existing ... w.e.f
  09.08.10" column for the bulk schedule (unchanged by the Dec revision, which only touched the
  below-1-crore schedule) -- full 11-row table, 7 days to 7-years-and-above.
- `fd` (< Rs 1 crore), effectiveFrom 2010-11-08: the circular's "Existing ... w.e.f 08.11.2010"
  column -- full 11-row table, i.e. the schedule immediately before the Dec revision.
- `fd` (< Rs 1 crore), effectiveFrom 2010-12-09: the circular's "Revised ... w.e.f 09.12.2010"
  column -- the revision itself, full 11-row table, plus a named "Cent Super Plus" 555-day
  scheme row (8.55%, up from an undated-but-mentioned 8.00% -- only the dated figure is stored).
- `fd` (partial, 4 rows), effectiveFrom 2011-04-01: Economic Times (PTI), 4 Apr 2011, "Central
  Bank of India slashes fixed deposit rates by up to 1%" -- cuts on 91-179d, 180-364d (merged
  bucket, differs from the Dec-2010 circular's 180-269/270-364 split -- stored as printed, not
  reconciled), 1yr-<2yr, and the Cent Super Plus scheme (9.25%, from 9.6%). The article notes the
  bank "had last raised fixed deposit rates in the first week of March" 2011, so this card and
  the Dec-2010 one are NOT adjacent revisions of each other -- Jan-Mar 2011 is a real gap.
- `fd` (partial, 3 rows, short end only), effectiveFrom 2012-03-12: The Hindu Business Line, "Central
  Bank of India hikes short-term rates" -- a sharp short-end-only hike (7-14d/15-45d/46-90d all
  to 9%, from 2.5%/5%/5.25%) amid a system-wide liquidity crunch.
- **Lead, not pursued**: `centralbankofindia.co.in/site/Interest.aspx` (the bank's own page cited
  by the blog above) would upgrade these from press/low to web_archive/medium if the Internet
  Archive holds captures of it -- not checked in this pass (the earlier `discover` attempt on
  this domain, logged above, returned nothing but was flagged as possibly under-searched due to
  contention; worth a direct `captures` call on this specific path rather than a fresh keyword
  `discover`).
- **Still a near-total gap**: 1999-01 to 2010-08 (11+ years) and 2012-03 onward until the live
  collector's own coverage begins. Savings, RD not started.

## Bank of Maharashtra

### Press
See `backfill/psb-a-fd-press.ts`. Source:
- NDTV 2010-12-16 ("Bank of Maharashtra hikes interest rates", eff. 15 Dec 2010): 46-90d 5.00%,
  181-270d 7.25%, over 5yr-10yr 8.00% (up 50bps from 7.50%, stated explicitly). The article also
  gives a single 8.30% rate for "over 1 year to 5 years" -- unusually coarse bucketing for a
  retail FD card (see SUSPICIOUS SOURCE DATA note on the card itself); stored as printed, not
  split into finer buckets.

### Web archive
- `bankofmaharashtra.in` discover: `deposit_prod.asp` (2006-04-19), `deposit.asp` (2008-09-22),
  a Marathi-language `bom_marathi/intrest_rate_chart_domestic.asp` (2009-02-14, misspelling
  "intrest" is the bank's own URL, not a typo introduced here). **Lead, not yet run.** No English
  equivalent of the Marathi rate-chart URL found yet in the sampled window -- worth a dedicated
  `discover` pass without the Marathi-path bias, or a `captures` check directly on `deposit.asp`.

### Gap log / leads
- Everything except the one 2010-12-15 press card is a gap. The web-archive leads above are not
  yet run through `run.ts`.

### Ledger2: `deposit_prod.asp` checked and found to be a dead end (not a rate table)
Fetched the earliest capture (2006-04-19). It is a scheme-*description* page (features,
eligibility, minimum amounts for "Mahabank Yuva Yojana", "Fixed Deposit Scheme (FDR)",
"Recurring Deposit Scheme", etc., each linked from an in-page nav as a same-page anchor
`deposit_prod.asp#N`), not a rate table -- the whole page's text contains exactly two "%" figures
and neither is a deposit rate (one is a 1% loan-processing-fee waiver, the other a 75%
withdrawal-limit feature description). **Not pursued further under this URL.** `deposit.asp`
(2008-09-22 onward, a different, later URL Ledger also found) was not checked this pass --
worth trying next, since a bank splitting scheme-*descriptions* onto one URL and moving actual
*rates* to a differently-named page is a common pattern (matches how SBI itself split
`interest.htm` into per-product pages around 2000-2001, per that bank's own section above).

## Predecessors (SBI associates, Bharatiya Mahila Bank, Dena Bank, Vijaya Bank, Syndicate Bank,
## Imperial Bank / Presidency banks)

- **Syndicate Bank**: one press card from the Financial Express 2007-08-01 article (400-499
  days: 8.9% from 9.5%; 500 days-<2yr: 9% from 9.6%, both eff. 1 Aug 2007) -- see
  `backfill/psb-a-fd-press.ts` (stored under bankSlug `syndicate-bank`, kept in the same
  script as Canara/BoI since all three rates come from one article).
- **Dena Bank, Vijaya Bank** (Ledger2): Ledger found no dated source with an explicit rate for
  either (the dsij.in 2013-10-29 comparison table remains correctly unused, per the brief's rule
  against aggregator-style round-ups). This pass found real newspaper/wire-service coverage for
  both via Exa search, giving each its **first card of any kind** in this dataset, stored via
  `backfill/psb-a-fd-press-ledger2.ts`:
  - **Dena Bank** `fd`: Zee News (Bureau), 2 Jun 2003, "Dena Bank to cut interest rate on
    domestic deposits by 0.25 pc" -- 91-179d 5.25%, 180d-<1yr 5.50%, 1yr-<3yr 6.00%, 3yr+ 6.25%,
    explicitly no change to other buckets, eff. 5 Jun 2003 (4 rows). The Hindu Business Line,
    24 Dec 2012, "Dena Bank hikes term deposit rates by 35 bps on 1-2 yr tenor" -- 1yr-<2yr 9.10%
    (from 8.75%), eff. 22 Dec 2012 (1 row). Business Standard (PTI), 21 Nov 2016, "Dena Bank cuts
    deposit rates by up to 50 basis points" -- 180-270d 6.50% (from 7.00%), 271d-<2yr 7.00%
    (from 7.25%), eff. 21 Nov 2016 (2 rows).
  - **Vijaya Bank** `fd`: The Hindu Business Line, 3 Apr 2012, "Vijaya Bank hikes domestic, NRE
    term deposit rates" -- below Rs 5 crore, 180d-<1yr 8.50%, 1yr-<2yr 9.60%, 2yr-<3yr 9.50%,
    3yr-<5yr 9.30%, 5yr+ 9.25%, eff. 1 Apr 2012 (5 rows; the article states the four 1yr+ rates
    apply equally to NRE deposits, an unused but ready lead). The Hindu, 18 Oct 2014, "Vijaya
    Bank to cut interest on special term deposit scheme" -- named "Vijaya 444" scheme (444-day),
    9.05% (from 9.15%), eff. 20 Oct 2014 (1 row). Business Standard/Moneycontrol (PTI),
    12 Apr 2016, "Vijaya Bank cuts term deposit interest rates by 25 bps" -- only the 1-year
    tenor's resulting number is printed (7.50%, from 7.75%), eff. 12 Apr 2016 (1 row); the
    article's own "different slabs from 91 days to above five years" phrasing is not turned into
    other rows since no other resulting number is printed.
  - **Not pursued this pass**: `denabank.com`/`vijayabank.com` web-archive `discover` (still a
    lead -- a genuine archive capture of either bank's own page would be stronger evidence than
    press, and might reach further back than 2003).
- **State Bank of Mysore** (target `psb-a.json`, bankSlug `state-bank-of-mysore`, no custom
  parser needed): `mysorebank.com/int_rates.htm` has 8 monthly captures 2003-10-27..2004-12-12
  with several distinct digests. Page's "Interest Rates on Domestic Term Deposits" table is a
  clean 2-column "Period of Deposit | Rate of Interest (%)" layout with an explicit
  `(wef DD/MM/YYYY)` date the generic reader parses natively -- no custom parser needed. First
  capture read by hand: `(wef 01/10/2003)`, 7-14d 3.50% (footnoted "* Minimum deposit amount of
  Rs.15.00 lacs" -- i.e. that tenor is bulk-only; not specially encoded, since the generic reader
  stores it at the default amountMin 0/amountMax null like every other row on this page, which is
  the honest reading given the generic reader has no way to apply a per-row amount override --
  flagged here rather than hand-fixed), 15-29d 4.00%, 30-45d 4.00%, 46-90d 4.50%, 91-179d 4.75%,
  180-360d 5.00%, 1yr-<2yr 5.50%, 2yr-<3yr 5.75%, 3yr+ 6.00%.
  **SUSPICIOUS SOURCE DATA on the same page, not stored**: a further "NRE Term / Reinvestment
  Deposit account" table on the same page (wef 20/10/2003) prints 1.50%/2.10%/2.70% for
  1-2yr/2-3yr/3yr -- far below the domestic rates on the very same page (5.50%/5.75%/6.00%) and
  below what NRE rupee deposits should plausibly earn in 2003; this looks like a bank-side
  transcription error on the page itself (e.g. FCNR-style dollar rates pasted into the wrong
  table) but is reported, not corrected, and not stored as an `nre` card.
  **Result of running the target**: 3 cards stored (2003-10-20, 2003-12-15, 2004-12-01, all
  9 rows, observed spans 2003-10-27 to 2005-04-04). A 4th group (the revision printed on captures
  2005-08-30 and 2005-10-30, `wef 20/12/2004`) was **rejected by validation** -- see "Shared-code
  finding" below; this is a real gap, not a choice.
  - **Shared-code finding (not fixed, out of this group's lane -- `collectors/src/parse/tenure.ts`):**
    by the Aug/Oct 2005 captures, the page had split its old "3 years & above" bucket into "3
    years & above less than 5 years" (6.00%) and "5 years & above" (6.25%). `parseTenure` misreads
    "3 years & above less than 5 years": it treats the whole phrase as one *open-ended* lower
    bound (matching on "and above" after `&`→`and`), so it never notices the trailing "less than
    5 years" upper bound, and separately mis-sums the two numbers it finds ("3 years" + "5 years")
    into a single nonsense point value (2920 days) via the compound-duration path meant for
    phrases like "1 year 1 day". The resulting row (~2920-3650 days) overlaps the correctly-read
    "5 years & above" row (1825-3650 days), and `validateCard` correctly rejects the card for
    "two different rates for the same slab" rather than storing the bad range -- so no wrong data
    reached storage, but a genuine Dec-2004 rate revision is left unstored as a result. Reported
    here per the task brief's instruction to report data/parsing problems rather than patch
    shared code from this lane.
- **State Bank of Patiala** (target `psb-a.json`, bankSlug `state-bank-of-patiala`, parser
  `state-bank-of-patiala/2003-portal`): `sbp.co.in/interestrate.htm` has 5 monthly captures
  2003-04-14..2004-12-05 (plus 4 more on a same-content uppercase-path variant
  `INTERESTRATE.HTM`, not pursued separately). Page's "Interest Rates on Deposits" table splits
  each tenure into a below-Rs-15-lakh rate, an Rs-15-lakh-to-1-crore rate, and a third "EFFECTIVE
  ANNUALISED RETURN TO CUSTOMER" column that is a derived compounded yield of the second column,
  not a separate rate -- RateRow has no field for a derived yield, so that column is read and
  dropped. The table's footnotes are marked up as a `<caption>` *inside* the table, which
  `extractTables` treats as that table's `context` (a directly-inside `<caption>` pre-empts any
  preceding heading text) -- so the grid is found by its own distinctive "annualised return"
  header cell instead of by heading text. First capture read by hand: `(w.e.f 01.02.2003)`, 7-14d
  NIL/<15L, 4.00%/>=15L (footnoted, only available as a bulk deposit), 15-29d 4.50%, 30-45d
  4.50%, 46-90d 5.50%, 91-179d 5.50%, 180d-<1yr 5.75%, 1yr-<2yr 6.25%, 2yr-<3yr 6.25%, 3yr+
  6.25%. The page also states senior citizens get +0.50% over card rates (rule only, no printed
  resulting number, so no senior row) and carries several *lending*-rate tables (housing loans,
  PLR, agriculture advances) further down with their own later w.e.f. dates, correctly excluded
  by bounding the date search to just the deposits table's own heading.
  **Result of running the target**: 7 cards stored, spanning 2003-04-14 to 2004-12-05 (observed
  dates; effectiveFrom read from each capture's own w.e.f.). 3 further captures (2005-02-06,
  2005-04-25, 2005-12-21) correctly reported "table not found" -- the page's layout had changed
  by 2005 (not investigated further in this pass; a `state-bank-of-patiala/2005-*` parser would
  be needed to extend past 2004-12).
- **State Bank of Hyderabad**: `sbhyd.com` discover found `deposit.html` (2001-05-05),
  `deposits.asp` (2006), `advances_termdepositreciepts.asp` (2006) and later Wordpress-era pages
  (2012+, mostly navigation/corporate-governance, one rate-comparison page
  "compare-our-savings-accounts") -- **leads, not yet fetched/read** in this pass.
- **State Bank of Bikaner & Jaipur** (Ledger2, following up Ledger's own lead -- target
  `psb-a.json`, parser `state-bank-of-bikaner-and-jaipur/2001-domestic-term-deposit`):
  `sbbjbank.com/interest.htm` has **18 monthly captures, 2001-03-02..2006-05-05, 8+ distinct
  digests**. One "Revised Interst Rate on Domestic Term Deposit" table (the bank's own
  misspelling of "Interest", not a transcription typo introduced here), dated directly in its
  own title row ("w.e.f. 12.02.2001" on the first capture). Four deposit-size bands: "Normal
  Rates" (<15 lacs) plus three "Differential Rates on Single Deposits Only" bands (15
  lacs-<1 crore, 1 crore-<5 crore, 5 crore & above) -- each differential cell prints the rate
  *and* its delta over the Normal rate in one cell, e.g. "5.50 (0.50)"; the parenthesised delta
  is stripped before reading the rate (a per-cell footnote-style suffix, distinct from the
  shared amount-band-header bug found on Bank of Baroda's page -- see that bank's section).
  Below-1-crore bands stored as `fd`; the two >=1-crore bands as `fd_bulk`. The title says
  "Domestic Term Deposit" only (no NRO/NRE), so NRI rates are not read from this page --
  `interest_nri.htm` (captured the same day, 2001-03-02) is a ready, unpursued lead for those.
  **First predecessor bank in this whole group with any staged card.**
  **Confirmed final result** (real run, not dry-run): **2 `fd` cards + 2 `fd_bulk` cards,
  spanning 2001-03-02 -> 2002-04-18** (effectiveFrom 2001-02-12 for the first group; the second
  group's own title text did not yield a readable date via `findEffectiveDate`, so that card is
  correctly `confidence: "low"` with a null `effectiveFrom` and only an observed range,
  2002-03-06 to 2002-04-18, rather than a guessed date). As with Bank of Baroda/Bank of India
  above, the page's layout does **not** hold constant for the rest of its capture range: by
  2002-06-16 the "Revised Interst Rate..." title and its clean 4-band table are gone, replaced
  by a page mixing PLR/PTLR (lending rates) with a differently-organised deposit-rate section
  (checked by hand; not pursued further into a third parser variant this pass -- logged as a
  lead for 2002-06 onward, alongside the still-untried `deposit.htm`, `deposite.htm`,
  `Tools/interest_rates.htm` and `P&SB/interest_old.htm` candidates below).
  Other `sbbjbank.com` candidates Ledger found (`deposit.htm`, `deposite.htm`,
  `Tools/interest_rates.htm`, `P&SB/interest_old.htm` -- the last name alone suggesting an
  on-site historical-rates page) not re-checked this pass; `interest.htm` was the strongest
  single lead and was prioritised first.
- **State Bank of Travancore**: `sbtonline.in` checked (it is SBT's *netbanking* portal, not the
  public site) -- only login/security/FAQ pages found, no rate table in HTML; one image
  `sbijava/images/p_interest.png` (2014) looks like a rendered rate table but OCR is out of scope
  for these tools. No public-site domain for SBT identified/tried yet. **Lead, not otherwise
  pursued.**
- **State Bank of Saurashtra, State Bank of Indore**: no candidate domain identified yet for
  either. **Leads, not started.**
- **Bharatiya Mahila Bank** (Ledger2): its own domain, `bmb.co.in` (confirmed via Wikipedia's own
  citation of it, and the bank's IFSC-lookup listing on prokerala.com), is **now a parked
  domain-for-sale page** (sedoparking.com placeholder) -- not conclusive proof the Internet
  Archive holds nothing from when the bank was live (2013-2017), but a discouraging sign, and not
  checked via `discover`/`captures` in this pass. Every dated-press search for BMB-specific rate
  news returned only aggregator listing pages (Wishfin, Policybazaar, a `cibilp.blogspot.com`
  post that reads current-as-of-publish rates rather than reporting a specific bank announcement)
  -- none used, per the brief's rule against aggregator-style sources. **Lead, not otherwise
  pursued**; BMB only existed 2013-2017 before merging into SBI, so the ceiling on how much
  history there is to find here is low regardless.
- Non-aggregator dated press coverage for any SBI associate was searched for (Exa) but not
  found: every associate-bank result was from an explicit aggregator (Wishfin, Policybazaar,
  CreditMantri) and excluded per the brief's rule against aggregator sources.
- **Imperial Bank of India / Presidency banks (Bank of Calcutta-Bengal, Bank of Bombay, Bank of
  Madras)**: pre-web (wound up/renamed by 1955); per the brief, pre-web evidence is unlikely and
  this was not pursued -- historical-context only, per `data/banks/banks.json`.

## Staged output summary (as of this pass)
Everything below is under `/agent/workspace/private/history-staging/Ledger/data/rates/`, never
written into the repo directly.

| Bank | Product | Cards | Source types | Earliest -> latest (effectiveFrom) |
| --- | --- | --- | --- | --- |
| sbi | fd | 7 | web_archive x2, press x5 | 1998-05-01 -> 2007-12-17 |
| sbi | nro | 1 | web_archive | 1998-05-01 |
| sbi | nre | 1 | web_archive | 1998-05-01 |
| sbi | rd | 1 | web_archive | 2000-09-12 |
| bank-of-baroda | fd | 3 | press | 2002-07-23 -> 2004-11-16 |
| bank-of-india | fd | 3 | press | 2002-08-01 -> 2007-08-01 |
| bank-of-maharashtra | fd | 1 | press | 2010-12-15 |
| canara-bank | fd | 1 | press | 2007-08-01 |
| canara-bank | fd_bulk | 1 | press | 2013-12-03 |
| central-bank-of-india | fd | 1 | press | 1999-01-18 |
| syndicate-bank | fd | 1 | press | 2007-08-01 |
| state-bank-of-mysore | fd | 3 | web_archive | 2003-10-20 -> 2004-12-01 |
| state-bank-of-patiala | fd | 7 | web_archive | 2003-02-01 -> 2004-12-01 |

Everything else in scope (savings/RD/bulk for the 5 non-SBI banks; all products for Bank of
Hyderabad, Bikaner & Jaipur, Travancore, Saurashtra, Indore, Bharatiya Mahila Bank, Dena Bank,
Vijaya Bank; Imperial Bank / Presidency banks) has no staged card yet -- see the gap/lead notes
per bank above.

## Ledger2 staged output summary (as of this pass)
Everything below is under `/agent/workspace/private/history-staging/Ledger2/data/rates/` --
a separate staging root from Ledger's own (above), never written into the repo directly, and not
overlapping with anything Ledger staged (no bank/product pair below was already covered by
Ledger's own table). All numbers below are from re-reading the actual staged JSON files after
every card in this pass was stored for real (not from a dry run).

| Bank | Product | Cards | Source types | Earliest -> latest (effectiveFrom) |
| --- | --- | --- | --- | --- |
| sbi | fd | 2 | press | 2004-11-29 -> 2007-08-09 |
| bank-of-baroda | fd | 7 | web_archive | 2002-02-04 -> 2004-06-14 |
| bank-of-baroda | nro | 7 | web_archive | 2002-02-04 -> 2004-06-14 |
| bank-of-baroda | fd_bulk | 1 | web_archive | 2002-09-16 |
| bank-of-india | fd | 2 | web_archive | 2009-01-19 -> 2009-11-27 |
| bank-of-india | fd_bulk | 2 | web_archive | 2009-01-19 -> 2009-11-27 |
| central-bank-of-india | fd | 4 | press | 2010-11-08 -> 2012-03-12 |
| central-bank-of-india | fd_bulk | 1 | press | 2010-08-09 |
| dena-bank | fd | 3 | press | 2003-06-05 -> 2016-11-21 |
| vijaya-bank | fd | 3 | press | 2012-04-01 -> 2016-04-12 |
| state-bank-of-bikaner-and-jaipur | fd | 2 | web_archive | 2001-02-12 -> (undated, observed 2002-03-06/2002-04-18) |
| state-bank-of-bikaner-and-jaipur | fd_bulk | 2 | web_archive | 2001-02-12 -> (undated, observed 2002-03-06/2002-04-18) |

These add to (never replace) Ledger's own cards for sbi/bank-of-baroda/bank-of-india, and are the
first cards of any kind for dena-bank, vijaya-bank and state-bank-of-bikaner-and-jaipur (the
first predecessor bank in this whole group with any staged card at all). Canara Bank and Bank of
Maharashtra have no new staged cards this pass (both were investigated -- see their own sections
above -- but every lead either turned out to be a dead end or was left as an unpursued lead, not
a card).

## Tooling / process notes
- The Internet Archive rate limit was heavily contended throughout this session by several other
  researchers' background jobs running in parallel (confirmed via `ps aux`, saw concurrent
  `explore.ts`/`run.ts` invocations writing to `/agent/workspace/private/tmp/Annal/` and
  `/agent/workspace/private/tmp/Scribe/`). Some `run.ts`/`explore.ts` calls timed out under the
  shared 3s/request budget and needed a background retry with a longer timeout -- not a bug in
  the tooling, just contention; worth knowing if a future pass sees the same.
- `collectors/src/parse/html-table.ts`'s `extractTables` uses a table's own `<caption>` as its
  `context` whenever one is present, in preference to any preceding heading text. This is a
  reasonable default (most tables that bother with a `<caption>` use it as a title) but is worth
  knowing about: on at least one page in this pass (State Bank of Patiala's, which uses
  `<caption>` for footnotes rather than a title) it meant `context`-based heading matching missed
  the real heading entirely; the fix used here was to identify that table by a distinctive header
  *cell* instead of by `context`, which sidesteps the issue without touching the shared file.
- While running `npx tsc --noEmit -p .` at the end of this pass, `backfill/tests/sfb.test.ts`
  (another research group's file, not touched in this pass) had several type errors from an
  un-awaited possibly-`Promise` parser result. Confirmed none of this group's own files caused
  or are affected by it; left as-is since it is outside this group's lane and looked like another
  researcher's in-progress edit.

### Ledger2 additions
- **Archive contention was severe throughout this pass**, well beyond what Ledger describes --
  `ps aux` regularly showed 20-40+ concurrent `explore.ts`/`run.ts` processes from other
  researchers (Annal, Scribe/Scribe2, Tidemark, Vellum and others). At one point the shared
  `/agent/workspace/private/wayback/.throttle.backoff` file was consistently set to a timestamp
  *in the future* (checked directly), confirming the archive itself was returning enough
  429/5xx responses that the shared backoff mechanism was genuinely active, not just the normal
  per-request gap -- a plain `run.ts --dry-run` on one bank took several minutes wall-clock more
  than once. This is the politeness mechanism working exactly as designed under real load, not a
  bug; a future pass at a similarly contended time should expect the same and plan for
  long-running background jobs rather than short foreground ones.
- **Two shared-code findings from this pass, both worked around locally, neither fixed in shared
  code (out of this group's lane)** -- full detail under Bank of Baroda's own section above:
  1. `collectors/src/parse/amount.ts`'s `parseAmountBand` can misread a header cell that mixes an
     amount with an unrelated parenthesised date (e.g. "Less than Rs. 15 lacs(w.e.f.
     16.09.2002)"), taking the date's digits as if they were a second rupee figure. Confirmed on
     a live bankofbaroda.com/interest.asp capture; `validateCard` caught the resulting nonsense
     band before storage, but the capture's real data was lost until worked around.
  2. `collectors/src/store.ts`'s `replaceArchiveCards` scopes "this target's earlier cards" by
     `(bankSlug, product, sourceUrl)` only, with no notion of which parser produced them. Two
     targets sharing one URL for the same product (needed here because bankofbaroda.com's
     `interest.asp` changed layout, at a fixed URL, partway through the period being read) will
     silently clobber each other's stored cards on every re-run, in file order -- confirmed live.
     **Any group with a similarly long-lived, layout-changing-but-same-URL page should combine
     eras into one wrapper parser under one target, not split them into separate targets**, or
     risk losing data the same way.
- `collectors/src/parse/common.ts` and `backfill/wayback/generic-parse.ts` were both being
  actively rewritten by another researcher during this pass (uncommitted changes observed
  mid-edit via `git diff`, including a new product-aware table-heading-scoring system and a
  generic amount-tiered-column reader added to `generic-parse.ts` -- notably, a
  shared-code-level version of the same "amount bands as separate columns" problem this group's
  custom parsers had to solve by hand for Bank of Baroda/Bank of India; a future pass may find
  the generic reader already handles some of what needed a custom parser here). `npx vitest run`
  on this group's own test file twice showed 1-2 unrelated, pre-existing tests fail with a null
  date where they normally pass; re-running secure moments later (and consistently thereafter)
  showed all tests passing again both times, consistent with the other edit landing mid-file-write
  rather than a real regression -- but it means a lone red test run during a period of visible
  shared-file churn is worth a re-run before trusting it.
