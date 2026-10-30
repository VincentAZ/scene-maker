import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bot,
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  FilePlus2,
  FileText,
  GitBranch,
  GitCommitHorizontal,
  Globe,
  Loader2,
  Pencil,
  Plug,
  Plus,
  Rocket,
  Search,
  Square,
  Terminal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "./api";
import {
  codingBusy,
  statusLabel,
  type CodingInfo,
  type CodingTask,
  type CodingTaskSummary,
  type TranscriptEntry,
} from "../shared/coding";
import { Markdown } from "./code/markdown";
import { parseDiff } from "./code/diff";
import { exportCodeTask, exportFilename } from "./code/transcriptExport";
import { ChatExportMenu } from "./ChatExportMenu";
import {
  AttachButton,
  PendingChips,
  SentAttachments,
  pastedFiles,
  useCodeAttachments,
  useFileDrop,
  type PendingAttachment,
} from "./Attachments";

const storageKey = "scene-maker-code-view-v1";
type View = { screen: "list" | "thread" | "new"; id?: string };
function readView(): View {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
    if (saved.screen === "thread" && typeof saved.id === "string")
      return { screen: "thread", id: saved.id };
    if (saved.screen === "new") return { screen: "new" };
  } catch {
    // The panel still works without browser storage.
  }
  return { screen: "list" };
}
function duration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
function ago(time: number | undefined, now: number) {
  if (!time) return "";
  const s = Math.max(0, (now - time) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const post = <T,>(url: string, body: object = {}) =>
  api<T>(url, { method: "POST", body: JSON.stringify(body) });
const deletePrompt = (prompt: string) =>
  `Delete “${prompt.slice(0, 80)}”?\n\nIts conversation and private checkout are removed from this computer. Branches already pushed to GitHub stay there.`;

function StatusPill({ task }: { task: Pick<CodingTask, "status" | "deployed"> }) {
  return (
    <span className={`code-pill code-pill-${task.status}`}>
      {codingBusy(task.status) && <Loader2 size={11} className="spin" aria-hidden />}
      {statusLabel(task)}
    </span>
  );
}

/* ---------- Task list ---------- */

function TaskList({
  info,
  now,
  onOpen,
  onNew,
  onChanged,
  onError,
}: {
  info: CodingInfo;
  now: number;
  onOpen: (id: string) => void;
  onNew: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const tasks = info.tasks.filter((t) => {
    const text = t.searchText.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const finished = info.tasks.filter((t) => !codingBusy(t.status)).length;
  async function remove(task: CodingTaskSummary) {
    if (!window.confirm(deletePrompt(task.prompt))) return;
    try {
      await api(`/api/coding/tasks/${task.id}`, { method: "DELETE" });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function clearFinished() {
    if (
      !window.confirm(
        `Delete all ${finished} finished ${finished === 1 ? "task" : "tasks"}?\n\nRunning tasks are kept. Branches already pushed to GitHub stay there.`,
      )
    )
      return;
    try {
      await post("/api/coding/tasks/clear");
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  return (
    <div className="code-list">
      <div className="code-list-head">
        <div>
          <h2>
            <Code2 size={18} /> Code
          </h2>
          <p className="code-model">
            {info.provider ? `${info.provider} · ${info.model}` : "No AI provider connected"}
            <span>
              {info.maxSteps ? `${info.maxSteps} steps` : "Unlimited steps"} ·{" "}
              {info.timeoutMinutes ? `${info.timeoutMinutes} min limit` : "no time limit"} ·{" "}
              {info.mcpServers.length ? `MCP: ${info.mcpServers.join(", ")}` : "no MCP servers"}
            </span>
          </p>
        </div>
        <button className="primary code-new" onClick={onNew} disabled={!info.available}>
          <Plus size={15} /> New task
        </button>
      </div>
      {info.reason && <p className="code-notice">{info.reason}</p>}
      {!!info.tasks.length && (
        <label className="code-search">
          <Search size={14} aria-hidden />
          <input
            type="search"
            placeholder="Search tasks, branches, files…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search coding tasks"
          />
          {query && (
            <button className="icon-button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={13} />
            </button>
          )}
        </label>
      )}
      <ul className="code-tasks" aria-label="Coding tasks">
        {tasks.map((task) => (
          <li key={task.id} className={codingBusy(task.status) ? "running" : ""}>
            <button className="code-task-open" onClick={() => onOpen(task.id)}>
              <span className="code-task-title">{task.prompt}</span>
              {task.lastMessage && <span className="code-task-last">{task.lastMessage}</span>}
              <span className="code-task-meta">
                <StatusPill task={task} />
                <span>{ago(task.updated || task.created, now)}</span>
                {!!task.fileCount && (
                  <span>
                    {task.fileCount} {task.fileCount === 1 ? "file" : "files"}
                  </span>
                )}
                <span className="code-task-branch">{task.branch}</span>
              </span>
            </button>
            {!codingBusy(task.status) && (
              <button
                className="icon-button code-task-delete"
                aria-label={`Delete task ${task.prompt.slice(0, 40)}`}
                title="Delete task"
                onClick={() => void remove(task)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
      {!info.tasks.length && (
        <div className="code-empty">
          <GitBranch size={26} />
          <p>No coding tasks yet.</p>
          <span>
            Each task is a conversation with the studio engineer in its own private checkout. Ask
            for a feature, a fix or an explanation.
          </span>
          <button className="primary" onClick={onNew} disabled={!info.available}>
            <Plus size={15} /> Start your first task
          </button>
        </div>
      )}
      {!!info.tasks.length && !tasks.length && (
        <p className="code-muted code-no-results">No tasks match “{query}”.</p>
      )}
      {finished > 0 && (
        <button className="text-button code-clear" onClick={() => void clearFinished()}>
          <Trash2 size={13} /> Clear finished tasks
        </button>
      )}
    </div>
  );
}

/* ---------- Transcript ---------- */

type ToolEntry = Extract<TranscriptEntry, { kind: "tool" }>;
const toolIcon = (name: string) => {
  switch (name) {
    case "readFile":
    case "listFiles":
      return FileText;
    case "writeFile":
      return FilePlus2;
    case "editFile":
    case "deleteFile":
      return Pencil;
    case "runCommand":
      return Terminal;
    case "gitCommit":
      return GitCommitHorizontal;
    case "gitPush":
      return Upload;
    case "deployToStudio":
      return Rocket;
    case "http":
      return Globe;
    case "askModel":
    case "delegate":
      return Bot;
    default:
      return Plug;
  }
};
function parseInput(input?: string): Record<string, unknown> {
  try {
    return JSON.parse(input || "{}");
  } catch {
    return {};
  }
}
function ToolDetail({ entry }: { entry: ToolEntry }) {
  const input = parseInput(entry.input);
  const text = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : "");
  const writes = entry.name === "writeFile" || entry.name === "editFile";
  return (
    <div className="code-tool-detail">
      {entry.name === "editFile" ? (
        <pre className="code-diff">
          {text("oldText")
            .split("\n")
            .map((line, i) => (
              <span key={`o${i}`} className="del">
                {"−" + line + "\n"}
              </span>
            ))}
          {text("newText")
            .split("\n")
            .map((line, i) => (
              <span key={`n${i}`} className="add">
                {"+" + line + "\n"}
              </span>
            ))}
        </pre>
      ) : entry.name === "writeFile" ? (
        <pre>{text("content").slice(0, 6000)}</pre>
      ) : entry.name === "runCommand" ? (
        <pre className="code-command">$ {text("command")}</pre>
      ) : entry.name === "delegate" || entry.name === "askModel" ? (
        <pre>{text("task") || text("prompt")}</pre>
      ) : (
        entry.input && entry.input !== "{}" && <pre className="code-input">{entry.input}</pre>
      )}
      {entry.output && (!writes || entry.status === "error") && (
        <pre className={entry.status === "error" ? "code-output error" : "code-output"}>
          {entry.output}
        </pre>
      )}
    </div>
  );
}
function ToolRow({ entry, now }: { entry: ToolEntry; now: number }) {
  const [open, setOpen] = useState(false);
  const Icon = toolIcon(entry.name);
  const took = (entry.ended || now) - entry.at;
  return (
    <div className={`code-tool ${entry.status}${entry.depth ? " nested" : ""}`}>
      <button className="code-tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={12} className={open ? "open" : ""} aria-hidden />
        <Icon size={13} aria-hidden />
        <span className="code-tool-title">{entry.title}</span>
        <span className="code-tool-state">
          {entry.status === "running" ? (
            <>
              <Loader2 size={12} className="spin" /> {duration(took)}
            </>
          ) : entry.status === "error" ? (
            <X size={12} aria-label="failed" />
          ) : took > 1500 ? (
            duration(took)
          ) : (
            <Check size={12} aria-label="done" />
          )}
        </span>
      </button>
      {open && <ToolDetail entry={entry} />}
    </div>
  );
}
function ToolGroup({ entries, now }: { entries: ToolEntry[]; now: number }) {
  const [open, setOpen] = useState(false);
  const files = entries.filter((e) => e.name === "readFile").length;
  const lists = entries.length - files;
  const label = [
    files ? `Read ${files} ${files === 1 ? "file" : "files"}` : "",
    lists ? `${files ? "listed" : "Listed"} ${lists} ${lists === 1 ? "folder" : "folders"}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className={`code-tool ok${entries[0].depth ? " nested" : ""}`}>
      <button className="code-tool-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={12} className={open ? "open" : ""} aria-hidden />
        <FileText size={13} aria-hidden />
        <span className="code-tool-title">{label}</span>
        <span className="code-tool-state">
          <Check size={12} aria-label="done" />
        </span>
      </button>
      {open && (
        <div className="code-tool-group">
          {entries.map((entry) => (
            <ToolRow key={entry.id} entry={entry} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}
type Row =
  | { kind: "entry"; entry: TranscriptEntry }
  | { kind: "group"; entries: ToolEntry[] };
/** Collapse runs of finished reads into one line, as a terminal agent does. */
export function transcriptRows(transcript: TranscriptEntry[]): Row[] {
  const result: Row[] = [];
  let run: ToolEntry[] = [];
  const flush = () => {
    if (run.length >= 3) result.push({ kind: "group", entries: run });
    else run.forEach((entry) => result.push({ kind: "entry", entry }));
    run = [];
  };
  for (const entry of transcript) {
    const groupable =
      entry.kind === "tool" &&
      (entry.name === "readFile" || entry.name === "listFiles") &&
      entry.status === "ok" &&
      (!run.length || run[0].depth === entry.depth);
    if (groupable) run.push(entry as ToolEntry);
    else {
      flush();
      result.push({ kind: "entry", entry });
    }
  }
  flush();
  return result;
}
function Transcript({ task, now }: { task: CodingTask; now: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);
  const transcript = task.transcript || [];
  const count = transcript.length;
  const last = transcript[count - 1];
  const lastToolState = last?.kind === "tool" ? last.status : "";
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [count, lastToolState, pinned, task.status]);
  useEffect(() => {
    setPinned(true);
  }, [task.id]);
  const running = [...transcript]
    .reverse()
    .find((e) => e.kind === "tool" && e.status === "running");
  const busy = codingBusy(task.status);
  const idleFor = now - (task.updated || now);
  return (
    <div className="code-transcript-wrap">
      <div
        className="code-transcript"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {transcriptRows(transcript).map((row) => {
          if (row.kind === "group")
            return <ToolGroup key={row.entries[0].id} entries={row.entries} now={now} />;
          const entry = row.entry;
          switch (entry.kind) {
            case "user":
              return (
                <div key={entry.id} className={`code-msg user${entry.dropped ? " dropped" : ""}`}>
                  <div className="code-msg-by">
                    You
                    {entry.queued && <span>Delivered at the engineer’s next step</span>}
                    {entry.dropped && <span>Not delivered: the task was stopped</span>}
                  </div>
                  {entry.text && <p>{entry.text}</p>}
                  {entry.attachments && (
                    <SentAttachments
                      attachments={entry.attachments}
                      href={(a) => `/api/coding/tasks/${task.id}/attachments/${a.id}`}
                    />
                  )}
                </div>
              );
            case "assistant":
              return (
                <div key={entry.id} className={`code-msg assistant${entry.depth ? " nested" : ""}`}>
                  {!!entry.depth && <div className="code-msg-by">Sub-agent</div>}
                  <Markdown text={entry.text} />
                </div>
              );
            case "tool":
              return <ToolRow key={entry.id} entry={entry} now={now} />;
            case "status":
              return (
                <p key={entry.id} className={`code-status ${entry.tone || "info"}`}>
                  {entry.text}
                </p>
              );
          }
        })}
        {busy && (
          <div className="code-live" role="status" aria-live="polite">
            <Loader2 size={14} className="spin" aria-hidden />
            <span>
              {task.status === "preparing"
                ? "Preparing a private checkout"
                : task.status === "checking"
                  ? "Running checks"
                  : task.status === "publishing"
                    ? "Pushing"
                    : running
                      ? "Working"
                      : "Thinking"}
            </span>
            <span className="code-live-time">
              {duration(now - (task.started || task.created))}
              {task.step ? ` · step ${task.step}${task.maxSteps ? ` of ${task.maxSteps}` : ""}` : ""}
            </span>
            {task.status === "working" && !running && idleFor > 45_000 && (
              <span className="code-live-note">
                The model has been thinking for {duration(idleFor)}. Long reasoning turns can take
                a few minutes.
              </span>
            )}
          </div>
        )}
      </div>
      {!pinned && (
        <button
          className="code-jump"
          onClick={() => {
            setPinned(true);
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          <ArrowDown size={13} /> Latest
        </button>
      )}
    </div>
  );
}

/* ---------- Review drawer ---------- */

function Review({
  task,
  info,
  onAction,
  busy,
}: {
  task: CodingTask;
  info: CodingInfo;
  onAction: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  useEffect(() => {
    setAcknowledged(false);
    setPreviewUrl("");
  }, [task.id, task.review]);
  const files = useMemo(
    () => parseDiff(full ? task.publishDiff : task.diff),
    [full, task.diff, task.publishDiff],
  );
  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);
  if (!task.files.length && !task.checks.length && task.status !== "pushed") return null;
  return (
    <section className={`code-review${open ? " open" : ""}`}>
      <button className="code-review-bar" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={13} className={open ? "open" : ""} aria-hidden />
        <strong>
          {task.files.length} {task.files.length === 1 ? "file" : "files"} changed
        </strong>
        {!!files.length && (
          <span className="code-review-stat">
            <span className="add">+{added}</span> <span className="del">−{removed}</span>
          </span>
        )}
        <span className="code-review-checks">
          {task.checks.map((c) => (
            <span
              key={c.name}
              className={c.ok ? "ok" : "fail"}
              title={`${c.name} ${c.ok ? "passed" : "failed"}`}
            >
              {c.ok ? <Check size={11} /> : <X size={11} />} {c.name}
            </span>
          ))}
          {task.status === "ready" && <span className="ready">Ready to push</span>}
        </span>
      </button>
      {open && (
        <div className="code-review-body">
          {!!task.checks.length && (
            <div className="code-checks">
              {task.checks.map((check) => (
                <details key={check.name}>
                  <summary className={check.ok ? "ok" : "fail"}>
                    {check.ok ? <Check size={12} /> : <X size={12} />} {check.name} ·{" "}
                    {check.ok ? "passed" : "failed"}
                  </summary>
                  <pre>{check.output}</pre>
                </details>
              ))}
            </div>
          )}
          {!!task.baselineFiles.length && (
            <label className="code-check-row">
              <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
              Show the {task.baselineFiles.length} uncommitted studio changes this branch also
              carries
            </label>
          )}
          <div className="code-files">
            {files.map((file) => (
              <details key={file.path} className="code-file">
                <summary>
                  <span className={`code-file-status ${file.status}`}>
                    {file.status[0].toUpperCase()}
                  </span>
                  <span className="code-file-path">{file.path}</span>
                  <span className="code-review-stat">
                    <span className="add">+{file.additions}</span>{" "}
                    <span className="del">−{file.deletions}</span>
                  </span>
                </summary>
                <pre className="code-diff">
                  {file.lines.slice(0, 4000).map((line, i) => (
                    <span key={i} className={line.kind}>
                      {(line.kind === "add"
                        ? "+"
                        : line.kind === "del"
                          ? "−"
                          : line.kind === "ctx"
                            ? " "
                            : "") +
                        line.text +
                        "\n"}
                    </span>
                  ))}
                </pre>
              </details>
            ))}
          </div>
          <div className="code-actions">
            {(task.status === "ready" || task.status === "pushed") && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void onAction(async () => {
                    const result = await post<{ url: string }>(
                      `/api/coding/tasks/${task.id}/preview`,
                    );
                    setPreviewUrl(result.url);
                  })
                }
              >
                Prepare UI preview
              </button>
            )}
            {previewUrl && (
              <a href={previewUrl} target="_blank" rel="noreferrer">
                Open preview <ExternalLink size={12} />
              </a>
            )}
            {task.compareUrl && (
              <a href={task.compareUrl} target="_blank" rel="noreferrer">
                Compare on GitHub <ExternalLink size={12} />
              </a>
            )}
            {task.pullRequestUrl ? (
              <a href={task.pullRequestUrl} target="_blank" rel="noreferrer">
                Open pull request <ExternalLink size={12} />
              </a>
            ) : (
              task.status === "pushed" &&
              !task.deployed && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void onAction(() => post(`/api/coding/tasks/${task.id}/pull-request`))
                  }
                >
                  Create draft pull request
                </button>
              )
            )}
          </div>
          {task.status === "ready" && (
            <div className="code-publish">
              <p>
                Push <strong>{task.branch}</strong> to{" "}
                <strong>{info.remote || "no GitHub origin configured"}</strong>. The running studio
                stays unchanged.
              </p>
              <label className="code-check-row">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I reviewed the changes
                {task.baselineFiles.length ? ", including the carried-over studio changes" : ""}.
              </label>
              <button
                className="primary"
                disabled={busy || !acknowledged || !info.remote}
                onClick={() =>
                  void onAction(() =>
                    post(`/api/coding/tasks/${task.id}/publish`, {
                      review: task.review,
                      includeBaseline: acknowledged,
                    }),
                  )
                }
              >
                <Upload size={14} /> Commit & push branch
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- Composer ---------- */

function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  disabled,
  placeholder,
  autoFocus,
  attachments,
  onFiles,
  onRemoveFile,
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running: boolean;
  disabled: boolean;
  placeholder: string;
  autoFocus?: boolean;
  attachments: PendingAttachment[];
  onFiles: (files: File[]) => void;
  onRemoveFile: (key: string) => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 240) + "px";
  }, [value]);
  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);
  const uploading = attachments.some((a) => a.status === "uploading");
  const ready = !uploading && (!!value.trim() || attachments.length > 0);
  const send = () => {
    if (ready && !disabled) onSend();
  };
  const drop = useFileDrop(onFiles);
  return (
    <form
      className={`code-composer${drop.dragging ? " dragging" : ""}`}
      {...drop.handlers}
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <PendingChips items={attachments} onRemove={onRemoveFile} />
      <textarea
        ref={box}
        rows={2}
        value={value}
        maxLength={60_000}
        placeholder={placeholder}
        aria-label="Message the studio engineer"
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          const files = pastedFiles(e);
          if (!files.length) return;
          e.preventDefault();
          onFiles(files);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="code-composer-bar">
        <span>
          {drop.dragging
            ? "Drop files to attach them"
            : uploading
              ? "Uploading attachments…"
              : `${running ? "Read at its next step" : "Enter to send"} · Shift+Enter for a new line`}
        </span>
        <AttachButton
          onFiles={onFiles}
          className="code-attach"
          label="Attach files (or drop or paste them here)"
        />
        {onStop && (
          <button type="button" className="code-stop" onClick={onStop} title="Stop the engineer">
            <Square size={11} /> Stop
          </button>
        )}
        <button className="code-send" aria-label="Send" disabled={disabled || !ready}>
          <ArrowUp size={16} />
        </button>
      </div>
    </form>
  );
}

/* ---------- Panel ---------- */

export function CodingAssistant() {
  const [info, setInfo] = useState<CodingInfo | null>(null);
  const [view, setView] = useState<View>(readView);
  const [detail, setDetail] = useState<CodingTask | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [titleOpen, setTitleOpen] = useState(false);
  const files = useCodeAttachments(setError);
  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(view));
    } catch {
      // Not remembered across reloads; nothing else depends on it.
    }
  }, [view]);
  const refresh = useCallback(async () => {
    const next = await api<CodingInfo>("/api/coding");
    setInfo(next);
    const current = viewRef.current;
    if (current.screen === "thread" && current.id) {
      if (!next.tasks.some((t) => t.id === current.id)) {
        setView({ screen: "list" });
        setDetail(null);
      } else {
        const task = await api<CodingTask>(`/api/coding/tasks/${current.id}`);
        if (viewRef.current.id === task.id) setDetail(task);
      }
    }
    return next;
  }, []);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      let fast = false;
      try {
        const next = await refresh();
        fast = next.tasks.some((t) => codingBusy(t.status));
        if (active) setOffline(false);
      } catch {
        // The studio restarts after a self-deploy or a restart; keep polling.
        if (active) setOffline(true);
      }
      if (active) timer = setTimeout(loop, fast ? 1000 : 3000);
    };
    void loop();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [view.screen, view.id, refresh]);
  const anyBusy = !!info?.tasks.some((t) => codingBusy(t.status));
  useEffect(() => {
    if (!anyBusy) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyBusy]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const draftKey = view.screen === "thread" && view.id ? view.id : "new";
  const draft = drafts[draftKey] || "";
  const setDraft = (value: string) => setDrafts((d) => ({ ...d, [draftKey]: value }));
  const pending = files.list(draftKey);
  const sentIds = () => pending.flatMap((p) => (p.attachment ? [p.attachment.id] : []));
  const fileProps = {
    attachments: pending,
    onFiles: (chosen: File[]) => files.add(draftKey, chosen),
    onRemoveFile: (key: string) => files.remove(draftKey, key),
  };
  const open = (id: string) => {
    setDetail(null);
    setError("");
    setTitleOpen(false);
    setView({ screen: "thread", id });
  };
  const notices = (
    <>
      {offline && (
        <p role="status" className="code-notice">
          Reconnecting to the studio service… This clears on its own once it answers.
        </p>
      )}
      {error && (
        <p role="alert" className="code-error">
          <span>{error}</span>
          <button className="icon-button" aria-label="Dismiss" onClick={() => setError("")}>
            <X size={13} />
          </button>
        </p>
      )}
    </>
  );
  if (!info)
    return (
      <section className="coding-assistant code-shell" aria-label="Coding assistant">
        {notices}
        <p className="code-muted code-loading">
          <Loader2 size={14} className="spin" /> Loading coding tasks…
        </p>
      </section>
    );
  if (view.screen === "new")
    return (
      <section className="coding-assistant code-shell" aria-label="Coding assistant">
        <div className="code-thread-head">
          <button className="text-button code-back" onClick={() => setView({ screen: "list" })}>
            <ArrowLeft size={15} /> Tasks
          </button>
        </div>
        <div className="code-new-intro">
          <h2>New task</h2>
          <p>
            Describe a feature, a fix or a question. The engineer works in a private checkout,
            narrates each step, runs the checks, and commits, pushes or deploys when you ask it to.
          </p>
          <p className="code-model">
            {info.provider ? `${info.provider} · ${info.model}` : "No AI provider connected"}
          </p>
          {info.reason && <p className="code-notice">{info.reason}</p>}
          <ul className="code-examples">
            {[
              "Explain how the coding service runs a task",
              "Add rotation handles to selected assets, run the checks, then commit and push",
              "Fix the failing tests, then deploy to the studio",
            ].map((example) => (
              <li key={example}>
                <button className="text-button" onClick={() => setDraft(example)}>
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>
        {notices}
        <Composer
          autoFocus
          value={draft}
          onChange={setDraft}
          running={false}
          disabled={busy || !info.available}
          placeholder="What would you like to build or change?"
          {...fileProps}
          onSend={() =>
            void action(async () => {
              const task = await post<CodingTaskSummary>("/api/coding/tasks", {
                prompt: draft,
                attachments: sentIds(),
              });
              setDrafts((d) => ({ ...d, new: "" }));
              files.clear("new");
              open(task.id);
            })
          }
        />
      </section>
    );
  if (view.screen === "thread" && view.id) {
    const id = view.id;
    const summary = info.tasks.find((t) => t.id === id);
    const task = detail?.id === id ? detail : null;
    const running = summary ? codingBusy(summary.status) : false;
    return (
      <section className="coding-assistant code-shell" aria-label="Coding assistant">
        <div className="code-thread-head">
          <button className="text-button code-back" onClick={() => setView({ screen: "list" })}>
            <ArrowLeft size={15} /> Tasks
          </button>
          {summary && <StatusPill task={summary} />}
          {task && (
            <ChatExportMenu
              label="task conversation"
              build={(format) => exportCodeTask(task, format)}
              filename={(format) => exportFilename("code", task.id, format, new Date())}
            />
          )}
          {summary && !running && (
            <button
              className="icon-button"
              title="Delete task"
              aria-label="Delete task"
              onClick={() => {
                if (window.confirm(deletePrompt(summary.prompt)))
                  void action(async () => {
                    await api(`/api/coding/tasks/${summary.id}`, { method: "DELETE" });
                    setView({ screen: "list" });
                  });
              }}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
        {summary && (
          <div className="code-thread-title">
            <h3
              className={titleOpen ? "open" : ""}
              title={titleOpen ? "Collapse" : "Show the full request"}
              onClick={() => setTitleOpen(!titleOpen)}
            >
              {summary.prompt}
            </h3>
            <p>
              <GitBranch size={12} aria-hidden />{" "}
              <span>
                {summary.branch}
                {task ? ` · ${task.provider} · ${task.model}` : ""}
              </span>
            </p>
          </div>
        )}
        {task ? (
          <Transcript task={task} now={now} />
        ) : (
          <p className="code-muted code-loading">
            <Loader2 size={14} className="spin" /> Loading conversation…
          </p>
        )}
        {task && <Review task={task} info={info} onAction={action} busy={busy} />}
        {notices}
        <Composer
          value={draft}
          onChange={setDraft}
          running={running}
          disabled={busy || !summary}
          placeholder={
            running
              ? "Message the engineer while it works…"
              : "Reply, ask a question, or request another change…"
          }
          onStop={
            running && summary?.status !== "publishing"
              ? () => void action(() => post(`/api/coding/tasks/${id}/stop`))
              : undefined
          }
          {...fileProps}
          onSend={() =>
            void action(async () => {
              const text = draft;
              setDraft("");
              try {
                await post(`/api/coding/tasks/${id}/reply`, {
                  message: text,
                  attachments: sentIds(),
                });
                files.clear(id);
              } catch (e) {
                setDraft(text);
                throw e;
              }
            })
          }
        />
      </section>
    );
  }
  return (
    <section className="coding-assistant code-shell" aria-label="Coding assistant">
      {notices}
      <TaskList
        info={info}
        now={now}
        onOpen={open}
        onNew={() => setView({ screen: "new" })}
        onChanged={() => void refresh().catch(() => {})}
        onError={setError}
      />
    </section>
  );
}
