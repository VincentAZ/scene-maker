import * as T from "three";
import { expect, it } from "vitest";
import {
  compilePath,
  samplePath,
  sourcePathProgress,
  type MotionPath,
} from "../shared/path";
import type { LocomotionProfile } from "../src/locomotion";
import {
  capturedRouteContactOffset,
  capturedRouteTravelScale,
} from "../src/routeContactWarp";
import { capturedRouteHeading } from "../src/routeTrajectoryHeading";

function fixture(scale = 1) {
  const path: MotionPath = {
    points: [
      [0, 0, 0],
      [0.08 * scale, 0, 0.8 * scale],
      [0, 0, 1.6 * scale],
    ],
    smooth: true,
    sourceProgress: [0, 0.5, 1],
    endHeading: 0,
  };
  path.strideScale = compilePath(path).length / (1.6 * scale);
  const frames = Array.from({ length: 241 }, (_, i) => ({
    time: i / 60,
    distance: i / 150,
    center: new T.Vector3(0, 1, i / 150),
    heading: 0,
  }));
  const profile: LocomotionProfile = {
    frames,
    duration: 4,
    distance: 1.6,
    startHeading: 0,
    mode: "travel",
    warning: "",
    nativeContacts: [
      {
        side: "left",
        start: 1,
        end: 3,
        samples: [
          { time: 1, point: new T.Vector3(0, 0, 0.8) },
          { time: 3, point: new T.Vector3(0, 0, 0.8) },
        ],
      },
    ],
  };
  const offset = (time: number) =>
    capturedRouteContactOffset(path, profile, time, scale, 1)!;
  const foot = (time: number) =>
    new T.Vector3(0, -1, 0.8 - time * 0.4)
      .applyAxisAngle(
        new T.Vector3(0, 1, 0),
        capturedRouteHeading(path, profile, time, scale, 1, 0)!,
      )
      .multiplyScalar(scale)
      .add(
        new T.Vector3(
          ...samplePath(path, sourcePathProgress(path, time / 4)).point,
        ),
      );
  return { path, profile, offset, foot };
}

it.each([0.1, 1, 5])(
  "shares a planted foot's correction with the body path at receiver scale %s",
  (scale) => {
    const f = fixture(scale),
      original = JSON.stringify({ path: f.path, profile: f.profile });
    const before = f.foot(1),
      planted = f.foot(1).add(f.offset(1));
    let rawDrift = 0,
      correctedDrift = 0;
    for (let i = 60; i <= 180; i++) {
      const foot = f.foot(i / 60);
      rawDrift = Math.max(rawDrift, foot.distanceTo(before));
      correctedDrift = Math.max(
        correctedDrift,
        f
          .foot(i / 60)
          .add(f.offset(i / 60))
          .distanceTo(planted),
      );
    }
    expect(rawDrift / scale).toBeGreaterThan(0.01);
    expect(correctedDrift / scale).toBeLessThan(0.004);
    expect(correctedDrift).toBeLessThan(rawDrift * 0.15);
    expect(f.offset(0).length()).toBe(0);
    expect(f.offset(4).length()).toBe(0);
    expect(JSON.stringify({ path: f.path, profile: f.profile })).toBe(original);
  },
);

it("keeps deterministic reverse seeking and continuous correction velocity through source frame boundaries", () => {
  const f = fixture(),
    saved = f.offset(1.6);
  f.offset(3.7);
  expect(f.offset(1.6).distanceTo(saved)).toBe(0);
  for (const t of [0, 1, 1.5, 3, 4]) {
    const h = 1e-6,
      center = f.offset(t);
    const before = center
      .clone()
      .sub(f.offset(t - h))
      .divideScalar(h);
    const after = f
      .offset(t + h)
      .sub(center)
      .divideScalar(h);
    expect(before.distanceTo(after)).toBeLessThan(0.001);
  }
});

it("requires measured native ground contacts and a complete repaired trajectory", () => {
  const { path, profile } = fixture();
  expect(
    capturedRouteContactOffset(
      { ...path, sourceProgress: undefined },
      profile,
      2,
      1,
      1,
    ),
  ).toBeUndefined();
  expect(
    capturedRouteContactOffset(
      path,
      { ...profile, nativeContacts: undefined },
      2,
      1,
      1,
    ),
  ).toBeUndefined();
  expect(
    capturedRouteContactOffset(
      { ...path, strideScale: path.strideScale! / 2 },
      profile,
      2,
      1,
      1,
    ),
  ).toBeUndefined();
});

it("preserves the original captured body turn and sway when the route has no deformation", () => {
  const f = fixture(),
    profile = f.profile;
  const path: MotionPath = {
    ...f.path,
    points: [
      [0, 0, 0],
      [0, 0, 0.8],
      [0, 0, 1.6],
    ],
    strideScale: 1,
  };
  profile.frames.forEach((f) => {
    f.heading = 0.5 * Math.sin(f.time);
  });
  for (const t of [0, 0.7, 1.5, 2.4, 4, 1.5]) {
    const warp = capturedRouteContactOffset(path, profile, t, 1, 1)!;
    expect(warp.length()).toBeLessThan(1e-8);
  }
});

it.each([0.01, 100])(
  "preserves the correction across source units and coordinate frames (%s)",
  (units) => {
    const f = fixture(),
      turn = 0.73,
      up = new T.Vector3(0, 1, 0),
      origin = new T.Vector3(3, 2, -5);
    const transform = (p: T.Vector3) =>
      p.clone().applyAxisAngle(up, turn).add(origin).multiplyScalar(units);
    const profile: LocomotionProfile = {
      ...f.profile,
      distance: f.profile.distance * units,
      startHeading: turn,
      frames: f.profile.frames.map((frame) => ({
        ...frame,
        distance: frame.distance * units,
        center: transform(frame.center),
        heading: frame.heading + turn,
      })),
      nativeContacts: f.profile.nativeContacts!.map((contact) => ({
        ...contact,
        samples: contact.samples.map((sample) => ({
          ...sample,
          point: transform(sample.point),
        })),
      })),
    };
    for (const t of [0, 0.7, 1.5, 2.4, 4])
      expect(
        capturedRouteContactOffset(
          f.path,
          profile,
          t,
          1 / units,
          units,
        )!.distanceTo(f.offset(t)),
      ).toBeLessThan(1e-7);
    expect(
      capturedRouteTravelScale(f.path, profile, 1 / units, units),
    ).toBeCloseTo(capturedRouteTravelScale(f.path, f.profile, 1, 1)!, 8);
  },
);
