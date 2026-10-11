import { releaseExport } from "@/lib/release";
export async function GET() {
  try { const { body, releaseId } = await releaseExport("feed.xml"); return new Response(body, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=900", "x-data-release": releaseId } }); }
  catch { return Response.json({ error: "Feed not generated" }, { status: 503 }); }
}
