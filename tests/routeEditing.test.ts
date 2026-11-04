import { describe, expect, it } from "vitest";
import {
  allMotions,
  applyCommands,
  starterScene,
  validateScene,
  type Motion,
  type Scene,
} from "../shared/scene";
import {
  appendSpeech,
  dialogueTiming,
  pathableClip,
  setDialoguePath,
} from "../shared/conversation";
import { savePathCommands } from "../shared/path";
import { pathActionClips } from "../shared/path";
import { capturedRouteGaits } from "../shared/motionLibrary";

function fixture() {
  return applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", id: "actor", assetId: "mila" },
    { type: "add", id: "other", assetId: "leo" },
  ]);
}
const route = (): Motion => ({
  id: "imported-route",
  name: "Authored walking route",
  kind: "imported",
  sourceAssetId: "quaternius-action-source",
  animationName: "Walk_Carry",
  duration: 12,
  distance: 0,
  poses: [],
  path: {
    smooth: false,
    points: [
      [0, 0, 0],
      [0, 0, 2],
      [2, 0, 2],
    ],
  },
});
const roundTrip = (scene: Scene) =>
  validateScene(JSON.parse(JSON.stringify(scene)));
/** A legacy formula-gait route, as older callers and saved scenes send it. */
const procedural = (motion: Motion, kind: "walk" | "run"): Motion => ({
  ...motion,
  kind,
  sourceAssetId: undefined,
  animationName: undefined,
});
/** Legacy formula gaits migrate onto the recorded stride of the same pace. */
const recordedStride = (kind: "walk" | "run") => {
  const stride = capturedRouteGaits[kind === "run" ? 1 : 0];
  return {
    kind: "imported",
    sourceAssetId: stride.sourceAssetId,
    animationName: stride.animationName,
    path: { sourceRange: stride.path!.sourceRange },
  };
};

it("persists source-to-path correspondence and rejects incomplete or reversed anchors", () => {
  const motion = route();
  motion.path!.strideScale = 1;
  motion.path!.sourceProgress = [0, 0.45, 1];
  const saved = applyCommands(
    fixture(),
    savePathCommands(fixture(), "actor", motion),
  );
  expect(roundTrip(saved).customMotions[0].path?.sourceProgress).toEqual([
    0, 0.45, 1,
  ]);
  for (const sourceProgress of [
    [0, 1],
    [0, 0, 1],
    [0.1, 0.45, 1],
    [0, 0.5, 0.4],
    [0, NaN, 1],
  ]) {
    expect(() =>
      applyCommands(
        fixture(),
        savePathCommands(fixture(), "actor", {
          ...motion,
          path: { ...motion.path!, sourceProgress },
        }),
      ),
    ).toThrow();
  }
  expect(() =>
    applyCommands(
      fixture(),
      savePathCommands(fixture(), "actor", {
        ...motion,
        path: { ...motion.path!, strideScale: undefined },
      }),
    ),
  ).toThrow(/correspondence|progress/);
});

it("persists bounded spatial step adaptation through saves and split routes", () => {
  const motion = route();
  motion.path!.strideScale = 1.07;
  const saved = applyCommands(
    fixture(),
    savePathCommands(fixture(), "actor", motion),
  );
  expect(roundTrip(saved).customMotions[0].path?.strideScale).toBe(1.07);
  const parts = pathActionClips(motion, [
    { pointIndex: 1, motionId: "wave", duration: 1 },
  ]);
  expect(
    parts
      .filter((part) => !part.action)
      .every((part) => part.motion.path?.strideScale === 1.07),
  ).toBe(true);
  for (const strideScale of [0.89, 1.11, NaN, Infinity]) {
    expect(() =>
      applyCommands(
        fixture(),
        savePathCommands(fixture(), "actor", {
          ...motion,
          path: { ...motion.path!, strideScale },
        }),
      ),
    ).toThrow();
  }
  expect(() =>
    applyCommands(
      fixture(),
      savePathCommands(fixture(), "actor", procedural(motion, "walk")),
    ),
  ).toThrow(/Captured step length/);
});

it("saves source intervals and keeps them on split waypoint routes", () => {
  const motion = route();
  motion.path!.sourceRange = { start: 5.173, end: 8.91 };
  const saved = applyCommands(
    fixture(),
    savePathCommands(fixture(), "actor", motion),
  );
  expect(roundTrip(saved).customMotions[0].path?.sourceRange).toEqual(
    motion.path!.sourceRange,
  );
  const parts = pathActionClips(motion, [
    { pointIndex: 1, motionId: "wave", duration: 1 },
  ]);
  expect(
    parts
      .filter((part) => !part.action)
      .every(
        (part) =>
          JSON.stringify(part.motion.path?.sourceRange) ===
          JSON.stringify(motion.path!.sourceRange),
      ),
  ).toBe(true);
  for (const sourceRange of [
    { start: 2, end: 1 },
    { start: -1, end: 2 },
    { start: NaN, end: 2 },
  ]) {
    expect(() =>
      applyCommands(
        fixture(),
        savePathCommands(fixture(), "actor", {
          ...motion,
          path: { ...motion.path!, sourceRange },
        }),
      ),
    ).toThrow();
  }
  expect(() =>
    applyCommands(
      fixture(),
      savePathCommands(fixture(), "actor", procedural(motion, "walk")),
    ),
  ).toThrow(/Source ranges/);
});

function speakingScene() {
  const spoken = appendSpeech(fixture(), "actor", {
    dialogue: "Come with me.",
    performance: [{ motionId: "talk", duration: 5 }],
  });
  return appendSpeech(spoken, "other", {
    dialogue: "I am listening.",
    performance: [{ motionId: "talk", duration: 4 }],
  });
}

describe("imported dialogue routes", () => {
  it("accepts an imported gait, keeps the spoken slot, and reopens and edits it without losing source identity", () => {
    const spoken = speakingScene();
    const clipId = spoken.transcript[0].clipId!;
    const before = structuredClone(spoken);
    const routed = setDialoguePath(spoken, "actor", clipId, route());
    const clip = routed.entities[0].clips[0];
    const motion = allMotions(routed).find((m) => m.id === clip.motionId)!;
    expect(motion).toMatchObject({
      kind: "imported",
      sourceAssetId: route().sourceAssetId,
      animationName: "Walk_Carry",
      path: route().path,
      duration: 5,
    });
    expect(clip).toMatchObject({ id: clipId, duration: 5, playbackRate: 1 });
    expect(clip.legacyFit).toBeUndefined();
    expect(pathableClip(routed, routed.transcript[0])).toBe(clipId);
    expect(spoken).toEqual(before);

    const edited = setDialoguePath(routed, "actor", clipId, {
      ...route(),
      animationName: "Run",
      duration: 40,
      path: {
        smooth: true,
        points: [
          [0, 0, 0],
          [4, 0, 4],
        ],
      },
    });
    expect(edited.customMotions).toHaveLength(1);
    expect(edited.customMotions[0]).toMatchObject({
      id: motion.id,
      sourceAssetId: motion.sourceAssetId,
      animationName: "Run",
      duration: 5,
    });
    expect(edited.entities[0].clips[0]).toEqual(clip);
    expect(edited.transcript).toEqual(spoken.transcript);
    expect(edited.entities[1]).toEqual(spoken.entities[1]);
    for (const [index, line] of spoken.transcript.entries())
      expect(dialogueTiming(edited, edited.transcript[index])).toEqual(
        dialogueTiming(spoken, line),
      );
    expect(roundTrip(edited)).toEqual(edited);
  });

  it("copies a shared imported dialogue route rather than changing the other character's gait or duration", () => {
    const spoken = speakingScene();
    let scene = setDialoguePath(
      spoken,
      "actor",
      spoken.transcript[0].clipId!,
      route(),
    );
    const clip = scene.entities[0].clips[0];
    const original = scene.customMotions[0];
    scene = applyCommands(scene, [
      { type: "chain", id: "other", motionId: original.id, duration: 8 },
      {
        type: "update",
        id: "actor",
        changes: { clips: [{ ...clip, playbackRate: 0.75 }] },
      },
    ]);
    const edited = setDialoguePath(scene, "actor", clip.id, {
      ...original,
      animationName: "Run",
      duration: 30,
    });
    const changedClip = edited.entities[0].clips[0];
    expect(changedClip.motionId).not.toBe(original.id);
    expect(changedClip).toMatchObject({
      id: clip.id,
      duration: 5,
      playbackRate: 0.75,
    });
    expect(edited.customMotions.find((m) => m.id === original.id)).toEqual(
      original,
    );
    expect(edited.entities[1]).toEqual(scene.entities[1]);
    expect(
      edited.customMotions.find((m) => m.id === changedClip.motionId),
    ).toMatchObject({
      sourceAssetId: original.sourceAssetId,
      animationName: "Run",
      duration: 5,
    });
  });

  it("does not make arbitrary imported takes routable and still validates imported route sources", () => {
    const spoken = appendSpeech(fixture(), "actor", {
      dialogue: "Hello there.",
      performance: [{ motionId: "authored-walk", duration: 5 }],
    });
    expect(pathableClip(spoken, spoken.transcript[0])).toBeNull();
    expect(() =>
      setDialoguePath(spoken, "actor", spoken.transcript[0].clipId!, route()),
    ).toThrow("interaction in place");
    const talk = speakingScene();
    for (const invalid of [
      { ...route(), path: undefined },
      { ...route(), sourceAssetId: undefined },
      { ...route(), animationName: undefined },
      { ...route(), sourceAssetId: "missing-source" },
    ])
      expect(() =>
        setDialoguePath(talk, "actor", talk.transcript[0].clipId!, invalid),
      ).toThrow();
  });

  it.each(["walk", "run"] as const)(
    "switches a dialogue route to a legacy procedural %s on the recorded stride at its own speed",
    (kind) => {
      const spoken = speakingScene();
      const clipId = spoken.transcript[0].clipId!;
      const routed = setDialoguePath(spoken, "actor", clipId, route());
      const old = routed.customMotions[0];
      routed.entities[0].clips[0].playbackRate = 0.5;
      routed.entities[0].clips[0].legacyFit = true;
      const edited = setDialoguePath(
        routed,
        "actor",
        clipId,
        procedural(old, kind),
      );
      // The previous take's speed and fit notice do not carry over to the
      // newly chosen recording, which plays at its captured speed.
      expect(edited.entities[0].clips[0].playbackRate).toBe(1);
      expect(edited.entities[0].clips[0].legacyFit).toBeUndefined();
      expect(edited.customMotions[0]).toMatchObject({
        id: old.id,
        ...recordedStride(kind),
        duration: 5,
      });
      expect(edited.customMotions[0].path!.points).toEqual(old.path!.points);
      expect(dialogueTiming(edited, edited.transcript[0])).toEqual({
        start: 0,
        end: 5,
      });
      expect(roundTrip(edited)).toEqual(edited);
    },
  );
});

describe("route timing normalization", () => {
  it("never migrates travel duration to a source-fit speed, including raw saved route clips", () => {
    const raw = fixture();
    raw.customMotions = [route()];
    raw.entities[0].clips = [
      { id: "route-clip", motionId: route().id, duration: 24 },
    ];
    const validated = validateScene(raw);
    expect(validated.entities[0].clips[0]).toMatchObject({
      duration: 24,
      playbackRate: 1,
    });
    expect(validated.entities[0].clips[0].legacyFit).toBeUndefined();
    expect(raw.entities[0].clips[0].playbackRate).toBeUndefined();
    expect(roundTrip(validated)).toEqual(validated);
    const edited = applyCommands(raw, [
      {
        type: "update",
        id: "actor",
        changes: { clips: [{ ...raw.entities[0].clips[0], duration: 6 }] },
      },
    ]);
    expect(edited.entities[0].clips[0]).toMatchObject({
      duration: 6,
      playbackRate: 1,
    });
    expect(edited.entities[0].clips[0].legacyFit).toBeUndefined();
  });

  it("preserves explicit imported speed on duration edits but removes stale route fit notices", () => {
    const raw = fixture();
    raw.customMotions = [route()];
    raw.entities[0].clips = [
      {
        id: "route-clip",
        motionId: route().id,
        duration: 24,
        playbackRate: 0.75,
        legacyFit: true,
      },
    ];
    const next = applyCommands(raw, [
      {
        type: "update",
        id: "actor",
        changes: {
          clips: [{ id: "route-clip", motionId: route().id, duration: 6 }],
        },
      },
    ]);
    expect(next.entities[0].clips[0]).toMatchObject({
      duration: 6,
      playbackRate: 0.75,
    });
    expect(next.entities[0].clips[0].legacyFit).toBeUndefined();
    expect(roundTrip(next)).toEqual(next);
  });

  it.each([false, true])(
    "resets imported timing when saving legacy procedural routes onto the recorded stride (shared motion: %s)",
    (shared) => {
      const scene = fixture();
      let before = applyCommands(
        scene,
        savePathCommands(scene, "actor", route()),
      );
      if (shared)
        before = applyCommands(before, [
          { type: "chain", id: "other", motionId: route().id },
        ]);
      const clip = before.entities[0].clips[0];
      clip.playbackRate = 0.5;
      clip.legacyFit = true;
      for (const kind of ["walk", "run"] as const) {
        const edited = applyCommands(
          before,
          savePathCommands(
            before,
            "actor",
            { ...procedural(route(), kind), duration: 9 },
            clip.id,
          ),
        );
        const changed = edited.entities[0].clips[0];
        expect(changed).toMatchObject({ id: clip.id, duration: 9 });
        expect(changed.playbackRate).toBe(1);
        expect(changed.legacyFit).toBeUndefined();
        expect(changed.motionId === route().id).toBe(!shared);
        expect(
          edited.customMotions.find((m) => m.id === changed.motionId),
        ).toMatchObject({ ...recordedStride(kind), duration: 9 });
        expect(edited.entities[1]).toEqual(before.entities[1]);
        expect(roundTrip(edited)).toEqual(edited);
      }
    },
  );

  it("resets reference timing for a standalone legacy kind edit and for old clip-update callers", () => {
    const scene = fixture();
    const before = applyCommands(
      scene,
      savePathCommands(scene, "actor", route()),
    );
    const clip = before.entities[0].clips[0];
    const command = {
      type: "updateMotion",
      motion: procedural(route(), "walk"),
    };
    const edited = applyCommands(before, [command]);
    expect(edited.entities[0].clips[0].playbackRate).toBe(1);
    expect(edited.customMotions[0]).toMatchObject(recordedStride("walk"));
    const updated = applyCommands(before, [
      command,
      {
        type: "update",
        id: "actor",
        changes: {
          clips: [{ id: clip.id, motionId: clip.motionId, duration: 8 }],
        },
      },
    ]);
    expect(updated.entities[0].clips[0].playbackRate).toBe(1);
    expect(updated.entities[0].clips[0].legacyFit).toBeUndefined();
  });

  it("persists native new route fragments and preserves explicit speed across imported-only splits", () => {
    const scene = fixture();
    const actions = [{ pointIndex: 1, motionId: "wave" as const, duration: 2 }];
    const fresh = applyCommands(
      scene,
      savePathCommands(scene, "actor", route(), undefined, actions),
    );
    const before = applyCommands(
      scene,
      savePathCommands(scene, "actor", route()),
    );
    const clip = before.entities[0].clips[0];
    clip.playbackRate = 0.75;
    const edited = applyCommands(
      before,
      savePathCommands(before, "actor", route(), clip.id, actions),
    );
    for (const [result, rate] of [
      [fresh, 1],
      [edited, 0.75],
    ] as const) {
      // The waypoint wave is a recorded take played at its captured speed.
      expect(result.entities[0].clips.map((c) => c.playbackRate)).toEqual([
        rate,
        1,
        rate,
      ]);
      expect(
        result.entities[0].clips.every((c) => c.legacyFit === undefined),
      ).toBe(true);
      expect(
        result.customMotions.every(
          (m) =>
            m.sourceAssetId === route().sourceAssetId &&
            m.animationName === "Walk_Carry",
        ),
      ).toBe(true);
      expect(
        result.entities[0].clips.reduce((sum, c) => sum + c.duration, 0),
      ).toBeCloseTo(14);
      expect(roundTrip(result)).toEqual(result);
    }
  });
});

it("preserves a terminal imported-route hold when editing or splitting movement", () => {
  const motion = route();
  let scene = applyCommands(
    fixture(),
    savePathCommands(fixture(), "actor", motion),
  );
  const clip = scene.entities[0].clips[0];
  clip.duration = 12.75;
  clip.routeHold = 0.75;
  scene = validateScene(scene);
  const edited = applyCommands(
    scene,
    savePathCommands(scene, "actor", { ...motion, duration: 10 }, clip.id),
  );
  expect(edited.entities[0].clips[0]).toMatchObject({
    duration: 10.75,
    routeHold: 0.75,
  });
  const split = applyCommands(
    scene,
    savePathCommands(scene, "actor", motion, clip.id, [
      { pointIndex: 1, motionId: "wave", duration: 1 },
    ]),
  );
  const clips = split.entities[0].clips;
  expect(clips.filter((c) => c.routeHold)).toHaveLength(1);
  expect(clips.at(-1)?.routeHold).toBe(0.75);
  expect(clips.reduce((n, c) => n + c.duration, 0)).toBeCloseTo(13.75, 8);
  const proceduralEdit = applyCommands(
    scene,
    savePathCommands(scene, "actor", procedural(motion, "walk"), clip.id),
  );
  expect(proceduralEdit.entities[0].clips[0].routeHold).toBeUndefined();
});
