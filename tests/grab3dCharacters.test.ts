import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  applyCommands,
  assetSchema,
  boneNames,
  starterScene,
  type Asset,
} from "../shared/scene";
import { contentAssets, contentCredits } from "../shared/contentLibrary";
import characters from "../shared/content/characters.json";
import { cast, imageSize } from "../scripts/content/characters/grab3d.mjs";
import { snapshotCollider } from "../src/collision";
import { prepareImportedAsset } from "../src/importedAsset";
import { humanoidWarning } from "../src/rig";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import { recordedSources, withRecordedSources } from "./recordedSources";

const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const file = (url: string) => path.join(content, url.slice("/content/".length));
const entries = characters.filter((c) => c.id.startsWith("grab3d-"));
// The files are built by `node scripts/build-grab3d.mjs`.
const built =
  entries.length > 0 && entries.every((c) => fs.existsSync(file(c.url)));
const assets = contentAssets.filter((a) => a.id.startsWith("grab3d-"));
const metal = new Set(
  (cast as { slug: string; metal?: boolean }[])
    .filter((c) => c.metal)
    .map((c) => `grab3d-${c.slug}`),
);

function readGlb(url: string) {
  const data = fs.readFileSync(file(url));
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(data.readUInt32LE(8)).toBe(data.byteLength);
  const length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  const binary = data.subarray(20 + length + 8);
  return { data, json, binary };
}

const triangles = (json: {
  meshes: {
    primitives: { indices?: number; attributes: { POSITION: number } }[];
  }[];
  accessors: { count: number }[];
}) =>
  json.meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (n, p) =>
          n + json.accessors[p.indices ?? p.attributes.POSITION].count / 3,
        0,
      ),
    0,
  );

/** World position of every named node in the file's rest pose. */
function jointPositions(json: {
  nodes: {
    name?: string;
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    children?: number[];
  }[];
}) {
  const local = json.nodes.map((node) =>
    node.matrix
      ? new T.Matrix4().fromArray(node.matrix)
      : new T.Matrix4().compose(
          new T.Vector3(...(node.translation ?? [0, 0, 0])),
          new T.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
          new T.Vector3(...(node.scale ?? [1, 1, 1])),
        ),
  );
  const parent = json.nodes.map(() => -1);
  json.nodes.forEach((node, i) =>
    node.children?.forEach((child) => (parent[child] = i)),
  );
  const global: T.Matrix4[] = [];
  const of = (i: number): T.Matrix4 =>
    (global[i] ??=
      parent[i] < 0
        ? local[i].clone()
        : of(parent[i]).clone().multiply(local[i]));
  return new Map(
    json.nodes.map((node, i) => [
      node.name,
      new T.Vector3().setFromMatrixPosition(of(i)),
    ]),
  );
}

/** The same GLB without its images: Node has no image decoder, and the rig
 * checks need only geometry, skin and bones. */
function withoutTextures(data: Buffer) {
  const length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  for (const material of json.materials ?? []) {
    for (const part of [material, material.pbrMetallicRoughness ?? {}])
      for (const key of Object.keys(part))
        if (key.endsWith("Texture")) delete part[key];
  }
  delete json.images;
  delete json.textures;
  delete json.samplers;
  let text = Buffer.from(JSON.stringify(json));
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const rest = data.subarray(20 + length);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.write("JSON", 16, "ascii");
  const glb = Buffer.concat([header, text, rest]);
  return glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength);
}

describe("Grab3D character catalogue", () => {
  it("lists CC0 humans with credits, bodies and collections", () => {
    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(entries.map((c) => c.id)).size).toBe(entries.length);
    for (const asset of assets) {
      expect(assetSchema.parse(asset), asset.id).toEqual(asset);
      expect(asset.id).toMatch(/^grab3d-[a-z0-9-]+$/);
      expect(asset.url).toBe(`/content/characters/${asset.id}.glb`);
      expect(asset.thumbnail).toBe(`/content/characters/${asset.id}.png`);
      expect(["feminine", "masculine"]).toContain(asset.body);
      expect(asset.description.length).toBeGreaterThan(10);
      expect([
        "Everyday",
        "Service",
        "Uniformed",
        "Historical",
        "Fantasy",
        "Sci-fi",
      ]).toContain(asset.style);
      expect(contentCredits.get(asset.id)).toEqual({
        author: "Alexander Popov (Grab3D), AI-assisted",
        license: "CC0",
        source: `https://grab3d.com/models/characters/${asset.id.slice("grab3d-".length)}/`,
      });
    }
  });
});

describe.skipIf(!built)("built Grab3D characters", () => {
  it("are compact, self-contained GLBs with one skin and textured materials", () => {
    for (const asset of assets) {
      const { data, json, binary } = readGlb(asset.url!);
      expect(data.byteLength, asset.id).toBeLessThan(12 * 1024 * 1024);
      for (const entry of [...json.buffers, ...(json.images ?? [])])
        expect(entry.uri, asset.id).toBeUndefined();
      expect(json.skins?.length, asset.id).toBe(1);
      expect(json.animations, asset.id).toBeUndefined();
      expect(triangles(json), asset.id).toBeLessThanOrEqual(120_000);
      for (const material of json.materials) {
        const pbr = material.pbrMetallicRoughness;
        expect(
          pbr.baseColorTexture,
          `${asset.id} ${material.name}`,
        ).toBeDefined();
        // Skin and cloth are dielectric; an outfit with metal keeps its mask.
        if (!metal.has(asset.id))
          expect(pbr.metallicFactor, `${asset.id} ${material.name}`).toBe(0);
        expect(
          material.alphaMode,
          `${asset.id} ${material.name}`,
        ).toBeUndefined();
      }
      for (const image of json.images) {
        expect(["image/jpeg", "image/png"]).toContain(image.mimeType);
        const view = json.bufferViews[image.bufferView];
        const size = imageSize(
          binary.subarray(
            view.byteOffset ?? 0,
            (view.byteOffset ?? 0) + view.byteLength,
          ),
        );
        expect(Math.max(size.width, size.height), asset.id).toBeLessThanOrEqual(
          2048,
        );
      }
      // The spine is named the Mixamo way, counting up from the hips.
      const names = new Set(json.nodes.map((n: { name?: string }) => n.name));
      for (const bone of ["Hips", "Spine", "Spine1", "Spine2", "Head"])
        expect(names.has(bone), `${asset.id} ${bone}`).toBe(true);
      // The rest pose stands on straight, vertical legs: the studio grounds a
      // character by this pose, so Meshy's bent, splayed stance would sink the
      // feet once a recording straightens the legs.
      const joints = jointPositions(json);
      for (const side of ["Left", "Right"]) {
        const [hip, knee, ankle] = ["UpLeg", "Leg", "Foot"].map((bone) =>
          joints.get(side + bone)!,
        );
        const thigh = knee.clone().sub(hip);
        const shin = ankle.clone().sub(knee);
        expect(
          T.MathUtils.radToDeg(thigh.angleTo(new T.Vector3(0, -1, 0))),
          `${asset.id} ${side} thigh`,
        ).toBeLessThan(0.5);
        expect(
          T.MathUtils.radToDeg(shin.angleTo(thigh)),
          `${asset.id} ${side} knee`,
        ).toBeLessThan(0.5);
      }
      const png = fs.readFileSync(file(asset.thumbnail!));
      expect(png.subarray(1, 4).toString(), asset.id).toBe("PNG");
    }
  });

  it(
    "carry a recognised humanoid rig, stand on the floor and take studio actions",
    { timeout: 300_000 },
    async () => {
      const sources = await recordedSources();
      for (const asset of assets) {
        const { data } = readGlb(asset.url!);
        const gltf = await new GLTFLoader().parseAsync(
          withoutTextures(data),
          "",
        );
        const group = withRecordedSources(
          prepareImportedAsset(asset as Asset, gltf),
          sources,
        );
        expect(humanoidWarning(group, asset.name, false), asset.id).toBe("");
        const bones = group.userData.bones as Record<string, T.Bone>;
        for (const name of boneNames)
          expect(bones[name], `${asset.id} ${name}`).toBeInstanceOf(T.Bone);
        let skinned = false;
        group.traverse((o) => (skinned ||= (o as T.SkinnedMesh).isSkinnedMesh));
        expect(skinned, asset.id).toBe(true);
        group.updateMatrixWorld(true);
        const rest = new T.Box3().setFromObject(group);
        const height = rest.max.y - rest.min.y;
        expect(height, asset.id).toBeGreaterThan(1.5);
        expect(height, asset.id).toBeLessThan(2.05);
        expect(Math.abs(rest.min.y), asset.id).toBeLessThan(0.05);

        const scene = applyCommands(starterScene(), [
          { type: "clear" },
          { type: "add", assetId: asset.id, position: [0, 0, 0] },
        ]);
        const entity = scene.entities[0];
        expect(entity, asset.id).toBeDefined();
        // Standing idle, the lowest skinned vertex stays above the studio's
        // collision floor (4 cm below the stage): a character that reached
        // it would be flagged as overlapping the backdrop the moment it is
        // placed.
        applyAnimatedEntityPose(group, entity, scene, 0);
        group.updateMatrixWorld(true);
        expect(
          snapshotCollider(group).bounds.min.y,
          `${asset.id} idle`,
        ).toBeGreaterThan(-0.03);
        entity.clips = [
          { id: "walk", motionId: "walk", duration: 3, playbackRate: 1 },
          { id: "wave", motionId: "wave", duration: 2, transition: "smooth" },
          { id: "bow", motionId: "bow", duration: 2, transition: "smooth" },
        ];
        for (const time of [0.5, 1.5, 3.8, 5.6]) {
          applyAnimatedEntityPose(group, entity, scene, time);
          group.updateMatrixWorld(true);
          group.traverse((o) =>
            expect(
              o.matrixWorld.elements.every(Number.isFinite),
              asset.id,
            ).toBe(true),
          );
          // The body stays on the floor within a few centimetres while
          // acting. Meshy places the ankle joints a little up the shin, so the
          // lowest point of the mesh is the floor contact, not the joint.
          const lowest = new T.Box3().setFromObject(group).min.y;
          expect(Math.abs(lowest), `${asset.id} ${time}`).toBeLessThan(0.08);
          const feet = ["leftFoot", "rightFoot"].map(
            (n) => bones[n].getWorldPosition(new T.Vector3()).y,
          );
          expect(Math.min(...feet), `${asset.id} ${time}`).toBeLessThan(0.3);
          expect(Math.min(...feet), `${asset.id} ${time}`).toBeGreaterThan(
            -0.05,
          );
        }
        disposeObject(group);
      }
    },
  );
});
