import * as T from "three";
import type { LocomotionProfile } from "./locomotion";
import { sourcePoseSampler, compareSourceJoin } from "./sourceJoins";

/** Whole-take repetition requires a compatible visible performance and source
 * velocity. Interior continuation search uses the same detailed-channel metric.
 * Names do not establish gait quality, and compatible root-only motion is not
 * proof of a natural walking performance. */
export function inspectNativeLoop(
  source: T.Group,
  take: T.AnimationClip,
  profile: LocomotionProfile,
) {
  if (
    profile.mode !== "travel" ||
    profile.distance < 0.15 ||
    profile.duration <= 0 ||
    profile.stops?.length ||
    profile.warning ||
    profile.contactLoopSides?.length !== 2
  )
    return {
      allowed: false,
      reason:
        "This performance needs a matched continuation instead of repeating the whole take.",
    };
  const sampler = sourcePoseSampler(source, take, profile);
  try {
    if (!(sampler.height > 0))
      return {
        allowed: false,
        reason: "The source proportions are unavailable.",
      };
    const metric = compareSourceJoin(
      sampler.poseAt(0),
      sampler.poseAt(profile.duration),
      sampler.velocityAt(0),
      sampler.velocityAt(profile.duration),
      Math.abs(sampler.speedAt(0) - sampler.speedAt(profile.duration)),
    );
    return {
      ...metric,
      reason: metric.allowed
        ? ""
        : "The source's body, extremity or facial motion does not join continuously enough to repeat.",
    };
  } finally {
    sampler.restore();
  }
}
