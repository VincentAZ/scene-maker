// Headless Blender for the content build. The bundled 4.5 LTS is preferred
// (the library was built with it); BLENDER_PATH or SCENE_MAKER_BLENDER name
// another binary. Every run starts from factory settings with auto-run
// scripts disabled, because the files it opens are downloads.
import { spawn, spawnSync } from "node:child_process";
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

/** [major, minor] of a Blender binary, from `blender --version`. */
export function blenderVersion(blender) {
  const run = spawnSync(blender, ["--version"], {
    encoding: "utf8",
    timeout: 60000,
  });
  const found = /Blender (\d+)\.(\d+)/.exec(run.stdout ?? "");
  if (!found) throw Error(`${blender} did not say which Blender it is.`);
  return [Number(found[1]), Number(found[2])];
}

/** Runs `script` with `args` after "--". Lines of stdout starting with
 * `prefix` are passed to `log` as they come, so a long bake shows progress;
 * the rest is kept quiet. Resolves when Blender exits cleanly; rejects with
 * the tail of its output when it fails or exceeds `timeout` (ms). */
export function runBlender(
  blender,
  script,
  args,
  { log, prefix = "SET ", timeout = 60 * 60 * 1000, env } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(
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
      { env: { ...process.env, ...env } },
    );
    const tail = [];
    const keep = (line) => {
      if (line.trim() && !/^(Blender|Read |Info:|WARN|Fra:)/.test(line))
        tail.push(line);
      if (tail.length > 30) tail.shift();
    };
    let pending = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop();
      for (const line of lines) {
        if (line.startsWith(prefix)) log?.(line.slice(prefix.length));
        keep(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => chunk.split("\n").forEach(keep));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeout);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(
          Error(`Blender ran out of time after ${timeout / 60000} minutes.`),
        );
      else if (code !== 0)
        reject(Error(`Blender exited with ${code}:\n${tail.join("\n")}`));
      else resolve();
    });
  });
}
