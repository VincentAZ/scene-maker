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
it("rejects traversal, hidden files, credentials and dependency edits", () => {
  for (const p of [
    "../secrets.ts",
    "/tmp/x.ts",
    "src/../../x.ts",
    "src/.env.ts",
    "src/x\ny.ts",
    "src/secret.json",
    "server/connections.json",
    "package.json",
    "package-lock.json",
    ".git/config",
    "node_modules/x.ts",
    "public/x.js",
  ])
    expect(() => codePath(p), p).toThrow();
  expect(codePath("src/nested/example.tsx")).toBe("src/nested/example.tsx");
  expect(readSource(root, "package.json")).toContain("fixture");
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
it("serializes simultaneous starts and handles restart recovery", async () => {
  const s = service();
  const result = await Promise.allSettled([
    s.start("First change please"),
    s.start("Second change please"),
  ]);
  expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const task = (
    result.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<CodingTask>
  ).value;
  await settled(task);
  task.status = "working";
  fs.writeFileSync(
    path.join(dir, ".tasks", task.id, "task.json"),
    JSON.stringify(task),
  );
  const restored = service().get(task.id);
  expect(restored.status).toBe("failed");
  expect(restored.error).toContain("restarted");
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
  const events: string[] = [];
  const result = await runCodingAgent(
    config,
    root,
    "Update example",
    new AbortController().signal,
    (text) => events.push(text),
    () => model,
  );
  expect(result).toBe("Updated the example.");
  expect(readSource(root, "src/example.ts")).toContain("value = 4");
  expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
    "relative source-file path",
  );
  expect(events).toContain("Updated src/example.ts");
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
