import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Version and update information for a source checkout. Updates are checked
// against the checkout's own git remote; nothing is downloaded or applied here.
const run = promisify(execFile);
const root = process.cwd();
const started = new Date().toISOString();
export const packageVersion: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))
      .version;
  } catch {
    return "0.0.0";
  }
})();
const git = async (...args: string[]) =>
  (
    await run("git", args, {
      cwd: root,
      timeout: 30000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    })
  ).stdout.trim();

export type VersionInfo = {
  version: string;
  started: string;
  git: boolean;
  commit?: string;
  branch?: string;
  date?: string;
  subject?: string;
  dirty?: boolean;
  /** The checkout is newer than the running service: restart to use it. */
  restartNeeded?: boolean;
};
export async function versionInfo(): Promise<VersionInfo> {
  try {
    const [commit, branch, date, subject, status] = await Promise.all([
      git("rev-parse", "--short", "HEAD"),
      git("rev-parse", "--abbrev-ref", "HEAD"),
      git("log", "-1", "--format=%cI"),
      git("log", "-1", "--format=%s"),
      git("status", "--porcelain", "--untracked-files=no"),
    ]);
    return {
      version: packageVersion,
      started,
      git: true,
      commit,
      branch,
      date,
      subject,
      dirty: !!status,
      restartNeeded: new Date(date).getTime() > new Date(started).getTime(),
    };
  } catch {
    return { version: packageVersion, started, git: false };
  }
}

export type UpdateCheck = VersionInfo & {
  checked: string;
  available: boolean;
  behind?: number;
  ahead?: number;
  latest?: { commit: string; date: string; subject: string };
  repoUrl?: string;
  compareUrl?: string;
  reason?: string;
};
export async function checkForUpdates(
  options: { fetch?: boolean } = {},
): Promise<UpdateCheck> {
  const info = await versionInfo();
  const checked = new Date().toISOString();
  if (!info.git)
    return {
      ...info,
      checked,
      available: false,
      reason:
        "This copy is not a git checkout, so updates cannot be checked automatically.",
    };
  const remote = await git("remote", "get-url", "origin").catch(() => "");
  if (!remote)
    return {
      ...info,
      checked,
      available: false,
      reason: "No GitHub remote is configured for this checkout.",
    };
  const repoUrl = remote
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "");
  if (options.fetch !== false)
    try {
      await git("fetch", "--quiet", "origin");
    } catch {
      return {
        ...info,
        checked,
        available: false,
        repoUrl,
        reason:
          "GitHub could not be reached. Check your connection and try again.",
      };
    }
  const upstream = `origin/${info.branch}`;
  let behind = 0,
    ahead = 0;
  try {
    behind = Number(await git("rev-list", "--count", `HEAD..${upstream}`));
    ahead = Number(await git("rev-list", "--count", `${upstream}..HEAD`));
  } catch {
    return {
      ...info,
      checked,
      available: false,
      repoUrl,
      reason: `The branch ${info.branch} has no copy on GitHub to compare with.`,
    };
  }
  const latest = behind
    ? {
        commit: await git("rev-parse", "--short", upstream),
        date: await git("log", "-1", "--format=%cI", upstream),
        subject: await git("log", "-1", "--format=%s", upstream),
      }
    : undefined;
  return {
    ...info,
    checked,
    available: behind > 0,
    behind,
    ahead,
    latest,
    repoUrl,
    compareUrl: latest
      ? `${repoUrl}/compare/${info.commit}...${latest.commit}`
      : undefined,
  };
}
