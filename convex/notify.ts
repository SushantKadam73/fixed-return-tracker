/**
 * Outbound notifications: ask the website to refresh its cached pages after data changes.
 */
import { internalAction } from "./_generated/server";

export const revalidateSite = internalAction({
  args: {},
  handler: async () => {
    const url = process.env.SITE_REVALIDATE_URL; // e.g. https://<your-site>.vercel.app/api/revalidate
    const secret = process.env.REVALIDATE_SECRET;
    if (!url || !secret) return { skipped: "SITE_REVALIDATE_URL or REVALIDATE_SECRET not set" };
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) });
        if (res.ok) return { status: res.status };
        if (res.status < 500 && res.status !== 429) throw new Error(`Website revalidation failed (HTTP ${res.status})`);
      } catch (error) {
        if (attempt === 2 || (error instanceof Error && /revalidation failed/.test(error.message))) throw error;
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
    throw new Error("Website revalidation exhausted its retry budget");
  },
});
