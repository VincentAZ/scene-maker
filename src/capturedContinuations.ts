import * as T from "three";
import type { LocomotionProfile } from "./locomotion";
import { sourcePoseSampler, compareSourceJoin } from "./sourceJoins";
import { finishNavigationWork } from "./navigationWork";

export type CapturedContinuation = ReturnType<typeof compareSourceJoin> & {
  sourceStart: number;
  sourceEnd: number;
  distance: number;
  support: number;
};

/** Search within a one-off take, retaining the prefix and suffix. Common
 * grounded support, actual source travel and full detailed pose/velocity
 * compatibility are prerequisites for repeating an interior movement interval.
 * This is candidate evidence; placing and closing the splice still needs
 * receiving-rig, path, contact and animated-clearance validation. */
export function* findCapturedContinuationSteps(
  source: T.Group,
  take: T.AnimationClip,
  profile: LocomotionProfile,
): Generator<
  void,
  {
    matches: CapturedContinuation[];
    best?: CapturedContinuation;
    examined: number;
  },
  unknown
> {
  if (
    profile.mode !== "travel" ||
    profile.duration < 1 ||
    profile.distance < 0.15 ||
    !profile.nativeContacts?.length
  )
    return { matches: [], examined: 0 };
  const sampler = sourcePoseSampler(source, take, profile),
    matches: CapturedContinuation[] = [];
  let best: CapturedContinuation | undefined,
    examined = 0;
  const candidates: CapturedContinuation[] = [];
  // These are prospective blends, not valid cuts. The same upper pose bounds
  // are enforced by the receiving route-loop closure before actual playback.
  const blendLimits = { position: 0.05, rotation: 0.35 };
  const supportAt = (t: number) =>
    profile.nativeContacts!.reduce(
      (mask, c) =>
        t >= c.start && t <= c.end ? mask | (c.side === "left" ? 1 : 2) : mask,
      0,
    );
  try {
    if (!(sampler.height > 0)) return { matches, examined };
    const phases = [];
    // A 30 Hz candidate lattice is independent of the take's original frame
    // rate. Detailed pose and velocity measurements still use its real keys.
    for (let tick = 8; tick / 30 < profile.duration - 0.25; tick++) {
      const time = tick / 30,
        support = supportAt(time),
        speed = sampler.speedAt(time);
      if (support && speed > 0.15)
        phases.push({
          time,
          support,
          speed,
          distance: sampler.frameAt(time).distance,
        });
    }
    for (let i = 0; i < phases.length; i++) {
      const a = phases[i],
        pose = sampler.poseAt(a.time);
      for (let j = i + 1; j < phases.length; j++) {
        const b = phases[j],
          duration = b.time - a.time;
        if (duration > 3) break;
        if (
          duration < 0.6 ||
          !(a.support & b.support) ||
          b.distance - a.distance < sampler.height * 0.15 ||
          Math.abs(a.speed - b.speed) > 0.2
        )
          continue;
        const other = sampler.poseAt(b.time);
        // Cheap rejection before measuring derivative poses at both phases.
        if (
          pose.positions.some(
            (p, k) => p.distanceToSquared(other.positions[k]) > 0.08 ** 2,
          )
        )
          continue;
        const metric = compareSourceJoin(
          pose,
          other,
          sampler.velocityAt(a.time),
          sampler.velocityAt(b.time),
          Math.abs(a.speed - b.speed),
          blendLimits,
        );
        const candidate = {
          ...metric,
          sourceStart: (profile.sourceStart ?? 0) + a.time,
          sourceEnd: (profile.sourceStart ?? 0) + b.time,
          distance: b.distance - a.distance,
          support: a.support & b.support,
        };
        examined++;
        candidates.push(candidate);
        if (!best || candidate.score < best.score) best = candidate;
        if (candidate.allowed) matches.push(candidate);
      }
      yield;
    }
    // Refine the best coarse phases against original interpolation. A 30 Hz
    // lattice must not decide whether a subframe footfall is compatible.
    const seeds = candidates.sort((a, b) => a.score - b.score).slice(0, 12);
    const seen = new Set(
      candidates.map((c) => `${c.sourceStart}:${c.sourceEnd}`),
    );
    for (const seed of seeds) {
      for (let da = -3; da <= 3; da++)
        for (let db = -3; db <= 3; db++) {
          const a = seed.sourceStart - (profile.sourceStart ?? 0) + da / 120,
            b = seed.sourceEnd - (profile.sourceStart ?? 0) + db / 120;
          if (
            a <= 0.2 ||
            b >= profile.duration - 0.2 ||
            b - a < 0.6 ||
            b - a > 3
          )
            continue;
          const support = supportAt(a) & supportAt(b),
            distance =
              sampler.frameAt(b).distance - sampler.frameAt(a).distance,
            speedA = sampler.speedAt(a),
            speedB = sampler.speedAt(b),
            key = `${a + (profile.sourceStart ?? 0)}:${b + (profile.sourceStart ?? 0)}`;
          if (
            !support ||
            seen.has(key) ||
            distance < sampler.height * 0.15 ||
            Math.min(speedA, speedB) <= 0.15 ||
            Math.abs(speedA - speedB) > 0.2
          )
            continue;
          seen.add(key);
          const metric = compareSourceJoin(
            sampler.poseAt(a),
            sampler.poseAt(b),
            sampler.velocityAt(a),
            sampler.velocityAt(b),
            Math.abs(speedA - speedB),
            blendLimits,
          );
          const candidate = {
            ...metric,
            sourceStart: a + (profile.sourceStart ?? 0),
            sourceEnd: b + (profile.sourceStart ?? 0),
            distance,
            support,
          };
          examined++;
          if (!best || candidate.score < best.score) best = candidate;
          if (candidate.allowed) matches.push(candidate);
        }
      yield;
    }
    matches.sort(
      (a, b) =>
        a.score - b.score ||
        a.sourceStart - b.sourceStart ||
        a.sourceEnd - b.sourceEnd,
    );
    return { matches, best, examined };
  } finally {
    sampler.restore();
  }
}
export function findCapturedContinuations(
  ...args: Parameters<typeof findCapturedContinuationSteps>
) {
  return finishNavigationWork(findCapturedContinuationSteps(...args));
}
