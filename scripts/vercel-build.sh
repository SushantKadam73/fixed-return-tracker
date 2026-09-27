#!/usr/bin/env bash
# Vercel build entry point.
# - With CONVEX_DEPLOY_KEY set: deploy Convex functions first, then build the site with the
#   deployment URL injected as NEXT_PUBLIC_CONVEX_URL (one step, always in sync).
# - Without it (before Convex is set up): build the site alone; pages use the committed
#   data snapshots in /data.
set -euo pipefail
if [[ -n "${CONVEX_DEPLOY_KEY:-}" ]]; then
  npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL
else
  echo "CONVEX_DEPLOY_KEY not set — building without deploying Convex."
  npm run build
fi
