# psb-b research log (Scribe)

Group: Indian Bank, Indian Overseas Bank, Punjab & Sind Bank, Punjab National Bank, UCO Bank,
Union Bank of India, and their merged predecessors (New Bank of India, Nedungadi Bank, Oriental
Bank of Commerce, United Bank of India, Global Trust Bank, Andhra Bank, Corporation Bank,
Allahabad Bank).

Staging root: `/agent/workspace/private/history-staging/Scribe/`
Scratch: `/agent/workspace/private/tmp/Scribe/`
Targets: `backfill/wayback/targets/psb-b.json` (68 targets after this pass; replaced the Phase 1
survey's blind entries -- dropped JS/CSS library files, error-redirect `browser.htm?aspxerrorpath=`
stubs, and one ambiguous "rural-banking-department" PDF slug that is very likely a loan-rate
document, not a deposit-rate one -- kept the handful of Phase 1 URLs I could independently verify
via CDX `discover`).

Convention: for each source, record URL, era covered, and cards produced (or why none). "Gap" =
looked, found nothing storable. "Lead" = found something promising but not yet run/verified.

## Domain discovery (Internet Archive `discover`, 1 CDX call per domain)

Ran `discover` against every domain named in the brief plus each bank's own `legacyDomains` from
`banks.json`. Findings that change the plan:

- **indian-bank**: `indianbank.com` is dead (one ad-redirect capture only); the real legacy site
  is entirely on `indianbank.in` (2006-2026, WordPress from ~2019).
- **indian-overseas-bank**: `iob.com` -- zero captures at all. `iob.in` is the real legacy
  domain, 2006-2024 (Plone/ASPX/ASP eras).
- **punjab-and-sind-bank**: `psbindia.com` is the real legacy domain (2002-2021), NOT
  `punjabandsindbank.co.in` alone -- the bank moved psbindia.com -> punjabandsindbank.co.in
  (2021) -> punjabandsind.bank.in (current). **As of 2026, psbindia.com itself has been resold
  and is now a gambling/spam site** ("aviator-deposit-methods" etc, captures from 2026-03) --
  irrelevant to us, only the captures up to ~2021 are real.
- **punjab-national-bank**: `pnbindia.in` is rich, 2009-2025 (still partly alive: some paths
  404, others redirect to pnb.bank.in). `pnbindia.com` (no final "in") returned nothing useful.
- **uco-bank**: `ucobank.com` is rich, and its **earliest usable capture is 1999-01-29** --
  the earliest of any of my six current banks.
- **union-bank-of-india**: `unionbankofindia.co.in` is rich, 2004-2025 (partly still alive,
  redirects to unionbankofindia.bank.in for some paths). `unionbankofindia.com` (no `.co`)
  returned nothing in scope.
- **allahabad-bank**: both `.com` and `.in` are real and overlap in time (2001-2013 either
  domain was live); `.com`'s **earliest usable capture is 1998-12-03** -- second-earliest in
  the whole group.
- **oriental-bank-of-commerce**: `obcindia.co.in` has almost nothing before 2019 that matches
  deposit/rate keywords, despite OBC operating since 1980 -- see Gaps below.
- **united-bank-of-india**: `unitedbankofindia.com` is rich, 2001-2020.
- **andhra-bank**: `andhrabank.in` has thin coverage -- only one HTML rate page found (2016);
  earlier eras only turn up `.gif`/`.jpg` images of rate tables (2007, 2010), i.e. a rate page
  existed but wasn't captured as parseable HTML. Did not try `andhrabank-india.com` beyond the
  initial discover (also thin: one `interestrates.gif` in 2006, nothing else in scope).
- **corporation-bank**: `corpbank.com` is rich, and its **earliest usable capture is
  1998-12-02** -- almost tied with Allahabad Bank as second-earliest. It also has a page
  literally titled `interest-rates/previous-interest-rates` -- checked it directly (fetched the
  2016-06-05 capture): it is an archive of past **MCLR / lending-rate** revisions only ("MCLR
  for Corp Retail Loan Schemes w.e.f 01.05.2016" etc), not deposit rates -- out of scope for
  this tracker, dropped from the target list.
- **global-trust-bank**: the domain guessed in the brief, `gtbindia.com`, turns out to belong to
  an unrelated business ("Gulf Travel Bureau") going back to a 2001 domain-parking page -- GTB
  never owned it. Found GTB's real domain, **`globaltrustbank.com`**, via Exa search of GTB's
  own 1998/1999 annual report footers (reportjunction.com). That domain **has a capture from
  1997-06-01** (`rates.html`) -- the single earliest bank-website snapshot found anywhere in
  this whole group, predating the 22-Oct-1997 deregulation. Domain is dead/parked again as of
  2024 (wp-content junk), but 1997-2005 captures look like the genuine historical site.
- **nedungadi-bank**: guessed domain `nedungadibank.com` has zero archive.org captures ever.
  Found the bank's real domain via Exa (its own 2001 annual report footer),
  **`nedungadi-bank.com`** -- but archive.org's *only* captures of that domain are 2006 adult-spam
  pages and a 2019 WordPress fragment; the domain was squatted after Nedungadi Bank's Jan-2003
  merger and archive.org never captured the real bank's site there. **Gap**: no web archive
  evidence found for Nedungadi Bank; would need Parliament/press/RBI secondary sources instead
  (not yet pursued -- see To-do).
- **new-bank-of-india**: merged into PNB 1993-09-04, entirely pre-web and entirely inside the
  RBI-regulated era (deregulation was Oct 1997) already covered by the system-wide RBI series.
  No bank-specific work attempted or needed.

## Current official pages checked for embedded archives (priority 3)

Fetched the live rate pages directly (not via archive.org) for Indian Bank, IOB, PNB, UCO and
Union Bank and inspected every `<a href>` for archive/circular/historical wording:
- **PNB** (`pnb.bank.in/Interest-Rates-Deposit.html`): confirmed the existing "Saving Bank
  Deposit Historical Rates" tab (already backfilled by `pnb-savings-archive.ts`, 2011-2025). No
  equivalent tab for FD -- checked the page's own tab-label list, only savings has a
  "Historical" tab. A tried lead, `pnbindia.in/interest-rates-archives.html`, turned out to be a
  single dead 302-redirect capture (2022-09), not a real archive page.
- **Indian Bank, IOB, UCO, Union Bank, Punjab & Sind Bank**: no archive/circular/historical
  links found on any current rate page (checked raw HTML for Indian Bank via a rendered browser
  session, since `indianbank.bank.in` blocks plain HTTP clients with an F5/TSPD bot challenge;
  the other four fetched cleanly with curl).

## Wayback targets added this pass (see `targets/psb-b.json` for the full list with notes)

FD targets added for all 6 current banks and for Allahabad Bank, Oriental Bank of Commerce,
United Bank of India, Andhra Bank, Corporation Bank and Global Trust Bank -- spanning several
distinct URL/domain eras per bank as the sites were redesigned. `fd_bulk` targets added for
Punjab & Sind Bank (no bulk product exists yet for this bank at all, live or historical) and
Union Bank. `rd` targets added for IOB, PNB, Union Bank, UCO, Allahabad Bank.

**Important limitation discovered**: `run.ts`'s generic pipeline only ever builds `RateRow[]`
cards (`GenericResult.rows`); it never sets `savingsSlabs`/`slabMethod` on the `RateCard`s it
stores, so it **cannot** produce a valid `savings` card no matter what parser is used -- a
savings-shaped page run through it will just fail validation or store nonsense. Left several
`product: "savings"` targets in the file as **leads only** (each noted inline), meant for a
bespoke script (in the style of `pnb-savings-archive.ts`, but pointed at wayback snapshots via
`monthlyCaptures`/`snapshot` from `backfill/wayback/cdx.ts` instead of a live page) -- not yet
written; see To-do.

## Results (state at end of this session)

Staged in `/agent/workspace/private/history-staging/Scribe/data/rates/`:

| Bank | Product | Cards | Source types | Span |
|---|---|---|---|---|
| indian-bank | fd | 3 | web_archive | 2009-08-07 -> 2010-10-01 |
| indian-overseas-bank | fd | 2 | web_archive | 2006-04-10 -> 2006-12-15 |
| oriental-bank-of-commerce | fd | 4 | press | 2002-08-01 -> 2012-04-16 |
| oriental-bank-of-commerce | nre | 1 | press | 2002-08-01 |
| punjab-national-bank | fd | 3 | press | 1998-05-08 -> 2002-11-07 |
| punjab-national-bank | nre | 1 | press | 2002-11-07 |

14 cards total. The Internet Archive channel was extremely congested for this whole session --
`ps aux` regularly showed 60-100+ concurrent `wayback`-related processes from other history
researchers sharing the same 1-request/3s global limit, so most of the other ~55 targets in
`psb-b.json` (punjab-and-sind-bank, uco-bank, union-bank-of-india, and most of the predecessors)
never got a turn at the lock within this session and remain queued, unprocessed, exactly as
written in the target file -- re-running `npx tsx backfill/wayback/run.ts --group psb-b
--product fd --verbose --out <staging>` should pick them up whenever contention eases (already
-fetched captures are cached, so a re-run costs nothing for indian-bank/indian-overseas-bank).

## Custom parser: `indian-bank/amount-tiered-table`

Indian Bank's pre-2011 pages split retail rates into amount-tier columns ("Less than Rs.15
lakhs" / "Rs.15 lakhs to less than Rs.1 Crore") rather than customer-tier columns, and print
higher bulk bands ("Rs.1 Crore to Rs.5 Crores", "Above Rs 5 Crore") as further same-shaped
tables. The shared generic reader can't handle this at all: it only ever reads a header as a
CUSTOMER type, so a bulk column ("...Crore...") is always classified `"skip"`, and even a
column it doesn't skip (e.g. "Less than Rs. 15 lakhs", no skip-word in it) becomes a plain
`general` row with `amountMax: null` -- silently implying "no cap" for a column that is
explicitly capped. Wrote `indian-bank/amount-tiered-table` in `parsers/psb-b.ts`: reads every
non-tenure column's own amount band via `parseAmountBand`, then splits `fd` (bands maxing at or
below ₹1 crore) from `fd_bulk` (bands starting at or above ₹1 crore) -- that split point is the
boundary these specific pages draw themselves, not invented here. Test:
`backfill/tests/psb-b.test.ts`, fixture `backfill/fixtures/indian-bank/20090923000000-rate_deposit_domestic.html`.

**Bug caught and fixed while writing this**: the first version read the amount band from the
FULL joined multi-row header (all header rows concatenated per column), which on this page's
tables includes an outer banner row repeated across every column via colspan ("Applicable rates
of interest %p.a (w.e.f. 07.08.2009)") -- `parseAmountBand` takes the first two numbers it finds
in the string, so it silently read the *date* ("07.08" / "2009") as the amount band for every
column instead of "15 lakhs" / "1 Crore", making every column collapse onto the same band and
tripping validation's `conflicting_rows` check (two different rates for what looked like one
slab). Fixed by reading the band from the LAST header row only (the one nearest the data),
falling back to the table's `context` only when that specific cell has no readable amount in it.
Caught by re-running against the real cached captures after the first full `run.ts` pass showed
`rejected` entries for it, not by the unit test alone -- worth remembering for the next
amount-tiered table this group has to parse.

## Bank-archive/press script: `oriental-bank-of-commerce-press-archive.ts`

Given OBC's own domain has essentially no web-archive deposit-rate content before 2019 (see
above), searched Exa for dated third-party press reports of OBC's own specific rate revisions
and transcribed 5 cards (sourceType `press`, confidence `low`, one row/number at a time, never
interpolated):
- `fd` 2002-08-01 (Zee News, 2002-07-30 wire report): 14 rows, domestic resident, 7 days-3
  years, with an explicit Rs 15 lakh amount split on the 15-day-to-180-day tenors only (the
  article never says whether that split also applies to the 1-2-3 year buckets, so those rows
  are recorded amount-unqualified rather than guessed either way -- see the script's comments).
- `nre` 2002-08-01 (same article): 4 rows, 6 months-3 years, all explicitly "less than Rs 15
  lakh" (no NRE rate given for Rs 15 lakh and above).
- `fd` 2010-08-05 (Business Standard, 2010-08-09): 7 rows -- a partial revision, only the
  tenors the article names as changed (including the 1000-day special tenor).
- `fd` 2012-04-16 (The Hindu BusinessLine, 2012-04-15): 2 rows -- another partial revision.
- `fd`, no effectiveFrom (Times of India, 2009-03-30): 2 rows, the rate "at present" on that
  date (not a revision -- the article's own reported cut for "tomorrow" was a proposal under
  discussion, not confirmed, and is deliberately not recorded); `observedFrom`/`observedTo` set
  to the article's own date since there is no effective-date to record instead.

Exa-searched for the same kind of press evidence for Nedungadi Bank (no usable web archive at
all, see above) -- found only aggregate deposit/branch-growth figures and a stock-scam
enforcement order, no specific interest-rate number tied to a date. Nedungadi Bank remains a
genuine gap for bank-specific rate evidence; not pursued further given time.

## Gap: Indian Bank's 2019-2023 WordPress-era deposit-rates page has no rates in the archived HTML at all

`indianbank.in/departments/deposit-rates/` and its 2023+ successor `deposit-rates-2/` both parse
with zero rows in every capture checked (2019-2023, 9 sampled + 1 exact). Checked why by hand:
the archived HTML for these captures contains the page's foreclosure-charges table, a named
scheme's own small SB table, and all the surrounding boilerplate text -- but literally no
occurrence of "w.e.f", "Tenor", or any "Period ... Deposit" heading, i.e. the retail domestic
term-deposit table itself is simply not present as static markup. Almost certainly the live page
loads that specific table's numbers client-side (a common WordPress rate-table plugin pattern),
and archive.org's crawl captured the page before that JS ran -- there is nothing for a better
parser to read here; this is a genuine "not archived" gap, not a parsing shortfall. The bank's own
`wp-content/uploads/.../Revision-of-interest-rate-on-Term-Deposits-*.pdf` circular series (dated
filenames spanning 2020-2022, found via `discover`) may be the only way to recover this era, but
needs a PDF-reading custom parser (`run.ts`'s generic pipeline never runs PDF extraction) -- not
attempted, time ran out; see Leads below.

## Leads not yet pursued
- Indian Bank's own `wp-content/uploads/.../Revision-of-interest-rate-on-Term-Deposits-*.pdf`
  series (dated filenames 2018-2022) and Union Bank's own
  `pdf/retail-rate-of-interest-updated-*.pdf` series (dated filenames 2022-2023): both are
  sequences of one-PDF-per-revision circulars. `run.ts`'s generic pipeline cannot read PDFs (it
  decodes non-HTML bytes as text but never runs PDF extraction); would need a custom parser
  that does its own `pdftotext`/`unpdf` call, or a bespoke script. Likely lower marginal value
  than it first appears: both PDF sequences fall entirely inside a period the same bank's live
  HTML rate page was *also* being crawled by archive.org, so `run.ts`'s ordinary bisection of
  that HTML page should already reconstruct the same rate history without the extra PDF work.
- Nedungadi Bank and (mostly) OBC pre-2012: no web archive found; would need Parliament answers,
  RBI publications or dated press reports (government/rbi_publication/press sourceType). Not
  yet searched.
- `andhrabank.in`'s pre-2016 rate pages exist only as images in the CDX index (2007, 2010) --
  not pursued (image OCR is out of scope for this pipeline).

## To-do / next steps

1. Let the FD run finish across all 68 targets, review stored cards, drop/fix any bad parses.
2. Write a bespoke `<group>-savings-from-wayback.ts`-style script reusing
   `monthlyCaptures`/`snapshot` from `cdx.ts` to turn the `savings`-tagged leads above into real
   `savingsSlabs` cards, for however many banks time allows.
3. Try `corpbank.com/interest-rates/previous-interest-rates` directly.
4. Exa/RBI search for Nedungadi Bank and pre-2012 OBC secondary evidence.
