import { expect, it } from "vitest";
import * as T from "three";
import {
  allMotions,
  applyCommands,
  characters,
  motionSchema,
  starterScene,
  validateScene,
} from "../shared/scene";
import { withAutomaticMovement } from "../shared/aiMovement";
import {
  compilePath,
  pathActionClips,
  pathToWorld,
  samplePath,
} from "../shared/path";
import { entityPose, motionPose } from "../shared/animation";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { inspectRouteClearance } from "../src/routeClearance";
import {
  applyAnimatedEntityPose,
  createCharacter,
  createProp,
} from "../src/world";
import { bakeAnimation, animationSampleBoundaries } from "../src/bakeAnimation";

function fixture(kind: "walk" | "run" = "walk") {
  const previous = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "actor", position: [1, 0, 2] },
    { type: "update", id: "actor", changes: { rotation: 0.6, scale: 1.3 } },
    { type: "add", assetId: "crate", id: "obstacle", position: [9, 0, 9] },
  ]);
  const incoming = applyCommands(previous, [
    {
      type: "createMotion",
      motion: {
        id: "backpedal",
        name: "Back away",
        kind,
        distance: -5,
        duration: 5,
        poses: [],
      },
    },
    { type: "chain", id: "actor", motionId: "backpedal", duration: 5 },
  ]);
  const scene = withAutomaticMovement(previous, incoming);
  const actor = scene.entities[0],
    clip = actor.clips[0];
  const motion = allMotions(scene).find((m) => m.id === clip.motionId)!;
  const objects = new Map([
    ["actor", createCharacter(characters[0])],
    ["obstacle", createProp("crate", "#886644")],
  ]);
  const frame = {
    position: actor.position,
    heading: actor.rotation,
    scale: actor.scale,
  };
  return { previous, incoming, scene, actor, clip, motion, objects, frame };
}

it.each(["walk", "run"] as const)(
  "registers backward %s navigation and preserves the world endpoint and facing",
  (kind) => {
    const f = fixture(kind);
    expect(f.clip.navigation).toEqual({
      point: [0, 0, -5],
      movement: kind,
      endHeading: 0,
    });
    expect(f.clip.duration).toBe(5);
    expect(f.motion.path?.backward).toBe(true);
    expect(f.incoming.customMotions[0].path).toBeUndefined();
    const direct = f.incoming.customMotions[0];
    expect(motionPose(direct, 0.11).rotations.leftLeg[0]).toBeCloseTo(
      -motionPose({ ...direct, distance: 5 }, 0.11).rotations.leftLeg[0],
      10,
    );
    const restored = validateScene(JSON.parse(JSON.stringify(f.scene)));
    expect(restored).toEqual(f.scene);
    for (const time of [0, 0.01, 1, 3, 5, 6]) {
      const pose = entityPose(f.actor, f.scene, time);
      const progress = Math.min(1, time / 5);
      const expected = pathToWorld([0, 0, -5 * progress], f.frame);
      expect(pose.root[0]).toBeCloseTo(expected[0], 10);
      expect(pose.root[2]).toBeCloseTo(expected[2], 10);
      expect(pose.heading).toBeCloseTo(f.actor.rotation, 10);
    }
    const forward = structuredClone(f.scene);
    forward.customMotions.find((m) => m.id === f.motion.id)!.path!.backward =
      false;
    const reversePose = entityPose(f.actor, f.scene, 1.1);
    const forwardPose = entityPose(f.actor, forward, 1.1);
    expect(Math.abs(reversePose.rotations.leftLeg[0])).toBeGreaterThan(0.01);
    expect(reversePose.rotations.leftLeg[0]).toBeCloseTo(
      -forwardPose.rotations.leftLeg[0],
      10,
    );
  },
);

it("replans a newly blocked backward route without turning the actor forward or changing pace", () => {
  const f = fixture();
  expect(prepareAutomaticRoutes(f.scene, f.objects).scene).toBe(f.scene);
  f.scene.entities[1].position = pathToWorld([0, 0, -2.5], f.frame);
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const actor = result.scene.entities[0],
    clip = actor.clips[0];
  const path = allMotions(result.scene).find(
    (m) => m.id === clip.motionId,
  )!.path!;
  expect(path.backward).toBe(true);
  expect(path.points).not.toEqual(f.motion.path!.points);
  expect(path.points.at(-1)).toEqual([0, 0, -5]);
  const compiled = compilePath(path);
  expect(clip.duration / compiled.length).toBeCloseTo(1, 8);
  expect(samplePath(path, 0).heading).toBeCloseTo(0, 8);
  expect(samplePath(path, 1).heading).toBeCloseTo(0, 8);
  for (const progress of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const a = samplePath(path, progress - 1e-5),
      b = samplePath(path, progress + 1e-5);
    const facing = samplePath(path, progress).heading;
    // The moving character faces opposite the route tangent throughout.
    const dot =
      Math.sin(facing) * (b.point[0] - a.point[0]) +
      Math.cos(facing) * (b.point[2] - a.point[2]);
    expect(dot).toBeLessThan(0);
  }
  expect(
    inspectRouteClearance(result.scene, f.objects, actor.id, clip.id).blocked,
  ).toBeNull();
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );

  const group = f.objects.get("actor")!;
  const render = (time: number) =>
    applyAnimatedEntityPose(group, actor, result.scene, time);
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
});

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

it("avoids an animated crossing obstacle during backward movement", () => {
  const f = fixture();
  const start = pathToWorld([-2, 0, -2.5], f.frame),
    end = pathToWorld([2, 0, -2.5], f.frame);
  const scene = applyCommands(f.scene, [
    {
      type: "createMotion",
      motion: {
        id: "crossing",
        name: "Crossing obstacle",
        kind: "walk",
        duration: 5,
        distance: 0,
        poses: [],
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            end.map((n, i) => n - start[i]) as [number, number, number],
          ],
        },
      },
    },
    {
      type: "update",
      id: "obstacle",
      changes: {
        position: start,
        clips: [{ id: "cross", motionId: "crossing", duration: 5 }],
      },
    },
  ]);
  expect(
    inspectRouteClearance(scene, f.objects, "actor", f.clip.id).blocked,
  ).not.toBeNull();
  const result = prepareAutomaticRoutes(scene, f.objects);
  expect(result.issues).toEqual([]);
  expect(
    inspectRouteClearance(result.scene, f.objects, "actor", f.clip.id).blocked,
  ).toBeNull();
  const clip = result.scene.entities[0].clips[0];
  expect(
    allMotions(result.scene).find((m) => m.id === clip.motionId)?.path
      ?.backward,
  ).toBe(true);
});

it("retains backward facing across waypoint actions and distinguishes captured imported gait direction", () => {
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
  expect(
    parts.filter((p) => !p.action).every((p) => p.motion.path?.backward),
  ).toBe(true);
  const scene = structuredClone(f.scene);
  scene.customMotions.push(
    ...parts.filter((p) => !p.action).map((p) => p.motion),
  );
  scene.entities[0].clips = parts.map((part, i) => ({
    id: "part-" + i,
    motionId: part.motion.id,
    duration: part.motion.duration,
  }));
  const end = entityPose(scene.entities[0], scene, 6);
  const expected = pathToWorld([0, 0, -5], f.frame);
  expect(
    new T.Vector3(...end.root).distanceTo(new T.Vector3(...expected)),
  ).toBeLessThan(1e-10);
  expect(end.heading).toBeCloseTo(f.actor.rotation, 10);
  expect(() =>
    motionSchema.parse({
      ...f.motion,
      kind: "imported",
      sourceAssetId: "source",
      animationName: "Take",
    }),
  ).toThrow(/captured backward gait/);
});
