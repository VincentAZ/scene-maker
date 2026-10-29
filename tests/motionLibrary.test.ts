import { it, expect } from "vitest";
import fs from "node:fs/promises";
import * as T from "three";
import JSZip from "jszip";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { libraryMotions, motionSource } from "../shared/motionLibrary";
import { libraryCharacters } from "../shared/characterLibrary";
import {
  allMotions,
  applyCommands,
  starterScene,
  boneNames,
  motionSchema,
  type Asset,
} from "../shared/scene";
import { actionPreview } from "../shared/actionPreview";
import {
  prepareImportedAsset,
  requiredMotionSources,
} from "../src/importedAsset";
import {
  applyAnimatedEntityPose,
  createCharacter,
  disposeObject,
} from "../src/world";
import { nativeRootMotion, setMotionSources } from "../src/rig";
import { offlinePlan, offlineCommands } from "../server/ai";
import { validatePlan } from "../shared/studio";
import { productionPackage } from "../src/productionPackage";
async function load(asset: Asset) {
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return prepareImportedAsset(asset, gltf);
}
const point = (bone: T.Bone) => bone.getWorldPosition(new T.Vector3());
it("shares all 17 actual authored motions across every bundled body and the procedural rig without drift or missing dependencies", async () => {
  const source = await load(motionSource);
  expect(source.userData.animations).toHaveLength(17);
  const actors = [...libraryCharacters];
  for (const asset of actors) {
    const group = await load(asset);
    setMotionSources(group, new Map([[motionSource.id, source]]));
    let scene = applyCommands(starterScene(), [
      { type: "clear" },
      { type: "add", assetId: asset.id, position: [0, 0, 0] },
    ]);
    const actor = scene.entities[0];
    for (const motion of libraryMotions) {
      motionSchema.parse(motion);
      actor.clips = [
        {
          id: "authored",
          motionId: motion.id,
          duration: motion.duration,
          transition: "cut",
        },
      ];
      scene = { ...scene, entities: [{ ...actor }] };
      expect(requiredMotionSources(scene, actor).map((a) => a.id)).toEqual([
        motionSource.id,
      ]);
      const sample = (t: number) => {
        applyAnimatedEntityPose(group, scene.entities[0], scene, t);
        group.updateMatrixWorld(true);
        expect(
          group.userData.motionWarning,
          asset.name + " " + motion.name,
        ).toBe("");
        group.traverse((o) =>
          expect(o.matrixWorld.elements.every(Number.isFinite)).toBe(true),
        );
      };
      sample(motion.duration * 0.3);
      const before = boneNames.map((n) => point(group.userData.bones[n]));
      sample(motion.duration * 0.7);
      sample(motion.duration + 1);
      sample(0);
      sample(motion.duration * 0.3);
      for (const [i, n] of boneNames.entries())
        expect(
          point(group.userData.bones[n]).distanceTo(before[i]),
          asset.name + " " + motion.name + " " + n,
        ).toBeLessThan(1e-6);
    }
    disposeObject(group);
  }
  const scene = starterScene(),
    actor = scene.entities[0],
    target = createCharacter((await import("../shared/scene")).characters[0]);
  setMotionSources(target, new Map([[motionSource.id, source]]));
  for (const motion of libraryMotions) {
    actor.clips = [
      { id: "action", motionId: motion.id, duration: motion.duration },
    ];
    applyAnimatedEntityPose(
      target,
      actor,
      { ...scene, entities: [{ ...actor }] },
      motion.duration * 0.6,
    );
    expect(target.userData.motionWarning, motion.name).toBe("");
  }
  disposeObject(target);
  disposeObject(source);
});
it("preserves anatomical origins and rotations when sharing source motions onto the same body, including roll and shoulder helpers", async () => {
  const source = await load(motionSource),
    target = await load({ ...motionSource, id: "receiver" });
  setMotionSources(target, new Map([[motionSource.id, source]]));
  for (const motion of libraryMotions) {
    const scene = starterScene();
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
  for (const motion of libraryMotions) {
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
it("packages the authored source exactly once, with its license and no extra cast member", async () => {
  const scene = starterScene();
  scene.entities[0].clips = [
    { id: "a", motionId: libraryMotions[0].id, duration: 3 },
    { id: "b", motionId: libraryMotions[1].id, duration: 2 },
  ];
  const read: typeof fetch = async (input) =>
    new Response(
      await fs.readFile(
        String(input).startsWith("/library/") ? "public" + input : "." + input,
      ),
    );
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, new ArrayBuffer(0), read),
  );
  expect(
    await zip
      .file("assets/actions/quaternius-actions.glb")!
      .async("uint8array"),
  ).toEqual(new Uint8Array(await fs.readFile("public" + motionSource.url)));
  expect(
    await zip.file("assets/actions/LICENSE.txt")!.async("string"),
  ).toContain("CC0");
  expect(
    JSON.parse(await zip.file("scene.json")!.async("string")).entities,
  ).toEqual(scene.entities);
  await expect(
    productionPackage(scene, new ArrayBuffer(0), async (input, options) =>
      String(input) === motionSource.url
        ? new Response("", { status: 404 })
        : read(input, options),
    ),
  ).rejects.toThrow("action library");
});
