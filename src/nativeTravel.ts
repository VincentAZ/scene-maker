import * as T from "three";
import type { Entity } from "../shared/scene";
import {
  clipEffectiveEnd,
  clipPlaybackRate,
  clipSourceEnd,
  clipSourceStart,
} from "../shared/clipTiming";
import { locomotionProfile, locomotionScale } from "./locomotion";
import { nativeRootMotion, transferredRootMotion } from "./rig";

/** Measure a scheduled native performance before deciding whether it needs a
 * route. Do not turn virtual in-place gait distance into native root travel.
 * Destination is actor-local, after source-entry facing normalization and
 * receiver proportions, before the placed actor's rotation/scale. */
export function measureNativeTravel(
  source: T.Group,
  target: T.Group,
  take: T.AnimationClip,
  scheduled: Entity["clips"][number],
) {
  const start = clipSourceStart(scheduled, take.duration);
  const end = clipSourceEnd(scheduled, take.duration);
  const rate = clipPlaybackRate(scheduled, take.duration);
  if (!Number.isFinite(start + end + rate) || rate <= 0 || end < start) return;
  const ratio = source === target ? 1 : locomotionScale(source, target);
  if (!(ratio > 0) || !Number.isFinite(ratio)) return;
  if (end === start)
    return {
      sourceStart: start,
      sourceEnd: end,
      playbackRate: rate,
      activeDuration: 0,
      holdDuration: scheduled.duration,
      destination: new T.Vector3(),
      endHeading: 0,
      ratio,
      profile: undefined,
    };
  // The profile saves/restores poses, but nativeRootMotion may measure and
  // restore bind state on a cache miss. Read it after profile measurement has
  // populated that same exact source-range cache.
  const profile = locomotionProfile(source, take, { start, end });
  if (!profile) return;
  const native = nativeRootMotion(source, take, end, start);
  if (!native) return;
  const transferred =
    source === target
      ? undefined
      : transferredRootMotion(source, target, take, end, start);
  if (source !== target && !transferred) return;
  const destination = transferred
    ? new T.Vector3(...transferred.delta)
    : native.delta
        .clone()
        .applyAxisAngle(new T.Vector3(0, 1, 0), -native.startHeading);
  const activeDuration = clipEffectiveEnd(scheduled, take.duration);
  return {
    sourceStart: start,
    sourceEnd: end,
    playbackRate: rate,
    activeDuration,
    holdDuration: Math.max(0, scheduled.duration - activeDuration),
    destination,
    endHeading: native.heading,
    ratio,
    profile,
  };
}
