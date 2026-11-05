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
import { mergeCatalogue } from "../scripts/content/characters.mjs";
import {
  cast,
  idOf,
  idPrefix,
} from "../scripts/content/characters/rocketbox.mjs";
import { prepareImportedAsset } from "../src/importedAsset";
import { humanoidWarning } from "../src/rig";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import { recordedSources, withRecordedSources } from "./recordedSources";

const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const file = (url: string) => path.join(content, url.slice("/content/".length));
// The files are downloaded by `node scripts/build-content.mjs characters`.
// Other sources (Grab3D) have their own tests.
const entries = characters.filter((c) => c.id.startsWith("rocketbox-"));
const built =
  entries.length > 0 && entries.every((c) => fs.existsSync(file(c.url)));
const assets = contentAssets.filter(
  (a) => a.category === "characters" && a.id.startsWith("rocketbox-"),
);

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

describe("realistic character catalogue", () => {
  it("lists realistic humans with credits, bodies and collections", () => {
    expect(characters.length).toBeGreaterThanOrEqual(115);
    expect(new Set(characters.map((c) => c.id)).size).toBe(characters.length);
    for (const asset of assets) {
      expect(assetSchema.parse(asset), asset.id).toEqual(asset);
      expect(asset.id).toMatch(/^[a-z0-9]+-[a-z0-9-]+$/);
      expect(asset.url).toBe(`/content/characters/${asset.id}.glb`);
      expect(asset.thumbnail).toBe(`/content/characters/${asset.id}.png`);
      expect(["feminine", "masculine"]).toContain(asset.body);
      expect(asset.description.length).toBeGreaterThan(10);
      expect(contentCredits.get(asset.id)?.license, asset.id).toMatch(
        /^(MIT|CC0|CC BY( 4\.0)?|CC BY-SA( 4\.0)?)/,
      );
    }
    const styles = new Set(assets.map((a) => a.style));
    for (const style of [
      "Everyday",
      "Business",
      "Medical",
      "Service",
      "Uniformed",
      "Emergency",
      "Military",
      "Sports",
      "Children",
    ])
      expect(styles).toContain(style);
  });

  it("ships the whole Rocketbox cast under MIT with ids that cannot collide", () => {
    const rocketbox = characters.filter((c) => c.id.startsWith("rocketbox-"));
    expect(cast).toHaveLength(115);
    expect(new Set(cast.map((a) => a.folder)).size).toBe(115);
    expect(rocketbox.map((c) => c.id)).toEqual(cast.map(idOf));
    for (const [i, entry] of rocketbox.entries()) {
      expect(entry.credit).toEqual({
        author: "Microsoft",
        license: "MIT",
        source: expect.stringContaining(`/Assets/Avatars/${cast[i].folder}`),
      });
      expect(entry.style).toBe(cast[i].style);
      // Each person keeps the height their file was made at, hats included:
      // children about 1.4 m, adults 1.7 to 1.9 m.
      if (entry.style === "Children") {
        expect(entry.height, entry.id).toBeGreaterThan(1.3);
        expect(entry.height, entry.id).toBeLessThan(1.55);
      } else {
        expect(entry.height, entry.id).toBeGreaterThan(1.65);
        expect(entry.height, entry.id).toBeLessThan(1.95);
      }
    }
    // Upstream files Female_Party_01/02 under both Adults and Professions:
    // the Adults pair keep the plain ids the library shipped with, a twin
    // elsewhere carries its folder.
    expect(idOf({ folder: "Adults/Female_Party_02" })).toBe(
      "rocketbox-female-party-02",
    );
    expect(idOf({ folder: "Professions/Female_Party_02" })).toBe(
      "rocketbox-professions-female-party-02",
    );
    expect(idOf({ folder: "Professions/Police_Male_01" })).toBe(
      "rocketbox-police-male-01",
    );
  });

  it("rebuilds one source without touching the others or keeping what it dropped", () => {
    expect(cast.every((a) => idOf(a).startsWith(idPrefix))).toBe(true);
    const entry = (id: string, name = id) => ({ id, name });
    const current = [
      entry("rocketbox-a"),
      entry("rocketbox-removed"),
      entry("grab3d-soldier"),
      entry("rocketbox-b"),
    ];
    const built = [
      entry("rocketbox-a", "A renamed"),
      entry("rocketbox-b"),
      entry("rocketbox-new"),
    ];
    // Rebuilt entries stay in place, new ones follow, the removed one goes,
    // and another source's entry is kept.
    expect(mergeCatalogue({ current, built, owned: [idPrefix] })).toEqual([
      entry("rocketbox-a", "A renamed"),
      entry("grab3d-soldier"),
      entry("rocketbox-b"),
      entry("rocketbox-new"),
    ]);
    // A source that declares no prefix cannot tell what it dropped.
    expect(
      mergeCatalogue({ current, built, owned: [] }).map((e) => e.id),
    ).toContain("rocketbox-removed");
  });
});

describe.skipIf(!built)("built realistic characters", () => {
  it("are self-contained GLBs with dielectric, textured materials", () => {
    let total = 0;
    for (const asset of assets) {
      const { data, json } = readGlb(asset.url!);
      total += data.byteLength;
      expect(data.byteLength, asset.id).toBeLessThan(12 * 1024 * 1024);
      for (const entry of [...json.buffers, ...(json.images ?? [])])
        expect(entry.uri, asset.id).toBeUndefined();
      expect(json.skins?.length, asset.id).toBe(1);
      expect(json.animations, asset.id).toBeUndefined();
      for (const material of json.materials) {
        const pbr = material.pbrMetallicRoughness;
        expect(pbr.metallicFactor, `${asset.id} ${material.name}`).toBe(0);
        expect(
          pbr.baseColorTexture,
          `${asset.id} ${material.name}`,
        ).toBeDefined();
        // Hair and lashes are alpha-tested; only glasses may blend.
        if (/opacity/i.test(material.name))
          expect(material.alphaMode).toBe("MASK");
        else if (!/glasses/i.test(material.name))
          expect(
            material.alphaMode,
            `${asset.id} ${material.name}`,
          ).toBeUndefined();
      }
      for (const image of json.images)
        expect(["image/jpeg", "image/png"]).toContain(image.mimeType);
      const png = fs.readFileSync(file(asset.thumbnail!));
      expect(png.subarray(1, 4).toString(), asset.id).toBe("PNG");
    }
    expect(total).toBeLessThan(assets.length * 10 * 1024 * 1024);
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
        // Shown at the recorded height (1.85 m without one), so a child is
        // not stretched to an adult's size.
        expect(height, asset.id).toBeCloseTo(asset.height ?? 1.85, 2);
        const child = asset.style === "Children";
        expect(height, asset.id).toBeGreaterThan(child ? 1.1 : 1.5);
        expect(height, asset.id).toBeLessThan(child ? 1.6 : 2.05);
        expect(Math.abs(rest.min.y), asset.id).toBeLessThan(0.05);

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
          // Feet stay on the floor within a few centimetres while acting.
          const feet = ["leftFoot", "rightFoot"].map(
            (n) => bones[n].getWorldPosition(new T.Vector3()).y,
          );
          expect(Math.min(...feet), `${asset.id} ${time}`).toBeLessThan(0.2);
          expect(Math.min(...feet), `${asset.id} ${time}`).toBeGreaterThan(
            -0.05,
          );
        }
        disposeObject(group);
      }
    },
  );
});
