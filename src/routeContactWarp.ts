import * as T from "three";
import {
  compilePath,
  samplePath,
  sourcePathProgress,
  type MotionPath,
} from "../shared/path";
import type { LocomotionProfile } from "./locomotion";
import { contactPoint } from "./routeContacts";
import { capturedRouteHeading } from "./routeTrajectoryHeading";

type Constraint = {
  indices: number[];
  coefficients: number[];
  weight: number;
  x: number;
  z: number;
};
type Frame = {
  time: number;
  offset: T.Vector3;
  velocity: T.Vector3;
};
const cache = new WeakMap<
  MotionPath,
  WeakMap<LocomotionProfile, Map<string, Frame[]>>
>();
const up = new T.Vector3(0, 1, 0);
// Contact fidelity dominates proximity to the proposed centerline. The
// acceleration penalty spreads its remaining adjustment over adjacent frames.
const contactWeight = 1000;
const smoothingSeconds = 0.08;

// A sparse least-squares solve shares the body adjustment across a whole take.
// Contact anchors are unknowns too, so a later footfall inherits the adjusted
// path instead of snapping back to an unadjusted landing point.
function solve(rows: Constraint[], count: number, axis: "x" | "z") {
  const pinned = (i: number) => i < 2 || i >= count - 2;
  const diagonal = new Float64Array(count),
    rhs = new Float64Array(count);
  for (const row of rows)
    row.indices.forEach((i, j) => {
      if (pinned(i)) return;
      diagonal[i] += row.weight * row.coefficients[j] ** 2;
      rhs[i] += row.weight * row.coefficients[j] * row[axis];
    });
  const multiply = (values: Float64Array) => {
    const result = new Float64Array(count);
    for (const row of rows) {
      let dot = 0;
      row.indices.forEach((i, j) => {
        if (!pinned(i)) dot += row.coefficients[j] * values[i];
      });
      row.indices.forEach((i, j) => {
        if (!pinned(i)) result[i] += row.weight * row.coefficients[j] * dot;
      });
    }
    return result;
  };
  const result = new Float64Array(count),
    residual = rhs.slice(),
    direction = new Float64Array(count);
  let norm = 0;
  for (let i = 2; i < count - 2; i++) {
    direction[i] = residual[i] / diagonal[i];
    norm += residual[i] * direction[i];
  }
  const initial = norm;
  for (
    let iteration = 0;
    iteration < 300 && norm > Math.max(1e-24, initial * 1e-16);
    iteration++
  ) {
    const product = multiply(direction);
    let denominator = 0;
    for (let i = 2; i < count - 2; i++)
      denominator += direction[i] * product[i];
    if (!(denominator > 0)) break;
    const alpha = norm / denominator;
    let nextNorm = 0;
    for (let i = 2; i < count - 2; i++) {
      result[i] += alpha * direction[i];
      residual[i] -= alpha * product[i];
      nextNorm += residual[i] ** 2 / diagonal[i];
    }
    const beta = nextNorm / norm;
    for (let i = 2; i < count - 2; i++)
      direction[i] = residual[i] / diagonal[i] + beta * direction[i];
    norm = nextNorm;
  }
  return result;
}

/** Adapt a complete repaired performance around its measured support. The
 * source clock, captured pose and route endpoints remain unchanged. Clearance
 * must be evaluated on this corrected body path, as it is during playback. */
export function capturedRouteContactOffset(
  path: MotionPath,
  profile: LocomotionProfile,
  time: number,
  bodyRatio: number,
  sourceHeight: number,
) {
  if (
    !path.sourceProgress ||
    path.strideScale === undefined ||
    profile.mode !== "travel" ||
    !profile.nativeContacts?.length ||
    profile.frames.length < 5 ||
    Math.abs(
      compilePath(path).length / (bodyRatio * path.strideScale) -
        profile.distance,
    ) > 1e-5
  )
    return;
  let profiles = cache.get(path);
  if (!profiles) cache.set(path, (profiles = new WeakMap()));
  let variants = profiles.get(profile);
  if (!variants) profiles.set(profile, (variants = new Map()));
  const key = `${bodyRatio}:${sourceHeight}`;
  let warped = variants.get(key);
  if (!warped) {
    const frames = profile.frames,
      count = frames.length;
    const points = frames.map(
      (f) =>
        new T.Vector3(
          ...samplePath(
            path,
            sourcePathProgress(path, f.distance / profile.distance),
          ).point,
        ),
    );
    const turns = frames.map(
      (f) =>
        (capturedRouteHeading(
          path,
          profile,
          f.time,
          bodyRatio,
          sourceHeight,
          f.heading,
        ) ?? f.heading - profile.startHeading) - f.heading,
    );
    const rows: Constraint[] = frames.map((_, i) => ({
      indices: [i],
      coefficients: [1],
      weight: 1,
      x: 0,
      z: 0,
    }));
    // Penalize acceleration of the added displacement, not the captured body
    // sway. This distributes a contact correction through adjacent steps.
    for (let i = 1; i < count - 1; i++) {
      const before = frames[i].time - frames[i - 1].time,
        after = frames[i + 1].time - frames[i].time;
      const factor = 2 / (before + after);
      rows.push({
        indices: [i - 1, i, i + 1],
        coefficients: [
          factor / before,
          -factor * (1 / before + 1 / after),
          factor / after,
        ],
        weight: smoothingSeconds ** 4,
        x: 0,
        z: 0,
      });
    }
    for (const contact of profile.nativeContacts) {
      const anchor = frames.findIndex((f) => f.time >= contact.start - 1e-8);
      if (anchor < 0) continue;
      const first = contactPoint(contact, frames[anchor].time);
      const planted = first
        .clone()
        .sub(frames[anchor].center)
        .applyAxisAngle(up, turns[anchor])
        .multiplyScalar(bodyRatio)
        .add(points[anchor]);
      for (
        let i = anchor + 1;
        i < count && frames[i].time <= contact.end + 1e-8;
        i++
      ) {
        const foot = contactPoint(contact, frames[i].time);
        const expected = foot
          .clone()
          .sub(first)
          .applyAxisAngle(up, turns[anchor])
          .multiplyScalar(bodyRatio)
          .add(planted);
        const actual = foot
          .clone()
          .sub(frames[i].center)
          .applyAxisAngle(up, turns[i])
          .multiplyScalar(bodyRatio)
          .add(points[i]);
        const delta = expected.sub(actual);
        rows.push({
          indices: [i, anchor],
          coefficients: [1, -1],
          weight: contactWeight,
          x: delta.x,
          z: delta.z,
        });
      }
    }
    const x = solve(rows, count, "x"),
      z = solve(rows, count, "z");
    warped = frames.map((f, i) => ({
      time: f.time,
      offset: new T.Vector3(x[i], 0, z[i]),
      velocity: new T.Vector3(),
    }));
    for (let i = 1; i < count - 1; i++)
      for (const axis of ["x", "z"] as const) {
        const before =
          (warped[i].offset[axis] - warped[i - 1].offset[axis]) /
          (frames[i].time - frames[i - 1].time);
        const after =
          (warped[i + 1].offset[axis] - warped[i].offset[axis]) /
          (frames[i + 1].time - frames[i].time);
        if (before * after > 0)
          warped[i].velocity[axis] = (2 * before * after) / (before + after);
      }
    variants.set(key, warped);
  }
  let low = 0,
    high = warped.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (warped[middle].time < time) low = middle;
    else high = middle;
  }
  const a = warped[low],
    b = warped[high],
    dt = b.time - a.time;
  const u = T.MathUtils.clamp((time - a.time) / dt, 0, 1),
    u2 = u * u,
    u3 = u2 * u;
  const offset = a.offset
    .clone()
    .multiplyScalar(2 * u3 - 3 * u2 + 1)
    .addScaledVector(a.velocity, (u3 - 2 * u2 + u) * dt)
    .addScaledVector(b.offset, -2 * u3 + 3 * u2)
    .addScaledVector(b.velocity, (u3 - u2) * dt);
  return offset;
}

/** Spatial adaptation is measured after contact correction. A short proposed
 * centerline must not conceal extra travel introduced by the actual body path. */
export function capturedRouteTravelScale(
  path: MotionPath,
  profile: LocomotionProfile,
  bodyRatio: number,
  sourceHeight: number,
) {
  let previous: T.Vector3 | undefined;
  let distance = 0;
  for (const frame of profile.frames) {
    const offset = capturedRouteContactOffset(
      path,
      profile,
      frame.time,
      bodyRatio,
      sourceHeight,
    );
    if (!offset) return;
    const point = new T.Vector3(
      ...samplePath(
        path,
        sourcePathProgress(path, frame.distance / profile.distance),
      ).point,
    ).add(offset);
    if (previous) distance += point.distanceTo(previous);
    previous = point;
  }
  return distance / (profile.distance * bodyRatio);
}
