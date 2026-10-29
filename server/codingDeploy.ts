import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { git } from "./codeWorkspace";
import { runShell } from "./codingAgent";

/**
 * Bring a committed task branch into the running studio: fast-forward or merge
 * it into the studio checkout's current branch, rebuild the production bundle
 * and restart the service through start.sh. The caller saves task state before
 * the restart lands; the process exits a moment after this resolves.
 */
export async function deployBranch(
  root: string,
  checkout: string,
  branch: string,
  signal: AbortSignal,
) {
  if (await git(root, ["status", "--porcelain", "--untracked-files=no"], signal))
    throw Error(
      "The studio checkout has uncommitted changes. Commit or stash them before deploying.",
    );
  const commit = await git(checkout, ["rev-parse", "HEAD"], signal);
  await git(root, ["fetch", "--quiet", "--", checkout, `HEAD:refs/heads/${branch}`], signal);
  const current = (await git(root, ["branch", "--show-current"], signal)) || "HEAD";
  try {
    await git(root, ["merge", "--no-edit", "--", branch], signal);
  } catch (error) {
    await git(root, ["merge", "--abort"], signal).catch(() => {});
    throw Error(`Merging ${branch} into ${current} failed: ${(error as Error).message.slice(0, 400)}`);
  }
  const build = await runShell(root, "npm run build", signal, 0, path.join(root, "node_modules"));
  if (build.exitCode !== 0) throw Error(`Production build failed:\n${build.output.slice(-4000)}`);
  const script = path.join(root, "start.sh");
  if (!fs.existsSync(script)) throw Error("start.sh is missing; restart the studio by hand.");
  setTimeout(() => {
    const child = spawn("bash", [script, "--restart"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.on("error", () => {});
    child.unref();
  }, 1500).unref();
  return `Merged ${branch} (${commit.slice(0, 10)}) into ${current}, rebuilt, and scheduled a studio restart. The studio reloads in a few seconds.`;
}
