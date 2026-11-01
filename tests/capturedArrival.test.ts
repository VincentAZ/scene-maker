import { beforeEach, expect, it, vi } from "vitest";
import * as T from "three";
import { applyCommands, characters, starterScene } from "../shared/scene";
import { createCharacter, createProp } from "../src/world";
import { configureImportedRig } from "../src/rig";
import type { LocomotionProfile } from "../src/locomotion";
import { compilePath } from "../shared/path";
import type { ArrivalMatch } from "../src/arrivalMatching";
import {
  proposeCapturedArrival,
  proposeCapturedArrivalSteps,
} from "../src/capturedArrival";
import { installArrivalRoutes } from "../src/navigationArrivals";
import { finishNavigationWork } from "../src/navigationWork";

// Matching quality and geometric sampling have their own real-data checks.
// Here a controlled admissible set exercises selection, retries, and rollback.
const state = vi.hoisted(() => ({
  profile: undefined as LocomotionProfile | undefined,
  pass: 0,
  distances: [] as number[][],
  checks: [] as number[],
  mode: "second" as "second" | "wider" | "blocked",
}));
vi.mock("../src/locomotion", async (original) => ({
  ...(await original<typeof import("../src/locomotion")>()),
  locomotionProfile: () => state.profile,
}));
vi.mock("../src/arrivalMatching", () => ({
  matchCapturedArrivalSteps: function* (
    _source: unknown,
    _take: unknown,
    _profile: unknown,
    _distance: unknown,
    plan: (start: number, end: number, distance: number) => number | undefined,
  ) {
    state.pass++;
    const distances: number[] = [];
    state.distances.push(distances);
    const matches: ArrivalMatch[] = [];
    for (const [index, start] of [1, 2].entries()) {
      yield;
      const distance = plan(start, 3.5, 3 - start);
      if (distance === undefined) continue;
      distances.push(distance);
      matches.push({
        sourceStart: start,
        sourceEnd: 3.5,
        prefixDistance: distance,
        prefixSourceDuration: distance + index * 0.1,
        tailDistance: 3 - start,
        support: 1,
        positionRms: 0,
        positionMax: 0,
        rotationRms: 0,
        rotationMax: 0,
        velocityRms: 0,
        angularVelocityRms: 0,
        scaleMax: 0,
        speedDifference: 0,
        morphMax: 0,
        score: index * 0.01,
      });
    }
    return {
      matches,
      match: matches[0],
      best: matches[0],
      examined: matches.length,
    };
  },
}));
vi.mock("../src/routeClearance", async (original) => ({
  ...(await original<typeof import("../src/routeClearance")>()),
  inspectRouteClearanceSteps: function* (
    scene: ReturnType<typeof starterScene>,
    objects: Map<string, T.Group>,
    actorId: string,
    _clipId: string,
    _environment: unknown,
    options: { stopAtFirstConflict?: boolean },
  ) {
    expect(options.stopAtFirstConflict).toBe(true);
    const entry = scene.entities.find((e) => e.id === actorId)!.clips[1]
      .sourceStart!;
    state.checks.push(entry);
    objects.get(actorId)!.position.x = 99;
    yield;
    const blocked =
      state.mode === "blocked" ||
      (state.mode === "wider" ? state.pass === 1 : entry === 1);
    return { blocked: blocked ? "Obstacle" : null, radius: 1, conflicts: [] };
  },
}));
beforeEach(() => {
  state.pass = 0;
  state.distances = [];
  state.checks = [];
  state.mode = "second";
});
function fixture() {
  const scene = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "actor", position: [0, 0, 0] },
    { type: "add", assetId: "crate", id: "crate", position: [1, 0, 3] },
  ]);
  const group = new T.Group(),
    body = createCharacter(characters[0]);
  group.add(body);
  const take = new T.AnimationClip("walk-stop", 4, [
    new T.VectorKeyframeTrack(
      body.uuid + ".position",
      [0, 3, 4],
      [0, 0, 0, 0, 0, 3, 0, 0, 3],
    ),
  ]);
  configureImportedRig(group, body, [take]);
  scene.customMotions.push({
    id: "route",
    name: "Route",
    kind: "imported",
    sourceAssetId: "mila",
    animationName: take.name,
    duration: 8,
    distance: 0,
    poses: [],
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 6],
      ],
      smooth: false,
    },
  });
  scene.entities[0].clips = [
    { id: "route-clip", motionId: "route", duration: 8, playbackRate: 1 },
  ];
  state.profile = {
    duration: 4,
    distance: 3,
    startHeading: 0,
    mode: "travel",
    warning: "",
    frames: Array.from({ length: 81 }, (_, i) => ({
      time: i / 20,
      distance: Math.min(i / 20, 3),
      center: new T.Vector3(0, 0, Math.min(i / 20, 3)),
      heading: 0,
    })),
    stops: [{ settled: 3, end: 4, sourceEnd: 3.5, entries: [] }],
  };
  const objects = new Map([
    ["actor", group],
    ["crate", createProp("crate", "#888888")],
  ]);
  const pose = () => {
    const saved: number[] = [];
    for (const root of objects.values())
      root.traverse((n) =>
        saved.push(
          ...n.position.toArray(),
          ...n.quaternion.toArray(),
          ...n.scale.toArray(),
        ),
      );
    return saved;
  };
  return { scene, group, objects, pose };
}
it("tries the next admissible entry after obstruction without leaking rejected clips or sampled poses", () => {
  const f = fixture(),
    before = JSON.stringify(f.scene),
    pose = f.pose();
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.match.sourceStart).toBe(2);
  expect(result.attempts.map((a) => a.reason)).toEqual([
    "The captured arrival overlaps Obstacle.",
    undefined,
  ]);
  expect(result.scene.entities[0].clips).toHaveLength(2);
  expect(result.scene.customMotions).toHaveLength(3);
  expect(result.scene.entities[0].clips[1].playbackRate).toBe(1);
  expect(result.destination).toEqual([0, 0, 6]);
  expect(f.pose()).toEqual(pose);
  expect(JSON.stringify(f.scene)).toBe(before);
});
it("keeps adapted prefix steps at their source rate and preserves the unscaled native stopping tail", () => {
  const f = fixture();
  f.scene.customMotions[0].path!.strideScale = 1.05;
  f.scene.customMotions[0].path!.points[1][2] = 6.3;
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  const clips = result.scene.entities[0].clips;
  const prefix = result.scene.customMotions.find(
    (m) => m.id === clips[0].motionId,
  )!;
  const tail = result.scene.customMotions.find(
    (m) => m.id === clips[1].motionId,
  )!;
  expect(prefix.path?.strideScale).toBe(1.05);
  expect(tail.path).toBeUndefined();
  expect(result.match.prefixDistance).toBeCloseTo(
    compilePath(prefix.path!).length / 1.05,
    8,
  );
  expect(clips[1].playbackRate).toBe(1);
  expect(prefix.path!.points.at(-1)![2]).toBeCloseTo(5.3, 8);
  expect(result.destination).toEqual([0, 0, 6.3]);
});
it("re-matches a wider approach after every candidate at the first clearance is blocked", () => {
  const f = fixture();
  state.mode = "wider";
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.attempts.map((a) => a.pass)).toEqual([1, 1, 2]);
  expect(result.attempts[2].clearance).toBeGreaterThan(
    result.attempts[0].clearance,
  );
  expect(state.distances[1]).not.toEqual(state.distances[0]);
  expect(result.match.prefixDistance).toBe(state.distances[1][0]);
});
it("keeps the original scene and reports all attempts when no entry clears", () => {
  const f = fixture(),
    before = JSON.stringify(f.scene),
    pose = f.pose();
  state.mode = "blocked";
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("reason" in result).toBe(true);
  expect(result.attempts?.length).toBe(3);
  expect(result.attempts?.length).toBe(state.distances.flat().length);
  expect(result.attempts?.every((a) => a.reason?.includes("Obstacle"))).toBe(
    true,
  );
  expect(f.pose()).toEqual(pose);
  expect(JSON.stringify(f.scene)).toBe(before);
});
it("restores source and object poses when cancelled in a candidate's clearance scan", () => {
  const f = fixture(),
    pose = f.pose(),
    work = proposeCapturedArrivalSteps(
      f.scene,
      f.objects,
      "actor",
      "route-clip",
    );
  while (!state.checks.length) {
    expect(work.next().done).toBe(false);
  }
  expect(f.group.position.x).toBe(99);
  work.return({ reason: "Cancelled" });
  expect(f.pose()).toEqual(pose);
});
it("honors an explicit collision override without changing the captured pace", () => {
  const f = fixture();
  f.scene.animationCollisions = false;
  state.mode = "blocked";
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.match.sourceStart).toBe(1);
  expect(result.clearanceChecked).toBe(false);
  expect(result.playbackRate).toBe(1);
  expect(state.checks).toEqual([]);
});

it("tries a later compatible entry when the best one misses an explicitly fixed ending", () => {
  const f = fixture();
  f.scene.animationCollisions = false;
  proposeCapturedArrival(f.scene, f.objects, "actor", "route-clip");
  const scheduledEnd = state.distances[0][1] + 0.1 + 1.5;
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
    undefined,
    { scheduledEnd },
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.match.sourceStart).toBe(2);
  expect(result.attempts[0].reason).toContain("fixed ending");
  expect(
    result.scene.entities[0].clips.reduce((sum, c) => sum + c.duration, 0),
  ).toBeCloseTo(scheduledEnd, 10);
  expect(result.playbackRate).toBe(1);
});

it("can replace a blocked ordinary endpoint with a fully checked captured arrival at the current point intent", () => {
  const f = fixture();
  f.scene.entities[0].clips[0].navigation = {
    point: [0, 0, 7],
    endHeading: 0.3,
    movement: "walk",
  };
  const proposal = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in proposal).toBe(true);
  if (!("scene" in proposal)) return;
  expect(proposal.destination).toEqual([0, 0, 7]);
  expect(proposal.endHeading).toBe(0.3);
  expect(proposal.playbackRate).toBe(1);
  const result = finishNavigationWork(
    installArrivalRoutes(
      {
        scene: f.scene,
        playbackScene: f.scene,
        issues: [
          {
            actorId: "actor",
            clipId: "route-clip",
            message: "Ordinary gait endpoint blocked",
          },
        ],
      },
      [],
      f.objects,
    ),
  );
  expect(result.issues).toEqual([]);
  expect(result.scene.entities[0].clips[0].navigation?.arrival).toBeDefined();
  expect(result.scene.entities[0].clips[0].navigation?.point).toEqual([
    0, 0, 7,
  ]);
});

it("resolves a moved object's current geometry before recovering a blocked arrival", () => {
  const f = fixture(),
    pose = f.pose();
  f.scene.entities[0].clips[0].navigation = {
    targetId: "crate",
    movement: "walk",
  };
  f.scene.entities[1].position = [2, 0, 5];
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.destination).not.toEqual([0, 0, 6]);
  expect(
    Math.hypot(result.destination[0] - 2, result.destination[2] - 5),
  ).toBeLessThan(1.2);
  expect(result.endHeading).toBeCloseTo(
    Math.atan2(2 - result.destination[0], 5 - result.destination[2]),
    8,
  );
  expect(result.playbackRate).toBe(1);
  expect(f.pose()).toEqual(pose);
  const installed = finishNavigationWork(
    installArrivalRoutes(
      {
        scene: f.scene,
        playbackScene: f.scene,
        issues: [
          {
            actorId: "actor",
            clipId: "route-clip",
            message: "Ordinary endpoint blocked",
          },
        ],
      },
      [],
      f.objects,
    ),
  );
  expect(installed.issues).toEqual([]);
  expect(installed.scene.entities[0].clips[0].navigation?.targetId).toBe(
    "crate",
  );
  expect(
    installed.scene.entities[0].clips[0].navigation?.arrival,
  ).toBeDefined();
  expect(f.scene.customMotions).toHaveLength(1);
});

it("tries another current object destination when every source entry at the nearest side is blocked", () => {
  const f = fixture();
  state.mode = "wider";
  f.scene.entities[0].clips[0].navigation = {
    targetId: "crate",
    movement: "walk",
  };
  const result = proposeCapturedArrival(
    f.scene,
    f.objects,
    "actor",
    "route-clip",
  );
  expect("scene" in result).toBe(true);
  if (!("scene" in result)) return;
  expect(result.attempts[0].reason).toContain("overlaps");
  expect(result.attempts.at(-1)!.destination).not.toEqual(
    result.attempts[0].destination,
  );
  expect(result.attempts.at(-1)!.pass).toBe(1);
  expect(result.playbackRate).toBe(1);
});

it.each(["missing", "invisible", "animated"])(
  "does not recover an invalid %s object target using the old route endpoint",
  (kind) => {
    const f = fixture();
    f.scene.entities[0].clips[0].navigation = {
      targetId: kind === "missing" ? "gone" : "crate",
      movement: "walk",
    };
    if (kind === "invisible") f.scene.entities[1].visible = false;
    if (kind === "animated")
      f.scene.entities[1].clips = [
        { id: "move-target", motionId: "walk", duration: 4 },
      ];
    const issue = {
      actorId: "actor",
      clipId: "route-clip",
      message: "Object destination blocked",
    };
    const result = finishNavigationWork(
      installArrivalRoutes(
        { scene: f.scene, playbackScene: f.scene, issues: [issue] },
        [],
        f.objects,
      ),
    );
    expect(result.scene).toBe(f.scene);
    expect(result.issues).toEqual([issue]);
    expect(state.checks).toEqual([]);
  },
);

it("does not plan beyond an unreachable predecessor", () => {
  const f = fixture(),
    clip = f.scene.entities[0].clips[0];
  clip.navigation = { point: [0, 0, 7], movement: "walk" };
  f.scene.entities[0].clips.unshift({ ...clip, id: "unreachable" });
  const predecessor = {
    actorId: "actor",
    clipId: "unreachable",
    message: "Predecessor blocked",
  };
  const result = finishNavigationWork(
    installArrivalRoutes(
      { scene: f.scene, playbackScene: f.scene, issues: [predecessor] },
      [],
      f.objects,
    ),
  );
  expect(result.scene).toBe(f.scene);
  expect(result.issues).toEqual([predecessor]);
  expect(state.checks).toEqual([]);
});
