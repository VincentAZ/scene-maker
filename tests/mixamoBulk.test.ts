import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMixamoService, mixamoCharacterName } from "../server/mixamo";

/** Smallest valid GLB around the given JSON. */
function glb(json: object) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const chunk = Buffer.from(text, "utf8");
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + chunk.length, 8);
  header.writeUInt32LE(chunk.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, chunk]);
}

/** A GLB as Blender would write it for a download: `seconds` per take, and a
 * skinned mesh when the file was downloaded With Skin. */
function download(
  skinned: boolean,
  takes: Record<string, number>,
  json: object = {},
) {
  const names = Object.keys(takes);
  return glb({
    asset: { version: "2.0" },
    ...(skinned
      ? { meshes: [{ primitives: [] }], skins: [{ joints: [] }] }
      : {}),
    accessors: names.map((name) => ({ max: [takes[name]] })),
    animations: names.map((name, i) => ({ name, samplers: [{ input: i }] })),
    ...json,
  });
}

let tmp: string;
let uploads: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-mixamo-"));
  uploads = path.join(tmp, "uploads");
  fs.mkdirSync(uploads);
  fs.mkdirSync(path.join(tmp, "glb"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A stand-in "blender": convert.py answers with glb/convert-<stem>.glb,
 * mixamo_bundle.py with glb/bundle-<first stem>.glb, mixamo_export.py writes
 * the FBX, and every call is logged. */
function fakeBlender() {
  const file = path.join(tmp, "blender");
  fs.writeFileSync(
    file,
    `#!/bin/sh
set -e
while [ "$1" != "--python" ]; do shift; done
script="$2"
while [ "$1" != "--" ]; do shift; done; shift
case "$script" in
  *convert.py)
    stem=$(basename "$1" .fbx)
    echo "convert $stem" >> "${tmp}/calls.log"
    [ -f "${tmp}/glb/convert-$stem.glb" ] || { echo "Error: unreadable $stem" >&2; exit 1; }
    cp "${tmp}/glb/convert-$stem.glb" "$2" ;;
  *mixamo_bundle.py)
    out="$1"; shift
    names=""; for f in "$@"; do names="$names $(basename "$f" .fbx)"; done
    echo "bundle$names" >> "${tmp}/calls.log"
    cp "${tmp}/glb/bundle-$(basename "$1" .fbx).glb" "$out"
    echo 'STATS {"animations":[],"bones":20,"meshes":1}' ;;
  *mixamo_export.py)
    echo "export $(basename "$1")" >> "${tmp}/calls.log"
    echo "fbx" > "$2" ;;
esac
`,
    { mode: 0o755 },
  );
  return file;
}
const calls = () =>
  fs.existsSync(path.join(tmp, "calls.log"))
    ? fs.readFileSync(path.join(tmp, "calls.log"), "utf8").trim().split("\n")
    : [];
const answer = (name: string, bytes: Buffer) =>
  fs.writeFileSync(path.join(tmp, "glb", name + ".glb"), bytes);
const fbx = (name: string) => {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, "Kaydara FBX Binary  \0" + "\x1a\0" + "\x40\x1c\0\0");
  return file;
};

describe("Mixamo character names", () => {
  it("drop the material marker and underscores", () => {
    expect(mixamoCharacterName("Ch14_nonPBR.fbx")).toBe("Ch14");
    expect(mixamoCharacterName("Ch03_nonPBR (1).fbx")).toBe("Ch03 (1)");
    expect(mixamoCharacterName("Y Bot.fbx")).toBe("Y Bot");
    expect(mixamoCharacterName("maw_j_laygo.fbx")).toBe("maw j laygo");
    expect(mixamoCharacterName("/tmp/x/Vanguard By T. Choonyung.fbx")).toBe(
      "Vanguard By T. Choonyung",
    );
    expect(mixamoCharacterName("_nonPBR.fbx")).toBe("_nonPBR");
  });
});

describe("Mixamo batch import", () => {
  it("makes one character per skinned file and gives it the animations that follow", async () => {
    const blender = fakeBlender();
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
    });
    // Ch14: T-pose download, then two skinless animations. Y Bot: its own take.
    answer(
      "convert-Ch14_nonPBR",
      download(true, { "Armature|mixamo.com|Layer0": 0 }),
    );
    answer(
      "convert-Walking",
      download(false, { "Armature|mixamo.com|Layer0": 1.1 }),
    );
    answer(
      "convert-Idle",
      download(false, { "Armature|mixamo.com|Layer0": 0.9 }),
    );
    answer(
      "convert-Y Bot",
      download(true, { "Armature|mixamo.com|Layer0": 1.2 }),
    );
    answer(
      "bundle-Ch14_nonPBR",
      download(true, { Ch14_nonPBR: 1 / 30, Walking: 1.1, Idle: 0.9 }),
    );
    const files = [
      "Ch14_nonPBR.fbx",
      "Walking.fbx",
      "Idle.fbx",
      "Y Bot.fbx",
    ].map(fbx);
    const { characters } = await service.importEach(files);
    expect(characters).toHaveLength(2);
    expect(characters[0]).toMatchObject({
      name: "Ch14",
      // The one-frame T-pose take is not offered as an action.
      animations: [
        { name: "Walking", duration: 1.1 },
        { name: "Idle", duration: 0.9 },
      ],
      files: ["Ch14_nonPBR.fbx", "Walking.fbx", "Idle.fbx"],
    });
    expect(characters[1]).toMatchObject({
      name: "Y Bot",
      animations: [{ name: "Armature|mixamo.com|Layer0", duration: 1.2 }],
      files: ["Y Bot.fbx"],
    });
    for (const character of characters) {
      expect(character.url).toMatch(/^\/uploads\/[0-9a-f-]+\.glb$/);
      expect(
        fs.existsSync(path.join(uploads, path.basename(character.url))),
      ).toBe(true);
    }
    // Every file was probed through the generic converter, the character with
    // animations was then bundled once, in order, and nothing else is left.
    expect(calls()).toEqual([
      "convert Ch14_nonPBR",
      "convert Walking",
      "convert Idle",
      "convert Y Bot",
      "bundle Ch14_nonPBR Walking Idle",
    ]);
    expect(fs.readdirSync(uploads).sort()).toEqual(
      characters.map((c) => path.basename(c.url)).sort(),
    );
    for (const file of files)
      expect(fs.readFileSync(file, "utf8")).toContain("Kaydara");
  });

  it("refuses a skinless animation that has no character before it", async () => {
    const blender = fakeBlender();
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
    });
    answer(
      "convert-Walking",
      download(false, { "Armature|mixamo.com|Layer0": 1.1 }),
    );
    await expect(service.importEach([fbx("Walking.fbx")])).rejects.toThrow(
      /Walking\.fbx was downloaded Without Skin.*With Skin before its animations/,
    );
    expect(fs.readdirSync(uploads)).toEqual([]);
  });

  it("names the character whose animations cannot be combined and keeps none of the batch", async () => {
    const blender = fakeBlender();
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
    });
    for (const name of ["Ch14_nonPBR", "Ch33_nonPBR"])
      answer("convert-" + name, download(true, { "mixamo.com": 0 }));
    for (const name of ["Walking", "Idle"])
      answer("convert-" + name, download(false, { "mixamo.com": 1 }));
    // Ch14's bundle works; Ch33's fails in Blender (no answer file).
    answer(
      "bundle-Ch14_nonPBR",
      download(true, { Ch14_nonPBR: 0, Walking: 1 }),
    );
    const files = [
      "Ch14_nonPBR.fbx",
      "Walking.fbx",
      "Ch33_nonPBR.fbx",
      "Idle.fbx",
    ].map(fbx);
    await expect(service.importEach(files)).rejects.toThrow(
      "Ch33_nonPBR.fbx could not be combined with the animations after it (Idle.fbx).",
    );
    expect(calls()).toContain("bundle Ch14_nonPBR Walking");
    // Ch14's finished character is not left behind either.
    expect(fs.readdirSync(uploads)).toEqual([]);
  });

  it("refuses by name a file that is neither a character nor an animation", async () => {
    const blender = fakeBlender();
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
    });
    answer("convert-Y Bot", download(true, { "mixamo.com": 0 }));
    // A static model: a mesh without a skeleton.
    answer(
      "convert-cube",
      glb({ asset: { version: "2.0" }, meshes: [{ primitives: [] }] }),
    );
    answer("convert-empty", glb({ asset: { version: "2.0" } }));
    await expect(
      service.importEach(["Y Bot.fbx", "cube.fbx"].map(fbx)),
    ).rejects.toThrow(
      /^cube\.fbx has a 3D model but no skeleton, so it is neither a character nor an animation/,
    );
    await expect(
      service.importEach(["Y Bot.fbx", "empty.fbx"].map(fbx)),
    ).rejects.toThrow(/^empty\.fbx holds no character and no animation/);
    expect(fs.readdirSync(uploads)).toEqual([]);
  });

  it("names the file Blender could not read and keeps the batch limits", async () => {
    const blender = fakeBlender();
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
    });
    await expect(service.importEach([fbx("Broken.fbx")])).rejects.toThrow(
      /Broken\.fbx: Blender could not convert this FBX: unreadable Broken/,
    );
    await expect(service.importEach([])).rejects.toThrow(/between 1 and 40/);
    await expect(
      service.importEach(Array.from({ length: 41 }, () => fbx("a.fbx"))),
    ).rejects.toThrow(/between 1 and 40/);
    expect(fs.readdirSync(uploads)).toEqual([]);
  });

  it("imports watched downloads as a batch or as one character", async () => {
    const blender = fakeBlender();
    const downloads = path.join(tmp, "Downloads");
    fs.mkdirSync(downloads);
    let clock = 1_000_000;
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
      downloads: () => downloads,
      now: () => clock,
    });
    service.startWatch();
    const bot = path.join(downloads, "X Bot.fbx");
    fs.writeFileSync(bot, "Kaydara FBX Binary  \0\x1a\0\x40\x1c\0\0");
    fs.utimesSync(bot, new Date(clock), new Date(clock));
    clock += 5000;
    const [file] = service.poll();
    answer(
      "convert-X Bot",
      download(true, { "Armature|mixamo.com|Layer0": 0 }),
    );
    const batch = await service.importBatch({ files: [file.token] });
    expect(batch.characters).toEqual([
      expect.objectContaining({
        name: "X Bot",
        animations: [],
        files: ["X Bot.fbx"],
      }),
    ]);
    // The single-character merge leaves the T-pose take out too.
    answer("bundle-X Bot", download(true, { "X Bot": 1 / 30 }));
    expect(await service.importBundle({ files: [file.token] })).toMatchObject({
      name: "X Bot",
      animations: [],
    });
    await expect(
      service.importBatch({ files: ["00000000-0000-0000-0000-000000000000"] }),
    ).rejects.toThrow(/no longer available/);
  });
});

describe("Mixamo prepare", () => {
  it("accepts a realistic library character", async () => {
    const blender = fakeBlender();
    const content = path.join(tmp, "content", "characters");
    fs.mkdirSync(content, { recursive: true });
    fs.writeFileSync(
      path.join(content, "rocketbox-female-adult-01.glb"),
      glb({}),
    );
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
      content,
    });
    const { url } = await service.prepare(
      "/content/characters/rocketbox-female-adult-01.glb",
    );
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]+-mixamo\.fbx$/);
    expect(fs.existsSync(path.join(uploads, path.basename(url)))).toBe(true);
    expect(calls()).toEqual(["export rocketbox-female-adult-01.glb"]);
    await expect(
      service.prepare("/content/characters/rocketbox-nobody.glb"),
    ).rejects.toThrow(/not been downloaded/);
    await expect(
      service.prepare("/content/characters/../../secret.glb"),
    ).rejects.toThrow(/Choose an uploaded or library character/);
  });
});
