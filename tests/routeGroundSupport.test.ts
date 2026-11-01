import { expect, it } from "vitest";
import {
  groundSupportEnvelope,
  sampleLoopGroundSupport,
} from "../src/routeGroundSupport";

it("smooths narrow penetration spikes without lowering their support or altering distant flight", () => {
  const samples = Array.from({ length: 61 }, (_, i) => (i === 30 ? 0.04 : 0));
  const result = groundSupportEnvelope(samples, 3);
  result.forEach((value, i) => {
    expect(value).toBeGreaterThanOrEqual(samples[i] - 1e-12);
    expect(value).toBeLessThanOrEqual(0.04 + 1e-12);
    if (Math.abs(i - 30) > 6) expect(value).toBe(0);
  });
  const curvature = (values: number[]) =>
    Math.max(
      ...values
        .slice(1, -1)
        .map((value, i) => Math.abs(values[i] - 2 * value + values[i + 2])),
    );
  expect(curvature(result)).toBeLessThan(curvature(samples) / 4);
});

it("keeps constant support constant without adding a hovering offset", () => {
  for (const loop of [true, false]) {
    for (const value of [0, 0.02])
      groundSupportEnvelope(Array(25).fill(value), 3, loop).forEach((sample) =>
        expect(sample).toBeCloseTo(value, 12),
      );
  }
});

it("joins support across repeated endpoints and bounds every irregular penetration sample", () => {
  const samples = Array.from(
    { length: 53 },
    (_, i) => Math.max(0, Math.sin(i * 0.7)) * 0.03,
  );
  samples[0] = 0.01;
  samples[samples.length - 1] = 0.04;
  const result = groundSupportEnvelope(samples, 3, true);
  expect(result[0]).toBe(result.at(-1));
  result.forEach((value, i) =>
    expect(value).toBeGreaterThanOrEqual(samples[i] - 1e-12),
  );
  expect(samples[0]).toBe(0.01);
  expect(samples.at(-1)).toBe(0.04);
});

it("keeps loop support bounded with continuous velocity at the seam and every sample", () => {
  const frames = [0, 0.13, 0.4, 0.7, 1].map((time, i) => ({
    time,
    loopGroundLift: [0.04, 0.06, 0.08, 0, 0.04][i],
  }));
  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i].loopGroundLift,
      b = frames[i + 1].loopGroundLift;
    for (let j = 0; j <= 100; j++) {
      const value = sampleLoopGroundSupport(frames, i, j / 100);
      expect(value).toBeGreaterThanOrEqual(Math.min(a, b) - 1e-12);
      expect(value).toBeLessThanOrEqual(Math.max(a, b) + 1e-12);
    }
  }
  const h = 1e-6;
  for (let i = 0; i < frames.length - 1; i++) {
    const before = i === 0 ? frames.length - 2 : i - 1;
    const dtBefore = frames[before + 1].time - frames[before].time;
    const dtAfter = frames[i + 1].time - frames[i].time;
    const incoming =
      (sampleLoopGroundSupport(frames, before, 1) -
        sampleLoopGroundSupport(frames, before, 1 - h / dtBefore)) /
      h;
    const outgoing =
      (sampleLoopGroundSupport(frames, i, h / dtAfter) -
        sampleLoopGroundSupport(frames, i, 0)) /
      h;
    expect(Math.abs(incoming - outgoing)).toBeLessThan(1e-5);
  }
});
