import { expect, it } from "vitest";
import * as T from "three";
import { starterScene, validateScene, applyCommands } from "../shared/scene";
import { recordedStanding, capturedRouteGaits } from "../shared/motionLibrary";
import { entityPose } from "../shared/animation";
import { standingHoldClips } from "../src/automaticRoutes";
import {
  requiredMotionSources,
  planningMotionSources,
  loadPlanningMotionSources,
} from "../src/importedAsset";

it("retains sway inside each standing take without accumulating travel or turns over long waits", () => {
  const scene = starterScene(),
    actor = scene.entities[0],
    idle = recordedStanding[0];
  scene.entities = [actor];
  actor.position = [2, 0, 3];
  actor.rotation = 0.4;
  actor.clips = standingHoldClips(idle, "waiting", 70);
  expect(actor.clips.reduce((sum, clip) => sum + clip.duration, 0)).toBeCloseTo(
    70,
    9,
  );
  expect(
    actor.clips.every((clip) => clip.stationary && clip.playbackRate === 1),
  ).toBe(true);
  const nativeRoot = () => ({
    start: [0.1, 0.03, 0.2] as [number, number, number],
    delta: [0.08, 0, -0.02] as [number, number, number],
    heading: 0.12,
    startHeading: 0.2,
  });
  const first = entityPose(actor, scene, 0.3, { nativeRoot });
  for (const cycle of [3, 1, 2, 0])
    expect(
      entityPose(actor, scene, cycle * idle.duration + 0.3, { nativeRoot }),
    ).toEqual(first);
  const end = entityPose(actor, scene, 70, { nativeRoot });
  expect(end.root).toEqual(actor.position);
  expect(end.heading).toBe(actor.rotation);
  const original = {
    ...actor,
    clips: actor.clips.map(({ stationary: _, ...clip }) => clip),
  };
  expect(entityPose(original, scene, 70, { nativeRoot }).root).not.toEqual(
    actor.position,
  );
  expect(
    validateScene(JSON.parse(JSON.stringify(scene))).entities[0].clips,
  ).toEqual(actor.clips);
  const edited = applyCommands(scene, [
    {
      type: "update",
      id: actor.id,
      changes: {
        clips: actor.clips.map(({ id, motionId, duration }) => ({
          id,
          motionId,
          duration,
        })),
      },
    },
  ]);
  expect(edited.entities[0].clips.every((clip) => clip.stationary)).toBe(true);
});

it("rejects a stationary flag on a navigation-controlled route", () => {
  const scene = starterScene(),
    actor = scene.entities[0];
  actor.clips = standingHoldClips(recordedStanding[0], "waiting", 2);
  actor.clips[0].navigation = { point: [0, 0, 3], movement: "walk" };
  expect(() => validateScene(scene)).toThrow("stationary wait");
});

it("loads optional standing for automatic imported routes without expanding export dependencies", async () => {
  const scene = starterScene(),
    actor = scene.entities[0],
    gait = capturedRouteGaits[0];
  scene.customMotions.push(gait);
  actor.clips = [
    { id: "route", motionId: gait.id, duration: 5, playbackRate: 1 },
  ];
  expect(planningMotionSources(scene, actor)).toEqual(
    requiredMotionSources(scene, actor),
  );
  actor.clips[0].navigation = { point: [0, 0, 5], movement: "walk" };
  const required = requiredMotionSources(scene, actor);
  expect(required.map((a) => a.id)).not.toContain(
    recordedStanding[0].sourceAssetId,
  );
  expect(planningMotionSources(scene, actor).map((a) => a.id)).toContain(
    recordedStanding[0].sourceAssetId,
  );
  const group = new T.Group();
  const loaded = await loadPlanningMotionSources(
    scene,
    actor,
    async (asset) => {
      if (asset.id === recordedStanding[0].sourceAssetId)
        throw Error("Unavailable optional take");
      return group;
    },
  );
  expect([...loaded.keys()]).toEqual(required.map((a) => a.id));
  await expect(
    loadPlanningMotionSources(scene, actor, async () => {
      throw Error("Missing required take");
    }),
  ).rejects.toThrow("Missing required take");
  actor.clips.push(...standingHoldClips(recordedStanding[0], "wait", 2));
  await expect(
    loadPlanningMotionSources(scene, actor, async (asset) => {
      if (asset.id === recordedStanding[0].sourceAssetId)
        throw Error("Saved standing is required");
      return group;
    }),
  ).rejects.toThrow("Saved standing is required");
});

it("keeps the route's floor height when its calibrated body offset hands off to standing", () => {
  const scene = starterScene(),
    actor = scene.entities[0];
  const gait = capturedRouteGaits[0];
  scene.customMotions.push(gait);
  actor.position = [0, 0.7, 0];
  actor.clips = [
    { id: "stopped", motionId: gait.id, duration: 1, routeStop: 1 },
    ...standingHoldClips(recordedStanding[0], "wait", 32),
  ];
  const options = {
    routeEndOffset: () => [0.1, -0.04, 0.2] as [number, number, number],
  };
  for (const time of [2, 17, 32]) {
    const pose = entityPose(actor, scene, time, options);
    expect(pose.root[1]).toBeCloseTo(0.7, 10);
    // The body's horizontal offset still defines where it waits.
    const noOffset = entityPose(actor, scene, time);
    expect(pose.root[0] - noOffset.root[0]).toBeCloseTo(0.1, 10);
    expect(pose.root[2] - noOffset.root[2]).toBeCloseTo(0.2, 10);
  }
  actor.clips[1].stationary = undefined;
  expect(entityPose(actor, scene, 2, options).root[1]).toBeCloseTo(0.66, 10);
});
