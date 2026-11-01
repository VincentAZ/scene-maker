import { expect, it } from "vitest";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import JSZip from "jszip";
import {
  capturedMotions,
  capturedMotionSources,
} from "../shared/motionLibrary";
import catalogue from "../shared/captured-motion-catalogue.json";
import {
  allAssets,
  allMotions,
  starterScene,
  validateScene,
  type Asset,
} from "../shared/scene";
import { actionPreview } from "../shared/actionPreview";
import {
  prepareImportedAsset,
  requiredMotionSources,
} from "../src/importedAsset";
import { locomotionProfile } from "../src/locomotion";
import { productionPackage } from "../src/productionPackage";
import {
  emptyStudioLibrary,
  studioLibraryCommands,
} from "../shared/studioLibrary";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";

async function load(asset: Asset) {
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return { bytes, gltf, group: prepareImportedAsset(asset, gltf) };
}
it.each(capturedMotions)(
  "loads and previews $name from the shipped original capture",
  async (motion) => {
    const scene = starterScene();
    const source = capturedMotionSources.find(
      (a) => a.id === motion.sourceAssetId,
    )!;
    expect(allAssets(scene).some((a) => a.id === source.id)).toBe(false);
    expect(allMotions(scene)).toContain(motion);
    expect(
      studioLibraryCommands(scene, emptyStudioLibrary(), {
        motionIds: [motion.id],
      }),
    ).toEqual([]);
    const original = actionPreview(
      scene,
      motion,
      scene.entities[0].id,
      undefined,
      "original",
    );
    const alias = original.scene.customAssets.find(
      (a) => a.id === original.actor.assetId,
    )!;
    expect(alias.rigMapping).toEqual(source.rigMapping);
    expect(requiredMotionSources(original.scene, original.actor)).toEqual([]);
    const { bytes, gltf, group } = await load(alias);
    const entry = catalogue.find((c) => c.trial === motion.animationName)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      entry.sha256[`${entry.trial}.glb` as keyof typeof entry.sha256],
    );
    expect(gltf.animations[0].duration).toBeCloseTo(motion.duration, 5);
    expect(
      gltf.animations[0].tracks.some((t) => /fingers|thumb/.test(t.name)),
    ).toBe(false);
    expect(group.userData.bones.leftHand.name).toBe("lhand");
    expect(group.userData.bones.rightHand.name).toBe("rhand");
    for (const time of [0.17, motion.duration * 0.6, motion.duration, 0.17]) {
      applyAnimatedEntityPose(group, original.actor, original.scene, time);
      expect(group.userData.motionWarning || "").toBe("");
      expect(group.userData.mixer.time).toBeCloseTo(time, 5);
    }
    disposeObject(group);
    scene.customAssets.push(source);
    expect(() => validateScene(scene)).toThrow("Duplicate IDs");
  },
);
it("packages referenced capture files and their terms without changing the cast", async () => {
  const scene = starterScene();
  scene.entities[0].clips = capturedMotions.map((m) => ({
    id: m.id,
    motionId: m.id,
    duration: m.duration,
    playbackRate: 1,
  }));
  const read: typeof fetch = async (input) =>
    new Response(
      await fs.readFile(
        String(input).startsWith("/library/") ? "public" + input : "." + input,
      ),
    );
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, new ArrayBuffer(0), read),
  );
  for (const source of capturedMotionSources) {
    const packaged = await zip
      .file("assets/actions/cmu/" + source.url!.split("/").pop())!
      .async("uint8array");
    const original = await fs.readFile("public" + source.url);
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    expect(hash(packaged)).toBe(hash(original));
  }
  expect(
    await zip.file("assets/actions/cmu/LICENSE.txt")!.async("string"),
  ).toContain("must not be resold");
  expect(zip.file("assets/actions/quaternius-actions.glb")).toBeNull();
  expect(
    JSON.parse(await zip.file("scene.json")!.async("string")).entities,
  ).toEqual(scene.entities);
  await expect(
    productionPackage(scene, new ArrayBuffer(0), async (input, options) =>
      String(input).endsWith("cmu/LICENSE.txt")
        ? new Response("", { status: 404 })
        : read(input, options),
    ),
  ).rejects.toThrow("capture terms");
});

it("finds grounded stance in the shipped captured stride without altering the source take", async () => {
  const { group, gltf } = await load(capturedMotionSources[0]);
  const clip = gltf.animations[0];
  const before = clip.tracks.map((t) => Array.from(t.values));
  const profile = locomotionProfile(group, clip, { start: 0.4, end: 1.525 })!;
  expect(new Set(profile.contacts!.map((c) => c.side))).toEqual(
    new Set(["left", "right"]),
  );
  expect(profile.contacts!.every((c) => c.end > c.start)).toBe(true);
  expect(clip.tracks.map((t) => Array.from(t.values))).toEqual(before);
  disposeObject(group);
});
