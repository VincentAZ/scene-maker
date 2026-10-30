import { Fragment, type ReactNode } from "react";

/**
 * A small, safe Markdown renderer for engineer replies: headings, paragraphs,
 * lists, quotes, fenced code, inline code, bold, italics and http(s) links.
 * It builds React elements only, never HTML strings.
 */
const safeUrl = (url: string) => /^https?:\/\//i.test(url.trim());
function inline(text: string, key = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern =
    /(`+)([^`]+?)\1|\*\*([^*]+?)\*\*|__([^_]+?)__|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*([^*\n]+?)\*(?!\w)|(?<![\w_])_([^_\n]+?)_(?!\w)|(https?:\/\/[^\s<>)]+[^\s<>).,;:!?'"])/g;
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[2] !== undefined) out.push(<code key={k}>{m[2]}</code>);
    else if (m[3] !== undefined || m[4] !== undefined)
      out.push(<strong key={k}>{inline(m[3] ?? m[4], k)}</strong>);
    else if (m[5] !== undefined)
      out.push(
        safeUrl(m[6]) ? (
          <a key={k} href={m[6]} target="_blank" rel="noreferrer">
            {inline(m[5], k)}
          </a>
        ) : (
          <Fragment key={k}>{m[0]}</Fragment>
        ),
      );
    else if (m[7] !== undefined || m[8] !== undefined)
      out.push(<em key={k}>{inline(m[7] ?? m[8], k)}</em>);
    else if (m[9] !== undefined)
      out.push(
        <a key={k} href={m[9]} target="_blank" rel="noreferrer">
          {m[9]}
        </a>,
      );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
type Block =
  | { type: "code"; lang: string; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "rule" }
  | { type: "paragraph"; text: string };
export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ type: "code", lang: fence[2], text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].replace(/\s#+\s*$/, "") });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: "rule" });
      i++;
      continue;
    }
    const item = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (next && /\d/.test(next[1]) === ordered) items.push(next[2]);
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length)
          items[items.length - 1] += " " + lines[i].trim();
        else break;
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: body.join("\n") });
      continue;
    }
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*(```|~~~|#{1,6}\s|>|([-*+]|\d+[.)])\s)/.test(lines[i])
    )
      body.push(lines[i++]);
    blocks.push({ type: "paragraph", text: body.join("\n") });
  }
  return blocks;
}
export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {parseMarkdown(text).map((block, i) => {
        const k = `b${i}`;
        switch (block.type) {
          case "code":
            return (
              <pre key={k} className="md-code" data-lang={block.lang || undefined}>
                <code>{block.text}</code>
              </pre>
            );
          case "heading": {
            const Tag = (block.level <= 2 ? "h4" : "h5") as "h4" | "h5";
            return <Tag key={k}>{inline(block.text, k)}</Tag>;
          }
          case "list": {
            const Tag = block.ordered ? "ol" : "ul";
            return (
              <Tag key={k}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return <blockquote key={k}>{inline(block.text, k)}</blockquote>;
          case "rule":
            return <hr key={k} />;
          default:
            return <p key={k}>{inline(block.text, k)}</p>;
        }
      })}
    </div>
  );
}
