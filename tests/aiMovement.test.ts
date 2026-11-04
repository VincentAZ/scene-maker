import { expect, it } from "vitest";
import {
  allMotions,
  applyCommands,
  starterScene,
  validateScene,
  type Motion,
} from "../shared/scene";
import { withAutomaticMovement } from "../shared/aiMovement";
import { savePathCommands } from "../shared/path";
import { appendSpeech, setDialoguePath } from "../shared/conversation";
import { capturedRouteGaits } from "../shared/motionLibrary";

function fixture(imported = false) {
  const scene = starterScene();
  scene.entities = [scene.entities[0]];
  scene.entities[0].clips = [];
  // The imported case routes the recorded walking stride (its own source
  // interval) rather than the studio Walk action.
  const gait = imported
    ? capturedRouteGaits[0]
    : allMotions(scene).find((m) => m.id === "walk")!;
  const motion: Motion = {
    ...gait,
    id: "ai-route",
    name: "Coordinate direction",
    duration: 4,
    distance: 0,
    path: {
      points: [
        [0, 0, 0],
        [1, 0, 2],
        [2, 0, 4],
      ],
      smooth: true,
      endHeading: 0.4,
      ...(gait.path?.sourceRange
        ? { sourceRange: { ...gait.path.sourceRange } }
        : {}),
    },
  };
  const next = applyCommands(scene, [
    { type: "createMotion", motion },
    {
      type: "chain",
      id: scene.entities[0].id,
      motionId: motion.id,
      duration: 4,
      ...(imported ? { playbackRate: 0.8 } : {}),
    },
  ]);
  return { scene, next, motion };
}

it.each([false, true])(
  "retains the selected %s-imported route and pace while recording its destination",
  (imported) => {
    const f = fixture(imported),
      before = structuredClone(f.next);
    const next = withAutomaticMovement(f.scene, f.next),
      clip = next.entities[0].clips[0];
    expect(clip.navigation).toEqual({
      point: [2, 0, 4],
      endHeading: 0.4,
      movement: "walk",
    });
    expect({ ...clip, navigation: undefined }).toEqual({
      ...before.entities[0].clips[0],
      navigation: undefined,
    });
    expect(next.customMotions).toEqual(before.customMotions);
    expect(f.next).toEqual(before);
    expect(
      validateScene(JSON.parse(JSON.stringify(next))).entities[0].clips[0]
        .navigation,
    ).toEqual(clip.navigation);
  },
);

// Studio Run is a recorded take with its own root travel, so an AI-chained run
// keeps that original performance as native intent (measured once its source
// is loaded) instead of being rewritten as a fixed-distance procedural route.
it("keeps newly AI-chained recorded travel as a native performance without changing timing or the library", () => {
  const f = fixture();
  const next = applyCommands(f.scene, [
    { type: "chain", id: f.scene.entities[0].id, motionId: "run", duration: 3 },
  ]);
  const result = withAutomaticMovement(f.scene, next),
    clip = result.entities[0].clips[0];
  const original = allMotions(f.scene).find((m) => m.id === "run")!;
  expect(original).toMatchObject({ kind: "imported", role: "run" });
  expect(clip.id).toBe(next.entities[0].clips[0].id);
  expect(clip.motionId).toBe("run");
  expect(clip.duration).toBe(3);
  expect(clip.navigation).toEqual({
    // A replan that falls back to a planned route must keep running.
    movement: "run",
    native: {
      motionId: "run",
      duration: 3,
      playbackRate: next.entities[0].clips[0].playbackRate,
    },
  });
  expect(result.customMotions).toEqual(next.customMotions);
  expect(allMotions(result).find((m) => m.id === "run")).toEqual(original);
});

it("leaves untouched manual routes and static gestures alone, and releases intent for a manual path edit", () => {
  const f = fixture();
  const renamed = applyCommands(f.next, [
    {
      type: "update",
      id: f.next.entities[0].id,
      changes: { name: "New name" },
    },
    { type: "chain", id: f.next.entities[0].id, motionId: "wave" },
  ]);
  expect(withAutomaticMovement(f.next, renamed)).toBe(renamed);
  const controlled = withAutomaticMovement(f.scene, f.next);
  const edited = applyCommands(
    controlled,
    savePathCommands(
      controlled,
      controlled.entities[0].id,
      {
        ...f.motion,
        path: {
          points: [
            [0, 0, 0],
            [4, 0, 1],
          ],
          smooth: false,
        },
      },
      controlled.entities[0].clips[0].id,
    ),
  );
  expect(edited.entities[0].clips[0].navigation).toBeUndefined();
});

it("updates the point after an AI path edit and retains explicitly supplied object intent", () => {
  const f = fixture(),
    controlled = withAutomaticMovement(f.scene, f.next);
  const changed = applyCommands(controlled, [
    {
      type: "updateMotion",
      motion: {
        ...f.motion,
        path: {
          points: [
            [0, 0, 0],
            [3, 0, 2],
          ],
          smooth: false,
        },
      },
    },
  ]);
  expect(
    withAutomaticMovement(controlled, changed).entities[0].clips[0].navigation
      ?.point,
  ).toEqual([3, 0, 2]);
  f.next.entities[0].clips[0].navigation = {
    targetId: "destination",
    movement: "walk",
  };
  expect(withAutomaticMovement(f.scene, f.next)).toBe(f.next);
});

it("protects an existing manual route when the AI changes its pace", () => {
  const f = fixture(true),
    actor = f.next.entities[0];
  const changed = applyCommands(f.next, [
    {
      type: "update",
      id: actor.id,
      changes: { clips: actor.clips.map((c) => ({ ...c, duration: 5 })) },
    },
  ]);
  const controlled = withAutomaticMovement(f.next, changed);
  expect(controlled.entities[0].clips[0].navigation?.point).toEqual([2, 0, 4]);
  expect(controlled.entities[0].clips[0].duration).toBe(5);
  expect(controlled.entities[0].clips[0].playbackRate).toBe(0.8);
});

it("rejects missing, ambiguous, nonlevel or nonfinite navigation destinations", () => {
  const f = fixture();
  for (const intent of [
    { movement: "walk" },
    { movement: "walk", point: [1, 0, 1], targetId: "prop" },
    { movement: "walk", point: [1, 1, 1] },
    { movement: "walk", point: [Infinity, 0, 0] },
  ]) {
    const input = structuredClone(f.next);
    Object.assign(input.entities[0].clips[0], { navigation: intent });
    expect(() => validateScene(input)).toThrow();
  }
});

it("marks an AI-directed dialogue route and lets the creator replace its path manually", () => {
  const f = fixture(true),
    id = f.next.entities[0].id;
  const spoken = appendSpeech(f.next, id, {
    dialogue: "I will walk over there.",
    performance: [{ motionId: f.motion.id }],
  });
  const directed = withAutomaticMovement(f.next, spoken),
    clipId = directed.transcript.at(-1)!.clipId!;
  expect(
    directed.entities[0].clips.find((c) => c.id === clipId)?.navigation?.point,
  ).toEqual([2, 0, 4]);
  const edited = setDialoguePath(directed, id, clipId, {
    ...f.motion,
    path: {
      points: [
        [0, 0, 0],
        [1, 0, 3],
      ],
      smooth: false,
    },
  });
  expect(
    edited.entities[0].clips.find((c) => c.id === clipId)?.navigation,
  ).toBeUndefined();
  expect(edited.transcript).toEqual(directed.transcript);
});

it("marks standalone imported performances without inventing a path, and updates source-window edits", () => {
  const f = fixture(true),
    motion = { ...f.motion, path: undefined };
  const incoming = applyCommands(f.scene, [
    { type: "createMotion", motion },
    {
      type: "chain",
      id: f.scene.entities[0].id,
      motionId: motion.id,
      duration: 3,
      playbackRate: 1,
    },
  ]);
  const result = withAutomaticMovement(f.scene, incoming),
    clip = result.entities[0].clips[0];
  expect(clip.navigation?.native).toEqual({
    motionId: motion.id,
    duration: 3,
    playbackRate: 1,
  });
  expect(result.customMotions).toEqual(incoming.customMotions);
  expect(withAutomaticMovement(result, result)).toBe(result);
  const edited = applyCommands(result, [
    {
      type: "update",
      id: result.entities[0].id,
      changes: { clips: [{ ...clip, sourceStart: 0.4 }] },
    },
  ]);
  expect(edited.entities[0].clips[0].navigation?.native?.sourceStart).toBe(0.4);
  const aiEdited = withAutomaticMovement(result, edited);
  expect(aiEdited.entities[0].clips[0].navigation?.native?.sourceStart).toBe(
    0.4,
  );
  expect(validateScene(JSON.parse(JSON.stringify(aiEdited)))).toEqual(aiEdited);
});
