import { expect, it } from "vitest";
import * as T from "three";
import { detectCapturedTurns, type TurnFrame } from "../src/capturedTurns";

const smooth = (n: number) => {
  const t = T.MathUtils.clamp(n, 0, 1);
  return t * t * (3 - 2 * t);
};
function turn(scale = 1, sign = 1): TurnFrame[] {
  const up = new T.Vector3(0, 1, 0);
  return Array.from({ length: 181 }, (_, i) => {
    const time = i / 60,
      angle = (sign * Math.PI) / 2;
    const heading = angle * smooth((time - 0.6) / 1.05);
    const phases = [smooth((time - 0.6) / 0.5), smooth((time - 1.15) / 0.5)];
    const heights = phases.map((p) => Math.sin(Math.PI * p) * 0.12 * scale) as [
      number,
      number,
    ];
    return {
      time,
      heading,
      center: new T.Vector3(0, scale, 0),
      heights,
      feet: phases.map((p, side) => {
        const start = new T.Vector3(side ? -0.12 : 0.12, 0, 0.04);
        const end = start.clone().applyAxisAngle(up, angle);
        const point = start.lerp(end, p).multiplyScalar(scale);
        point.y = heights[side];
        return point;
      }),
    };
  });
}
it("finds a settled captured stepping turn in either direction without changing source data or units", () => {
  for (const scale of [0.01, 1, 100])
    for (const sign of [-1, 1]) {
      const frames = turn(scale, sign),
        before = JSON.stringify(frames);
      const turns = detectCapturedTurns(frames, scale);
      expect(turns).toHaveLength(1);
      const t = turns[0];
      expect(t.heading).toBeCloseTo((sign * Math.PI) / 2, 6);
      expect(t.sourceStart).toBeLessThan(0.6);
      expect(t.sourceEnd).toBeGreaterThan(1.65);
      expect(t.entry.end).toBeLessThan(0.65);
      expect(t.exit.start).toBeGreaterThan(1.6);
      expect(t.steppedSides).toEqual(["left", "right"]);
      expect(t.supportFraction).toBe(1);
      expect(t.displacement).toEqual([0, 0, 0]);
      expect(JSON.stringify(frames)).toBe(before);
    }
});
it("preserves real displacement in the entry-facing frame and unwraps headings across pi", () => {
  const initial = (170 * Math.PI) / 180;
  const frames = turn().map((f) => ({
    ...f,
    heading: Math.atan2(
      Math.sin(initial + f.heading),
      Math.cos(initial + f.heading),
    ),
    center: f.center
      .clone()
      .add(new T.Vector3(0.1 * smooth((f.time - 0.6) / 1.05), 0, 0)),
    feet: f.feet.map((p) =>
      p.clone().applyAxisAngle(new T.Vector3(0, 1, 0), initial),
    ),
  }));
  const result = detectCapturedTurns(frames, 1);
  expect(result).toHaveLength(1);
  expect(result[0].heading).toBeCloseTo(Math.PI / 2, 6);
  expect(
    new T.Vector3(...result[0].displacement).distanceTo(
      new T.Vector3(0.1, 0, 0).applyAxisAngle(new T.Vector3(0, 1, 0), -initial),
    ),
  ).toBeLessThan(1e-6);
});
it("does not promote a torso twist, sliding spin, airborne turn or travelling corner to a settled step", () => {
  const frames = turn();
  expect(
    detectCapturedTurns(
      frames.map((f) => ({
        ...f,
        heights: [0, 0],
        feet: frames[0].feet.map((p) => p.clone()),
      })),
      1,
    ),
  ).toEqual([]);
  expect(
    detectCapturedTurns(
      frames.map((f) => ({
        ...f,
        heights: [0, 0],
        feet: f.feet.map((p) => new T.Vector3(p.x, 0, p.z)),
      })),
      1,
    ),
  ).toEqual([]);
  expect(
    detectCapturedTurns(
      frames.map((f) => ({ ...f, heights: [0.3, 0.3] })),
      1,
    ),
  ).toEqual([]);
  expect(
    detectCapturedTurns(
      frames.map((f) => ({
        ...f,
        center: f.center
          .clone()
          .add(new T.Vector3(2 * smooth((f.time - 0.6) / 1.05), 0, 0)),
      })),
      1,
    ),
  ).toEqual([]);
  expect(
    detectCapturedTurns(
      frames.map((f) => ({ ...f, heading: 0 })),
      1,
    ),
  ).toEqual([]);
});
it("requires measured ground evidence, settled endpoints and valid samples", () => {
  const frames = turn();
  expect(
    detectCapturedTurns(
      frames.map(({ heights: _, ...f }) => f),
      1,
    ),
  ).toEqual([]);
  expect(
    detectCapturedTurns(
      frames.filter((f) => f.time < 1.8),
      1,
    ),
  ).toEqual([]);
  for (const bad of [0, -1, NaN, Infinity])
    expect(detectCapturedTurns(frames, bad)).toEqual([]);
  for (const change of [
    (f: TurnFrame) => {
      f.heading = NaN;
    },
    (f: TurnFrame) => {
      f.center.x = Infinity;
    },
    (f: TurnFrame) => {
      f.feet = [];
    },
    (f: TurnFrame) => {
      f.heights = [NaN, 0];
    },
    (f: TurnFrame) => {
      f.time = 0;
    },
  ]) {
    const invalid = turn();
    change(invalid[20]);
    expect(detectCapturedTurns(invalid, 1)).toEqual([]);
  }
});
it("handles irregular source samples without changing the turn angle or requiring frame-count thresholds", () => {
  const result = detectCapturedTurns(
    turn().filter((_, i) => i % 3 !== 1),
    1,
  );
  expect(result).toHaveLength(1);
  expect(result[0].heading).toBeCloseTo(Math.PI / 2, 6);
});
