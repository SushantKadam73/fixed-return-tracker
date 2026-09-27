/**
 * Make a small test fixture from a saved bank page: keep only visible text structure and
 * tables (with rowspan/colspan), drop scripts, styles, navigation, images and attributes.
 * Usage: npx tsx collectors/scripts/trim-fixture.ts <in.html> <out.html>
 */
import * as cheerio from "cheerio";
import { readFileSync, writeFileSync } from "node:fs";

/** "javascript:..." hrefs (e.g. "javascript:void(0)") only trigger a script; they're never a
 * real destination, unlike an ordinary relative/absolute link (some adapters discover linked
 * PDFs through href). */
function isScriptOnlyHref(href: string): boolean {
  return /^\s*javascript:/i.test(href);
}

/** Trim a saved bank page's HTML down to the structure adapters (and their tests) need. */
export function trimHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript,svg,img,picture,video,iframe,link,meta,form,button,select,input,nav,header,footer").remove();
  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    const keep: Record<string, string> = {};
    for (const a of ["rowspan", "colspan"]) {
      const v = $(el).attr(a);
      if (v) keep[a] = v;
    }
    if (el.tagName === "a") {
      const href = $(el).attr("href");
      if (href && !isScriptOnlyHref(href)) keep.href = href;
    }
    el.attribs = keep;
  });
  // Remove comments and empty wrappers.
  $("*")
    .contents()
    .filter((_, n) => n.type === "comment")
    .remove();
  let html2 = $("body").html() ?? "";
  html2 = html2.replace(/\n\s*\n+/g, "\n").replace(/<(div|span|section|article)>\s*<\/\1>/g, "");
  return html2;
}

const [, , input, output] = process.argv;
if (input && output) {
  const html = trimHtml(readFileSync(input, "utf8"));
  writeFileSync(output, `<!-- trimmed test fixture; source page captured ${new Date().toISOString().slice(0, 10)} -->\n<html><body>${html}</body></html>\n`);
  console.log(`${input} → ${output} (${Buffer.byteLength(html)} bytes)`);
}
