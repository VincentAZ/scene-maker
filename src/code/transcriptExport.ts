import {
  statusLabel,
  type CodingTask,
  type TranscriptEntry,
} from "../../shared/coding";

/**
 * Turns chat conversations into clean, shareable transcripts: Markdown that
 * keeps the assistant's formatting, or plain text with the Markdown removed.
 * Pure functions only, so the panels just hand over their data.
 */
export type ExportFormat = "md" | "txt";
type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
type ChatMessage = { role: "user" | "assistant"; text: string; mode?: string };

const pad = (n: number) => String(n).padStart(2, "0");
/** Local calendar date, `yyyy-mm-dd`. */
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
/** Local date and time, `yyyy-mm-dd hh:mm`. */
export const isoDateTime = (date: Date) =>
  `${isoDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** `scene-maker-<kind>-<short id>-<yyyy-mm-dd>.<ext>` */
export function exportFilename(
  kind: string,
  id: string,
  format: ExportFormat,
  date: Date,
) {
  const shortId = id
    .replace(/[^a-z0-9]+/gi, "")
    .slice(0, 8)
    .toLowerCase();
  return (
    ["scene-maker", kind, shortId, isoDate(date)].filter(Boolean).join("-") +
    "." +
    format
  );
}

/** Wrap text as inline code, choosing a fence longer than any backtick run inside. */
export function inlineCode(text: string) {
  const longest = Math.max(
    0,
    ...(text.match(/`+/g) || []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const space = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + space + text + space + fence;
}

/** Remove Markdown syntax while keeping the words, list shape and code. */
export function stripMarkdown(source: string): string {
  const out: string[] = [];
  let fence = "";
  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length)
        fence = "";
      else out.push("    " + line);
      continue;
    }
    if (marker) {
      fence = marker;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push("----");
      continue;
    }
    // Code spans, escapes and link targets are set aside so emphasis rules skip them.
    const kept: string[] = [];
    const keep = (value: string) => `\u0000${kept.push(value) - 1}\u0000`;
    const text = line
      .replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, "$1")
      .replace(/^(\s*)>\s?/, "$1")
      .replace(/^(\s*)[*+]\s+/, "$1- ")
      .replace(/(`+)([^`]+?)\1/g, (_, __, code: string) => keep(code.trim()))
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_, char: string) => keep(char))
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, "$1")
      .replace(
        /\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g,
        (_, label: string, url: string) =>
          label === url ? keep(url) : `${label} (${keep(url)})`,
      )
      .replace(/\*\*([^*]+?)\*\*|__([^_]+?)__/g, (_, a, b) => a ?? b)
      .replace(
        /(?<![\w*])\*([^*\n]+?)\*(?!\w)|(?<![\w_])_([^_\n]+?)_(?!\w)/g,
        (_, a, b) => a ?? b,
      )
      .replace(/~~([^~]+?)~~/g, "$1")
      .replace(/\u0000(\d+)\u0000/g, (_, n) => kept[Number(n)]);
    out.push(text);
  }
  return out
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

const firstLines = (text: string, count: number) => {
  const lines = text.trim().split("\n");
  return lines.slice(0, count).concat(lines.length > count ? ["…"] : []);
};
const shorten = (text: string, limit: number) => {
  const line = text.trim().split("\n")[0];
  return line.length > limit || text.trim().includes("\n")
    ? line.slice(0, limit - 1) + "…"
    : line;
};

type Step = {
  label: string;
  depth: number;
  failed?: boolean;
  running?: boolean;
  error?: string[];
};
/** A tool call as one short line; successful output is left out. */
function toolStep(entry: ToolEntry): Step {
  return {
    label: entry.title || entry.name,
    depth: entry.depth || 0,
    failed: entry.status === "error",
    running: entry.status === "running",
    error:
      entry.status === "error" && entry.output
        ? firstLines(entry.output, 3)
        : undefined,
  };
}
const reading = (entry: TranscriptEntry): entry is ToolEntry =>
  entry.kind === "tool" &&
  (entry.name === "readFile" || entry.name === "listFiles") &&
  entry.status === "ok";
/** Runs of three or more reads become one line, as in the panel. */
function readGroup(entries: ToolEntry[]): Step & { children: Step[] } {
  const files = entries.filter((e) => e.name === "readFile").length;
  const lists = entries.length - files;
  const label = [
    files ? `Read ${files} ${files === 1 ? "file" : "files"}` : "",
    lists
      ? `${files ? "listed" : "Listed"} ${lists} ${lists === 1 ? "folder" : "folders"}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  return {
    label,
    depth: entries[0].depth || 0,
    children: entries.map(toolStep),
  };
}

type Block =
  | { kind: "speaker"; who: string }
  | { kind: "text"; text: string; markdown: boolean; depth: number }
  | { kind: "steps"; steps: (Step & { children?: Step[] })[] }
  | { kind: "status"; text: string; tone?: string };

/** Group a transcript into speaker turns, prose and runs of tool steps. */
function blocks(transcript: TranscriptEntry[]): Block[] {
  const result: Block[] = [];
  let speaker = "";
  const turn = (who: string) => {
    if (who !== speaker) result.push({ kind: "speaker", who });
    speaker = who;
  };
  const addStep = (step: Step & { children?: Step[] }) => {
    turn("Engineer");
    const last = result[result.length - 1];
    if (last?.kind === "steps") last.steps.push(step);
    else result.push({ kind: "steps", steps: [step] });
  };
  for (let i = 0; i < transcript.length; i++) {
    const entry = transcript[i];
    if (reading(entry)) {
      let j = i;
      while (
        j < transcript.length &&
        reading(transcript[j]) &&
        (transcript[j] as ToolEntry).depth === entry.depth
      )
        j++;
      const run = transcript.slice(i, j) as ToolEntry[];
      if (run.length >= 3) {
        addStep(readGroup(run));
        i = j - 1;
        continue;
      }
    }
    switch (entry.kind) {
      case "user":
        turn("You");
        result.push({
          kind: "text",
          text:
            entry.text +
            (entry.dropped ? "\n\n(Not delivered: the task was stopped)" : ""),
          markdown: false,
          depth: 0,
        });
        break;
      case "assistant":
        turn("Engineer");
        if (entry.text.trim())
          result.push({
            kind: "text",
            text: entry.text.trim(),
            markdown: true,
            depth: entry.depth || 0,
          });
        break;
      case "tool":
        addStep(toolStep(entry));
        break;
      case "status":
        result.push({ kind: "status", text: entry.text, tone: entry.tone });
        break;
    }
  }
  return result;
}

const stepSuffix = (step: Step) =>
  step.failed ? " (failed)" : step.running ? " (running)" : "";
function renderSteps(
  steps: (Step & { children?: Step[] })[],
  format: ExportFormat,
) {
  const lines: string[] = [];
  const add = (step: Step, extra: number) => {
    const indent = "  ".repeat(step.depth + extra);
    lines.push(
      indent +
        "- " +
        (format === "md" ? inlineCode(step.label) : step.label) +
        stepSuffix(step),
    );
    for (const line of step.error || [])
      lines.push(
        indent + "  " + (format === "md" ? "> " + line : "  " + line).trimEnd(),
      );
  };
  for (const step of steps) {
    add(step, 0);
    for (const child of step.children || []) add(child, 1);
  }
  return lines.join("\n");
}

function renderBlocks(list: Block[], format: ExportFormat) {
  const parts: string[] = [];
  for (const block of list) {
    switch (block.kind) {
      case "speaker":
        parts.push(
          format === "md" ? `### ${block.who}` : block.who.toUpperCase(),
        );
        break;
      case "text": {
        let text =
          block.markdown && format === "txt"
            ? stripMarkdown(block.text)
            : block.text;
        if (block.depth) {
          const prefix = format === "md" ? "> " : "  | ";
          text = ["Sub-agent:", ...text.split("\n")]
            .map((line) => (prefix + line).trimEnd())
            .join("\n");
        }
        parts.push(text);
        break;
      }
      case "steps":
        parts.push(renderSteps(block.steps, format));
        break;
      case "status": {
        const tone =
          block.tone === "error"
            ? "Error: "
            : block.tone === "warning"
              ? "Warning: "
              : "";
        parts.push(
          format === "md" ? `*${tone}${block.text}*` : `[${tone}${block.text}]`,
        );
        break;
      }
    }
  }
  return parts.join("\n\n");
}

function header(
  title: string,
  fields: [string, string | undefined][],
  format: ExportFormat,
) {
  const rows = fields.filter((f): f is [string, string] => !!f[1]);
  if (format === "md")
    return [`# ${title}`, "", ...rows.map(([k, v]) => `- **${k}:** ${v}`)].join(
      "\n",
    );
  return [
    title,
    "=".repeat(Math.min(72, Math.max(3, title.length))),
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
  ].join("\n");
}
const divider = (format: ExportFormat) =>
  format === "md" ? "---" : "-".repeat(40);

/** A Code panel task as a readable transcript. */
export function exportCodeTask(
  task: Pick<
    CodingTask,
    | "id"
    | "prompt"
    | "branch"
    | "provider"
    | "model"
    | "status"
    | "deployed"
    | "created"
    | "transcript"
    | "summary"
    | "pullRequestUrl"
    | "compareUrl"
  >,
  format: ExportFormat,
  exported = new Date(),
) {
  const title = shorten(task.prompt, 100) || "Code task";
  const code = (s: string) => (format === "md" ? inlineCode(s) : s);
  const top = header(
    title,
    [
      ["Branch", task.branch ? code(task.branch) : undefined],
      [
        "Model",
        [task.provider, task.model].filter(Boolean).join(" · ") || undefined,
      ],
      ["Status", statusLabel(task)],
      ["Started", isoDateTime(new Date(task.created))],
      ["Exported", isoDateTime(exported)],
      ["Pull request", task.pullRequestUrl],
      ["Compare", task.pullRequestUrl ? undefined : task.compareUrl],
    ],
    format,
  );
  let transcript = task.transcript || [];
  if (!transcript.length)
    transcript = [
      { kind: "user", id: "prompt", at: task.created, text: task.prompt },
      ...(task.summary
        ? [
            {
              kind: "assistant" as const,
              id: "summary",
              at: task.created,
              text: task.summary,
            },
          ]
        : []),
    ];
  return (
    [top, divider(format), renderBlocks(blocks(transcript), format)].join(
      "\n\n",
    ) + "\n"
  );
}

/** The studio assistant chat as a readable transcript. */
export function exportAssistantChat(
  messages: ChatMessage[],
  format: ExportFormat,
  details: { scene?: string; exported?: Date } = {},
) {
  const exported = details.exported || new Date();
  const top = header(
    "Scene assistant conversation",
    [
      ["Scene", details.scene],
      ["Exported", isoDateTime(exported)],
    ],
    format,
  );
  const body = messages
    .filter((m) => m.mode !== "welcome" && m.text.trim())
    .map((m) => {
      const who = m.role === "user" ? "You" : "Scene assistant";
      const note =
        m.mode === "error"
          ? " (error)"
          : m.mode === "offline"
            ? " (offline helper)"
            : "";
      const text =
        m.role === "assistant" && format === "txt"
          ? stripMarkdown(m.text)
          : m.text.trim();
      return format === "md"
        ? `### ${who}${note}\n\n${text}`
        : `${who.toUpperCase()}${note.toUpperCase()}\n${text}`;
    })
    .join("\n\n");
  return (
    [
      top,
      divider(format),
      body || (format === "md" ? "*No messages yet.*" : "(No messages yet.)"),
    ].join("\n\n") + "\n"
  );
}
