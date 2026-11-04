import { it, expect } from "vitest";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { furnitureAssets, furnitureEntries } from "../shared/furnitureLibrary";
import { setLayouts, setAssets } from "../shared/setLayouts";
import {
  allAssets,
  applyCommands,
  assetSchema,
  retiredAssetIds,
  starterScene,
  validateScene,
} from "../shared/scene";
import { offlineCommands } from "../server/ai";
import { prepareImportedAsset } from "../src/importedAsset";
import { disposeObject } from "../src/world";
import { productionPackage } from "../src/productionPackage";
import sources from "../docs/furniture-sources.json";

it("loads every shipped furniture model at metre scale, grounded and centered, with embedded dependencies and a preview", async () => {
  expect(furnitureAssets).toHaveLength(93);
  expect(new Set(furnitureAssets.map((a) => a.id)).size).toBe(93);
  for (const asset of furnitureAssets) {
    expect(assetSchema.parse(asset)).toEqual(asset);
    const bytes = await fs.readFile("public" + asset.url);
    const json = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
    );
    expect(json.buffers.every((buffer: { uri?: string }) => !buffer.uri)).toBe(
      true,
    );
    expect(json.images || []).toHaveLength(0);
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const group = prepareImportedAsset(asset, gltf);
    const bounds = new T.Box3().setFromObject(group),
      size = bounds.getSize(new T.Vector3());
    const entry = furnitureEntries.find((a) => a.id === asset.id)!;
    const source = sources.models.find((a) => a.source === entry.source)!;
    for (const [i, value] of size.toArray().entries())
      expect(value, asset.name).toBeCloseTo(source.dimensions_m[i], 4);
    expect(bounds.min.y, asset.name).toBeCloseTo(0, 5);
    expect(bounds.getCenter(new T.Vector3()).x, asset.name).toBeCloseTo(0, 5);
    expect(bounds.getCenter(new T.Vector3()).z, asset.name).toBeCloseTo(0, 5);
    group.traverse((object) =>
      expect(
        object.matrixWorld.elements.every(Number.isFinite),
        asset.name,
      ).toBe(true),
    );
    const png = await fs.readFile("public" + entry.thumbnail);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    disposeObject(group);
  }
  for (const layout of setLayouts)
    expect(
      (await fs.readFile(`public/library/sets/${layout.id}.png`))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
});

it("offers no retired furniture or furnished set to the offline assistant, and resolves overlapping import names", () => {
  const scene = starterScene();
  for (const asset of [...furnitureAssets, ...setAssets]) {
    expect(retiredAssetIds.has(asset.id), asset.name).toBe(true);
    expect(
      offlineCommands(scene, `Add ${asset.name}`).commands,
      asset.name,
    ).toEqual([]);
  }
  for (const asset of setAssets)
    expect(
      offlineCommands(scene, `Switch to ${asset.name}`).commands,
      asset.name,
    ).toEqual([]);
  // The longest matching name among the creator's imports wins.
  const prop = (id: string, name: string) =>
    assetSchema.parse({
      id,
      name,
      category: "props",
      style: "Imported",
      color: "#8a6f52",
      url: `/uploads/${id}.glb`,
    });
  scene.customAssets.push(
    prop("imported-chair", "Chair"),
    prop("imported-desk-chair", "Desk chair"),
  );
  expect(offlineCommands(scene, "Add Desk chair").commands).toEqual([
    { type: "add", assetId: "imported-desk-chair" },
  ]);
  expect(offlineCommands(scene, "Add Chair").commands).toEqual([
    { type: "add", assetId: "imported-chair" },
  ]);
  for (const url of [
    "/library/furniture/missing.glb",
    "/library/furniture/../desk.glb",
    "https://example.com/desk.glb",
  ])
    expect(assetSchema.safeParse({ ...furnitureAssets[0], url }).success).toBe(
      false,
    );
});

it("replaces only set dressing, retaining cast, personal props, edits, and explicitly kept furniture", () => {
  const original = starterScene();
  let scene = applyCommands(original, [
    { type: "add", assetId: "set-living-room" },
  ]);
  const sofa = scene.entities.find(
    (e) => e.assetId === "furniture-lounge-sofa",
  )!;
  const deleted = scene.entities.find((e) => e.assetId === "furniture-books")!;
  const keep = offlineCommands(
    scene,
    "Keep Two-seat sofa when switching sets",
  ).commands;
  scene = applyCommands(scene, [
    ...keep,
    { type: "update", id: sofa.id, changes: { position: [3, 0, 1] } },
    {
      type: "chain",
      id: original.entities[0].id,
      motionId: "pick",
      targetId: deleted.id,
    },
  ]);
  scene = applyCommands(scene, [{ type: "add", assetId: "set-kitchen" }]);
  expect(scene.entities.filter((e) => e.setDressing)).toHaveLength(13);
  expect(scene.entities.find((e) => e.id === sofa.id)?.position).toEqual([
    3, 0, 1,
  ]);
  expect(scene.entities.find((e) => e.id === deleted.id)).toBeUndefined();
  expect(
    scene.entities.find((e) => e.id === original.entities[0].id)?.clips.at(-1)
      ?.targetId,
  ).toBeUndefined();
  for (const entity of original.entities)
    expect(scene.entities.some((e) => e.id === entity.id)).toBe(true);
  expect(validateScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
  expect(original.entities.some((e) => e.setDressing)).toBe(false);
  const repeated = applyCommands(scene, [
    { type: "add", assetId: "set-kitchen" },
  ]);
  expect(repeated.entities.length).toBe(scene.entities.length);
  const empty = applyCommands(repeated, [{ type: "add", assetId: "room" }]);
  expect(empty.entities.filter((e) => e.setDressing)).toHaveLength(0);
  expect(empty.entities.some((e) => e.id === sofa.id)).toBe(true);
});

it("rejects over-capacity set changes atomically", () => {
  let scene = applyCommands(starterScene(), [{ type: "clear" }]);
  scene = applyCommands(
    scene,
    Array.from({ length: 95 }, () => ({ type: "add", assetId: "cup" })),
  );
  const snapshot = JSON.stringify(scene);
  expect(() =>
    applyCommands(scene, [{ type: "add", assetId: "set-workspace" }]),
  ).toThrow();
  expect(JSON.stringify(scene)).toBe(snapshot);
});

it("packages the exact used furniture files and original license, failing if any dependency is missing", async () => {
  const scene = applyCommands(starterScene(), [
    { type: "add", assetId: "set-workspace" },
  ]);
  const read: typeof fetch = async (input) =>
    new Response(
      await fs.readFile(
        String(input).startsWith("/library/") ? "public" + input : "." + input,
      ),
    );
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, new ArrayBuffer(0), read),
  );
  const used = new Set(scene.entities.map((e) => e.assetId));
  const expected = allAssets(scene).filter(
    (a) => used.has(a.id) && a.url?.startsWith("/library/furniture/"),
  );
  expect(
    Object.keys(zip.files).filter(
      (p) => p.startsWith("assets/furniture/") && p.endsWith(".glb"),
    ),
  ).toHaveLength(expected.length);
  const hash = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  for (const asset of expected)
    expect(
      hash(
        await zip
          .file("assets/furniture/" + asset.url!.split("/").pop())!
          .async("uint8array"),
      ),
    ).toBe(hash(await fs.readFile("public" + asset.url)));
  expect(await zip.file("assets/furniture/LICENSE.txt")!.async("string")).toBe(
    await fs.readFile("public/library/furniture/LICENSE.txt", "utf8"),
  );
  const missing: typeof fetch = async (input, options) =>
    String(input).endsWith("desk.glb")
      ? new Response("Missing", { status: 404 })
      : read(input, options);
  await expect(
    productionPackage(scene, new ArrayBuffer(0), missing),
  ).rejects.toThrow("Writing desk");
});
