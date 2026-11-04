import { it, expect } from "vitest";
import fs from "node:fs/promises";
import * as T from "three";
import JSZip from "jszip";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  capturedMotions,
  capturedRouteGaits,
  libraryMotions,
  motionCollections,
  motionDetails,
  motionSource,
} from "../shared/motionLibrary";
import {
  allMotions,
  applyCommands,
  starterScene,
  boneNames,
  validateScene,
  type Asset,
} from "../shared/scene";
import { actionPreview } from "../shared/actionPreview";
import {
  prepareImportedAsset,
  requiredMotionSources,
} from "../src/importedAsset";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import {
  nativeRootMotion,
  setMotionSources,
  sampleNativeClip,
} from "../src/rig";
import { offlinePlan, offlineCommands } from "../server/ai";
import { validatePlan } from "../shared/studio";
import { productionPackage } from "../src/productionPackage";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();
async function load(asset: Asset) {
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return prepareImportedAsset(asset, gltf);
}
const point = (bone: T.Bone) => bone.getWorldPosition(new T.Vector3());
it("previews original imported performances on their own skeleton at native timing without modifying the project", async () => {
  const scene = starterScene();
  const motion = libraryMotions.find((m) => m.animationName === "Walk")!;
  const before = JSON.stringify(scene);
  const preview = actionPreview(
    scene,
    motion,
    scene.entities[0].id,
    undefined,
    "original",
  );
  const asset = preview.scene.customAssets.find(
    (a) => a.id === preview.actor.assetId,
  )!;
  const take = allMotions(preview.scene).find(
    (m) => m.id === preview.actor.clips[0].motionId,
  )!;
  expect(take.sourceAssetId).toBe(preview.actor.assetId);
  expect(take.animationName).toBe(motion.animationName);
  expect(asset.url).toBe(motionSource.url);
  expect(requiredMotionSources(preview.scene, preview.actor)).toEqual([]);
  expect(preview.actor.clips[0].playbackRate).toBe(1);
  const group = await load(asset),
    reference = await load(motionSource);
  const clip = reference.userData.animations.find(
    (c: T.AnimationClip) => c.name === motion.animationName,
  );
  for (const time of [0.113, 0.419, 0.947, 0.113]) {
    applyAnimatedEntityPose(group, preview.actor, preview.scene, time);
    sampleNativeClip(reference, clip, time);
    for (const name of boneNames) {
      const a = group.userData.bones[name],
        b = reference.userData.bones[name];
      if (!a || !b) continue;
      expect(a.position.distanceTo(b.position), name).toBeLessThan(1e-8);
      expect(a.quaternion.angleTo(b.quaternion), name).toBeLessThan(1e-7);
    }
  }
  disposeObject(group);
  disposeObject(reference);
  expect(JSON.stringify(scene)).toBe(before);
  const external = {
    ...motionSource,
    id: "unfamiliar-source",
    name: "Original provider rig",
  };
  scene.customAssets.push(external, {
    ...motionSource,
    id: "preview-original-source",
  });
  const imported = { ...motion, id: "user-walk", sourceAssetId: external.id };
  scene.customMotions.push(imported);
  const importedPreview = actionPreview(
    scene,
    imported,
    undefined,
    undefined,
    "original",
  );
  expect(importedPreview.actor.name).toBe(external.name);
  expect(importedPreview.actor.assetId).not.toBe("preview-original-source");
  expect(
    requiredMotionSources(importedPreview.scene, importedPreview.actor),
  ).toEqual([]);
});

it("no longer offers the 17 stylized clips, and plays old clips that used them as recordings", () => {
  const scene = starterScene();
  expect(libraryMotions).toHaveLength(17);
  for (const motion of libraryMotions)
    expect(
      allMotions(scene).some((m) => m.id === motion.id),
      motion.name,
    ).toBe(false);
  expect(
    allMotions(scene).some((m) => m.sourceAssetId === motionSource.id),
  ).toBe(false);
  // An old project's clips migrate to the closest recording on load.
  const legacy = starterScene(),
    actor = legacy.entities[0];
  actor.clips = libraryMotions.map((motion, i) => ({
    id: "authored-" + i,
    motionId: motion.id,
    duration: motion.duration,
    transition: "cut" as const,
  }));
  const migrated = validateScene(legacy),
    played = migrated.entities[0].clips.map((c) =>
      allMotions(migrated).find((m) => m.id === c.motionId),
    );
  for (const motion of played)
    expect(motion?.sourceAssetId).toMatch(/^cmu-capture-/);
  const byOld = Object.fromEntries(
    libraryMotions.map((motion, i) => [motion.id, played[i]!.id]),
  );
  expect(byOld).toMatchObject({
    "authored-idle": "idle",
    "authored-sit-down": "sit",
    // The stylized Stand up was a pose; the recorded one needs a seat.
    "authored-stand-up": "captured-139-16",
    "authored-pick-up": "pick",
    "authored-victory": "captured-79-69",
    "authored-defeat": "captured-79-71",
    "authored-punch": "captured-143-23",
  });
  // Walks and runs become routes on the recorded stride, like the retired
  // formula gaits.
  for (const [old, gait] of [
    ["authored-walk", capturedRouteGaits[0]],
    ["authored-run", capturedRouteGaits[1]],
  ] as const)
    expect(played[libraryMotions.findIndex((m) => m.id === old)]).toMatchObject(
      {
        sourceAssetId: gait.sourceAssetId,
        animationName: gait.animationName,
        path: { points: [[0, 0, 0], expect.any(Array)] },
      },
    );
  expect(
    requiredMotionSources(migrated, migrated.entities[0]),
  ).not.toContainEqual(expect.objectContaining({ id: motionSource.id }));
  // So do project copies of a stylized clip: a standalone copy becomes the
  // recording, a drawn route keeps its path on the recorded stride.
  const victory = libraryMotions.find((m) => m.animationName === "Victory")!,
    walk = libraryMotions.find((m) => m.animationName === "Walk")!;
  const copies = starterScene();
  copies.customMotions.push(
    { ...victory, id: "my-victory" },
    {
      ...walk,
      id: "my-route",
      path: {
        points: [
          [0, 0, 0],
          [0, 0, 3],
        ],
        smooth: false,
      },
    },
  );
  copies.entities[0].clips = [
    { id: "a", motionId: "my-victory", duration: 3 },
    { id: "b", motionId: "my-route", duration: 3 },
  ];
  const copied = validateScene(copies);
  expect(copied.entities[0].clips.map((c) => c.motionId)).toEqual([
    "captured-79-69",
    "my-route",
  ]);
  expect(copied.customMotions.map((m) => m.id)).toEqual(["my-route"]);
  expect(copied.customMotions[0]).toMatchObject({
    sourceAssetId: capturedRouteGaits[0].sourceAssetId,
    animationName: capturedRouteGaits[0].animationName,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 3],
      ],
    },
  });
});
it("preserves anatomical origins and rotations when sharing source motions onto the same body, including roll and shoulder helpers", async () => {
  // The stylized clips are retired; their source stands in for a creator's
  // import carrying its own takes.
  const source = await load(motionSource),
    target = await load({ ...motionSource, id: "receiver" });
  setMotionSources(target, new Map([["user-source", source]]));
  const takes = libraryMotions.map((m) => ({
    ...m,
    id: "user-" + m.id,
    sourceAssetId: "user-source",
  }));
  for (const motion of takes) {
    const scene = starterScene();
    scene.customMotions = takes;
    scene.entities = scene.entities.slice(0, 1);
    const actor = scene.entities[0];
    actor.position = [0, 0, 0];
    actor.rotation = 0;
    actor.clips = [
      {
        id: "clip",
        motionId: motion.id,
        duration: motion.duration,
        transition: "cut",
      },
    ];
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      applyAnimatedEntityPose(target, actor, scene, motion.duration * fraction);
      target.updateMatrixWorld(true);
      const native = T.AnimationClip.findByName(
        source.userData.animations,
        motion.animationName!,
      )!;
      const heading = nativeRootMotion(source, native)!.startHeading;
      // Preserve the sample after querying the cached source profile.
      applyAnimatedEntityPose(target, actor, scene, motion.duration * fraction);
      const expected = boneNames.map((n) =>
        point(source.userData.bones[n]).applyAxisAngle(
          new T.Vector3(0, 1, 0),
          -heading,
        ),
      );
      // The source sampler keeps the initial horizontal offset/facing; these clips start at the origin.
      const shift = point(target.userData.bones.hips).sub(expected[0]);
      for (const [i, n] of boneNames.entries()) {
        expect(
          point(target.userData.bones[n]).distanceTo(
            expected[i].clone().add(shift),
          ),
          motion.name + " " + n,
        ).toBeLessThan(0.00002);
        const expectedRotation = source.userData.bones[n]
          .getWorldQuaternion(new T.Quaternion())
          .premultiply(
            new T.Quaternion().setFromAxisAngle(
              new T.Vector3(0, 1, 0),
              -heading,
            ),
          )
          .normalize();
        expect(
          target.userData.bones[n]
            .getWorldQuaternion(new T.Quaternion())
            .normalize()
            .angleTo(expectedRotation),
          motion.name + " " + n + " rotation",
        ).toBeLessThan(0.00002);
      }
    }
  }
  disposeObject(source);
  disposeObject(target);
});
it("offers named actions and separate, validated previews without modifying the current scene", () => {
  const scene = starterScene(),
    snapshot = JSON.stringify(scene);
  for (const motion of allMotions(scene)) {
    const preview = actionPreview(scene, motion, scene.entities[0].id);
    expect(preview.actor.clips.at(-1)?.motionId).toBe(motion.id);
    expect(
      preview.scene.entities.every(
        (e) => !scene.entities.some((original) => original.id === e.id),
      ),
    ).toBe(true);
    expect(JSON.stringify(scene)).toBe(snapshot);
  }
  const colored = structuredClone(scene);
  colored.entities[0].color = "#b85b58";
  expect(
    actionPreview(colored, libraryMotions[0], colored.entities[0].id).actor
      .color,
  ).toBe("#b85b58");
  for (const motion of capturedMotions.filter((m) =>
    ["wave", "bow", "dance"].includes(m.id),
  )) {
    expect(offlineCommands(scene, `Mila ${motion.name}`).commands).toEqual([
      { type: "chain", id: scene.entities[0].id, motionId: motion.id },
    ]);
    const plan = offlinePlan(
      scene,
      `Preview ${motion.name}`,
      scene.entities[0].id,
      {},
    );
    expect(plan.steps).toEqual([
      {
        type: "previewAction",
        motionId: motion.id,
        actorId: scene.entities[0].id,
      },
    ]);
    expect(() => validatePlan(plan, scene, () => scene)).not.toThrow();
  }
  // The retired stylized clips are neither chained nor previewed.
  for (const motion of libraryMotions) {
    const offered = JSON.stringify([
      offlineCommands(scene, `Mila ${motion.name}`).commands,
      offlinePlan(scene, `Preview ${motion.name}`, scene.entities[0].id, {})
        .steps,
    ]);
    expect(offered, motion.name).not.toContain(motion.id);
    expect(() =>
      validatePlan(
        {
          response: "",
          steps: [{ type: "previewAction", motionId: motion.id }],
        },
        scene,
        () => scene,
      ),
    ).toThrow("existing action");
  }
  expect(() =>
    applyCommands(scene, [
      {
        type: "createAsset",
        asset: { ...motionSource, url: undefined },
      },
    ]),
  ).toThrow("Duplicate IDs");
  expect(() =>
    validatePlan(
      { response: "", steps: [{ type: "previewAction", motionId: "missing" }] },
      scene,
      () => scene,
    ),
  ).toThrow("existing action");
  expect(() =>
    validatePlan(
      {
        response: "",
        steps: [{ type: "previewAction", motionId: "wave" }, { type: "save" }],
      },
      scene,
      () => scene,
    ),
  ).toThrow("final step");
});
it("packages an old project that used stylized clips with recordings only, without the retired source", async () => {
  const legacy = starterScene();
  legacy.entities[0].clips = [
    { id: "a", motionId: libraryMotions[0].id, duration: 3 },
    { id: "b", motionId: libraryMotions[1].id, duration: 2 },
  ];
  const scene = validateScene(legacy);
  const fetched: string[] = [];
  const read: typeof fetch = async (input) => {
    fetched.push(String(input));
    return new Response(
      await fs.readFile(
        String(input).startsWith("/library/") ? "public" + input : "." + input,
      ),
    );
  };
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, new ArrayBuffer(0), read),
  );
  expect(zip.file("assets/actions/quaternius-actions.glb")).toBeNull();
  expect(fetched).not.toContain(motionSource.url);
  const packaged = JSON.parse(await zip.file("scene.json")!.async("string"));
  expect(packaged.entities).toEqual(scene.entities);
  expect(
    packaged.entities[0].clips.map((c: { motionId: string }) => c.motionId),
  ).toEqual(["idle", expect.stringMatching(/^recorded-route-/)]);
  expect(packaged.customMotions[0]).toMatchObject({
    sourceAssetId: capturedRouteGaits[0].sourceAssetId,
  });
});
it("files every recorded take under a library collection and separates stylized and user actions", () => {
  const groups = motionCollections.filter(
    (c) => !["All", "Stylized", "My actions"].includes(c),
  );
  for (const motion of capturedMotions) {
    const details = motionDetails(motion);
    expect(groups, motion.name).toContain(details.collection);
    expect(details).toMatchObject({
      source: "recorded",
      captured: true,
      authored: false,
    });
    expect(details.description).toContain("Recorded motion capture");
    expect(motion.name).not.toMatch(/^Captured /);
  }
  // No collection is empty.
  for (const collection of groups)
    expect(
      capturedMotions.some((m) => motionDetails(m).collection === collection),
      collection,
    ).toBe(true);
  for (const motion of libraryMotions)
    expect(motionDetails(motion)).toMatchObject({
      collection: "Stylized",
      source: "stylized",
      authored: true,
      captured: false,
    });
  expect(
    motionDetails({ ...libraryMotions[0], id: "user-walk" }),
  ).toMatchObject({ collection: "My actions", source: "mine" });
  expect(
    ["walk", "run", "idle"].map((id) => [
      capturedMotions.find((m) => m.id === id)?.name,
      motionDetails(capturedMotions.find((m) => m.id === id)!).collection,
    ]),
  ).toEqual([
    ["Walk", "Walking"],
    ["Run", "Running"],
    ["Standing idle", "Standing"],
  ]);
});
