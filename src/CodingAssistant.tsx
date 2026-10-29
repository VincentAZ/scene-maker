import { useEffect, useRef, useState } from "react";
import {
  Code2,
  ArrowUp,
  Check,
  GitBranch,
  Square,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";
import { AttachmentChips, AttachmentPicker } from "./Attachments";
import type { Attachment } from "../shared/attachments";
import type { Provider } from "../shared/modelChoices";
import { codingBusy, type CodingInfo, type CodingTask } from "../shared/coding";
export function CodingAssistant() {
  const [info, setInfo] = useState<CodingInfo | null>(null);
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const form = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [fullDiff, setFullDiff] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
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
        if (active) setInfo(next);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
      if (active) timer = setTimeout(refresh, 2000);
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setAcknowledged(false);
    setPreviewUrl("");
  }, [task?.id, task?.review]);
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
  const running = info?.tasks.some((t) => codingBusy(t.status));
  const canPublish =
    task &&
    (task.status === "ready" || (task.status === "failed" && !!task.commit));
  return (
    <section className="coding-assistant" aria-label="Coding assistant">
      <div className="coding-heading">
        <Code2 size={24} />
        <h2>Build your studio.</h2>
        <p>
          Describe a feature or fix. Review the code, try the preview, then push
          a branch.
        </p>
      </div>
      <div className="coding-provider">
        {info?.provider
          ? `${info.provider} · ${info.model}`
          : "Connect an AI provider in Studio settings."}
      </div>
      {info?.reason && (
        <p role="status" className="coding-notice">
          {info.reason}
        </p>
      )}
      <form
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          void action(async () => {
            const next = await post<CodingTask>("/api/coding/tasks", {
              prompt,
              attachments: attachments.map((a) => a.id),
            });
            setSelected(next.id);
            setPrompt("");
            setAttachments([]);
          });
        }}
      >
        <label htmlFor="coding-prompt">What would you like to change?</label>
        <textarea
          id="coding-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={6000}
          placeholder="Add rotation handles to selected assets…"
          rows={4}
        />
        <AttachmentPicker
          attachments={attachments}
          onChange={setAttachments}
          provider={(info?.provider as Provider | null) ?? null}
          disabled={busy || !info?.available}
          dropZone={form}
          label="Attach reference files to this task"
        />
        <p className="muted">
          Relevant source files and any attached references (mockups,
          screenshots, specs, notes) are sent to your selected provider. Uses
          your existing API connection.
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
                await post(`/api/coding/tasks/${task.id}/retry`, {
                  prompt,
                  attachments: attachments.map((a) => a.id),
                });
                setPrompt("");
                setAttachments([]);
              })
            }
          >
            Refine this task
          </button>
        )}
      </form>
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
          <div className="row">
            <strong>
              {task.status === "ready"
                ? "Ready for review"
                : task.status === "pushed"
                  ? "Branch pushed"
                  : task.status}
            </strong>
            {codingBusy(task.status) && task.status !== "publishing" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void action(() => post(`/api/coding/tasks/${task.id}/stop`))
                }
              >
                <Square size={12} /> Stop
              </button>
            )}
          </div>
          <h3>{task.prompt}</h3>
          {!!task.attachments?.length && (
            <AttachmentChips attachments={task.attachments} />
          )}
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
            <summary>Activity</summary>
            <ol className="coding-events">
              {task.events.map((event, i) => (
                <li key={i}>{event}</li>
              ))}
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
              )}
            </div>
          )}
        </article>
      )}
      {!task && (
        <div className="coding-empty">
          <GitBranch size={26} />
          <p>Your first coding task starts here.</p>
          <span>Private checkout → checks → review → branch</span>
        </div>
      )}
    </section>
  );
}
