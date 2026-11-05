// Headless Blender for the content build. The bundled 4.5 LTS is preferred
// (the library was built with it); BLENDER_PATH or SCENE_MAKER_BLENDER name
// another binary. Every run starts from factory settings with auto-run
// scripts disabled, because the files it opens are downloads.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function findBlender(root) {
  const candidates = [
    process.env.BLENDER_PATH,
    process.env.SCENE_MAKER_BLENDER,
    path.join(root, ".data/tools/blender/blender"),
    path.join(root, "../scene-maker/.data/tools/blender/blender"),
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;
  const which = spawnSync("which", ["blender"], { encoding: "utf8" });
  if (which.status === 0) return which.stdout.trim();
  throw Error(
    "Blender is needed to convert models. Set BLENDER_PATH to its binary.",
  );
}

/** Runs `script` with `args` after "--". Lines of stdout starting with
 * `prefix` are passed to `log` as they come; the rest is kept quiet. Throws
 * with the tail of stderr when Blender fails or exceeds `timeout` (ms). */
export function runBlender(
  blender,
  script,
  args,
  { log, prefix = "SET ", timeout = 60 * 60 * 1000, env } = {},
) {
  const run = spawnSync(
    blender,
    [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      script,
      "--",
      ...args,
    ],
    {
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout,
      env: { ...process.env, ...env },
    },
  );
  for (const line of (run.stdout || "").split("\n"))
    if (line.startsWith(prefix)) log?.(line.slice(prefix.length));
  if (run.error?.code === "ETIMEDOUT")
    throw Error(`Blender ran out of time after ${timeout / 60000} minutes.`);
  if (run.status !== 0) {
    const tail = `${run.stdout || ""}\n${run.stderr || ""}`
      .split("\n")
      .filter(
        (line) => line.trim() && !/^(Blender|Read |Info:|WARN|Fra:)/.test(line),
      )
      .slice(-30)
      .join("\n");
    throw Error(`Blender exited with ${run.status}:\n${tail}`);
  }
  return run;
}
