import { describe, expect, it } from "vitest";
import type { Point } from "../shared/ladder";
import { clearSegment, type Footprint } from "../shared/navigation";
import {
  compilePath,
  samplePath,
  sourcePathProgress,
  type MotionPath,
} from "../shared/path";
import { repairCapturedTrajectory } from "../shared/trajectoryRoute";

const obstacle: Footprint = {
  id: "block",
  name: "Block",
  minX: -0.2,
  maxX: 0.2,
  minZ: 1,
  maxZ: 1.3,
};
const trajectory: Point[] = [
  [0, 0, 0],
  [0, 0, 0.5],
  [0, 0, 1.15],
  [0, 0, 1.8],
  [0.5, 0, 2],
  [1, 0, 1.5],
  [1, 0, 0.5],
  [0.1, 0, 0.1],
];

describe("captured trajectory repair", () => {
  it.each([0.2, 1, 3])(
    "retains outward and return travel around an obstacle at scale %s",
    (scale) => {
      const points = trajectory.map((p) => p.map((n) => n * scale) as Point);
      const box = {
        ...obstacle,
        minX: obstacle.minX * scale,
        maxX: obstacle.maxX * scale,
        minZ: obstacle.minZ * scale,
        maxZ: obstacle.maxZ * scale,
      };
      const original = JSON.stringify(points);
      const repaired = repairCapturedTrajectory(points, [box], scale);
      expect(repaired.points[0]).toEqual(points[0]);
      expect(repaired.points.at(-1)).toEqual(points.at(-1));
      const compiled = compilePath(repaired);
      expect(compiled.length / scale).toBeGreaterThan(4);
      expect(
        Math.max(...compiled.samples.map((p) => p.point[2])) / scale,
      ).toBeGreaterThan(1.9);
      expect(
        compiled.samples
          .slice(1)
          .every((p, i) =>
            clearSegment(compiled.samples[i].point, p.point, [box]),
          ),
      ).toBe(true);
      expect(repaired.points.length).toBeLessThanOrEqual(32);
      expect(JSON.stringify(points)).toBe(original);
    },
  );

  it("preserves a closed return instead of replacing it with zero travel", () => {
    const repaired = repairCapturedTrajectory(
      [...trajectory.slice(0, -1), trajectory[0]],
      [],
    );
    expect(repaired.points.at(-1)).toEqual(repaired.points[0]);
    expect(compilePath(repaired).length).toBeGreaterThan(4);
  });

  it("refuses an obstructed endpoint", () => {
    expect(() =>
      repairCapturedTrajectory(
        [
          [0, 0, 0],
          [0, 0, 1.1],
        ],
        [obstacle],
      ),
    ).toThrow(/starts or ends/);
  });

  it("retains the source phase of clear landmarks on both sides of a local detour", () => {
    const repaired = repairCapturedTrajectory(trajectory, [obstacle]);
    const distances = [0];
    for (let i = 1; i < trajectory.length; i++)
      distances.push(
        distances[i - 1] +
          Math.hypot(
            trajectory[i][0] - trajectory[i - 1][0],
            trajectory[i][2] - trajectory[i - 1][2],
          ),
      );
    let retained = 0,
      oldError = 0;
    for (const [index, point] of trajectory.entries()) {
      if (
        !repaired.points.some(
          (p) => JSON.stringify(p) === JSON.stringify(point),
        )
      )
        continue;
      const fraction = distances[index] / distances.at(-1)!;
      const mapped = samplePath(
        repaired,
        sourcePathProgress(repaired, fraction),
      ).point;
      expect(Math.hypot(...mapped.map((n, i) => n - point[i]))).toBeLessThan(
        1e-9,
      );
      const old = samplePath(repaired, fraction).point;
      oldError = Math.max(
        oldError,
        Math.hypot(...old.map((n, i) => n - point[i])),
      );
      retained++;
    }
    expect(retained).toBeGreaterThan(3);
    expect(oldError).toBeGreaterThan(0.01);
  });

  it("interpolates captured progress monotonically with continuous speed at uneven anchors", () => {
    const path: MotionPath = {
      points: [
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 2],
        [1, 0, 5],
      ],
      smooth: true,
      sourceProgress: [0, 0.1, 0.7, 1],
      strideScale: 1,
    };
    const compiled = compilePath(path);
    expect(sourcePathProgress(path, 0)).toBe(0);
    expect(sourcePathProgress(path, 1)).toBe(1);
    let previous = 0;
    for (let i = 1; i <= 2000; i++) {
      const value = sourcePathProgress(path, i / 2000);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
    for (let i = 1; i < path.points.length - 1; i++) {
      const u = path.sourceProgress![i],
        h = 1e-6,
        middle = sourcePathProgress(path, u);
      expect(middle).toBeCloseTo(
        compiled.samples[i * 40].distance / compiled.length,
        10,
      );
      const left = (middle - sourcePathProgress(path, u - h)) / h;
      const right = (sourcePathProgress(path, u + h) - middle) / h;
      expect(Math.abs(left - right)).toBeLessThan(0.0001);
    }
  });
});
