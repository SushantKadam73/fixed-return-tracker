# Zero additional cost infrastructure for Fixed Return Tracker

Research date: 11 October 2026. Scope: collection, scheduling, storage, serving, recovery, and shared third-party quotas. This note records research and proposed implementation; it does not configure providers or deploy the application.

## Recommendation

Repair the existing collection and Convex publication path first. Run ordinary HTTP/PDF collectors on a standard GitHub-hosted Linux runner in this public repository. Use TinyFish Fetch only for sources the direct collector cannot reliably read, with a strict project allocation shared with the user's other projects. Keep the current database until measured storage, read bandwidth, or historical-query needs justify a migration. Neon is a reasonable later SQL option; migration is not a prerequisite for daily collection.

Keep a replayable archive of validated public rate facts and source manifests outside the database, and serve cached summaries with the last validated snapshot as a fallback. The user's existing VPS is an optional recovery scheduler and archive host, not a required new purchase. Do not use paid TinyFish Agent, Browser, or scheduled Monitor products in the autonomous path.

These are engineering recommendations. Provider quotas and behaviors below are separately attributed facts.

## Evidence and limitations

The environment's proxy rejected direct requests to provider websites with `Tunnel connection failed: 403 Forbidden`, including an allowed escalation. Official documentation and product source repositories on GitHub were reachable. Verified findings below therefore use first-party source documents, pinned to the commits retrieved during this research. A source repository can precede the deployed pricing page: the actual account's plan and dashboard must agree before implementation depends on the allowance.

Vercel's current deployed Hobby pricing, commercial-use terms, cron limits, and handling of automation-authored Git commits could not be independently read. They remain explicit checkpoints. The numeric TinyFish limits quoted by the user could not be found in the accessible first-party documentation; they are planning assumptions, not verified provider guarantees.

The repository was publicly visible during the check: [GitHub repository](https://github.com/SushantKadam73/fixed-return-tracker). Its manifest already uses Convex and Next.js: [package.json](../../package.json).

## Allowances and operational consequences

| Service | Allowance documented in the retrieved official source | Scope / failure behavior | Evidence status |
| --- | --- | --- | --- |
| GitHub Actions, public repository | Standard GitHub-hosted runners have free usage. Larger runners are always charged. | Public standard-runner minutes are free; avoid larger runners and unnecessary stored artifacts. | Verified: [billing source, lines 24–28 and 125–139](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/content/billing/concepts/product-billing/github-actions.md#L24-L28). |
| GitHub Actions, personal Pro private repositories | 3,000 minutes/month; 1 GB artifacts; 10 GB cache per repository. | Owner's minutes are shared across private repositories. Artifacts share their allowance with GitHub Packages; cache is separate. A personal Pro subscription does not turn an organization into a paid organization. | Verified: [quota table](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/data/reusables/billing/actions-included-quotas.md#L1-L8), [scope and storage](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/content/billing/concepts/product-billing/github-actions.md#L24-L51). |
| TinyFish SearchFree | User quotes 30 requests/minute and 500 requests/hour, at $0/request. No daily limit was supplied. | Treat as a shared account pool until account-level limits are confirmed. Do not extrapolate hourly limits into a guaranteed daily allowance. | Free Search verified; numeric limits user supplied and unverified: [official cookbook](https://github.com/tinyfish-io/tinyfish-cookbook/blob/63cd841bdfd1c2feba50f617ee81ec6be95cca37/README.md#L22-L43). |
| TinyFish FetchFree | User quotes 150 URLs/minute and 1,000 URLs/day, at $0/URL. | Budget URLs, including each URL in a batch, rather than counting only HTTP requests. Account scope, reset timezone, and treatment of cached/304/error attempts need confirmation. | Free Fetch verified; numeric limits user supplied and unverified: [official cookbook](https://github.com/tinyfish-io/tinyfish-cookbook/blob/63cd841bdfd1c2feba50f617ee81ec6be95cca37/README.md#L22-L43). |
| TinyFish Agent / Browser / Monitors | Agent and Browser are metered. Monitors cost $0.005 per completed run, including the baseline; failed Monitor runs are free. | Fetch being free does not make scheduled TinyFish Monitors or browser automation free. | Verified: [endpoint pricing](https://github.com/tinyfish-io/tinyfish-cookbook/blob/63cd841bdfd1c2feba50f617ee81ec6be95cca37/README.md#L36-L43), [Monitor definition](https://github.com/tinyfish-io/tinyfish-mcp-server/blob/e14cc69924096d193d35a448de68b5567acaed3a/docs/tools.md#L342-L359). |
| Convex Free | 0.5 GB database; 1 GB/month database I/O; 1 million function calls/month; 20 GB-hours/month action compute; 1 GB file storage; 1 GB/month file egress. | Limits generally apply per team. Database indexes count toward storage. Function calls include subscriptions, scheduled executions, and file accesses. Free has hard caps; Starter permits paid overage. | Verified: [scope](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/production/state/limits.mdx#L13-L20), [database](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/production/state/limits.mdx#L32-L40), [functions](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/production/state/limits.mdx#L81-L90), [files](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/production/state/limits.mdx#L192-L197). |
| Neon Free | 100 projects; 10 branches/project; 100 CU-hours/project/month; up to 2 CU autoscaling; 1 GB Postgres storage/project and 20 GB total; 5 GB network transfer/project/month; 5-minute scale to zero; 6-hour restore history; 1 manual snapshot. | All computes/branches in a project consume its compute pool. CU-hours or transfer exhaustion suspends compute until next billing period or upgrade. Storage cap prevents storage-increasing operations; data is not deleted. | Verified against current official website source, not the blocked deployed pricing page: [table](https://github.com/neondatabase/website/blob/fb0a72b7d112ece7d1aeeac9c061acd3669160d7/content/docs/introduction/plans.md#L44-L65), [Free FAQ and exhaustion](https://github.com/neondatabase/website/blob/fb0a72b7d112ece7d1aeeac9c061acd3669160d7/content/docs/introduction/plans.md#L610-L619). Older summaries quoting 0.5 GB differ from this source. |
| Supabase Free | 2 active free projects across organizations where the user is Owner/Admin; 500 MB database/project; 5 GB egress; 1 GB object storage; 50,000 MAU; 500,000 edge invocations; 2 million realtime messages and 200 peak connections. | Except database size, usage quotas are applied across the organization. The two-project limit spans relevant organizations. Free is not charged; availability can be restricted. | Verified: [project scope](https://github.com/supabase/supabase/blob/8617532ae1a41571d5d557cd24c6f5f2565d9230/apps/docs/content/guides/platform/billing-on-supabase.mdx#L10-L12), [quota scope/table](https://github.com/supabase/supabase/blob/8617532ae1a41571d5d557cd24c6f5f2565d9230/apps/docs/content/guides/platform/billing-on-supabase.mdx#L57-L76), [Free billing](https://github.com/supabase/supabase/blob/8617532ae1a41571d5d557cd24c6f5f2565d9230/apps/docs/content/guides/platform/cost-control.mdx#L6-L14). |
| Vercel Hobby | Exact current allowances, cron frequency, and commercial-use conditions not established in this environment. | Keep the working deployment; do not base the collector or monetization decision on assumed allowances. Verify [Hobby](https://vercel.com/docs/plans/hobby), [cron pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing), and account usage before implementation. | Unverified due to proxy denial. |
| Existing VPS | User reports 2 vCPU and 2 GB RAM. Disk, spare memory, existing services, bandwidth, uptime, and backup capacity are unknown. | Potential scheduler/browser/SQL fallback without a new subscription if existing capacity is available. | User-provided capacity; no server inspection performed. |

GitHub's billing documentation states: “If your account does not have a valid payment method on file, usage is blocked once you use up your quota.” With a payment method, budgets matter. Use a zero-spend stop budget for metered Actions products and never select larger runners. [Official over-quota behavior](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/data/reusables/billing/default-over-quota-behavior.md#L1-L3).

## Daily scheduler and recovery

GitHub Actions is a suitable primary scheduler for this public project, but scheduled execution is not an exact-time guarantee. Official documentation says runs can be delayed or dropped under high load, especially at the start of an hour; public-repository schedules are disabled after 60 days without repository activity. Schedules run from the default branch. [Delay](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/data/reusables/actions/schedule-delay.md#L1), [default branch and inactivity](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/content/actions/reference/workflows-and-actions/events-that-trigger-workflows.md#L957-L967).

Proposed scheduling:

1. Primary run at 06:17 IST daily (`47 0 * * *` in UTC). Use an offset minute to reduce top-of-hour queue contention.
2. A second scheduled invocation at 12:43 IST (`13 7 * * *`) performs a cheap health check and collects only sources not successfully checked that day. It does not rescrape every source.
3. The optional VPS watchdog checks the last completed run. If the run is overdue, it dispatches the same workflow through a narrowly scoped GitHub credential. It performs collection itself only after acquiring a lease when GitHub execution is unavailable.
4. One ingestion lock/lease covers GitHub and VPS publishers; owner, expiry, run ID, and idempotency keys are stored centrally. Concurrent fallback processes cannot race to publish conflicting revisions.
5. `workflow_dispatch` remains the manual recovery path. A public status page exposes checked time, validated time, effective date, failures, and next retry. The watchdog prevents silent long-term inactivity; do not rely on synthetic keepalive commits to satisfy the 60-day rule.

The proposed times are a design choice, not bank publication guarantees. Official source documentation uses UTC by default and permits a minimum interval of five minutes; timezone-aware features are conditional in that source. Explicit UTC expressions avoid depending on those conditional features. [Schedule syntax source](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/data/reusables/repositories/actions-scheduled-workflow-example.md#L1-L3).

A daily 10-minute job would consume approximately 300 minutes in a 30-day month if the repository became private; a 20-minute job would consume about 600 minutes. These calculations exclude CI, retries, backfills, and other projects. Public standard-runner execution does not consume a private-repository minute allowance. [GitHub billing](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/content/billing/concepts/product-billing/github-actions.md#L24-L28).

## TinyFish allocation across projects

First-party documentation confirms that Search and Fetch are free with no credit card required, and that the same key/dashboard is used. It does not establish the numeric limits, reset timezone, account-versus-key scope, or quotas available to this user's account. Treat the user's quoted quotas as the maximum planning pool and verify them using the dashboard before enabling automation. Multiple API keys must not be assumed to create separate allowances. [Official cookbook](https://github.com/tinyfish-io/tinyfish-cookbook/blob/63cd841bdfd1c2feba50f617ee81ec6be95cca37/README.md#L22-L24), [same API key](https://github.com/tinyfish-io/tinyfish-cookbook/blob/63cd841bdfd1c2feba50f617ee81ec6be95cca37/README.md#L55-L70).

Proposed initial allocations under the supplied limits:

| Budget | Fixed Return Tracker | Shared account guardrail | Why |
| --- | --- | --- | --- |
| Fetch URLs | 50 attempted URLs/day, including retries and backfills | Allocate at most 800 of the quoted 1,000/day; retain 200 for failures, other projects, and manual use | Tracker uses at most 5% of the quoted daily pool. |
| Fetch burst | At most 20 attempted URLs/minute; low concurrency per origin | Central limiter must remain below the quoted 150 URLs/minute across all projects | A daily allowance does not permit arbitrary bursts. |
| Search | 20 requests/day, normally only for broken-link rediscovery | Account limiter below both quoted 30/minute and 500/hour | Registered official URLs avoid daily search overhead. |
| Paid products | Disabled, zero project budget | No auto-top-up and no metered escalation in code | Keeps daily autonomy compatible with zero spend. |

These are proposed allocations, not provider quotas. All projects sharing the account need one ledger/limiter or explicit non-overlapping budgets. Merely reading provider usage after concurrent workers have started is insufficient to prevent overuse. Count every attempt conservatively until the dashboard establishes whether errors, cache hits, redirects, and 304 responses count against each rate window.

As an example, 50 banks with FD, RD, and savings pages create approximately 150 source URLs. Direct HTTP handles those without TinyFish allowance. If 20% require Fetch, the daily fallback uses about 30 URLs before retries, within the proposed 50/day project limit. If every page requires Fetch, 150/day exceeds the initial allocation; expand only after other projects' needs are reserved, or add a local browser adapter for permitted sources. An occasional historical backfill must have a separate bounded queue; it cannot silently consume the entire shared daily pool.

### Fetch capabilities that matter for rates

The official Fetch tool renders JavaScript-heavy pages in a real browser and supports up to 10 URLs per request. It supports HTML output, CSS selector scoping, `if_none_match`, `if_modified_since`, and returning ETag/Last-Modified metadata. [Official Fetch tool](https://github.com/tinyfish-io/tinyfish-mcp-server/blob/e14cc69924096d193d35a448de68b5567acaed3a/docs/tools.md#L55-L80).

Its documented `ttl` behavior needs explicit handling: “Omit (default) for unlimited tolerance — any cached entry is acceptable. Set to 0 to prefer a live fetch.” A successful response without a bounded freshness setting cannot establish that the bank was checked today. Set `ttl=0` or a tested bounded tolerance, inspect returned freshness metadata, and record a genuine successful check separately from content age. The tool says “prefer,” so verify actual freshness behavior with representative pages. [TTL parameter](https://github.com/tinyfish-io/tinyfish-mcp-server/blob/e14cc69924096d193d35a448de68b5567acaed3a/docs/tools.md#L74-L80).

Prefer original direct HTML/PDF for deterministic adapters. Where Fetch is necessary, use HTML or selectors that retain the complete table and footnotes. A flattened markdown table can lose merged headers, amount bands, or senior-citizen qualifications; acceptance checks must compare the complete normalized result with the official source. Do not invoke a paid Agent to compensate for a failed parser.

## Database choice and history size

| Option | Fit for this project | Decision |
| --- | --- | --- |
| Existing Convex Free | Already integrated; avoids a simultaneous ingestion repair and migration. Read bandwidth and indexes need attention when serving large historical tables. | Default for the recovery phase. Use compact cached summaries and selective indexed queries. |
| Neon Free Postgres | Natural fit for temporal rate tables, institution lineage, joins, exports, and SQL analytics. Free autoscaling/compute/transfer remain bounded, and cold starts must be handled. | Preferred migration candidate if SQL/history needs or measured Convex limits warrant it. Verify current dashboard allowances against official-source table first. |
| Supabase Free | Useful when managed auth, storage, or Postgres APIs are needed. Two free projects and low-activity pausing matter across the user's other projects. | No compelling reason to introduce it for this public rate directory alone. |
| SQL/SQLite on existing VPS | Removes cloud-DB quota dependency if the existing machine has capacity; user becomes responsible for uptime, updates, recovery, and disk health. | Optional fallback, not first repair step. Choose one authoritative writable database, not active writes to unrelated databases. |

This comparison is engineering judgment. Quota and backup facts are cited in the earlier table and next section.

Do not persist a copy of every unchanged rate every day. Persist changes to validated rate schedules; keep lightweight observations for check results and semantic hashes. A planning example with 100 banks × 100 rate rows × 4 revisions/year × 10 years is 400,000 historical rows. At an assumed 200 bytes per row, raw payload is about 80 MB before indexes, metadata, and database overhead. This is an estimate, not a benchmark or a capacity guarantee. Measure actual exports and dashboard size after representative ingestion before committing to a full historical backfill.

Likewise, 150 documents averaging 200 KB fetched daily would generate about 11 GB of raw files per year if every response were retained. Store one immutable blob per changed content hash, keep source URLs and hashes in the fact records, and keep large raw documents outside a small free database. Retain official-source evidence in the user's existing archive capacity; publish normalized public facts and links rather than indiscriminately redistributing entire bank pages or PDFs.

## Publication and recovery

Proposed publication sequence:

1. Fetch the official source and save content/evidence hashes.
2. Parse deterministic bank/product/amount/tenure/customer-category records with effective dates and source provenance.
3. Validate completeness, boundaries, rate ranges, and unexpectedly large changes. A transport success or nonempty table is not sufficient.
4. Publish a complete accepted source revision atomically and create its import manifest. A failed or partial revision never replaces the last accepted schedule.
5. Materialize current summaries, downloads, and status separately from immutable history. Website reads use cached summaries; fresh status can be checked independently without rebuilding the application for metadata-only observations.
6. Preserve validated normalized records and manifests as a replay log independent of the database. Explicitly design and validate recovery from that log.

Treat publication to Convex as the main data update. A data commit to GitHub does not by itself establish that Vercel deployed it. GitHub's `GITHUB_TOKEN` documentation states that most events emitted by that token do not create another Actions workflow run; `workflow_dispatch` and `repository_dispatch` are exceptions. This is a GitHub workflow rule, not proof of Vercel integration behavior. [Official rule](https://github.com/github/docs/blob/be38ec5d78e24172587e61b3c6ff40ace1865c71/data/reusables/actions/actions-do-not-trigger-workflows.md#L1-L6).

Before relying on snapshot commits for automatic deployment, inspect [Vercel Git deployment documentation](https://vercel.com/docs/deployments/git) and validate actual bot-author permissions and the resulting deployed SHA on this project. Do not substitute a synthetic human author to bypass an access restriction. If a fallback snapshot truly requires deployment, execute an explicit authorized deployment mechanism within the same job and verify its result, or use an authenticated deploy hook with controlled limits. These are future implementation options; neither is configured by this research.

### Backup facts

- **Convex:** manual backups are retained for 7 days; Free/Starter permits up to two stored backups per deployment. Periodic backups require a paid feature. Exporting consumes database I/O and file bandwidth/storage. Backups omit code, environment variables, and pending scheduled functions. [Official backup source](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/database/backup-restore.mdx#L17-L37), [limits and billing](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/database/backup-restore.mdx#L101-L129).
- **Neon:** Free restore history is 6 hours; scheduled backup snapshots are not available on Free. A short point-in-time window is not a long-term historical archive. [Official source](https://github.com/neondatabase/website/blob/fb0a72b7d112ece7d1aeeac9c061acd3669160d7/content/docs/introduction/plans.md#L283-L327).
- **Supabase:** official documentation recommends regular CLI exports and off-site backups for Free projects; automatic daily backups apply to Pro/Team/Enterprise. Free projects with low database activity over 7 days may pause, and a paused project can currently be restored for up to one year. Do not assume one daily collector write is a guaranteed exemption. [Backup source](https://github.com/supabase/supabase/blob/8617532ae1a41571d5d557cd24c6f5f2565d9230/apps/docs/content/guides/platform/backups.mdx#L6-L8), [pausing and restore](https://github.com/supabase/supabase/blob/8617532ae1a41571d5d557cd24c6f5f2565d9230/apps/docs/content/guides/platform/free-project-pausing.mdx#L6-L40).

Recommendation: change-driven fact replay log plus a bounded weekly full logical export, stored outside the source database. Keep public rate facts separate from any private data and credentials. Do not treat Actions caches or short-retention artifacts as the sole archive. Restore exercises must check imported counts, hashes, effective dates, and website output; the ability to download a file is insufficient evidence of recovery.

## Retries, limits, and zero-spend controls

Proposed collector controls:

- Per-origin request pacing, low concurrency, connect/read timeouts, and maximum response size.
- At most three total attempts for transient failures, with exponential backoff and jitter; honor `Retry-After` when supplied. Do not retry permanent schema errors or access denials in a tight loop.
- Direct HTTP → official alternate endpoint/PDF → bounded TinyFish Fetch → deferred retry/local adapter. Unsupported access restrictions remain visible failures. Paid tools and fabricated rates are never fallback steps.
- ETag/Last-Modified when supplied; otherwise content and normalized semantic hashes. An unchanged semantic schedule records a successful check without a duplicate historical rate revision.
- Circuit breakers per source and per provider; one failing bank cannot consume the daily shared budget or invalidate other accepted sources.
- Caps for requests, URLs, elapsed time, response bytes, publication batch size, and historical-backfill work. Budget exhaustion stops work visibly and preserves the last validated data.
- Quarantine suspicious/partial changes, preserve rejected evidence, and expose an exception needing review. Least manual intervention still permits rare review of ambiguous official wording; silently guessing qualifications is unacceptable.

These are proposed design requirements, not assertions that the current application implements them.

Convex now documents per-deployment warning and disable thresholds for daily/monthly usage; the disable threshold blocks new function calls until the window rolls over or the setting changes. Windows are UTC. Use these as emergency guardrails, with a cached public snapshot available when the database stops responding. A threshold is not a substitute for avoiding paid plans. [Official usage-limits source](https://github.com/get-convex/convex-backend/blob/13731cb3af48776bed02dbba06b04790b10ee6ec/npm-packages/docs/docs/production/usage-limits.mdx#L8-L58).

Project guardrails should be conservative beneath free-tier hard caps. Suggested warnings at 50%, 75%, and 90% of allotted monthly storage/bandwidth, with optional work stopped at 75% and backfills stopped first. These are local allocation choices. Total allowance must include other deployments/projects sharing the same provider scope.

## Required checkpoints before implementing the autonomous job

1. Confirm actual Vercel and database plan names and remaining allowance through existing account settings; Free and similarly named paid tiers must not be confused.
2. Confirm TinyFish numeric quotas, account/key sharing, reset windows, HTTP-error behavior, and lack of automatic top-up. Keep Agent/Browser/Monitors disabled.
3. Verify Vercel Hobby commercial-use policy before ads, sponsorships, or affiliate monetization. If a paid hosting tier is required by the policy, use the already owned VPS or another explicitly compatible free host; revenue cannot justify violating the user's zero-additional-cost requirement.
4. Verify Vercel automation-author deployment behavior if Git commits are part of publication. Do not depend on an untested webhook chain.
5. Budget Convex database I/O with actual representative query results and count indexes; avoid frontend subscriptions/full-history reads that consume quota per visitor.
6. Validate the registry's direct source URLs and a representative set of direct/TinyFish responses with complete table/footnote coverage.
7. Validate backup restoration and a missed-scheduler recovery path before claiming autonomous operation.

No provider credentials were requested or printed. No authenticated writes, deployments, application changes, dependency changes, or tests were performed as part of this research.
