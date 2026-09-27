# Fixed Return Tracker

A free, self-updating website for Indian savers that tracks every fixed-return option in one place:

- **Bank deposits** — FD, RD and savings account interest rates for 44 banks (SBI and nationalised banks, domestic private banks, small finance banks), with every rate condition: tenure, amount band, senior/super-senior citizen, callable or not, payout option, and special tenures such as 444 days.
- **Full history** — each bank's rates as far back as records exist: the RBI-prescribed era (all banks), bank archives, and web-archive copies of the banks' own rate pages, each labelled with its evidence.
- **Government schemes** — PPF, SSY, SCSS, NSC, KVP, Post Office deposits, EPF, VPF, GPF and RBI Floating Rate Savings Bonds.
- **Real value of money** — inflation-adjusted amounts, real interest rates, and "what it felt like" comparisons.
- **Tools** — FD/RD/savings calculators, a fund comparison and a retirement simulator (PPF, EPF, VPF, NPS).

Every figure shows its source and an "as of" date. Missing data is shown as *not reported*, never as zero, and nothing is interpolated.

> Payments banks (tracked through their savings rates and partner-issued FDs), regional rural banks, foreign banks and local area banks are planned for later releases.

## How it works (in plain terms)

```
 Bank websites, RBI, Govt sources          GitHub Actions (daily)             Convex (database)            Vercel (website)
 ─────────────────────────────────   ──►   collectors read each page  ──►   stores versioned rate  ──►   pages read small
 official rate pages & files               and turn tables into data        cards + history, checks      pre-computed summaries,
                                           (validated before sending)       freshness, raises alerts     refreshed after changes
```

- **Collectors** (`collectors/`) read each bank's official rate page and convert it into a *rate card*. They check the result (plausible rates, no half-read tables) before sending it to Convex.
- **Convex** (`convex/`) is the database. A new card is stored only when rates actually change; the previous card gets an end date, so history is never lost. Convex also watches for stale sources and opens alerts.
- **The website** (`app/`) is Next.js on Vercel. It reads compact summaries, caches them, and refreshes only when Convex reports new data — keeping everything inside free tiers.
- If Convex is not configured yet, the site falls back to the data snapshots committed under `data/`.

Scheduled work runs on Convex and GitHub Actions. A VPS is used only as a last resort for sites that block both.

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS v4 · Convex · Recharts · Vitest · deployed on Vercel.

## Project layout

| Path | What lives there |
| --- | --- |
| `app/` | Website pages |
| `components/` | Shared UI pieces |
| `lib/` | Domain types, formatting (₹ lakh/crore, IST), tenure buckets, calculators, validation |
| `convex/` | Database schema, ingestion, summaries, monitoring, scheduled jobs |
| `collectors/` | Bank-page adapters and the runner used by GitHub Actions |
| `data/` | Committed datasets (bank master list, histories, snapshots) |
| `scripts/` | Build and maintenance scripts |
| `ops/workflows/` | GitHub Actions workflows to copy into `.github/workflows/` |
| `tests/` | Unit tests |

## Local development

```bash
npm install
npm run test        # unit tests
npm run typecheck   # TypeScript
npm run dev         # website at http://localhost:3000 (uses data/ snapshots without Convex)
npx convex dev      # optional: connect your own Convex dev deployment
```

`npm run codegen` regenerates `convex/_generated` without a deployment (useful in CI); `npx convex dev` does the same with a live deployment.

## Deployment setup (one time)

1. **Convex** — create a project at [dashboard.convex.dev](https://dashboard.convex.dev), then in *Settings → Deploy keys* create a **Production deploy key**. In *Settings → Environment variables* add `INGEST_SECRET`, `REVALIDATE_SECRET` and `SITE_REVALIDATE_URL` (see `.env.example`).
2. **Vercel** — import this repo at [vercel.com/new](https://vercel.com/new). Add `CONVEX_DEPLOY_KEY` and `REVALIDATE_SECRET` as environment variables. The build command in `vercel.json` deploys Convex and the site together.
3. **GitHub Actions** — copy the files in `ops/workflows/` into `.github/workflows/` (GitHub web UI → *Add file*), and add the repository secrets `CONVEX_SITE_URL` and `INGEST_SECRET`.

## Data principles

- Official sources first: each bank's own rate page, RBI, Ministry of Finance / National Savings Institute, EPFO, MoSPI.
- Each rate carries its source URL, the source's effective date and the date we read it.
- Historical figures are labelled by evidence type (bank website, bank archive, web archive, RBI-prescribed, RBI data, exchange filing, press report).
- Descriptive, not advisory: the site shows what banks publish; it never recommends a bank or product.

## Disclaimer

Rates are reproduced from public sources for information only. Always confirm the current rate and terms with the bank before investing. This project is not affiliated with any bank, RBI or the Government of India, and is not investment advice.
