# Official deposit data, macro data and history

Research date: 11 October 2026. Scope: data correctness, representative bank rate conditions, official source strategy, historical coverage and acceptance gates for the implementation plan. This note proposes work; it does not change collectors or datasets.

## Evidence and access limits

Public requests to SBI, HDFC, ICICI, PNB, RBI, MoSPI and the Labour Bureau failed at the environment's outbound CONNECT proxy with HTTP 403. A permitted escalated `curl` to SBI returned the same proxy rejection. This is not evidence that the bank pages themselves are down or block scraping. No current interest rate, new regulation, CPI rebasing announcement or historical dataset was independently verified against a live official page in this session.

Repository facts below are verified by inspecting the checkout. Bank conditions are supported by committed excerpts labelled as official-page captures, chiefly from 27 September 2026, with their originating official URLs. These excerpts are useful implementation evidence but require renewed live checks before publishing new rates. Existing research notes and the uploaded working notes are leads, not fresh proof. In particular, the claimed 2026 RBI bulk-rate publication deadline, current legal thresholds and CPI base-2024 transition require the exact official notification or methodology document before the product relies on them.

## What already exists

An inspection of [the bank master](../../data/banks/banks.json), [source registry](../../data/sources/sources.json) and [rate files](../../data/rates/) found:

| Item | Current checkout |
| --- | --- |
| Active bank entries | 49: 12 public sector, 21 private, 11 small finance, 5 payments |
| Launch tracking | 44 tracked; 5 payments banks deferred |
| Predecessor entries | 39 |
| Source registrations | 130, of which 129 are marked active, across 44 banks |
| JSON files under `data/rates` | 143 |
| Rate cards | 643 across 50 bank slugs, including predecessors |
| Evidence classification | 121 `bank_official`, 232 `bank_archive`, 252 `web_archive`, 38 `press` |
| Banks with a `bank_official` card | 37 |
| Official cards by product | 37 FD, 20 RD, 36 savings, 25 bulk FD, 3 tax saver |
| Date on every official card's `observedAt` | 2026-09-27 |
| Other data | 56 snapshot JSON files; 22 macro-series JSON files |

The seven tracked banks with no `bank_official` card are Bank of India, ESAF SFB, IDBI, Indian Bank, J&K Bank, Kotak Mahindra and Suryoday SFB. Historical cards for some of these banks exist; historical presence does not establish current coverage. An active registry flag also does not establish that collection works. These counts are a local audit, not a new RBI bank-list validation.

The existing model already keeps tenure, amount, customer, residency, callable status, payout, provenance and observation dates: [domain.ts:48](../../lib/domain.ts#L48). Keep this work and repair missing semantics rather than flattening every bank to a highest advertised rate.

## Bank rate conditions and the common comparison

Use a default comparison of INR domestic retail, resident individual, ordinary customer, callable FD at a user-selected principal and maturity. Let the user change age/customer class, product, residency and payout. A maximum-rate view must disclose the exact eligible tenure and scheme. Keep bulk and non-callable offers visible through explicit filters.

| Representative bank | Evidence from committed official-page excerpts | Consequence for normalization |
| --- | --- | --- |
| SBI | [Retail page](https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits), [fixture:86](../../collectors/fixtures/sbi/fd_retail.html#L86) has old/new public and senior columns; [fixture:243](../../collectors/fixtures/sbi/fd_retail.html#L243) has non-callable retail; [fixture:269](../../collectors/fixtures/sbi/fd_retail.html#L269) has named 444-day Amrit Vrishti and super-senior exclusions. | Preserve old versus revised dates, exact point tenures, scheme identity, amount eligibility, callable status and premium exclusions. Do not apply the super-senior benefit to excluded RD or tax-saving schemes. |
| HDFC | [Rate hub](https://www.hdfc.bank.in/interest-rates), [fixture:2087](../../collectors/fixtures/hdfc-bank/combined.html#L2087) gives RD effective dates per tenure; [fixture:2258](../../collectors/fixtures/hdfc-bank/combined.html#L2258) restricts senior eligibility to resident individuals and excludes special FD tenures from RD; [fixture:1323](../../collectors/fixtures/hdfc-bank/combined.html#L1323) distinguishes quarterly calculation and discounted monthly payout. | Add row-level effective dates. RD has its own terms and table. Monthly payout cannot automatically reuse an undiscounted rate. Preserve non-withdrawable schedules separately from callable ones. |
| ICICI | [FD page](https://www.icici.bank.in/personal-banking/deposits/fixed-deposit/fd-interest-rates), [fixture:9](../../collectors/fixtures/icici-bank/fd-page.html#L9) names an official JSON endpoint in `data-api`; the FD and RD JSON fixtures have distinct structures. [Source registry](../../data/sources/sources.json) documents ambiguous unlabelled extra FD tabs. | Prefer the official endpoint discovered from its page. Select only labelled amount/product tabs; an undocumented tab number is not a known bulk band. RD cannot be inferred from FD merely because some numbers match. |
| PNB | [Deposit hub](https://pnb.bank.in/Interest-Rates-Deposit.html), [fixture:1787](../../collectors/fixtures/punjab-national-bank/fd_retail.html#L1787) explicitly defines senior as 60 to under 80 and super-senior as 80+, excludes NRO from the domestic senior premium, gives tenure-specific premiums and a 365-day calculation basis. [fixture:1318](../../collectors/fixtures/punjab-national-bank/fd_retail.html#L1318) names PNB Uttam non-callable. | Store eligibility as structured age/residency/tenure conditions. Keep printed rates separate from rates calculated from an explicit premium formula. Preserve special point tenures and the product's withdrawal rights. |
| Union Bank | [Deposit page](https://www.unionbankofindia.bank.in/en/details/rate-of-interest), [fixture:240](../../collectors/fixtures/union-bank-of-india/rate_of_interest.html#L240) states senior and super-senior premiums in prose with a booking/renewal condition; [adapter:12](../../collectors/src/adapters/union-bank-of-india.ts#L12) records these as terms. | An age premium may be supported by official text even when no printed senior column exists. Applying it should create an explicitly derived row with source and eligibility; never silently add an assumed 0.50%. |
| AU SFB | [Savings page](https://www.au.bank.in/interest-rates/savings-account-interest-rates), [fixture:49](../../collectors/fixtures/au-sfb/savings.html#L49) contains dated current/future columns and [fixture:78](../../collectors/fixtures/au-sfb/savings.html#L78) defines incremental slabs with conditional whole-portion rules at very large balances; the source registry has separate FD and RD sources. | Preserve pre-announcements and select the schedule in force by its effective date. Savings interest requires a calculation rule, not only a balance band. Ordinary retail amounts fit incremental rules here; the exceptional large-balance rules need a richer model. |
| Ujjivan SFB | [Rate hub](https://www.ujjivansfb.bank.in/interest-rates), [source registry](../../data/sources/sources.json) documents independently dated FD/RD/savings panels, Platina non-callable FD and a separately dated linked bulk PDF. | A page-wide date is unsafe. Discover changing PDF links from a stable hub. Keep product, amount band and callable status from the selected panel. |

These are representative design cases. They do not replace the planned coverage inventory for every tracked bank and product.

### Required dimensions

| Field | Store and display |
| --- | --- |
| Bank identity | Stable entity ID, published name, current slug and predecessor/rename relationship. Current branding is not sufficient historical identity. |
| Product and currency | FD, RD, savings, bulk FD, NRE/NRO, FCNR, tax saver. FCNR needs its source currency and separate FX treatment. |
| Principal/balance | Rupees or integer paise with explicit unit and inclusive/exclusive bounds. Preserve bank-specific amount restrictions and the historical threshold stated by the source. |
| Customer | General, senior, super-senior, staff, retired staff, women or non-individual where explicitly published. Store age bounds and residency eligibility rather than only a category label. |
| Maturity | Preserve the original label and units, including day, month, year and combinations such as 36 months + 1 day. Resolve calendar maturities against the booking date. A year is not always 365 days. |
| Withdrawal | Callable, non-callable, unknown, lock-in, premature withdrawal penalty and scheme exclusions. A missing statement is unknown. |
| Rate | Quoted percentage per annum, separate from annualized yield or an interest amount. Exact decimal storage avoids float drift in hashes and calculations. |
| Interest calculation | Compounding interval, day-count basis and payout schedule. Missing monthly discounted rate or penalty terms means the corresponding calculation is unavailable or explicitly approximate. |
| Time | Source publication date, row/schedule effective dates, announcement date, observed/check time and retrieval time. Future schedules can be stored without becoming current early. |
| Evidence | Official source URL, document/table/page pointer, hash, parser version, source type, raw-evidence location, explicit/derived status and completeness. |

The existing day-only model and single card-level effective date are at [domain.ts:53](../../lib/domain.ts#L53) and [domain.ts:86](../../lib/domain.ts#L86). The HDFC source above demonstrates why calendar tenure and row-level dates matter. Savings `slabMethod` currently permits only `whole`, `incremental` or `unknown`: [domain.ts:78](../../lib/domain.ts#L78). A bank may have mixed, conditional rules. Represent them explicitly or restrict supported balances and explain the limit. Never compute with `unknown` as though it meant whole-balance.

### Example row contract

The following is a proposed shape, using placeholders rather than a current rate:

```json
{
  "entityId": "bank:sbi",
  "publishedBankName": "State Bank of India",
  "product": "fd",
  "currency": "INR",
  "amount": { "unit": "paise", "min": 0, "maxExclusive": 3000000000 },
  "customer": { "kind": "general", "resident": true },
  "tenure": { "kind": "exact_days", "days": 444, "sourceLabel": "444 days" },
  "schemeName": "Amrit Vrishti",
  "withdrawal": { "kind": "unknown" },
  "quotedRatePercentPa": "SOURCE_VALUE",
  "payout": { "kind": "not_stated" },
  "effectiveFrom": "SOURCE_DATE_OR_NULL",
  "observedAt": "RETRIEVAL_TIMESTAMP",
  "evidence": {
    "kind": "bank_official",
    "sourceUrl": "https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits",
    "sourcePointer": "Amrit Vrishti paragraph",
    "valueKind": "quoted",
    "completeness": "partial",
    "parserVersion": "VERSION",
    "evidenceHash": "SHA256"
  }
}
```

This row is illustrative and must not enter the database. The amount is shown in paise to make the unit explicit; confirm eligibility from the live scheme terms. The comparison table can present Bank, Product/scheme, Deposit amount, Exact tenure, Customer eligibility, Quoted rate, Payout/compounding, Withdrawal conditions, Effective from, Last checked and Source. A result that matches user parameters can also show an estimated maturity amount. A rate row without enough calculation terms should still be useful as a sourced quote.

## RBI policy and inflation

### RBI rates

Use the [RBI homepage](https://www.rbi.org.in/) as a cheap current-value cross-check. The committed [official homepage excerpt:18](../../collectors/fixtures/macro/rbi_home.html#L18) contains repo, SDF, MSF, Bank Rate, fixed reverse repo, CRR and SLR. The reverse repo entry is present at [fixture:56](../../collectors/fixtures/macro/rbi_home.html#L56), but absent from the implemented keys and label rules at [rbi-rates.ts:15](../../collectors/src/macro/rbi-rates.ts#L15).

The product should distinguish the policy repo rate, fixed reverse repo rate, SDF rate, MSF rate and Bank Rate. CRR and SLR are reserve ratios, so label their unit as percent of the relevant liability base, not percent per annum. Do not imply that fixed reverse repo and SDF are interchangeable, or derive all policy rates from repo with a permanently fixed spread. The official notification or monetary policy statement should define each actual change.

Use [RBI monetary policy](https://www.rbi.org.in/Scripts/Annualpolicy.aspx), [RBI notifications](https://www.rbi.org.in/Scripts/NotificationUser.aspx), [RBI statistics](https://www.rbi.org.in/Scripts/Statistics.aspx), [DBIE](https://data.rbi.org.in/DBIE/) and the [Handbook edition index](https://rbi.org.in/Scripts/AnnualPublications.aspx?head=Handbook+of+Statistics+on+Indian+Economy) as official discovery entry points. These are research leads requiring live discovery here; exact current publication links were not fetched. Prefer stable index discovery over guessed release IDs or hashes.

The repository already has these event histories, each linked to a saved RBI Handbook source:

| Series | Existing start | Existing last change in the file | Points |
| --- | --- | --- | --- |
| [Repo](../../data/series/rbi_repo_rate.json) | 2008-06-12 | 2025-12-05 | 56 |
| [Fixed reverse repo](../../data/series/rbi_reverse_repo_rate.json) | 2008-12-08 | 2020-05-22 | 42 |
| [SDF](../../data/series/rbi_sdf_rate.json) | 2022-04-08 | 2025-12-05 | 11 |
| [MSF](../../data/series/rbi_msf_rate.json) | 2011-05-03 | 2025-12-05 | 41 |
| [Bank Rate](../../data/series/rbi_bank_rate.json) | 1935-07-05 | 2025-12-05 | 65 |
| [CRR](../../data/series/rbi_crr.json) | 1962-09-16 | 2025-11-29 | 78 |
| [SLR](../../data/series/rbi_slr.json) | 1949-03-16 | 2020-04-11 | 39 |

A last change several years ago can be valid for an event series. Track `lastVerifiedAt` separately to distinguish unchanged from unverified. The current collector uses the homepage's `asAt` or run date as `effectiveDate`: [rbi-rates.ts:97](../../collectors/src/macro/rbi-rates.ts#L97). A homepage observation does not establish when a decision became effective. Store that observation, discover the matching notification, and keep an unknown effective date explicit until supported.

### What "real inflation" should mean

The user asks for both real inflation and government-announced inflation. There is no uniquely observable alternative "true inflation" for every citizen. Build clearly labelled measures:

| Product measure | Source and contract |
| --- | --- |
| Official headline inflation | MoSPI all-India CPI Combined, with the published reference month, index, base year, YoY percentage and provisional/final status. Preserve Rural and Urban as separate optional series. [MoSPI](https://www.mospi.gov.in/) and [its API origin](https://api.mospi.gov.in/) are the official starting points; verify the current release and API manual. |
| Real return | A calculation from a stated deposit return and selected CPI series: `(1 + nominal return) / (1 + inflation) - 1`, using decimal rates. For observed purchasing-power change over an interval, use the same-base index ratio. This is calculated data, not a second official inflation statistic. |
| Personal inflation | Optional later calculator that weights officially published component indices by the user's spending shares. Label the result a personal estimate, with explicit basket and period. |
| Core inflation | Optional analytical series with an exact exclusion definition and official source or reproducible weights. Do not relabel it as "real inflation". Definitions can differ. |
| RBI inflation forecasts | Separately stored forecast vintages from MPC statements or Monetary Policy Reports, with publication date, target quarter/FY, horizon and revisions. An RBI projection is not a later observed MoSPI reading. [RBI monetary policy entry point](https://www.rbi.org.in/Scripts/Annualpolicy.aspx). |
| CPI-IW | Separate Labour Bureau industrial-worker measure. Official starting points are the [homepage](https://labourbureau.gov.in/) and [all-India index history](https://www.labourbureau.gov.in/allindiageneralindex-1). The committed [homepage excerpt:25](../../collectors/fixtures/macro/labourbureau_home.html#L25) links an exact press note and identifies its base. |

The current model has a long [CPI-IW series](../../data/series/cpi_iw_chained.json), plus annual and monthly CPI Combined files, but not a verified full monthly headline/forecast pipeline. CPI-IW history spans 1968-08 through 2026-07 in the checkout. Its source segment bases and linking factors are recorded at [cpi_iw_chained.json:9](../../data/series/cpi_iw_chained.json#L9). The data contract should retain original indices, original base, transformed values, linking method and citations, rather than overwriting old bases.

Do not splice CPI-IW and CPI Combined into one continuous series labelled an official index. They describe different populations and baskets. A long comparison can show them as separate series, or use a clearly labelled analytical proxy with an explicit methodology and a visible series break. Rebasing within one official index does not make a different index interchangeable. Forecasts also remain separate from measured observations, even when the target month or financial year matches.

### Macro correctness blockers

1. [cpi_combined_annual.json:4](../../data/series/cpi_combined_annual.json#L4) labels the whole series base 2012=100. Its last two values are 192.6 and 103.5 at [line 66](../../data/series/cpi_combined_annual.json#L66). This unexplained discontinuity blocks year-over-year or purchasing-power calculations. Mixed bases are a plausible cause, not a verified finding. Recheck the official table headers, notes and CPI rebasing methodology before using either value or a linking factor.
2. [cpi_combined_monthly_2024base.json:9](../../data/series/cpi_combined_monthly_2024base.json#L9) cites only the MoSPI homepage for the stated linking factor. Save the exact methodology/notification, preserve original bases and check overlapping published values. A homepage citation is too weak for a financial calculation.
3. [cpi-combined.ts:60](../../collectors/src/macro/cpi-combined.ts#L60) obtains a token, but [line 72](../../collectors/src/macro/cpi-combined.ts#L72) fetches the same URL in both branches and never sends it. Fix authentication against the live official manual, validate schema and filters, paginate, and confirm that the selected records include the latest month. Do not assume the current coded field names or ten-record cap are current API facts.
4. [cpi-combined.ts:42](../../collectors/src/macro/cpi-combined.ts#L42) puts credentials in a query URL. Avoid storing or logging that URL. Use the API's documented supported authentication method and redact credentials at the transport boundary. If only query authentication is supported, that URL must still be redacted from all diagnostics.
5. [cpi-combined.ts:86](../../collectors/src/macro/cpi-combined.ts#L86) marks an unreachable source as `ok: true`. Fetch failure, successful unchanged data and stale published data need distinct statuses.
6. [cpi-combined.ts:58](../../collectors/src/macro/cpi-combined.ts#L58) and [cpi-iw.ts:85](../../collectors/src/macro/cpi-iw.ts#L85) skip already known periods. Provisional-to-final revisions need immutable observation versions and a latest-vintage view, not a permanent refusal to record revisions.
7. [cpi-iw.ts:61](../../collectors/src/macro/cpi-iw.ts#L61) discovers a press-note URL and attaches it to readings, but uses the homepage widget values. Parse the actual current note if the widget lags and link each observation to the document for that month. Do not attach one month's note indiscriminately to two different months.

## Historical sources beyond Internet Archive

Prioritize these sources in order. The exact source class and confidence should remain visible to the reader.

| Source | What it can establish | Current evidence / next work |
| --- | --- | --- |
| Bank-owned historical rate files | Dated quoted rate revisions and sometimes amount bands. | Existing SBI XLSX and savings PDF, HDFC FD and savings PDFs, and PNB inline savings history are documented below. Rediscover linked files from bank hubs so changing filenames do not break collectors. |
| Bank circulars, product disclosures and previous-rate pages | Individual historical cards, often with clear effective dates. | Ujjivan, Unity and other banks already have linked PDFs or archive parsers in the checkout. [Source registry](../../data/sources/sources.json). Survey these again before claiming that only SBI/HDFC have history. |
| Bank annual reports / investor relations | Dated rate facts if explicitly stated; historical products, liability costs and institutional history. | Official investor-relations archives are useful leads. A weighted cost of deposits or year-end average is not a customer FD schedule. Extract only the figure actually printed and its observation period. |
| NSE/BSE disclosures | Official bank-filed circulars or announcements and merger evidence when available. | [NSE announcements](https://www.nseindia.com/companies-listing/corporate-filings-announcements), [BSE announcements](https://www.bseindia.com/corporates/ann.html). Availability of full bank deposit cards is unverified; do not assume every rate change must be filed. |
| RBI Handbook, Bulletin and DBIE | Policy rates, system/group statistics, regulated-era material and annual ranges. | The repository [series catalog:5](../../data/history/rbi/series-catalog.json#L5) records Handbook discovery and downloads; [line 59](../../data/history/rbi/series-catalog.json#L59) records weighted domestic term deposit rates by bank group. These are not every bank's quoted retail card. |
| Government Gazette / DFS / RBI schemes | Legal merger/rename dates, regulated deposit directions, licensing and entity succession. | [eGazette](https://egazette.gov.in/), [Department of Financial Services](https://financialservices.gov.in/), [RBI notifications](https://www.rbi.org.in/Scripts/NotificationUser.aspx) and [India Code](https://www.indiacode.nic.in/) are official discovery leads. Preserve the actual notification and effective date. |
| Government/statistical archives | CPI historical releases and methodology, not necessarily bank-level FD cards. | MoSPI, Labour Bureau and [data.gov.in](https://www.data.gov.in/). Validate publisher, metric, license, date and revisions before import. |
| Other web preservation | Captures of the bank's original published page. | [Common Crawl](https://commoncrawl.org/) and [Arquivo.pt](https://arquivo.pt/) are additional discovery leads, not verified coverage for these banks. A crawl timestamp proves observation, not effective date. Search the rate-page URL and old official domains, retain capture evidence. |
| Kaggle / open GitHub datasets | Candidate lead lists or cross-checks. | No Kaggle dataset was independently assessed or accepted in this access-limited session. Do not claim a complete all-bank historical dataset exists or import an unattributed maximum-rate CSV as truth. Require original URLs/documents, date meanings, amount/age/tenure dimensions, versioning, license and sampled exact agreement with official records. |
| Press reports | Occasionally a dated partial rate announcement where the original is missing. | The checkout has 38 `press` cards. Treat them as secondary and partial. Do not let these replace a current official card or fill unnamed tenures. [Backfill README:132](../../backfill/README.md#L132). |

### Existing official-bank archive coverage

| Bank/product | Committed bank-archive cards | Committed date coverage | Important limitation |
| --- | --- | --- | --- |
| SBI FD | 91 | 2008-01-04 to 2025-07-15 | General-public retail columns only; amount headings vary historically. [Original XLSX](https://sbi.bank.in/documents/26242/65574/15122025_Historical+Retail+Term+Deposit+Rates.xlsx/f21a3209-472b-b629-80e8-e558982d4000?t=1765802246329), [implementation notes:14](../../backfill/README.md#L14). |
| SBI savings | 9 | 2000-04-01 to 2022-10-15 | Ambiguous two-value rows skipped; later changes need other official evidence. [Original PDF](https://sbi.bank.in/documents/26242/65574/211022-SAV+INT+HIST.pdf/d898ad9a-28b3-b74a-77e9-b0b5d6907bfa?t=1666333463298), [notes:39](../../backfill/README.md#L39). |
| HDFC FD | 81 | 2010-07-30 to 2026-03-06 | General-public only; some PDF cells cannot be safely aligned. [Original PDF](https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/Historical-FD-Rates-Less-than-Rs-3-Crs.pdf), [notes:56](../../backfill/README.md#L56). |
| HDFC savings | 11 | 2003-03-01 to 2025-06-24 | Merged PDF cells were manually transcribed; repo-linked formula tiers omitted where no fixed rate was printed. [Original PDF](https://www.hdfc.bank.in/content/dam/hdfcbankpws/in/en/personal-banking/discover-products/interest-rates/historic-saving-account-interest-rates.pdf), [notes:73](../../backfill/README.md#L73). |
| PNB savings | 17 | 2011-05-03 to 2025-10-01 | Inline hidden panels can disappear in a redesign. [Official hub](https://pnb.bank.in/Interest-Rates-Deposit.html), [notes:94](../../backfill/README.md#L94). |

These coverage dates and counts describe committed cards, not newly downloaded archives. Do not infer senior rates retrospectively by adding today's premium. Retain the original retail threshold for each period. A skipped cell should create an explicit coverage gap.

### RBI history is not a substitute for each bank's missing card

The [regulated-era dataset:2](../../data/history/rbi/regulated-term-deposit-rates.json#L2) explicitly contains fiscal-year-end snapshots, with ranges/ceilings and transitional bank-rate ranges. Its [first row:26](../../data/history/rbi/regulated-term-deposit-rates.json#L26) says the table does not establish whether the figures are fixed prescribed levels, ceilings or permitted ranges, and that day bounds are approximate conversions from years. Do not turn these into exact effective-date FD quotes for every bank, or extend an end-March snapshot across the full financial year.

The old narrative says term deposits became fully deregulated in October 1997 and domestic savings in October 2011, but the supporting `milestones.json` referenced by [deposit-rules.md:3](../../data/history/rbi/deposit-rules.md#L3) is missing from this checkout. Retrieve the precise RBI circulars before treating every regulatory statement there as verified. [RBI's savings deregulation discussion](https://www.rbi.org.in/Scripts/bs_viewcontent.aspx?Id=2344) is a source cited by the existing savings file; [RBI historical publications](https://www.rbi.org.in/scripts/rhvol-2.aspx) are a further official lead.

Pre-2003 savings levels in the existing history partly rely on a secondary technical report. The dataset itself says they need primary-source verification: [savings-rate-history.json:4](../../data/history/rbi/savings-rate-history.json#L4). Keep these outside a high-confidence default chart until the cited RBI annual reports or credit policy statements confirm them. Historical regulated rates can be shown as a separate system-level reference layer when the metric and temporal meaning are known.

### Bank mergers and identity

Keep the actual issuer on every historical row. Link predecessors to successors so the SBI page can include a labelled State Bank of Patiala history without rewriting it as an SBI rate. Distinguish merger, rename, licence conversion, acquisition and non-bank-to-bank relationship.

The existing [predecessor catalog:2102](../../data/banks/banks.json#L2102) already encodes relationships. [Capital LAB:2530](../../data/banks/banks.json#L2530) says conversion of the same legal entity, while [PMC:2566](../../data/banks/banks.json#L2566) says merger. Some relationship evidence is secondary, including [Fincare:2525](../../data/banks/banks.json#L2525) and [North East/Slice:2561](../../data/banks/banks.json#L2561). Renew those citations from the actual RBI/Gazette/bank notice. Track stable legal entities and name-validity intervals separately from URL slugs.

A merger date does not establish that an already contracted FD immediately earned the successor's newly offered rate. Historical product terms and new-booking rate schedules need their own records. Never fabricate a continuous chart by filling a predecessor's gap with the successor's rate.

## Collection, publication and history acceptance gates

These are recommendations derived from the inspected data, not claims that the current implementation meets them.

1. **Source inventory.** For every launch bank/product, store official landing page, discovered data endpoints/PDF, expected table labels, amount/age eligibility, parser version, terms covered, robots/terms review, live fetch status and last successful validation. Separate missing publication, access failure and parsing failure.
2. **Safe unchanged checks.** Use ETag or Last-Modified conditional GET if supplied. Otherwise fetch once and hash the relevant normalized schedule. Whole-page hashes change with banners and menus. An unchanged verified response updates `lastCheckedAt` without adding a new rate revision. A failed response does not refresh verified freshness.
3. **Bounded source requests.** One request at a time per official host initially, a 2-second host interval, at most 3 transient-failure attempts with exponential backoff and jitter, honor Retry-After, cap request duration and total job runtime. Do not retry 401/403/captcha indefinitely. Browser automation is an isolated fallback for permitted client-rendered sources, not the default parser.
4. **Parse the correct table.** Require product/residency/amount headers and explicit source-scoped dates. Reject empty tables, challenge pages, lending-rate tables and annualized-yield columns. Validate bounds, duplicates and allowed overlaps across exact scheme tenures. Store the raw evidence or a reproducible content hash and document pointer before publication.
5. **Completeness gate.** Compare expected table sections, customers, tenure rows and amount bands with the last accepted schedule. If a parse drops all senior rows or half the tenures, quarantine it and keep the previous good schedule. A bank may genuinely remove a scheme; accept that when the official page explicitly confirms removal or a second successful scheduled reading supports it. Absolute rate bounds alone cannot identify the wrong table.
6. **Explicit derived data.** An official printed premium may produce derived customer rows after its eligibility is parsed. Store the base rate, premium, formula, cited statement and derivation version. This differs from guessing a standard premium for every bank. RD equality requires an explicit source statement and exclusion handling.
7. **Correct temporal state.** Store announced future rows, but select them only after their effective date. Do not use collection date as an undisclosed effective date. Keep a snapshot's capture date distinct from any stated historical effective date. Version provisional data and revised source publications.
8. **Partial success.** Publish valid bank updates independently, preserve last-good data for failures, and show stale/source-unavailable status. An HTML HTTP 200 is not success until the expected content has parsed. Rate coverage and freshness must be visible on a public status page.
9. **History staging.** Download, parse and validate backfill into a staging dataset. Before acceptance, sample source cells, inspect worst-rate changes and verify table identity. The prior [SFB history review:320](../../backfill/notes/sfb.md#L320) rejected 33 proposed cards after finding lending rates, annualized yield and wrong products. Those mistakes are concrete regression cases.
10. **Historical completeness.** Publish per-bank/product/customer coverage intervals and gaps, explicit date certainty and evidence class. A card count is not a complete daily history. Keep no-data periods empty and label partial schedules.

## Implementation order for the project plan

| Phase | Deliverable | Done when |
| --- | --- | --- |
| 1. Restore source access and current truth | Source inventory, representative live checks, repaired daily publication, last-good data and visible status | SBI, HDFC, ICICI, PNB/Union and one SFB each produce current sourced rows; all 44 banks have explicit supported/missing/blocked status; no silent empty replacement |
| 2. Normalize useful comparisons | Exact amount/tenure/customer filters, callable status, source-scoped dates, terms and reliable FD/RD/savings calculations | Comparison results satisfy selected eligibility; special tenures remain discoverable; unknown terms prevent false exact calculations |
| 3. Repair macro series | All seven RBI rates/ratios, official CPI releases, API authentication, revision handling, base-unit audit, forecast vintages | Notification effective dates are sourced; CPI charts use compatible bases; fresh, unchanged, delayed and failed states differ |
| 4. Expand verified history | Refresh SBI/HDFC/PNB archives, survey bank disclosures, official annual reports/filings, regulated-era reference, lineage evidence | Every accepted value has a source pointer and temporal meaning; gaps remain explicit; all-bank founding-to-present completeness is not promised |
| 5. Citizen utilities | Methodology, downloadable data, change feed, source directory, real-return and personal-basket views | A reader can reproduce a comparison and see which dates/sources support it without an account |

The first result should be trustworthy current rates and successful daily publication. Wide historical coverage, forecast analysis and a custom inflation basket should follow after those foundations work.
