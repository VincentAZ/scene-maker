import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatExportMenu } from "../src/ChatExportMenu";
import {
  exportAssistantChat,
  exportCodeTask,
  exportFilename,
  inlineCode,
  stripMarkdown,
} from "../src/code/transcriptExport";
import type { CodingTask, TranscriptEntry } from "../shared/coding";

const at = new Date(2026, 9, 29, 14, 5).getTime();
const exported = new Date(2026, 9, 29, 16, 30);
const tool = (
  id: string,
  name: string,
  title: string,
  extra: Partial<Extract<TranscriptEntry, { kind: "tool" }>> = {},
): TranscriptEntry => ({
  kind: "tool",
  id,
  at,
  name,
  title,
  status: "ok",
  output: "lots of output that should not appear",
  ...extra,
});
const transcript: TranscriptEntry[] = [
  { kind: "user", id: "u1", at, text: "Add a **Copy all** button" },
  { kind: "assistant", id: "a1", at, text: "I'll look at the panel first." },
  tool("t1", "readFile", "Read src/App.tsx"),
  tool("t2", "readFile", "Read src/api.ts"),
  tool("t3", "listFiles", "List files in src/code"),
  tool("t4", "editFile", "Edit src/App.tsx"),
  tool("t5", "runCommand", "$ npm test", {
    status: "error",
    output: "FAIL tests/a.test.ts\nexpected 1\nreceived 2\nmore\nlines",
  }),
  { kind: "status", id: "s1", at, text: "Checks failed", tone: "error" },
  {
    kind: "assistant",
    id: "a2",
    at,
    text: "## Done\n\n- Added `copyText()` in **ChatExportMenu**\n- See [docs](https://example.com)",
  },
  { kind: "user", id: "u2", at, text: "Thanks" },
];
const task: CodingTask = {
  id: "3f2a9c1e-77aa-4bb1-9e0f-123456789abc",
  prompt: "Add a Copy all button\nwith exports",
  branch: "studio/code-3f2a9c1e-77a",
  base: "",
  baseline: "",
  baseBranch: "main",
  status: "ready",
  created: at,
  provider: "anthropic",
  model: "claude-opus-5-5",
  summary: "",
  events: [],
  transcript,
  baselineFiles: [],
  files: [],
  diff: "",
  publishDiff: "",
  review: "",
  checks: [],
};

describe("code task export", () => {
  it("writes a Markdown transcript with a header and short tool steps", () => {
    const md = exportCodeTask(task, "md", exported);
    expect(md.startsWith("# Add a Copy all button…\n")).toBe(true);
    expect(md).toContain("- **Branch:** `studio/code-3f2a9c1e-77a`");
    expect(md).toContain("- **Model:** anthropic · claude-opus-5-5");
    expect(md).toContain("- **Status:** Ready for review");
    expect(md).toContain("- **Started:** 2026-10-29 14:05");
    expect(md).toContain("- **Exported:** 2026-10-29 16:30");
    expect(md).toContain("### You\n\nAdd a **Copy all** button");
    expect(md).toContain("### Engineer\n\nI'll look at the panel first.");
    // Three reads collapse into one line with the files beneath.
    expect(md).toContain(
      "- `Read 2 files, listed 1 folder`\n  - `Read src/App.tsx`\n  - `Read src/api.ts`\n  - `List files in src/code`\n- `Edit src/App.tsx`\n- `$ npm test` (failed)",
    );
    // Failed steps show a short excerpt; successful output is left out.
    expect(md).toContain(
      "  > FAIL tests/a.test.ts\n  > expected 1\n  > received 2\n  > …",
    );
    expect(md).not.toContain("lots of output");
    expect(md).not.toContain("more\nlines");
    expect(md).toContain("*Error: Checks failed*");
    // The engineer's Markdown is kept.
    expect(md).toContain(
      "## Done\n\n- Added `copyText()` in **ChatExportMenu**",
    );
    expect(md.match(/### Engineer/g)).toHaveLength(1);
    expect(md).toMatch(/### You\n\nThanks\n$/);
  });

  it("writes plain text without Markdown syntax", () => {
    const txt = exportCodeTask(task, "txt", exported);
    expect(
      txt.startsWith("Add a Copy all button…\n======================"),
    ).toBe(true);
    expect(txt).toContain(
      "Branch: studio/code-3f2a9c1e-77a\nModel: anthropic · claude-opus-5-5",
    );
    expect(txt).toContain("YOU\n\nAdd a **Copy all** button");
    expect(txt).toContain("ENGINEER\n\nI'll look at the panel first.");
    expect(txt).toContain(
      "- Edit src/App.tsx\n- $ npm test (failed)\n    FAIL tests/a.test.ts",
    );
    expect(txt).toContain("[Error: Checks failed]");
    expect(txt).toContain(
      "Done\n\n- Added copyText() in ChatExportMenu\n- See docs (https://example.com)",
    );
    expect(txt).not.toContain("`");
    expect(txt).not.toContain("##");
  });

  it("marks sub-agent work and running steps", () => {
    const md = exportCodeTask(
      {
        ...task,
        transcript: [
          { kind: "assistant", id: "a", at, text: "Looking", depth: 1 },
          tool("t", "runCommand", "$ npm run build", {
            status: "running",
            depth: 1,
          }),
        ],
      },
      "md",
      exported,
    );
    expect(md).toContain("> Sub-agent:\n> Looking");
    expect(md).toContain("  - `$ npm run build` (running)");
  });

  it("falls back to the prompt and summary when there is no transcript", () => {
    const md = exportCodeTask(
      { ...task, transcript: undefined, summary: "All done." },
      "md",
      exported,
    );
    expect(md).toContain("### You\n\nAdd a Copy all button\nwith exports");
    expect(md).toContain("### Engineer\n\nAll done.");
  });
});

describe("assistant chat export", () => {
  const messages = [
    { role: "assistant" as const, text: "Welcome!", mode: "welcome" },
    { role: "user" as const, text: "Add a coffee cup" },
    {
      role: "assistant" as const,
      text: "Added a **coffee cup**.",
      mode: "edit",
    },
    { role: "assistant" as const, text: "Provider offline", mode: "error" },
  ];
  it("skips the welcome line and labels speakers", () => {
    const md = exportAssistantChat(messages, "md", { scene: "Cafe", exported });
    expect(md).toContain("# Scene assistant conversation");
    expect(md).toContain("- **Scene:** Cafe");
    expect(md).not.toContain("Welcome!");
    expect(md).toContain(
      "### You\n\nAdd a coffee cup\n\n### Scene assistant\n\nAdded a **coffee cup**.",
    );
    expect(md).toContain("### Scene assistant (error)\n\nProvider offline");
    const txt = exportAssistantChat(messages, "txt", {
      scene: "Cafe",
      exported,
    });
    expect(txt).toContain("Scene: Cafe\nExported: 2026-10-29 16:30");
    expect(txt).toContain("SCENE ASSISTANT\nAdded a coffee cup.");
  });
});

describe("markdown stripping", () => {
  it("removes syntax but keeps words, lists and code", () => {
    expect(
      stripMarkdown(
        "# Title\n\n* one with __bold__ and _em_\n1. two\n> quoted\n\n---\n\n```ts\nconst a_b = `x`;\n\n  indented\n```\n\nUse `src/__init__.py` and snake_case_name ~~old~~ \\*literal\\*",
      ),
    ).toBe(
      "Title\n\n- one with bold and em\n1. two\nquoted\n\n----\n\n    const a_b = `x`;\n\n      indented\n\nUse src/__init__.py and snake_case_name old *literal*",
    );
  });
  it("keeps bare links once", () => {
    expect(stripMarkdown("[https://a.dev](https://a.dev) ![logo](x.png)")).toBe(
      "https://a.dev logo",
    );
  });
});

describe("export helpers", () => {
  it("names files by kind, short id and local date", () => {
    expect(exportFilename("code", task.id, "md", exported)).toBe(
      "scene-maker-code-3f2a9c1e-2026-10-29.md",
    );
    expect(
      exportFilename("assistant", "Scene_42", "txt", new Date(2026, 0, 5)),
    ).toBe("scene-maker-assistant-scene42-2026-01-05.txt");
  });
  it("fences inline code around backticks", () => {
    expect(inlineCode("$ ls")).toBe("`$ ls`");
    expect(inlineCode("echo `date`")).toBe("`` echo `date` ``");
    expect(inlineCode("a``b")).toBe("```a``b```");
  });
});

describe("export toolbar", () => {
  it("offers copy and export buttons", () => {
    const html = renderToStaticMarkup(
      createElement(ChatExportMenu, {
        label: "task conversation",
        build: () => "",
        filename: () => "x.md",
      }),
    );
    expect(html).toContain('aria-label="Copy all of the task conversation"');
    expect(html).toContain('aria-label="Export the task conversation"');
    expect(html).toContain('aria-haspopup="menu"');
  });
});
