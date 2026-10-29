import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
export const MAX_FILE = 2_000_000;
/** Directories never listed or copied: build output, dependencies and git internals. */
const skipped = new Set([".git", "node_modules", "dist", ".data"]);
/**
 * Validate a workspace-relative path. Any file in the checkout may be read or
 * edited except git internals; traversal, absolute paths and control
 * characters are rejected.
 */
export function codePath(name: string) {
  const bits = name.split("/");
  if (
    !name ||
    /[\0\r\n]/.test(name) ||
    name.includes("\\") ||
    bits.some((b) => !b || b === "." || b === "..") ||
    path.isAbsolute(name)
  )
    throw Error("Use a relative path inside the checkout.");
  if (bits[0] === ".git")
    throw Error("Git internals cannot be edited directly. Use the git tools.");
  return name;
}
export function safeFile(root: string, name: string) {
  codePath(name);
  const parts = name.split("/");
  let target = root;
  for (const part of parts) {
    target = path.join(target, part);
    if (fs.lstatSync(target, { throwIfNoEntry: false })?.isSymbolicLink())
      throw Error("Symbolic links cannot be accessed.");
  }
  return target;
}
export function sourceFiles(root: string, under = ""): string[] {
  const result: string[] = [];
  function walk(dir: string, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!skipped.has(entry.name)) walk(path.join(dir, entry.name), name + "/");
      } else result.push(name);
    }
  }
  const start = under ? safeFile(root, under) : root;
  if (!fs.existsSync(start)) throw Error("Directory not found.");
  walk(start, under ? under.replace(/\/?$/, "/") : "");
  return result.sort();
}
export function readSource(root: string, name: string) {
  const target = safeFile(root, name);
  if (!fs.existsSync(target)) throw Error(`File not found: ${name}`);
  if (fs.statSync(target).size > MAX_FILE)
    throw Error("File is too large to read whole. Use runCommand with head, sed or grep.");
  const content = fs.readFileSync(target);
  if (content.includes(0))
    throw Error("Binary file. Use runCommand to inspect it.");
  return content.toString("utf8");
}
export function writeSource(root: string, name: string, content: string) {
  if (Buffer.byteLength(content) > MAX_FILE)
    throw Error("Content is too large for one write. Split it or use runCommand.");
  const target = safeFile(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, { mode: 0o600 });
}
export async function git(root: string, args: string[], signal?: AbortSignal) {
  const { stdout } = await exec(
    "git",
    ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args],
    {
      cwd: root,
      signal,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
      },
    },
  );
  return stdout.trimEnd();
}
/** Paths with uncommitted changes in a checkout, including untracked files git does not ignore. */
async function dirtyPaths(root: string) {
  const raw = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
  ]);
  const entries = raw.split("\0").filter(Boolean);
  return entries.map((entry) => ({
    deleted: entry[1] === "D" || entry[0] === "D",
    name: entry.slice(3),
  }));
}
export async function snapshot(
  source: string,
  target: string,
  branch: string,
  signal?: AbortSignal,
) {
  const base = await git(source, ["rev-parse", "HEAD"], signal);
  const baseBranch =
    (await git(source, ["branch", "--show-current"], signal)) || "main";
  await git(
    source,
    ["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", source, target],
    signal,
  );
  await git(target, ["checkout", "--quiet", "-b", branch, base], signal);
  await git(target, ["remote", "remove", "origin"], signal);
  await git(target, [
    "config",
    "user.name",
    (await git(source, ["config", "user.name"]).catch(() => "Scene Maker")) ||
      "Scene Maker",
  ]);
  await git(target, [
    "config",
    "user.email",
    (await git(source, ["config", "user.email"]).catch(
      () => "studio@localhost",
    )) || "studio@localhost",
  ]);
  // Carry every uncommitted change across so the agent works on what the studio runs.
  for (const { name, deleted } of await dirtyPaths(source)) {
    let from: string, to: string;
    try {
      from = safeFile(source, name);
      to = safeFile(target, name);
    } catch {
      continue;
    }
    if (deleted || !fs.existsSync(from)) fs.rmSync(to, { force: true });
    else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
    }
  }
  await stageSources(target);
  const baselineFiles = (await git(target, ["diff", "--cached", "--name-only"]))
    .split("\n")
    .filter(Boolean);
  if (baselineFiles.length)
    await git(target, [
      "commit",
      "-m",
      "Snapshot existing studio changes for coding task",
    ]);
  return {
    base,
    baseBranch,
    baseline: await git(target, ["rev-parse", "HEAD"]),
    baselineFiles,
  };
}
export async function stageSources(root: string) {
  await git(root, ["add", "-A", "--", "."]);
  return git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
}
export function reviewHash(diff: string) {
  return createHash("sha256").update(diff).digest("hex");
}
export function sandboxArgs(
  checkout: string,
  dependencies: string,
  command: string[],
) {
  return [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--ro-bind",
    "/usr",
    "/usr",
    "--symlink",
    "usr/bin",
    "/bin",
    "--symlink",
    "usr/lib",
    "/lib",
    "--symlink",
    "usr/lib64",
    "/lib64",
    "--ro-bind",
    "/etc/hosts",
    "/etc/hosts",
    "--ro-bind",
    "/etc/nsswitch.conf",
    "/etc/nsswitch.conf",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/tmp",
    "--bind",
    checkout,
    "/workspace",
    "--ro-bind",
    dependencies,
    "/workspace/node_modules",
    "--tmpfs",
    "/workspace/node_modules/.vite-temp",
    "--tmpfs",
    "/workspace/node_modules/.vite",
    "--tmpfs",
    "/workspace/node_modules/.vitest-cache",
    "--tmpfs",
    "/workspace/.git",
    "--clearenv",
    "--setenv",
    "PATH",
    "/usr/bin:/bin",
    "--setenv",
    "HOME",
    "/tmp",
    "--setenv",
    "SCENE_MAKER_DATA",
    "/tmp/studio-data",
    "--setenv",
    "SCENE_MAKER_SANDBOX",
    "1",
    "--setenv",
    "NODE_ENV",
    "test",
    "--chdir",
    "/workspace",
    "--",
    ...command,
  ];
}
export async function sandboxCheck(
  checkout: string,
  dependencies: string,
  command: string[],
  signal?: AbortSignal,
) {
  try {
    for (const cache of [".vite-temp", ".vite", ".vitest-cache"])
      fs.mkdirSync(path.join(dependencies, cache), { recursive: true });
    const { stdout, stderr } = await exec(
      "bwrap",
      sandboxArgs(checkout, dependencies, command),
      {
        signal,
        timeout: 15 * 60_000,
        maxBuffer: 8 * 1024 * 1024,
        killSignal: "SIGKILL",
      },
    );
    return { ok: true, output: (stdout + stderr).slice(-16_000) };
  } catch (e) {
    if (signal?.aborted) throw e;
    const error = e as Error & { stdout?: string; stderr?: string };
    return {
      ok: false,
      output: (
        (error.stdout || "") +
        (error.stderr || "") +
        "\n" +
        error.message
      ).slice(-16_000),
    };
  }
}
