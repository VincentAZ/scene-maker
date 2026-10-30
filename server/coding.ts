import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import type { ModelMessage } from "ai";
import { dataDir, atomicWrite } from "./storage";
import { modelFor, type Config } from "./ai";
import { providerErrorMessage } from "./providerErrors";
import {
  runCodingAgent,
  codingStepLimit,
  type AgentEvent,
} from "./codingAgent";
import { deployBranch } from "./codingDeploy";
import {
  git,
  snapshot,
  stageSources,
  reviewHash,
  sandboxCheck,
  sourceFiles,
  readSource,
} from "./codeWorkspace";
import {
  codingBusy,
  NARRATION,
  type CodingTask,
  type CodingInfo,
  type CodingTaskSummary,
  type TranscriptEntry,
} from "../shared/coding";
const exec = promisify(execFile);
export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const idSchema = z.string().uuid();
/** Tasks that may run at once, each in its own checkout. */
export const MAX_PARALLEL = 4;
const TRANSCRIPT_LIMIT = 3000;
export function githubRepository(remote: string) {
  return /^(?:git@github\.com:|https:\/\/github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
    remote,
  )?.[1];
}
type Dependencies = {
  root: string;
  tasksDir: string;
  config: () => Config;
  generate?: typeof runCodingAgent;
  check?: typeof sandboxCheck;
  remote?: string;
  probeSandbox?: () => Promise<void>;
  deploy?: typeof deployBranch;
};
type Handle = {
  controller: AbortController;
  steer?: (text: string) => Promise<boolean>;
};
type NewEntry =
  | Omit<Extract<TranscriptEntry, { kind: "user" }>, "id" | "at">
  | Omit<Extract<TranscriptEntry, { kind: "assistant" }>, "id" | "at">
  | Omit<Extract<TranscriptEntry, { kind: "tool" }>, "at">
  | Omit<Extract<TranscriptEntry, { kind: "status" }>, "id" | "at">;
export const codingTimeoutMinutes = () =>
  Math.max(0, Number(process.env.SCENE_MAKER_CODING_TIMEOUT_MINUTES) || 0);
/** Rebuild a transcript from the flat activity log of tasks made before transcripts. */
function legacyTranscript(task: CodingTask): TranscriptEntry[] {
  const at = task.created;
  const entries: TranscriptEntry[] = [
    { kind: "user", id: "legacy-prompt", at, text: task.prompt },
  ];
  task.events.forEach((event, i) =>
    entries.push(
      event.startsWith(NARRATION)
        ? { kind: "assistant", id: `legacy-${i}`, at, text: event.slice(NARRATION.length) }
        : { kind: "status", id: `legacy-${i}`, at, text: event },
    ),
  );
  if (task.summary && !task.events.some((e) => e.includes(task.summary.slice(0, 60))))
    entries.push({ kind: "assistant", id: "legacy-summary", at, text: task.summary });
  if (task.error)
    entries.push({ kind: "status", id: "legacy-error", at, text: task.error, tone: "error" });
  return entries;
}
export class CodingService {
  readonly tasks = new Map<string, CodingTask>();
  private running = new Map<string, Handle>();
  private queues = new Map<string, string[]>();
  private locks = new Set<string>();
  private deploying: Promise<unknown> = Promise.resolve();
  private availability?: { at: number; reason: string };
  constructor(readonly options: Dependencies) {
    fs.mkdirSync(options.tasksDir, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(options.tasksDir)) {
      if (!idSchema.safeParse(entry).success) continue;
      const file = path.join(options.tasksDir, entry, "task.json");
      if (!fs.existsSync(file)) continue;
      let task: CodingTask;
      try {
        task = JSON.parse(fs.readFileSync(file, "utf8")) as CodingTask;
      } catch {
        continue;
      }
      task.events ??= [];
      task.transcript ??= legacyTranscript(task);
      for (const item of task.transcript)
        if (item.kind === "tool" && item.status === "running") {
          item.status = "error";
          item.output = "Interrupted by a studio restart.";
        }
      if (codingBusy(task.status) && task.deployed) {
        task.status = "pushed";
        task.summary ||= "Deployed to the running studio.";
        this.note(task, "The studio restarted with this change.", "success");
      } else if (codingBusy(task.status)) {
        task.status = "failed";
        task.error =
          "The studio restarted during this task. Its conversation and changes are saved; send a message to continue.";
        this.note(task, task.error, "error");
      }
      this.tasks.set(task.id, task);
      this.save(task);
    }
  }
  checkout(id: string) {
    idSchema.parse(id);
    return path.join(this.options.tasksDir, id, "checkout");
  }
  get(id: string) {
    idSchema.parse(id);
    const task = this.tasks.get(id);
    if (!task) throw Error("Coding task not found.");
    return task;
  }
  private save(task: CodingTask) {
    const dir = path.join(this.options.tasksDir, task.id);
    // Deleted while a run was finishing: do not resurrect it.
    if (!this.tasks.has(task.id) && !fs.existsSync(dir)) return;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "task.json"), task);
  }
  private add(task: CodingTask, entry: NewEntry) {
    const item = {
      id: randomUUID().slice(0, 13),
      ...entry,
      at: Date.now(),
    } as TranscriptEntry;
    task.transcript ??= [];
    task.transcript.push(item);
    if (task.transcript.length > TRANSCRIPT_LIMIT)
      task.transcript.splice(0, task.transcript.length - TRANSCRIPT_LIMIT);
    task.updated = Date.now();
    this.save(task);
    return item;
  }
  private note(
    task: CodingTask,
    text: string,
    tone?: "info" | "success" | "warning" | "error",
  ) {
    return this.add(task, { kind: "status", text: String(text ?? "").slice(0, 4000), tone });
  }
  private onAgent(task: CodingTask, event: AgentEvent) {
    switch (event.type) {
      case "text":
        this.add(task, {
          kind: "assistant",
          text: event.text.slice(0, 40_000),
          depth: event.depth || undefined,
        });
        return;
      case "tool-start":
        this.add(task, {
          kind: "tool",
          id: event.id,
          name: event.name,
          title: event.title,
          input: event.input,
          status: "running",
          depth: event.depth || undefined,
        });
        return;
      case "tool-end": {
        const item = [...(task.transcript || [])]
          .reverse()
          .find((e) => e.kind === "tool" && e.id === event.id);
        if (item && item.kind === "tool") {
          item.status = event.ok ? "ok" : "error";
          item.output = event.output;
          item.ended = Date.now();
        }
        task.updated = Date.now();
        this.save(task);
        return;
      }
      case "status":
        this.note(task, event.text, event.tone);
        return;
      case "progress":
        task.step = event.step;
        task.maxSteps = event.maxSteps;
        task.updated = Date.now();
        this.save(task);
        return;
      case "steered": {
        const item = task.transcript?.find(
          (e) => e.kind === "user" && e.queued && e.text === event.text,
        );
        if (item && item.kind === "user") item.queued = undefined;
        this.save(task);
        return;
      }
    }
  }
  private historyFile(task: CodingTask) {
    return path.join(this.options.tasksDir, task.id, "messages.json");
  }
  private loadHistory(task: CodingTask): ModelMessage[] {
    try {
      return JSON.parse(fs.readFileSync(this.historyFile(task), "utf8"));
    } catch {
      // Tasks from before conversations were saved: give the engineer the gist.
      if (!task.summary) return [];
      return [
        { role: "user", content: task.prompt },
        { role: "assistant", content: task.summary },
      ];
    }
  }
  private saveHistory(task: CodingTask, messages: ModelMessage[]) {
    if (!this.tasks.has(task.id)) return;
    atomicWrite(this.historyFile(task), messages);
  }
  async remote() {
    const remote =
      this.options.remote ??
      (await git(this.options.root, [
        "remote",
        "get-url",
        "--push",
        "origin",
      ]).catch(() => ""));
    if (this.options.remote !== undefined || githubRepository(remote))
      return remote;
    return "";
  }
  private async unavailable() {
    if (this.availability && Date.now() - this.availability.at < 30_000)
      return this.availability.reason;
    let reason = "";
    try {
      await git(this.options.root, ["rev-parse", "--show-toplevel"]);
      if (this.options.probeSandbox) await this.options.probeSandbox();
      else
        await exec(
          "bwrap",
          ["--ro-bind", "/", "/", "--unshare-net", "--die-with-parent", "--", "/usr/bin/true"],
          { timeout: 5000 },
        );
      if (!fs.existsSync(path.join(this.options.root, "node_modules/typescript/bin/tsc")))
        throw Error("Install the studio dependencies first.");
    } catch {
      reason =
        "Coding requires a Git checkout, installed dependencies, and working Bubblewrap isolation on this Linux machine.";
    }
    this.availability = { at: Date.now(), reason };
    return reason;
  }
  summary(task: CodingTask): CodingTaskSummary {
    const transcript = task.transcript || [];
    const lastReply = [...transcript]
      .reverse()
      .find((e) => e.kind === "assistant" && !e.depth);
    return {
      id: task.id,
      prompt: task.prompt,
      branch: task.branch,
      status: task.status,
      created: task.created,
      updated: task.updated,
      step: task.step,
      error: task.error,
      pushed: task.pushed,
      deployed: task.deployed,
      compareUrl: task.compareUrl,
      pullRequestUrl: task.pullRequestUrl,
      fileCount: task.files.length,
      lastMessage: (lastReply && "text" in lastReply ? lastReply.text : task.summary)
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+[.)]|>)\s+/gm, "")
        .replace(/\*\*|__|`/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
      searchText: [
        task.prompt,
        task.branch,
        task.summary,
        ...transcript.filter((e) => e.kind === "user").map((e) => ("text" in e ? e.text : "")),
        ...task.files,
      ]
        .join("\n")
        .slice(0, 6000),
    };
  }
  async info(): Promise<CodingInfo> {
    let reason = await this.unavailable();
    const config = this.options.config();
    if (!config.assistant || !config.providers[config.assistant]?.key)
      reason ||= "Choose a connected AI provider in Studio settings → Connections.";
    return {
      repository: path.basename(this.options.root),
      remote: await this.remote(),
      available: !reason,
      reason: reason || undefined,
      provider: config.assistant,
      model: config.assistant ? config.providers[config.assistant]?.model || "" : "",
      mcpServers: Object.keys(config.mcpServers || {}),
      maxSteps: codingStepLimit(),
      timeoutMinutes: codingTimeoutMinutes(),
      tasks: [...this.tasks.values()]
        .sort((a, b) => (b.updated || b.created) - (a.updated || a.created))
        .map((t) => this.summary(t)),
    };
  }
  private validConfig() {
    const config = structuredClone(this.options.config());
    modelFor(config, config.assistant); // Fail early if setup is incomplete.
    return config;
  }
  async start(prompt: string) {
    const busy = [...this.tasks.values()].filter((t) => codingBusy(t.status)).length;
    if (busy >= MAX_PARALLEL)
      throw Error(
        `${MAX_PARALLEL} tasks are already running. Wait for one to finish or stop one.`,
      );
    const reason = (await this.info()).reason;
    if (reason) throw Error(reason);
    const config = this.validConfig();
    const id = randomUUID();
    const task: CodingTask = {
      id,
      prompt,
      branch: `studio/code-${id.slice(0, 12)}`,
      base: "",
      baseline: "",
      baseBranch: "",
      status: "preparing",
      created: Date.now(),
      started: Date.now(),
      updated: Date.now(),
      step: 0,
      maxSteps: codingStepLimit(),
      provider: config.assistant!,
      model: config.providers[config.assistant!]?.model || "",
      summary: "",
      events: [],
      transcript: [],
      baselineFiles: [],
      files: [],
      diff: "",
      publishDiff: "",
      review: "",
      checks: [],
    };
    this.tasks.set(id, task);
    this.add(task, { kind: "user", text: prompt });
    const controller = new AbortController();
    this.running.set(id, { controller });
    void this.run(task, config, controller, true, prompt);
    return task;
  }
  /**
   * Send the engineer a message. While it works, the message reaches it at the
   * next step; otherwise it starts the next turn of the same conversation in
   * the same checkout, whatever the task's state, including after a push.
   */
  async reply(id: string, message: string) {
    const task = this.get(id);
    if (this.locks.has(id))
      throw Error("Wait for the push to finish, then send your message.");
    if (codingBusy(task.status)) {
      const entry = this.add(task, { kind: "user", text: message, queued: true });
      const handle = this.running.get(id);
      if (task.status === "working" && handle?.steer)
        void handle.steer(message).then((delivered) => {
          if (!delivered) this.enqueue(task, message, entry.id);
        });
      else this.enqueue(task, message, entry.id);
      return task;
    }
    const busy = [...this.tasks.values()].filter((t) => codingBusy(t.status)).length;
    if (busy >= MAX_PARALLEL)
      throw Error(`${MAX_PARALLEL} tasks are already running. Wait for one to finish.`);
    this.add(task, { kind: "user", text: message });
    return this.resume(task, message);
  }
  /** Kept for the earlier API: refining is replying. */
  retry(id: string, prompt: string) {
    return this.reply(id, prompt);
  }
  private enqueue(task: CodingTask, message: string, entryId: string) {
    if (this.running.has(task.id)) {
      this.queues.set(task.id, [...(this.queues.get(task.id) || []), message]);
      return;
    }
    // The run ended between the message and its delivery: start the next turn.
    const item = task.transcript?.find((e) => e.id === entryId);
    if (item && item.kind === "user") item.queued = undefined;
    try {
      this.resume(task, message);
    } catch (error) {
      this.note(task, (error as Error).message, "error");
    }
  }
  private resume(task: CodingTask, message: string) {
    const config = this.validConfig();
    const failedChecks = task.checks.filter((c) => !c.ok);
    const feedback = failedChecks.length
      ? "\n\nThe last automated checks failed:\n" +
        failedChecks.map((c) => `${c.name}:\n${c.output}`).join("\n")
      : "";
    const prepare = !task.baseline;
    if (prepare) fs.rmSync(this.checkout(task.id), { recursive: true, force: true });
    task.provider = config.assistant!;
    task.model = config.providers[config.assistant!]?.model || "";
    task.status = prepare ? "preparing" : "working";
    task.error = undefined;
    task.previewUrl = undefined;
    task.checkedReview = undefined;
    task.started = Date.now();
    task.updated = Date.now();
    task.step = 0;
    task.maxSteps = codingStepLimit();
    const controller = new AbortController();
    this.running.set(task.id, { controller });
    this.save(task);
    void this.run(task, config, controller, prepare, message + feedback);
    return task;
  }
  private async refresh(task: CodingTask) {
    if (!task.baseline) return;
    const checkout = this.checkout(task.id);
    if (!fs.existsSync(checkout)) return;
    await stageSources(checkout);
    task.diff = await git(checkout, ["diff", "--cached", "--no-ext-diff", "--no-textconv", task.baseline]);
    task.publishDiff = await git(checkout, ["diff", "--cached", "--no-ext-diff", "--no-textconv", task.base]);
    task.files = (await git(checkout, ["diff", "--cached", "--name-only", task.baseline]))
      .split("\n")
      .filter(Boolean);
    task.review = reviewHash(task.publishDiff);
    this.save(task);
  }
  private async check(task: CodingTask, signal: AbortSignal) {
    const checkout = this.checkout(task.id);
    task.status = "checking";
    task.checks = [];
    this.note(task, "Running TypeScript, tests and the production build in an isolated sandbox…");
    const snapshotTree = async () => [
      await git(checkout, ["diff", "HEAD", "--no-ext-diff", "--no-textconv"]),
      sourceFiles(checkout)
        .map((name) => {
          try {
            return name + readSource(checkout, name);
          } catch {
            return name;
          }
        })
        .join("\n"),
    ].join("\0");
    const before = await snapshotTree();
    const commands: [string, string[]][] = [
      ["TypeScript", ["node", "node_modules/typescript/bin/tsc", "-b"]],
      ["Tests", ["node", "node_modules/vitest/vitest.mjs", "run"]],
      [
        "Production build",
        ["node", "node_modules/vite/bin/vite.js", "build", "--base", `/preview/${task.id}/`],
      ],
    ];
    for (const [name, command] of commands) {
      const result = await (this.options.check || sandboxCheck)(
        checkout,
        path.join(this.options.root, "node_modules"),
        command,
        signal,
      );
      signal.throwIfAborted();
      task.checks.push({ name, ...result });
      this.note(task, `${name}: ${result.ok ? "passed" : "failed"}`, result.ok ? "success" : "error");
    }
    if (before !== (await snapshotTree()))
      throw Error("A check modified source files. Review and retry before publishing.");
    if (!task.checks.every((c) => c.ok))
      throw Error("Some checks failed. Send a message asking the engineer to fix them.");
    await this.refresh(task);
    task.checkedReview = task.review;
    task.status = "ready";
    this.note(task, "Ready to review. Nothing has been pushed or applied to the running studio.", "success");
  }
  private async run(
    task: CodingTask,
    config: Config,
    controller: AbortController,
    prepare: boolean,
    message: string,
  ) {
    const handle = this.running.get(task.id)!;
    const minutes = codingTimeoutMinutes();
    const timeout = minutes ? setTimeout(() => controller.abort(), minutes * 60_000) : undefined;
    const signal = controller.signal;
    const checkout = this.checkout(task.id);
    let pushed = false;
    let deployed = false;
    try {
      if (prepare) {
        this.note(task, "Preparing a private checkout of the current source…");
        Object.assign(task, await snapshot(this.options.root, checkout, task.branch, signal));
        this.note(
          task,
          `Checkout ready on ${task.branch}${task.baselineFiles.length ? `, including ${task.baselineFiles.length} uncommitted studio changes` : ""}.`,
        );
      }
      signal.throwIfAborted();
      task.status = "working";
      task.started = Date.now();
      this.save(task);
      const remote = await this.remote();
      task.summary = await (this.options.generate || runCodingAgent)(
        config,
        checkout,
        message,
        signal,
        (event) => this.onAgent(task, event),
        undefined,
        {
          remote: remote || undefined,
          branch: task.branch,
          mcpServers: config.mcpServers,
          dependencies: path.join(this.options.root, "node_modules"),
          history: this.loadHistory(task),
          onHistory: (messages) => this.saveHistory(task, messages),
          onSteer: (steer) => {
            handle.steer = steer;
          },
          onCommit: (commit) => {
            task.commit = commit;
            this.save(task);
          },
          onPush: (commit) => {
            pushed = true;
            task.commit = commit;
            task.pushedCommit = commit;
            task.pushed = true;
            const repo = githubRepository(remote);
            task.compareUrl = repo
              ? `https://github.com/${repo}/compare/${encodeURIComponent(task.baseBranch)}...${encodeURIComponent(task.branch)}?expand=1`
              : undefined;
            this.note(task, `Pushed ${task.branch} (${commit.slice(0, 10)}).`, "success");
          },
          deploy: async () => {
            const result = this.deploying.then(() =>
              (this.options.deploy || deployBranch)(this.options.root, checkout, task.branch, signal),
            );
            this.deploying = result.catch(() => {});
            const text = await result;
            deployed = true;
            task.deployed = true;
            task.commit = await git(checkout, ["rev-parse", "HEAD"]);
            this.note(task, text, "success");
            return text;
          },
        },
      );
      signal.throwIfAborted();
      await this.refresh(task);
      const head = task.baseline ? await git(checkout, ["rev-parse", "HEAD"]) : "";
      const dirty = task.baseline ? !!(await git(checkout, ["status", "--porcelain"])) : false;
      if (deployed) task.status = "pushed";
      else if (task.files.length && (dirty || head !== task.pushedCommit))
        await this.check(task, signal);
      else if (pushed || task.pushedCommit) task.status = "pushed";
      else task.status = "idle";
    } catch (error) {
      const aborted = signal.aborted;
      const text = aborted
        ? minutes && Date.now() - (task.started || 0) >= minutes * 60_000
          ? `Stopped after the configured ${minutes}-minute limit. Partial changes are kept; send a message to continue.`
          : "Stopped. Partial changes are kept; send a message to continue."
        : providerErrorMessage(error) ||
          String((error as Error)?.message || error || "Unknown error").slice(0, 2000);
      // The task stays busy until its state is final, so nothing can start
      // a new turn while this one is still cleaning up.
      await this.refresh(task).catch(() => {});
      task.status = aborted ? "cancelled" : "failed";
      task.error = text;
      this.note(task, text, aborted ? "warning" : "error");
    } finally {
      if (timeout) clearTimeout(timeout);
      handle.steer = undefined;
      if (this.running.get(task.id) === handle) this.running.delete(task.id);
      task.updated = Date.now();
      this.save(task);
      const queued = this.queues.get(task.id);
      this.queues.delete(task.id);
      if (queued?.length && this.tasks.has(task.id)) {
        for (const item of task.transcript || [])
          if (item.kind === "user" && item.queued) item.queued = undefined;
        try {
          this.resume(task, queued.join("\n\n"));
        } catch (error) {
          this.note(task, (error as Error).message, "error");
        }
      }
    }
  }
  cancel(id: string) {
    const task = this.get(id);
    if (task.status === "publishing") throw Error("Publishing is already in progress.");
    this.queues.delete(id);
    for (const item of task.transcript || [])
      if (item.kind === "user" && item.queued) {
        item.queued = undefined;
        item.dropped = true;
      }
    this.running.get(id)?.controller.abort();
    this.save(task);
    return task;
  }
  delete(id: string) {
    const task = this.get(id);
    if (codingBusy(task.status) || this.running.has(id) || this.locks.has(id))
      throw Error("Stop the task before deleting it.");
    this.tasks.delete(id);
    this.queues.delete(id);
    fs.rmSync(path.join(this.options.tasksDir, id), { recursive: true, force: true });
    return { deleted: id };
  }
  /** Remove every task that is not running. Pushed branches stay on GitHub. */
  clear() {
    const removed: string[] = [];
    for (const task of [...this.tasks.values()])
      if (!codingBusy(task.status) && !this.running.has(task.id) && !this.locks.has(task.id)) {
        this.delete(task.id);
        removed.push(task.id);
      }
    return { removed: removed.length };
  }
  busyCount() {
    return [...this.tasks.values()].filter((t) => codingBusy(t.status)).length;
  }
  /** Stop every running task, e.g. before the studio restarts. */
  stopAll() {
    for (const id of this.running.keys()) {
      try {
        this.cancel(id);
      } catch {
        /* publishing finishes on its own */
      }
    }
  }
  async publish(id: string, review: string, includeBaseline: boolean) {
    const task = this.get(id);
    if (this.locks.has(id)) throw Error("An operation is already running for this task.");
    if (task.status === "pushed") return task;
    if (task.status !== "ready")
      throw Error("Only a checked, reviewed task can be published.");
    this.locks.add(id);
    try {
      await this.refresh(task);
      if (task.review !== review || task.review !== task.checkedReview)
        throw Error("The diff changed. Review it again before publishing.");
      if (task.baselineFiles.length && !includeBaseline)
        throw Error("Confirm that the existing uncommitted changes are included in this branch.");
      if (task.checks.length !== 3 || !task.checks.every((c) => c.ok))
        throw Error("All checks must pass before publishing.");
      const remote = await this.remote();
      if (!remote) throw Error("Configure a GitHub origin remote before publishing.");
      task.status = "publishing";
      task.error = undefined;
      this.save(task);
      const checkout = this.checkout(id);
      if (await git(checkout, ["diff", "--cached", "--name-only"]))
        await git(checkout, ["commit", "-m", task.prompt.replace(/[\r\n]/g, " ").slice(0, 180)]);
      const commit = await git(checkout, ["rev-parse", "HEAD"]);
      task.commit = commit;
      this.save(task);
      // An exact branch refspec, without force; never writes the current/default branch.
      await git(checkout, ["push", "--", remote, `${commit}:refs/heads/${task.branch}`]);
      const repo = githubRepository(remote);
      task.compareUrl = repo
        ? `https://github.com/${repo}/compare/${encodeURIComponent(task.baseBranch)}...${encodeURIComponent(task.branch)}?expand=1`
        : undefined;
      task.pushedCommit = commit;
      task.pushed = true;
      task.status = "pushed";
      this.note(task, `Committed and pushed ${task.branch} (${commit.slice(0, 10)}). The running studio is unchanged.`, "success");
      return task;
    } catch (error) {
      if (task.status === "publishing") {
        task.status = "ready";
        task.error = `Publishing failed: ${((error as Error).message || "").split("\n").find((l) => l.trim()) || "unknown error"}. Check Git authentication and the remote, then retry. Your checkout is preserved.`;
        this.note(task, task.error, "error");
        throw Error(task.error);
      }
      throw error;
    } finally {
      this.locks.delete(id);
    }
  }
  async pullRequest(id: string) {
    const task = this.get(id);
    if (task.status !== "pushed") throw Error("Push the reviewed branch first.");
    if (task.pullRequestUrl) return task;
    if (this.locks.has(id)) throw Error("An operation is already running for this task.");
    this.locks.add(id);
    try {
      const repo = githubRepository(await this.remote());
      if (!repo) throw Error("A GitHub repository is required.");
      const existing = await exec(
        "gh",
        ["pr", "list", "--repo", repo, "--head", task.branch, "--state", "open", "--json", "url"],
        { timeout: 30_000 },
      );
      const found = JSON.parse(existing.stdout) as { url: string }[];
      if (found[0]) task.pullRequestUrl = found[0].url;
      else {
        const body = path.join(this.options.tasksDir, id, "pull-request.md");
        fs.writeFileSync(
          body,
          `${task.summary}\n\n${task.checks.length ? `Validation: ${task.checks.map((c) => `${c.name} ${c.ok ? "passed" : "failed"}`).join(", ")}.\n` : ""}${task.baselineFiles.length ? "\nIncludes the existing source changes explicitly reviewed in Scene Maker.\n" : ""}`,
          { mode: 0o600 },
        );
        const result = await exec(
          "gh",
          [
            "pr",
            "create",
            "--draft",
            "--repo",
            repo,
            "--base",
            task.baseBranch,
            "--head",
            task.branch,
            "--title",
            task.prompt.replace(/[\r\n]/g, " ").slice(0, 180),
            "--body-file",
            body,
          ],
          { timeout: 30_000 },
        );
        const url = result.stdout.trim();
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url))
          throw Error("GitHub returned an unexpected pull-request response.");
        task.pullRequestUrl = url;
      }
      this.note(task, `Draft pull request: ${task.pullRequestUrl}`, "success");
      return task;
    } catch {
      throw Error(
        "Could not open the pull request. Check GitHub CLI authentication, or use the Compare branch link.",
      );
    } finally {
      this.locks.delete(id);
    }
  }
}
const message = z.string().trim().min(1).max(60_000);
export function codingRouter(
  service: CodingService,
  preview: (task: CodingTask) => Promise<string>,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_req, res) => res.json(await service.info()));
  router.post("/tasks", async (req, res) => {
    const { prompt } = z.object({ prompt: message }).parse(req.body);
    res.status(202).json(service.summary(await service.start(prompt)));
  });
  router.post("/tasks/clear", (_req, res) => res.json(service.clear()));
  router.get("/tasks/:id", (req, res) => res.json(service.get(String(req.params.id))));
  router.delete("/tasks/:id", (req, res) => res.json(service.delete(String(req.params.id))));
  router.post("/tasks/:id/stop", (req, res) =>
    res.json(service.summary(service.cancel(String(req.params.id)))),
  );
  router.post("/tasks/:id/reply", async (req, res) => {
    const body = z.object({ message }).parse(req.body);
    res.status(202).json(service.summary(await service.reply(String(req.params.id), body.message)));
  });
  router.post("/tasks/:id/retry", async (req, res) => {
    const { prompt } = z.object({ prompt: message }).parse(req.body);
    res.status(202).json(service.summary(await service.retry(String(req.params.id), prompt)));
  });
  router.post("/tasks/:id/publish", async (req, res) => {
    const body = z
      .object({ review: z.string().length(64), includeBaseline: z.boolean() })
      .parse(req.body);
    res.json(
      service.summary(
        await service.publish(String(req.params.id), body.review, body.includeBaseline),
      ),
    );
  });
  router.post("/tasks/:id/pull-request", async (req, res) =>
    res.json(service.summary(await service.pullRequest(String(req.params.id)))),
  );
  router.post("/tasks/:id/preview", async (req, res) => {
    const task = service.get(String(req.params.id));
    if (!["ready", "pushed"].includes(task.status))
      throw Error("The build must pass before opening a preview.");
    res.json({ url: await preview(task) });
  });
  return router;
}
export function createCodingService(config: () => Config) {
  return new CodingService({
    root: repositoryRoot,
    tasksDir: path.join(dataDir, "coding"),
    config,
  });
}
