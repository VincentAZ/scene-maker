import { describe, expect, it } from "vitest";
import * as T from "three";
import { entityPose } from "../shared/animation";
import {
  compilePath,
  pathActionClips,
  pathToWorld,
  savePathCommands,
  samplePath,
  type PointAction,
} from "../shared/path";
import {
  allAssets,
  allMotions,
  applyCommands,
  starterScene,
  type Motion,
} from "../shared/scene";
import { capturedRouteGaits } from "../shared/motionLibrary";
import { createCharacter, applyAnimatedEntityPose } from "../src/world";
import { bakeAnimation } from "../src/bakeAnimation";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

// Routes travel on the recorded walking stride (its source take interval).
const stride = capturedRouteGaits[0];
const route = (): Motion => ({
  id: "four-stops",
  name: "Four stops",
  kind: "imported",
  sourceAssetId: stride.sourceAssetId,
  animationName: stride.animationName,
  duration: 12,
  distance: 0,
  poses: [],
  path: {
    smooth: true,
    points: [
      [0, 0, 0],
      [2, 0, 2],
      [4, 0, 0],
      [3, 0, -2],
      [0, 0, -1],
    ],
    endHeading: -1.2,
    sourceRange: { ...stride.path!.sourceRange! },
  },
});
const actions: PointAction[] = [
  { pointIndex: 1, motionId: "wave", duration: 1 },
  { pointIndex: 2, motionId: "bow", duration: 2 },
  { pointIndex: 3, motionId: "talk", duration: 3 },
  { pointIndex: 4, motionId: "idle", duration: 4 },
];
function fixture() {
  const scene = starterScene();
  scene.entities = [scene.entities[0]];
  const actor = scene.entities[0];
  actor.clips = [];
  actor.position = [3, 0, -2];
  actor.rotation = 0.7;
  actor.scale = 1.4;
  return { scene, actor };
}
// Studio Walk is a recording whose root travel is measured from its loaded
// source; stand in a measured 2 m straight stride for it in scene poses.
const walkTravel = {
  nativeRoot: (m: Motion) =>
    m.id === "walk"
      ? {
          start: [0, 0, 0] as [number, number, number],
          delta: [0, 0, 2] as [number, number, number],
        }
      : undefined,
};
const delta = (a: number[], b: number[]) =>
  Math.hypot(...a.map((n, i) => n - b[i]));

describe("route point actions materialized as sequence clips", () => {
  it("plays four independent gestures at the exact numbered points and keeps the final facing and following walk", () => {
    const { scene, actor } = fixture();
    const withBefore = applyCommands(scene, [
      { type: "chain", id: actor.id, motionId: "walk", duration: 2 },
    ]);
    const before = entityPose(
      withBefore.entities[0],
      withBefore,
      2,
      walkTravel,
    );
    const next = applyCommands(
      withBefore,
      savePathCommands(withBefore, actor.id, route(), undefined, actions),
    );
    const e = next.entities[0];
    const library = allMotions(next);
    const frame = {
      position: before.root,
      heading: before.heading!,
      scale: actor.scale,
    };
    let time = 0,
      stop = 0;
    for (const clip of e.clips) {
      const motion = library.find((m) => m.id === clip.motionId)!;
      if (time >= 2 && !motion.path) {
        const expected = pathToWorld(route().path!.points[stop + 1], frame);
        expect(
          delta(entityPose(e, next, time, walkTravel).root, expected),
        ).toBeLessThan(1e-7);
        expect(
          delta(
            entityPose(e, next, time + clip.duration / 2, walkTravel).root,
            expected,
          ),
        ).toBeLessThan(1e-7);
        // The gesture plays as its own recorded take at this point.
        expect(clip.motionId).toBe(actions[stop].motionId);
        expect(clip.duration).toBe(actions[stop].duration);
        stop++;
      }
      time += clip.duration;
    }
    expect(stop).toBe(4);
    expect(time).toBeCloseTo(24, 9); // preceding walk + movement + all four actions
    const end = entityPose(e, next, time, walkTravel);
    const desiredHeading = frame.heading + samplePath(route().path!, 1).heading;
    expect(Math.cos(end.heading! - desiredHeading)).toBeCloseTo(1, 9);
    const following = applyCommands(next, [
      { type: "chain", id: actor.id, motionId: "walk", duration: 2 },
    ]);
    const final = entityPose(
      following.entities[0],
      following,
      time + 2,
      walkTravel,
    );
    expect(final.root[0] - end.root[0]).toBeCloseTo(
      Math.sin(desiredHeading) * 2 * actor.scale,
      8,
    );
    expect(final.root[2] - end.root[2]).toBeCloseTo(
      Math.cos(desiredHeading) * 2 * actor.scale,
      8,
    );
  });

  it("retains the whole smooth route geometry rather than cutting corners between stops", () => {
    const motion = route();
    const parts = pathActionClips(motion, actions);
    const original = compilePath(motion.path!);
    let root: [number, number, number] = [0, 0, 0],
      heading = 0,
      length = 0;
    for (const part of parts.filter((p) => !p.action)) {
      const path = part.motion.path!;
      for (let i = 0; i <= 100; i++) {
        const world = pathToWorld(samplePath(path, i / 100).point, {
          position: root,
          heading,
          scale: 1,
        });
        const nearest = Math.min(
          ...original.samples.map((s) => delta(world, s.point)),
        );
        expect(nearest).toBeLessThan(0.065);
      }
      root = pathToWorld(samplePath(path, 1).point, {
        position: root,
        heading,
        scale: 1,
      });
      heading += samplePath(path, 1).heading;
      length += compilePath(path).length;
    }
    expect(delta(root, motion.path!.points.at(-1)!)).toBeLessThan(1e-8);
    expect(Math.abs(length - original.length)).toBeLessThan(0.03);
  });

  it("replaces the original clip in place, keeps its ID, and isolates shared motions", () => {
    const { scene, actor } = fixture();
    const before = applyCommands(scene, [
      ...savePathCommands(scene, actor.id, route()),
      { type: "chain", id: actor.id, motionId: "wave" },
      { type: "add", id: "other", assetId: "leo" },
      { type: "chain", id: "other", motionId: route().id },
    ]);
    const originalClip = before.entities[0].clips[0],
      afterClip = before.entities[0].clips[1];
    const next = applyCommands(
      before,
      savePathCommands(before, actor.id, route(), originalClip.id, actions),
    );
    expect(next.entities[0].clips[0].id).toBe(originalClip.id);
    expect(next.entities[0].clips.at(-1)).toEqual(afterClip);
    expect(next.entities[0].clips[0].motionId).not.toBe(route().id);
    expect(next.entities[1].clips[0].motionId).toBe(route().id);
    expect(next.customMotions.find((m) => m.id === route().id)).toEqual(
      route(),
    );
    expect(() =>
      savePathCommands(next, actor.id, route(), originalClip.id, actions),
    ).toThrow("changed");
    const exclusive = applyCommands(
      scene,
      savePathCommands(scene, actor.id, route()),
    );
    const updated = applyCommands(
      exclusive,
      savePathCommands(
        exclusive,
        actor.id,
        route(),
        exclusive.entities[0].clips[0].id,
        actions,
      ),
    );
    expect(updated.entities[0].clips[0].motionId).toBe(route().id);
    expect(
      updated.customMotions.filter((m) => m.id === route().id),
    ).toHaveLength(1);
  });

  it("leaves route-only saves unchanged and enforces duration, safe action, clip and custom-motion limits", () => {
    const { scene, actor } = fixture();
    expect(savePathCommands(scene, actor.id, route(), undefined, [])).toEqual(
      savePathCommands(scene, actor.id, route()),
    );
    for (const action of [
      { ...actions[0], duration: NaN },
      { ...actions[0], duration: 0.1 },
      { ...actions[0], duration: 61 },
      { ...actions[0], pointIndex: 0 },
      { ...actions[0], pointIndex: 5 },
      { ...actions[0], motionId: "walk" },
    ])
      expect(() => pathActionClips(route(), [action as PointAction])).toThrow(
        "in-place",
      );
    expect(() => pathActionClips(route(), [actions[0], actions[0]])).toThrow(
      "one",
    );
    expect(() =>
      pathActionClips({ ...route(), duration: 0.2 }, actions),
    ).toThrow("movement duration");
    actor.clips = Array.from({ length: 99 }, (_, i) => ({
      id: `clip-${i}`,
      motionId: "idle",
      duration: 1,
    }));
    expect(() =>
      savePathCommands(scene, actor.id, route(), undefined, actions),
    ).toThrow("100 sequence clips");
    actor.clips = [];
    scene.customMotions = Array.from({ length: 99 }, (_, i) => ({
      ...route(),
      id: `motion-${i}`,
    }));
    expect(() =>
      savePathCommands(scene, actor.id, route(), undefined, actions),
    ).toThrow("100 custom actions");
  });

  it("does not split a dialogue-linked route", () => {
    const { scene, actor } = fixture();
    const before = applyCommands(
      scene,
      savePathCommands(scene, actor.id, route()),
    );
    const clipId = before.entities[0].clips[0].id;
    before.transcript = [
      { characterId: actor.id, name: actor.name, text: "Hello", clipId },
    ];
    expect(() =>
      savePathCommands(before, actor.id, route(), clipId, actions),
    ).toThrow("dialogue routes");
  });

  it("keeps long straight and closed routes valid after local rotation and clip splitting", () => {
    const { scene, actor } = fixture();
    for (const points of [
      [
        [0, 0, 0],
        [50, 0, 50],
        [-50, 0, -50],
        [0, 0, 0],
      ],
      [
        [0, 0, 0],
        [0.05, 0, 0],
        [0.05, 0, 0.05],
        [0, 0, 0],
      ],
      [
        [0, 0, 0],
        [1, 0, 1],
        [-1, 0, 1],
        [0, 0, 0],
      ],
    ] as [number, number, number][][]) {
      const motion = { ...route(), path: { points, smooth: true } };
      const next = applyCommands(
        scene,
        savePathCommands(scene, actor.id, motion, undefined, [
          { ...actions[0], pointIndex: points.length - 1 },
        ]),
      );
      const end = entityPose(next.entities[0], next, 13);
      expect(delta(end.root, actor.position)).toBeLessThan(1e-6);
    }
  });

  it("bakes the same waypoint poses for export and supports deterministic scrubbing", () => {
    const { scene, actor } = fixture();
    const next = applyCommands(
      scene,
      savePathCommands(scene, actor.id, route(), undefined, actions),
    );
    const rig = withRecordedSources(
      createCharacter(allAssets(next).find((a) => a.id === actor.assetId)!),
      recordedSourceMap,
    );
    const sample = (time: number) =>
      applyAnimatedEntityPose(rig, next.entities[0], next, time);
    const total = 22;
    const animation = bakeAnimation([rig], total, sample);
    for (const time of [3, 6, 10, 16, 21]) {
      sample(time);
      const position = rig.position.clone(),
        rotation = rig.quaternion.clone();
      sample(total);
      sample(0);
      sample(time);
      expect(rig.position.distanceTo(position)).toBeLessThan(1e-7);
      const mixer = new T.AnimationMixer(rig);
      mixer.clipAction(animation).setLoop(T.LoopOnce, 1).play();
      mixer.setTime(time);
      expect(rig.position.distanceTo(position)).toBeLessThan(1e-6);
      expect(rig.quaternion.clone().normalize().angleTo(rotation)).toBeLessThan(
        1e-6,
      );
      mixer.stopAllAction();
    }
    // Every baked frame retargets recorded takes (stride and four gestures),
    // which is far slower than the old formula poses.
  }, 30_000);
});

it("keeps original imported gait identity on every movement fragment between point actions", () => {
  const imported: Motion = {
    ...route(),
    kind: "imported",
    sourceAssetId: "quaternius-action-source",
    animationName: "Walk_Carry",
  };
  const parts = pathActionClips(imported, actions);
  const moving = parts.filter((part) => !part.action);
  expect(moving).toHaveLength(4);
  for (const part of moving) {
    expect(part.motion).toMatchObject({
      kind: "imported",
      sourceAssetId: imported.sourceAssetId,
      animationName: imported.animationName,
      distance: 0,
      poses: [],
    });
    expect(part.motion.path).toBeDefined();
  }
  expect(
    moving.reduce((sum, part) => sum + part.motion.duration, 0),
  ).toBeCloseTo(imported.duration);
  const { scene, actor } = fixture();
  expect(() =>
    applyCommands(
      scene,
      savePathCommands(scene, actor.id, imported, undefined, actions),
    ),
  ).not.toThrow();
});
