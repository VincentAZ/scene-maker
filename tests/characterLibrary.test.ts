import { it, expect } from "vitest";
import fs from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  libraryCharacters,
  libraryEntry,
  characterCollection,
} from "../shared/characterLibrary";
import {
  applyCommands,
  assetSchema,
  starterScene,
  boneNames,
  allAssets,
} from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { humanoidWarning } from "../src/rig";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import { BAKE_SAMPLE_FPS, bakeAnimation } from "../src/bakeAnimation";
import { exportSnapshot } from "../src/exportSnapshot";
import { offlineCommands } from "../server/ai";

async function load(asset: (typeof libraryCharacters)[number]) {
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return prepareImportedAsset(asset, gltf);
}

it("loads and articulates every shipped humanoid using the actual GLB files", async () => {
  expect(libraryCharacters).toHaveLength(32);
  for (const asset of libraryCharacters) {
    expect(assetSchema.parse(asset)).toEqual(asset);
    const group = await load(asset);
    expect(humanoidWarning(group, asset.name, false), asset.name).toBe("");
    const scene = applyCommands(starterScene(), [
      { type: "clear" },
      { type: "add", assetId: asset.id, position: [0, 0, 0] },
    ]);
    const entity = scene.entities[0];
    entity.clips = [
      { id: "walk", motionId: "walk", duration: 4 },
      { id: "wave", motionId: "wave", duration: 2, transition: "smooth" },
    ];
    const bones = group.userData.bones as Record<string, T.Bone>;
    for (const name of boneNames)
      expect(bones[name], asset.name + " " + name).toBeInstanceOf(T.Bone);
    const arm = new T.Quaternion();
    for (const time of [0, 0.8, 3.9, 4.2, 4.8, 6, 0]) {
      applyAnimatedEntityPose(group, entity, scene, time);
      group.updateMatrixWorld(true);
      group.traverse((object) => {
        expect(
          object.matrixWorld.elements.every(Number.isFinite),
          asset.name,
        ).toBe(true);
      });
      if (time === 0.8)
        arm.copy(bones.rightArm.getWorldQuaternion(new T.Quaternion()));
      if (time === 4.8)
        expect(
          arm.angleTo(bones.rightArm.getWorldQuaternion(new T.Quaternion())),
          asset.name,
        ).toBeGreaterThan(0.3);
      if (time === 6) expect(group.position.z, asset.name).toBeCloseTo(2, 4);
    }
    const bounds = new T.Box3().setFromObject(group);
    expect(bounds.max.y - bounds.min.y, asset.name).toBeCloseTo(1.85, 1);
    const png = await fs.readFile("public" + libraryEntry(asset)!.thumbnail);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    disposeObject(group);
  }
});

it("bakes a library performance into a separate rig with matching joint positions", async () => {
  const asset = libraryCharacters.find((a) => a.style === "Doctor")!;
  const group = await load(asset),
    scene = applyCommands(starterScene(), [
      { type: "clear" },
      { type: "add", assetId: asset.id, position: [0, 0, 0] },
    ]);
  const entity = scene.entities[0];
  entity.clips = [
    { id: "walk", motionId: "walk", duration: 2 },
    { id: "wave", motionId: "wave", duration: 2, transition: "smooth" },
  ];
  const sample = (time: number) => {
    applyAnimatedEntityPose(group, entity, scene, time);
    group.updateMatrixWorld(true);
  };
  const animation = bakeAnimation([group], 4, sample);
  sample(0);
  const exported = exportSnapshot(group),
    mixer = new T.AnimationMixer(exported);
  const action = mixer.clipAction(animation).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  // Compare exact bake sample instants; between samples playback interpolates.
  for (const time of [0, 1, 2, 2 + 8 / BAKE_SAMPLE_FPS, 3, 4]) {
    sample(time);
    action.reset().play();
    mixer.setTime(time);
    exported.updateMatrixWorld(true);
    for (const name of boneNames) {
      const bone = group.userData.bones[name] as T.Bone;
      const copy = exported.getObjectByProperty("uuid", bone.uuid)!;
      expect(
        copy
          .getWorldPosition(new T.Vector3())
          .distanceTo(bone.getWorldPosition(new T.Vector3())),
        name,
      ).toBeLessThan(1e-4);
    }
  }
  disposeObject(group);
  disposeObject(exported);
});

it("keeps catalogue file access bounded and exposes collections and assistant names", () => {
  const scene = starterScene();
  expect(
    allAssets(scene).filter((a) => a.category === "characters"),
  ).toHaveLength(46);
  for (const asset of libraryCharacters) {
    expect(offlineCommands(scene, `Add ${asset.name}`).commands).toContainEqual(
      { type: "add", assetId: asset.id },
    );
    expect(characterCollection(asset)).toBeTruthy();
  }
  for (const url of [
    "/library/quaternius/missing.glb",
    "/library/../secrets.glb",
    "https://example.com/file.glb",
    "/library/quaternius/sage.glb?x=1",
  ])
    expect(
      assetSchema.safeParse({ ...libraryCharacters[0], url }).success,
    ).toBe(false);
  expect(offlineCommands(scene, "Add a different character").commands).toEqual(
    [],
  );
  expect(offlineCommands(scene, "Add Dr Amara").commands).toContainEqual({
    type: "add",
    assetId: "quaternius-doctor-female-young",
  });
});
