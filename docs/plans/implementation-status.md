# Implementation status

As of 11 October 2026. This implements the first operational slice of the action plan. It does not complete all 43 tasks or establish production autonomy.

## Delivered

- Active GitHub Actions workflows for daily collection at 06:17 IST and failed/stale-source recovery at 12:43 IST. Registry bootstrap and pinned-revision import surround collection. Partial progress survives a failed source.
- Conditional HTTP caching, origin spacing, bounded retries, time/request budgets, browser reuse and a local process lease. Playwright is pinned to 1.58.2.
- Validated normalized facts, current-date selection, effective-date change detection, row-specific dates and explicit unknown withdrawal eligibility.
- Persistent authenticated delivery outbox, stable receipt IDs, rejection quarantine and retry-safe Convex ingestion.
- Partitioned bulk summaries, import error reporting, pinned accepted-release metadata and last-good website fallback.
- Source/run/macro health, dated RBI observations, separate inflation baskets, CSV/JSON downloads with checksums and change feeds.
- Savings comparison and PPF calculation corrections. Source repairs for Central Bank, YES Bank and SBI bulk FD.
- Detailed research/action plan and activation/VPS watchdog runbook. TinyFish is disabled and consumes zero quota.

## Live source evidence

129 registered bank sources were attempted. 77 most recent attempts succeeded and 52 failed. Failed fetches and changed layouts retain accepted historical cards; they do not establish fresh rates. 20 new card versions across 13 banks were accepted locally. Exports contain 6,682 current normalized rows.

RBI's homepage supplied seven current observations. These have an observation timestamp and source display date, with no invented policy-effective date. Macro collection exposed blocked/failed official sources for EPF, CPI, NPS, GPF and small savings. Separate dated policy and inflation history remains available from the committed baseline.

### Sources still failing

| Source | Latest error |
| --- | --- |
| au-sfb:savings | adapter: table not found: savings slab table |
| axis-bank:fd | adapter: Axis: "Domestic Fixed Deposits" PDF link not found on the fd-interest-rates page — layout may have changed |
| axis-bank:fd_bulk | adapter: Axis: "Domestic Fixed Deposits" PDF link not found on the fd-interest-rates page — layout may have changed |
| bandhan-bank:fd_bulk | adapter: 16 slab(s) moved by more than 2 percentage points |
| bank-of-india:fd | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| city-union-bank:fd_bulk | adapter: CUB bulk: neither Callable nor Non-Callable domestic bulk table was found |
| csb-bank:fd | fetch: blocked by Radware/ShieldSquare bot protection |
| csb-bank:fd_bulk | fetch: blocked by Radware/ShieldSquare bot protection |
| csb-bank:savings | fetch: blocked by Radware/ShieldSquare bot protection |
| dcb-bank:fd | fetch: HTTP 500 |
| dcb-bank:fd_bulk | fetch: HTTP 500 |
| dcb-bank:savings | fetch: HTTP 500 |
| dhanlaxmi-bank:fd | fetch: HTTP 500 |
| dhanlaxmi-bank:fd_bulk | fetch: HTTP 500 |
| dhanlaxmi-bank:savings | fetch: HTTP 500 |
| esaf-sfb:fd | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| esaf-sfb:savings | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| hdfc-bank:fd | fetch: HTTP 403 |
| hdfc-bank:fd_bulk | fetch: HTTP 403 |
| hdfc-bank:rd | fetch: HTTP 403 |
| hdfc-bank:savings | fetch: HTTP 403 |
| idbi-bank:fd | fetch: HTTP 503 |
| idbi-bank:fd_bulk | fetch: HTTP 503 |
| idbi-bank:rd | fetch: HTTP 503 |
| idbi-bank:savings | fetch: HTTP 503 |
| idfc-first-bank:fd_bulk | adapter: bulk PDF layout changed: section (I)/(II) markers not found |
| idfc-first-bank:savings | adapter: no "savings deposits PDF" link (matching /savings account interest rate/i) found on the interest-rate index page |
| indian-bank:fd | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| indian-bank:fd_bulk | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| indian-bank:savings | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| indian-bank:tax_saver | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| indian-overseas-bank:fd_bulk | adapter: table not found: bulk deposit table |
| indusind-bank:fd_bulk | adapter: table not found: 3–5 crore callable FD table |
| jana-sfb:bulk | adapter: two different rates for the same slab (> 6 Months - 9 Months, general); two different rates for the same slab (> 9 Months - 12 Months, general); two different rates for the same slab (> 12 Months - 24 Months, general); tw |
| kotak-mahindra-bank:fd | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| kotak-mahindra-bank:fd_bulk | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| kotak-mahindra-bank:rd | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| kotak-mahindra-bank:savings | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| punjab-national-bank:fd_bulk | adapter: PNB bulk-deposit download link not found on landing page |
| shivalik-sfb:fd | fetch: blocked by captcha |
| shivalik-sfb:rd | fetch: blocked by captcha |
| shivalik-sfb:savings | fetch: blocked by captcha |
| slice-sfb:fd | adapter: table not found: Callable Quarterly Interest Payout Fixed Deposit Upto INR 3Cr |
| slice-sfb:rd | adapter: Recurring Deposit table or its effective date not found |
| slice-sfb:savings | adapter: savings rate not found |
| suryoday-sfb:savings | fetch: browserType.launch: Executable doesn't exist at /home/agent/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell ╔════════════════════════════════════════════════════════════ |
| ujjivan-sfb:bulk | fetch: HTTP 403 |
| ujjivan-sfb:fd | fetch: HTTP 403 |
| ujjivan-sfb:rd | fetch: HTTP 403 |
| ujjivan-sfb:savings | fetch: HTTP 403 |
| union-bank-of-india:fd_bulk | adapter: effective date not found on Union Bank bulk PDF |
| yes-bank:fd_bulk | adapter: section not found: "DEPOSITS" |

## Validation and limits

Code generation, type checking, lint and the production build were run. Lint retains five existing unused-variable warnings. No tests were added or run in this implementation pass. The operational collector contacted official sources with posting disabled; authenticated production ingestion has not been exercised.

The cloud shell has no usable production Convex credentials. GitHub integration cannot inspect repository secrets, so the user's saved settings remain unverified. Chromium download was denied by this environment's network proxy; saved browser CDN additions still require environment publication. Browser-backed bank adapters were not exercised locally.

## Remaining work

1. Deploy the updated Convex functions and Vercel site, run the collector from main, inspect ingestion/publication, then observe three successful daily runs and 14 days of operation.
2. Repair remaining source exceptions, including Axis's newly split PDFs, dynamic bank pages and changed layouts. Register permitted alternate sources and source-specific browser hooks.
3. Verify current MoSPI authentication/API responses and official monthly releases; never replace missing inflation with a fabricated number.
4. Add broader historical backfill and evidence verification, merged-bank lineage, predecessor names and official archive discovery. Research identifies candidates; it is not a completed import.
5. Implement shared TinyFish quota accounting only if a verified free endpoint is selected. No paid capability is enabled.
6. Complete remaining calculator/coverage/report features from the action plan and record production free-tier usage.
7. Configure the optional existing-VPS watchdog and off-machine backups. No VPS access was available.

See [activation and recovery](../operations/activation.md) for deployment steps and [the action plan](fixed-return-tracker-action-plan.md) for the full scope.
