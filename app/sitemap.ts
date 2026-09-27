import type { MetadataRoute } from "next";
import { getBankMaster } from "@/lib/banks";
import { SCHEME_ORDER } from "@/lib/schemes";

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://fixed-return-tracker.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { banks, predecessors } = await getBankMaster();
  const pages = ["", "/deposits", "/savings", "/banks", "/schemes", "/compare", "/real-value", "/history", "/calculators", "/retirement", "/methodology", "/status", "/coverage"];
  return [
    ...pages.map((p) => ({ url: `${BASE}${p}`, changeFrequency: "daily" as const })),
    ...banks.map((b) => ({ url: `${BASE}/banks/${b.slug}`, changeFrequency: "daily" as const })),
    ...predecessors.map((p) => ({ url: `${BASE}/banks/${p.slug}`, changeFrequency: "monthly" as const })),
    ...SCHEME_ORDER.map((k) => ({ url: `${BASE}/schemes/${k}`, changeFrequency: "weekly" as const })),
  ];
}
