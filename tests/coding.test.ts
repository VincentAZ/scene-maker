import type { Request, Response, NextFunction } from "express";
import { afterEach, beforeEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodingService, githubRepository } from "../server/coding";
import {
  codePath,
  git,
  readSource,
  safeFile,
  sandboxCheck,
  sourceFiles,
  writeSource,
} from "../server/codeWorkspace";
import type { Config } from "../server/ai";
import { codingBusy, type CodingTask } from "../shared/coding";
import { codingPreview } from "../server/codingPreview";
import type { AgentEvent } from "../server/codingAgent";
/** Flatten agent events into readable lines, the way the transcript shows them. */
function recorder() {
  const events: string[] = [];
  const progress: number[] = [];
  const raw: AgentEvent[] = [];
  const emit = (event: AgentEvent) => {
    raw.push(event);
    if (event.type === "text") events.push("Assistant: " + event.text);
    else if (event.type === "tool-start") events.push(event.title);
    else if (event.type === "status") events.push(event.text);
    else if (event.type === "progress") progress.push(event.step);
    else if (event.type === "steered") events.push("Steered: " + event.text);
  };
  return { events, progress, raw, emit };
}
let dir: string, root: string, remote: string;
const config: Config = {
  assistant: "openai",
  providers: { openai: { key: "fixture-key", model: "fixture" } },
  blender: "blender",
};
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-coding-"));
  root = path.join(dir, "source");
  remote = path.join(dir, "remote.git");
  fs.mkdirSync(root);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Test"]);
  await git(root, ["config", "user.email", "test@localhost"]);
  writeSource(root, "src/example.ts", "export const value = 1;\n");
  fs.writeFileSync(
    path.join(root, ".gitignore"),
    "node_modules/\ndist/\n.data/\n",
  );
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}');
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "Initial"]);
  await git(root, ["init", "--bare", remote]);
  fs.mkdirSync(path.join(root, "node_modules/typescript/bin"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, "node_modules/typescript/bin/tsc"), "");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function service(
  overrides: Partial<ConstructorParameters<typeof CodingService>[0]> = {},
) {
  return new CodingService({
    root,
    tasksDir: path.join(dir, ".tasks"),
    config: () => config,
    remote,
    probeSandbox: async () => {},
    generate: async (_config, checkout) => {
      writeSource(checkout, "src/example.ts", "export const value = 2;\n");
      return "Updated value.";
    },
    check: async () => ({ ok: true, output: "fixture check passed" }),
    ...overrides,
  });
}
async function settled(task: CodingTask) {
  for (let i = 0; i < 300 && codingBusy(task.status); i++)
    await new Promise((r) => setTimeout(r, 10));
  expect(codingBusy(task.status), task.error).toBe(false);
  return task;
}
it("rejects traversal and git internals but allows every other checkout file", () => {
  for (const p of [
    "../secrets.ts",
    "/tmp/x.ts",
    "src/../../x.ts",
    "src/x\ny.ts",
    ".git/config",
    "",
    "src//x.ts",
  ])
    expect(() => codePath(p), p).toThrow();
  for (const p of [
    "src/nested/example.tsx",
    "package.json",
    "package-lock.json",
    "src/.env.ts",
    "public/x.js",
    "scripts/tool.py",
  ])
    expect(codePath(p), p).toBe(p);
  expect(readSource(root, "package.json")).toContain("fixture");
  writeSource(root, "public/x.js", "ok");
  expect(sourceFiles(root)).toContain("public/x.js");
  expect(sourceFiles(root)).not.toContain(".git/HEAD");
  expect(sourceFiles(root).some((f) => f.startsWith("node_modules/"))).toBe(false);
});
it("rejects both live and dangling symlink escapes", () => {
  fs.symlinkSync(path.join(dir, "missing"), path.join(root, "src/link.ts"));
  expect(() => writeSource(root, "src/link.ts", "leak")).toThrow("Symbolic");
  fs.symlinkSync(dir, path.join(root, "src/outside"));
  expect(() => safeFile(root, "src/outside/example.ts")).toThrow("Symbolic");
  expect(sourceFiles(root)).not.toContain("src/link.ts");
});
it("isolates dirty source, requires review and pushes only a new branch to a bare remote", async () => {
  writeSource(root, "src/existing.ts", "export const existing = true;\n");
  const before = await git(root, ["status", "--porcelain"]);
  const s = service();
  const task = await settled(await s.start("Change the example value"));
  expect(task.status, task.error).toBe("ready");
  expect(task.baselineFiles).toEqual(["src/existing.ts"]);
  expect(task.diff).toContain("value = 2");
  expect(task.diff).not.toContain("existing = true");
  expect(task.publishDiff).toContain("existing = true");
  expect(await git(root, ["status", "--porcelain"])).toBe(before);
  expect(readSource(root, "src/example.ts")).toContain("value = 1");
  await expect(s.publish(task.id, "0".repeat(64), true)).rejects.toThrow(
    "diff changed",
  );
  await expect(s.publish(task.id, task.review, false)).rejects.toThrow(
    "existing uncommitted",
  );
  await s.publish(task.id, task.review, true);
  expect(task.status).toBe("pushed");
  expect(await git(remote, ["rev-parse", `refs/heads/${task.branch}`])).toBe(
    task.commit,
  );
  await expect(git(remote, ["rev-parse", "refs/heads/main"])).rejects.toThrow();
  expect(await git(root, ["status", "--porcelain"])).toBe(before);
  expect((await s.publish(task.id, task.review, true)).commit).toBe(
    task.commit,
  );
});
it("refuses stale validation even if a changed diff has been fetched", async () => {
  const s = service();
  const task = await settled(await s.start("Change the example value"));
  const validated = task.review;
  writeSource(
    s.checkout(task.id),
    "src/example.ts",
    "export const value = 99;\n",
  );
  await expect(s.publish(task.id, validated, true)).rejects.toThrow(
    "diff changed",
  );
  expect(task.review).not.toBe(validated);
  await expect(s.publish(task.id, task.review, true)).rejects.toThrow(
    "diff changed",
  );
});
it("failed checks block publishing and refinement receives failure details", async () => {
  let fail = true,
    received = "";
  const s = service({
    check: async () => ({ ok: !fail, output: "important compiler detail" }),
    generate: async (_config, checkout, prompt) => {
      received = prompt;
      writeSource(checkout, "src/example.ts", "export const value = 2;\n");
      return "Changed";
    },
  });
  const task = await settled(await s.start("Change the example value"));
  expect(task.status).toBe("failed");
  await expect(s.publish(task.id, task.review, true)).rejects.toThrow(
    "checked",
  );
  fail = false;
  await settled(await s.retry(task.id, "Fix the failed checks"));
  expect(received).toContain("important compiler detail");
  expect(task.status, task.error).toBe("ready");
});
it("stops a running generation and retains partial work", async () => {
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const s = service({
    generate: async (_config, checkout, _prompt, signal) => {
      writeSource(checkout, "src/example.ts", "export const value = 3;\n");
      entered();
      await new Promise((_r, reject) =>
        signal.addEventListener("abort", () => reject(Error("stopped")), {
          once: true,
        }),
      );
      return "";
    },
  });
  const task = await s.start("Change with cancellation");
  await started;
  s.cancel(task.id);
  await settled(task);
  expect(task.status).toBe("cancelled");
  expect(task.diff).toContain("value = 3");
});
it("runs tasks in parallel in separate checkouts and recovers after a restart", async () => {
  const s = service();
  const [first, second] = await Promise.all([
    s.start("First change please"),
    s.start("Second change please"),
  ]);
  expect(first.id).not.toBe(second.id);
  expect(s.checkout(first.id)).not.toBe(s.checkout(second.id));
  await settled(first);
  await settled(second);
  expect([first.status, second.status]).toEqual(["ready", "ready"]);
  first.status = "working";
  fs.writeFileSync(path.join(dir, ".tasks", first.id, "task.json"), JSON.stringify(first));
  const restored = service().get(first.id);
  expect(restored.status).toBe("failed");
  expect(restored.error).toContain("send a message to continue");
});
it.skipIf(process.env.SCENE_MAKER_SANDBOX === "1")(
  "runs checks in a real network-disabled sandbox without host secrets",
  async () => {
    const secret = path.join(dir, "private.txt");
    fs.writeFileSync(secret, "private");
    const result = await sandboxCheck(root, path.join(root, "node_modules"), [
      "node",
      "-e",
      `const fs=require('fs'); if(fs.existsSync(${JSON.stringify(secret)}))process.exit(4); if(process.env.TEST_SECRET)process.exit(5); console.log('isolated');`,
    ]);
    expect(result.ok, result.output).toBe(true);
    expect(result.output).toContain("isolated");
  },
);
it("serves previews on a separate origin with temporary data and blocks symlink escape", async () => {
  const s = service();
  const task = await settled(await s.start("Change the example value"));
  const dist = path.join(s.checkout(task.id), "dist");
  fs.mkdirSync(dist);
  fs.writeFileSync(path.join(dist, "index.html"), "<h1>Preview fixture</h1>");
  fs.symlinkSync(
    path.join(root, "package.json"),
    path.join(dist, "escape.json"),
  );
  const preview = codingPreview(s);
  try {
    const url = await preview.open(task),
      origin = new URL(url).origin;
    const page = await fetch(url);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Preview fixture");
    expect(page.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect((await fetch(url + "escape.json")).status).toBe(403);
    const projects = await (
      await fetch(origin + "/api/projects", { headers: { referer: url } })
    ).json();
    expect(projects[0].name).toContain("temporary");
    expect(
      (await fetch(origin + "/api/coding", { headers: { referer: url } }))
        .status,
    ).toBe(403);
    expect(
      (
        await fetch(origin + "/api/connections", {
          headers: { referer: url, origin: "http://127.0.0.1:4311" },
        })
      ).status,
    ).toBe(403);
  } finally {
    preview.close();
  }
});
it("parses GitHub remotes without accepting embedded credentials", () => {
  expect(githubRepository("git@github.com:owner/repo.git")).toBe("owner/repo");
  expect(githubRepository("https://github.com/owner/repo.git")).toBe(
    "owner/repo",
  );
  expect(
    githubRepository("https://token@github.com/owner/repo.git"),
  ).toBeUndefined();
});

it("executes the real AI SDK tool loop, blocks traversal, and edits source", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const call = (name: string, input: object, id: string) => ({
    content: [
      {
        type: "tool-call" as const,
        toolCallId: id,
        toolName: name,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls" as const, raw: undefined },
    usage,
    warnings: [],
  });
  const model = new MockLanguageModelV4({
    doGenerate: [
      call("readFile", { path: "../private.ts" }, "escape"),
      call("readFile", { path: "src/example.ts" }, "read"),
      call(
        "editFile",
        { path: "src/example.ts", oldText: "value = 1", newText: "value = 4" },
        "edit",
      ),
      {
        content: [{ type: "text", text: "Updated the example." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    ],
  });
  const rec = recorder();
  const result = await runCodingAgent(
    config,
    root,
    "Update example",
    new AbortController().signal,
    rec.emit,
    () => model,
  );
  expect(result).toBe("Updated the example.");
  expect(readSource(root, "src/example.ts")).toContain("value = 4");
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
    "relative path inside the checkout",
  );
  expect(rec.events).toContain("Edit src/example.ts");
  expect(rec.events).toContain("Read ../private.ts");
  // The blocked read is reported as a failed tool call, in order.
  const escape = rec.raw.find((e) => e.type === "tool-end" && e.id === "0:escape");
  expect(escape).toMatchObject({ ok: false });
});

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
const toolCall = (name: string, input: object, id: string, text = "") => ({
  content: [
    ...(text ? [{ type: "text" as const, text }] : []),
    {
      type: "tool-call" as const,
      toolCallId: id,
      toolName: name,
      input: JSON.stringify(input),
    },
  ],
  finishReason: { unified: "tool-calls" as const, raw: undefined },
  usage,
  warnings: [],
});
const finalText = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: undefined },
  usage,
  warnings: [],
});

it("narrates steps, reports progress, runs commands, commits and pushes on its own", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  const model = new MockLanguageModelV4({
    doGenerate: [
      toolCall("runCommand", { command: "echo hello-from-shell && git status --short" }, "run", "Checking the workspace first."),
      toolCall("editFile", { path: "src/example.ts", oldText: "value = 1", newText: "value = 5" }, "edit", "Applying the change."),
      toolCall("gitCommit", { message: "Set value to 5" }, "commit", "Committing the verified change."),
      toolCall("gitPush", {}, "push"),
      finalText("Done: value is 5, committed and pushed."),
    ],
  });
  const { events, progress, emit } = recorder();
  const pushes: string[] = [];
  const result = await runCodingAgent(
    config,
    root,
    "Set value to 5, commit and push",
    new AbortController().signal,
    emit,
    () => model,
    { remote, branch: "studio/test-branch", onPush: (c) => pushes.push(c) },
  );
  expect(result).toContain("committed and pushed");
  expect(events).toContain("Assistant: Checking the workspace first.");
  // Narration arrives before the tool call it introduces.
  expect(events.indexOf("Assistant: Checking the workspace first.")).toBeLessThan(
    events.findIndex((e) => e.startsWith("$ echo hello-from-shell")),
  );
  expect(events).toContain("Commit: Set value to 5");
  expect(events).toContain("Push branch to GitHub");
  expect(progress).toEqual([1, 2, 3, 4, 5]);
  const run = JSON.stringify(model.doGenerateCalls[1].prompt);
  expect(run).toContain("hello-from-shell");
  expect(run).toContain('"exitCode":0');
  expect(pushes).toHaveLength(1);
  expect(await git(remote, ["rev-parse", "refs/heads/studio/test-branch"])).toBe(pushes[0]);
  expect(await git(root, ["log", "-1", "--format=%s"])).toBe("Set value to 5");
});

it("survives a lost provider connection and resumes from the last completed step", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { APICallError } = await import("ai");
  const { runCodingAgent, transientProviderError } = await import("../server/codingAgent");
  expect(transientProviderError(Error("getaddrinfo EAI_AGAIN api.anthropic.com"))).toBe("network connection lost");
  expect(transientProviderError({ name: "AI_RetryError", message: "Failed after 3 attempts", lastError: { name: "AI_APICallError", message: "Cannot connect to API: getaddrinfo EAI_AGAIN api.anthropic.com" } })).toBe("network connection lost");
  expect(transientProviderError({ name: "AI_APICallError", statusCode: 401, message: "Unauthorized" })).toBeUndefined();
  expect(transientProviderError({ name: "AbortError", message: "aborted" })).toBeUndefined();
  const responses = [
    toolCall("editFile", { path: "src/example.ts", oldText: "value = 1", newText: "value = 8" }, "edit", "Editing."),
    toolCall("readFile", { path: "src/example.ts" }, "read", "Checking the result."),
    finalText("Resumed and finished."),
  ];
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      // In-SDK retries are disabled here so the resume loop is what recovers.
      if (calls === 2)
        throw new APICallError({
          message: "Cannot connect to API: getaddrinfo EAI_AGAIN api.anthropic.com",
          url: "https://api.anthropic.com/v1/messages",
          requestBodyValues: {},
          isRetryable: true,
        });
      return responses[calls === 1 ? 0 : calls === 3 ? 1 : 2];
    },
  });
  const { events, emit } = recorder();
  const result = await runCodingAgent(
    config,
    root,
    "Set value to 8",
    new AbortController().signal,
    emit,
    () => model,
    { retryDelayMs: 10, maxRetries: 0 },
  );
  expect(result).toBe("Resumed and finished.");
  expect(events.some((e) => e.startsWith("Provider unreachable (network connection lost). Work through step 1 is kept"))).toBe(true);
  expect(events).toContain("Reconnecting to the provider…");
  expect(readSource(root, "src/example.ts")).toContain("value = 8");
  // The resumed call carries the first step exactly once and no edit was repeated.
  const resumed = JSON.stringify(model.doGenerateCalls[2].prompt);
  expect(resumed.split("\"toolCallId\":\"edit\"").length - 1).toBe(2);
  expect(events.filter((e) => e === "Edit src/example.ts")).toHaveLength(1);
  expect(model.doGenerateCalls).toHaveLength(4);
});

it("has no step limit unless one is configured", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  const many = Array.from({ length: 40 }, (_, i) =>
    toolCall("readFile", { path: "src/example.ts" }, `read-${i}`),
  );
  const model = new MockLanguageModelV4({ doGenerate: [...many, finalText("Read it forty times.")] });
  const signal = new AbortController().signal;
  expect(await runCodingAgent(config, root, "Read a lot", signal, () => {}, () => model)).toBe(
    "Read it forty times.",
  );
  const limited = new MockLanguageModelV4({ doGenerate: [...many, finalText("never")] });
  await expect(
    runCodingAgent(config, root, "Read a lot", signal, () => {}, () => limited, { maxSteps: 3 }),
  ).rejects.toThrow("limit of 3 steps");
});

it("connects configured MCP servers and exposes their tools to the engineer", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  const model = new MockLanguageModelV4({
    doGenerate: [
      toolCall("fixture__echo", { text: "ping" }, "mcp"),
      finalText("The server answered."),
    ],
  });
  const { events, emit } = recorder();
  const result = await runCodingAgent(
    config,
    root,
    "Use the fixture server",
    new AbortController().signal,
    emit,
    () => model,
    {
      mcpServers: {
        fixture: {
          transport: "stdio",
          command: process.execPath,
          args: [path.resolve("tests/fixtures/mcp-server.mjs")],
        },
      },
    },
  );
  expect(result).toBe("The server answered.");
  expect(events).toContain("Connected MCP server fixture (1 tools)");
  expect(events).toContain("fixture › echo");
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("echo: ping");
});

it("marks agent-pushed and agent-deployed tasks without re-running sandbox checks", async () => {
  let checks = 0;
  const deployed: string[] = [];
  const s = service({
    check: async () => {
      checks++;
      return { ok: true, output: "" };
    },
    deploy: async (_root, _checkout, branch) => {
      deployed.push(branch);
      return "deployed " + branch;
    },
    generate: async (_config, checkout, _prompt, _signal, _emit, _model, options) => {
      writeSource(checkout, "src/example.ts", "export const value = 7;\n");
      await git(checkout, ["add", "-A"]);
      await git(checkout, ["commit", "-m", "Set 7"]);
      const commit = await git(checkout, ["rev-parse", "HEAD"]);
      options?.onCommit?.(commit);
      await git(checkout, ["push", "--", options!.remote!, `${commit}:refs/heads/${options!.branch}`]);
      options?.onPush?.(commit);
      await options?.deploy?.();
      return "Pushed and deployed.";
    },
  });
  const task = await settled(await s.start("Set value to 7, push and deploy"));
  expect(task.status, task.error).toBe("pushed");
  expect(task.pushed).toBe(true);
  expect(task.deployed).toBe(true);
  expect(task.commit).toBeTruthy();
  expect(checks).toBe(0);
  expect(deployed).toEqual([task.branch]);
  expect(await git(remote, ["rev-parse", `refs/heads/${task.branch}`])).toBe(task.commit);
  expect(task.diff).toContain("value = 7");
  // A restart during a deployed task reports success rather than failure.
  task.status = "working";
  fs.writeFileSync(path.join(dir, ".tasks", task.id, "task.json"), JSON.stringify(task));
  expect(service().get(task.id).status).toBe("pushed");
});

it("merges a committed task branch into the studio checkout for self-deploy", async () => {
  const { deployBranch } = await import("../server/codingDeploy");
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture","scripts":{"build":"echo built"}}');
  fs.writeFileSync(path.join(root, "start.sh"), "#!/bin/sh\nexit 0\n");
  await git(root, ["add", "-A"]);
  await git(root, ["commit", "-m", "Add build"]);
  const s = service();
  const task = await settled(await s.start("Change the example value"));
  await git(s.checkout(task.id), ["commit", "-m", "Set 2"]);
  const result = await deployBranch(root, s.checkout(task.id), task.branch, new AbortController().signal);
  expect(result).toContain("rebuilt");
  expect(readSource(root, "src/example.ts")).toContain("value = 2");
  expect(await git(root, ["branch", "--show-current"])).toBe("main");
  writeSource(root, "src/example.ts", "dirty");
  await expect(
    deployBranch(root, s.checkout(task.id), task.branch, new AbortController().signal),
  ).rejects.toThrow("uncommitted");
});

it("round-trips a coding task through the HTTP API and publishes the reviewed diff", async () => {
  const { default: express } = await import("express");
  const { codingRouter } = await import("../server/coding");
  const s = service();
  const app = express();
  app.use(express.json());
  app.use(
    "/api/coding",
    codingRouter(s, async () => "http://127.0.0.1:1234/preview/fixture/"),
  );
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(400).json({ error: error.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/coding`;
  const post = (url: string, body: object) =>
    fetch(base + url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const invalid = await post("/tasks", { prompt: "" });
    expect(invalid.status).toBe(400);
    const response = await post("/tasks", {
      prompt: "Change the example value",
    });
    expect(response.status).toBe(202);
    const created = await response.json();
    await settled(s.get(created.id));
    const fetched = await (await fetch(base + "/tasks/" + created.id)).json();
    expect(fetched.status).toBe("ready");
    expect((await fetch(base)).headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await (await fetch(base)).json())).not.toContain(
      "fixture-key",
    );
    const preview = await post(`/tasks/${created.id}/preview`, {});
    expect((await preview.json()).url).toContain("/preview/");
    const published = await post(`/tasks/${created.id}/publish`, {
      review: fetched.review,
      includeBaseline: true,
    });
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe("pushed");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("continues one conversation across turns, including after a push", async () => {
  const seen: { prompt: string; history: unknown[] }[] = [];
  const s = service({
    generate: async (_config, checkout, prompt, _signal, emit, _model, options) => {
      seen.push({ prompt, history: options?.history || [] });
      if (seen.length === 1) {
        writeSource(checkout, "src/example.ts", "export const value = 6;\n");
        await git(checkout, ["add", "-A"]);
        await git(checkout, ["commit", "-m", "Set 6"]);
        const commit = await git(checkout, ["rev-parse", "HEAD"]);
        options?.onCommit?.(commit);
        await git(checkout, ["push", "--", options!.remote!, `${commit}:refs/heads/${options!.branch}`]);
        options?.onPush?.(commit);
      }
      const reply = seen.length === 1 ? "Set it to 6 and pushed." : "I changed value from 1 to 6.";
      emit({ type: "text", text: reply, depth: 0 });
      options?.onHistory?.([
        ...(options.history || []),
        { role: "user", content: prompt },
        { role: "assistant", content: reply },
      ]);
      return reply;
    },
  });
  const task = await settled(await s.start("Set value to 6, commit and push"));
  expect(task.status, task.error).toBe("pushed");
  await settled(await s.reply(task.id, "What did you change?"));
  expect(task.status, task.error).toBe("pushed");
  expect(seen[1].prompt).toBe("What did you change?");
  expect(JSON.stringify(seen[1].history)).toContain("Set value to 6, commit and push");
  expect(JSON.stringify(seen[1].history)).toContain("Set it to 6 and pushed.");
  const conversation = task.transcript!.filter((e) => e.kind === "user" || e.kind === "assistant");
  expect(conversation.map((e) => ("text" in e ? e.text : ""))).toEqual([
    "Set value to 6, commit and push",
    "Set it to 6 and pushed.",
    "What did you change?",
    "I changed value from 1 to 6.",
  ]);
  // A question that changes nothing on a task without a branch ends as done, not failed.
  const plain = service({
    generate: async () => "It reads src/example.ts.",
  });
  const asked = await settled(await plain.start("Which file holds the value?"));
  expect(asked.status, asked.error).toBe("idle");
});

it("delivers a message to the running engineer at its next step", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  let steer: ((text: string) => Promise<boolean>) | undefined;
  let delivered: Promise<boolean> | undefined;
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      if (calls === 1) {
        delivered = steer!("Also keep the file name.");
        return toolCall("readFile", { path: "src/example.ts" }, "read", "Reading first.");
      }
      return finalText("Done, and kept the file name.");
    },
  });
  const { events, emit } = recorder();
  let saved: unknown[] = [];
  const result = await runCodingAgent(config, root, "Look at the example", new AbortController().signal, emit, () => model, {
    onSteer: (fn) => {
      if (fn) steer = fn;
    },
    onHistory: (messages) => {
      saved = [...messages];
    },
  });
  expect(result).toBe("Done, and kept the file name.");
  expect(await delivered).toBe(true);
  expect(events).toContain("Steered: Also keep the file name.");
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain("Also keep the file name.");
  expect(JSON.stringify(saved)).toContain("Also keep the file name.");
  // After the run, a late message is reported as not delivered.
  expect(await steer!("too late")).toBe(false);
});

it("queues messages sent while checks run and continues with them afterwards", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const prompts: string[] = [];
  const s = service({
    check: async () => {
      await gate;
      return { ok: true, output: "" };
    },
    generate: async (_config, checkout, prompt) => {
      prompts.push(prompt);
      writeSource(checkout, "src/example.ts", `export const value = ${prompts.length + 1};\n`);
      return "Changed.";
    },
  });
  const task = await s.start("Change the example value");
  for (let i = 0; i < 300 && task.status !== "checking"; i++) await new Promise((r) => setTimeout(r, 10));
  expect(task.status).toBe("checking");
  await s.reply(task.id, "Then make it 3");
  const queued = task.transcript!.find((e) => e.kind === "user" && e.text === "Then make it 3");
  expect(queued).toMatchObject({ queued: true });
  release();
  for (let i = 0; i < 500 && prompts.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
  await settled(task);
  expect(prompts).toEqual(["Change the example value", "Then make it 3"]);
  expect(queued).not.toHaveProperty("queued", true);
  expect(task.status, task.error).toBe("ready");
});

it("deletes single tasks, refuses running ones, and clears finished tasks", async () => {
  let stop!: () => void;
  const s = service();
  const a = await settled(await s.start("First change please"));
  const b = await settled(await s.start("Second change please"));
  const blocking = service({
    generate: (_config, _checkout, _prompt, signal) =>
      new Promise((_r, reject) => {
        stop = () => reject(Error("stopped"));
        signal.addEventListener("abort", () => reject(Error("stopped")), { once: true });
      }),
  });
  const running = await blocking.start("Keep working");
  for (let i = 0; i < 300 && running.status !== "working"; i++) await new Promise((r) => setTimeout(r, 10));
  expect(() => blocking.delete(running.id)).toThrow("Stop the task");
  expect(blocking.clear()).toEqual({ removed: 2 });
  expect(blocking.get(running.id).status).toBe("working");
  expect(() => blocking.get(a.id)).toThrow("not found");
  expect(fs.existsSync(path.join(dir, ".tasks", b.id))).toBe(false);
  blocking.cancel(running.id);
  await settled(running);
  stop();
  expect(blocking.delete(running.id)).toEqual({ deleted: running.id });
  expect(fs.readdirSync(path.join(dir, ".tasks"))).toEqual([]);
});

it("lists task summaries without transcripts or diffs", async () => {
  const s = service();
  const task = await settled(await s.start("Change the example value"));
  const [listed] = (await s.info()).tasks;
  expect(listed.id).toBe(task.id);
  expect(listed.fileCount).toBe(1);
  expect(listed.searchText).toContain("src/example.ts");
  expect(listed).not.toHaveProperty("transcript");
  expect(listed).not.toHaveProperty("diff");
});

it("trims old tool output once a conversation gets large", async () => {
  const { trimContext } = await import("../server/codingAgent");
  const big = "x".repeat(50_000);
  const messages = Array.from({ length: 20 }, (_, i) => [
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: "readFile", input: {} }],
    },
    {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: `c${i}`,
          toolName: "readFile",
          output: { type: "text" as const, value: big },
        },
      ],
    },
  ]).flat();
  const trimmed = trimContext([{ role: "user", content: "start" }, ...messages]);
  const outputs = trimmed
    .filter((m) => m.role === "tool")
    .map((m) => JSON.stringify(m.content));
  expect(outputs.filter((o) => o.includes("trimmed to save context"))).toHaveLength(8);
  expect(outputs.slice(-12).every((o) => o.includes(big))).toBe(true);
  const small = [{ role: "user" as const, content: "hi" }];
  expect(trimContext(small)).toBe(small);
});

it("trims in batches down to the target so the trimmed prefix stays stable", async () => {
  const { trimContext } = await import("../server/codingAgent");
  const big = "y".repeat(50_000);
  const pair = (i: number) => [
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: `c${i}`, toolName: "readFile", input: {} }],
    },
    {
      role: "tool" as const,
      content: [
        { type: "tool-result" as const, toolCallId: `c${i}`, toolName: "readFile", output: { type: "text" as const, value: big } },
      ],
    },
  ];
  const messages = [{ role: "user" as const, content: "start" }, ...Array.from({ length: 10 }, (_, i) => pair(i)).flat()];
  const size = (m: unknown) => JSON.stringify(m).length;
  const trimmed = trimContext(messages, 400_000, 2);
  const total = trimmed.reduce((n, m) => n + size(m), 0);
  expect(total).toBeLessThanOrEqual(300_000);
  const flags = trimmed.filter((m) => m.role === "tool").map((m) => JSON.stringify(m).includes("trimmed to save context"));
  // Oldest results are trimmed first, as one contiguous prefix, and no more than needed.
  expect(flags).toEqual([true, true, true, true, true, false, false, false, false, false]);
  // Already under the limit: the same array comes back, so nothing moves between steps.
  expect(trimContext(trimmed, 400_000, 2)).toBe(trimmed);
  // Below the target floor only the newest `keepRecent` are protected.
  const hard = trimContext(messages, 0, 4, 0);
  expect(hard.filter((m) => m.role === "tool").map((m) => JSON.stringify(m).includes("trimmed"))).toEqual([
    true, true, true, true, true, true, false, false, false, false,
  ]);
});

it("marks the last message as an Anthropic cache breakpoint and persists trimming into the history", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { runCodingAgent } = await import("../server/codingAgent");
  const anthropic: Config = {
    assistant: "anthropic",
    providers: { anthropic: { key: "fixture-key", model: "claude-fixture" } },
    blender: "blender",
  };
  const big = "z".repeat(20_000);
  const earlier = Array.from({ length: 24 }, (_, i) => [
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: `old${i}`, toolName: "readFile", input: { path: "a" } }],
    },
    {
      role: "tool" as const,
      content: [
        { type: "tool-result" as const, toolCallId: `old${i}`, toolName: "readFile", output: { type: "text" as const, value: big } },
      ],
    },
  ]).flat();
  const model = new MockLanguageModelV4({
    doGenerate: [toolCall("readFile", { path: "src/example.ts" }, "r1"), finalText("Done reading.")],
  });
  const saved: unknown[][] = [];
  const result = await runCodingAgent(
    anthropic,
    root,
    "Continue",
    new AbortController().signal,
    () => {},
    () => model,
    { history: [{ role: "user", content: "earlier" }, ...earlier], onHistory: (m) => saved.push([...m]) },
  );
  expect(result).toBe("Done reading.");
  for (const call of model.doGenerateCalls) {
    const marked = call.prompt.filter((m) => JSON.stringify(m.providerOptions ?? {}).includes("ephemeral"));
    expect(marked).toHaveLength(1);
    expect(marked[0]).toBe(call.prompt[call.prompt.length - 1]);
  }
  // 24 × 20k is over the limit: the oldest results were trimmed until under the target,
  // the trimmed conversation was written back (and saved), and the cache marker was not.
  const sent = JSON.stringify(model.doGenerateCalls[0].prompt);
  expect(sent).toContain("trimmed to save context");
  const persisted = JSON.stringify(saved[saved.length - 1]);
  expect(persisted).toContain("trimmed to save context");
  expect(persisted).not.toContain("ephemeral");
  expect(persisted.length).toBeLessThan(sent.length + 1_000);
  // The second step sent the already-trimmed history unchanged apart from the new turn.
  expect(JSON.stringify(model.doGenerateCalls[1].prompt).match(/trimmed to save context/g)?.length).toBe(
    sent.match(/trimmed to save context/g)?.length,
  );
  // Other providers get no Anthropic marker.
  const plain = new MockLanguageModelV4({ doGenerate: [finalText("ok")] });
  await runCodingAgent(config, root, "Hi", new AbortController().signal, () => {}, () => plain);
  expect(JSON.stringify(plain.doGenerateCalls[0].prompt)).not.toContain("ephemeral");
});

it("trims hard and retries once when the provider reports a context overflow", async () => {
  const { MockLanguageModelV4 } = await import("ai/test");
  const { APICallError } = await import("@ai-sdk/provider");
  const { runCodingAgent } = await import("../server/codingAgent");
  const big = "w".repeat(20_000);
  const earlier = Array.from({ length: 6 }, (_, i) => [
    {
      role: "assistant" as const,
      content: [{ type: "tool-call" as const, toolCallId: `old${i}`, toolName: "readFile", input: { path: "a" } }],
    },
    {
      role: "tool" as const,
      content: [
        { type: "tool-result" as const, toolCallId: `old${i}`, toolName: "readFile", output: { type: "text" as const, value: big } },
      ],
    },
  ]).flat();
  const overflow = () =>
    new APICallError({
      message: "prompt is too long: 250000 tokens > 200000 maximum",
      url: "https://example.invalid",
      requestBodyValues: {},
      statusCode: 400,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "invalid_request_error", message: "prompt is too long: 250000 tokens > 200000 maximum" },
      }),
    });
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      calls += 1;
      if (calls === 1) throw overflow();
      return finalText("Fits now.");
    },
  });
  const rec = recorder();
  const result = await runCodingAgent(config, root, "Continue", new AbortController().signal, rec.emit, () => model, {
    history: [{ role: "user", content: "earlier" }, ...earlier],
  });
  expect(result).toBe("Fits now.");
  expect(rec.events.some((e) => e.includes("no longer fits") && e.includes("retrying"))).toBe(true);
  // Below the normal limit, so the first attempt sent everything; the retry kept only the newest 4 results.
  expect(JSON.stringify(model.doGenerateCalls[0].prompt)).not.toContain("trimmed to save context");
  const retried = model.doGenerateCalls[1].prompt.filter((m) => m.role === "tool");
  expect(retried.map((m) => JSON.stringify(m).includes("trimmed to save context"))).toEqual([
    true, true, false, false, false, false,
  ]);
  // A second overflow is not retried again; it surfaces with the provider's explanation.
  const always = new MockLanguageModelV4({ doGenerate: async () => { throw overflow(); } });
  await expect(
    runCodingAgent(config, root, "Continue", new AbortController().signal, () => {}, () => always),
  ).rejects.toThrow("prompt is too long");
  expect(always.doGenerateCalls).toHaveLength(2);
});
