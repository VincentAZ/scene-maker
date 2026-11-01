import { expect, it } from "vitest";
import { appendSpeech, dialogueTiming } from "../shared/conversation";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import {
  applyCommands,
  starterScene,
  validateScene,
  type Scene,
} from "../shared/scene";
import { motionSource } from "../shared/motionLibrary";

function fixture() {
  let scene = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "a", position: [0, 0, 0] },
    { type: "add", assetId: "leo", id: "b", position: [3, 0, 0] },
  ]);
  for (const [actor, duration] of [
    ["a", 4],
    ["b", 3],
    ["a", 5],
  ] as const)
    scene = appendSpeech(scene, actor, {
      dialogue: "A short line.",
      performance: [{ motionId: "talk", duration }],
    });
  return scene;
}
const timings = (scene: Scene) =>
  scene.transcript.map((line) => dialogueTiming(scene, line));

it.each([2, 9])(
  "retimes a saved alternating conversation after its first performance changes to %s seconds",
  (duration) => {
    const before = JSON.parse(JSON.stringify(fixture())) as Scene;
    const changed = structuredClone(before);
    changed.entities[0].clips[0].duration = duration;
    const snapshot = JSON.stringify(changed);
    const result = validateScene(retimeDialogueAfterChange(before, changed));
    expect(timings(result)).toEqual([
      { start: 0, end: duration },
      { start: duration, end: duration + 3 },
      { start: duration + 3, end: duration + 8 },
    ]);
    expect(JSON.stringify(changed)).toBe(snapshot);
    expect(result.transcript).toEqual(before.transcript);
    for (const line of before.transcript) {
      const actor = result.entities.find((e) => e.id === line.characterId)!;
      const old = before.entities
        .find((e) => e.id === line.characterId)!
        .clips.find((c) => c.id === line.clipId)!;
      if (line !== before.transcript[0])
        expect(actor.clips.find((c) => c.id === line.clipId)).toEqual(old);
    }
    expect(retimeDialogueAfterChange(result, result)).toBe(result);
  },
);

it("keeps an intentional inter-speaker pause and does not change imported source speed or range", () => {
  const before = fixture();
  before.customMotions.push({
    id: "capture",
    name: "Capture",
    kind: "imported",
    duration: 4,
    distance: 0,
    poses: [],
    sourceAssetId: motionSource.id,
    animationName: "Walk",
  });
  const b = before.entities[1];
  b.clips[0].duration += 1.5;
  b.clips[1] = {
    ...b.clips[1],
    motionId: "capture",
    playbackRate: 0.8,
    sourceStart: 0.25,
  };
  const changed = structuredClone(before);
  changed.entities[0].clips[0].duration = 8;
  const result = validateScene(retimeDialogueAfterChange(before, changed));
  expect(timings(result)[1]).toEqual({ start: 9.5, end: 12.5 });
  expect(result.entities[1].clips[1]).toEqual(b.clips[1]);
});

it("waits for changed unspoken travel before the first dialogue line", () => {
  let before = applyCommands(fixture(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "a", position: [0, 0, 0] },
    { type: "add", assetId: "leo", id: "b", position: [3, 0, 0] },
    { type: "chain", id: "a", motionId: "walk", duration: 4 },
  ]);
  before = appendSpeech(before, "b", {
    dialogue: "We arrived.",
    action: "talk",
  });
  const changed = structuredClone(before);
  changed.entities[0].clips[0].duration = 8;
  expect(timings(retimeDialogueAfterChange(before, changed))[0]!.start).toBe(8);
});

it("preserves overlapping authored speech instead of serializing it", () => {
  const before = fixture();
  before.entities[1].clips[0].duration = 2;
  const changed = structuredClone(before);
  changed.entities[0].clips[0].duration = 7;
  expect(timings(retimeDialogueAfterChange(before, changed))[1]).toEqual({
    start: 2,
    end: 5,
  });
});

it("waits for every preceding parallel performance when the former shorter one becomes longer", () => {
  const before = applyCommands(fixture(), [
    { type: "add", id: "c", assetId: "june", position: [6, 0, 0] },
  ]);
  before.entities[0].clips = before.entities[0].clips.slice(0, 1);
  before.entities[1].clips = before.entities[1].clips.slice(1);
  before.entities[1].clips[0].duration = 5;
  before.transcript = before.transcript.slice(0, 2);
  const withThird = appendSpeech(before, "c", {
    dialogue: "Both finished.",
    action: "talk",
  });
  const changed = structuredClone(withThird);
  changed.entities[0].clips[0].duration = 8;
  const result = retimeDialogueAfterChange(withThird, changed);
  expect(timings(result)[1]).toEqual({ start: 0, end: 5 });
  expect(timings(result)[2]!.start).toBe(8);
});

it("keeps preceding non-idle actions intact and propagates their later feasible start", () => {
  const before = fixture();
  before.entities[1].clips[0].motionId = "wave";
  const changed = structuredClone(before);
  changed.entities[0].clips[0].duration = 2;
  const result = retimeDialogueAfterChange(before, changed);
  expect(result.entities[1].clips[0]).toEqual(before.entities[1].clips[0]);
  expect(timings(result)[1]).toEqual({ start: 4, end: 7 });
  expect(timings(result)[2]).toEqual({ start: 7, end: 12 });
});

it("splits long waits into legal clips and retains stable IDs when recomputed", () => {
  const before = fixture(),
    changed = structuredClone(before);
  changed.entities[0].clips[0].duration = 60;
  changed.entities[0].clips.splice(
    1,
    0,
    { id: "continuation-1", motionId: "talk", duration: 60 },
    { id: "continuation-2", motionId: "talk", duration: 20 },
  );
  changed.transcript[0].clipIds = [
    changed.transcript[0].clipId!,
    "continuation-1",
    "continuation-2",
  ];
  const result = validateScene(retimeDialogueAfterChange(before, changed));
  const waits = result.entities[1].clips.slice(0, -1);
  expect(waits).toHaveLength(3);
  expect(waits.every((c) => c.duration <= 60 && c.duration >= 0.2)).toBe(true);
  expect(waits.reduce((sum, c) => sum + c.duration, 0)).toBe(140);
  expect(waits[0].id).toBe(before.entities[1].clips[0].id);
  expect(retimeDialogueAfterChange(before, changed)).toEqual(result);
});

it("reports a full sequence instead of stretching speech", () => {
  const before = fixture(),
    changed = structuredClone(before);
  const first = changed.entities[0].clips[0];
  first.duration = 59;
  changed.entities[1].clips[0].motionId = "wave";
  while (changed.entities[1].clips.length < 100)
    changed.entities[1].clips.push({
      id: `extra-${changed.entities[1].clips.length}`,
      motionId: "idle",
      duration: 0.2,
    });
  expect(() => retimeDialogueAfterChange(before, changed)).toThrow("no room");
});
