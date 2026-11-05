/**
 * Guided Mixamo round trip. Adobe Mixamo has no public API and cannot be
 * embedded, so the studio prepares a Mixamo-ready FBX, sends the creator to
 * mixamo.com, then watches the Downloads folder and imports what comes back:
 * the "With Skin" character plus any animations as one rigged, animated GLB,
 * or a whole batch of downloads as one character per skinned file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { untitledAnimationName } from "../shared/animation";
import { blenderFailure, unsupportedFbxMessage } from "./fbxImport";
import { dataDir } from "./storage";

const run = promisify(execFile);

export const MIXAMO_URL = "https://www.mixamo.com/";
/** "one": every chosen file joins one character. "each": every file
 * downloaded With Skin becomes its own character, and the skinless animation
 * files after it are its animations. */
export const importModes = ["one", "each"] as const;
export type ImportMode = (typeof importModes)[number];

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

/** The name a Mixamo download gives its character: the file's stem without
 * Mixamo's material marker ("Ch14_nonPBR" → "Ch14"), underscores as spaces. */
export function mixamoCharacterName(fileName: string) {
  const stem = path.basename(fileName, path.extname(fileName));
  const name = stem
    .replace(/_(non)?pbr\b/gi, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || stem;
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

export type ImportedCharacter = {
  url: string;
  name: string;
  animations: { name: string; duration: number }[];
  files: string[];
};

export type MixamoDeps = {
  config: () => { blender: string };
  uploads?: string;
  /** The built realistic library (content/characters), for prepare(). */
  content?: string;
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

const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_. -]/g, "_");

/** The takes a GLB carries, with their raw lengths in seconds. */
function readTakes(file: string) {
  const bytes = fs.readFileSync(file);
  const metadata = JSON.parse(
    bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
  ) as {
    meshes?: unknown[];
    animations?: { name?: string; samplers: { input: number }[] }[];
    accessors: { max?: number[] }[];
  };
  return {
    hasMesh: (metadata.meshes || []).length > 0,
    takes: (metadata.animations || []).map((a, i) => ({
      // The loader ignores Blender action names; an untitled GLB animation
      // can only be found by its index name.
      name: a.name || untitledAnimationName(i),
      seconds: Math.max(
        0,
        ...a.samplers.map((s) => metadata.accessors[s.input]?.max?.[0] || 0),
      ),
    })),
  };
}

/** Takes as the studio lists them: a missing length counts as a second. */
const asAnimations = (takes: { name: string; seconds: number }[]) =>
  takes.map((t) => ({ name: t.name, duration: Math.max(0.2, t.seconds || 1) }));

/** Mixamo's character downloads carry a one-frame "mixamo.com" T-pose take:
 * a pose, not a motion, so a batch import does not offer it as an action. */
const isMotion = (take: { seconds: number }) => take.seconds > 0.1;

export function createMixamoService(deps: MixamoDeps) {
  const uploads = deps.uploads || path.join(dataDir, "uploads");
  const content =
    deps.content ||
    path.resolve(process.env.SCENE_MAKER_CONTENT || "content", "characters");
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

  function blenderMissing(error: unknown, action: string) {
    const failure = error as Error & { code?: string };
    return failure.code === "ENOENT"
      ? new Error(
          `Blender is needed to ${action}. Set it up in Studio settings → Connections.`,
          { cause: error },
        )
      : undefined;
  }

  return {
    url: MIXAMO_URL,
    downloadsDirectory: downloads,
    /** Export a GLB (uploaded or library) as a Mixamo-ready, unrigged FBX. */
    async prepare(assetUrl: string) {
      const source = resolveModel(assetUrl, uploads, content);
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
        throw (
          blenderMissing(error, "prepare a Mixamo file") ??
          new Error(
            "The model could not be prepared for Mixamo. Try another character.",
            { cause: error },
          )
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
    importBundle: async (input: unknown) => importFiles(chosen(input)),
    /** Chosen downloads as one character per skinned file. */
    importBatch: async (input: unknown) => importEach(chosen(input)),
    /** Import FBX files already stored locally (e.g. uploaded through the browser). */
    importFiles,
    importEach,
  };

  /** The files behind the tokens the client picked. */
  function chosen(input: unknown) {
    const body = z
      .object({ files: z.array(z.string().uuid()).min(1).max(40) })
      .parse(input);
    return body.files.map((token) => {
      const file = tokens.get(token);
      if (!file || !fs.existsSync(file))
        throw Error("One of the Mixamo files is no longer available.");
      return file;
    });
  }

  /** Merge the files into one rigged, animated GLB in uploads. */
  async function importFiles(
    files: string[],
    names?: string[],
  ): Promise<ImportedCharacter> {
    if (!files.length || files.length > 40)
      throw Error("Choose between 1 and 40 Mixamo files.");
    const id = crypto.randomUUID();
    const output = path.join(uploads, id + ".glb");
    const temporary = fs.mkdtempSync(path.join(uploads, ".mixamo-"));
    try {
      const copied = files.map((file, index) => {
        const original = safeName(path.basename(names?.[index] || file));
        // Blender names the animation after the input stem. Use a directory
        // per file rather than a prefix that would change the lookup key.
        const directory = path.join(temporary, String(index));
        fs.mkdirSync(directory);
        const target = path.join(directory, original);
        fs.copyFileSync(file, target);
        return target;
      });
      await run(
        deps.config().blender,
        blenderArgs("engine/mixamo_bundle.py", [output, ...copied]),
        { timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      fs.rmSync(output, { force: true });
      const failure = error as Error & { stdout?: string };
      const reason = /ERROR (.+)/.exec(failure.stdout || "")?.[1];
      throw (
        blenderMissing(error, "import Mixamo files") ??
        new Error(
          reason
            ? `Mixamo import failed: ${reason}`
            : "The Mixamo files could not be combined. Choose the character downloaded With Skin first.",
          { cause: error },
        )
      );
    } finally {
      // FBX embedded-texture extraction is isolated with our own input copies.
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    // Never write or delete texture directories beside user-owned Downloads files.
    // The bundle's STATS line lists Blender action names; the GLB loader only
    // sees the names written into the file, so those are reported instead.
    return {
      url: "/uploads/" + id + ".glb",
      name: mixamoCharacterName(names?.[0] || files[0]),
      animations: asAnimations(readTakes(output).takes),
      files: files.map((file, index) => path.basename(names?.[index] || file)),
    };
  }

  /** Convert one download on its own (the app's generic FBX path) into
   * uploads, and say whether it carries a body. */
  async function convertOne(file: string, name: string) {
    const unsupported = unsupportedFbxMessage(file, name);
    if (unsupported) throw Error(unsupported);
    const id = crypto.randomUUID();
    const output = path.join(uploads, id + ".glb");
    const temporary = fs.mkdtempSync(path.join(uploads, ".mixamo-"));
    try {
      const copy = path.join(temporary, safeName(name));
      fs.copyFileSync(file, copy);
      await run(
        deps.config().blender,
        blenderArgs("engine/convert.py", [copy, output]),
        { timeout: 300000, maxBuffer: 4 * 1024 * 1024 },
      );
    } catch (error) {
      fs.rmSync(output, { force: true });
      throw (
        blenderMissing(error, "import Mixamo files") ??
        new Error(`${name}: ${blenderFailure(error)}`, { cause: error })
      );
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
    return {
      file: output,
      url: "/uploads/" + id + ".glb",
      ...readTakes(output),
    };
  }

  /** One character per download With Skin, each followed by its animations. */
  async function importEach(files: string[], names?: string[]) {
    if (!files.length || files.length > 40)
      throw Error("Choose between 1 and 40 Mixamo files.");
    const label = (index: number) =>
      path.basename(names?.[index] || files[index]);
    const characters: { index: number; takes: number[] }[] = [];
    const converted: Awaited<ReturnType<typeof convertOne>>[] = [];
    const kept = new Set<string>();
    try {
      for (let index = 0; index < files.length; index++) {
        const model = await convertOne(files[index], label(index));
        converted.push(model);
        if (model.hasMesh) characters.push({ index, takes: [] });
        else if (characters.length) characters.at(-1)!.takes.push(index);
        else
          throw Error(
            `${label(index)} was downloaded Without Skin, so there is no character to give it to. Put a character downloaded With Skin before its animations.`,
          );
      }
      const results: ImportedCharacter[] = [];
      for (const character of characters) {
        const own = converted[character.index];
        let result: ImportedCharacter;
        if (character.takes.length) {
          const group = [character.index, ...character.takes];
          result = await importFiles(
            group.map((i) => files[i]),
            group.map((i) => label(i)),
          );
          result.animations = asAnimations(
            readTakes(
              path.join(uploads, path.basename(result.url)),
            ).takes.filter(isMotion),
          );
        } else {
          kept.add(own.file);
          result = {
            url: own.url,
            name: mixamoCharacterName(label(character.index)),
            animations: asAnimations(own.takes.filter(isMotion)),
            files: [label(character.index)],
          };
        }
        results.push(result);
      }
      return { characters: results };
    } finally {
      for (const model of converted)
        if (!kept.has(model.file)) fs.rmSync(model.file, { force: true });
    }
  }
}

function resolveModel(url: string, uploads: string, content: string) {
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
  if (/^\/content\/characters\/[a-zA-Z0-9_-]+\.glb$/.test(url)) {
    const file = path.join(content, path.basename(url));
    if (!fs.existsSync(file))
      throw Error("This library character has not been downloaded yet.");
    return file;
  }
  throw Error("Choose an uploaded or library character to send to Mixamo.");
}
