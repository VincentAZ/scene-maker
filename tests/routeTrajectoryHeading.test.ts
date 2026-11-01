import { expect, it } from "vitest";
import * as T from "three";
import { compilePath, type MotionPath } from "../shared/path";
import type { LocomotionProfile } from "../src/locomotion";
import { capturedRouteHeading } from "../src/routeTrajectoryHeading";

function fixture() {
  const path: MotionPath = {
    points: Array.from({ length: 21 }, (_, i) => [
      i === 0 || i === 20 ? 0 : i % 2 ? 0.03 : -0.03,
      0,
      i / 5,
    ]),
    smooth: true,
    endHeading: 0,
  };
  const compiled = compilePath(path);
  const profile: LocomotionProfile = {
    duration: 4,
    distance: compiled.length,
    startHeading: 0.6,
    mode: "travel",
    warning: "",
    frames: compiled.samples.map((f, i) => ({
      time: (4 * i) / (compiled.samples.length - 1),
      distance: f.distance,
      center: new T.Vector3(...f.point)
        .applyAxisAngle(new T.Vector3(0, 1, 0), 0.6)
        .add(new T.Vector3(2, 1, -3)),
      heading: 0.6,
    })),
  };
  path.strideScale = 1;
  return { path, profile };
}

it("does not turn captured lateral sway into body swivels when reconstructing the same trajectory", () => {
  const { path, profile } = fixture();
  const snapshot = JSON.stringify({ path, profile });
  for (const frame of profile.frames)
    expect(
      capturedRouteHeading(path, profile, frame.time, 1, 1, 0.6),
    ).toBeCloseTo(0, 9);
  expect(JSON.stringify({ path, profile })).toBe(snapshot);
});

it("bounds detour-facing changes in source time and retains entry/end facing across reverse seeks", () => {
  const { path, profile } = fixture();
  profile.frames.forEach((f) => {
    f.center.set(0, 1, f.time);
    f.distance = f.time;
    f.heading = 0;
  });
  profile.distance = 4;
  profile.startHeading = 0;
  path.strideScale = compilePath(path).length / 4;
  path.endHeading = 0.4;
  expect(path.strideScale).toBeLessThan(1.1);
  const sample = (t: number) =>
    capturedRouteHeading(path, profile, t, 1, 1, 0)!;
  expect(sample(0)).toBeCloseTo(0, 9);
  expect(sample(4)).toBeCloseTo(0.4, 9);
  let previous = sample(0);
  for (let i = 1; i <= 4000; i++) {
    const heading = sample(i / 1000);
    expect(Math.abs(heading - previous) * 1000).toBeLessThan(2.26);
    previous = heading;
  }
  const a = sample(0.7);
  sample(3.1);
  expect(sample(0.7)).toBe(a);
});

it("leaves ordinary and repeated gait route alignment to the existing sampler", () => {
  const { path, profile } = fixture();
  expect(
    capturedRouteHeading(
      { ...path, strideScale: undefined },
      profile,
      1,
      1,
      1,
      0,
    ),
  ).toBeUndefined();
  expect(
    capturedRouteHeading(
      path,
      { ...profile, distance: profile.distance / 2 },
      1,
      1,
      1,
      0,
    ),
  ).toBeUndefined();
});
