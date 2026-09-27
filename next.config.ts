import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The site build type-checks only website code; collectors, backfill scripts and tests are
  // checked by CI (npm run typecheck), so a broken script can never block a deployment.
  typescript: { tsconfigPath: "tsconfig.next.json" },
  // Pages regenerate on the server (ISR) and read committed datasets from ./data at runtime.
  // Make sure those files ship with every server route, not only at build time.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*.json", "./data/**/*.csv"],
    "/**/*": ["./data/**/*.json", "./data/**/*.csv"],
  },
};

export default nextConfig;
