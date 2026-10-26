import { defineComponent, h, type VNode, type VNodeChild } from "vue";
import MarkdownIt from "markdown-it";

const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  maxNesting: 20,
}).disable(["image", "table", "strikethrough"]);
type Token = ReturnType<typeof parser.parse>[number];
const tags = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "blockquote",
  "strong",
  "em",
  "a",
  "h3",
  "h4",
  "h5",
  "h6",
]);

export function releaseLink(value: string, base: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** Build only known Vue nodes. Remote markup never becomes HTML or node attributes. */
export function releaseNoteNodes(text: string, base: string): VNodeChild[] {
  const bounded = text.slice(0, 128 * 1024);
  let count = 0;
  const convert = (tokens: Token[]): VNodeChild[] => {
    const root: VNodeChild[] = [];
    const stack: {
      tag: string;
      props: Record<string, unknown>;
      children: VNodeChild[];
    }[] = [];
    const append = (value: VNodeChild) =>
      (stack.at(-1)?.children ?? root).push(value);
    for (const token of tokens) {
      if (++count > 20000) throw new Error("Release markup limit");
      if (token.type === "inline") {
        for (const node of convert(token.children ?? [])) append(node);
      } else if (token.nesting === 1) {
        let tag = token.tag;
        if (/^h[1-6]$/.test(tag)) tag = "h" + Math.min(6, Number(tag[1]) + 2);
        if (!tags.has(tag)) tag = "span";
        const props: Record<string, unknown> = {};
        if (tag === "a") {
          const value = token.attrGet("href");
          const href = releaseLink(
            typeof value === "string" ? value : "",
            base,
          );
          if (href)
            Object.assign(props, {
              href,
              target: "_blank",
              rel: "noopener noreferrer nofollow",
            });
          else tag = "span";
        }
        stack.push({ tag, props, children: [] });
      } else if (token.nesting === -1) {
        const node = stack.pop();
        if (node) append(h(node.tag, node.props, node.children));
      } else if (token.type === "code_inline") append(h("code", token.content));
      else if (token.type === "fence" || token.type === "code_block")
        append(h("pre", [h("code", token.content)]));
      else if (token.type === "hardbreak") append(h("br"));
      else if (token.type === "softbreak") append("\n");
      else if (token.type === "hr") append(h("hr"));
      else append(token.content);
    }
    return root;
  };
  try {
    return convert(parser.parse(bounded, {}));
  } catch {
    return [h("pre", bounded)];
  }
}

export default defineComponent({
  props: {
    text: { type: String, required: true },
    baseUrl: { type: String, required: true },
  },
  render(): VNode {
    return h(
      "div",
      { class: "release-notes" },
      releaseNoteNodes(this.text, this.baseUrl),
    );
  },
});
