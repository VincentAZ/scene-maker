import { expect, it } from "vitest";
import { reconstructFlightTravel } from "../src/inPlaceFlight";

function run(offset = 0) {
  let distance = 0;
  return Array.from({ length: 101 }, (_, i) => {
    const time = i / 100;
    const phase = (((time + offset) % 1) + 1) % 1;
    const side =
      phase >= 0.1 && phase <= 0.3 ? 0 : phase >= 0.6 && phase <= 0.8 ? 1 : -1;
    if (i && side >= 0) distance += 0.03;
    return {
      time,
      heights: (side === 0 ? [0, 0.3] : side === 1 ? [0.3, 0] : [0.3, 0.3]) as [
        number,
        number,
      ],
      speeds: [3, 3] as [number, number],
      distance,
    };
  });
}

it("maintains inferred travel through alternating airborne phases without changing source time", () => {
  const frames = run();
  const saved = structuredClone(frames);
  const result = reconstructFlightTravel(frames, 1, true)!;
  expect(result).toBeDefined();
  expect(result.supports).toHaveLength(2);
  result.distances.forEach((distance, i) =>
    expect(distance).toBeCloseTo(i * 0.03, 8),
  );
  expect(frames).toEqual(saved);
});

it("does not turn alternating left/right stride speed into cyclic body surges", () => {
  const frames = run().map((frame) => ({
    ...frame,
    speeds: [2, 4] as [number, number],
  }));
  const result = reconstructFlightTravel(frames, 1, true)!;
  result.distances.forEach((distance, i) =>
    expect(distance).toBeCloseTo(i * 0.03, 8),
  );
});

it("preserves sustained acceleration through consecutive running strides", () => {
  const cycle = run();
  let distance = 0;
  const frames = Array.from({ length: 301 }, (_, i) => {
    const time = i / 100,
      heights = cycle[i % 100].heights;
    const speeds: [number, number] = [3 + time, 1 + time];
    if (i && heights[0] === 0) distance += speeds[0] * 0.01;
    else if (i && heights[1] === 0) distance += speeds[1] * 0.01;
    return { time, heights, speeds, distance };
  });
  const result = reconstructFlightTravel(frames, 1, false)!;
  for (const center of [0.7, 1.2, 1.7, 2.2]) {
    const i = Math.round(center * 100);
    const speed = (result.distances[i + 1] - result.distances[i - 1]) / 0.02;
    expect(Math.abs(speed - (2 + center))).toBeLessThan(0.03);
  }
});

it("joins a running support across a verified cyclic seam", () => {
  const frames = run(0.2);
  const result = reconstructFlightTravel(frames, 1, true)!;
  expect(result.supports).toHaveLength(3);
  expect(result.supports.some((s) => s.start === 0)).toBe(true);
  expect(result.supports.some((s) => s.end === 1)).toBe(true);
  result.distances.forEach((distance, i) =>
    expect(distance).toBeCloseTo(i * 0.03, 8),
  );
});

it("retains a cyclic stance when one seam fragment is shorter than the contact threshold", () => {
  const frames = run(0.28);
  const result = reconstructFlightTravel(frames, 1, true)!;
  expect(result.supports.some((s) => s.start === 0 && s.end < 0.05)).toBe(true);
  result.distances.forEach((distance, i) =>
    expect(distance).toBeCloseTo(i * 0.03, 8),
  );
});

it("uses relative anatomy thresholds consistently across source scales", () => {
  const frames = run(),
    baseline = reconstructFlightTravel(frames, 1, true)!;
  for (const scale of [0.1, 3, 100]) {
    const result = reconstructFlightTravel(
      frames.map((f) => ({
        ...f,
        distance: f.distance * scale,
        heights: f.heights.map((h) => h * scale) as [number, number],
        speeds: f.speeds.map((s) => s * scale) as [number, number],
      })),
      scale,
      true,
    )!;
    expect(
      result.supports.map(({ foot, start, end }) => ({ foot, start, end })),
    ).toEqual(
      baseline.supports.map(({ foot, start, end }) => ({ foot, start, end })),
    );
    result.distances.forEach((distance, i) =>
      expect(distance / scale).toBeCloseTo(baseline.distances[i], 8),
    );
  }
});

it("does not invent running travel for two-foot jumps, hops, or grounded walking", () => {
  const jumps = run().map((f) => ({
    ...f,
    heights: [f.heights[0], f.heights[0]] as [number, number],
  }));
  const hops = run().map((f) => ({
    ...f,
    heights: [Math.min(...f.heights), 0.3] as [number, number],
  }));
  const walk = run().map((f) => ({
    ...f,
    heights: f.heights.every((h) => h > 0)
      ? ([0, 0] as [number, number])
      : f.heights,
  }));
  for (const frames of [jumps, hops, walk])
    expect(reconstructFlightTravel(frames, 1, true)).toBeUndefined();
});

it("does not bridge a genuine grounded pause even when there is flight elsewhere in the gap", () => {
  for (const heights of [
    [0, 0],
    [0, 0.3],
  ] as [number, number][]) {
    const frames = run().map((f) =>
      f.time >= 0.4 && f.time <= 0.5
        ? { ...f, heights, speeds: [0, 0] as [number, number] }
        : f,
    );
    const result = reconstructFlightTravel(frames, 1, true)!;
    for (let i = 40; i <= 50; i++)
      expect(result.distances[i] - result.distances[i - 1]).toBeCloseTo(0, 8);
  }
});

it("keeps one-shot motion outside the confirmed running interval unchanged", () => {
  const frames = run();
  const result = reconstructFlightTravel(frames, 1, false)!;
  for (let i = 1; i < 10; i++)
    expect(result.distances[i]).toBe(frames[i].distance);
  for (let i = 82; i < frames.length; i++)
    expect(result.distances[i] - result.distances[i - 1]).toBeCloseTo(
      frames[i].distance - frames[i - 1].distance,
      8,
    );
});
