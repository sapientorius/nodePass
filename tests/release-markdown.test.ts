import { describe, expect, it } from "vitest";
import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import ReleaseNotes, {
  releaseLink,
} from "../packages/web/src/components/ReleaseNotes";
const base =
  "https://github.com/sapientorius/nodePass/releases/tag/nodepass-v0.3.0";
const render = (text: string) =>
  renderToString(createSSRApp(ReleaseNotes, { text, baseUrl: base }));
describe("safe release Markdown nodes", () => {
  it("renders headings, lists, emphasis, quotes and code as escaped Vue nodes", async () => {
    const html = await render(
      "# Heading\n\n**strong** and *emphasis* with `code`\n\n- one\n- two\n\n> quote\n\n```html\n<script>alert(1)</script>\n```",
    );
    for (const fragment of [
      "<h3>",
      "<ul>",
      "<li>",
      "<strong>",
      "<em>",
      "<code>",
      "<blockquote>",
      "<pre>",
    ])
      expect(html).toContain(fragment);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
  it("blocks raw HTML, images, embeds and event handlers without introducing DOM attributes", async () => {
    const html = await render(
      '<img src="https://evil.test/pixel" onerror="alert(1)">\n\n![remote](https://evil.test/pixel)\n\n<iframe src="https://evil.test"></iframe>\n\n<svg onload="alert(1)"></svg>',
    );
    expect(html).not.toMatch(/<(?:img|iframe|svg|script|style)\b/i);
    expect(html).not.toMatch(/<[^>]+\son(?:error|load)=/i);
    expect(html).not.toContain('src="https://evil.test');
  });
  it("allows only explicit HTTPS links with no opener or referrer", async () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///secret",
      "http://evil.test",
      "https://user:pass@evil.test",
      "mailto:a@b",
      "https://[",
    ])
      expect(releaseLink(value, base)).toBeNull();
    expect(releaseLink("/sapientorius/nodePass/issues/1", base)).toBe(
      "https://github.com/sapientorius/nodePass/issues/1",
    );
    const html = await render(
      "[safe](https://example.test/path)\n\n[unsafe](http://evil.test)\n\n[javascript](javascript:alert%281%29)",
    );
    expect(html).toContain('href="https://example.test/path"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).not.toContain('href="http:');
    expect(html).not.toContain('href="javascript:');
  });
  it("bounds pathological content while retaining an escaped readable fallback", async () => {
    const html = await render("**x** ".repeat(10000) + "<script>bad</script>");
    expect(html).toContain("<pre>");
    expect(html).not.toContain("<script>");
  });
});
