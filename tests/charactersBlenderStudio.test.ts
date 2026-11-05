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
import { prepareImportedAsset } from "../src/importedAsset";
import { humanoidWarning } from "../src/rig";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import { recordedSources, withRecordedSources } from "./recordedSources";

const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const file = (url: string) => path.join(content, url.slice("/content/".length));
const entries = characters.filter((c) => c.id.startsWith("blender-"));
// The files are built by scripts/content/characters/merge-blender-studio.mjs.
const built =
  entries.length > 0 && entries.every((c) => fs.existsSync(file(c.url)));
const assets = contentAssets.filter((a) => a.id.startsWith("blender-"));

function readGlb(url: string) {
  const data = fs.readFileSync(file(url));
  expect(data.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
  expect(data.readUInt32LE(8)).toBe(data.byteLength);
  const length = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + length).toString("utf8"));
  return { data, json };
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

/** Every bone below (and including) one of `roots`. */
function underBones(roots: T.Object3D[]) {
  return (bone: T.Object3D) => {
    for (let b: T.Object3D | null = bone; b; b = b.parent)
      if (roots.includes(b)) return true;
    return false;
  };
}

/** World positions of the skinned vertices whose strongest influence is
 * one of `roots` or a bone below it, as the skin deforms them now. */
function carriedBy(group: T.Object3D, roots: T.Object3D[]) {
  const below = underBones(roots);
  const points: T.Vector3[] = [];
  group.traverse((o) => {
    const mesh = o as T.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const carried = mesh.skeleton.bones.map(below);
    const index = mesh.geometry.attributes.skinIndex;
    const weight = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < index.count; i++) {
      let best = 0;
      for (let c = 1; c < index.itemSize; c++)
        if (weight.getComponent(i, c) > weight.getComponent(i, best)) best = c;
      if (!carried[index.getComponent(i, best)]) continue;
      points.push(
        mesh
          .getVertexPosition(i, new T.Vector3())
          .applyMatrix4(mesh.matrixWorld),
      );
    }
  });
  return points;
}

describe("Blender Studio character catalogue", () => {
  it("lists the open-movie characters with their CC BY credit", () => {
    expect(entries.map((c) => c.id)).toEqual(
      expect.arrayContaining(["blender-rain", "blender-snow"]),
    );
    for (const asset of assets) {
      expect(assetSchema.parse(asset), asset.id).toEqual(asset);
      expect(asset.id).toMatch(/^blender-[a-z0-9-]+$/);
      expect(asset.name).toMatch(/^[A-Z][a-z]+$/);
      expect(asset.style).toBe("Blender Studio");
      expect(asset.url).toBe(`/content/characters/${asset.id}.glb`);
      expect(asset.thumbnail).toBe(`/content/characters/${asset.id}.png`);
      expect(["feminine", "masculine"]).toContain(asset.body);
      expect(asset.description.length).toBeGreaterThan(10);
      const credit = contentCredits.get(asset.id)!;
      expect(credit).toMatchObject({
        author: "Blender Studio",
        license: "CC BY 4.0",
      });
      expect(credit.source).toMatch(
        /^https:\/\/studio\.blender\.org\/characters\/[a-z-]+\/v\d+\/$/,
      );
    }
    // The site's credit line follows from the name and the versioned page.
    const line = (id: string) => {
      const asset = assets.find((a) => a.id === id)!;
      const version = contentCredits.get(id)!.source.match(/\/v(\d+)\/$/)![1];
      return `${asset.name} v${version} (CC) Blender Foundation | studio.blender.org`;
    };
    expect(line("blender-rain")).toBe(
      "Rain v3 (CC) Blender Foundation | studio.blender.org",
    );
    expect(line("blender-snow")).toBe(
      "Snow v4 (CC) Blender Foundation | studio.blender.org",
    );
  });
});

describe.skipIf(!built)("built Blender Studio characters", () => {
  it("are self-contained GLBs with dielectric, baked materials", () => {
    for (const asset of assets) {
      const { data, json } = readGlb(asset.url!);
      expect(data.byteLength, asset.id).toBeLessThan(40 * 1024 * 1024);
      for (const entry of [...json.buffers, ...(json.images ?? [])])
        expect(entry.uri, asset.id).toBeUndefined();
      expect(json.skins?.length, asset.id).toBe(1);
      expect(json.animations, asset.id).toBeUndefined();
      expect(json.extensionsUsed ?? [], asset.id).toEqual([]);
      let textured = 0;
      for (const material of json.materials) {
        const pbr = material.pbrMetallicRoughness;
        expect(pbr.metallicFactor, `${asset.id} ${material.name}`).toBe(0);
        expect(material.emissiveTexture, asset.id).toBeUndefined();
        if (pbr.baseColorTexture) textured++;
        // Cut-outs are alpha-tested; nothing blends.
        expect(material.alphaMode, `${asset.id} ${material.name}`).not.toBe(
          "BLEND",
        );
      }
      expect(textured, asset.id).toBeGreaterThan(json.materials.length / 2);
      for (const image of json.images)
        expect(["image/jpeg", "image/png"]).toContain(image.mimeType);
      // The deform skeleton carries Rigify's names, which the studio reads.
      const names = json.skins[0].joints.map((i: number) => json.nodes[i].name);
      for (const name of [
        "DEF-spine",
        "DEF-spine.001",
        "DEF-spine.006",
        "DEF-upper_arm.L",
        "DEF-forearm.R",
        "DEF-hand.L",
        "DEF-thigh.R",
        "DEF-shin.L",
        "DEF-foot.R",
      ])
        expect(names, asset.id).toContain(name);
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
        // Each hand's skin is carried by the hand and its fingers: a finger
        // chain left hanging from the shoulder would stay behind when the
        // arm moves.
        for (const side of ["left", "right"]) {
          const hand = bones[side + "Hand"];
          const wrist = hand.getWorldPosition(new T.Vector3());
          const skin = carriedBy(group, [hand]);
          expect(skin.length, `${asset.id} ${side} hand`).toBeGreaterThan(100);
          const far = skin.filter((p) => p.distanceTo(wrist) > 0.35).length;
          expect(far / skin.length, `${asset.id} ${side} hand`).toBeLessThan(
            0.02,
          );
        }

        const scene = applyCommands(starterScene(), [
          { type: "clear" },
          { type: "add", assetId: asset.id, position: [0, 0, 0] },
        ]);
        const entity = scene.entities[0];
        expect(entity, asset.id).toBeDefined();
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
          // The soles stay on the floor within a few centimetres while
          // acting. (Ankle heights would flag chunky trainers.)
          const sole = Math.min(
            ...carriedBy(group, [bones.leftFoot, bones.rightFoot]).map(
              (p) => p.y,
            ),
          );
          expect(sole, `${asset.id} ${time}`).toBeLessThan(0.06);
          expect(sole, `${asset.id} ${time}`).toBeGreaterThan(-0.05);
        }
        disposeObject(group);
      }
    },
  );
});
