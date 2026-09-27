# psb-a research log (Ledger)

Group: SBI, Bank of Baroda, Bank of India, Bank of Maharashtra, Canara Bank, Central Bank of
India, and their merged predecessors (SBI associates, Bharatiya Mahila Bank, Dena Bank, Vijaya
Bank, Syndicate Bank, Imperial Bank / Presidency banks).

Staging root: `/agent/workspace/private/history-staging/Ledger/`
Scratch: `/agent/workspace/private/tmp/Ledger/`

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

## Predecessors (SBI associates, Bharatiya Mahila Bank, Dena Bank, Vijaya Bank, Syndicate Bank,
## Imperial Bank / Presidency banks)

- **Syndicate Bank**: one press card from the Financial Express 2007-08-01 article (400-499
  days: 8.9% from 9.5%; 500 days-<2yr: 9% from 9.6%, both eff. 1 Aug 2007) -- see
  `backfill/psb-a-fd-press.ts` (stored under bankSlug `syndicate-bank`, kept in the same
  script as Canara/BoI since all three rates come from one article).
- **Dena Bank, Vijaya Bank**: no dated primary/press source found yet with an explicit rate
  *and* date (the multi-bank comparison table found, dsij.in 2013-10-29, reads like a
  point-in-time rate-shopping round-up rather than a report of a specific bank announcement, and
  its per-bank numbers are not corroborated elsewhere in this pass -- **not used**, logged as a
  lead only, given the brief's instruction to avoid aggregator-style sources). No web-archive
  domain pursued yet either (`denabank.com`/`vijayabank.com` not run through `discover` in this
  pass -- **lead, not started**).
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
- **State Bank of Bikaner & Jaipur**: `sbbjbank.com` discover (completed late in this pass, not
  yet followed up) found strong early candidates: `deposit.htm` (2001-03-01), `interest.htm`
  (2001-03-02), `interest_nri.htm` (2001-03-02), `deposite.htm` (2001-04-30), and from a 2006
  redesign `Tools/interest_rates.htm` (2006-09-02) and `P&SB/interest_old.htm` (2006-05-18, whose
  name alone suggests an on-site historical-rates page, same pattern as the bank-archive scripts
  elsewhere in this project) -- **strong leads, not yet fetched/read** in this pass.
- **State Bank of Travancore**: `sbtonline.in` checked (it is SBT's *netbanking* portal, not the
  public site) -- only login/security/FAQ pages found, no rate table in HTML; one image
  `sbijava/images/p_interest.png` (2014) looks like a rendered rate table but OCR is out of scope
  for these tools. No public-site domain for SBT identified/tried yet. **Lead, not otherwise
  pursued.**
- **State Bank of Saurashtra, State Bank of Indore, Bharatiya Mahila Bank**: no candidate domain
  identified yet for any of these three. **Leads, not started.**
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
