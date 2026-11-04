import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import {
  applyCommands,
  assetSchema,
  blankScene,
  motionSchema,
  offeredAssets,
  retiredAssetIds,
  starterScene,
  validateScene,
  type Asset,
} from "../shared/scene";
import { queryAssets } from "../src/assetLibrary";
import { contentAssets } from "../shared/contentLibrary";
import { newProject, validatePlan } from "../shared/studio";

const imported = (id: string, category: Asset["category"] = "characters") =>
  assetSchema.parse({
    id,
    name: id,
    category,
    style: "Imported",
    color: "#739480",
    url: `/uploads/${id}.glb`,
  });

describe("retired built-ins", () => {
  it("offers the studio, the realistic library and the creator's imports", () => {
    const s = blankScene();
    s.customAssets.push(imported("own-woman"));
    expect(offeredAssets(s).map((a) => a.id)).toEqual([
      "studio",
      ...contentAssets.map((a) => a.id),
      "own-woman",
    ]);
    for (const id of ["mila", "cup", "chair", "ladder", "cafe", "park"])
      expect(retiredAssetIds.has(id)).toBe(true);
  });
  it("starts new projects on the empty studio stage", () => {
    for (const s of [blankScene(), newProject("Next", "cafe")]) {
      expect(s.entities).toEqual([]);
      expect(s.environment).toBe("studio");
    }
  });
  it("keeps old projects with retired assets and stylized clips playable", () => {
    const s = starterScene();
    s.entities[0].clips = [
      { id: "a", motionId: "authored-victory", duration: 2, playbackRate: 1 },
      { id: "b", motionId: "authored-walk", duration: 2, playbackRate: 1 },
    ];
    const loaded = validateScene(s);
    expect(loaded.entities[0].assetId).toBe("mila");
    expect(loaded.entities[0].clips.map((c) => c.motionId)).toEqual([
      "captured-80-43",
      "walk",
    ]);
  });
  it("rejects assistant plans that add retired or shape-built assets", () => {
    const s = blankScene();
    const plan = (commands: unknown[]) => ({
      response: "Done.",
      steps: [{ type: "edit", commands }],
    });
    const read = () => s;
    expect(() =>
      validatePlan(plan([{ type: "add", assetId: "cup" }]), s, read),
    ).toThrow("retired");
    expect(() =>
      validatePlan(
        plan([{ type: "scene", changes: { environment: "cafe" } }]),
        s,
        read,
      ),
    ).toThrow("retired");
    s.customAssets.push(imported("own-chair", "props"));
    expect(() =>
      validatePlan(plan([{ type: "add", assetId: "own-chair" }]), s, read),
    ).not.toThrow();
  });
});

describe("deleting an import", () => {
  it("removes its actors and the actions recorded on its skeleton", () => {
    let s = blankScene();
    s.customAssets.push(imported("own-woman"), imported("own-man"));
    s.customMotions.push(
      motionSchema.parse({
        id: "own-take",
        name: "Take",
        kind: "imported",
        duration: 2,
        sourceAssetId: "own-woman",
        animationName: "Take",
      }),
    );
    s = applyCommands(s, [
      { type: "add", id: "her", assetId: "own-woman" },
      { type: "add", id: "him", assetId: "own-man" },
      { type: "chain", id: "him", motionId: "own-take" },
    ]);
    const next = applyCommands(s, [
      { type: "deleteAsset", assetId: "own-woman" },
    ]);
    expect(next.customAssets.map((a) => a.id)).toEqual(["own-man"]);
    expect(next.customMotions).toEqual([]);
    expect(next.entities.map((e) => [e.id, e.clips.length])).toEqual([
      ["him", 0],
    ]);
    expect(() =>
      applyCommands(s, [{ type: "deleteAsset", assetId: "studio" }]),
    ).toThrow("Only your own imports");
  });
});

describe("asset panel order", () => {
  const assets = ["Zed", "Amy", "Mo"].map((n) => ({ ...imported(n), name: n }));
  const base = {
    usedOnly: false,
    showHidden: false,
    hidden: new Set<string>(),
    mine: new Set(["Amy", "Mo"]),
    usage: new Map([["Mo", 1]]),
  };
  const ids = (
    q: Partial<typeof base> & { sort: "collection" | "name" | "newest" },
  ) => queryAssets(assets, { ...base, ...q }).map((a) => a.id);
  it("sorts by library order, name, or newest imports first", () => {
    expect(ids({ sort: "collection" })).toEqual(["Zed", "Amy", "Mo"]);
    expect(ids({ sort: "name" })).toEqual(["Amy", "Mo", "Zed"]);
    expect(ids({ sort: "newest" })).toEqual(["Mo", "Amy", "Zed"]);
  });
  it("filters to the scene and hides per browser", () => {
    expect(ids({ sort: "name", usedOnly: true })).toEqual(["Mo"]);
    expect(ids({ sort: "name", hidden: new Set(["Amy"]) })).toEqual([
      "Mo",
      "Zed",
    ]);
    expect(
      ids({ sort: "name", hidden: new Set(["Amy"]), showHidden: true }),
    ).toEqual(["Amy", "Mo", "Zed"]);
  });
});

describe("removing from the shared library", () => {
  let server: Server, base: string, dir: string;
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-library-"));
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
  it("stops offering an import while projects that use it keep it", async () => {
    const s = blankScene();
    s.id = "keeps-it";
    s.customAssets.push(imported("own-woman"));
    fs.writeFileSync(path.join(dir, "uploads", "own-woman.glb"), "glb");
    const headers = {
      "Content-Type": "application/json",
      "X-Scene-Maker": "1",
    };
    await fetch(`${base}/api/projects/${s.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(s),
    });
    const offered = async () =>
      (
        (await (await fetch(`${base}/api/library`)).json()) as {
          assets: Asset[];
        }
      ).assets.map((a) => a.id);
    expect(await offered()).toContain("own-woman");
    const removed = await fetch(`${base}/api/library/remove`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ids: ["own-woman"] }),
    });
    expect(removed.ok).toBe(true);
    expect(await offered()).not.toContain("own-woman");
    const kept = await (await fetch(`${base}/api/projects/${s.id}`)).json();
    expect(kept.customAssets.map((a: Asset) => a.id)).toEqual(["own-woman"]);
  });
});
