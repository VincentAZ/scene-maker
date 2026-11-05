import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { applyCommands, blankScene, allAssets } from "../shared/scene";
import { seatProfile } from "../shared/seating";
import { contentAssets } from "../shared/contentLibrary";
import { prepareImportedAsset } from "../src/importedAsset";
import { measureSeatSurface } from "../src/seatSurface";
import { disposeObject } from "../src/world";

const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const file = (url: string) => path.join(content, url.slice("/content/".length));
/** The same GLB without its textures: Node has no image decoder. */
function withoutTextures(data: Buffer) {
  const length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  delete json.images;
  delete json.textures;
  delete json.samplers;
  for (const material of json.materials || []) {
    const pbr = material.pbrMetallicRoughness || {};
    delete pbr.baseColorTexture;
    delete pbr.metallicRoughnessTexture;
    delete material.normalTexture;
    delete material.occlusionTexture;
    delete material.emissiveTexture;
  }
  const text = Buffer.from(JSON.stringify(json).padEnd(length, " "));
  return Buffer.concat([
    data.subarray(0, 20),
    text,
    data.subarray(20 + length),
  ]);
}
// Library chairs whose seats the content build measured in Blender.
const chairs = [
  "ph-dining-chair-leather",
  "ph-armchair-upholstered",
  "ph-wooden-stool",
  "ph-sofa-leather",
].map((id) => contentAssets.find((a) => a.id === id)!);
const built = chairs.every((a) => a.url && fs.existsSync(file(a.url)));

it.skipIf(!built)(
  "measures an imported chair's sitting surface where the content build found it",
  async () => {
    for (const asset of chairs) {
      const data = withoutTextures(fs.readFileSync(file(asset.url!)));
      const gltf = await new GLTFLoader().parseAsync(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        "",
      );
      // Measured as a chair the creator imported: no seat metadata yet.
      const { seat: expected, ...imported } = asset;
      const model = prepareImportedAsset(imported, gltf);
      const measured = measureSeatSurface(model);
      disposeObject(model);
      expect(measured, asset.id).toBeDefined();
      expect(measured!.position[1], asset.id).toBeCloseTo(
        expected!.position[1],
        2,
      );
      expect(
        Math.abs(measured!.position[0] - expected!.position[0]),
        asset.id,
      ).toBeLessThan(0.03);
      expect(
        Math.abs(measured!.position[2] - expected!.position[2]),
        asset.id,
      ).toBeLessThan(0.03);
      expect(
        Math.abs(measured!.width - expected!.width),
        asset.id,
      ).toBeLessThan(0.04);
      expect(
        Math.abs(measured!.depth - expected!.depth),
        asset.id,
      ).toBeLessThan(0.04);
    }
  },
);

it("takes no level patch narrower than 20 cm for a seat", () => {
  const slab = (width: number, depth: number) => {
    const model = new T.Group();
    const top = new T.Mesh(new T.BoxGeometry(width, 0.04, depth));
    top.position.y = 0.45;
    model.add(top);
    return model;
  };
  // An armrest or a perch: wide enough in area, too narrow to sit on.
  expect(measureSeatSurface(slab(0.15, 0.4))).toBeUndefined();
  expect(measureSeatSurface(slab(0.4, 0.15))).toBeUndefined();
  const seat = measureSeatSurface(slab(0.4, 0.4));
  expect(seat).toBeDefined();
  expect(seat!.position[1]).toBeCloseTo(0.47, 2);
  expect(seat!.width).toBeGreaterThan(0.36);
  expect(seat!.depth).toBeGreaterThan(0.36);
});

it("stores a measured seat on the creator's own prop only", () => {
  const chair = {
    ...contentAssets.find((a) => a.id === "ph-dining-chair-leather")!,
    id: "my-chair",
    seat: undefined,
  };
  const scene = applyCommands(blankScene(), [
    { type: "createAsset", asset: chair },
    { type: "add", assetId: "my-chair", id: "chair" },
    { type: "add", assetId: "mila", id: "actor", position: [0, 0, 0.6] },
  ]);
  expect(
    seatProfile(allAssets(scene).find((a) => a.id === "my-chair")!),
  ).toBeUndefined();
  expect(() =>
    applyCommands(scene, [
      { type: "chain", id: "actor", motionId: "sit", targetId: "chair" },
    ]),
  ).toThrow("known sitting surface");
  const seat = {
    position: [0, 0.45, 0.1] as [number, number, number],
    width: 0.4,
    depth: 0.4,
  };
  const measured = applyCommands(scene, [
    { type: "setSeat", assetId: "my-chair", seat },
  ]);
  expect(
    seatProfile(allAssets(measured).find((a) => a.id === "my-chair")!),
  ).toEqual(seat);
  expect(() =>
    applyCommands(measured, [
      { type: "chain", id: "actor", motionId: "sit", targetId: "chair" },
    ]),
  ).not.toThrow();
  expect(() =>
    applyCommands(scene, [{ type: "setSeat", assetId: "mila", seat }]),
  ).toThrow("own props");
});
