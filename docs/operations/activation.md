# Activate autonomous collection

## One-time deployment

1. Merge the implementation pull request into `main` and let the existing Vercel deployment finish. Its build script deploys the updated Convex functions when `CONVEX_DEPLOY_KEY` is configured.
2. Confirm **Vercel Production** has `CONVEX_DEPLOY_KEY` and `REVALIDATE_SECRET`. `NEXT_PUBLIC_CONVEX_URL` is injected by the build script. It is the `.convex.cloud` URL if configured manually.
3. Confirm **Convex Production** has `INGEST_SECRET`, `REVALIDATE_SECRET` and `SITE_REVALIDATE_URL=https://fixed-return-tracker.vercel.app/api/revalidate`.
4. Confirm **GitHub repository Actions secrets** have `CONVEX_SITE_URL=https://<deployment>.convex.site` and the same `INGEST_SECRET` as Convex. Repository Actions must permit the collector's `contents: write`; branch rules must allow its data commit or publication will fail visibly.
5. Open GitHub **Actions → Collect rates → Run workflow**, branch `main`, scope `all`. Bootstrap registers banks/sources before rates arrive; final sync imports the exact committed dataset revision and exposes its manifest.
6. Read the run's collection, publication and import results. A partial source failure leaves accepted changes usable but keeps the workflow failed and the source alert visible. Authentication failures retain submissions for replay.
7. Inspect `/deposits`, a bank detail page, `/economy`, `/status`, `/data`, `/feed.xml` and `/feed.json`. Compare the download `x-data-release` header with the manifest and its checksums. A working `/health` endpoint alone does not establish successful ingestion.

Schedules run at 06:17 IST daily and 12:43 IST for catch-up. GitHub may delay schedules and can disable public-repo schedules after prolonged inactivity. Record three daily publications and then a 14-day observation period before calling the product autonomous.

Secrets do not go in Git, Markdown or chat. Generate each shared secret once (`openssl rand -hex 32`), then copy it to the matching services. Do not create new values independently on each service. The API performs no write when `INGEST_SECRET` is unset. Cache refresh is optional for collection; its credential must match when enabled.

## Local collection

```bash
npm ci --no-audit --no-fund
npx playwright install chromium
npx tsx collectors/src/run.ts --bank sbi --no-post
npx tsx collectors/src/run-macro.ts --task rbi-rates --no-post
npx tsx scripts/build-release.ts
```

`--no-post` updates only local files. Without it, `CONVEX_SITE_URL` and `INGEST_SECRET` are required. `--dry-run` parses without writing. In a cloud environment that requires an HTTP proxy, Node 24 supports `NODE_USE_ENV_PROXY=1`; that is an environment-specific setting, not a GitHub secret. This environment currently needs additional browser CDN domains published in its network settings before Chromium can be installed.

Only one bank collector can write a checkout at a time. A failed local process leaves a PID lease that the next run removes only after establishing that its owner has exited. Do not copy active lock files across machines.

## Failure recovery

- **HTTP 401:** check that the collector's secret matches Convex and the `.convex.site` deployment is correct. Pending facts remain in `data/pipeline/outbox`; the next authenticated collector invocation replays them.
- **HTTP 422 / validation failure:** candidates go to quarantine or stay rejected locally. Correct the adapter or documented source qualification; do not disable validation to force an import.
- **403 / captcha:** retain the last good data and inspect the bank's permitted official alternatives. Do not claim freshness or bypass the denial. TinyFish is not an enabled escape route.
- **5xx / timeout / quota:** bounded retries and origin circuits stop repeated attempts. Catch-up retries failed/overdue sources. The site continues serving dated last-good cards.
- **Git commit/push failure:** the failing run preserves accepted files and the outbox in a short-lived Actions artifact. Resolve branch/authentication/conflicts, then replay the normalized facts. The database may contain a newer live card than the last accepted export until publication recovers.
- **Summary/import failure:** final sync reports failure rather than silently publishing a release. Unchanged imports are skipped; re-running is safe. Bulk summaries use separate RBI-group documents.
- **Skipped schedule:** optional Convex and VPS watchdogs can dispatch the existing workflow. They do not silently satisfy source-health alerts.

## Independent watchdog on the existing VPS

The supplied `ops/vps/watchdog.py` uses Python's standard library and makes a small number of GitHub API calls every six hours. It dispatches Actions only if no collector is running and no pass has started in 26 hours. It handles scheduler recovery; it does not establish that all bank sources are healthy.

Install the repository at `/opt/fixed-return-tracker`, create a dedicated `tracker` user, and put a fine-grained repository token with **Actions: read and write** in `/etc/fixed-return-tracker/watchdog.env`. Keep that file readable only by root. Set `GITHUB_DISPATCH_TOKEN` and optionally `GITHUB_REPOSITORY` there. Install the supplied service/timer into `/etc/systemd/system`, then run `systemctl daemon-reload` and `systemctl enable --now fixed-return-tracker-watchdog.timer`. Review `journalctl -u fixed-return-tracker-watchdog.service` for dispatch results. No SSH/VPS access was available in this task, so these units have not been installed remotely.

## Recoverable data and backups

The committed normalized datasets, manifest and Git history are the durable public facts. Clone the repo to the VPS and keep a periodic `git bundle` or mirrored clone off the primary machine. Never include `.env`, private source-response caches or active lock files in public backups. An accepted release links to its exact Git commit and verifies exports with SHA-256.

After restoring a Convex deployment, run registry bootstrap and import the selected accepted revision using `DATASET_REVISION=<40-character-commit> npx tsx scripts/pipeline-control.ts sync` with the deployment's ingestion settings. Preserve the dataset's source/confidence labels and predecessor issuers. A database export can supplement this archive; the supplied code does not configure paid automatic backups or restore secrets.

## Cost controls

Use standard `ubuntu-latest` runners in this public repository, existing Convex/Vercel free plans and the already owned VPS. Measure Convex team usage and artifact retention; free allowances can be shared with other projects. Requests are bounded to 350 attempts per collector process, three transient attempts per document and two-second origin spacing. Macro runs have a separate 15-minute time budget.

TinyFish is disabled, using **0 Fetch URLs and 0 Search requests**. No Agent, Browser, Monitor, paid API or top-up path is enabled. A future optional free fallback must first verify the API contract and implement the shared allocation from the action plan: at most 50 attempted Fetch URLs/day and 20 Search requests/day for this project, including retries. Do not assume separate keys create separate allowances.
