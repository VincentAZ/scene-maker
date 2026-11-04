import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  compilePath,
  samplePath,
  pathToWorld,
  worldToPath,
  savePathCommands,
} from "../shared/path";
import { entityPose } from "../shared/animation";
import {
  starterScene,
  applyCommands,
  motionSchema,
  allAssets,
  type Motion,
} from "../shared/scene";
import { capturedRouteGaits } from "../shared/motionLibrary";
import { offlineCommands, offlinePlan } from "../server/ai";
import { validatePlan } from "../shared/studio";
import { createCharacter, applyAnimatedEntityPose } from "../src/world";
import { bakeAnimation } from "../src/bakeAnimation";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

// Routes travel on the recorded walking stride (its source take interval).
const stride = capturedRouteGaits[0];
const route = (): Motion => ({
  id: "route",
  name: "Arc around the crate",
  kind: "imported",
  sourceAssetId: stride.sourceAssetId,
  animationName: stride.animationName,
  duration: 8,
  distance: 0,
  poses: [],
  path: {
    points: [
      [0, 0, 0],
      [2, 0, 2],
      [4, 0, 0],
    ],
    smooth: true,
    sourceRange: { ...stride.path!.sourceRange! },
  },
});
function fixture() {
  const scene = starterScene();
  scene.entities = [scene.entities[0]];
  const actor = scene.entities[0];
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.clips = [];
  return { scene, actor };
}
describe("authored walking paths", () => {
  it("passes through authored points, travels at nearly constant speed, and follows the tangent", () => {
    const path = route().path!;
    expect(samplePath(path, 0).point).toEqual([0, 0, 0]);
    expect(
      new T.Vector3(...samplePath(path, 0.5).point).distanceTo(
        new T.Vector3(2, 0, 2),
      ),
    ).toBeLessThan(1e-8);
    expect(samplePath(path, 1).point).toEqual([4, 0, 0]);
    expect(samplePath(path, 0.5).heading).toBeCloseTo(Math.PI / 2, 5);
    expect(samplePath(path, 1).heading).toBeCloseTo(Math.PI * 0.75, 5);
    const deltas = Array.from({ length: 200 }, (_, i) =>
      new T.Vector3(...samplePath(path, (i + 1) / 200).point).distanceTo(
        new T.Vector3(...samplePath(path, i / 200).point),
      ),
    );
    expect(Math.max(...deltas) / Math.min(...deltas)).toBeLessThan(1.01);
    expect(compilePath(path).length).toBeGreaterThan(Math.sqrt(8) * 2);
  });
  it("turns continuously around a closed circle without a heading wrap or endpoint gap", () => {
    const { scene } = fixture();
    const output = offlineCommands(scene, "Mila walk in a circle");
    const next = applyCommands(scene, output.commands),
      path = next.customMotions[0].path!;
    let heading = 0;
    for (let i = 0; i <= 200; i++) {
      const sample = samplePath(path, i / 200);
      expect(Math.abs(sample.heading - heading)).toBeLessThan(0.06);
      heading = sample.heading;
    }
    expect(Math.abs(heading)).toBeCloseTo(Math.PI * 2, 5);
    expect(new T.Vector3(...samplePath(path, 1).point).length()).toBeLessThan(
      1e-8,
    );
  });
  it("carries root and facing through a preceding walk, scaled rotated path, gesture, and following walk", () => {
    const { scene, actor } = fixture();
    actor.position = [3, 0, -2];
    actor.rotation = 0.7;
    actor.scale = 1.4;
    const next = applyCommands(scene, [
      { type: "createMotion", motion: route() },
      { type: "chain", id: actor.id, motionId: "walk", duration: 4 },
      { type: "chain", id: actor.id, motionId: "route" },
      { type: "chain", id: actor.id, motionId: "wave", duration: 2 },
      { type: "chain", id: actor.id, motionId: "walk", duration: 4 },
    ]);
    // Studio Walk is a recording whose root travel is measured from its
    // loaded source; stand in a measured 2 m straight stride for it here.
    const options = {
      nativeRoot: (m: Motion) =>
        m.id === "walk"
          ? {
              start: [0, 0, 0] as [number, number, number],
              delta: [0, 0, 2] as [number, number, number],
            }
          : undefined,
    };
    // The recorded body carries that travel while the take plays (the rig's
    // root track), so the scene root advances by it when the take completes.
    const a = next.entities[0],
      start = entityPose(a, next, 4, options);
    expect(
      new T.Vector3(...start.root).distanceTo(
        new T.Vector3(
          ...pathToWorld([0, 0, 2], {
            position: actor.position,
            heading: actor.rotation,
            scale: actor.scale,
          }),
        ),
      ),
    ).toBeLessThan(1e-6);
    expect(start.heading).toBeCloseTo(actor.rotation, 5);
    const end = entityPose(a, next, 12, options),
      duringWave = entityPose(a, next, 13, options),
      final = entityPose(a, next, 18, options);
    const expected = pathToWorld([4, 0, 2], {
      position: actor.position,
      heading: actor.rotation,
      scale: actor.scale,
    });
    expect(
      new T.Vector3(...end.root).distanceTo(new T.Vector3(...expected)),
    ).toBeLessThan(1e-6);
    expect(end.heading).toBeCloseTo(actor.rotation + Math.PI * 0.75, 5);
    expect(duringWave.root).toEqual(end.root);
    expect(final.root[0] - end.root[0]).toBeCloseTo(
      Math.sin(end.heading!) * 2 * actor.scale,
      5,
    );
    expect(final.root[2] - end.root[2]).toBeCloseTo(
      Math.cos(end.heading!) * 2 * actor.scale,
      5,
    );
  });
  it("inherits native root travel before starting a route", () => {
    const { scene, actor } = fixture();
    scene.customMotions = [
      {
        ...route(),
        id: "native",
        kind: "imported",
        path: undefined,
        duration: 2,
        sourceAssetId: actor.assetId,
        animationName: "Travel",
      },
      route(),
    ];
    actor.clips = [
      { id: "n", motionId: "native", duration: 2 },
      { id: "r", motionId: "route", duration: 8 },
    ];
    const end = entityPose(actor, scene, 10, {
      nativeRoot: () => ({ start: [0, 0, 0], delta: [0, 0, 3] }),
    });
    expect(end.root).toEqual([4, 0, 3]);
  });
  it("keeps shared actions unchanged when one character's path is edited, preserves clip IDs, and rejects stale edits", () => {
    const { scene, actor } = fixture();
    const next = applyCommands(scene, [
      ...savePathCommands(scene, actor.id, route()),
      { type: "add", id: "other", assetId: "leo" },
      { type: "chain", id: "other", motionId: "route" },
    ]);
    const clip = next.entities[0].clips[0],
      edited = {
        ...route(),
        duration: 5,
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            [0, 0, 5],
          ] as [number, number, number][],
        },
      };
    const saved = applyCommands(
      next,
      savePathCommands(next, actor.id, edited, clip.id),
    );
    expect(saved.entities[0].clips[0].id).toBe(clip.id);
    expect(saved.entities[0].clips[0].duration).toBe(5);
    expect(saved.entities[0].clips[0].motionId).not.toBe("route");
    expect(saved.entities[1].clips[0].motionId).toBe("route");
    expect(saved.customMotions.find((m) => m.id === "route")).toEqual(route());
    expect(() =>
      applyCommands(saved, [
        { type: "updateMotion", motion: { ...edited, id: "walk" } },
      ]),
    ).toThrow("own actions");
    expect(() => savePathCommands(saved, actor.id, edited, clip.id)).toThrow(
      "changed",
    );
  });
  it("supports assistant route creation and editor navigation without accidentally appending every route", () => {
    const { scene, actor } = fixture();
    const first = applyCommands(
      scene,
      offlineCommands(scene, "Mila walk in a circle then wave").commands,
    );
    expect(first.entities[0].clips).toHaveLength(2);
    expect(first.customMotions).toHaveLength(1);
    expect(
      offlineCommands(first, "Mila Circle walk then wave").commands,
    ).toEqual([
      { type: "chain", id: actor.id, motionId: first.customMotions[0].id },
      { type: "chain", id: actor.id, motionId: "wave" },
    ]);
    const again = offlineCommands(first, "Mila walk then wave");
    expect(again.commands).toEqual([
      { type: "chain", id: actor.id, motionId: "walk" },
      { type: "chain", id: actor.id, motionId: "wave" },
    ]);
    const plan = offlinePlan(first, "Edit the path for Mila", undefined, {});
    expect(plan.steps[0]).toEqual({
      type: "pathEditor",
      actorId: actor.id,
      clipId: first.entities[0].clips[0].id,
    });
    expect(() =>
      validatePlan(
        { ...plan, steps: [...plan.steps, { type: "save" }] },
        first,
        () => first,
      ),
    ).toThrow("final step");
    expect(() =>
      validatePlan(
        {
          response: "Open",
          steps: [
            {
              type: "pathEditor",
              actorId: actor.id,
              clipId: first.entities[0].clips[1].id,
            },
          ],
        },
        first,
        () => first,
      ),
    ).toThrow("action no longer");
  });
  it("rejects malformed routes without changing the scene", () => {
    const { scene } = fixture();
    for (const invalid of [
      { ...route(), path: { smooth: true, points: [] } },
      { ...route(), kind: "wave" },
      {
        ...route(),
        path: {
          smooth: true,
          points: [
            [1, 0, 0],
            [2, 0, 0],
          ],
        },
      },
      {
        ...route(),
        path: {
          smooth: true,
          points: [
            [0, 0, 0],
            [0, 1, 0],
          ],
        },
      },
      {
        ...route(),
        path: {
          smooth: true,
          points: [
            [0, 0, 0],
            [0, 0, 0],
          ],
        },
      },
    ])
      expect(motionSchema.safeParse(invalid).success).toBe(false);
    expect(scene.customMotions).toEqual([]);
  });
  it("round-trips authoring coordinates and replays a baked route while scrubbing", () => {
    const frame = {
        position: [3, 1.2, -2] as [number, number, number],
        heading: 1.3,
        scale: 1.7,
      },
      local: [number, number, number] = [2, 0, -3];
    expect(
      new T.Vector3(
        ...worldToPath(pathToWorld(local, frame), frame),
      ).distanceTo(new T.Vector3(...local)),
    ).toBeLessThan(1e-6);
    const { scene, actor } = fixture();
    const next = applyCommands(
      scene,
      savePathCommands(scene, actor.id, route()),
    );
    const rig = withRecordedSources(
      createCharacter(allAssets(next).find((a) => a.id === actor.assetId)!),
      recordedSourceMap,
    );
    rig.name = "entity_" + actor.id;
    const sample = (time: number) =>
      applyAnimatedEntityPose(rig, next.entities[0], next, time);
    const animation = bakeAnimation([rig], 8, sample);
    sample(4);
    const middle = rig.position.clone(),
      rotation = rig.quaternion.clone();
    sample(8);
    sample(0);
    sample(4);
    expect(rig.position.distanceTo(middle)).toBeLessThan(1e-6);
    const mixer = new T.AnimationMixer(rig);
    mixer.clipAction(animation).setLoop(T.LoopOnce, 1).play();
    mixer.setTime(4);
    expect(rig.position.distanceTo(middle)).toBeLessThan(1e-6);
    expect(rig.quaternion.clone().normalize().angleTo(rotation)).toBeLessThan(
      1e-6,
    );
    // Baking evaluates the full recorded-stride pose (hand and foot contact
    // solves included) at every 60 fps sample and source-frame boundary of
    // the 8 s route: about 2.5 s alone, past the 5 s default on a loaded runner.
  }, 15000);
});
