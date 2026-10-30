import { describe, expect, it } from "vitest";
import {
  allMotions,
  applyCommands,
  clipSchema,
  starterScene,
  validateScene,
} from "../shared/scene";
import {
  clipEffectiveEnd,
  clipPlaybackRate,
  clipSourceEnd,
  clipTimingDescription,
  sourceSecondsAt,
} from "../shared/clipTiming";

function fixture() {
  const scene = starterScene();
  const motion = allMotions(scene).find(
    (motion) => motion.kind === "imported",
  )!;
  const actor = scene.entities[0];
  actor.clips = [];
  scene.entities = [actor];
  return { scene, actor, motion };
}

describe("imported clip source timing", () => {
  it("trims a shorter slot at native speed instead of stretching the full take", () => {
    const clip = { duration: 2, playbackRate: 1 };
    expect(sourceSecondsAt(clip, 0.5, 4)).toBe(0.5);
    expect(sourceSecondsAt(clip, -1, 4)).toBe(0);
    expect(sourceSecondsAt(clip, 8, 4)).toBe(2);
    expect(clipSourceEnd(clip, 4)).toBe(2);
    expect(clipEffectiveEnd(clip, 4)).toBe(2);
    expect(clipTimingDescription(clip, 4)).toContain("Trimmed at 2s");
  });

  it("holds a longer slot after the final source sample without looping", () => {
    const clip = { duration: 6, playbackRate: 1 };
    expect(sourceSecondsAt(clip, 1, 4)).toBe(1);
    expect(sourceSecondsAt(clip, 4, 4)).toBe(4);
    expect(sourceSecondsAt(clip, 5.5, 4)).toBe(4);
    expect(clipSourceEnd(clip, 4)).toBe(4);
    expect(clipEffectiveEnd(clip, 4)).toBe(4);
    expect(clipTimingDescription(clip, 4)).toContain(
      "hold the final pose for 2s",
    );
  });

  it("uses explicit speed for source time and the effective end, independent of duration", () => {
    const fast = { duration: 3, playbackRate: 2 };
    const slow = { duration: 3, playbackRate: 0.5 };
    expect(sourceSecondsAt(fast, 1, 4)).toBe(2);
    expect(clipSourceEnd(fast, 4)).toBe(4);
    expect(clipEffectiveEnd(fast, 4)).toBe(2);
    expect(sourceSecondsAt(slow, 1, 4)).toBe(0.5);
    expect(clipSourceEnd(slow, 4)).toBe(1.5);
    expect(clipEffectiveEnd(slow, 4)).toBe(3);
    for (const time of [0, 0.5, 1, 1.5])
      expect(sourceSecondsAt({ ...fast, duration: 8 }, time, 4)).toBe(
        sourceSecondsAt(fast, time, 4),
      );
  });

  it("retains a documented legacy fallback for callers with unvalidated old clips", () => {
    const clip = { duration: 8 };
    expect(clipPlaybackRate(clip, 4)).toBe(0.5);
    expect(sourceSecondsAt(clip, 2, 4)).toBe(1);
    expect(clipSourceEnd(clip, 4)).toBe(4);
    expect(clipEffectiveEnd(clip, 4)).toBe(8);
  });
});

describe("persisted imported timing", () => {
  it("gives newly chained imported takes native speed, even with a custom duration", () => {
    const { scene, actor, motion } = fixture();
    const next = applyCommands(scene, [
      { type: "chain", id: actor.id, motionId: motion.id, duration: 0.5 },
      {
        type: "chain",
        id: actor.id,
        motionId: motion.id,
        duration: 6,
        playbackRate: 2,
      },
    ]);
    expect(next.entities[0].clips.map((clip) => clip.playbackRate)).toEqual([
      1, 2,
    ]);
    expect(next.entities[0].clips.every((clip) => !clip.legacyFit)).toBe(true);
    expect(validateScene(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });

  it("defaults new clips inserted by an update command to native speed too", () => {
    const { scene, actor, motion } = fixture();
    const next = applyCommands(scene, [
      {
        type: "update",
        id: actor.id,
        changes: { clips: [{ id: "new", motionId: motion.id, duration: 8 }] },
      },
    ]);
    expect(next.entities[0].clips[0]).toMatchObject({
      playbackRate: 1,
      duration: 8,
    });
    expect(next.entities[0].clips[0].legacyFit).toBeUndefined();
  });

  it("materializes old fit-to-duration speed once and persists a visible migration marker", () => {
    const { scene, actor, motion } = fixture();
    actor.clips = [
      { id: "legacy", motionId: motion.id, duration: motion.duration * 2 },
    ];
    const migrated = validateScene(scene);
    expect(migrated.entities[0].clips[0]).toMatchObject({
      playbackRate: 0.5,
      legacyFit: true,
    });
    expect(actor.clips[0].playbackRate).toBeUndefined();
    expect(validateScene(JSON.parse(JSON.stringify(migrated)))).toEqual(
      migrated,
    );
    const next = applyCommands(migrated, [
      {
        type: "update",
        id: actor.id,
        changes: {
          clips: migrated.entities[0].clips.map((clip) => ({
            ...clip,
            duration: 8,
          })),
        },
      },
    ]);
    expect(next.entities[0].clips[0]).toMatchObject({
      duration: 8,
      playbackRate: 0.5,
      legacyFit: true,
    });
  });

  it("does not refit legacy speed when an old caller changes duration before validation", () => {
    const { scene, actor, motion } = fixture();
    actor.clips = [
      { id: "legacy", motionId: motion.id, duration: motion.duration * 2 },
    ];
    const next = applyCommands(scene, [
      {
        type: "update",
        id: actor.id,
        changes: { clips: [{ ...actor.clips[0], duration: 8 }] },
      },
    ]);
    expect(next.entities[0].clips[0]).toMatchObject({
      duration: 8,
      playbackRate: 0.5,
      legacyFit: true,
    });
  });

  it("accepts explicit native reset without altering the scheduled slot", () => {
    const { scene, actor, motion } = fixture();
    actor.clips = [{ id: "legacy", motionId: motion.id, duration: 8 }];
    const migrated = validateScene(scene);
    const next = applyCommands(migrated, [
      {
        type: "update",
        id: actor.id,
        changes: {
          clips: [
            {
              ...migrated.entities[0].clips[0],
              playbackRate: 1,
              legacyFit: undefined,
            },
          ],
        },
      },
    ]);
    expect(next.entities[0].clips[0].playbackRate).toBe(1);
    expect(next.entities[0].clips[0].legacyFit).toBeUndefined();
    expect(next.entities[0].clips[0].duration).toBe(8);
  });

  it("rejects invalid or procedural rates rather than accepting a nonworking control", () => {
    for (const playbackRate of [0, -1, Infinity, NaN, 301])
      expect(
        clipSchema.safeParse({
          id: "clip",
          motionId: "source",
          duration: 2,
          playbackRate,
        }).success,
      ).toBe(false);
    const { scene, actor } = fixture();
    expect(() =>
      applyCommands(scene, [
        { type: "chain", id: actor.id, motionId: "walk", playbackRate: 2 },
      ]),
    ).toThrow("only for imported");
    const procedural = applyCommands(scene, [
      { type: "chain", id: actor.id, motionId: "walk", duration: 2 },
    ]);
    expect(procedural.entities[0].clips[0].playbackRate).toBeUndefined();
  });
});
