import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  allMotions,
  starterScene,
  validateScene,
  type Asset,
  type Scene,
} from "../shared/scene";
import { libraryCharacters } from "../shared/characterLibrary";
import {
  capturedMotionSources,
  capturedRouteGaits,
} from "../shared/motionLibrary";
import { prepareImportedAsset } from "../src/importedAsset";
import { setMotionSources } from "../src/rig";
import {
  locomotionProfile,
  locomotionScale,
  routeSourceDuration,
} from "../src/locomotion";
import { disposeObject, applyAnimatedEntityPose } from "../src/world";
import { proposeCapturedArrival } from "../src/capturedArrival";
import { proposeAutomaticArrivalSteps } from "../src/automaticArrival";
import { finishNavigationWork } from "../src/navigationWork";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { compilePath } from "../shared/path";

let source: T.Group, target: T.Group;
const gait = capturedRouteGaits.find(
  (m) => m.id === "captured-gradual-walking-stride",
)!;
async function load(asset: Asset) {
  const data = await fs.readFile("public" + asset.url);
  return prepareImportedAsset(
    asset,
    await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    ),
  );
}
beforeAll(async () => {
  source = await load(
    capturedMotionSources.find((a) => a.id === gait.sourceAssetId)!,
  );
  target = await load(
    libraryCharacters.find((a) => a.id === "quaternius-casual-female")!,
  );
  setMotionSources(target, new Map([[gait.sourceAssetId!, source]]));
});
afterAll(() => {
  disposeObject(source);
  disposeObject(target);
});
function fixture(rate = 1) {
  const scene = starterScene();
  scene.entities = scene.entities.slice(0, 1);
  scene.transcript = [];
  const actor = scene.entities[0];
  actor.assetId = "quaternius-casual-female";
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.scale = 1;
  actor.ending = "hold";
  const profile = locomotionProfile(
    source,
    source.userData.animations[0],
    gait.path!.sourceRange,
  )!;
  const duration =
    routeSourceDuration(profile, 4 / locomotionScale(source, target)) / rate;
  scene.customMotions = [
    {
      ...gait,
      id: "test-route",
      path: {
        ...gait.path!,
        points: [
          [0, 0, 0],
          [0, 0, 4],
        ],
      },
    },
  ];
  actor.clips = [
    {
      id: "route",
      motionId: "test-route",
      duration,
      playbackRate: rate,
      navigation: { point: [0, 0, 4], movement: "walk" },
    },
  ];
  return validateScene(scene);
}
function propose(scene: Scene) {
  return finishNavigationWork(
    proposeAutomaticArrivalSteps(
      scene,
      new Map([[scene.entities[0].id, target]]),
      scene.entities[0].id,
      "route",
    ),
  );
}
it("finds a real receiving-body-compatible stop where the selected cycle cannot meet it, preserving explicit source pace and input", () => {
  const scene = fixture(1.7),
    actor = scene.entities[0],
    objects = new Map([[actor.id, target]]);
  const before = JSON.stringify(scene);
  const positions = () => {
    const result: number[] = [];
    target.traverse((n) =>
      result.push(
        ...n.position.toArray(),
        ...n.quaternion.toArray(),
        ...n.scale.toArray(),
      ),
    );
    return result;
  };
  const pose = positions();
  expect(
    proposeCapturedArrival(scene, objects, actor.id, "route"),
  ).toHaveProperty("reason");
  const result = propose(scene);
  expect(result).toHaveProperty("scene");
  if (!("scene" in result)) return;
  const clips = result.scene.entities[0].clips,
    prefix = allMotions(result.scene).find((m) => m.id === clips[0].motionId)!;
  expect(prefix.path!.sourceRange).not.toEqual(gait.path!.sourceRange);
  expect(clips[1].playbackRate).toBeCloseTo(1.7, 10);
  const profile = locomotionProfile(
    source,
    source.userData.animations[0],
    prefix.path!.sourceRange,
  )!;
  expect(
    routeSourceDuration(
      profile,
      compilePath(prefix.path!).length / locomotionScale(source, target),
    ) / clips[0].duration,
  ).toBeCloseTo(1.7, 10);
  expect(result.scene.customMotions.find((m) => m.id === "test-route")).toEqual(
    scene.customMotions[0],
  );
  expect(positions()).toEqual(pose);
  expect(JSON.stringify(scene)).toBe(before);
}, 30_000);
it("persists the original destination request and reuses a verified finish on the next plan", () => {
  const scene = fixture(),
    actor = scene.entities[0],
    objects = new Map([[actor.id, target]]);
  const result = prepareAutomaticRoutes(scene, objects);
  expect(result.issues).toEqual([]);
  const clips = result.scene.entities[0].clips;
  expect(clips).toHaveLength(2);
  expect(clips[0].navigation).toMatchObject({
    point: [0, 0, 4],
    arrival: {
      motionId: "test-route",
      duration: actor.clips[0].duration,
      clipId: clips[1].id,
    },
  });
  const repeated = prepareAutomaticRoutes(result.scene, objects);
  expect(repeated.issues).toEqual([]);
  expect(repeated.scene.entities[0].clips).toEqual(clips);
  const end = clips.reduce((s, c) => s + c.duration, 0);
  const sample = (time: number) => {
    applyAnimatedEntityPose(
      target,
      result.scene.entities[0],
      result.scene,
      time,
    );
    target.updateMatrixWorld(true);
    return target.userData.bones.hips.getWorldPosition(new T.Vector3());
  };
  const endpoint = sample(end);
  for (const time of [0, end / 2, 0, end + 10]) sample(time);
  expect(sample(end).distanceTo(endpoint)).toBeLessThan(1e-7);
  expect(Math.hypot(endpoint.x, endpoint.z - 4)).toBeLessThan(0.02);
}, 30_000);
it("leaves an explicitly selected gait alone without destination-owned navigation", () => {
  const scene = fixture();
  delete scene.entities[0].clips[0].navigation;
  expect(propose(scene)).toHaveProperty("reason");
});
it("does not reinterpret native navigation as a repeating gait", () => {
  const scene = fixture();
  scene.entities[0].clips[0].navigation!.native = {
    motionId: gait.id,
    duration: gait.duration,
    playbackRate: 1,
  };
  expect(propose(scene)).toHaveProperty("reason");
});
