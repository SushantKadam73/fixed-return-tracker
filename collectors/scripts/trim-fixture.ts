/**
 * Make a small test fixture from a saved bank page: keep only visible text structure and
 * tables (with rowspan/colspan), drop scripts, styles, navigation, images and attributes.
 * Usage: npx tsx collectors/scripts/trim-fixture.ts <in.html> <out.html>
 */
import * as cheerio from "cheerio";
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output] = process.argv;
const $ = cheerio.load(readFileSync(input, "utf8"));
$("script,style,noscript,svg,img,picture,video,iframe,link,meta,form,button,select,input,nav,header,footer").remove();
$("*").each((_, el) => {
  if (el.type !== "tag") return;
  const keep: Record<string, string> = {};
  for (const a of ["rowspan", "colspan"]) {
    const v = $(el).attr(a);
    if (v) keep[a] = v;
  }
  el.attribs = keep;
});
// Remove comments and empty wrappers.
$("*")
  .contents()
  .filter((_, n) => n.type === "comment")
  .remove();
let html = $("body").html() ?? "";
html = html.replace(/\n\s*\n+/g, "\n").replace(/<(div|span|section|article)>\s*<\/\1>/g, "");
writeFileSync(output, `<!-- trimmed test fixture; source page captured ${new Date().toISOString().slice(0, 10)} -->\n<html><body>${html}</body></html>\n`);
console.log(`${input} → ${output} (${Buffer.byteLength(html)} bytes)`);
