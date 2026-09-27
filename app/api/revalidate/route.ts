import { revalidateTag } from "next/cache";
import { DATA_TAG } from "@/lib/data";

/**
 * Called by Convex after new data is stored, so cached pages refresh without a redeploy.
 * Requires `Authorization: Bearer <REVALIDATE_SECRET>`.
 */
export async function POST(request: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  revalidateTag(DATA_TAG, "max");
  return Response.json({ revalidated: true, at: new Date().toISOString() });
}
