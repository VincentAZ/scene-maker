import { expect, it } from "vitest";
import * as T from "three";
import {
  applyCommands,
  starterScene,
  validateScene,
  type Scene,
  type Motion,
} from "../shared/scene";
import {
  capturedArrivalGaits,
  capturedRouteGaits,
} from "../shared/motionLibrary";
import {
  expandArrivalRequests,
  installArrivalRoutes,
} from "../src/navigationArrivals";
import { finishNavigationWork } from "../src/navigationWork";
import { appendSpeech, dialogueTiming } from "../shared/conversation";

function fixture() {
  const scene = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", id: "actor", assetId: "mila", position: [0, 0, 0] },
  ]);
  const base: Motion = {
    id: "full-route",
    name: "Destination",
    kind: "imported",
    duration: 4,
    distance: 0,
    poses: [],
    // The recorded gradual-stop take, routed and then played to its stop.
    sourceAssetId: capturedArrivalGaits.sourceAssetId,
    animationName: capturedArrivalGaits.animationName,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 6],
      ],
      smooth: false,
    },
  };
  scene.customMotions = [
    base,
    {
      ...base,
      id: "prefix",
      duration: 3,
      path: {
        points: [
          [0, 0, 0],
          [0, 0, 5],
        ],
        smooth: false,
      },
    },
    { ...base, id: "tail", path: undefined },
  ];
  scene.entities[0].clips = [
    {
      id: "route",
      motionId: "prefix",
      duration: 3,
      playbackRate: 1,
      navigation: {
        point: [0, 0, 6],
        endHeading: 0,
        movement: "walk",
        arrival: { clipId: "stop", motionId: base.id, duration: 4 },
      },
    },
    {
      id: "stop",
      motionId: "tail",
      duration: 1.5,
      sourceStart: 0.2,
      playbackRate: 1,
      transition: "smooth",
    },
  ];
  scene.transcript = [
    {
      characterId: "actor",
      name: "Mila",
      text: "Over here.",
      clipId: "route",
      clipIds: ["route", "stop"],
    },
  ];
  return validateScene(scene);
}

it("persists the complete destination and reconstructs the original route clock without mutating the pair", () => {
  const scene = validateScene(JSON.parse(JSON.stringify(fixture()))),
    before = structuredClone(scene);
  const expanded = expandArrivalRequests(scene);
  expect(expanded.pairs).toHaveLength(1);
  expect(expanded.pairs[0].end).toBe(4.5);
  expect(expanded.scene.entities[0].clips).toEqual([
    {
      id: "route",
      motionId: "full-route",
      duration: 4,
      playbackRate: 1,
      navigation: { point: [0, 0, 6], endHeading: 0, movement: "walk" },
    },
  ]);
  expect(expanded.scene.customMotions.map((m) => m.id)).toEqual(["full-route"]);
  expect(expanded.scene.transcript[0].clipIds).toEqual(["route"]);
  expect(scene).toEqual(before);
});

it("retains the pair during placement edits and when later actions are appended", () => {
  const scene = applyCommands(fixture(), [
    {
      type: "update",
      id: "actor",
      changes: { position: [2, 0, -1], rotation: 0.7 },
    },
    { type: "chain", id: "actor", motionId: "wave", duration: 2 },
  ]);
  expect(scene.entities[0].clips[0].navigation?.arrival?.clipId).toBe("stop");
  expect(
    expandArrivalRequests(scene).scene.entities[0].clips.map((c) => c.motionId),
  ).toEqual(["full-route", "wave"]);
});

it.each(["prefix pace", "stop range", "stop pace"])(
  "releases navigation ownership after an explicit %s edit",
  (kind) => {
    const scene = fixture(),
      clips = structuredClone(scene.entities[0].clips);
    if (kind === "prefix pace") clips[0].duration = 3.2;
    if (kind === "stop range") clips[1].sourceStart = 0.4;
    if (kind === "stop pace") clips[1].playbackRate = 2;
    const edited = applyCommands(scene, [
      { type: "update", id: "actor", changes: { clips } },
    ]);
    expect(edited.entities[0].clips[0].navigation).toBeUndefined();
    expect(edited.entities[0].clips[1]).toEqual(clips[1]);
    expect(expandArrivalRequests(edited).pairs).toEqual([]);
  },
);

it("releases the pairing when its approach geometry is edited", () => {
  const scene = fixture(),
    motion = scene.customMotions.find((m) => m.id === "prefix")!;
  const edited = applyCommands(scene, [
    {
      type: "updateMotion",
      motion: {
        ...motion,
        path: {
          points: [
            [0, 0, 0],
            [1, 0, 5],
          ],
          smooth: false,
        },
      },
    },
  ]);
  expect(edited.entities[0].clips[0].navigation).toBeUndefined();
  expect(edited.entities[0].clips).toHaveLength(2);
});

it.each(["remove", "reorder"])(
  "releases a pair when its stop is explicitly %s",
  (kind) => {
    const edited = applyCommands(fixture(), [
      kind === "remove"
        ? { type: "removeClip", id: "actor", clipId: "stop" }
        : {
            type: "reorderClip",
            id: "actor",
            clipId: "stop",
            direction: "earlier",
          },
    ]);
    expect(
      edited.entities[0].clips.find((c) => c.id === "route")!.navigation,
    ).toBeUndefined();
    expect(expandArrivalRequests(edited).pairs).toEqual([]);
  },
);

it("rejects missing or incompatible saved pair references", () => {
  for (const edit of [
    (s: Scene) => {
      s.entities[0].clips[0].navigation!.arrival!.clipId = "missing";
    },
    (s: Scene) => {
      s.entities[0].clips[0].navigation!.arrival!.motionId = "idle";
    },
    (s: Scene) => {
      // The stop plays a different recording than the routed arrival.
      s.customMotions[2].animationName = capturedRouteGaits[1].animationName;
    },
    (s: Scene) => {
      s.entities[0].clips[0].navigation!.arrival!.motionId = "prefix";
    },
    (s: Scene) => {
      delete s.entities[0].clips[1].sourceStart;
    },
  ]) {
    const scene = fixture();
    edit(scene);
    expect(() => validateScene(scene)).toThrow("captured arrival");
  }
});

it("keeps invisible pairs intact", () => {
  const scene = fixture();
  scene.entities[0].visible = false;
  expect(expandArrivalRequests(scene)).toEqual({ scene, pairs: [] });
});

it("keeps the recoverable saved arrival when regeneration fails", () => {
  const original = fixture(),
    expanded = expandArrivalRequests(original);
  const next = finishNavigationWork(
    installArrivalRoutes(
      {
        scene: expanded.scene,
        playbackScene: expanded.scene,
        issues: [],
      },
      expanded.pairs,
      new Map([["actor", new T.Group()]]),
    ),
  );
  expect(next.issues).toHaveLength(1);
  expect(next.issues[0].clipId).toBe("route");
  expect(next.scene).toEqual(original);
});

it("retimes dependent dialogue through expansion and failed-arrival restoration", () => {
  const original = appendSpeech(
    applyCommands(fixture(), [
      { type: "add", id: "partner", assetId: "leo", position: [4, 0, 0] },
    ]),
    "partner",
    { dialogue: "I see you.", action: "talk" },
  );
  const expanded = expandArrivalRequests(original);
  expect(
    dialogueTiming(expanded.scene, expanded.scene.transcript[1])!.start,
  ).toBe(4);
  const restored = finishNavigationWork(
    installArrivalRoutes(
      { scene: expanded.scene, playbackScene: expanded.scene, issues: [] },
      expanded.pairs,
      new Map([["actor", new T.Group()]]),
    ),
  );
  expect(restored.issues).toHaveLength(1);
  expect(restored.scene).toEqual(original);
  expect(
    dialogueTiming(restored.scene, restored.scene.transcript[1])!.start,
  ).toBe(4.5);
});

it("retains automatic ownership when the requested destination is explicitly changed", () => {
  const scene = fixture(),
    clips = structuredClone(scene.entities[0].clips);
  clips[0].navigation!.point = [1, 0, 6];
  const next = applyCommands(scene, [
    { type: "update", id: "actor", changes: { clips } },
  ]);
  expect(next.entities[0].clips[0].navigation?.point).toEqual([1, 0, 6]);
  expect(next.entities[0].clips[0].navigation?.arrival?.clipId).toBe("stop");
});

it("does not expand or re-match an arrival already verified for the current scene", () => {
  const original = fixture();
  const expanded = expandArrivalRequests(
    original,
    new Set([JSON.stringify(["actor", "route"])]),
  );
  expect(expanded.scene).toBe(original);
  expect(expanded.pairs).toEqual([]);
  const installed = finishNavigationWork(
    installArrivalRoutes(
      {
        scene: original,
        playbackScene: original,
        issues: [],
      },
      [],
      new Map(),
    ),
  );
  expect(installed.scene).toBe(original);
  expect(installed.issues).toEqual([]);
});

it("leaves saved arrival clips and intent intact when collisions are explicitly disabled", async () => {
  const { prepareAutomaticRoutes } = await import("../src/automaticRoutes");
  const original = applyCommands(fixture(), [
    { type: "scene", changes: { animationCollisions: false } },
  ]);
  const prepared = prepareAutomaticRoutes(original, new Map());
  expect(prepared.scene).toBe(original);
  expect(prepared.playbackScene).toBe(original);
  expect(prepared.issues).toEqual([]);
  expect(prepared.scene.entities[0].clips[0].navigation?.arrival).toBeDefined();
});
