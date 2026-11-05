import { describe, expect, it } from "vitest";
import {
  allMotions,
  applyCommands,
  starterScene,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";

type Clip = Entity["clips"][number];
/** An imported walking route on a recorded take. */
const route = (): Motion => ({
  id: "imported-route",
  name: "Casual walking route",
  kind: "imported",
  sourceAssetId: "cmu-capture-141-19",
  animationName: "141_19",
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
/** The starter café: Mila waves (a standalone take) then talks. */
function fixture(clips?: Clip[]) {
  const scene = starterScene();
  scene.customMotions.push(route());
  if (clips) scene.entities[0].clips = clips;
  return scene;
}
const actor = (s: Scene) => s.entities[0];
const retime = (
  s: Scene,
  changes: Partial<Pick<Clip, "duration" | "sourceStart" | "playbackRate">>,
  clipId = actor(s).clips[0].id,
) =>
  applyCommands(s, [
    { type: "retimeClip", id: actor(s).id, clipId, ...changes },
  ]);

describe("retimeClip", () => {
  it("changes one action's length; the actions after it follow", () => {
    const scene = fixture();
    const before = actor(scene).clips.map((c) => c.duration);
    const next = retime(scene, { duration: 3.4 });
    expect(actor(next).clips.map((c) => c.duration)).toEqual([
      3.4,
      ...before.slice(1),
    ]);
    expect(actor(next).clips[0]).toMatchObject({
      motionId: "wave",
      playbackRate: 1,
    });
    expect(next.entities.slice(1)).toEqual(scene.entities.slice(1));
  });

  it("clamps the length to what the action allows", () => {
    const scene = fixture();
    expect(actor(retime(scene, { duration: 0.05 })).clips[0].duration).toBe(
      0.2,
    );
    expect(actor(retime(scene, { duration: 500 })).clips[0].duration).toBe(60);
    expect(() => retime(scene, { duration: Infinity })).toThrow();
  });

  it("keeps a stopped route's travelling time and recomputes its hold like the Details input", () => {
    const stopped = (over: Partial<Clip> = {}): Clip => ({
      id: "stopped",
      motionId: "imported-route",
      duration: 6,
      playbackRate: 1,
      routeStop: 2,
      ...over,
    });
    const longer = actor(retime(fixture([stopped()]), { duration: 9 }))
      .clips[0];
    expect(longer).toMatchObject({
      duration: 9,
      routeStop: 2,
      routeActive: 6,
      routeHold: 3,
    });
    const shorter = actor(
      retime(
        fixture([stopped({ routeActive: 6, routeHold: 2, duration: 8 })]),
        {
          duration: 5,
        },
      ),
    ).clips[0];
    expect(shorter).toMatchObject({ duration: 5, routeActive: 6 });
    expect(shorter.routeHold).toBeUndefined();
    // It cannot end before its stop.
    expect(
      actor(retime(fixture([stopped()]), { duration: 1 })).clips[0],
    ).toMatchObject({ duration: 2, routeActive: 6 });
  });

  it("lets a standalone take start later in its recording and play at another speed", () => {
    const scene = fixture();
    const wave = allMotions(scene).find((m) => m.id === "wave")!;
    actor(scene).clips[0].legacyFit = true;
    const moved = actor(retime(scene, { sourceStart: 1, playbackRate: 2 }))
      .clips[0];
    expect(moved).toMatchObject({ sourceStart: 1, playbackRate: 2 });
    expect(moved.legacyFit).toBeUndefined();
    // A start past the end of the recording keeps a moment to play.
    const late = actor(retime(scene, { sourceStart: 99 })).clips[0];
    expect(late.sourceStart).toBeLessThan(wave.duration);
    expect(late.sourceStart).toBeCloseTo(wave.duration - 0.001);
    expect(late.legacyFit).toBe(true);
    expect(
      actor(retime(scene, { playbackRate: 0.0001 })).clips[0].playbackRate,
    ).toBe(0.001);
    expect(
      actor(retime(scene, { playbackRate: 1000 })).clips[0].playbackRate,
    ).toBe(300);
  });

  it("ignores source and speed changes on a route", () => {
    const scene = fixture([
      { id: "r", motionId: "imported-route", duration: 6, playbackRate: 1 },
    ]);
    const clip = actor(
      retime(scene, { duration: 7, sourceStart: 1, playbackRate: 2 }),
    ).clips[0];
    expect(clip).toMatchObject({ duration: 7, playbackRate: 1 });
    expect(clip.sourceStart).toBeUndefined();
  });

  it("refuses a frozen wait and a missing action with plain messages", () => {
    const scene = fixture([
      {
        id: "r",
        motionId: "imported-route",
        duration: 6,
        playbackRate: 1,
        routeStop: 2,
      },
      {
        id: "w",
        motionId: "imported-route",
        duration: 3,
        playbackRate: 1,
        routeWait: "r",
        transition: "cut",
      },
    ]);
    expect(() => retime(scene, { duration: 4 }, "w")).toThrow(
      /waits in a stopped pose/,
    );
    expect(() => retime(scene, { duration: 4 }, "gone")).toThrow(
      /no longer in the sequence/,
    );
  });

  it("treats navigation like a Details edit: a destination stays, a native take re-syncs", () => {
    const routed = fixture([
      {
        id: "r",
        motionId: "imported-route",
        duration: 6,
        playbackRate: 1,
        navigation: { point: [1, 0, 1], movement: "walk" },
      },
    ]);
    const viaUpdate = applyCommands(routed, [
      {
        type: "update",
        id: actor(routed).id,
        changes: {
          clips: actor(routed).clips.map((c) => ({ ...c, duration: 7 })),
        },
      },
    ]);
    expect(actor(retime(routed, { duration: 7 })).clips[0]).toEqual(
      actor(viaUpdate).clips[0],
    );
    expect(actor(viaUpdate).clips[0].navigation).toEqual({
      point: [1, 0, 1],
      movement: "walk",
    });
    const native = fixture([
      {
        id: "n",
        motionId: "wave",
        duration: 2,
        playbackRate: 1,
        navigation: {
          movement: "walk",
          native: { motionId: "wave", duration: 2, playbackRate: 1 },
        },
      },
    ]);
    expect(
      actor(retime(native, { duration: 4 })).clips[0].navigation?.native,
    ).toMatchObject({
      motionId: "wave",
      duration: 4,
      playbackRate: 1,
    });
  });
});
