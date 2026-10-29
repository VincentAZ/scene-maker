import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Router } from "express";
import { z } from "zod";
import { dataDir, atomicWrite } from "./storage";
import { modelFor, type Config } from "./ai";
import { providerErrorMessage } from "./providerErrors";
import { runCodingAgent } from "./codingAgent";
import {
  assertAttachmentSupport,
  type AttachmentStore,
  type LoadedAttachment,
} from "./attachments";
import {
  attachmentIdsSchema,
  maxAttachments,
  type Attachment,
} from "../shared/attachments";
import {
  git,
  snapshot,
  stageSources,
  reviewHash,
  sandboxCheck,
  sourceFiles,
  readSource,
} from "./codeWorkspace";
import { codingBusy, type CodingTask, type CodingInfo } from "../shared/coding";
const exec = promisify(execFile);
export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const idSchema = z.string().uuid();
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
  /** Where uploaded reference files live; omitted when attachments are unavailable. */
  attachments?: AttachmentStore;
};
export class CodingService {
  readonly tasks = new Map<string, CodingTask>();
  private running = new Map<string, AbortController>();
  private starting = false;
  private locks = new Set<string>();
  constructor(readonly options: Dependencies) {
    fs.mkdirSync(options.tasksDir, { recursive: true, mode: 0o700 });
    for (const entry of fs.readdirSync(options.tasksDir)) {
      if (!idSchema.safeParse(entry).success) continue;
      const file = path.join(options.tasksDir, entry, "task.json");
      if (!fs.existsSync(file)) continue;
      const task = JSON.parse(fs.readFileSync(file, "utf8")) as CodingTask;
      if (codingBusy(task.status)) {
        task.status = "failed";
        task.error =
          "The studio restarted during this task. Review its changes and retry.";
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
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    atomicWrite(path.join(dir, "task.json"), task);
  }
  private event(task: CodingTask, message: string) {
    task.events = [...task.events.slice(-79), message.slice(0, 500)];
    this.save(task);
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
  async info(): Promise<CodingInfo> {
    let reason = "";
    try {
      await git(this.options.root, ["rev-parse", "--show-toplevel"]);
      if (this.options.probeSandbox) await this.options.probeSandbox();
      else
        await exec(
          "bwrap",
          [
            "--ro-bind",
            "/",
            "/",
            "--unshare-net",
            "--die-with-parent",
            "--",
            "/usr/bin/true",
          ],
          { timeout: 5000 },
        );
      if (
        !fs.existsSync(
          path.join(this.options.root, "node_modules/typescript/bin/tsc"),
        )
      )
        throw Error("Install the studio dependencies first.");
    } catch {
      reason =
        "Coding requires a Git checkout, installed dependencies, and working Bubblewrap isolation on this Linux machine.";
    }
    const config = this.options.config();
    if (!config.assistant || !config.providers[config.assistant]?.key)
      reason ||=
        "Choose a connected AI provider in Studio settings → Connections.";
    return {
      repository: path.basename(this.options.root),
      remote: await this.remote(),
      available: !reason,
      reason: reason || undefined,
      provider: config.assistant,
      model: config.assistant
        ? config.providers[config.assistant]?.model || ""
        : "",
      tasks: [...this.tasks.values()].sort((a, b) => b.created - a.created),
    };
  }
  /** Resolve attachment metadata and check provider support before any task work. */
  private resolveAttachments(config: Config, ids: string[]): Attachment[] {
    if (!ids.length) return [];
    if (ids.length > maxAttachments)
      throw Error(`Attach up to ${maxAttachments} files per task.`);
    if (!this.options.attachments)
      throw Error("Attachments are not available for coding tasks.");
    const attachments = [...new Set(ids)].map((id) =>
      this.options.attachments!.get(id),
    );
    assertAttachmentSupport(config.assistant, attachments);
    return attachments;
  }
  private loadAttachments(task: CodingTask): LoadedAttachment[] {
    if (!task.attachments?.length) return [];
    if (!this.options.attachments)
      throw Error("Attachments are not available for coding tasks.");
    return this.options.attachments.load(task.attachments.map((a) => a.id));
  }
  async start(prompt: string, attachmentIds: string[] = []) {
    if (
      this.starting ||
      [...this.tasks.values()].some((t) => codingBusy(t.status))
    )
      throw Error(
        "A coding task is already running. Stop it or wait for it to finish.",
      );
    this.starting = true;
    try {
      const info = await this.info();
      if (!info.available) throw Error(info.reason);
      const config = structuredClone(this.options.config());
      modelFor(config, config.assistant); // Fail before creating a task if setup is incomplete.
      const attachments = this.resolveAttachments(config, attachmentIds);
      const id = randomUUID();
      const task: CodingTask = {
        id,
        prompt,
        ...(attachments.length ? { attachments } : {}),
        branch: `studio/code-${id.slice(0, 12)}`,
        base: "",
        baseline: "",
        baseBranch: "",
        status: "preparing",
        created: Date.now(),
        provider: info.provider!,
        model: info.model,
        summary: "",
        events: [],
        baselineFiles: [],
        files: [],
        diff: "",
        publishDiff: "",
        review: "",
        checks: [],
      };
      this.tasks.set(id, task);
      this.save(task);
      const controller = new AbortController();
      this.running.set(id, controller);
      void this.run(task, config, controller, true);
      return task;
    } finally {
      this.starting = false;
    }
  }
  async retry(id: string, prompt: string, attachmentIds: string[] = []) {
    const task = this.get(id);
    if ([...this.tasks.values()].some((t) => codingBusy(t.status)))
      throw Error("Wait for the current task to finish.");
    if (task.commit)
      throw Error(
        "This task is already committed. Start a new task for further changes.",
      );
    if (!task.baseline)
      throw Error("Preparation did not finish. Start a new task.");
    const config = structuredClone(this.options.config());
    modelFor(config, config.assistant);
    const attachments = this.resolveAttachments(config, attachmentIds);
    task.provider = config.assistant!;
    task.model = config.providers[config.assistant!]?.model || "";
    task.prompt = prompt;
    task.attachments = attachments.length ? attachments : undefined;
    task.status = "working";
    task.error = undefined;
    task.previewUrl = undefined;
    task.checkedReview = undefined;
    const controller = new AbortController();
    this.running.set(id, controller);
    this.save(task);
    void this.run(task, config, controller, false);
    return task;
  }
  private async refresh(task: CodingTask) {
    if (!task.baseline) return;
    const checkout = this.checkout(task.id);
    await stageSources(checkout);
    task.diff = await git(checkout, [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      task.baseline,
    ]);
    task.publishDiff = await git(checkout, [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      task.base,
    ]);
    task.files = (
      await git(checkout, ["diff", "--cached", "--name-only", task.baseline])
    )
      .split("\n")
      .filter(Boolean);
    task.review = reviewHash(task.publishDiff);
    this.save(task);
  }
  private async run(
    task: CodingTask,
    config: Config,
    controller: AbortController,
    prepare: boolean,
  ) {
    const timeout = setTimeout(() => controller.abort(), 15 * 60_000);
    const signal = controller.signal;
    try {
      if (prepare) {
        this.event(task, "Preparing a private checkout of the current source…");
        Object.assign(
          task,
          await snapshot(
            this.options.root,
            this.checkout(task.id),
            task.branch,
            signal,
          ),
        );
      }
      signal.throwIfAborted();
      task.status = "working";
      this.event(task, `Implementing with ${task.provider} · ${task.model}`);
      const attachments = this.loadAttachments(task);
      if (attachments.length)
        this.event(
          task,
          `Sending ${attachments.length} attached file${attachments.length === 1 ? "" : "s"}: ${attachments.map((a) => a.name).join(", ")}`,
        );
      const feedback = task.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name}: ${c.output}`)
        .join("\n");
      task.summary = await (this.options.generate || runCodingAgent)(
        config,
        this.checkout(task.id),
        task.prompt + (feedback ? "\nPrevious checks:\n" + feedback : ""),
        signal,
        (message) => this.event(task, message),
        undefined,
        attachments,
      );
      signal.throwIfAborted();
      await this.refresh(task);
      if (!task.files.length)
        throw Error(
          "The assistant made no source changes. Refine the request and try again.",
        );
      task.status = "checking";
      task.checks = [];
      this.event(
        task,
        "Running checks with networking disabled and no host credentials…",
      );
      const beforeGit = await git(this.checkout(task.id), [
        "diff",
        "HEAD",
        "--no-ext-diff",
        "--no-textconv",
      ]);
      const before = sourceFiles(this.checkout(task.id))
        .map((name) => name + readSource(this.checkout(task.id), name))
        .join("\n");
      const commands: [string, string[]][] = [
        ["TypeScript", ["node", "node_modules/typescript/bin/tsc", "-b"]],
        ["Tests", ["node", "node_modules/vitest/vitest.mjs", "run"]],
        [
          "Production build",
          [
            "node",
            "node_modules/vite/bin/vite.js",
            "build",
            "--base",
            `/preview/${task.id}/`,
          ],
        ],
      ];
      for (const [name, command] of commands) {
        const result = await (this.options.check || sandboxCheck)(
          this.checkout(task.id),
          path.join(this.options.root, "node_modules"),
          command,
          signal,
        );
        signal.throwIfAborted();
        task.checks.push({ name, ...result });
        this.event(task, `${name}: ${result.ok ? "passed" : "failed"}`);
      }
      const after = sourceFiles(this.checkout(task.id))
        .map((name) => name + readSource(this.checkout(task.id), name))
        .join("\n");
      if (
        before !== after ||
        beforeGit !==
          (await git(this.checkout(task.id), [
            "diff",
            "HEAD",
            "--no-ext-diff",
            "--no-textconv",
          ]))
      )
        throw Error(
          "A check modified source files. Review and retry before publishing.",
        );
      if (!task.checks.every((c) => c.ok))
        throw Error(
          "Some checks failed. Review the logs and ask the assistant to fix them.",
        );
      await this.refresh(task);
      task.checkedReview = task.review;
      task.status = "ready";
      this.event(
        task,
        "Ready to review. Nothing has been pushed or applied to the running studio.",
      );
    } catch (error) {
      task.status = signal.aborted ? "cancelled" : "failed";
      task.error = signal.aborted
        ? "Task stopped. Partial changes are kept for review."
        : providerErrorMessage(error) ||
          (error as Error).message.slice(0, 1000);
      await this.refresh(task).catch(() => {});
      this.save(task);
    } finally {
      clearTimeout(timeout);
      this.running.delete(task.id);
    }
  }
  cancel(id: string) {
    const task = this.get(id);
    if (task.status === "publishing")
      throw Error("Publishing is already in progress.");
    this.running.get(id)?.abort();
    return task;
  }
  async publish(id: string, review: string, includeBaseline: boolean) {
    const task = this.get(id);
    if (this.locks.has(id))
      throw Error("An operation is already running for this task.");
    if (task.status === "pushed") return task;
    if (task.status !== "ready" && !(task.status === "failed" && task.commit))
      throw Error("Only a checked, reviewed task can be published.");
    this.locks.add(id);
    try {
      await this.refresh(task);
      if (task.review !== review || task.review !== task.checkedReview)
        throw Error("The diff changed. Review it again before publishing.");
      if (task.baselineFiles.length && !includeBaseline)
        throw Error(
          "Confirm that the existing uncommitted changes are included in this branch.",
        );
      if (task.checks.length !== 3 || !task.checks.every((c) => c.ok))
        throw Error("All checks must pass before publishing.");
      const remote = await this.remote();
      if (!remote)
        throw Error("Configure a GitHub origin remote before publishing.");
      task.status = "publishing";
      task.error = undefined;
      this.save(task);
      if (!task.commit) {
        await git(this.checkout(id), [
          "commit",
          "-m",
          task.prompt.replace(/[\r\n]/g, " ").slice(0, 180),
        ]);
        task.commit = await git(this.checkout(id), ["rev-parse", "HEAD"]);
        this.save(task);
      } else if (
        (await git(this.checkout(id), ["rev-parse", "HEAD"])) !== task.commit
      )
        throw Error("The committed branch changed. Start a new reviewed task.");
      // An exact branch refspec, without force; never writes the current/default branch.
      await git(this.checkout(id), [
        "push",
        "--",
        remote,
        `${task.commit}:refs/heads/${task.branch}`,
      ]);
      const repo = githubRepository(remote);
      task.compareUrl = repo
        ? `https://github.com/${repo}/compare/${encodeURIComponent(task.baseBranch)}...${encodeURIComponent(task.branch)}?expand=1`
        : undefined;
      task.status = "pushed";
      this.event(
        task,
        "Committed and pushed the task branch. The running studio is unchanged.",
      );
      return task;
    } catch (error) {
      if (task.status === "publishing") {
        task.status = task.commit ? "failed" : "ready";
        task.error =
          "Publishing failed. Check your Git authentication and remote, then retry. Your checkout is preserved.";
        this.save(task);
        throw Error(task.error);
      }
      throw error;
    } finally {
      this.locks.delete(id);
    }
  }
  async pullRequest(id: string) {
    const task = this.get(id);
    if (task.status !== "pushed")
      throw Error("Push the reviewed branch first.");
    if (task.pullRequestUrl) return task;
    if (this.locks.has(id))
      throw Error("An operation is already running for this task.");
    this.locks.add(id);
    try {
      const repo = githubRepository(await this.remote());
      if (!repo) throw Error("A GitHub repository is required.");
      const existing = await exec(
        "gh",
        [
          "pr",
          "list",
          "--repo",
          repo,
          "--head",
          task.branch,
          "--state",
          "open",
          "--json",
          "url",
        ],
        { timeout: 30_000 },
      );
      const found = JSON.parse(existing.stdout) as { url: string }[];
      if (found[0]) task.pullRequestUrl = found[0].url;
      else {
        const body = path.join(this.options.tasksDir, id, "pull-request.md");
        fs.writeFileSync(
          body,
          `${task.summary}\n\nValidation: ${task.checks.map((c) => c.name + " passed").join(", ")}.\n${task.baselineFiles.length ? "\nIncludes the existing source changes explicitly reviewed in Scene Maker.\n" : ""}`,
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
      this.save(task);
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
  const requestSchema = z.object({
    prompt: z.string().trim().min(4).max(6000),
    attachments: attachmentIdsSchema,
  });
  router.post("/tasks", async (req, res) => {
    const { prompt, attachments } = requestSchema.parse(req.body);
    res.status(202).json(await service.start(prompt, attachments));
  });
  router.get("/tasks/:id", (req, res) =>
    res.json(service.get(String(req.params.id))),
  );
  router.post("/tasks/:id/stop", (req, res) =>
    res.json(service.cancel(String(req.params.id))),
  );
  router.post("/tasks/:id/retry", async (req, res) => {
    const { prompt, attachments } = requestSchema.parse(req.body);
    res
      .status(202)
      .json(await service.retry(String(req.params.id), prompt, attachments));
  });
  router.post("/tasks/:id/publish", async (req, res) => {
    const body = z
      .object({ review: z.string().length(64), includeBaseline: z.boolean() })
      .parse(req.body);
    res.json(
      await service.publish(
        String(req.params.id),
        body.review,
        body.includeBaseline,
      ),
    );
  });
  router.post("/tasks/:id/pull-request", async (req, res) =>
    res.json(await service.pullRequest(String(req.params.id))),
  );
  router.post("/tasks/:id/preview", async (req, res) => {
    const task = service.get(String(req.params.id));
    if (!["ready", "pushed"].includes(task.status))
      throw Error("The build must pass before opening a preview.");
    res.json({ url: await preview(task) });
  });
  return router;
}
export function createCodingService(
  config: () => Config,
  attachments?: AttachmentStore,
) {
  return new CodingService({
    root: repositoryRoot,
    tasksDir: path.join(dataDir, "coding"),
    config,
    attachments,
  });
}
