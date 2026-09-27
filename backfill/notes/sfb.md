# SFB group — research log (Tidemark)

Scope: au-sfb, capital-sfb, equitas-sfb, esaf-sfb, jana-sfb, shivalik-sfb, slice-sfb,
suryoday-sfb, ujjivan-sfb, unity-sfb, utkarsh-sfb, plus predecessors fincare-sfb,
capital-local-area-bank, shivalik-mercantile-cooperative-bank, north-east-sfb-pre-rename,
pmc-bank (slugs per data/banks/banks.json).

Staging root: /agent/workspace/private/history-staging/Tidemark

## Ground truth already in the repo before this pass
- slice-sfb: fd.json has 8 bank_archive cards (Oct 2024 -> present) from
  slice.bank.in/documents/imp/previous_interest_rates.pdf via backfill/sfb-archives.ts
  (sliceHistory adapter). savings.json has 5 bank_archive cards from the same PDF. rd.json has
  only the single current bank_official card -- the archive PDF's adapter does not parse an RD
  section at all (checked the adapter source; it only extracts Savings and FD blocks).
- unity-sfb: fd.json/fd_bulk.json each have 1 bank_archive + 1 bank_official card, from the two
  "website-disclosure-effective-*.pdf" URLs unityHistory() already knows about (13 Apr 2026,
  02 Jul 2026). savings.json has only the current bank_official card (the disclosure PDF's
  savings section is parsed by unityFd/unitySavings live adapters but archiveCards() in
  unity-sfb.ts DOES push a savings card from each known disclosure -- so the single savings
  card present must mean only one of the two known PDFs stated a savings effective date, or
  the two rounded to the same value; not re-verified here, out of scope to touch collectors/src).
- esaf-sfb, suryoday-sfb: NO data/rates directory at all before this pass -- the live collector
  has not reached these two banks yet. Historical cards from this pass are the first data either
  bank has in the repo.
- All other banks (au, capital, equitas, jana, shivalik, ujjivan, utkarsh) had exactly one
  bank_official card per product (today's live rate only) before this pass.

## Predecessor slugs confirmed in data/banks/banks.json (read 2026-09-27)
- fincare-sfb -> mergedInto au-sfb, 2024-04-01, founded null (not independently verified there)
- capital-local-area-bank -> mergedInto capital-sfb, 2016-04-24 (same legal entity, licence
  conversion, not a merger of two entities)
- shivalik-mercantile-cooperative-bank -> mergedInto shivalik-sfb, 2021-04-26 (same entity,
  co-op-to-SFB voluntary transition)
- north-east-sfb-pre-rename -> mergedInto slice-sfb, 2025-05-14 (same entity, renamed; the
  slice group merger into NESFB was 2024-10-27 -- this is why the existing slice-sfb bank_archive
  cards already start Oct 2024, under the slice-sfb slug, not a predecessor slug)
- pmc-bank -> mergedInto unity-sfb, 2022-01-25 (true merger of a distinct co-operative bank)

Decision: NESFB pre-Oct-2024 history (nesfb.com wayback) is stored under bankSlug **slice-sfb**,
matching the convention the existing Oct-2024-on cards already use for the same continuous
banking entity/licence (north-east-sfb-pre-rename is a rename, not a separate entity, per the
banks.json note on that predecessor). Fincare, Capital LAB, Shivalik Mercantile and PMC are
genuinely separate legal entities (or at least separately named/tracked ones) before their
merge/conversion dates, so their wayback cards are stored under their own predecessor slugs.

## NBFC predecessors that could not take public deposits (per research brief) -- not searched
Janalakshmi Financial Services (jana-sfb), Ujjivan Financial Services (ujjivan-sfb), Equitas
Holdings/Micro Finance (equitas-sfb), ESAF Microfinance and Investments (esaf-sfb), Suryoday
Micro Finance (suryoday-sfb) and Utkarsh Micro Finance (utkarsh-sfb) were all NBFC-MFIs before
SFB conversion and could not legally take public deposits. No pre-conversion deposit-rate search
attempted for these six, per brief instruction.

## Target-file pruning (backfill/wayback/targets/sfb.json)
Started from 145 entries (Phase-1 blind survey). After reviewing every URL: kept the handful that
were genuine rate pages, deleted blog posts (aubank.in/blogs/*, most of the ujjivansfb.in and
theunitybank.com and janabank.com entries), RSS feeds (esafbank.com .../feed/), application forms
(fixed-deposit-apply-online, apply-fixed-deposit.php), asset/image/logo pages, sitemap/CSR/
disclaimer pages, and a handful of CDX-discovery artifacts that were plainly not real paths
(suryodaybank.com/rate-of-interest/0deg, /100, /254,%20254,%20254,%200.8 -- these are a CSS
`linear-gradient(...)` string leaking into a broken relative link on the live site, captured
verbatim by the crawler; confirmed by the literal color-channel numbers in the "path"). Added new
targets discovered via `explore.ts discover` on each bank's pre-.bank.in legacy domain (see per-
bank sections below) plus predecessor domains fincarebank.com and pmcbank.com (found via
ExaSearch) and utkarsh.bank (confirmed a real second domain the bank itself uses in filings, not
a scrape artifact). Left at 61 entries; expect a few more will be pruned once dry-run output is
reviewed.

## IMPORTANT limitation found in the shared wayback pipeline (report only, not fixed here)
`backfill/wayback/generic-parse.ts` (`readTermTables`) only recognises tables whose first column
is a **tenure** (via `parseTenure`), and `backfill/wayback/run.ts`'s card-building
(`groups.map(...)`) only ever sets `rows`, never `savingsSlabs`/`slabMethod`. There is no code
path in the shared run.ts/generic-parse.ts pipeline that can produce a valid **savings** RateCard
(savings pages are balance-slab tables, not tenure tables -- `parseTenure("Above Rs 1 lakh")`
returns null, so `readGrid` always rejects them with "first column is not tenures", and even a
custom `HistoricalParser` couldn't help because its `GenericResult` return type has no
`savingsSlabs` field and run.ts's own `cards` construction never reads one). This means the
savings-account "lead" targets in sfb.json (capital-sfb, shivalik-sfb, utkarsh-sfb, slice-sfb,
unity-sfb, fincare-sfb) cannot be turned into cards via `run.ts` at all, dry-run or otherwise --
they need a bespoke script (outside run.ts) that calls `monthlyCaptures`/`snapshot` from
`backfill/wayback/cdx.ts` directly and hand-parses the slab table. Flagging this for the
orchestrator since cdx.ts/generic-parse.ts/run.ts are shared code I should not edit.

## Per-bank source log

### au-sfb
- FD: aubank.in/interest-rates/fixed-deposit-interest-rates -- 5 web_archive cards, 2023-12-23 to
  2025-10-12 (span continues into the live bank_official card, 2026-09-01). Plus the older
  aubank.in/interest-rates hub page -- 2 cards, 2019-08-18 to 2020-03-29 (a real gap remains
  2020-03 to 2023-12; no archived AU page found covering it -- see custom-parser note below).
  General customer only in every card: see the au-sfb/annualized-fd parser's doc comment
  (backfill/wayback/parsers/sfb.ts) for why senior rates were left out rather than guessed, and
  why table 1 on the current-era page (which repeats several tenure labels at *different* rates
  under what reads as the same heading -- most likely NRE-specific, not confirmed) is not read.
  **Custom parser needed and written**: every AU FD table prints a plain rate column beside an
  "(Annualized)" derivative column; the shared generic-parse.ts's classifyColumn tags both
  "general" (neither header says "senior", both match its `/rate|%/` fallback), so the shared
  reader produces two conflicting general rows per tenure and validateCard correctly rejects the
  whole card. Fixture: backfill/fixtures/au-sfb/20231223050259.html; test:
  backfill/tests/sfb.test.ts (5 assertions, all passing).
- RD: aubank.in/personal-banking/term-deposits/recurring-deposits/interest-rates -- 7 web_archive
  cards, 2020-12-04 to 2023-09-26 (no Annualized-column duplication on this particular page, so
  no custom parser needed here).
- Savings: not attempted (would need the same balance-slab gap as every other bank; not pursued
  for au-sfb specifically given time).
- Fincare SFB (predecessor, merged in): see its own section below.

### capital-sfb / capital-local-area-bank
Both eras share one domain (capitalbank.co.in), so are logged together; cards for both are
stored under bankSlug **capital-sfb** except where noted (the predecessor's *own* pre-2016 pages
turned out to carry no readable rate table at all, so nothing was stored under
capital-local-area-bank -- see below).
- FD: capitalbank.co.in/domestic-term-deposit -- 4 cards, 2020-10-24 to 2022-01-19.
  interest-rates/callable-domestic-term-deposit -- 5 cards, 2024-04-08 to 2025-09-17.
  interest-rates/non-callable-domestic-term-deposit -- 1 card, 2025-02-17 to 2025-05-19.
  Gap 2022-01 to 2024-04 remains (no working target found for that window).
- Pre-2016 Capital Local Area Bank era: fetched and read cb_deposits.htm (2007),
  cb_deposits1.htm (2012, confirmed by its own `<title>` to be the **Current Account** page, not
  deposits), cb_deposits4.htm (2009, confirmed by its own `<title>` to be "Deposits - Term
  Deposit" but the actual content is a plain-prose product list -- "Cumulative Deposit A/c",
  "Short Term Deposit A/c" etc -- with **no rate numbers**; the real numeric rate card at that
  time was almost certainly the page's own `cb_deposits_adv.swf` Flash banner, which is not
  recoverable from the archived HTML at all). Also tried products/term-deposit (2013-2017,
  29 captures sampled, zero tables) and term-deposit.html (2016-2020, zero tables). This whole
  era is a confirmed, evidence-checked gap, not a parser failure -- see the capitalbank.co.in
  section of the discover-domain notes below for the raw findings.
- RD: home/accounts/terms-deposit/recurring-deposit -- tried, all captures 2024-2025 "no table"
  (page is real -- confirmed a genuine RD product page exists via CDX discovery -- but never
  archived with a readable table). Gap.
- Savings: interest-rates/savings-bank-account. **Not run via run.ts** (balance-slab page, see
  the shared-pipeline limitation noted earlier). Read instead with a small dedicated script,
  backfill/capital-sfb-savings-wayback.ts, which imports `monthlyCaptures`/`snapshot` directly
  from backfill/wayback/cdx.ts (per that file's own header: "Use these instead of calling
  web.archive.org directly"). Finding: every capture checked (2024, 2025) prints one flat rate
  for every account type (Domestic Savings, Basic Savings/Suvidha Bachat, NRO, NRE) -- not a
  tiered table -- so the script reads that single number rather than building general slab
  logic. Result: see run output in backfill/notes/sfb.md's final report (script prints
  outcome/date-range per card at run time).

### equitas-sfb
- FD: equitasbank.com/fixed-deposit -- 5 cards, 2022-07-05 to 2024-06-14.
  fixed-deposit.php (2016-2020 era) and both recurring-deposits(.php) RD targets returned "no
  rate columns" on every capture checked -- the tables exist but the generic reader's column
  classifier could not confidently label any column (likely a page-wide amount/tenure layout
  that doesn't match the usual "tenure first column" shape; not investigated further given
  time). Two dated PDFs with full FD+RD+savings tables were found via ExaSearch
  (equitasbank.com/strapi-dev/uploads/Interest_rates_pdf_22c280f806.pdf, dated 2 Dec 2024, and
  .../Overall_Interest_Rate_Changes_July_2025_8f562d446b.pdf, dated 1 Jul 2025) but both
  equitasbank.com and equitas.bank.in returned HTTP 503 (bot/WAF challenge) on every direct
  fetch attempt -- not pursued further; noted here as a lead if bot-blocking is ever bypassed
  (e.g. via a real browser session).
- Savings: not found as a dedicated page; equitasbank.com/interest-rate-framework (despite the
  name) is the MCLR/lending-rate page, not deposits -- a red herring from the original survey.

### esaf-sfb
- FD: esafbank.com/interest-rates/ -- **14 cards, 2017-03-20 to 2025-05-01** (one date,
  2021-06-13, rejected for a genuine two-rates-one-slab conflict on "1275 days -1455 days" --
  looks like the page briefly showed two different numbers for the same bucket; not resolved,
  logged and skipped rather than guessed). This is the single longest, densest FD history found
  in the whole sfb group from a generic-parser page. account/fixed-deposit and deposit-policy/
  both "no table" on every capture; account/recurring-deposit/ (RD) also "no table" throughout --
  ESAF has no RD or savings history from this pass.
- This bank and suryoday-sfb had zero rows in data/rates before this pass (no live collector
  data either) -- these are the first cards either bank has in the repo.

### jana-sfb
- FD: janabank.com/fixed-deposit/ -- 4 cards, 2019-08-26 to 2020-08-03.
  janabank.com/interest-rates/ (combined hub) -- 6 cards, 2023-09-24 to 2025-06-14 (fills the gap
  after fixed-deposit/ stops; 2020-08 to 2023-09 remains a gap).
  janabank.com/deposits/fd-plus/ -- 7 cards, 2019-07-18 to 2020-11-27, but this is the bank's
  **FD Plus** (no premature withdrawal) scheme, a genuinely different product/rate card from
  standard retail FD -- stored under product "fd" (the schema has no fd_plus slot) with an
  explicit note on every card so it is never read as the standard card rate.
- Also found (not pursued into cards): janabank.com publishes individual dated NRE/NRO notice
  PDFs at stable, never-overwritten URLs (e.g.
  jana.bank.in/images/PDF/Notice-Interest-Rates-of-NRE-NRO%20FD-15Dec2022.pdf, confirmed frozen
  at "Date: 15-Dec-2022" when fetched directly) -- but the bank's main
  "Interest-Rate-for-Domestic-NRE-NRO-Retail-Fixed-Deposits.pdf" notice is overwritten in place
  (fetched directly and found it already showing "Date: 25 Sep 2026", i.e. today's live rate,
  not a frozen snapshot) so it is only useful via the Internet Archive, not direct fetch. Not
  added as a wayback target given time; a lead for a future pass.

### shivalik-sfb / shivalik-mercantile-cooperative-bank
Both eras share one domain (shivalikbank.com); cards stored under bankSlug **shivalik-sfb** for
the same reason as capital-sfb above.
- FD: shivalikbank.com/interest-rate -- 8 cards, 2023-06-03 to 2025-10-17 (SFB era only).
- Pre-2021 Shivalik Mercantile Co-operative Bank era: tried fixed-deposits, deposit-products and
  daily-deposits (all 2013-2020 captures) plus the post-2021 deposits/savings/ page -- every one
  came back "no table" across every capture sampled. This is a confirmed gap for the whole
  co-operative-bank era, in scope per the research brief (co-op banks did take deposits) but not
  recoverable from what Wayback captured of this domain.

### slice-sfb / north-east-sfb-pre-rename (NESFB)
Stored under bankSlug **slice-sfb** (same continuous banking entity/licence as the current
bank -- the "rename" predecessor is not a separate legal entity; see the lineage note earlier in
this file), extending the bank's own bank_archive PDF coverage (Oct 2024 onward) backward.
- FD: nesfb.com/fdchoice_intrate -- 3 cards, 2023-03-23 to 2024-10-05 (2017-2023 remains a gap;
  earlier NESFB pages like deposit.php/fix_deposit.php confirmed to exist via CDX discovery back
  to 2018 but not tried as targets given time -- a lead for a future pass).
- RD: nesfb.com/rdchoice_intrate -- 2 cards, 2023-03-23 to 2024-04-22. This is the **only RD
  history found anywhere in the sfb group** -- the bank's own archive PDF has no RD section
  (checked the sliceHistory adapter's source; it only extracts Savings and FD blocks) and the
  live RD adapter only ever publishes the single current period.
- Savings: nesfb.com/sainterest.php tried, "no table" on all 3 captures checked (2018-2019) --
  gap for the pre-Dec-2024 period (the bank's own archive PDF already covers savings from
  Dec 2024).

### suryoday-sfb and ujjivan-sfb: total wayback gap
Every target tried for both banks failed completely (0 cards from any URL):
- suryoday-sfb: rate-of-interest, deposits/fixed-deposit, deposits/recurring-deposit,
  personal/deposits/ -- all "no table" on every capture sampled (2017-2025). Checked *why* for
  rate-of-interest specifically: the page's only visible percentages are inside HTML comments
  (dead, commented-out old copy); the live numbers are loaded client-side (the site is
  Gatsby-based per its own build artifacts, e.g. "component---src-pages-rate-of-interest-js...").
- ujjivan-sfb: fixed-deposit/ has **zero** CDX captures at all under that exact path; en/personal-
  deposits and en/rural-deposits each have exactly one capture (2023), both a React SPA shell
  with literally zero percentage figures anywhere in the raw HTML (checked directly).
- Neither bank has a genuine dated-PDF archive on its live site either (checked directly): AU's
  and Jana's "notice" PDFs turned out to be overwritten in place (see above), and Ujjivan's own
  press-release listing page is also a JS shell with no server-rendered links (ExaSearch found
  exactly one individual dated Ujjivan press release, ujjivansfb.bank.in/press-release/revises-
  fixed-deposits-interest-rates-jun-02-2023, effective 1 Jun 2023 -- but it only restates ONE
  tenure bucket [12 months], not a full card, so it was not turned into a fragment "fd" card:
  storing a one-row card under product "fd" would misrepresent it as the full rate table for
  that date).
- **suryoday-sfb has zero historical cards and ujjivan-sfb has zero historical cards from this
  pass** -- both remain live-only until a different approach (e.g. a real browser session to
  render the JS, or finding more of Unity-style dated press-release PDFs) is tried.

### unity-sfb
The bank's own FD/RD/savings HTML *pages* never carried a real rate table in any capture checked
across every URL/era tried (fixed-deposits.html, fixed_deposits.html [both eras],
personal-banking/deposits/fixed-deposit, recurring-deposits.html, recurring_deposits.html,
saving_accounts.html, saving-accounts.html -- 7 targets, 0 cards). Checked why directly: the
oldest ones are pure marketing copy ("Senior Citizens earn additional 0.5%*" as a bullet point,
no table); the current one loads its numbers from a PDF via client-side JS.
**What worked instead**: the bank's own newsroom keeps four dated press-release PDFs at stable
URLs (theunitybank.com/docs/newsroom/*.pdf) with full rate tables and explicit effective dates,
fetched directly (no archive needed) and read with `pdftotext -layout`:
backfill/unity-sfb-press-archive.ts stored:
- fd: 2022-07-06, 2023-02-15, 2023-10-09, 2024-05-01 (4 cards, general+senior, all 12+ tenures).
- fd_bulk: 2022-09-26 (callable + non-callable, 6 amount bands x 12 tenures each).
- savings: 2022-01-22 (flat two-tier: <=1L 6%, >1L 7%) and 2023-06-24 (tiered: 6/7.25/7.5/7.75%).
  **Data-quality note, not resolved**: the 13 Oct 2023 press release restates the *old* Jan 2022
  flat structure verbatim, six months after the 24 Jun 2023 release announced the tiered one --
  almost certainly stale boilerplate copied between releases, not a genuine reversion, but this
  is not certain and both cards are kept with the contradiction noted on each rather than
  silently picking one (see the script's own SAVINGS_SNAPSHOTS comment).
This extends the bank's existing two disclosure-PDF cards (Feb/Jul 2026) back to Jul 2022 for FD
and to Jan 2022 for savings. 2024-05 to 2026-02 (FD) and 2023-06 to the disclosure PDFs' first
savings date remain gaps.

### utkarsh-sfb
Every wayback HTML target tried failed (utkarsh.bank/fixed-deposit is a genuine 404 for its 2018
capture; utkarsh.bank/deposits/recurring-deposit and utkarsh.bank/savings-account both "no table"
throughout; utkarsh.bank.in/fixed-deposit has zero CDX captures at all).
**What worked instead**: three dated FD notices found via ExaSearch and fetched directly (not
via the archive -- confirmed genuinely frozen, i.e. *not* the live overwritten-in-place annexure,
by checking the effective date printed inside each is not today's date):
backfill/utkarsh-fd-dated-archive.ts stored 3 cards, general+senior, hand-transcribed from
`pdftotext -layout` output:
- 2023-08-21 (utkarsh.bank/xsite/assests/pdf/Fixed_Deposit_Rates_w_e_f_May_2023.pdf -- filename
  says "May_2023" but the page's own printed date is 21 Aug 2023; trusted the printed date).
  Retail ceiling ₹2 crore at this point.
- 2024-06-07 (utkarsh.bank.in/uploads/pdf/comprehensive/FD_Interest_Rate-Domestic_&_NR.pdf).
  Retail ceiling ₹3 crore -- the threshold moved between these two dates, both stated explicitly
  on their own page, not assumed.
- 2025-05-05 (utkarsh.bank/uploads/pdf/comprehensive/Consolidate_FD_interest_rate_May_05_2025.pdf).
No RD or savings history found for Utkarsh from this pass (the wayback RD/savings targets above
were the only leads tried and both failed).

### fincare-sfb (predecessor, merged into au-sfb 1 Apr 2024)
- FD: fincarebank.com/interest-rate -- **29 distinct revisions recovered, 2018-06-15 to
  2022-11-27, the densest single-URL history found in this entire pass**. 17 stored; 12
  REJECTED by the shared validator's own sanity cap (rows must be 0.01-15% p.a.) because
  Fincare's own archived page genuinely shows senior-citizen rates as high as 15.35% for the
  6-month/1-year/2-year buckets across several 2018-2019 revisions (e.g. 2018-06-15: 15.1% for 6
  Months, 15.25% for 1 Year, 15.35% for 2 Years). **Flagging, not fixing**: this is a real
  MFI-turned-SFB-era rate printed on the bank's own page, not a typo introduced by this
  pipeline -- rejected wholesale by lib/validate.ts's per-row bound (shared code, not edited
  here). fincarebank.com/fixed_deposit.html (2017-era) and fixed-deposits (2024 WordPress era,
  post-redesign) both "no table" on every capture; recurring-deposit/ (RD) also "no table"
  throughout -- no RD history for Fincare.
- Fincare's own predecessor identity before becoming an SFB (Fincare being formed from ICICI-
  style micro-finance roots) is out of scope per the brief (NBFC-MFIs could not take deposits);
  fincarebank.com's earliest capture (2017-07-28) already shows it operating as the SFB itself.

### pmc-bank (merged into unity-sfb 25 Jan 2022)
Genuinely the oldest material found in this whole pass -- PMC Bank's own site turns out to be
archived from 1999.
- FD: pmcbank.com/interest_rate.html -- 1 card, 1999-02-10 to 1999-10-12 (earliest date reached
  by any bank in the sfb group by a wide margin).
  pmcbank.com/rateofint.asp -- 16 cards, 2003-02-01 to 2011-12-09.
  pmcbank.com/english/pbinterestrates.aspx -- 10 cards, 2012-08-22 to 2019-10-15, 8 days before
  the 23 Sep 2019 RBI all-inclusive directions -- genuine pre-restriction live rates, not a
  frozen/notice page. english/fixeddeposit.aspx (same era) tried too: 0 cards, "no table" on
  every one of 13 sampled captures despite 36 total captures existing -- pruned from the target
  file. 2000-2002 (between interest_rate.html and rateofint.asp) is a small remaining gap.
  **27 FD cards total for PMC Bank, 1999 to 2019** -- by far the earliest and longest single-bank
  history assembled in this pass, entirely from a defunct co-operative bank's own archived
  pages, exactly the case the research brief flagged as worth checking.
- Per the brief: "record in notes what exists for PMC" -- its own official pages ARE archived
  (confirmed, 1999-2019), so its deposit rates are in scope and being pursued as above. No
  savings-account-specific PMC page was targeted this pass (its interest_rate.html/rateofint.asp
  pages appear to be all-products combined -- FD is what the generic parser could read from
  them; a dedicated savings read was not attempted given time).

## Shared-code observations worth a second opinion (not edited here, per "stay in your lane")
1. **generic-parse.ts / run.ts cannot produce savings cards at all** (detailed earlier in this
   file). Every bank's savings history in this pass needed its own small script importing
   cdx.ts's exports directly, bypassing generic-parse.ts entirely.
2. **validateCard's 0.01-15% per-row rate bound** is tight enough to reject genuine 2018-2019
   MFI-turned-SFB-era senior-citizen rates (Fincare, above). Worth checking whether this bound
   should be relaxed slightly (e.g. to 16-17%) given at least one bank's own archived page
   printed rates just over 15% in that specific window -- flagged for the orchestrator's
   judgement, not changed here.

## Orchestrator review before merge (27 Sep 2026)

91 of the 124 staged cards were merged after checking each card's rows against the cached archived page. 33 were **not merged** because the generic reader picked the wrong table or column. Redo them with custom parsers that select the right table:

- **fincare-sfb (all 17 FD cards):** the page (fincarebank.com/interest-rate) prints a Savings table, then the **MCLR (lending-rate) table** ("Overnight 14.25%, 1 Month 14.30% ... 2 Years 14.85%"), then the Fixed Deposit table ("7 days to 45 days 4.00% 4.50% ..."). The generic reader took the MCLR table. The "15.35% senior rates" were lending rates, not deposit rates, so the 15% validation cap was right to reject them.
- **equitas-sfb (all 5 FD cards):** the table has "Interest rates for amount less than Rs 2 crores | Annualised Yield". The cards took the Annualised Yield column (e.g. 181-210 days 5.32% instead of 5.25%).
- **pmc-bank 1999-02-10:** the NRE term-deposit table was stored as domestic FD. The page's domestic table comes first ("15 days to 29 days 7.5 % ... 121 Mths and Above 15.5 %*", with a minors footnote).
- **jana-sfb /deposits/fd-plus/ (5 cards):** FD Plus is a separate product (no premature withdrawal, minimum Rs 15,00,001) but was stored as a regular FD from Rs 0. Record it only with its real conditions (amountMin 1500001, callable false and a scheme name), or leave it out.
- **jana-sfb /interest-rates/ hub (5 cards, 2023-2024):** the generic reader took the first table on the hub, which in at least one capture (2024-11-02) is the Liquid Plus FD. Select the retail FD table explicitly.
