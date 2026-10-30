import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildPrompt,
  createGenerationService,
  generationRequestSchema,
} from "../server/generation";
import { createMixamoService } from "../server/mixamo";

/** Smallest valid GLB: a JSON chunk with an empty asset. */
function minimalGlb(json: object = { asset: { version: "2.0" } }) {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const jsonChunk = Buffer.from(text, "utf8");
  const header = Buffer.alloc(12 + 8);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + jsonChunk.length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, jsonChunk]);
}

/** A stand-in "blender" that writes the expected outputs and a STATS line. */
function fakeBlender(dir: string, body: string) {
  const file = path.join(dir, "blender");
  fs.writeFileSync(file, "#!/bin/sh\n" + body, { mode: 0o755 });
  return file;
}

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-gen-"));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("generation prompts", () => {
  it("adds rig-friendly guidance for characters and object guidance for props", () => {
    expect(
      buildPrompt({ prompt: "a tired detective", category: "characters" }),
    ).toContain("T-pose");
    expect(
      buildPrompt({ prompt: "an old radio", category: "props" }),
    ).toContain("Single object");
    expect(() =>
      generationRequestSchema.parse({ prompt: "ab", category: "props" }),
    ).toThrow();
  });
});

describe("generation service", () => {
  it("refuses to start without a key", () => {
    const service = createGenerationService({
      config: () => ({ blender: "blender" }),
      uploads: tmp,
    });
    expect(service.configured()).toBe(false);
    expect(() =>
      service.start({ prompt: "a wooden stool", category: "props" }),
    ).toThrow(/Meshy API key/);
  });

  it("runs preview → refine → Blender cleanup and yields an asset", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    let polls = 0;
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (url.endsWith("/openapi/v2/text-to-3d") && init?.method === "POST") {
        const mode = (JSON.parse(String(init.body)) as { mode: string }).mode;
        return new Response(JSON.stringify({ result: mode + "-task" }), {
          status: 200,
        });
      }
      if (url.includes("/openapi/v2/text-to-3d/")) {
        polls++;
        const done = polls % 2 === 0;
        return new Response(
          JSON.stringify({
            id: "x",
            status: done ? "SUCCEEDED" : "IN_PROGRESS",
            progress: done ? 100 : 40,
            model_urls: done
              ? { glb: "https://cdn.example/model.glb" }
              : undefined,
            thumbnail_url: done ? "https://cdn.example/thumb.png" : undefined,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("model.glb"))
        return new Response(minimalGlb(), { status: 200 });
      if (url.endsWith("thumb.png"))
        return new Response(Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
          status: 200,
        });
      return new Response("not found", { status: 404 });
    }) as typeof fetch;
    const blender = fakeBlender(
      tmp,
      // args: ... -- spec raw glb fbx
      `set -e
      while [ "$1" != "--" ]; do shift; done; shift
      cp "$2" "$3"
      echo mesh > "$4"
      echo 'STATS {"faces":12,"vertices":8,"dimensions":[0.5,1.75,0.3],"images":1}'`,
    );
    const service = createGenerationService({
      config: () => ({ blender, generation: { meshy: { key: "k" } } }),
      fetch: fetchImpl,
      pollInterval: 1,
      uploads: tmp,
    });
    const job = service.start({
      prompt: "a tired detective in a trench coat",
      category: "characters",
      size: 1.8,
    });
    expect(["queued", "generating"]).toContain(job.status);
    let final = service.get(job.id)!;
    for (
      let i = 0;
      i < 200 && !["done", "failed"].includes(final.status);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 10));
      final = service.get(job.id)!;
    }
    expect(final.error).toBeUndefined();
    expect(final.status).toBe("done");
    expect(final.progress).toBe(100);
    expect(final.asset?.url).toBe("/uploads/" + job.id + ".glb");
    expect(final.asset?.thumbnail).toBe("/uploads/" + job.id + ".png");
    expect(final.asset?.category).toBe("characters");
    expect(final.asset?.name).toBe("A tired detective in a trench coat");
    expect(final.fbx).toBe("/uploads/" + job.id + ".fbx");
    expect(final.stats).toEqual({
      faces: 12,
      vertices: 8,
      dimensions: [0.5, 1.75, 0.3],
      images: 1,
    });
    expect(final.provenance).toEqual({
      service: "meshy",
      taskIds: ["preview-task", "refine-task"],
      prompt: "a tired detective in a trench coat",
    });
    const preview = calls.find(
      (c) => (c.body as { mode?: string })?.mode === "preview",
    )!;
    expect((preview.body as { prompt: string }).prompt).toContain("T-pose");
    expect((preview.body as { symmetry_mode: string }).symmetry_mode).toBe(
      "on",
    );
    expect(
      calls.some((c) => (c.body as { mode?: string })?.mode === "refine"),
    ).toBe(true);
    expect(fs.existsSync(path.join(tmp, job.id + ".glb"))).toBe(true);
    expect(fs.existsSync(path.join(tmp, job.id + "-raw.glb"))).toBe(false);
    expect(fs.existsSync(path.join(tmp, job.id + "-generation.json"))).toBe(
      true,
    );
    expect(service.list()[0].id).toBe(job.id);
  });

  it("reports a rejected key and a failed task clearly", async () => {
    const service = createGenerationService({
      config: () => ({
        blender: "blender",
        generation: { meshy: { key: "bad" } },
      }),
      fetch: (async () =>
        new Response('{"message":"nope"}', { status: 401 })) as typeof fetch,
      pollInterval: 1,
      uploads: tmp,
    });
    const job = service.start({ prompt: "a brass lamp", category: "props" });
    let final = service.get(job.id)!;
    for (let i = 0; i < 100 && final.status !== "failed"; i++) {
      await new Promise((r) => setTimeout(r, 5));
      final = service.get(job.id)!;
    }
    expect(final.status).toBe("failed");
    expect(final.error).toMatch(/key was rejected/);
  });

  it("cancels a running job", async () => {
    const service = createGenerationService({
      config: () => ({
        blender: "blender",
        generation: { meshy: { key: "k" } },
      }),
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST")
          return new Response(JSON.stringify({ result: "t" }), { status: 200 });
        return new Response(
          JSON.stringify({ id: "t", status: "IN_PROGRESS", progress: 10 }),
          {
            status: 200,
          },
        );
      }) as typeof fetch,
      pollInterval: 20,
      uploads: tmp,
    });
    const job = service.start({ prompt: "a brass lamp", category: "props" });
    await new Promise((r) => setTimeout(r, 15));
    expect(service.cancel(job.id)).toBe(true);
    let final = service.get(job.id)!;
    for (let i = 0; i < 100 && final.status !== "cancelled"; i++) {
      await new Promise((r) => setTimeout(r, 5));
      final = service.get(job.id)!;
    }
    expect(final.status).toBe("cancelled");
  });
});

describe("mixamo round trip", () => {
  it("offers only new, settled FBX downloads and imports them through Blender", async () => {
    const downloads = path.join(tmp, "Downloads");
    const uploads = path.join(tmp, "uploads");
    fs.mkdirSync(downloads);
    fs.mkdirSync(uploads);
    fs.writeFileSync(path.join(downloads, "old.fbx"), "old");
    let clock = 1_000_000;
    const blender = fakeBlender(
      tmp,
      `set -e
      while [ "$1" != "--" ]; do shift; done; shift
      out="$1"; shift
      [ "$(basename "$1")" = "Idle.fbx" ]
      base64 -d "${tmp}/bundle.glb.b64" > "$out"
      echo 'STATS {"animations":["Idle","Walking"],"bones":20,"meshes":1}'`.replace(
        "${tmp}",
        tmp,
      ),
    );
    fs.writeFileSync(
      path.join(tmp, "bundle.glb.b64"),
      minimalGlb({
        asset: { version: "2.0" },
        accessors: [{ max: [1.5] }, { max: [0.9] }],
        animations: [
          { name: "Idle", samplers: [{ input: 0 }] },
          { name: "Walking", samplers: [{ input: 1 }] },
        ],
      }).toString("base64"),
    );
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads,
      downloads: () => downloads,
      now: () => clock,
    });
    const watch = service.startWatch();
    expect(watch.directory).toBe(downloads);
    expect(service.poll()).toEqual([]);
    const idle = path.join(downloads, "Idle.fbx");
    fs.writeFileSync(idle, "fresh");
    const textures = path.join(downloads, "Idle.fbm");
    fs.mkdirSync(textures);
    fs.writeFileSync(path.join(textures, "skin.png"), "user-owned texture");
    fs.utimesSync(idle, new Date(clock), new Date(clock));
    let files = service.poll();
    expect(files.map((f) => f.name)).toEqual(["Idle.fbx"]);
    expect(files[0].settled).toBe(false);
    clock += 5000;
    files = service.poll();
    expect(files[0].settled).toBe(true);
    expect(files[0].token).toMatch(/^[0-9a-f-]{36}$/);
    const result = await service.importBundle({ files: [files[0].token] });
    expect(result.url).toMatch(/^\/uploads\/[0-9a-f-]+\.glb$/);
    expect(result.name).toBe("Idle");
    expect(result.animations).toEqual([
      { name: "Idle", duration: 1.5 },
      { name: "Walking", duration: 0.9 },
    ]);
    expect(fs.existsSync(path.join(uploads, path.basename(result.url)))).toBe(
      true,
    );
    expect(fs.readFileSync(idle, "utf8")).toBe("fresh");
    expect(fs.readFileSync(path.join(textures, "skin.png"), "utf8")).toBe(
      "user-owned texture",
    );
    expect(
      fs.readdirSync(uploads).some((name) => name.startsWith(".mixamo-")),
    ).toBe(false);
    await expect(
      service.importBundle({ files: ["00000000-0000-0000-0000-000000000000"] }),
    ).rejects.toThrow(/no longer available/);
  });

  it("keeps exact animation names, including numeric prefixes, for clip lookup", async () => {
    const source = path.join(tmp, "00-Idle.fbx");
    fs.writeFileSync(source, "fixture");
    const bundle = path.join(tmp, "source.glb");
    fs.writeFileSync(
      bundle,
      minimalGlb({
        asset: { version: "2.0" },
        accessors: [{ max: [1.25] }],
        animations: [{ name: "00-Idle", samplers: [{ input: 0 }] }],
      }),
    );
    const blender = fakeBlender(
      tmp,
      `set -e
      while [ "$1" != "--" ]; do shift; done; shift
      [ "$(basename "$2")" = "00-Idle.fbx" ]
      cp "${bundle}" "$1"
      echo 'STATS {"animations":["00-Idle"],"bones":20,"meshes":1}'`,
    );
    const service = createMixamoService({
      config: () => ({ blender }),
      uploads: tmp,
    });
    const result = await service.importFiles([source]);
    expect(result.animations).toEqual([{ name: "00-Idle", duration: 1.25 }]);
    expect(result.name).toBe("00-Idle");
    expect(fs.readFileSync(source, "utf8")).toBe("fixture");
  });

  it("rejects unknown model locations for Mixamo preparation", async () => {
    const service = createMixamoService({
      config: () => ({ blender: "blender" }),
      uploads: tmp,
      downloads: () => tmp,
    });
    await expect(service.prepare("https://evil.example/x.glb")).rejects.toThrow(
      /uploaded or library/,
    );
    await expect(
      service.prepare("/uploads/../../etc/passwd.glb"),
    ).rejects.toThrow();
  });
});
