import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, parseMarkdown } from "../src/code/markdown";
import { parseDiff } from "../src/code/diff";
import { transcriptRows } from "../src/CodingAssistant";
import type { TranscriptEntry } from "../shared/coding";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }));
describe("engineer replies", () => {
  it("renders common Markdown safely", () => {
    const html = render(
      "## What changed\n\n- **Server**: added `POST /api/attachments`\n- see [docs](https://example.com)\n\n```ts\nconst a = 1;\n```\n\n<script>alert(1)</script> [bad](javascript:alert(1))",
    );
    expect(html).toContain("<h4>What changed</h4>");
    expect(html).toContain("<strong>Server</strong>");
    expect(html).toContain("<code>POST /api/attachments</code>");
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noreferrer">docs</a>');
    expect(html).toContain('<pre class="md-code" data-lang="ts"><code>const a = 1;</code></pre>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('href="javascript');
  });
  it("keeps ordered lists and paragraphs apart", () => {
    expect(parseMarkdown("1. one\n2. two\n\nAfter.").map((b) => b.type)).toEqual(["list", "paragraph"]);
  });
});
describe("review diff", () => {
  it("splits a git diff into files with counts", () => {
    const files = parseDiff(
      [
        "diff --git a/src/a.ts b/src/a.ts",
        "index 1..2 100644",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,2 +1,2 @@",
        " keep",
        "-old",
        "+new",
        "diff --git a/src/b.ts b/src/b.ts",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/src/b.ts",
        "@@ -0,0 +1 @@",
        "+hello",
      ].join("\n"),
    );
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ["src/a.ts", "modified", 1, 1],
      ["src/b.ts", "added", 1, 0],
    ]);
  });
});
describe("transcript", () => {
  it("groups runs of three or more finished reads", () => {
    const read = (id: string): TranscriptEntry => ({
      kind: "tool",
      id,
      at: 0,
      name: "readFile",
      title: "Read " + id,
      status: "ok",
    });
    const rows = transcriptRows([
      read("a"),
      read("b"),
      read("c"),
      { kind: "assistant", id: "t", at: 0, text: "Now editing." },
      read("d"),
    ]);
    expect(rows.map((r) => (r.kind === "group" ? `group:${r.entries.length}` : r.entry.id))).toEqual([
      "group:3",
      "t",
      "d",
    ]);
  });
});
