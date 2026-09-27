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
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    return { status: res.status };
  },
});
