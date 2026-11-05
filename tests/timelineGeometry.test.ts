import { describe, expect, it } from "vitest";
import {
  clipStarts,
  dragEnd,
  durationBounds,
  formatRate,
  formatSeconds,
  pixelsToSeconds,
  roundToStep,
  secondsToPixels,
  snapMarkers,
  snapToMarkers,
  sourceEndMarker,
  stretchRate,
  trimStart,
} from "../src/timelineGeometry";

/** A standalone recorded take of four seconds, played at native speed. */
const take = (over: Record<string, unknown> = {}) => ({
  id: "take",
  motionId: "wave",
  duration: 4,
  playbackRate: 1,
  ...over,
});
const noSnap = { shift: false, markers: [], tolerance: 0.1 };

describe("timeline geometry", () => {
  it("converts pointer travel to seconds from the measured track", () => {
    expect(pixelsToSeconds(40, 12, 600)).toBeCloseTo(0.8);
    expect(secondsToPixels(0.8, 12, 600)).toBeCloseTo(40);
    expect(pixelsToSeconds(40, 12, 0)).toBe(0);
    expect(roundToStep(2.4833 + 0.8)).toBe(3.3);
    expect(roundToStep(0.1 + 0.2)).toBe(0.3);
  });

  it("bounds a clip's length by its stop and its saved hold", () => {
    expect(durationBounds({})).toEqual({ min: 0.2, max: 60 });
    expect(durationBounds({ routeStop: 2.5 })).toEqual({ min: 2.5, max: 60 });
    expect(durationBounds({ routeHold: 1 })).toEqual({ min: 1.2, max: 60 });
    expect(durationBounds({ routeStop: 2, routeHold: 1 })).toEqual({
      min: 2,
      max: 60,
    });
  });

  it("lists where each clip starts", () => {
    expect(
      clipStarts([{ duration: 2 }, { duration: 3 }, { duration: 1 }]),
    ).toEqual([0, 2, 5]);
  });

  it("offers the other rows' cues, the playhead and the ruler as markers", () => {
    const markers = snapMarkers({
      cast: [
        { id: "a", name: "Mila", clips: [{ duration: 2 }, { duration: 3 }] },
        { id: "b", name: "Leo", clips: [{ duration: 4 }] },
      ],
      entityId: "a",
      total: 12,
      playhead: 7.25,
    });
    expect(markers).toContainEqual({ time: 4, label: "Leo" });
    expect(markers.some((m) => m.label === "Mila")).toBe(false);
    expect(markers).toContainEqual({ time: 7.25, label: "the playhead" });
    expect(
      markers.filter((m) => m.label === "the ruler").map((m) => m.time),
    ).toEqual([0, 2, 4, 6, 8, 10, 12]);
  });

  it("snaps to the nearest marker within tolerance", () => {
    const markers = [
      { time: 4, label: "Leo" },
      { time: 4.3, label: "the playhead" },
    ];
    expect(snapToMarkers(4.1, markers, 0.15)).toEqual({
      time: 4,
      label: "Leo",
    });
    expect(snapToMarkers(4.2, markers, 0.15)).toEqual({
      time: 4.3,
      label: "the playhead",
    });
    expect(snapToMarkers(5, markers, 0.15)).toEqual({ time: 5 });
  });

  it("marks where a take runs out of frames", () => {
    expect(sourceEndMarker(take({ duration: 6 }), 2, 4)).toEqual({
      time: 6,
      label: "the end of the recording",
    });
    expect(
      sourceEndMarker(take({ playbackRate: 2, sourceStart: 1 }), 0, 4).time,
    ).toBeCloseTo(1.5);
  });

  it("drags a right edge on the tenth grid and clamps to the clip's bounds", () => {
    const clip = take({ duration: 2.4833 });
    expect(dragEnd({ clip, start: 0, deltaSeconds: 0.8, ...noSnap })).toEqual({
      duration: 3.3,
    });
    expect(dragEnd({ clip, start: 0, deltaSeconds: -5, ...noSnap })).toEqual({
      duration: 0.2,
    });
    expect(dragEnd({ clip, start: 0, deltaSeconds: 90, ...noSnap })).toEqual({
      duration: 60,
    });
    expect(
      dragEnd({
        clip: take({ duration: 5, routeStop: 3 }),
        start: 0,
        deltaSeconds: -4,
        ...noSnap,
      }),
    ).toEqual({ duration: 3 });
  });

  it("snaps a right edge to a marker with Shift and names it", () => {
    const clip = take({ duration: 3 });
    const markers = [{ time: 7.9, label: "Leo" }];
    expect(
      dragEnd({
        clip,
        start: 4,
        deltaSeconds: 0.97,
        shift: true,
        markers,
        tolerance: 0.1,
      }),
    ).toEqual({ duration: 3.9, snapped: "Leo" });
    expect(
      dragEnd({
        clip,
        start: 4,
        deltaSeconds: 0.97,
        shift: false,
        markers,
        tolerance: 0.1,
      }),
    ).toEqual({ duration: 4 });
    // A snap the clip cannot reach is clamped and loses its name.
    expect(
      dragEnd({
        clip,
        start: 4,
        deltaSeconds: -2.95,
        shift: true,
        markers: [{ time: 4.05, label: "the ruler" }],
        tolerance: 0.1,
      }),
    ).toEqual({ duration: 0.2 });
  });

  it("trims into a take from the left, keeping the frame at its right edge", () => {
    const clip = take();
    expect(
      trimStart({
        clip,
        start: 2,
        sourceDuration: 4,
        deltaSeconds: 1,
        ...noSnap,
      }),
    ).toMatchObject({ duration: 3, sourceStart: 1, shift: 1 });
    // Speed scales how far the trim moves into the recording.
    expect(
      trimStart({
        clip: take({ duration: 2, playbackRate: 2 }),
        start: 0,
        sourceDuration: 4,
        deltaSeconds: 0.5,
        ...noSnap,
      }),
    ).toMatchObject({ duration: 1.5, sourceStart: 1, shift: 0.5 });
    // Dragging left restores frames down to the recording's first one.
    expect(
      trimStart({
        clip: take({ sourceStart: 1 }),
        start: 0,
        sourceDuration: 4,
        deltaSeconds: -3,
        ...noSnap,
      }),
    ).toMatchObject({ duration: 5, sourceStart: 0, shift: -1 });
    // A playable moment of the clip and of the recording always remains.
    expect(
      trimStart({
        clip,
        start: 0,
        sourceDuration: 4,
        deltaSeconds: 10,
        ...noSnap,
      }),
    ).toMatchObject({ duration: 0.2, sourceStart: 3.8, shift: 3.8 });
    expect(
      trimStart({
        clip: take({ duration: 9 }),
        start: 0,
        sourceDuration: 4,
        deltaSeconds: 10,
        ...noSnap,
      }),
    ).toMatchObject({ duration: 5.2, sourceStart: 3.8, shift: 3.8 });
    expect(
      trimStart({
        clip,
        start: 2,
        sourceDuration: 4,
        deltaSeconds: 1.03,
        shift: true,
        markers: [{ time: 3, label: "the playhead" }],
        tolerance: 0.1,
      }),
    ).toMatchObject({
      duration: 3,
      sourceStart: 1,
      shift: 1,
      snapped: "the playhead",
    });
  });

  it("stretches a take so its current frames fill a new length", () => {
    expect(stretchRate(take(), 4, 8)).toBe(0.5);
    expect(stretchRate(take({ duration: 2 }), 4, 1)).toBe(2);
    expect(stretchRate(take({ duration: 6 }), 4, 3)).toBeCloseTo(4 / 3);
    expect(stretchRate(take({ sourceStart: 4 }), 4, 2)).toBe(0.001);
  });

  it("formats labels for creators", () => {
    expect(formatSeconds(3.4)).toBe("3.4 s");
    expect(formatSeconds(2.4833)).toBe("2.48 s");
    expect(formatSeconds(4)).toBe("4.0 s");
    expect(formatRate(0.8)).toBe("0.8×");
    expect(formatRate(4 / 3)).toBe("1.33×");
  });
});
