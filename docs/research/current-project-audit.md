# Current project audit

Inspected 11 October 2026. Repository: `SushantKadam73/fixed-return-tracker`, checkout `main` at `fe194cb` (27 September 2026). This is an audit for the next implementation plan; no application fixes, collector writes, deployments, credential changes, or database mutations were performed.

The attached working notes describe earlier intentions and completion claims. They are historical context, not instructions or proof of production operation. A passing build or old fixture tests does not prove that the scheduled collector, live database, cache refresh, or deployed website is working.

## What the checkout proves

| Measure | Observed value |
| --- | --- |
| Bank master | 49 banks: 12 public sector, 21 private, 11 small finance, 5 payments deferred |
| Merged/renamed predecessors | 39 |
| Deposit bank scope | 44 |
| Registered bank sources | 130; 129 active, 1 inactive |
| Runner assignments | All 130 assigned `github`; no assigned VPS or Convex collector |
| Formats | 103 HTML, 13 browser, 11 PDF, 3 JSON |
| Cadences | 99 daily, 31 bulk daily |
| Recorded source checks | 117; 110 ever successful, 7 with latest failure, 13 without any check (including the inactive source) |
| Last successful checks | All fall on 27 September 2026, between 09:38:21 and 10:54:50 UTC; about 14 days old |
| Current FD cards | 37/44 banks |
| Current RD cards | 20/44 banks; absence is not proof that every missing bank offers RD |
| Current savings cards | 36/44 banks |
| Current bulk FD cards | 25/44 banks; bulk availability must be confirmed per bank |
| Tax saver cards | 3 banks |
| Rate history | 141 bank/product files, 643 cards |
| SBI FD history | 101 cards: 91 bank archive, 7 press, 2 web archive, 1 live official |
| SBI savings history | 10 cards: 9 bank archive, 1 live official |
| Savings slab method | 12 incremental, 6 whole balance, 18 unknown |
| Data size | 8,962,437 bytes total; rate files 4,463,721; snapshots 3,208,166 |
| Product summary JSON sizes | FD 325,318 bytes; bulk 878,437; RD 102,619; savings 30,965 |
| Current coverage snapshot | Generated 27 September 2026 |

Missing current FD banks: Bank of India, ESAF, IDBI, Indian Bank, J&K Bank, Kotak Mahindra, Suryoday. Seven latest failures concern ESAF FD/savings (HTTP 403), Suryoday savings (HTTP 502), and IDBI FD/RD/savings/bulk (HTTP 502). These are recorded historical failures, not fresh requests to those banks.

Twelve active sources have no stored check. Nine use the browser format (Bank of India FD; Indian Bank FD/bulk/savings/tax saver; Kotak FD/bulk/RD/savings), and three are J&K HTML sources. Suryoday FD is explicitly inactive because the rates require clicking a tab, an interaction the current browser fetcher does not support.

Sources for these counts are `data/banks/banks.json`, `data/sources/sources.json`, `data/rates/_checks.json`, `data/macro/_checks.json`, and `data/snapshots/*.json`. Counts were calculated by parsing existing JSON without writing it.

## Most likely reason updates stopped

**P0 — The checkout contains no executable GitHub workflow.** `git ls-files '.github/*'` returns nothing. The two YAML files are under `ops/workflows/`; the collector template explicitly says `# Copy to .github/workflows/collect.yml` at [ops/workflows/collect.yml](../../ops/workflows/collect.yml#L1). GitHub does not schedule workflows from `ops/`. The README's deployment procedure still requires a manual copy.

This explains why the requested repository cannot schedule these collectors from its current main branch. A read-only `git ls-remote origin refs/heads/main` returned the same full SHA as local HEAD, `fe194cb18b93f139ca3148563cc71e38609da8a5`, so the missing workflow files are also established for remote main. The actual Vercel deployment SHA, Actions settings, GitHub secrets, Convex configuration, and Vercel configuration remain unverified. Direct requests to the deployed site and GitHub API were blocked by the cloud network proxy with `Tunnel connection failed: 403 Forbidden`.

**Acceptance:** install a committed workflow in `.github/workflows/`; prove a manually dispatched run and a later scheduled run complete; record distinct daily and bulk run receipts; verify a real source check changes on the website without manual data entry. Check production secrets by name/presence and read-only health responses; do not assume missing access from a CLI prompt.

## Priority findings and acceptance criteria

Severity: **P0** prevents the primary workflow; **P1** can silently publish incorrect data or hide an outage; **P2** weakens completeness, resilience, or cost control. Findings explicitly marked conditional are defects demonstrated in code, whose occurrence in production was not verified.

### P1 — Delivery failures can look like successful collection

- Evidence: [collectors/src/run.ts](../../collectors/src/run.ts#L48) returns `{ status, body }` from `postToConvex` without checking `res.ok`; callers at lines 113 and 158 ignore that result. Missing `CONVEX_SITE_URL`/`INGEST_SECRET` silently skips publication. A transport exception is only a warning, while local `lastSuccessAt` is still updated at line 123. There is no persistent queue or publication retry.
- Impact: a workflow can scrape and store local data while Convex remains stale; `/run-complete` delivery can fail invisibly. Retrying scraping is unnecessary when only publication failed.
- Acceptance: track collection, validation, persistence, and publication separately; require acknowledged ingest; retry only retryable errors with bounded backoff; preserve a durable outbox keyed by bank/product/evidence version; never mark publication success for HTTP 401/403/429/500 or skipped required configuration.

### P1 — Empty cards reset failures and falsely refresh sources

- Evidence: [convex/ingest.ts](../../convex/ingest.ts#L161) loops over zero cards and records `unchanged`; lines 172–178 stamp `lastSuccessAt` and reset failures. In-memory invocation with `cards: []` and a source previously failing twice produced `outcome: unchanged`, `consecutiveFailures: 0`, and a new success timestamp. The bank runner at [collectors/src/run.ts](../../collectors/src/run.ts#L97) also filters future cards away before recording success.
- Impact: layout failures that yield no usable data, or only future announcements, can be counted as successful checks even though today's rates were not verified.
- Acceptance: model `unchanged_verified`, `future_only`, `no_usable_card`, and failure separately; require expected product coverage before refreshing current-rate health; keep future announcements as scheduled versions.

### P1 — CPI authentication is obtained but unused

- Evidence: [collectors/src/macro/cpi-combined.ts](../../collectors/src/macro/cpi-combined.ts#L60) retrieves a token, but line 72 uses `ctx.fetch(token ? url : url, "json")`; both branches are identical. `MacroTaskContext.fetch` at [collectors/src/macro/types.ts](../../collectors/src/macro/types.ts#L87) has no request-init/header argument.
- Reproduction: a fake login returned a synthetic token; the subsequent fetch received only URL and format, with no authorization header. No real credential was read or printed.
- Impact: supplying MoSPI credentials cannot unlock authenticated access; the code's documented unauthenticated first-10-record limit still applies.
- Acceptance: validate the actual official API contract, send its required authentication, validate pagination and Combined/all-India filters, and prove the latest expected publication is present. Record missing credentials as a requirement only after checking existing binding names/presence.

### P1 — CPI and RBI can report healthy during total data failure

- Evidence: [collectors/src/macro/cpi-combined.ts](../../collectors/src/macro/cpi-combined.ts#L83) changes complete fetch failure to `ok: true`. [collectors/src/macro/rbi-rates.ts](../../collectors/src/macro/rbi-rates.ts#L77) sets success before checking whether any required rate was parsed.
- Reproduction: both MoSPI login and data requests threw synthetic HTTP 502; result was `ok: true`, two failed attempts, zero changes. An empty RBI homepage returned `ok: true`, zero changes, six warnings.
- Impact: [collectors/src/run-macro.ts](../../collectors/src/run-macro.ts#L122) clears failures and refreshes `lastSuccessAt`, so missing inflation/policy data does not trigger failure. Existing committed CPI-Combined data ends June 2026 and CPI-IW July 2026; this requires checking official releases, not treating old points as current.
- Acceptance: separate fetch success, schema validation, coverage, expected release period, and unchanged data. Show stale/degraded status on an upstream outage; never stamp a source verified when all required fields are absent.

### P1 — RBI event history confuses observation date with effective date

- Evidence: [collectors/src/macro/rbi-rates.ts](../../collectors/src/macro/rbi-rates.ts#L97) uses the homepage's `As at` date, or the run date, as the event's point date. This is a display timestamp, not proof of the MPC decision's effective date.
- Reproduction: a synthetic homepage saying `As at 4:00 pm of October 11, 2026` with a changed repo rate generated a repo event dated `2026-10-11`, without any effective-date evidence.
- Impact: a missed run backdates history incorrectly to discovery day; CRR changes can have different effective dates. Reverse repo is omitted from `SERIES_FOR` (lines 15–24), although `data/series/rbi_reverse_repo_rate.json` exists.
- Acceptance: persist separate announced/effective/observed dates and cited MPC/reserve notification documents; classify unchanged legacy reverse repo separately from SDF; identify uncertainty honestly when effective-date evidence is unavailable.

### P1 — Official revisions are never applied

- Evidence: [collectors/src/macro/cpi-combined.ts](../../collectors/src/macro/cpi-combined.ts#L58) excludes known months; [collectors/src/macro/store.ts](../../collectors/src/macro/store.ts#L219) refuses any existing point date. [convex/seed.ts](../../convex/seed.ts#L217) ignores stored-card corrections when hash/date identity is unchanged.
- Reproduction: in-memory import of an existing real SBI card with a corrected `validTo` generated `{ inserted: 0 }` and zero writes.
- Impact: CPI provisional-to-final revisions and corrected provenance/end dates can remain permanently stale. The schema permits provisional/final `status`, but the series import drops tuple metadata at seed lines 174 and 334.
- Acceptance: store revision identity, publication time, superseded evidence, and status; apply official corrections while keeping an audit record. Do not overwrite silently or reject legitimate revisions solely because the period already exists.

### P1 — Repo import can activate future rates

- Evidence: [convex/seed.ts](../../convex/seed.ts#L273) selects newest official card without checking its effective date. The live ingest guard at `convex/ingest.ts:165` is absent on the repo import path. Snapshot selection at [collectors/src/snapshots.ts](../../collectors/src/snapshots.ts#L58) also takes the final official card without a current-date guard.
- Reproduction: in-memory `finalizeProductCards` with an old current card and a synthetic card effective `2099-01-01` patched the old card to `isCurrent: false` and the future card to `isCurrent: true`.
- Impact: future announcements added through backfill/import can appear current. No future current card was claimed to exist in the committed dataset.
- Acceptance: use one shared date/evidence-aware current-card selector for live ingestion, repo import, snapshots, and queries; save pending rates and activate them only when due.

### P1 — Savings returns are ranked using an unverified rule

- Evidence: 18/36 current savings cards have `slabMethod: unknown`. [components/savings/savings-comparison.tsx](../../components/savings/savings-comparison.tsx#L31) substitutes whole-balance, calculates a numeric return, and sorts it with verified results. [lib/calc/deposits.ts](../../lib/calc/deposits.ts#L99) also treats unknown as whole-balance.
- Reproduction: the actual Union Bank card at ₹1 crore yields annual estimates ₹257,448.82 if whole-balance, versus ₹254,924.81 if incremental. The calculation proves the assumption matters; it does not establish Union's actual rule.
- Impact: numerical rankings imply accuracy unsupported by source evidence. All banks also default to quarterly crediting despite the UI acknowledging some pay monthly.
- Acceptance: verify bank policy/terms for method and credit frequency; show `method not verified` or explicitly bounded scenarios when unknown; exclude uncertain return estimates from verified rankings. Show an annual yield only if it includes the stated credit convention.

### P1 — Live empty/stale summaries suppress usable fallback data (conditional production issue)

- Evidence: [lib/data.ts](../../lib/data.ts#L55) accepts any existing Convex summary before checking payload completeness/freshness, even `{ banks: {} }`. It falls back only on absence/exception. [convex/summaries.ts](../../convex/summaries.ts#L111) requires the bank master to exist before adding the collected card; an unseeded bank can create an empty current summary. `scripts/vercel-build.sh` deploys functions but does not execute the initial dataset import.
- Impact: enabling Convex during incomplete seeding can make already populated snapshot pages appear empty. A reachable stale database can hide a newer committed snapshot.
- Acceptance: confirm deployment bootstrapping order; validate each read-model shape and coverage; show data origin and actual observed time; compare freshness using explicit policy, preserve last good data, and surface degraded live reads. Verify this against the deployed environment before assigning it as the actual current outage cause.

### P2 — `/status` does not show stale sources or macro health

- Evidence: [app/status/page.tsx](../../app/status/page.tsx#L12) reads committed bank check files, never the available live [convex/public.ts](../../convex/public.ts#L55) status query. At line 50, every nonfailing stored check is `ok` regardless of age. Macro checks and alerts are absent. The savings comparison does not display staleness even though `observedAt` is passed to it.
- Impact: September checks can be displayed as OK in October; live failures or alerts can disagree with the website. Repo snapshots need a deployment before local health changes appear.
- Acceptance: one public health model includes bank and macro jobs, actual last checked/changed/verified times, expected release cadence, runner, publish status, alerts, and data origin; prove simulated missed schedules become stale without a code deployment.

### P2 — Watchdog lets bulk or failed runs mask missing daily collection

- Evidence: [collectors/src/run.ts](../../collectors/src/run.ts#L158) reports both daily and bulk runs as job `collect`; [convex/watchdog.ts](../../convex/watchdog.ts#L19) returns the latest job's start time with no success/scope predicate. A recent timestamp makes the watchdog clear its alert at lines 48–50.
- Reproduction: an isolated handler with a fresh timestamp returned `{ overdue: false }` without any source coverage/status check.
- Impact: a successful bulk subset, a total failure, or an empty selection can satisfy the heartbeat while daily retail, savings, and macro updates stop. A partial run also resolves `run_failed` (`convex/monitor.ts:52`).
- Acceptance: distinct expected daily/bulk/macro run keys; require completed coverage thresholds; validate scheduled time windows; retry dispatch with a timeout and record result; avoid an endless restart loop for permanent parser/configuration failures.

### P2 — Browser sources lack the HTTP fetcher's resilience

- Evidence: [collectors/src/fetch.ts](../../collectors/src/fetch.ts#L55) launches a new browser for every source, calls `goto(networkidle)` then `content`, and returns whatever status/content it receives. Line 74 returns before host politeness, HTTP error handling, bounded retry, and challenge detection. No tab click/selector wait exists.
- Impact: the 13 browser sources cannot use documented per-source interactions; browser 403/challenge pages can look like parse errors; repeated browsers increase resource use. Suryoday FD's inactive registry note documents this exact missing interaction.
- Acceptance: reuse a bounded browser pool; add source-specific interaction/readiness recipes; apply host budgets, timeouts, challenge/status validation, and retries across all fetch formats; keep an official HTTP/PDF/API route preferable when available.

### P2 — No conditional fetch, shared-page cache, or automatic runner fallback

- Evidence: [collectors/src/fetch.ts](../../collectors/src/fetch.ts#L20) provides a 1.5 second per-host gap and three retries with 2/4/8 second delays; there is no ETag/Last-Modified handling, Retry-After, jitter, circuit breaker, bounded response-size check, shared daily fetch cache, or persistent retry budget. All source assignments remain GitHub. `run.ts:137` selects by runner; it does not automatically fall through to VPS/TinyFish.
- Impact: unchanged pages and repeated shared pages are fully fetched, quota/resource use is not controlled across projects, and a blocked GitHub runner requires manual source edits. This is an unfinished resilience design, not a reason to scrape user-facing pages on every request.
- Acceptance: deduplicate URLs/linked documents per run, use conditional HTTP when supported, hash the relevant rate content, retry transient failures only, use an official fallback ladder with an explicit budget, and keep the last good card with visibly degraded freshness. Honor source access policies through enforceable configuration; `robotsAllowed` currently exists only as metadata.

### P2 — Direct publication and repo persistence can diverge

- Evidence: [collectors/src/run.ts](../../collectors/src/run.ts#L108) calls the repo store, which normalises via [collectors/src/store.ts](../../collectors/src/store.ts#L108), but line 113 posts the original adapter `cards`, including locally rejected ones. The DB repeats validation, but not repo normalisation. The two summary builders are separate implementations despite `lib/summary-build.ts` saying they share pure functions.
- Impact: duplicate row/amount boundary corrections produce different hashes in the two stores; live and imported versions can disagree. Delayed repo imports are another reconciliation path, with no end-to-end publication receipt.
- Acceptance: one canonical validated card representation, one natural key plus revision identity, a transactional batch/outbox, explicit rejection result, and a reconciliation check that a committed source version equals the database and served read model.

### P2 — Validation does not prove table completeness or savings correctness

- Evidence: [lib/validate.ts](../../lib/validate.ts#L46) checks a few scalar ranges and duplicate FD keys. It does not validate minimum amount/balance nonnegativity, date validity, savings slab overlap/gaps, expected customer/amount coverage, or source/product ownership. Savings are excluded from the previous-row count/jump check at line 74.
- Reproduction: replacing the actual SBI savings slab with a negative `balanceMin: -100` produced no validation issues. This is a boundary-validation probe; no bad card was persisted.
- Additional evidence: the parent research audit ran `npm run audit:rates` once, which reported 29 issues: 15 missing source/product cards, 10 overlaps, 4 tenure holes, and exited 0. Source absence can be a coverage gap; overlaps/holes require investigating official boundaries. That CLI cannot presently serve as a failing CI quality gate.
- Acceptance: validate date/amount/slab dimensions and source ownership; source-specific expected coverage checks; attach severity; quarantine questionable changes; make the audit return failure for actionable errors while distinguishing verified missing offerings from failed collection.

### P2 — Calculators cannot yet claim bank-specific exactness

- Evidence: [lib/calc/deposits.ts](../../lib/calc/deposits.ts#L11) uses a uniform 365-day year and 365/4-day quarters; the UI approximates months at 365/12 rather than taking actual deposit/maturity dates. [lib/calc/retirement.ts](../../lib/calc/retirement.ts#L95) credits PPF interest when simulation stops, even when that is not March; EPF similarly credits at the stop month. The PPF monthly entry has no enforced annual cap or deposit-day option.
- Reproduction: an April-only PPF simulation accepted a ₹20,000 monthly deposit and reported ₹118 credited interest/balance ₹20,118 immediately; the function itself documents annual credit on 31 March. Accrued entitlement and posted account balance are not distinguished.
- Impact: estimates can be useful but must not imply the exact bank credit schedule or a legally eligible plan. Tax/TDS and bank penalties are prose rather than active modelling.
- Acceptance: keep simple estimates clearly labelled; add bank/day-count/credit conventions and dates; separate accrued and credited interest, validate PPF contribution limits, and verify representative calculations against official calculators/notifications before calling them exact.

### P2 — Unknown deposit conditions can enter verified comparison results

- Evidence: [lib/tenure.ts](../../lib/tenure.ts#L74) only rejects a callable mismatch when the source row's `callable` is non-null. A row with `callable: null` qualifies for either a callable or a non-callable filter. Deposit comparison defaults to the callable filter (`components/deposits/deposit-comparison.tsx:43`) but can therefore include deposits with an unverified withdrawal condition. Payout variants are not an explicit comparison filter.
- Impact: unknown is presented as eligible, and readers cannot consistently compare a single payout convention.
- Acceptance: distinguish verified eligible, verified ineligible, and eligibility unknown; show uncertainty with a clear source condition; retain exact source dimensions and offer cumulative/payout filters where bank data supports them.

### P2 — Large bulk summary and full rewrites create free-tier pressure

- Evidence: one bulk summary already contains 4,200 rows and 878,398 bytes of compact payload; [convex/summaries.ts](../../convex/summaries.ts#L106) reads and rewrites every product document on each bank refresh, even unchanged products. `seed.importAll` rewrites bank/source/scheme data daily, whereas only rate/series files use content hashes.
- Impact: today's database size is small; aggregate document size and repeated I/O can become the first limit as missing banks/history are added. Do not assume total JSON size is the same as database billed storage or bandwidth.
- Acceptance: measure real storage/transfer usage; partition current bulk cards by bank or amount tier; write only changed read models; hash imports; publish download/history artifacts separately; choose any database migration from measured requirements, rather than changing Convex solely because it is already present.

## Useful existing components to preserve

- All 44 deposit-bank adapters and a source registry exist. This is a substantial base to harden rather than replace wholesale.
- The repo stores appendable, sourced rate cards; content hashing suppresses repeated rate versions; failures retain the last good cards.
- There are historical source/confidence labels, merged-bank lineage, normalized and exact tenure filters, amount/customer/residency/callability fields, source links, FD/RD tools, scheme history, and coverage views.
- Convex write endpoints require an ingest secret; read models and a tag-revalidation endpoint already exist.
- The HTTP fetcher has bounded retry/backoff, timeouts, per-host spacing, PDF extraction, and challenge recognition.
- Government scheme tasks have several official-source fallbacks, and future scheme periods are supported by the scheme status model.

## Implementation sequence implied by the audit

1. **Restore the delivery chain:** verify deployed configuration; install active workflows; seed deliberately; prove fetch → validate → database → website → correct source timestamp. Include a source directory entry even for each currently missing bank.
2. **Make failures truthful:** distinct run receipts, publish acknowledgment, macro health, empty-card rejection, age-aware status, and visible fallback origins.
3. **Correct financial evidence:** CPI auth/revisions, RBI effective-date evidence/reverse repo, unified pending/current selector, savings slab rules and credit frequency, source-specific validation.
4. **Reduce routine work/cost:** shared conditional fetches, retry budgets/outbox, browser recipes and pool, official source alternates, limited VPS fallback, aggregate quota accounting, changed-only summaries/imports.
5. **Extend useful history and exports:** preserve known official/secondary evidence and merger identity; archive-first backfills; expose raw normalized CSV/JSON, methodology/version/status feeds, and honest gap coverage. The checkout currently has no RSS/JSON feed/download routes of the requested kind.
6. **Improve calculators after data correctness:** dates, conventions, accrual/credit separation, eligibility/tax notes with versioned rules, and official-case verification. Visual redesign follows reliable daily data.

## Reproduction boundary

Counts used read-only Python JSON inspection. Additional probes invoked existing pure parsers/tasks or internal handlers with synthetic in-memory contexts. Synthetic credentials were local dummy strings and never transmitted. No collector command that writes rate files was run; no real Convex mutation, GitHub dispatch, Vercel revalidation, or deployment was requested. Network probe failures identify environment access restrictions and must not be described as bank/upstream outages.
