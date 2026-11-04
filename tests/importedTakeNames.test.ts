import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { importedTakeLabel, untitledAnimationName } from "../shared/animation";
import { blenderFailure } from "../server/fbxImport";
import { importedClip } from "../src/rig";

/** A self-contained GLB: one node with one translation animation, optionally untitled. */
function animatedGlb(animationName?: string, seconds = 2) {
  const times = new Float32Array([0, seconds]);
  const values = new Float32Array([0, 0, 0, 0, 1, 0]);
  const bin = Buffer.concat([
    Buffer.from(times.buffer),
    Buffer.from(values.buffer),
  ]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Root" }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 8 },
      { buffer: 0, byteOffset: 8, byteLength: 24 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 2,
        type: "SCALAR",
        min: [0],
        max: [seconds],
      },
      { bufferView: 1, componentType: 5126, count: 2, type: "VEC3" },
    ],
    animations: [
      {
        ...(animationName ? { name: animationName } : {}),
        samplers: [{ input: 0, output: 1, interpolation: "LINEAR" }],
        channels: [{ sampler: 0, target: { node: 0, path: "translation" } }],
      },
    ],
  };
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const jsonPadded = Buffer.concat([
    jsonBytes,
    Buffer.alloc((4 - (jsonBytes.length % 4)) % 4, 0x20),
  ]);
  const binPadded = Buffer.concat([
    bin,
    Buffer.alloc((4 - (bin.length % 4)) % 4),
  ]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8);
  const jsonChunk = Buffer.alloc(8);
  jsonChunk.writeUInt32LE(jsonPadded.length, 0);
  jsonChunk.write("JSON", 4, "ascii");
  const binChunk = Buffer.alloc(8);
  binChunk.writeUInt32LE(binPadded.length, 0);
  binChunk.write("BIN\0", 4, "ascii");
  return Buffer.concat([header, jsonChunk, jsonPadded, binChunk, binPadded]);
}
async function loadClips(glb: Buffer) {
  const bytes = new Uint8Array(glb).buffer as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  return gltf.animations;
}

describe("import service takes and refusals", () => {
  let server: Server, base: string, dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-takes-"));
    process.env.SCENE_MAKER_DATA = dir;
    process.env.NODE_ENV = "test";
    const { app } = await import("../server/index");
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("the import service reports the name the loader will give an untitled take", async () => {
    const form = new FormData();
    form.append("file", new Blob([animatedGlb()]), "untitled-take.glb");
    const response = await fetch(base + "/api/import", {
      method: "POST",
      headers: { "X-Scene-Maker": "1" },
      body: form,
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      animations: { name: string; duration: number }[];
      hasMesh: boolean;
    };
    expect(result.animations).toEqual([
      { name: untitledAnimationName(0), duration: 2 },
    ]);
    // A take without a body goes to Actions instead of placing an actor.
    expect(result.hasMesh).toBe(false);
    const clips = await loadClips(animatedGlb());
    expect(clips.map((clip) => clip.name)).toEqual([result.animations[0].name]);
    // The saved motion must find its take in the loaded file.
    expect(importedClip(clips, result.animations[0].name)).toBe(clips[0]);
  });
  it("keeps titled takes and the motions saved under them", async () => {
    const form = new FormData();
    form.append("file", new Blob([animatedGlb("Walk cycle")]), "titled.glb");
    const result = (await (
      await fetch(base + "/api/import", {
        method: "POST",
        headers: { "X-Scene-Maker": "1" },
        body: form,
      })
    ).json()) as { animations: { name: string }[] };
    expect(result.animations[0].name).toBe("Walk cycle");
    const clips = await loadClips(animatedGlb("Walk cycle"));
    expect(importedClip(clips, "Walk cycle")).toBe(clips[0]);
    expect(importedClip(clips, untitledAnimationName(0))).toBeUndefined();
  });
  const upload = async (bytes: Buffer, name: string) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)]), name);
    const response = await fetch(base + "/api/import", {
      method: "POST",
      headers: { "X-Scene-Maker": "1" },
      body: form,
    });
    return { status: response.status, ...(await response.json()) };
  };
  it("names an FBX 6.1 file's format instead of running Blender on it", async () => {
    const binary = Buffer.alloc(64);
    binary.write("Kaydara FBX Binary  \0\x1a\0", 0, "latin1");
    binary.writeUInt32LE(6100, 23);
    const result = await upload(binary, "old-capture.fbx");
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/old-capture\.fbx is an FBX 6\.1 file/);
    expect(result.error).not.toMatch(/--background|convert\.py/);
    const ascii = Buffer.from(
      "; FBX 6.1.0 project file\nFBXHeaderExtension:  {\n\tFBXVersion: 6100\n",
    );
    expect((await upload(ascii, "ascii.fbx")).error).toMatch(/FBX 6\.1 file/);
  });
  it("reports Blender's reason rather than its command line", () => {
    const failure = Object.assign(
      Error("Command failed: blender --background"),
      {
        stderr:
          "Traceback\nRuntimeError: Error: Version 6100 unsupported, must be 7100 or later\n\nError: Version 6100 unsupported, must be 7100 or later\n",
      },
    );
    expect(blenderFailure(failure)).toBe(
      "Blender could not convert this FBX: Version 6100 unsupported, must be 7100 or later",
    );
    expect(blenderFailure(Error("Command failed"))).toMatch(
      /^Blender could not convert this FBX\. Re-export/,
    );
  });
});

describe("imported take labels", () => {
  it("lists exporter-named takes under the file's name", () => {
    expect(
      importedTakeLabel("Armature|mixamo.com|Layer0", "Walking", 0, 1),
    ).toBe("Walking");
    expect(importedTakeLabel("mixamo.com", "Idle", 0, 1)).toBe("Idle");
    expect(
      importedTakeLabel("Armature|Take 001|BaseLayer", "Claudia", 0, 1),
    ).toBe("Claudia");
    expect(importedTakeLabel("Take 001", "Clip", 1, 3)).toBe("Clip 2");
    expect(importedTakeLabel(untitledAnimationName(0), "Clip", 0, 1)).toBe(
      "Clip",
    );
  });
  it("keeps meaningful take names, without Blender's object and layer parts", () => {
    expect(importedTakeLabel("Walk cycle", "File", 0, 1)).toBe("Walk cycle");
    expect(importedTakeLabel("Armature|0_T-Pose", "Party F", 0, 2)).toBe(
      "0_T-Pose",
    );
    expect(importedTakeLabel("Armature|Jump|Layer0", "File", 0, 1)).toBe(
      "Jump",
    );
    expect(importedTakeLabel("CMU 08_01", "08_01", 0, 1)).toBe("CMU 08_01");
  });
});

describe("imported take lookup", () => {
  it("resolves the service's earlier untitled label to the same untitled take only", async () => {
    const clips = await loadClips(animatedGlb());
    expect(clips[0].name).toBe("animation_0");
    expect(importedClip(clips, "Animation 1")).toBe(clips[0]);
    expect(importedClip(clips, "Animation 2")).toBeUndefined();
    expect(importedClip(clips, "Animation 0")).toBeUndefined();
    expect(importedClip(clips, "")).toBeUndefined();
    expect(importedClip(undefined, "Animation 1")).toBeUndefined();
  });
  it("never redirects a label to a titled take", () => {
    const titled = new T.AnimationClip("Idle", 1, []);
    const literal = new T.AnimationClip("Animation 1", 1, []);
    expect(importedClip([titled], "Animation 1")).toBeUndefined();
    expect(importedClip([literal], "Animation 1")).toBe(literal);
    const untitled = new T.AnimationClip(untitledAnimationName(1), 1, []);
    expect(importedClip([titled, untitled], "Animation 2")).toBe(untitled);
  });
});
