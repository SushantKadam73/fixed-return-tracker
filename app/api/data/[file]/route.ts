import { releaseExport } from "@/lib/release";
const types: Record<string, string> = { "current.csv": "text/csv", "current.json": "application/json", "manifest.json": "application/json" };
export async function GET(_request: Request, context: RouteContext<"/api/data/[file]">) {
  const { file } = await context.params;
  if (!types[file]) return Response.json({ error: "Unknown download" }, { status: 404 });
  try {
    const { body, releaseId } = await releaseExport(file as "current.csv" | "current.json" | "manifest.json");
    return new Response(body, { headers: { "content-type": `${types[file]}; charset=utf-8`, "content-disposition": `attachment; filename="fixed-return-tracker-${file}"`, "x-data-release": releaseId, "cache-control": "public, max-age=900" } });
  } catch { return Response.json({ error: "Download is not available in this deployment" }, { status: 503 }); }
}
