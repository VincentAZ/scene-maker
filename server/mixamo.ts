/**
 * Guided Mixamo round trip. Adobe Mixamo has no public API and cannot be
 * embedded, so the studio prepares a Mixamo-ready FBX, sends the creator to
 * mixamo.com, then watches the Downloads folder and imports what comes back
 * (the "With Skin" character plus any animations) as one rigged, animated GLB.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { untitledAnimationName } from "../shared/animation";
import { dataDir } from "./storage";

const run = promisify(execFile);

export const MIXAMO_URL = "https://www.mixamo.com/";

export function downloadsDirectory() {
  const configured = process.env.SCENE_MAKER_DOWNLOADS;
  if (configured) return path.resolve(configured);
  const xdg = path.join(os.homedir(), ".config", "user-dirs.dirs");
  if (fs.existsSync(xdg)) {
    const match = /XDG_DOWNLOAD_DIR="?([^"\n]+)"?/.exec(
      fs.readFileSync(xdg, "utf8"),
    );
    if (match) return path.resolve(match[1].replace("$HOME", os.homedir()));
  }
  return path.join(os.homedir(), "Downloads");
}

export type MixamoDownload = {
  /** Opaque token the client passes back; never a raw path. */
  token: string;
  name: string;
  size: number;
  modified: number;
  /** True once the file has stopped growing. */
  settled: boolean;
};

export type MixamoDeps = {
  config: () => { blender: string };
  uploads?: string;
  downloads?: () => string;
  now?: () => number;
};

const blenderArgs = (script: string, args: string[]) => [
  "--background",
  "--factory-startup",
  "--disable-autoexec",
  "--threads",
  "4",
  "--python-exit-code",
  "1",
  "--python",
  path.resolve(script),
  "--",
  ...args,
];

export function createMixamoService(deps: MixamoDeps) {
  const uploads = deps.uploads || path.join(dataDir, "uploads");
  const downloads = deps.downloads || downloadsDirectory;
  const now = deps.now || Date.now;
  /** Downloads folder files seen when the creator left for Mixamo. */
  let watchStarted = 0;
  const seen = new Map<string, { size: number; modified: number }>();
  const tokens = new Map<string, string>();

  function tokenFor(file: string) {
    for (const [token, known] of tokens) if (known === file) return token;
    const token = crypto.randomUUID();
    tokens.set(token, file);
    return token;
  }

  return {
    url: MIXAMO_URL,
    downloadsDirectory: downloads,
    /** Export a GLB (uploaded or library) as a Mixamo-ready, unrigged FBX. */
    async prepare(assetUrl: string) {
      const source = resolveModel(assetUrl, uploads);
      const id = crypto.randomUUID();
      const fbx = path.join(uploads, id + "-mixamo.fbx");
      // A generated character already has an FBX next to its GLB.
      const sibling = source.replace(/\.glb$/, ".fbx");
      if (source.startsWith(uploads) && fs.existsSync(sibling))
        return { url: "/uploads/" + path.basename(sibling) };
      try {
        await run(
          deps.config().blender,
          blenderArgs("engine/mixamo_export.py", [source, fbx]),
          { timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
        );
      } catch (error) {
        fs.rmSync(fbx, { force: true });
        const failure = error as Error & { code?: string };
        if (failure.code === "ENOENT")
          throw new Error(
            "Blender is needed to prepare a Mixamo file. Set it up in Studio settings → Connections.",
            { cause: error },
          );
        throw new Error(
          "The model could not be prepared for Mixamo. Try another character.",
          { cause: error },
        );
      }
      return { url: "/uploads/" + id + "-mixamo.fbx" };
    },
    /** Remember what is in Downloads now so only new Mixamo files are offered. */
    startWatch() {
      watchStarted = now();
      seen.clear();
      const directory = downloads();
      if (fs.existsSync(directory))
        for (const name of fs.readdirSync(directory))
          try {
            const stat = fs.statSync(path.join(directory, name));
            seen.set(name, { size: stat.size, modified: stat.mtimeMs });
          } catch {
            /* File disappeared while taking the baseline. */
          }
      return { directory, started: watchStarted };
    },
    /** New .fbx files since the watch started, newest first. */
    poll(): MixamoDownload[] {
      const directory = downloads();
      if (!watchStarted || !fs.existsSync(directory)) return [];
      const found: MixamoDownload[] = [];
      for (const name of fs.readdirSync(directory)) {
        if (!/\.fbx$/i.test(name)) continue;
        const file = path.join(directory, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(file);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        const previous = seen.get(name);
        if (previous?.size === stat.size && previous.modified === stat.mtimeMs)
          continue;
        if (stat.mtimeMs < watchStarted - 1000) continue;
        found.push({
          token: tokenFor(file),
          name,
          size: stat.size,
          modified: stat.mtimeMs,
          settled: now() - stat.mtimeMs > 2000 && stat.size > 0,
        });
      }
      return found.sort((a, b) => b.modified - a.modified);
    },
    /** Merge chosen downloads into one rigged, animated GLB in uploads. */
    async importBundle(input: unknown) {
      const body = z
        .object({
          files: z.array(z.string().uuid()).min(1).max(40),
          /** Optional explicit path for a file chosen through the browser. */
        })
        .parse(input);
      const files = body.files.map((token) => {
        const file = tokens.get(token);
        if (!file || !fs.existsSync(file))
          throw Error("One of the Mixamo files is no longer available.");
        return file;
      });
      return importFiles(files);
    },
    /** Import FBX files already stored locally (e.g. uploaded through the browser). */
    importFiles,
  };

  async function importFiles(files: string[], names?: string[]) {
    if (!files.length || files.length > 40)
      throw Error("Choose between 1 and 40 Mixamo files.");
    const id = crypto.randomUUID();
    const output = path.join(uploads, id + ".glb");
    const temporary = fs.mkdtempSync(path.join(uploads, ".mixamo-"));
    let stdout = "";
    try {
      const copied = files.map((file, index) => {
        const original = path
          .basename(names?.[index] || file)
          .replace(/[^a-zA-Z0-9_. -]/g, "_");
        // Blender names the animation after the input stem. Use a directory
        // per file rather than a prefix that would change the lookup key.
        const directory = path.join(temporary, String(index));
        fs.mkdirSync(directory);
        const target = path.join(directory, original);
        fs.copyFileSync(file, target);
        return target;
      });
      ({ stdout } = await run(
        deps.config().blender,
        blenderArgs("engine/mixamo_bundle.py", [output, ...copied]),
        { timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
      ));
    } catch (error) {
      fs.rmSync(output, { force: true });
      const failure = error as Error & { code?: string; stdout?: string };
      if (failure.code === "ENOENT")
        throw new Error(
          "Blender is needed to import Mixamo files. Set it up in Studio settings → Connections.",
          { cause: error },
        );
      const reason = /ERROR (.+)/.exec(failure.stdout || "")?.[1];
      throw new Error(
        reason
          ? `Mixamo import failed: ${reason}`
          : "The Mixamo files could not be combined. Choose the character downloaded With Skin first.",
        { cause: error },
      );
    } finally {
      // FBX embedded-texture extraction is isolated with our own input copies.
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    // Never write or delete texture directories beside user-owned Downloads files.
    // The bundle's STATS line lists Blender action names; the GLB loader only
    // sees the names written into the file, so those are reported instead.
    const bytes = fs.readFileSync(output);
    const metadata = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
    ) as {
      animations?: { name?: string; samplers: { input: number }[] }[];
      accessors: { max?: number[] }[];
    };
    const animations = (metadata.animations || []).map((a, i) => ({
      // The loader ignores Blender action names; an untitled GLB animation
      // can only be found by its index name.
      name: a.name || untitledAnimationName(i),
      duration: Math.max(
        0.2,
        ...a.samplers.map((s) => metadata.accessors[s.input]?.max?.[0] || 1),
      ),
    }));
    return {
      url: "/uploads/" + id + ".glb",
      name: path.basename(
        names?.[0] || files[0],
        path.extname(names?.[0] || files[0]),
      ),
      animations,
      files: files.map((file, index) => path.basename(names?.[index] || file)),
    };
  }
}

function resolveModel(url: string, uploads: string) {
  if (/^\/uploads\/[a-zA-Z0-9_.-]+\.glb$/.test(url)) {
    const file = path.join(uploads, path.basename(url));
    if (!fs.existsSync(file)) throw Error("The model file is missing.");
    return file;
  }
  if (/^\/library\/[a-zA-Z0-9_\/-]+\.glb$/.test(url)) {
    const file = path.resolve("public" + url);
    if (
      !file.startsWith(path.resolve("public/library")) ||
      !fs.existsSync(file)
    )
      throw Error("The library model is missing.");
    return file;
  }
  throw Error("Choose an uploaded or library character to send to Mixamo.");
}
