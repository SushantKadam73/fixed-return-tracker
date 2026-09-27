/**
 * Extract HTML tables into plain grids, expanding rowspan/colspan so every row has the
 * same number of cells. Also records the nearest preceding heading/paragraph text so
 * adapters can tell "Retail FD" tables from "Bulk FD" or "NRE" tables.
 */
import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";
import { cleanText } from "./common";

export interface Grid {
  index: number;
  context: string; // heading/caption text found just before the table
  rows: string[][];
}

function cellText($: cheerio.CheerioAPI, el: Element): string {
  const c = $(el).clone();
  c.find("br").replaceWith(" ");
  c.find("sup").remove(); // footnote markers like ¹ or *
  return cleanText(c.text());
}

function precedingContext($: cheerio.CheerioAPI, table: Element): string {
  const caption = cleanText($(table).find("caption").first().text());
  if (caption) return caption;
  const texts: string[] = [];
  let node: AnyNode | null = table;
  // Walk backwards through previous siblings (and up to parents) collecting a little text.
  // A bare text node with real content stops the search too — an effective date is sometimes
  // written as plain text just above a table ("w.e.f. 16.06.2026", not inside any tag) — but a
  // whitespace-only text node (the layout indentation between two tags, extremely common) is
  // skipped over in the same step, just like a comment, so it doesn't burn through the hop
  // budget one node at a time before reaching the next real content.
  for (let hops = 0; node && hops < 12 && texts.join(" ").length < 300; hops++) {
    let prev: AnyNode | null = (node as Element).prev ?? null;
    while (prev && prev.type !== "tag" && !(prev.type === "text" && cleanText($(prev).text()) !== "")) prev = prev.prev ?? null;
    if (prev) {
      const t = cleanText($(prev).text());
      if (t && $(prev).find("table").length === 0) texts.unshift(t.slice(-300));
      node = prev;
    } else {
      node = (node as Element).parent ?? null;
    }
  }
  return texts.join(" ").slice(-400);
}

export function extractTables(html: string): Grid[] {
  const $ = cheerio.load(html);
  const grids: Grid[] = [];
  $("table").each((index, table) => {
    // Skip layout tables that contain other tables.
    if ($(table).find("table").length > 0) return;
    const out: string[][] = [];
    const pending: Array<{ row: number; col: number; text: string }> = [];
    $(table)
      .find("tr")
      .each((r, tr) => {
        const row: string[] = [];
        // Place cells carried down from rowspans above.
        for (const p of pending.filter((x) => x.row === r)) row[p.col] = p.text;
        let col = 0;
        $(tr)
          .children("th,td")
          .each((_, cell) => {
            while (row[col] !== undefined) col++;
            const text = cellText($, cell as Element);
            const colspan = Math.max(1, Number($(cell).attr("colspan") ?? 1) || 1);
            const rowspan = Math.max(1, Number($(cell).attr("rowspan") ?? 1) || 1);
            for (let c = 0; c < colspan; c++) {
              row[col + c] = text;
              for (let k = 1; k < rowspan; k++) pending.push({ row: r + k, col: col + c, text });
            }
            col += colspan;
          });
        const filled = Array.from({ length: row.length }, (_, i) => row[i] ?? "");
        if (filled.some((c) => c !== "")) out.push(filled);
      });
    if (out.length > 0) grids.push({ index, context: precedingContext($, table as Element), rows: out });
  });
  return grids;
}

/** Visible text of the whole page (for effective dates and notes outside tables). */
export function pageText(html: string): string {
  const $ = cheerio.load(html);
  $("script,style,noscript").remove();
  return cleanText($("body").text() || $.root().text());
}
