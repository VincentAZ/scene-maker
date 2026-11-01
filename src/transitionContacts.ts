import * as T from "three";
import { allMotions, type Entity, type Scene } from "../shared/scene";
import { clipPlaybackRate, clipSourceStart } from "../shared/clipTiming";
import { hasFootSurfaceContacts, sampleFootSurfaces } from "./footSurface";
import { locomotionProfile } from "./locomotion";
import {
  importedClip,
  motionSource,
  nativeRootMotion,
  standingHeight,
} from "./rig";
import {
  correctFootContact,
  footContactPosition,
  footPosition,
} from "./routeContacts";

type Side = "left" | "right";
export type TransitionContact = {
  side: Side;
  offset: T.Vector3;
  end: number;
  releaseEnd: number;
  /** Transferred source sole trajectory in world space. Native rigs retain
   * their original evaluated foot motion plus the join offset. */
  trajectory?: {
    samples: { time: number; point: T.Vector3 }[];
    hold: number;
  };
};

function trajectoryPoint(
  samples: { time: number; point: T.Vector3 }[],
  time: number,
) {
  if (samples.length === 1) return samples[0].point.clone();
  let low = 0,
    high = samples.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (samples[mid].time < time) low = mid;
    else high = mid;
  }
  const a = samples[low],
    b = samples[high];
  // Continue the last measured velocity while releasing. Clamping at the
  // contact endpoint would introduce a velocity discontinuity on foot lift.
  return a.point.clone().lerp(b.point, (time - a.time) / (b.time - a.time));
}

/** Only carry a contact when the outgoing visible sole is planted and the
 * incoming captured take provides stance evidence. Virtual travel contacts
 * from an in-place gait do not establish a stationary standalone foot. */
export function captureTransitionContacts(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  boundary: number,
  before: (time: number) => void,
  raw: (time: number) => void,
): TransitionContact[] {
  if (!hasFootSurfaceContacts(group)) return [];
  let start = 0;
  const scheduled = entity.clips.find((clip) => {
    const found = Math.abs(start - boundary) < 1e-8;
    start += clip.duration;
    return found;
  });
  const motion = allMotions(scene).find((m) => m.id === scheduled?.motionId);
  if (!scheduled || motion?.kind !== "imported" || motion.path) return [];
  const source =
    motion.sourceAssetId === entity.assetId
      ? group
      : motionSource(group, motion.sourceAssetId!);
  const take = importedClip(
    source?.userData.animations ?? [],
    motion.animationName ?? "",
  );
  if (!source || !take) return [];
  const profile = locomotionProfile(source, take);
  // A non-seamless loop warning does not invalidate contact within this take.
  if (!profile) return [];
  const nativeContacts = profile.nativeContacts;
  const sourceStart = clipSourceStart(scheduled, take.duration);
  const rate = clipPlaybackRate(scheduled, take.duration);
  if (!(rate > 0)) return [];
  const contacts = (nativeContacts ?? []).filter(
    (c) => c.start <= sourceStart && c.end > sourceStart + 1e-5,
  );
  if (!contacts.length) return [];
  const sourceHeading =
    source === group
      ? 0
      : nativeRootMotion(source, take, sourceStart, sourceStart)?.startHeading;
  const earlyTime = Math.max(0, boundary - 0.04);
  const lateTime = Math.max(0, boundary - 1e-7);
  const feet = () => contacts.map((c) => footContactPosition(group, c.side));
  before(earlyTime);
  const early = feet();
  before(lateTime);
  if (group.userData.motionWarning) return [];
  const previous = feet();
  const surface = sampleFootSurfaces(group);
  const height = standingHeight(group) * group.getWorldScale(new T.Vector3()).y;
  if (!surface || !(height > 0)) return [];
  const supported = contacts.map((c, i) => {
    const a = early[i],
      b = previous[i];
    const floor = group.localToWorld(new T.Vector3(0, surface[c.side], 0)).y;
    return (
      !!a &&
      !!b &&
      lateTime > earlyTime &&
      a.distanceTo(b) / (lateTime - earlyTime) <= height * 0.1 &&
      Math.abs(floor - entity.position[1]) <= height * 0.05
    );
  });
  raw(boundary);
  if (group.userData.motionWarning) return [];
  const sourceToWorld = group
    .getWorldQuaternion(new T.Quaternion())
    .multiply(
      new T.Quaternion().setFromAxisAngle(
        new T.Vector3(0, 1, 0),
        -(sourceHeading ?? 0),
      ),
    );
  const scale = height / standingHeight(source);
  return contacts.flatMap((c, i) => {
    const incoming = footContactPosition(group, c.side);
    if (!supported[i] || !incoming || !previous[i]) return [];
    const end = boundary + (c.end - sourceStart) / rate;
    const next = nativeContacts?.find(
      (other) => other.side === c.side && other.start > c.end,
    );
    // Release before the next source contact; do not pull an airborne foot
    // back to the old plant. Holding the source end retains its final contact.
    const release = Math.min(
      0.2 / rate,
      next ? (next.start - c.end) / rate : Infinity,
    );
    let trajectory: TransitionContact["trajectory"];
    if (
      source !== group &&
      sourceHeading !== undefined &&
      Number.isFinite(scale) &&
      scale > 0 &&
      c.samples.length >= 2 &&
      c.samples.every((s) => !!s.sole)
    ) {
      const sourceSamples = c.samples.map((s) => ({
        time: s.time,
        point: s.sole!,
      }));
      const origin = trajectoryPoint(sourceSamples, sourceStart);
      trajectory = {
        hold: Math.min(
          boundary + scheduled.duration,
          boundary + (take.duration - sourceStart) / rate,
        ),
        samples: sourceSamples.map((s) => ({
          time: boundary + (s.time - sourceStart) / rate,
          point: s.point
            .clone()
            .sub(origin)
            .multiplyScalar(scale)
            .applyQuaternion(sourceToWorld)
            .add(previous[i]!),
        })),
      };
    }
    return [
      {
        side: c.side,
        offset: previous[i]!.clone().sub(incoming),
        end:
          c.end >= take.duration - 1e-6 ? boundary + scheduled.duration : end,
        releaseEnd: end + release,
        ...(trajectory ? { trajectory } : {}),
      },
    ];
  });
}

export function transitionContactTargets(
  group: T.Group,
  contacts: TransitionContact[],
  time: number,
) {
  return contacts.flatMap((contact) => {
    const u =
      time <= contact.end
        ? 0
        : T.MathUtils.clamp(
            (time - contact.end) /
              Math.max(1e-8, contact.releaseEnd - contact.end),
            0,
            1,
          );
    if (u >= 1) return [];
    const point = footContactPosition(group, contact.side);
    const desired =
      point && contact.trajectory
        ? trajectoryPoint(
            contact.trajectory.samples,
            Math.min(time, contact.trajectory.hold),
          )
        : point?.clone().add(contact.offset);
    return point && desired
      ? [
          {
            side: contact.side,
            point: point.lerp(desired, 1 - u * u * (3 - 2 * u)),
          },
        ]
      : [];
  });
}

export function applyTransitionContacts(
  group: T.Group,
  targets: ReturnType<typeof transitionContactTargets>,
) {
  const maximum =
    standingHeight(group) * group.getWorldScale(new T.Vector3()).y * 0.15;
  for (const { side, point } of targets) {
    const surface = footContactPosition(group, side);
    const endpoint = group.userData.bones[side + "Foot"]
      ? footPosition(group, side)
      : surface;
    if (!surface || !endpoint) continue;
    const desired = endpoint.clone().add(point.clone().sub(surface));
    correctFootContact(group, side, desired, 1, maximum, endpoint);
  }
}
