/**
 * Focused coverage for the precedingContext gap closed in html-table.ts: a bare text node
 * (no wrapping tag at all) sitting directly above a table must still be read as context, e.g. an
 * effective date written as plain text ("w.e.f. 16.06.2026") rather than inside a <p> or <span>.
 */
import { describe, expect, it } from "vitest";
import { extractTables } from "../../src/parse/html-table";

describe("precedingContext reads bare text nodes, not only tags", () => {
  it("picks up plain text sitting directly above a table", () => {
    const html = `<html><body>
      <div>
        <p>Fixed Deposit Rates</p>
        w.e.f. 16.06.2026
        <table><tr><td>7 days</td><td>4.00</td></tr></table>
      </div>
    </body></html>`;
    const [grid] = extractTables(html);
    expect(grid.context).toContain("w.e.f. 16.06.2026");
    expect(grid.context).toContain("Fixed Deposit Rates");
  });

  it("still skips purely whitespace text nodes rather than treating them as content", () => {
    const html = `<html><body>
      <p>Fixed Deposit Rates</p>


      <table><tr><td>7 days</td><td>4.00</td></tr></table>
    </body></html>`;
    const [grid] = extractTables(html);
    expect(grid.context).toBe("Fixed Deposit Rates");
  });

  it("finds nothing when there is truly no preceding text", () => {
    const html = `<html><body><table><tr><td>7 days</td><td>4.00</td></tr></table></body></html>`;
    const [grid] = extractTables(html);
    expect(grid.context).toBe("");
  });

  it("picks up a bare-text effective date sitting between two tables", () => {
    const html = `<html><body>
      <table id="a"><tr><td>Other product</td><td>1.00</td></tr></table>
      w.e.f. 01.01.2026
      <table id="b"><tr><td>7 days</td><td>4.00</td></tr></table>
    </body></html>`;
    const grids = extractTables(html);
    expect(grids[1].context).toContain("w.e.f. 01.01.2026");
  });

  it("still prefers a <caption> over any preceding text", () => {
    const html = `<html><body>
      w.e.f. 16.06.2026
      <table><caption>Retail FD</caption><tr><td>7 days</td><td>4.00</td></tr></table>
    </body></html>`;
    const [grid] = extractTables(html);
    expect(grid.context).toBe("Retail FD");
  });
});
