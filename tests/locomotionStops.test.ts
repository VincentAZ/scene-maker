import { expect, it } from "vitest";
import * as T from "three";
import { detectLocomotionStops, type StopFrame } from "../src/locomotionStops";
function arrival(scale = 1): StopFrame[] {
  return Array.from({ length: 81 }, (_, i) => {
    const time = i / 20;
    const distance =
      time <= 2
        ? time * 0.6
        : time < 2.5
          ? 1.2 + 0.6 * (time - 2) - (time - 2) ** 2 * 0.6
          : 1.35;
    return {
      time,
      distance: distance * scale,
      heading: 0,
      feet: [
        new T.Vector3(-0.1, 0, Math.min(distance, 1.08)).multiplyScalar(scale),
        new T.Vector3(0.1, 0, distance + 0.15).multiplyScalar(scale),
      ],
      heights: [0, 0],
    };
  });
}
it("finds a deceleration into stable two-foot support independently of imported units", () => {
  for (const scale of [0.1, 1, 10]) {
    const result = detectLocomotionStops(arrival(scale), scale);
    expect(result).toHaveLength(1);
    expect(result[0].settled).toBeGreaterThan(2.3);
    expect(result[0].sourceEnd).toBeGreaterThan(result[0].settled + 0.4);
    expect(result[0].entries.length).toBeGreaterThan(0);
    for (const e of result[0].entries) {
      expect(e.time).toBeLessThan(result[0].settled - 0.3);
      expect(e.distance).toBeGreaterThan(scale * 0.12);
      expect(e.support).toBe(1);
    }
  }
});
it("rejects initial idles, airborne pauses, sliding feet and unknown ground evidence", () => {
  const stationary = arrival().map((f) => ({
    ...f,
    distance: 0,
    feet: [new T.Vector3(-0.1, 0, 0), new T.Vector3(0.1, 0, 0)],
  }));
  expect(detectLocomotionStops(stationary, 1)).toEqual([]);
  const lifted = arrival().map((f) => ({
    ...f,
    heights: [0.2, 0.2] as [number, number],
  }));
  expect(detectLocomotionStops(lifted, 1)).toEqual([]);
  const sliding = arrival().map((f) => ({
    ...f,
    feet: f.feet.map((p) =>
      p.clone().add(new T.Vector3(0.2 * Math.max(0, f.time - 2), 0, 0)),
    ),
  }));
  expect(detectLocomotionStops(sliding, 1)).toEqual([]);

  expect(
    detectLocomotionStops(
      arrival().map(({ heights: _, ...f }) => f),
      1,
    ),
  ).toEqual([]);
});
it("does not treat a short double-support pause as a settled arrival", () => {
  const frames = arrival().filter((f) => f.time <= 2.65);
  expect(detectLocomotionStops(frames, 1)).toEqual([]);
});
it("accepts irregular sample spacing without changing the detected event", () => {
  const frames = arrival().filter((_, i) => i % 3 !== 1);
  const result = detectLocomotionStops(frames, 1);
  expect(result).toHaveLength(1);
  expect(result[0].settled).toBeGreaterThan(2.3);
  expect(result[0].end).toBe(4);
});

it("retains an authored torso turn while both feet remain planted after stopping", () => {
  const result = detectLocomotionStops(
    arrival().map((f) => ({ ...f, heading: Math.max(0, f.time - 2.5) * 0.4 })),
    1,
  );
  expect(result).toHaveLength(1);
});
