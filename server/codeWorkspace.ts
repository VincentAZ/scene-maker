import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec = promisify(execFile);
export const MAX_FILE = 200_000;
const roots = new Set(["src", "shared", "server", "tests", "docs"]);
const rootFiles = new Set([
  "README.md",
  "AGENTS.md",
  "index.html",
  "vite.config.ts",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
]);
export function codePath(name: string) {
  const bits = name.split("/");
  if (
    !/^[a-zA-Z0-9_./@()[\] -]+$/.test(name) ||
    name.includes("\\") ||
    bits.some((b) => !b || b === "." || b === ".." || b.startsWith(".")) ||
    path.isAbsolute(name)
  )
    throw Error("Use a relative source-file path.");
  if (
    !rootFiles.has(name) &&
    !(roots.has(bits[0]) && /\.(tsx?|jsx?|css|json|md|html)$/.test(name))
  )
    throw Error(
      "Only application source, tests and documentation can be edited. Dependencies, credentials and repository configuration are excluded.",
    );
  if (/(^|\/)(credentials?|secrets?|connections)\.json$/i.test(name))
    throw Error("Credential files cannot be accessed.");
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
export function sourceFiles(root: string): string[] {
  const result: string[] = [];
  function walk(dir: string, prefix = "") {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          (!prefix && roots.has(name)) ||
          (prefix &&
            !entry.name.startsWith(".") &&
            entry.name !== "node_modules")
        )
          walk(path.join(dir, entry.name), name + "/");
      } else {
        try {
          codePath(name);
          result.push(name);
        } catch {
          /* excluded */
        }
      }
    }
  }
  walk(root);
  return result.sort();
}
export function readSource(root: string, name: string) {
  // Dependencies are visible as metadata only, never editable.
  const target =
    name === "package.json" ? path.join(root, name) : safeFile(root, name);
  if (fs.lstatSync(target).isSymbolicLink())
    throw Error("Symbolic links cannot be accessed.");
  if (fs.statSync(target).size > MAX_FILE)
    throw Error("File is too large. Use focused source files.");
  return fs.readFileSync(target, "utf8");
}
export function writeSource(root: string, name: string, content: string) {
  if (Buffer.byteLength(content) > MAX_FILE || content.includes("\0"))
    throw Error("Source file is too large or contains binary data.");
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
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -oBatchMode=yes",
      },
    },
  );
  return stdout.trimEnd();
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
    [
      "clone",
      "--quiet",
      "--no-hardlinks",
      "--no-checkout",
      "--",
      source,
      target,
    ],
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
  const files = sourceFiles(source);
  for (const name of sourceFiles(target))
    if (!files.includes(name)) fs.unlinkSync(safeFile(target, name));
  for (const name of files) writeSource(target, name, readSource(source, name));
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
  const changed = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  // Disable rename detection: every path is independently checked before staging.
  const files = [
    ...new Set(
      (await git(root, ["diff", "--name-only", "--no-renames", "HEAD"]))
        .split("\n")
        .filter(Boolean)
        .concat(sourceFiles(root)),
    ),
  ];
  for (const name of files) {
    try {
      codePath(name);
    } catch {
      continue;
    }
    await git(root, ["add", "-A", "--", name]);
  }
  return changed;
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
        timeout: 120_000,
        maxBuffer: 2 * 1024 * 1024,
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
