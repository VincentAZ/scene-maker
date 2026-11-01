import { expect, it } from "vitest";
import { routeWithApproaches } from "../shared/routeApproach";
import {
  compilePath,
  pathToWorld,
  samplePath,
  type PathFrame,
} from "../shared/path";
import { clearSegment, type Footprint } from "../shared/navigation";
import type { Point } from "../shared/ladder";

const box = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): Footprint => ({ id: "obstacle", name: "Obstacle", minX, maxX, minZ, maxZ });
const angleDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

it.each([Math.PI / 2, -Math.PI / 2, Math.PI, -Math.PI])(
  "aligns the departure with captured entry travel %s without an artificial spin",
  (entry) => {
    const frame: PathFrame = { position: [2, 0, -1], heading: 0.7, scale: 1.3 };
    const direction = frame.heading + entry;
    const goal: Point = [
      frame.position[0] + 4 * Math.sin(direction),
      0,
      frame.position[2] + 4 * Math.cos(direction),
    ];
    const facing: Point = [
      goal[0] + Math.sin(direction),
      0,
      goal[2] + Math.cos(direction),
    ];
    const path = routeWithApproaches(
      frame,
      [goal],
      [],
      facing,
      "",
      0.5,
      false,
      entry,
    );
    const compiled = compilePath(path);
    expect(angleDifference(compiled.samples[0].heading, entry)).toBeCloseTo(
      0,
      9,
    );
    for (const u of [0, 0.001, 0.04, 0.08, 0.5, 1]) {
      expect(
        angleDifference(samplePath(path, u, entry).heading, entry),
      ).toBeCloseTo(0, 9);
      expect(
        Math.abs(
          samplePath(path, u, entry).heading -
            samplePath(path, 0, entry).heading,
        ),
      ).toBeLessThan(1e-8);
    }
  },
);

it("aligns departure and arrival with travel while keeping the interpolated detour clear", () => {
  for (const scale of [0.4, 1, 3]) {
    const frame: PathFrame = {
      position: [-3 * scale, 0, 0],
      heading: Math.PI / 2,
      scale,
    };
    const obstacles = [box(-scale, scale, -scale, scale)];
    const destination: Point = [4 * scale, 0, 0];
    const goals: Point[] = Array.from({ length: 32 }, (_, i) => [
      destination[0] + Math.sin((i * Math.PI) / 16) * scale,
      0,
      destination[2] + Math.cos((i * Math.PI) / 16) * scale,
    ]);
    const path = routeWithApproaches(
      frame,
      goals,
      obstacles,
      destination,
      "destination",
      0.5 * scale,
    );
    expect(path.smooth).toBe(true);
    const compiled = compilePath(path);
    expect(compiled.samples[0].heading).toBeCloseTo(0, 10);
    expect(
      angleDifference(compiled.samples.at(-1)!.heading, path.endHeading!),
    ).toBeCloseTo(0, 10);
    const world = compiled.samples.map((s) => pathToWorld(s.point, frame));
    for (let i = 1; i < world.length; i++)
      expect(clearSegment(world[i - 1], world[i], obstacles)).toBe(true);
    // The actor follows the route tangent throughout, without a separate
    // sideways body turn at either endpoint.
    for (const s of compiled.samples)
      expect(
        angleDifference(
          samplePath(path, s.distance / compiled.length).heading,
          s.heading,
        ),
      ).toBeCloseTo(0, 9);
    expect(path.points.length).toBeLessThanOrEqual(32);
    expect(compiled.length).toBeLessThan(10);
  }
});

it("retains a feasible route when a forward departure is blocked", () => {
  const frame: PathFrame = { position: [0, 0, 0], heading: 0, scale: 1 };
  const obstacles = [box(-0.3, 0.3, 0.1, 1)];
  const path = routeWithApproaches(
    frame,
    [[3, 0, 0]],
    obstacles,
    [4, 0, 0],
    "target",
    0.5,
  );
  const samples = compilePath(path).samples;
  for (let i = 1; i < samples.length; i++)
    expect(
      clearSegment(samples[i - 1].point, samples[i].point, obstacles),
    ).toBe(true);
  expect(samples.at(-1)!.point).toEqual([3, 0, 0]);
});

it("does not introduce a departure loop when already beside the destination", () => {
  const frame: PathFrame = { position: [0, 0, 0], heading: Math.PI, scale: 1 };
  const path = routeWithApproaches(
    frame,
    [[0.01, 0, 0]],
    [],
    [1, 0, 0],
    "target",
    0.5,
  );
  expect(compilePath(path).length).toBeCloseTo(0.01, 10);
  expect(path.points).toHaveLength(2);
});

it("does not reverse or overshoot between short approach guides on a long straight route", () => {
  const frame: PathFrame = { position: [0, 0, 0], heading: 0, scale: 1 };
  const path = routeWithApproaches(
    frame,
    [[0, 0, 6]],
    [],
    [0, 0, 7],
    "target",
    0.4,
  );
  const compiled = compilePath(path);
  expect(compiled.length).toBeCloseTo(6, 10);
  for (let i = 1; i < compiled.samples.length; i++)
    expect(compiled.samples[i].point[2]).toBeGreaterThan(
      compiled.samples[i - 1].point[2],
    );
});
