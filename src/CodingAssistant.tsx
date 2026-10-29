import { useEffect, useRef, useState } from "react";
import {
  Code2,
  ArrowUp,
  Check,
  GitBranch,
  Square,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { api } from "./api";
import {
  codingBusy,
  NARRATION,
  type CodingInfo,
  type CodingTask,
} from "../shared/coding";
function duration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600),
    m = Math.floor((total % 3600) / 60),
    s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0"),
    ss = String(s).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const phases: Record<string, string> = {
  preparing: "Preparing a private checkout",
  working: "Engineer working",
  checking: "Running checks",
  publishing: "Pushing branch",
};
function Progress({ task, now }: { task: CodingTask; now: number }) {
  const started = task.started || task.created;
  const idle = task.updated ? now - task.updated : 0;
  const last = task.events[task.events.length - 1] || "";
  const current = last.startsWith(NARRATION) ? last.slice(NARRATION.length) : last;
  return (
    <div className="coding-progress" role="status" aria-live="polite">
      <div className="coding-progress-head">
        <Loader2 size={16} className="spin" aria-hidden />
        <strong>{phases[task.status] || task.status}</strong>
        <span className="coding-progress-meta">
          {duration(now - started)}
          {task.status === "working" && task.step
            ? ` · step ${task.step}${task.maxSteps ? ` of ${task.maxSteps}` : ""}`
            : ""}
        </span>
      </div>
      {current && <p className="coding-now">{current}</p>}
      <p className="coding-progress-note">
        {idle > 45_000
          ? `Waiting on the model for ${duration(idle)}. Long turns with extended thinking can take a few minutes; nothing is stuck unless this keeps climbing.`
          : task.status === "working"
            ? "The engineer narrates each step below. Stop at any time; partial work is kept."
            : task.status === "checking"
              ? "TypeScript, tests and the production build run in an isolated sandbox."
              : ""}
      </p>
    </div>
  );
}
export function CodingAssistant() {
  const [info, setInfo] = useState<CodingInfo | null>(null);
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [fullDiff, setFullDiff] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  const log = useRef<HTMLOListElement>(null);
  const task = info?.tasks.find((t) => t.id === selected) ?? info?.tasks[0];
  async function load() {
    const next = await api<CodingInfo>("/api/coding");
    setInfo(next);
  }
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api<CodingInfo>("/api/coding");
        if (active) {
          setInfo(next);
          setOffline(false);
        }
      } catch {
        // The studio restarts after a self-deploy; keep polling and say so.
        if (active) setOffline(true);
      }
      if (active) timer = setTimeout(refresh, 1500);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  const running = info?.tasks.some((t) => codingBusy(t.status));
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    setAcknowledged(false);
    setPreviewUrl("");
  }, [task?.id, task?.review]);
  const eventCount = task?.events.length || 0;
  useEffect(() => {
    const list = log.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [eventCount, task?.id]);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const post = <T,>(url: string, body = {}) =>
    api<T>(url, { method: "POST", body: JSON.stringify(body) });
  const canPublish =
    task &&
    (task.status === "ready" || (task.status === "failed" && !!task.commit));
  return (
    <section className="coding-assistant" aria-label="Coding assistant">
      <div className="coding-heading">
        <Code2 size={24} />
        <h2>Build your studio.</h2>
        <p>
          Describe a feature or fix. The studio engineer reads, edits, runs the
          checks, and can commit, push and deploy when you ask it to.
        </p>
      </div>
      <div className="coding-provider">
        {info?.provider
          ? `${info.provider} · ${info.model}`
          : "Connect an AI provider in Studio settings."}
        {info && (
          <span className="coding-limits">
            {info.maxSteps ? `${info.maxSteps} steps` : "Unlimited steps"} ·{" "}
            {info.timeoutMinutes
              ? `${info.timeoutMinutes} min limit`
              : "No time limit"}{" "}
            ·{" "}
            {info.mcpServers.length
              ? `MCP: ${info.mcpServers.join(", ")}`
              : "No MCP servers"}
          </span>
        )}
      </div>
      {info?.reason && (
        <p role="status" className="coding-notice">
          {info.reason}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const next = await post<CodingTask>("/api/coding/tasks", {
              prompt,
            });
            setSelected(next.id);
            setPrompt("");
          });
        }}
      >
        <label htmlFor="coding-prompt">What would you like to change?</label>
        <textarea
          id="coding-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={60000}
          placeholder="Add rotation handles to selected assets, run the checks, then commit and push…"
          rows={4}
        />
        <p className="muted">
          Source files, command output and MCP results are sent to your
          selected provider. Uses your existing API connection.
        </p>
        <button
          className="primary"
          disabled={
            busy || running || !info?.available || prompt.trim().length < 4
          }
        >
          <ArrowUp size={15} /> Start coding task
        </button>
        {task && !codingBusy(task.status) && !task.commit && task.baseline && (
          <button
            type="button"
            className="secondary"
            disabled={busy || running || prompt.trim().length < 4}
            onClick={() =>
              void action(async () => {
                await post(`/api/coding/tasks/${task.id}/retry`, { prompt });
                setPrompt("");
              })
            }
          >
            Refine this task
          </button>
        )}
      </form>
      {offline && (
        <p role="status" className="coding-notice">
          Reconnecting to the studio service… This clears on its own once it
          answers again.
        </p>
      )}
      {error && (
        <p role="alert" className="coding-error">
          {error}
          <button className="text-button" onClick={() => void action(load)}>
            Retry connection
          </button>
        </p>
      )}
      {!!info?.tasks.length && (
        <label className="coding-task-picker">
          Task history
          <select
            aria-label="Coding task history"
            value={task?.id || ""}
            onChange={(e) => setSelected(e.target.value)}
          >
            {info.tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.prompt.slice(0, 65)} · {t.status}
              </option>
            ))}
          </select>
        </label>
      )}
      {task && (
        <article className="coding-task">
          {codingBusy(task.status) ? (
            <div className="row coding-status-row">
              <Progress task={task} now={now} />
              {task.status !== "publishing" && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void action(() =>
                      post(`/api/coding/tasks/${task.id}/stop`),
                    )
                  }
                >
                  <Square size={12} /> Stop
                </button>
              )}
            </div>
          ) : (
            <div className="row">
              <strong
                className={
                  task.status === "failed" ? "coding-state-failed" : ""
                }
              >
                {task.status === "ready"
                  ? "Ready for review"
                  : task.status === "pushed"
                    ? task.deployed
                      ? "Deployed to the studio"
                      : "Branch pushed"
                    : task.status === "failed"
                      ? "Failed"
                      : task.status === "cancelled"
                        ? "Stopped"
                        : task.status}
              </strong>
              {task.started && task.updated && (
                <span className="coding-progress-meta">
                  ran {duration(task.updated - task.started)}
                  {task.step ? ` · ${task.step} steps` : ""}
                </span>
              )}
            </div>
          )}
          <h3>{task.prompt}</h3>
          <p className="coding-branch">
            <GitBranch size={14} />
            {task.branch}
          </p>
          {task.summary && <p className="coding-summary">{task.summary}</p>}
          {task.error && (
            <p className="coding-error" role="alert">
              {task.error}
            </p>
          )}
          <details open={codingBusy(task.status)}>
            <summary>Activity · {task.events.length}</summary>
            <ol className="coding-events" ref={log}>
              {task.events.map((event, i) =>
                event.startsWith(NARRATION) ? (
                  <li key={i} className="coding-narration">
                    {event.slice(NARRATION.length)}
                  </li>
                ) : (
                  <li key={i}>{event}</li>
                ),
              )}
            </ol>
          </details>
          {!!task.checks.length && (
            <div className="coding-checks">
              {task.checks.map((check) => (
                <details key={check.name}>
                  <summary>
                    {check.ok ? <Check size={14} /> : "×"} {check.name} ·{" "}
                    {check.ok ? "passed" : "failed"}
                  </summary>
                  <pre>{check.output}</pre>
                </details>
              ))}
            </div>
          )}
          {!!task.files.length && (
            <>
              <details open>
                <summary>{task.files.length} changed files</summary>
                <ul className="coding-files">
                  {task.files.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </details>
              {!!task.baselineFiles.length && (
                <div className="coding-notice">
                  <strong>Includes existing source changes</strong>
                  <p>
                    This checkout also contains {task.baselineFiles.length}{" "}
                    previously uncommitted files. They will be included when
                    this branch is pushed.
                  </p>
                  <details>
                    <summary>Existing changes</summary>
                    <ul className="coding-files">
                      {task.baselineFiles.map((name) => (
                        <li key={name}>{name}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
              <label className="coding-checkbox">
                <input
                  type="checkbox"
                  checked={fullDiff}
                  onChange={(e) => setFullDiff(e.target.checked)}
                />{" "}
                Show full push diff, including existing changes
              </label>
              <details className="coding-diff" open>
                <summary>
                  {fullDiff ? "Full push diff" : "Assistant changes"}
                </summary>
                <pre tabIndex={0}>
                  {fullDiff ? task.publishDiff : task.diff}
                </pre>
              </details>
            </>
          )}
          {(task.status === "ready" || task.status === "pushed") && (
            <div className="coding-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const result = await post<{ url: string }>(
                      `/api/coding/tasks/${task.id}/preview`,
                    );
                    setPreviewUrl(result.url);
                  })
                }
              >
                Prepare UI preview
              </button>
              {previewUrl && (
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  Open preview <ExternalLink size={13} />
                </a>
              )}
              <p className="muted">
                Preview uses temporary scenes. Server changes are covered by
                tests; they are not run in the preview.
              </p>
            </div>
          )}
          {canPublish && (
            <div className="coding-publish">
              <p>
                Push to{" "}
                <strong>{info?.remote || "No GitHub origin configured"}</strong>
                . The running studio stays unchanged.
              </p>
              <label className="coding-checkbox">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />{" "}
                I reviewed the full diff
                {task.baselineFiles.length
                  ? ", including the existing changes"
                  : ""}
                .
              </label>
              <button
                className="primary"
                disabled={busy || !acknowledged || !info?.remote}
                onClick={() =>
                  void action(() =>
                    post(`/api/coding/tasks/${task.id}/publish`, {
                      review: task.review,
                      includeBaseline: acknowledged,
                    }),
                  )
                }
              >
                {task.commit ? "Retry push" : "Commit & push branch"}
              </button>
            </div>
          )}
          {task.status === "pushed" && (
            <div className="coding-actions">
              <p>
                Commit <code>{task.commit?.slice(0, 12)}</code>
                {task.deployed
                  ? " · merged into the studio checkout and live after restart"
                  : task.pushed
                    ? " · pushed by the engineer"
                    : ""}
              </p>
              {task.compareUrl && (
                <a href={task.compareUrl} target="_blank" rel="noreferrer">
                  Compare branch <ExternalLink size={13} />
                </a>
              )}
              {task.pullRequestUrl ? (
                <a href={task.pullRequestUrl} target="_blank" rel="noreferrer">
                  Open pull request <ExternalLink size={13} />
                </a>
              ) : (
                !task.deployed && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      void action(() =>
                        post(`/api/coding/tasks/${task.id}/pull-request`),
                      )
                    }
                  >
                    Create draft pull request
                  </button>
                )
              )}
            </div>
          )}
        </article>
      )}
      {!task && (
        <div className="coding-empty">
          <GitBranch size={26} />
          <p>Your first coding task starts here.</p>
          <span>Private checkout → engineer → checks → review → branch</span>
        </div>
      )}
    </section>
  );
}
