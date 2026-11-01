import type * as T from "three";
import type { LocomotionProfile } from "./locomotion";
import { compareSourceJoin, sourcePoseSampler } from "./sourceJoins";

/** A small pose mismatch can be blended while retaining captured foot support.
 * This only establishes source compatibility. The receiving pose/velocity gate
 * and the common contact solver still validate and close actual route playback.
 * An untouched one-shot take must never consume this repeating-only profile. */
export function inspectCapturedLoopBlend(
  source: T.Group,
  take: T.AnimationClip,
  profile: LocomotionProfile,
) {
  const sharedSupport = (["left", "right"] as const).some(
    (side) =>
      profile.nativeContacts?.some((c) => c.side === side && c.start <= 1e-6) &&
      profile.nativeContacts?.some(
        (c) => c.side === side && c.end >= profile.duration - 1e-6,
      ),
  );
  if (
    profile.mode !== "travel" ||
    profile.duration < 0.6 ||
    profile.distance < 0.15 ||
    profile.stops?.length ||
    !sharedSupport
  )
    return { allowed: false };
  const sampler = sourcePoseSampler(source, take, profile);
  try {
    if (!(sampler.height > 0)) return { allowed: false };
    return compareSourceJoin(
      sampler.poseAt(0),
      sampler.poseAt(profile.duration),
      sampler.velocityAt(0),
      sampler.velocityAt(profile.duration),
      Math.abs(sampler.speedAt(0) - sampler.speedAt(profile.duration)),
      { position: 0.05, rotation: 0.35 },
    );
  } finally {
    sampler.restore();
  }
}
