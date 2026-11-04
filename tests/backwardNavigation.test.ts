import { expect, it } from "vitest";
import * as T from "three";
import {
  allAssets,
  allMotions,
  applyCommands,
  characters,
  motionSchema,
  starterScene,
  validateScene,
  type Motion,
} from "../shared/scene";
import { capturedMotions, capturedRouteGaits } from "../shared/motionLibrary";
import { withAutomaticMovement } from "../shared/aiMovement";
import { pathActionClips, pathToWorld } from "../shared/path";
import { entityPose } from "../shared/animation";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { inspectRouteClearance } from "../src/routeClearance";
import {
  applyAnimatedEntityPose,
  createCharacter,
  createProp,
} from "../src/world";
import { bakeAnimation, animationSampleBoundaries } from "../src/bakeAnimation";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

// Procedural backpedalling is gone. Backward travel is the recorded "Walk
// backwards" take, whose body already faces away from its travel.
const backward = capturedMotions.find((m) => m.animationName === "143_39")!;
const backpedal = (): Motion => ({
  ...backward,
  id: "backpedal",
  name: "Back away",
  duration: 8,
  path: {
    points: [
      [0, 0, 0],
      [0, 0, -5],
    ],
    smooth: false,
  },
});

function fixture() {
  const previous = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "actor", position: [1, 0, 2] },
    { type: "update", id: "actor", changes: { rotation: 0.6, scale: 1.3 } },
    { type: "add", assetId: "crate", id: "obstacle", position: [9, 0, 9] },
  ]);
  const incoming = applyCommands(previous, [
    { type: "createMotion", motion: backpedal() },
    { type: "chain", id: "actor", motionId: "backpedal", duration: 8 },
  ]);
  const scene = withAutomaticMovement(previous, incoming);
  const actor = scene.entities[0],
    clip = actor.clips[0];
  const motion = allMotions(scene).find((m) => m.id === clip.motionId)!;
  const objects = new Map([
    [
      "actor",
      withRecordedSources(createCharacter(characters[0]), recordedSourceMap),
    ],
    ["obstacle", createProp("crate", "#886644")],
  ]);
  const frame = {
    position: actor.position,
    heading: actor.rotation,
    scale: actor.scale,
  };
  return { previous, incoming, scene, actor, clip, motion, objects, frame };
}
/** Rendered body facing against its travel direction over a short interval. */
function facingAlongTravel(
  group: T.Group,
  sample: (time: number) => void,
  time: number,
) {
  sample(time - 0.05);
  const from = group.position.clone();
  sample(time + 0.05);
  const travel = group.position.clone().sub(from).setY(0).normalize();
  return new T.Vector3(0, 0, 1).applyQuaternion(group.quaternion).dot(travel);
}

it.each(["walk", "run"] as const)(
  "migrates a saved procedural backward %s route onto the recorded backward walk, preserving its geometry and timing",
  (kind) => {
    const scene = starterScene();
    const points: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, -2],
      [0, 0, -5],
    ];
    scene.customMotions = [
      {
        id: "legacy-back",
        name: "Back away",
        kind,
        duration: 5,
        distance: 0,
        poses: [],
        path: { points, smooth: true, backward: true, endHeading: 0.3 },
      },
    ];
    scene.entities[0].clips = [
      { id: "back", motionId: "legacy-back", duration: 5 },
    ];
    const migrated = validateScene(JSON.parse(JSON.stringify(scene)));
    const motion = migrated.customMotions.find((m) => m.id === "legacy-back")!;
    expect(motion).toMatchObject({
      kind: "imported",
      sourceAssetId: backward.sourceAssetId,
      animationName: "143_39",
      duration: 5,
      path: { points, smooth: true, endHeading: 0.3 },
    });
    expect(motion.path!.backward).toBeUndefined();
    expect(migrated.entities[0].clips[0]).toMatchObject({
      id: "back",
      motionId: "legacy-back",
      duration: 5,
    });
    expect(validateScene(JSON.parse(JSON.stringify(migrated)))).toEqual(
      migrated,
    );
  },
);

it("migrates a saved straight backward studio action onto a recorded backward route of the same length", () => {
  // Old scenes stored "back away" as a walk with negative distance.
  const scene = starterScene();
  scene.customMotions = [
    {
      id: "legacy-straight",
      name: "Back away",
      kind: "walk",
      duration: 5,
      distance: -5,
      poses: [],
    },
  ];
  scene.entities[0].clips = [
    { id: "back", motionId: "legacy-straight", duration: 5 },
  ];
  const migrated = validateScene(JSON.parse(JSON.stringify(scene)));
  const clip = migrated.entities[0].clips[0];
  const motion = allMotions(migrated).find((m) => m.id === clip.motionId)!;
  expect(clip.duration).toBe(5);
  expect(motion).toMatchObject({
    kind: "imported",
    animationName: "143_39",
    path: {
      points: [
        [0, 0, 0],
        [0, 0, -5],
      ],
    },
  });
});

it("registers a recorded backward route's destination and keeps the world endpoint", () => {
  const f = fixture();
  expect(f.clip.navigation).toMatchObject({
    point: [0, 0, -5],
    movement: "walk",
  });
  expect(f.clip.duration).toBe(8);
  expect(f.motion).toMatchObject({
    kind: "imported",
    animationName: "143_39",
  });
  expect(validateScene(JSON.parse(JSON.stringify(f.scene)))).toEqual(f.scene);
  const end = entityPose(f.actor, f.scene, 8);
  const expected = pathToWorld([0, 0, -5], f.frame);
  expect(end.root[0]).toBeCloseTo(expected[0], 10);
  expect(end.root[2]).toBeCloseTo(expected[2], 10);
});

it("replans a newly blocked recorded backward route, keeping its take, endpoint and backward-facing body", () => {
  const f = fixture();
  expect(prepareAutomaticRoutes(f.scene, f.objects).scene).toBe(f.scene);
  f.scene.entities[1].position = pathToWorld([0, 0, -2.5], f.frame);
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const actor = result.scene.entities[0],
    clip = actor.clips[0];
  const motion = allMotions(result.scene).find((m) => m.id === clip.motionId)!;
  expect(motion).toMatchObject({
    kind: "imported",
    sourceAssetId: backward.sourceAssetId,
    animationName: "143_39",
  });
  expect(motion.path!.backward).toBeUndefined();
  expect(motion.path!.points).not.toEqual(f.motion.path!.points);
  expect(motion.path!.points.at(-1)).toEqual([0, 0, -5]);
  expect(clip.playbackRate).toBe(f.clip.playbackRate);
  expect(
    inspectRouteClearance(result.scene, f.objects, actor.id, clip.id).blocked,
  ).toBeNull();
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );

  const group = f.objects.get("actor")!;
  const render = (time: number) =>
    applyAnimatedEntityPose(group, actor, result.scene, time);
  // While it travels, the recorded body keeps facing away from its travel.
  for (const share of [0.2, 0.4, 0.6, 0.75])
    expect(
      facingAlongTravel(group, render, clip.duration * share),
      String(share),
    ).toBeLessThan(-0.5);
  const animation = bakeAnimation(
    [group],
    clip.duration,
    render,
    animationSampleBoundaries(result.scene, f.objects),
  );
  const mixer = new T.AnimationMixer(group),
    action = mixer.clipAction(animation).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  for (const time of [
    0.17,
    clip.duration * 0.3,
    clip.duration * 0.7,
    clip.duration - 0.01,
  ]) {
    render(time);
    const expectedPosition = group.position.clone(),
      expectedRotation = group.quaternion.clone();
    action.reset().play();
    mixer.setTime(time);
    expect(group.position.distanceTo(expectedPosition)).toBeLessThan(0.0003);
    expect(group.quaternion.angleTo(expectedRotation)).toBeLessThan(0.001);
    action.stop();
  }
}, 30_000);

it("honors the collision opt-out and holds an unreachable backward goal", () => {
  const f = fixture();
  f.scene.entities[1].position = pathToWorld([0, 0, -5], f.frame);
  const blocked = prepareAutomaticRoutes(f.scene, f.objects);
  expect(blocked.issues).toHaveLength(1);
  expect(blocked.playbackScene.entities[0].clips).toEqual([]);
  expect(blocked.scene.entities[0].clips).toEqual(f.actor.clips);
  const disabled = { ...f.scene, animationCollisions: false };
  expect(prepareAutomaticRoutes(disabled, f.objects)).toEqual({
    scene: disabled,
    playbackScene: disabled,
    issues: [],
  });
});

it("avoids a character crossing the route during backward movement", () => {
  const f = fixture();
  const start = pathToWorld([-2, 0, -2.5], f.frame),
    end = pathToWorld([2, 0, -2.5], f.frame);
  // Props cannot play recorded gaits, so the crossing obstacle is a
  // character walking across on the recorded stride.
  const walker = capturedRouteGaits[0];
  const scene = applyCommands(f.scene, [
    { type: "remove", id: "obstacle" },
    { type: "add", id: "crosser", assetId: "leo", position: start },
    {
      type: "update",
      id: "crosser",
      changes: {
        rotation: Math.atan2(end[0] - start[0], end[2] - start[2]),
      },
    },
    {
      type: "createMotion",
      motion: {
        ...walker,
        id: "crossing",
        name: "Crossing",
        duration: 8,
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            [0, 0, Math.hypot(end[0] - start[0], end[2] - start[2])],
          ],
          sourceRange: { ...walker.path!.sourceRange! },
        },
      },
    },
    { type: "chain", id: "crosser", motionId: "crossing", duration: 8 },
  ]);
  const objects = new Map(f.objects);
  objects.delete("obstacle");
  objects.set(
    "crosser",
    withRecordedSources(
      createCharacter(allAssets(scene).find((a) => a.id === "leo")!),
      recordedSourceMap,
    ),
  );
  expect(
    inspectRouteClearance(scene, objects, "actor", f.clip.id).blocked,
  ).not.toBeNull();
  const result = prepareAutomaticRoutes(scene, objects);
  expect(result.issues).toEqual([]);
  expect(
    inspectRouteClearance(result.scene, objects, "actor", f.clip.id).blocked,
  ).toBeNull();
  const clip = result.scene.entities[0].clips[0];
  expect(
    allMotions(result.scene).find((m) => m.id === clip.motionId)?.animationName,
  ).toBe("143_39");
}, 30_000);

it("keeps the recorded backward take across waypoint actions and rejects a procedural backward flag on it", () => {
  const f = fixture();
  const parts = pathActionClips(
    {
      ...f.motion,
      path: {
        ...f.motion.path!,
        points: [
          [0, 0, 0],
          [0, 0, -2],
          [0, 0, -5],
        ],
      },
    },
    [{ pointIndex: 1, motionId: "wave", duration: 1 }],
  );
  const moving = parts.filter((p) => !p.action);
  expect(moving).toHaveLength(2);
  for (const part of moving)
    expect(part.motion).toMatchObject({
      kind: "imported",
      sourceAssetId: backward.sourceAssetId,
      animationName: "143_39",
    });
  const scene = structuredClone(f.scene);
  scene.customMotions.push(...moving.map((p) => p.motion));
  scene.entities[0].clips = parts.map((part, i) => ({
    id: "part-" + i,
    motionId: part.motion.id,
    duration: part.motion.duration,
  }));
  const end = entityPose(scene.entities[0], scene, 9);
  const expected = pathToWorld([0, 0, -5], f.frame);
  expect(
    new T.Vector3(...end.root).distanceTo(new T.Vector3(...expected)),
  ).toBeLessThan(1e-10);
  expect(() =>
    motionSchema.parse({
      ...f.motion,
      path: { ...f.motion.path!, backward: true },
    }),
  ).toThrow(/captured backward gait/);
});
