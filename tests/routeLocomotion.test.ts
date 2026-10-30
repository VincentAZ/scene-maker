import { describe, expect, it } from "vitest";
import { allMotions, starterScene, type Motion } from "../shared/scene";
import { libraryMotions } from "../shared/motionLibrary";
import {
  defaultRouteLocomotion,
  matchingRouteLocomotion,
  namedRouteMovement,
  routeCycleTime,
  routeLocomotionFields,
  routeLocomotions,
  routePace,
} from "../src/routeLocomotion";

function fixture() {
  const scene = starterScene();
  const actor = scene.entities[0];
  actor.assetId = "original-character";
  actor.clips = [];
  scene.customAssets.push({
    id: actor.assetId,
    name: "Original performer",
    category: "characters",
    style: "Imported",
    url: "/uploads/original.glb",
    color: "#ffffff",
    skin: "#bf8866",
    body: "masculine",
    description: "",
  });
  const walk: Motion = {
    id: "native-walk",
    name: "Original easy walk",
    kind: "imported",
    duration: 1.4,
    distance: 0,
    poses: [],
    sourceAssetId: actor.assetId,
    animationName: "Walking_Loop",
  };
  scene.customMotions.push(walk);
  return { scene, actor, walk };
}

describe("route locomotion selection", () => {
  it("keeps procedural fallbacks, bundled gaits and uploaded clips without offering bundled non-gaits", () => {
    const { scene, actor, walk } = fixture();
    const unnamed = {
      ...walk,
      id: "take",
      name: "Take001",
      animationName: "Take001",
    };
    scene.customMotions.push(unnamed);
    const options = routeLocomotions(scene, actor);
    expect(options.map((motion) => motion.id)).toEqual(
      expect.arrayContaining([
        "walk",
        "run",
        "authored-walk",
        "authored-run",
        "authored-walk-carry",
        "native-walk",
        "take",
      ]),
    );
    expect(options.some((motion) => motion.id === "authored-jump")).toBe(false);
    expect(options.indexOf(walk)).toBeLessThan(
      options.findIndex((motion) => motion.id === "authored-walk"),
    );
    expect(namedRouteMovement(unnamed)).toBeUndefined();
  });

  it("prefers the character's own gait or most recent imported gait, then the authored library", () => {
    const { scene, actor, walk } = fixture();
    expect(defaultRouteLocomotion(scene, actor)).toBe(walk);
    const carry = libraryMotions.find(
      (motion) => motion.id === "authored-walk-carry",
    )!;
    actor.clips.push({ id: "carry", motionId: carry.id, duration: 3 });
    expect(defaultRouteLocomotion(scene, actor)).toBe(carry);
    actor.clips = [];
    scene.customMotions = [];
    expect(defaultRouteLocomotion(scene, actor).id).toBe("authored-walk");
    expect(defaultRouteLocomotion(scene, actor, "run").id).toBe("authored-run");
  });

  it("deduplicates route copies but preserves an existing route whose original action is gone", () => {
    const { scene, actor, walk } = fixture();
    const route: Motion = {
      ...walk,
      id: "route-copy",
      name: "Across the room",
      path: {
        points: [
          [0, 0, 0],
          [0, 0, 4],
        ],
        smooth: true,
      },
    };
    scene.customMotions.push(route);
    const options = routeLocomotions(scene, actor, route);
    expect(
      options.filter((motion) => motion.animationName === walk.animationName),
    ).toEqual([walk]);
    expect(matchingRouteLocomotion(options, route)).toBe(walk);
    scene.customMotions = [route];
    expect(
      matchingRouteLocomotion(routeLocomotions(scene, actor, route), route),
    ).toBe(route);
  });

  it("does not offer missing or non-character sources as new locomotion choices", () => {
    const { scene, actor, walk } = fixture();
    scene.customMotions.push(
      { ...walk, id: "missing", sourceAssetId: "missing" },
      { ...walk, id: "prop", sourceAssetId: "cup" },
    );
    const ids = routeLocomotions(scene, actor).map((motion) => motion.id);
    expect(ids).not.toContain("missing");
    expect(ids).not.toContain("prop");
  });

  it("copies only native identity, and removes native metadata when selecting a procedural gait", () => {
    const { scene, walk } = fixture();
    expect(routeLocomotionFields(walk)).toEqual({
      kind: "imported",
      sourceAssetId: walk.sourceAssetId,
      animationName: walk.animationName,
    });
    expect(
      routeLocomotionFields(
        allMotions(scene).find((motion) => motion.id === "run")!,
      ),
    ).toEqual({ kind: "run" });
    expect(() =>
      routeLocomotionFields({ ...walk, sourceAssetId: undefined }),
    ).toThrow("locomotion");
    expect(() => routeLocomotionFields({ ...walk, kind: "dance" })).toThrow(
      "locomotion",
    );
  });
});

describe("distance-driven original gait timing", () => {
  it("samples native cycles by distance rather than route duration or frame history", () => {
    expect(routeCycleTime(0, 1.5, 0.8)).toBe(0);
    expect(routeCycleTime(0.375, 1.5, 0.8)).toBeCloseTo(0.2);
    expect(routeCycleTime(1.875, 1.5, 0.8)).toBeCloseTo(0.2);
    expect(routeCycleTime(3, 1.5, 0.8)).toBe(0);
    for (const distance of [3.375, 0, 0.375, 12.375, 1.875])
      expect(routeCycleTime(distance, 1.5, 0.8)).toBeCloseTo(
        distance === 0 ? 0 : 0.2,
      );
  });

  it("uses measured stride/cycle duration for natural speed and scales it with the actor", () => {
    const { walk } = fixture();
    expect(routePace(walk, 1.5, { distance: 1.2, duration: 0.8 })).toBeCloseTo(
      2.25,
    );
    expect(() => routePace(walk)).toThrow("Measure this imported gait");
    expect(() => routePace({ ...walk, animationName: "Run_Carry" })).toThrow(
      "Measure this imported gait",
    );
    expect(routePace({ ...walk, kind: "walk" })).toBe(1.1);
    expect(routePace({ ...walk, kind: "run" })).toBe(2.6);
    for (const cycle of [
      { distance: -1, duration: -1 },
      { distance: 1, duration: Infinity },
      { distance: 0, duration: 1 },
    ])
      expect(() => routePace(walk, 1, cycle)).toThrow("pace");
    for (const args of [
      [NaN, 1, 1],
      [0, 0, 1],
      [0, 1, 0],
      [0, Infinity, 1],
    ])
      expect(() =>
        routeCycleTime(...(args as [number, number, number])),
      ).toThrow("cycle size");
    expect(() => routePace(walk, 0)).toThrow("pace");
  });
});
