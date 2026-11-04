import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { assetSchema } from "../shared/scene";
import { contentAssets, contentCredits } from "../shared/contentLibrary";
import { seatProfile } from "../shared/seating";
import { ladderProfile } from "../shared/ladder";
import props from "../shared/content/props.json";

const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const file = (url: string) => path.join(content, url.slice("/content/".length));
// The files are downloaded by `node scripts/build-content.mjs props`.
const built = props.length > 0 && props.every((p) => fs.existsSync(file(p.url)));

type Gltf = {
  buffers: { uri?: string; byteLength: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  accessors: { min?: number[]; max?: number[] }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  nodes: {
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  scenes: { nodes: number[] }[];
  scene?: number;
};

function readGlb(url: string) {
  const data = fs.readFileSync(file(url));
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  const length = data.readUInt32LE(12);
  expect(data.readUInt32LE(16)).toBe(0x4e4f534a); // JSON chunk
  const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8")) as Gltf;
  return { json, bytes: data.byteLength };
}

/** World bounds from each mesh's accessor bounds and its node transforms. */
function bounds(gltf: Gltf) {
  const box = new T.Box3();
  const visit = (index: number, parent: T.Matrix4) => {
    const node = gltf.nodes[index];
    const local = new T.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else
      local.compose(
        new T.Vector3(...((node.translation as [number, number, number]) || [0, 0, 0])),
        new T.Quaternion(...((node.rotation as [number, number, number, number]) || [0, 0, 0, 1])),
        new T.Vector3(...((node.scale as [number, number, number]) || [1, 1, 1])),
      );
    const world = parent.clone().multiply(local);
    if (node.mesh !== undefined)
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        const part = new T.Box3(
          new T.Vector3(...(accessor.min as [number, number, number])),
          new T.Vector3(...(accessor.max as [number, number, number])),
        );
        box.union(part.applyMatrix4(world));
      }
    for (const child of node.children || []) visit(child, world);
  };
  for (const n of gltf.scenes[gltf.scene || 0].nodes) visit(n, new T.Matrix4());
  return box;
}

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
    delete material.extensions;
  }
  delete json.extensionsUsed;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const rest = data.subarray(20 + length);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, text, rest]);
}

const inside = (box: T.Box3, p: number[], margin = 0.005) =>
  box.clone().expandByScalar(margin).containsPoint(new T.Vector3(...p));

describe("realistic props catalogue", () => {
  it("has a few dozen valid, credited props", () => {
    expect(props.length).toBeGreaterThanOrEqual(40);
    const ids = new Set<string>();
    for (const entry of props) {
      const { credit, ...asset } = entry as typeof entry & {
        credit: { author: string; license: string; source: string };
      };
      const parsed = assetSchema.parse({ color: "#9aa58f", ...asset });
      expect(parsed.category).toBe("props");
      expect(parsed.url).toMatch(/^\/content\/props\/[a-z0-9-]+\.glb$/);
      expect(parsed.thumbnail).toMatch(/^\/content\/props\/[a-z0-9-]+\.png$/);
      expect(credit.license).toBe("CC0");
      expect(credit.author.length).toBeGreaterThan(0);
      expect(credit.source).toMatch(/^https:\/\/polyhaven\.com\/a\//);
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(contentCredits.get(entry.id)).toEqual(credit);
      expect(contentAssets.some((a) => a.id === entry.id)).toBe(true);
    }
  });

  it("gives every seat, drink and ladder its interaction metadata", () => {
    const byId = new Map(contentAssets.map((a) => [a.id, a]));
    const seats = props.filter((p) => p.style === "Seating");
    expect(seats.length).toBeGreaterThanOrEqual(10);
    for (const p of seats) {
      const profile = seatProfile(byId.get(p.id)!)!;
      expect(profile, p.id).toBeDefined();
      // Real furniture: a sitting surface between a low stool and a bar stool.
      expect(profile.position[1], p.id).toBeGreaterThan(0.3);
      expect(profile.position[1], p.id).toBeLessThan(0.7);
      expect(profile.width, p.id).toBeGreaterThanOrEqual(0.28);
    }
    const drinks = props.filter((p) => "mouth" in p);
    expect(drinks.map((p) => p.id)).toContain("ph-tea-cup");
    for (const p of drinks) expect("grip" in p, p.id).toBe(true);
    const ladder = props.find((p) => "ladder" in p);
    expect(ladder).toBeDefined();
    const profile = ladderProfile(byId.get(ladder!.id)!)!;
    // The app needs a ladder at least 1.35 m tall and 0.3 m wide.
    expect(profile.height).toBeGreaterThanOrEqual(1.35);
    expect(profile.width).toBeGreaterThanOrEqual(0.3);
  });

  it.skipIf(!built)("puts each seat on the actual sitting surface", async () => {
    for (const entry of props) {
      if (!("seat" in entry) || !entry.seat) continue;
      const data = withoutTextures(fs.readFileSync(file(entry.url)));
      const object = (
        await new GLTFLoader().parseAsync(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
          "",
        )
      ).scene;
      object.updateMatrixWorld(true);
      const [x, y, z] = entry.seat.position;
      const surface = (dx: number) =>
        new T.Raycaster(
          new T.Vector3(x + dx, y + 0.15, z),
          new T.Vector3(0, -1, 0),
        ).intersectObject(object, true)[0]?.point.y ?? -1;
      const centre = surface(0);
      // Nothing above the seat; the surface is right there, or the hips bridge
      // a gap between two cushions that are both at seat height.
      expect(centre, entry.id).toBeLessThan(y + 0.001);
      if (Math.abs(centre - y) > 0.001)
        for (const side of [-0.12, 0.12])
          expect(Math.abs(surface(side) - y), entry.id).toBeLessThan(0.025);
    }
  });

  describe.skipIf(!built)("downloaded files", () => {
    it.each(props.map((p) => [p.id, p] as const))("%s", (_id, entry) => {
      expect(fs.existsSync(file(entry.thumbnail))).toBe(true);
      const thumb = fs.readFileSync(file(entry.thumbnail));
      expect(thumb.subarray(1, 4).toString()).toBe("PNG");
      const { json, bytes } = readGlb(entry.url);
      expect(bytes).toBeLessThan(8 * 1024 * 1024);
      // Self-contained: one embedded buffer, images inside it.
      expect(json.buffers.every((b) => b.uri === undefined)).toBe(true);
      for (const image of json.images || []) {
        expect(image.uri).toBeUndefined();
        expect(image.bufferView).toBeTypeOf("number");
        expect(["image/jpeg", "image/png"]).toContain(image.mimeType);
      }
      const box = bounds(json);
      const size = box.getSize(new T.Vector3());
      // Real-world scale: from an apple to a long table, never toy or building sized.
      expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0.05);
      expect(Math.max(size.x, size.y, size.z)).toBeLessThan(3);
      // Standing on the floor, centred on x/z.
      expect(Math.abs(box.min.y)).toBeLessThan(0.002);
      expect(Math.abs(box.min.x + box.max.x) / 2).toBeLessThan(0.005);
      // A ladder centres its rung plane instead: the climb holds rungs at z≈0.
      expect(Math.abs(box.min.z + box.max.z) / 2).toBeLessThan(
        "ladder" in entry ? 0.05 : 0.005,
      );
      if ("seat" in entry && entry.seat) {
        const { position, width, depth } = entry.seat;
        expect(inside(box, position), "seat").toBe(true);
        expect(width).toBeLessThanOrEqual(size.x + 0.01);
        expect(depth).toBeLessThanOrEqual(size.z + 0.01);
        // The seat sits forward of (or at) the centre: the back is behind it.
        expect(position[2]).toBeGreaterThan(-0.05);
      }
      if ("grip" in entry && entry.grip) {
        expect(inside(box, entry.grip), "grip").toBe(true);
        // Held in the right hand: the grip is on the +X side.
        expect(entry.grip[0]).toBeGreaterThan(0);
      }
      if ("mouth" in entry && entry.mouth) {
        expect(inside(box, entry.mouth), "mouth").toBe(true);
        expect(entry.mouth[1]).toBeCloseTo(size.y, 2);
      }
      if ("ladder" in entry && entry.ladder) {
        expect(entry.ladder.height).toBeCloseTo(size.y, 2);
        expect(entry.ladder.width).toBeLessThanOrEqual(size.x);
      }
    });
  });
});
