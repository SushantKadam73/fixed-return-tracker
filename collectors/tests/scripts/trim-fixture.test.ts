/**
 * Focused coverage for the trim-fixture.ts gaps: it must still drop <form> elements (already
 * true) and must now strip script-only hrefs (e.g. "javascript:void(0)") while keeping ordinary
 * links, since some adapters discover linked PDFs through href.
 */
import { describe, expect, it } from "vitest";
import { trimHtml } from "../../scripts/trim-fixture";

describe("trimHtml", () => {
  it("removes <form> elements entirely, including their contents", () => {
    const html = `<html><body><form action="/search"><input type="text" name="q"><select><option>a</option></select></form><p>Kept</p></body></html>`;
    const out = trimHtml(html);
    expect(out).not.toMatch(/<form/i);
    expect(out).not.toMatch(/<input/i);
    expect(out).not.toMatch(/<select/i);
    expect(out).toContain("<p>Kept</p>");
  });

  it("strips a javascript: href but keeps the anchor's own text", () => {
    const html = `<html><body><a href="javascript:void(0)" onclick="doThing()">this tab</a></body></html>`;
    const out = trimHtml(html);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).not.toMatch(/onclick/i);
    expect(out).toContain("<a>this tab</a>");
  });

  it("strips a javascript: href regardless of case or leading whitespace", () => {
    const html = `<html><body><a href="  JAVASCRIPT:someFn()">weird</a></body></html>`;
    const out = trimHtml(html);
    expect(out).not.toMatch(/javascript:/i);
  });

  it("keeps an ordinary relative link's href (adapters discover linked PDFs through it)", () => {
    const html = `<html><body><a href="/files/rates.pdf" class="link" data-x="y">Rate sheet (PDF)</a></body></html>`;
    const out = trimHtml(html);
    expect(out).toContain('href="/files/rates.pdf"');
    expect(out).not.toMatch(/class="/);
    expect(out).not.toMatch(/data-x/);
  });

  it("keeps an ordinary absolute link's href", () => {
    const html = `<html><body><a href="https://bank.example.com/rates">External rates page</a></body></html>`;
    const out = trimHtml(html);
    expect(out).toContain('href="https://bank.example.com/rates"');
  });

  it("still keeps rowspan/colspan and drops every other attribute", () => {
    const html = `<html><body><table><tr><td rowspan="2" class="foo" style="color:red">A</td><td colspan="3">B</td></tr></table></body></html>`;
    const out = trimHtml(html);
    expect(out).toContain('rowspan="2"');
    expect(out).toContain('colspan="3"');
    expect(out).not.toMatch(/class="|style="/);
  });

  it("still drops scripts, styles and navigation chrome", () => {
    const html = `<html><body><script>alert(1)</script><style>.a{}</style><nav>Menu</nav><header>Head</header><footer>Foot</footer><p>Kept</p></body></html>`;
    const out = trimHtml(html);
    expect(out).not.toMatch(/<script|<style|<nav|<header|<footer/i);
    expect(out).toContain("<p>Kept</p>");
  });
});
