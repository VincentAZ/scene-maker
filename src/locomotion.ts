import * as T from "three";
import { detectLocomotionStops, type LocomotionStop } from "./locomotionStops";
import { detectCapturedTurns, type CapturedTurn } from "./capturedTurns";
import { gaitTravelTime } from "./routeLocomotion";
import {
  detectFootContacts,
  detectNativeFootContacts,
  footContactPosition,
  type FootContact,
} from "./routeContacts";
import { scheduleRouteContacts } from "./routeContactSchedule";
import { alignLoopHeading } from "./routeLoopAlignment";
import { hasFootSurfaceContacts, sampleFootSurfaces } from "./footSurface";
import {
  groundSupportEnvelope,
  sampleLoopGroundSupport,
} from "./routeGroundSupport";
import { reconstructFlightTravel } from "./inPlaceFlight";
import { detectInPlaceContacts } from "./inPlaceContacts";
import { flightFootContacts } from "./flightFootContacts";
import { routeLoopBlendStart } from "./routeLoopPose";
import { inspectCapturedLoopBlend } from "./capturedLoop";
import {
  applyHumanoidPose,
  nativeRootMotion,
  sampleNativeClip,
  standingHeight,
} from "./rig";

type Frame = {
  time: number;
  distance: number;
  center: T.Vector3;
  heading: number;
  groundLift?: number;
  loopGroundLift?: number;
};
export type LocomotionProfile = {
  frames: Frame[];
  /** Authored track keys relative to the selected source interval. */
  keyTimes?: number[];
  distance: number;
  duration: number;
  startHeading: number;
  /** Original take offset; profile frames and contacts use interval-local time. */
  sourceStart?: number;
  warning: string;
  mode: "travel" | "in-place";
  contacts?: FootContact[];
  /** Original stationary-world contacts, before any virtual walking travel. */
  nativeContacts?: FootContact[];
  stops?: LocomotionStop[];
  turns?: CapturedTurn[];
  contactLoopSides?: FootContact["side"][];
  loopProfile?: LocomotionProfile;
  loopAlignment?: { start: number; correction: number };
  /** Shared travel speed at a matched captured seam, in source units/second. */
  loopSpeed?: number;
};

/** Travel-frame angle that preserves the captured body's entry facing after
 * the source-start normalization used by standalone imported playback. */
export function routeEntryHeading(profile: LocomotionProfile) {
  const angle =
    (profile.frames[0]?.heading ?? profile.startHeading) - profile.startHeading;
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}
const profiles = new WeakMap<
  T.Group,
  Map<T.AnimationClip, Map<string, LocomotionProfile>>
>();
const up = new T.Vector3(0, 1, 0);
const yaw = (q: T.Quaternion) => {
  const f = new T.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
};

/** One-time, deterministic measurement. Save/restore every local transform so
 * inspecting natural pace cannot change an actor's current viewport pose. */
export function locomotionProfile(
  source: T.Group,
  clip: T.AnimationClip,
  interval?: { start: number; end: number },
): LocomotionProfile | undefined {
  const sourceStart = interval?.start ?? 0;
  const sourceEnd = interval?.end ?? clip.duration;
  if (
    !Number.isFinite(sourceStart + sourceEnd) ||
    sourceStart < 0 ||
    sourceEnd > clip.duration ||
    sourceEnd <= sourceStart
  )
    return;
  const duration = sourceEnd - sourceStart;
  const bones = source.userData.bones as Record<string, T.Bone> | undefined;
  const contacts = source.userData.contacts as
    Record<string, T.Vector3> | undefined;
  if (!bones?.hips || clip.duration <= 0) return;
  const foot = (side: "left" | "right") => {
    const bone = bones[`${side}Foot`];
    if (bone)
      return source.worldToLocal(bone.getWorldPosition(new T.Vector3()));
    const shin = bones[`${side}Shin`],
      offset = contacts?.[`${side}Foot`];
    return shin && offset
      ? source.worldToLocal(shin.localToWorld(offset.clone()))
      : undefined;
  };
  if (!foot("left") || !foot("right")) return;
  let cache = profiles.get(source);
  if (!cache) profiles.set(source, (cache = new Map()));
  let windows = cache.get(clip);
  if (!windows) cache.set(clip, (windows = new Map()));
  const key = `${sourceStart}:${sourceEnd}`;
  const known = windows.get(key);
  if (known) return known;
  // A short piece of travelling footage must not become a virtual in-place
  // stride merely because its displacement is below the full-take threshold.
  const firstKey = Math.max(
    0,
    Math.min(
      ...clip.tracks
        .filter((track) => track.times.length > 1)
        .map((track) => track.times[0]),
      clip.duration,
    ),
  );
  // Leading empty timestamp padding is not captured motion context. A window
  // covering the authored keys must remain identical when a file shifts every
  // key by an offset; narrower selections use that authored interval as context.
  const referenceStart = sourceStart >= firstKey ? firstKey : 0;
  const fullProfile =
    interval && (sourceStart > referenceStart || sourceEnd < clip.duration)
      ? locomotionProfile(
          source,
          clip,
          referenceStart > 0
            ? { start: referenceStart, end: clip.duration }
            : undefined,
        )
      : undefined;
  const fullMode = fullProfile?.mode;
  const saved: {
    node: T.Object3D;
    p: T.Vector3;
    q: T.Quaternion;
    s: T.Vector3;
    weights?: number[];
  }[] = [];
  source.traverse((node) =>
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
      weights:
        node instanceof T.Mesh
          ? node.morphTargetInfluences?.slice()
          : undefined,
    }),
  );
  const mixer = source.userData.mixer as T.AnimationMixer;
  const local = (node: T.Object3D) =>
    source.worldToLocal(node.getWorldPosition(new T.Vector3()));
  try {
    mixer.stopAllAction();
    applyHumanoidPose(source, {}, true);
    const inverse = source.getWorldQuaternion(new T.Quaternion()).invert();
    const facing = inverse
      .clone()
      .multiply(bones.hips.getWorldQuaternion(new T.Quaternion()))
      .invert();
    const root = nativeRootMotion(source, clip, sourceEnd, sourceStart)!;
    const count = Math.max(2, Math.ceil(duration * 60));
    const hasSoles = hasFootSurfaceContacts(source);
    const raw: {
      time: number;
      hip: T.Vector3;
      feet: T.Vector3[];
      contactFeet: T.Vector3[];
      penetration: number;
      soleHeights?: [number, number];
      heading: number;
    }[] = [];
    let heading = 0;
    for (let i = 0; i <= count; i++) {
      mixer.stopAllAction();
      applyHumanoidPose(source, {}, true);
      sampleNativeClip(source, clip, sourceStart + (i * duration) / count);
      source.updateWorldMatrix(true, true);
      const angle = yaw(
        inverse
          .clone()
          .multiply(bones.hips.getWorldQuaternion(new T.Quaternion()))
          .multiply(facing),
      );
      heading = i
        ? heading +
          Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))
        : angle;
      const surface = sampleFootSurfaces(source);
      raw.push({
        time: (i * duration) / count,
        hip: local(bones.hips),
        feet: [foot("left")!, foot("right")!],
        contactFeet: ["left", "right"].map((side) =>
          source.worldToLocal(
            footContactPosition(source, side as "left" | "right")!,
          ),
        ),
        heading,
        soleHeights: surface
          ? [
              surface.left - surface.bindFloor,
              surface.right - surface.bindFloor,
            ]
          : undefined,
        penetration: surface
          ? Math.max(0, surface.bindFloor - surface.lowest)
          : 0,
      });
    }
    // Smooth only the trajectory, never joint rotations. Residual hip sway/bob
    // remains in the original sampled pose. A half-second window suppresses sway.
    const radius = Math.max(1, Math.round((count / duration) * 0.25));
    const frames: Frame[] = raw.map((frame, index) => {
      const center = new T.Vector3();
      let angle = 0,
        weight = 0;
      // Linear endpoint extrapolation avoids easing the beginning/end to zero speed.
      for (let j = index - radius; j <= index + radius; j++) {
        const k = Math.max(0, Math.min(count, j)),
          sample = raw[k];
        const p = sample.hip.clone();
        let h = sample.heading;
        if (j !== k) {
          const next =
            k === 0 ? Math.min(radius, count) : Math.max(0, count - radius);
          const f = (j - k) / (next - k);
          p.addScaledVector(raw[next].hip.clone().sub(sample.hip), f);
          h += (raw[next].heading - sample.heading) * f;
        }
        center.add(p);
        angle += h;
        weight++;
      }
      return {
        time: frame.time,
        center: center.divideScalar(weight),
        heading: angle / weight,
        distance: 0,
      };
    });
    const supportRadius = Math.ceil((count / duration) * 0.04);
    const ground = groundSupportEnvelope(
      raw.map((frame) => frame.penetration),
      supportRadius,
    );
    const loopGround = groundSupportEnvelope(
      raw.map((frame) => frame.penetration),
      supportRadius,
      true,
    );
    frames.forEach((frame, index) => {
      frame.groundLift = ground[index];
      frame.loopGroundLift = loopGround[index];
    });
    const span = new T.Box3()
      .setFromPoints(
        frames.map((f) => new T.Vector3(f.center.x, 0, f.center.z)),
      )
      .getSize(new T.Vector3())
      .length();
    const mode = fullMode ?? (span > 0.35 ? "travel" : "in-place");
    if (mode === "travel") {
      // Align the trajectory rather than the pelvis. A sideways/backward step
      // must retain the body's angle to travel, and a stationary pivot must not
      // be cancelled just because the hips rotate. Ignore small sway velocities.
      const speedFloor = standingHeight(source) * 0.18;
      const directionRadius = Math.max(
        radius,
        Math.round((count / duration) * 0.75),
      );
      const directions = frames.map((frame, index) => {
        const a = frames[Math.max(0, index - directionRadius)];
        const b = frames[Math.min(count, index + directionRadius)];
        const delta = b.center.clone().sub(a.center);
        const speed = Math.hypot(delta.x, delta.z) / (b.time - a.time);
        return speed >= speedFloor ? Math.atan2(delta.x, delta.z) : undefined;
      });
      let direction =
        directions.find((value) => value !== undefined) ?? frames[0].heading;
      for (let i = 0; i < frames.length; i++) {
        const desired = directions[i];
        if (desired !== undefined) {
          const change = Math.atan2(
            Math.sin(desired - direction),
            Math.cos(desired - direction),
          );
          const limit = i
            ? 1.5 * (frames[i].time - frames[i - 1].time)
            : Math.PI;
          direction += T.MathUtils.clamp(change, -limit, limit);
        }
        frames[i].heading = direction;
      }
    }
    if (fullProfile?.mode === "travel") {
      // Selecting a source interval must not reinterpret its direction using
      // truncated smoothing/lookaround windows. Keep the full captured travel
      // frame, including context before/after the selection; only reset its
      // time and accumulated distance. Joint poses remain original samples.
      let low = 0;
      const sourceFrames = fullProfile.frames;
      for (const frame of frames) {
        const time = sourceStart + frame.time - (fullProfile.sourceStart ?? 0);
        while (
          low + 1 < sourceFrames.length - 1 &&
          sourceFrames[low + 1].time < time
        )
          low++;
        const a = sourceFrames[low],
          b = sourceFrames[low + 1];
        const u = T.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1);
        frame.center.copy(a.center).lerp(b.center, u);
        frame.heading = T.MathUtils.lerp(a.heading, b.heading, u);
        frame.distance = T.MathUtils.lerp(a.distance, b.distance, u);
      }
      const origin = frames[0].distance;
      frames.forEach((frame) => {
        frame.distance -= origin;
      });
    }
    let distance = 0;
    for (let i = 1; i < frames.length; i++) {
      if (fullProfile?.mode === "travel") {
        distance = frames[i].distance;
      } else if (mode === "travel") {
        const delta = frames[i].center.clone().sub(frames[i - 1].center);
        delta.y = 0;
        distance += delta.length();
      } else {
        const forward = new T.Vector3(0, 0, 1).applyAxisAngle(
          up,
          frames[i].heading,
        );
        // Use the lowest foot (stance), not the faster swinging foot. Its
        // backward travel relative to the hips estimates a planted stride.
        const foot = raw[i].feet[0].y <= raw[i].feet[1].y ? 0 : 1;
        const change = raw[i].feet[foot]
          .clone()
          .sub(raw[i].hip)
          .sub(raw[i - 1].feet[foot].clone().sub(raw[i - 1].hip));
        distance += Math.max(0, -change.dot(forward));
      }
      frames[i].distance = distance;
    }
    const first = raw[0],
      last = raw.at(-1)!;
    const footSeams = [0, 1].map((i) =>
      first.feet[i]
        .clone()
        .sub(first.hip)
        // Check the pose after trajectory alignment, as it will actually be
        // played on a route. Matching pelvis-relative endpoints alone can
        // hide a large turn introduced by the source trajectory at the seam.
        .applyAxisAngle(up, -frames[0].heading)
        .distanceTo(
          last.feet[i]
            .clone()
            .sub(last.hip)
            .applyAxisAngle(up, -frames.at(-1)!.heading),
        ),
    );
    const seam = Math.max(...footSeams);
    const legHeight = standingHeight(source);
    const floors = [0, 1].map((side) =>
      Math.min(...raw.map((frame) => frame.feet[side].y)),
    );
    const supportFrames =
      mode === "in-place"
        ? frames.map((frame, index) => {
            const previous = Math.max(0, index - 1);
            const next = Math.max(1, index);
            const dt = frames[next].time - frames[previous].time;
            const forward = new T.Vector3(0, 0, 1).applyAxisAngle(
              up,
              frame.heading,
            );
            return {
              time: frame.time,
              distance: frame.distance,
              heights:
                raw[index].soleHeights ??
                (raw[index].feet.map((foot, side) => foot.y - floors[side]) as [
                  number,
                  number,
                ]),
              speeds: [0, 1].map((side) =>
                dt > 0
                  ? Math.max(
                      0,
                      frames[next].center
                        .clone()
                        .sub(frames[previous].center)
                        .sub(
                          raw[next].feet[side]
                            .clone()
                            .sub(raw[previous].feet[side]),
                        )
                        .dot(forward) / dt,
                    )
                  : 0,
              ) as [number, number],
            };
          })
        : undefined;
    const flight = supportFrames
      ? reconstructFlightTravel(
          supportFrames,
          legHeight,
          seam <= legHeight * 0.035,
        )
      : undefined;
    if (flight) {
      frames.forEach((frame, index) => {
        frame.distance = flight.distances[index];
      });
      distance = frames.at(-1)!.distance;
    }
    const warning =
      distance < 0.15 || distance / duration < 0.05
        ? "This take has no reliable locomotion stride. Choose a walking/running cycle; no procedural gait has been substituted."
        : seam > legHeight * 0.035
          ? "This take's foot poses do not match at its loop boundary after route alignment. Repeating it may pop; use a seamless locomotion cycle for long routes."
          : "";
    const virtualTravel = new T.Vector3();
    const contactFrames = raw.map((frame, index) => {
      if (mode === "in-place" && index)
        virtualTravel.add(
          new T.Vector3(
            0,
            0,
            frames[index].distance - frames[index - 1].distance,
          ).applyAxisAngle(
            up,
            (frames[index].heading + frames[index - 1].heading) / 2,
          ),
        );
      return {
        time: frame.time,
        heights: frame.soleHeights,
        feet: frame.feet.map((foot) => foot.clone().add(virtualTravel)),
        contactFeet: frame.contactFeet.map((foot) =>
          foot.clone().add(virtualTravel),
        ),
      };
    });
    const measureContacts = (
      samples: ((typeof contactFrames)[number] & {
        heights?: [number, number];
      })[],
      native = false,
    ) =>
      (native
        ? detectNativeFootContacts(samples, legHeight)
        : detectFootContacts(samples, legHeight)
      ).map((contact) => ({
        ...contact,
        samples: samples
          .filter(
            (frame) => frame.time >= contact.start && frame.time <= contact.end,
          )
          .map((frame) => ({
            time: frame.time,
            point: frame.feet[contact.side === "left" ? 0 : 1],
            ...(hasSoles
              ? { sole: frame.contactFeet[contact.side === "left" ? 0 : 1] }
              : {}),
          })),
      }));
    const measuredContacts = measureContacts(contactFrames);
    const result = {
      frames,
      keyTimes: [
        ...new Set(
          clip.tracks.flatMap((track) =>
            Array.from(track.times)
              .filter((time) => time >= sourceStart && time <= sourceEnd)
              .map((time) => time - sourceStart),
          ),
        ),
      ].sort((a, b) => a - b),
      distance,
      duration,
      ...(sourceStart ? { sourceStart } : {}),
      startHeading: root.startHeading,
      warning,
      mode,
      nativeContacts: measureContacts(
        raw.map((frame) => ({
          time: frame.time,
          feet: frame.feet,
          contactFeet: frame.contactFeet,
          heights: frame.soleHeights,
        })),
        true,
      ),
      // Use original poses, not smoothed route centers or virtual gait travel.
      turns: detectCapturedTurns(
        raw.map((frame) => ({
          time: frame.time,
          heading: frame.heading,
          center: frame.hip,
          feet: frame.contactFeet,
          heights: frame.soleHeights,
        })),
        legHeight,
      ),
      stops: detectLocomotionStops(
        contactFrames.map((frame, i) => ({
          time: frame.time,
          distance: frames[i].distance,
          heading: frames[i].heading,
          feet: frame.contactFeet,
          heights: raw[i].soleHeights,
        })),
        legHeight,
      ),
      contacts: measuredContacts.map((contact) => ({
        ...contact,
        ...(mode === "in-place"
          ? {
              approachDuration: Math.min(
                0.2,
                (contact.end - contact.start) * 0.5,
              ),
            }
          : {}),
      })),
      contactLoopSides: (["left", "right"] as const).filter(
        (_, i) => footSeams[i] <= standingHeight(source) * 0.035,
      ),
    } as LocomotionProfile;
    if (flight)
      result.contacts = flightFootContacts(
        result.contacts!,
        flight.supports,
        contactFrames,
        frames,
        legHeight,
        hasSoles,
      );
    else if (supportFrames)
      result.contacts = detectInPlaceContacts(
        contactFrames.map((frame, i) => ({
          ...frame,
          // Relative ankle minima are not evidence of actual ground support.
          heights: raw[i].soleHeights,
          backwardSpeeds: supportFrames[i].speeds,
          contactFeet: hasSoles ? frame.contactFeet : undefined,
        })),
        legHeight,
        result.contacts!,
      );
    const alignment =
      mode === "travel" && distance >= 0.15 && distance / duration >= 0.05
        ? alignLoopHeading(raw, frames)
        : undefined;
    if (alignment) {
      const alignedSeams = [0, 1].map((i) =>
        first.feet[i]
          .clone()
          .sub(first.hip)
          .applyAxisAngle(up, -alignment.headings[0])
          .distanceTo(
            last.feet[i]
              .clone()
              .sub(last.hip)
              .applyAxisAngle(up, -alignment.headings.at(-1)!),
          ),
      );
      // A root-frame correction cannot repair unrelated source pose differences.
      if (
        Math.max(...alignedSeams) <= standingHeight(source) * 0.035 &&
        Math.max(...alignedSeams) < seam
      ) {
        result.loopProfile = {
          ...result,
          frames: frames.map((frame, i) => ({
            ...frame,
            heading: alignment.headings[i],
          })),
          contactLoopSides: ["left", "right"],
          warning: "",
          loopAlignment: {
            start: alignment.start,
            correction: alignment.correction,
          },
        };
      }
    }
    // Interior captured windows can have a small, blendable foot mismatch
    // without an authored terminal turn. Require the complete visible source
    // pose/velocity match and common grounded support before enabling closure.
    // Keep the unmodified profile for one-shot playback and source inspection.
    if (
      !result.loopProfile &&
      interval &&
      (sourceStart > 0 || sourceEnd < clip.duration) &&
      result.contactLoopSides?.length !== 2 &&
      inspectCapturedLoopBlend(source, clip, result).allowed
    ) {
      const speedA =
          (frames[1].distance - frames[0].distance) /
          (frames[1].time - frames[0].time),
        speedB =
          (frames.at(-1)!.distance - frames.at(-2)!.distance) /
          (frames.at(-1)!.time - frames.at(-2)!.time);
      result.loopProfile = {
        ...result,
        contactLoopSides: ["left", "right"],
        warning: "",
        loopSpeed: speedA > 0 && speedB > 0 ? 2 / (1 / speedA + 1 / speedB) : 0,
      };
    }
    windows.set(key, result);
    // Trim controls can inspect many distinct intervals. Keep the full take
    // plus a bounded set of recent windows, not every slider position forever.
    if (windows.size > 17) {
      const fullKey = `0:${clip.duration}`;
      const oldest = [...windows.keys()].find((entry) => entry !== fullKey);
      if (oldest) windows.delete(oldest);
    }
    return result;
  } finally {
    mixer.stopAllAction();
    for (const { node, p, q, s, weights } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
      if (weights && node instanceof T.Mesh)
        node.morphTargetInfluences!.splice(0, weights.length, ...weights);
    }
    source.updateWorldMatrix(true, true);
  }
}
export function sampleLocomotion(
  profile: LocomotionProfile,
  travelled: number,
) {
  const cycle = profile.distance;
  const distance = cycle > 0 ? ((travelled % cycle) + cycle) % cycle : 0;
  const frames = profile.frames;
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].distance < distance) low = mid;
    else high = mid;
  }
  const a = frames[low],
    b = frames[high];
  const f =
    b.distance > a.distance
      ? (distance - a.distance) / (b.distance - a.distance)
      : 0;
  return {
    time: T.MathUtils.lerp(a.time, b.time, f),
    sourceTime:
      (profile.sourceStart ?? 0) + T.MathUtils.lerp(a.time, b.time, f),
    center: a.center.clone().lerp(b.center, f),
    heading: T.MathUtils.lerp(a.heading, b.heading, f),
    repeated: travelled >= cycle,
  };
}
export function locomotionScale(source: T.Group, target: T.Group) {
  return standingHeight(target) / standingHeight(source);
}
/** Preserve a one-shot take's route alignment. Repeated routes may use a
 * verified terminal-turn closure; source timing and distance stay identical. */
export function routeLocomotionProfile(
  profile: LocomotionProfile,
  distance: number,
) {
  return distance > profile.distance + 1e-6 && profile.loopProfile
    ? profile.loopProfile
    : profile;
}

/** Source time needed to cover a route, including complete gait cycles. */
export function routeSourceDuration(
  profile: LocomotionProfile,
  distance: number,
) {
  if (!(distance > 0 && profile.distance > 0)) return 0;
  return gaitTravelTime({ ...profile, samples: profile.frames }, distance);
}

/** Keep native cadence within each take: source pauses must pause route travel,
 * rather than skipping a stationary performance to maintain constant speed. */
export function sampleRouteLocomotion(
  profile: LocomotionProfile,
  distance: number,
  progress: number,
) {
  profile = routeLocomotionProfile(profile, distance);
  const sourceDuration = routeSourceDuration(profile, distance);
  const elapsed = Math.max(0, Math.min(1, progress)) * sourceDuration;
  const cycles = Math.floor(elapsed / profile.duration);
  const time = elapsed - cycles * profile.duration;
  const frames = profile.frames;
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].time < time) low = mid;
    else high = mid;
  }
  const a = frames[low],
    b = frames[high];
  const f = b.time > a.time ? (time - a.time) / (b.time - a.time) : 0;
  let travelled =
    cycles * profile.distance + T.MathUtils.lerp(a.distance, b.distance, f);
  let loopSpeed = profile.loopSpeed;
  if (loopSpeed === undefined && profile.contactLoopSides?.length === 2) {
    const first = frames[0],
      next = frames[1],
      last = frames.at(-1)!,
      previous = frames.at(-2)!;
    const incoming =
        (last.distance - previous.distance) / (last.time - previous.time),
      outgoing = (next.distance - first.distance) / (next.time - first.time);
    loopSpeed =
      incoming > 0 && outgoing > 0 ? 2 / (1 / incoming + 1 / outgoing) : 0;
  }
  if (loopSpeed !== undefined && distance > profile.distance + 1e-6) {
    // Match speed only in the source intervals touching an actual wrap. Each
    // correction has zero displacement at its ends: source duration, total
    // route distance and explicit cadence remain unchanged, including a route
    // ending inside the first interval of a final partial cycle.
    const first = frames[0],
      next = frames[1],
      last = frames.at(-1)!,
      previous = frames.at(-2)!;
    const remaining = sourceDuration - cycles * profile.duration;
    const entryDuration = Math.min(next.time - first.time, remaining);
    if (cycles > 0 && time < entryDuration && entryDuration > 0) {
      const u = time / entryDuration;
      const speed = (next.distance - first.distance) / (next.time - first.time);
      travelled +=
        (u * u * u - 2 * u * u + u) * entryDuration * (loopSpeed - speed);
    }
    if (remaining > profile.duration + 1e-6 && time > previous.time) {
      const dt = last.time - previous.time,
        u = (time - previous.time) / dt;
      const speed = (last.distance - previous.distance) / dt;
      travelled += (u * u * u - u * u) * dt * (loopSpeed - speed);
    }
  }
  return {
    time,
    sourceTime: (profile.sourceStart ?? 0) + time,
    travelled,
    center: a.center.clone().lerp(b.center, f),
    heading: T.MathUtils.lerp(a.heading, b.heading, f),
    groundLift:
      distance > profile.distance + 1e-6
        ? sampleLoopGroundSupport(frames, low, f)
        : T.MathUtils.lerp(a.groundLift ?? 0, b.groundLift ?? 0, f),
    repeated: cycles > 0,
  };
}

/** Preserve source keys and gait samples for the source interval consumed by
 * a route, including repeated cycles and a final partial take. */
export function routeSourceBoundaries(
  profile: LocomotionProfile,
  sourceTimes: Iterable<number>,
  distance: number,
  duration: number,
): number[] {
  if (!(distance > 0 && duration > 0 && profile.distance > 0)) return [];
  profile = routeLocomotionProfile(profile, distance);
  const sourceDuration = routeSourceDuration(profile, distance);
  const phases = new Set([
    ...profile.frames.map((frame) => frame.time),
    ...(sourceDuration > profile.duration + 1e-6 &&
    profile.contactLoopSides?.length === 2
      ? [routeLoopBlendStart(profile.duration)]
      : []),
    ...[...sourceTimes].map((time) => time - (profile.sourceStart ?? 0)),
    ...scheduleRouteContacts(
      profile.contacts || [],
      profile.duration,
      profile.contactLoopSides,
    ).flatMap(({ contact, approachStart, releaseEnd, continuous }) =>
      [
        approachStart,
        contact.start,
        contact.end,
        ...(continuous ? [] : [releaseEnd]),
      ].map((time) => {
        const phase = time % profile.duration;
        return phase < 0 ? phase + profile.duration : phase;
      }),
    ),
  ]);
  const boundaries = new Set<number>();
  for (let cycle = 0; cycle * profile.distance < distance; cycle++) {
    if (cycle > 0 && profile.contactLoopSides?.length === 2) {
      const sourceTime =
        cycle * profile.duration +
        Math.min(
          profile.duration - routeLoopBlendStart(profile.duration),
          sourceDuration - cycle * profile.duration,
        );
      if (sourceTime > 0 && sourceTime < sourceDuration)
        boundaries.add((duration * sourceTime) / sourceDuration);
    }
    for (const phase of phases) {
      if (phase < 0 || phase > profile.duration) continue;
      const sourceTime = cycle * profile.duration + phase;
      if (sourceTime > 0 && sourceTime < sourceDuration)
        boundaries.add((duration * sourceTime) / sourceDuration);
    }
  }
  return [...boundaries].sort((a, b) => a - b);
}
