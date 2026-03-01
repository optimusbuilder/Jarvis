import { describe, expect, it } from "vitest";
import { parseLinksFromHtml } from "../src/browserController.js";

describe("browserController helpers", () => {
  it("parses and resolves links from fixture html", () => {
    const html = `
      <main>
        <a href="/result/1">First result</a>
        <a href="https://example.org/path">Second result</a>
      </main>
    `;
    const links = parseLinksFromHtml({
      html,
      baseUrl: "http://127.0.0.1:9911/search?q=test"
    });
    expect(links).toEqual([
      { href: "http://127.0.0.1:9911/result/1", text: "First result" },
      { href: "https://example.org/path", text: "Second result" }
    ]);
  });
});
