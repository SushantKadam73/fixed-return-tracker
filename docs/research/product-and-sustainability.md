# Product utility, comparable projects, and sustainability

Research date: 11 October 2026. This note supplies product decisions for the implementation plan. It does not claim that the deployed site, bank pages, or commercial comparison sites have been verified live.

## Recommendation

Make Fixed Return Tracker a dependable directory and comparison table for published Indian deposit rates. Its promise should be that a reader can tell which rate applies to their deposit, where it came from, when it became effective, and whether the source was checked recently.

Repair collection, persistence, freshness, and the existing pages before expanding the design. The most useful near-term differentiation is precise eligibility and evidence, plus readable coverage gaps. A claim that nobody else offers these features would require a fuller competitor audit.

Keep the core service free. Future revenue should fund maintenance without affecting ranking or forcing a paid infrastructure dependency. Plan commercial hosting separately from the current development and personal-use hosting arrangement.

## What was actually inspected

The runtime permits GitHub and package-manager destinations. Requests to `mtf.trading`, BankBazaar, Paisabazaar, Stable Money, Vercel's documentation site, RBI, and DICGC failed at the proxy with `CONNECT tunnel failed: 403`. A sandbox escalation for Vercel's public documentation produced the same proxy response. This is an environment access limitation, not evidence that those sites are broken or block scraping.

The following first-party material was reachable:

- Fixed Return Tracker's [README](../../README.md). It describes the intended collection, history, evidence, calculator, and snapshot workflow. README promises are not proof that the implementation currently fulfills them.
- The public [FD Rates India repository](https://github.com/devesh1102/fd-rates-india/tree/7474a6479eab1d8f93bad722f9557b0c410d43f0), including its README, UI, database layer, and several scrapers.
- GitHub's own [Sponsors documentation source](https://github.com/github/docs/blob/main/content/sponsors/getting-started-with-github-sponsors/about-github-sponsors.md), the personal-account setup guide, and fee/eligibility text.

## Comparable project with verified source evidence

[FD Rates India](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/README.md#L3) is a related project. Its README advertises nine Indian banks, regular and senior citizen rates, source links, bank exploration, best rates by tenure, and comparison charts. The supported-bank list includes SBI, HDFC, ICICI, Canara, IndusInd, IDFC First, Bandhan, Kotak, and Axis. [Source](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/README.md#L13)

The observed implementation offers lessons and limitations. These statements concern the inspected files at the pinned commit, not every capability of its live deployment.

| Observed implementation | Evidence | Implication for Fixed Return Tracker |
| --- | --- | --- |
| The documented UI includes bank exploration, source links, regular/senior comparison, tenure ranking, and charts. | [README feature list](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/README.md#L29), [app.py](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/app.py) | A rate table and generic charts alone are insufficient grounds for a uniqueness claim. |
| Its inspected `fd_rates` table has `UNIQUE(bank, tenure_label)`. The upsert overwrites regular/senior rates and `last_updated` for a matching row. | [database schema](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/database.py#L15), [upsert](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/database.py#L60) | Preserve a sequence of accepted rate cards rather than replacing historical values. |
| The inspected layer writes `date.today()` to `last_updated`. It does not store a separate bank effective date in that table. | [database.py](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/database.py#L35) | Show source effective date, last successful observation, and last rate change as separate facts. |
| The common tenure parser converts months to 30 days and years to 365 days. Unrecognized input returns the broad interval `0, 9999`. | [unit conversion](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/scrapers/_base.py#L33), [fallback](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/scrapers/_base.py#L106) | Retain calendar units and boundary inclusion. Quarantine unknown tenures rather than matching them to every requested duration. |
| Its ICICI adapter reads a JSON file; its Axis adapter discovers a PDF link, with a browser fallback for discovery. | [ICICI adapter](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/scrapers/icici.py#L13), [Axis adapter](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/scrapers/axis.py) | Investigate structured files and published PDFs before allocating browser or third-party fetch quota. These candidate endpoints still require a live check against the bank's current page. |
| Its root file listing did not contain a license file, and a direct `LICENSE` retrieval returned 404. | [Inspected repository root](https://github.com/devesh1102/fd-rates-india/tree/7474a6479eab1d8f93bad722f9557b0c410d43f0) | Use the repository to identify techniques and sources. Confirm licensing before copying implementation. |

The ICICI JSON candidate is `https://www.icicibank.com/content/dam/icicibank-revamp/deposits/fixed-deposits/json/fd-interest-rate.json`. Its existence in another scraper does not verify current contents, availability, or an API contract. [Adapter source](https://github.com/devesh1102/fd-rates-india/blob/7474a6479eab1d8f93bad722f9557b0c410d43f0/src/scrapers/icici.py#L14)

## Comparator audit still to complete

These are candidates for first-party inspection once access works. The table deliberately does not attribute unverified capabilities or missing features to them.

| Candidate | First-party page to inspect | Questions to answer |
| --- | --- | --- |
| BankBazaar | [Fixed deposit rates](https://www.bankbazaar.com/fixed-deposit-rate.html) | What amount, tenure, eligibility, and effective date are behind displayed headline rates? Are source links and history available? |
| Paisabazaar | [Fixed deposits](https://www.paisabazaar.com/fixed-deposit/) | Which comparison criteria are explicit? How are bank and company deposits distinguished? What booking or referral flows exist? |
| Stable Money | [Official site](https://stablemoney.in/) | Which institutions and products can a user compare? How are callable deposits, payout, eligibility, and rate dates disclosed? Which terms apply to referrals? |
| SBI | [Retail domestic term deposits](https://sbi.bank.in/web/interest-rates/deposit-rates/retail-domestic-term-deposits) | How do revised/existing columns, deposit bands, special schemes, and customer categories map to an ordinary resident deposit? |
| HDFC Bank | [Interest rates](https://www.hdfc.bank.in/interest-rates) | How are amount bands, residency, senior eligibility, special tenures, and payout terms represented? |
| ICICI Bank | [FD interest rates](https://www.icicibank.com/personal-banking/deposits/fixed-deposit/fd-interest-rates) | Which tabs and JSON fields represent callable domestic retail deposits? Which belong to other product conditions? |

Do not adopt competitor values as the production fallback just because a bank fetch failed. A competitor can help discover an official URL or flag a possible change. Publishing a value should still require its official evidence, or a clearly labeled historical evidence category.

The audit deliverable should be a small evidence matrix with inspected URLs, observation dates, screenshots or excerpts, and explicit unknowns. Do not turn an uninspected feature into an absence claim.

## Useful product decisions

These are recommendations rather than claims about competitors.

### First release after the data repair

1. An amount-and-duration comparison. Start with a resident individual, ordinary domestic INR deposit, callable FD, and general citizen category. Let the reader change age category and payout preference. Show only eligible cards, with the original tenor text beside the normalized filter result.
2. An official-page directory. Each bank needs a stable page listing the current official rate page, official PDFs or structured files, covered products, known missing products, effective date, last successful check, and current fetch status. A reader should still get a useful official link when automated parsing fails.
3. Visible last accepted evidence. A failed run retains the last accepted card and explains its age. A successful fetch with no rate change updates the check date without inventing a new rate effective date.
4. A complete-table view. Show the bank's amount bands, tenure bands, general/senior/super-senior categories when published, callable status, payout basis, product/residency eligibility, special-scheme name, and effective date. Do not collapse incompatible deposits into a single bank maximum.
5. Honest coverage. Distinguish active bank, merged predecessor, no current data, partial product coverage, historical-only data, blocked source, and retired source. A bank in the directory does not automatically count as a successfully tracked bank.

The default view should answer an everyday question such as, "For my amount, chosen maturity date, and eligibility, which published FD rates can I compare?" A separate headline-rate view may show maximums with the matching amount, tenor, and conditions on the same row.

Preserve original units and inclusive/exclusive boundaries. A bank's "one year" and "365 days" should not become interchangeable without an explicit convention. If the source or bank contract leaves a boundary unresolved, make the uncertainty visible and omit that row from exact-duration ranking.

Suggested output columns are bank, product, amount range, published tenor, annual rate, customer category, payout/callability, effective date, last verified date, and official source. The input controls carry the reader's requested amount, start date, maturity date or tenure, category, and payout preference.

### Trust and operating features

The user supplied the `mtf.trading` navigation as inspiration. Direct access to its methodology, download, and status pages was blocked, so the following are adaptations of the requested concepts. They are not an audit of how that site implements them.

| Requested concept | Practical implementation recommendation | Acceptance condition |
| --- | --- | --- |
| Methodology | Explain source priority, accepted evidence, normalization, calendar boundaries, special schemes, freshness rules, exclusions, and corrections. Version the explanation with the published dataset. | A reader can reproduce why two deposits appear in the same comparison and why another was excluded. |
| Download data | Generate current CSV/JSON and versioned history exports from the same accepted release used by the website. Include schema version, source URL, effective date, observation date, evidence type, and release hash. | Website rows and exports reconcile exactly for the same release. No fresh bank scraping occurs when someone downloads a file. |
| Calculators | Restore existing FD/RD/savings calculators first. State compounding, payout timing, tax assumption, duration convention, and unsupported conditions. Distinguish an estimate from a bank quotation. | Ordinary and boundary cases match the disclosed formula; partial or unsupported inputs never produce a misleading exact return. |
| Records | Offer source-backed rate changes and bank-specific observed highs/lows with coverage start/end and exclusions. | "Highest observed in our covered period" never becomes "highest ever" when history is incomplete. |
| RSS/JSON feed | Generate feeds from accepted changes, keyed by stable change identifiers, with source links and before/after rates. | Retries do not emit duplicate items; unchanged daily checks do not look like new rate announcements. |
| Status | Publish source-level status, last completed job, last accepted rate, last successful check, stale count, rejected candidates, and dataset release. | A healthy web server with stale collection appears as stale data, rather than a green ingestion status. |
| Daily/weekly/monthly reports | Derive changed-rate summaries from stored releases. Start with a short daily change log, then a weekly recap. | Reports reconcile to stored observations and require no additional source fetches. |
| Historical charts and merged banks | Display predecessor and successor as separate institutions connected by dated lineage events. Keep evidence gaps visible. | A pre-merger predecessor rate is never relabeled as a current successor offer. |

Existing pages should be repaired and accepted against these conditions before new routes are added. Chart style, animation, and a full visual redesign come after the dataset and filters work.

### What to defer

- Open-ended LLM financial advice, predictions, and AI-written rate extraction as an unreviewed publishing authority.
- A custom deposit booking, KYC, or payment system.
- Account-required personalized portfolios and email campaigns before reliability and hosting usage are understood.
- Large numbers of mostly empty report pages for annual, quarterly, sector, or geography navigation.
- Automatically inferred creditworthiness or a "safe bank" ranking without a defined, sourced method.

Add these only when an observed user need justifies them. A small accurate comparison is more useful than an extensive directory of empty screens.

## Inflation and citizen utility

Recommendation: label every inflation series by publisher, index, population/geography, reference period, base year, and publication date. Keep measured inflation, forecasts, and a personal spending-basket estimate separate. A personal basket is an estimate derived from its inputs, not a discovery of a hidden "real inflation" rate.

For a calculator, the inflation-adjusted annual return for compatible periods is `(1 + nominal_return) / (1 + inflation) - 1`. Convert percent inputs to decimals first. An optional after-tax scenario can use the reader's stated tax assumption, but should not claim to determine their tax liability. Monthly point-to-point CPI and an annual FD yield need explicit period alignment.

For deposit-insurance education, inspect the official DICGC coverage rules and participating institution status before publishing eligibility, aggregation, or guarantee statements. [Official DICGC site](https://www.dicgc.org.in/). This session could not verify those pages; the product plan should not make blanket "risk free" or "fully insured" claims from a bank label alone.

## Sustainability under a zero-spend constraint

No revenue is assumed in the implementation budget. The existing VPS is an available resource, not a new purchase. Confirm its available disk, unrelated workloads, backups, and hosting arrangement before assigning it a database or a commercial site.

Prefer generated downloads, feeds, reports, and calculators that reuse accepted data. Site readers should not trigger scraping, third-party API requests, or a new database write. Anonymous read-only access avoids the immediate cost and administration of customer accounts, marketing email, and payments.

Maintain shared-project budgets for every free service. A generous per-minute quota is not an entitlement to that capacity, and a rate limit is distinct from a daily/monthly allowance or financial billing control. Monetization must not depend on paying for the first quota overrun.

### Verified low-overhead funding option

GitHub Sponsors is a concrete candidate for supporting open-source maintenance:

- GitHub's documentation includes India in supported recipient regions. [Supported-region list](https://github.com/github/docs/blob/main/content/sponsors/getting-started-with-github-sponsors/about-github-sponsors.md#L85)
- Eligibility requires contribution to an open-source project and residence in a supported region. [Eligibility text](https://github.com/github/docs/blob/main/data/reusables/sponsors/you-can-be-a-sponsored-developer.md#L1)
- GitHub's current documentation says personal-account sponsorships have no GitHub Sponsors fees and organization-account sponsorships incur up to 6%. This does not establish the recipient's tax treatment or guarantee sponsorship demand. [Fee text](https://github.com/github/docs/blob/main/data/reusables/sponsors/no-fees.md#L1)
- Recipient setup requires bank and tax information, account 2FA, and GitHub review. Bank-account and residence regions must match when receiving a bank payout. [Setup guide](https://github.com/github/docs/blob/main/content/sponsors/receiving-sponsorships-through-github-sponsors/setting-up-github-sponsors-for-your-personal-account.md#L58)

Recommendation: after the repository's licensing and open-source status are settled, let maintainers accept voluntary support through an external profile. Keep data access and rankings free. Do not implement a payment processor or promise income before there is an audience.

### Future funding candidates requiring additional checks

| Option | Why it may fit | What must be established before adding it |
| --- | --- | --- |
| Voluntary project support | Small operational burden; does not require deposit transactions. | Recipient eligibility, payout setup, tax information, and the site's hosting terms. GitHub Sponsors is verified above; no other provider's India fees or payouts were verified here. |
| A clearly labeled maintenance sponsor | One sponsor can support running costs without changing user filters or rankings. | Written sponsor arrangement and commercial hosting compatibility. No estimated revenue or sponsor demand is assumed. |
| Affiliate links to a deposit platform | Could fit a reader already choosing to visit a provider. | Actual written program terms, India eligibility, supported products, approval, disclosure wording, commission triggers, reversals, payout thresholds, and attribution/privacy requirements. No public FD affiliate payout or acceptance was verified in this session. |
| A data/API service for other publishers | The collected evidence and normalized history may become useful to others. | Reliable public data first, source-use rights, allowed redistribution, a defined service contract, hosting terms, and measured demand. Keep current public downloads free. |
| Display advertising | Possible after meaningful traffic exists. | Publisher acceptance, current program policies, consent/data handling requirements, commercial hosting permission, and proof it will not make rate tables hard to use. No revenue estimate is justified yet. |

Any funded relationship must be visible beside the related link or placement. Recommendation: calculate comparison order exclusively from the reader's chosen criteria, and place sponsorship separately. Never label a sponsored offer the highest eligible rate unless the data demonstrates that result.

### Hosting and financial-services prerequisites

The Vercel Hobby documentation at [vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby) must be checked before adding advertisements, paid features, business use, or affiliate monetization. Its current terms could not be retrieved in this runtime. Do not assume that a free developer plan authorizes a commercial service. In particular, the frequently cited personal/noncommercial Hobby restriction remains a live-policy verification item here, not a freshly verified quotation.

Recommendation: retain the existing deployment while repairing the free informational site. For future commercial activity, choose an expressly permitted free commercial hosting arrangement or use the existing VPS if its terms and capacity permit it. Do not solve a zero-budget problem by silently requiring Vercel Pro. Also do not assume GitHub Pages or another free provider has no commercial restrictions.

Use [RBI](https://www.rbi.org.in/), [DICGC](https://www.dicgc.org.in/), and [SEBI regulations](https://www.sebi.gov.in/legal/regulations.html) as the primary places to verify applicable wording and services before making regulatory, advisory, insurance, or affiliation claims. Those sources were blocked here. This note does not conclude that a particular license is or is not needed. Informational comparison, a referral, personalized advice, and deposit execution are separate activities that require a scope-specific check before implementing them.

## Ordered product work and completion evidence

| Order | Work | Concrete evidence to consider it complete |
| --- | --- | --- |
| 1 | Restore collection and public data paths. | A supported representative bank refresh reaches persistence and the deployed table with the same accepted values. Repeat runs preserve history and do not manufacture rate changes. |
| 2 | Verify comparable deposit conditions. | Representative official bank tables map to documented amount, tenure, customer, residency, callability, payout, and effective-date fields. An incompatible product cannot win a default comparison. |
| 3 | Make failures legible and recoverable. | A failed collector leaves accepted values available, updates status, records the reason, and retries within the project's budget. A successful unchanged check advances freshness. |
| 4 | Repair the existing directory, calculators, coverage, and history views. | Links resolve, filters use accepted rates, merged-bank records remain historical, missing values are labeled, and calculator assumptions are visible. |
| 5 | Publish methodology and downloads. | One release hash identifies the data behind tables, exports, and methodology version. A documented correction produces an auditable change. |
| 6 | Add feed and concise reports. | Accepted events generate deduplicated feed entries and summaries from stored data without new scraping. |
| 7 | Improve visual design and accessibility. | Readers can complete amount/tenure comparisons on a phone, understand stale data, and reach the official rate page. |
| 8 | Assess funding after reliability and usage evidence exist. | Hosting permission, program eligibility, source rights, disclosure, and budget are confirmed. Core data remains freely usable. |

The consolidated implementation plan should attach these acceptance conditions to existing repository components. It should not add a second version of a calculator, history store, or status page because the first one is presently unreliable.

## Remaining research deliverables

1. Inspect the live comparator sites and complete the evidence matrix without absence claims.
2. Inspect `mtf.trading` methodology, data exports, status, and feed behavior. Keep the requested concepts but adapt only those that fit bank-deposit data.
3. Confirm Vercel's current Hobby commercial-use restriction and choose a zero-additional-spend route before monetization.
4. Verify any prospective Indian affiliate arrangement from the operator's own written terms. Exclude programs that require upfront payment.
5. Verify official deposit-insurance and regulatory statements for the exact product scope.
6. Record software, normalized-data, and underlying-document use terms separately. Publicly readable bank PDFs should not acquire an invented open-data license in our exports.
