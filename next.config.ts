import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages regenerate on the server (ISR) and read committed datasets from ./data at runtime.
  // Make sure those files ship with every server route, not only at build time.
  outputFileTracingIncludes: {
    "/*": ["./data/**/*.json", "./data/**/*.csv"],
    "/**/*": ["./data/**/*.json", "./data/**/*.csv"],
  },
};

export default nextConfig;
