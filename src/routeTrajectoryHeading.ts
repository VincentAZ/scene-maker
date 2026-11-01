import {
  compilePath,
  samplePath,
  sourcePathProgress,
  type MotionPath,
} from "../shared/path";
import type { LocomotionProfile } from "./locomotion";

type Frame = { time: number; correction: number; velocity: number };
const cache = new WeakMap<
  MotionPath,
  WeakMap<LocomotionProfile, Map<string, Frame[]>>
>();
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const clamp = (n: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, n));

/** A repaired complete performance retains its captured facing. Only the
 * change in travel direction caused by the detour rotates that performance.
 * Compare both trajectories over the same source-time window; an instantaneous
 * spline tangent would turn every captured hip sway into a body swivel. */
export function capturedRouteHeading(
  path: MotionPath,
  profile: LocomotionProfile,
  time: number,
  bodyRatio: number,
  sourceHeight: number,
  sourceHeading: number,
) {
  if (path.strideScale === undefined || profile.mode !== "travel") return;
  const length = compilePath(path).length;
  if (
    Math.abs(length / (bodyRatio * path.strideScale) - profile.distance) > 1e-5
  )
    return;
  let profiles = cache.get(path);
  if (!profiles) cache.set(path, (profiles = new WeakMap()));
  let variants = profiles.get(profile);
  if (!variants) profiles.set(profile, (variants = new Map()));
  const key = `${bodyRatio}:${sourceHeight}`;
  let frames = variants.get(key);
  if (!frames) {
    const source = profile.frames;
    const points = source.map(
      (f) =>
        samplePath(
          path,
          sourcePathProgress(path, f.distance / profile.distance),
        ).point,
    );
    let before = 0,
      after = 0,
      correction = 0;
    frames = source.map((f, i) => {
      while (before + 1 < i && source[before + 1].time <= f.time - 0.75)
        before++;
      while (after + 1 < source.length && source[after].time < f.time + 0.75)
        after++;
      const a = source[before],
        b = source[after],
        dt = b.time - a.time;
      const sx = b.center.x - a.center.x,
        sz = b.center.z - a.center.z;
      const px = points[after][0] - points[before][0],
        pz = points[after][2] - points[before][2];
      if (
        i &&
        dt > 0 &&
        Math.hypot(sx, sz) / dt >= sourceHeight * 0.18 &&
        Math.hypot(px, pz) / dt >= sourceHeight * bodyRatio * 0.18
      ) {
        const desired =
          Math.atan2(px, pz) - Math.atan2(sx, sz) + profile.startHeading;
        const limit = 1.5 * (f.time - source[i - 1].time);
        correction += clamp(wrap(desired - correction), -limit, limit);
      }
      return { time: f.time, correction, velocity: 0 };
    });
    const last = frames.length - 1;
    const ending =
      path.endHeading === undefined
        ? 0
        : wrap(path.endHeading - source[last].heading + profile.startHeading);
    frames[last].correction = ending;
    // Match the original entry and requested final facing without a late snap.
    for (let i = last - 1; i >= 0; i--) {
      const limit = 1.5 * (frames[i + 1].time - frames[i].time);
      frames[i].correction = clamp(
        frames[i].correction,
        frames[i + 1].correction - limit,
        frames[i + 1].correction + limit,
      );
    }
    for (let i = 1; i < last; i++) {
      const a =
        (frames[i].correction - frames[i - 1].correction) /
        (frames[i].time - frames[i - 1].time);
      const b =
        (frames[i + 1].correction - frames[i].correction) /
        (frames[i + 1].time - frames[i].time);
      if (a * b > 0) frames[i].velocity = (2 * a * b) / (a + b);
    }
    variants.set(key, frames);
  }
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (frames[middle].time < time) low = middle;
    else high = middle;
  }
  const a = frames[low],
    b = frames[high],
    dt = b.time - a.time;
  const u = dt > 0 ? clamp((time - a.time) / dt, 0, 1) : 0,
    u2 = u * u,
    u3 = u2 * u;
  const correction =
    (2 * u3 - 3 * u2 + 1) * a.correction +
    (u3 - 2 * u2 + u) * dt * a.velocity +
    (-2 * u3 + 3 * u2) * b.correction +
    (u3 - u2) * dt * b.velocity;
  return sourceHeading - profile.startHeading + correction;
}
