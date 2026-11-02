import * as T from "three";
import { solveLimb } from "./ik";
import { footSurfaceContact, sampleFootSurfaces } from "./footSurface";

export type FootSample = {
  time: number;
  feet: T.Vector3[];
  contactFeet?: T.Vector3[];
  heights?: [number, number];
};

/** Optical captures contain small stance jitter and ankle roll. Use a short
 * bounded region as additional evidence, never smoothing the output samples.
 * Actual sole heights are required: a low point in a jump is not a floor. */
function boundedGroundSupport(
  frames: FootSample[],
  index: number,
  side: number,
  legHeight: number,
) {
  const time = frames[index].time;
  let first = index,
    last = index;
  while (first > 0 && time - frames[first - 1].time <= 0.075) first--;
  while (last + 1 < frames.length && frames[last + 1].time - time <= 0.075)
    last++;
  if (frames[last].time - frames[first].time < 0.1 - 1e-9) return false;
  const point = (frame: FootSample) =>
    frame.contactFeet?.[side] ?? frame.feet[side];
  const origin = point(frames[index]);
  const start = point(frames[first]),
    end = point(frames[last]);
  if (Math.hypot(end.x - start.x, end.z - start.z) > legHeight * 0.01)
    return false;
  for (let i = first; i <= last; i++) {
    const height = frames[i].heights?.[side],
      p = point(frames[i]);
    if (
      !Number.isFinite(p.x + p.z + origin.x + origin.z) ||
      height === undefined ||
      !Number.isFinite(height) ||
      height < -legHeight * 0.08 ||
      height > legHeight * 0.035 ||
      Math.hypot(p.x - origin.x, p.z - origin.z) > legHeight * 0.012
    )
      return false;
  }
  return true;
}
export type FootContact = {
  side: "left" | "right";
  start: number;
  end: number;
  // Source-space bound inferred from reconstructed running stance drift.
  maxCorrection?: number;
  // Fast running supports release with their source stance duration.
  releaseDuration?: number;
  // Prepare a running contact during the preceding swing.
  approachDuration?: number;
  // Keep the ankle track when either side has no usable sole geometry.
  samples: {
    time: number;
    point: T.Vector3;
    sole?: T.Vector3;
    velocity?: T.Vector3;
  }[];
};
/** Conservative ankle-based stance evidence. Preserve the source's small ankle
 * displacement during contact, rather than freezing its authored foot roll. */
export function detectFootContacts(
  frames: FootSample[],
  legHeight: number,
): FootContact[] {
  if (frames.length < 3 || !(legHeight > 0)) return [];
  const result: FootContact[] = [];
  for (const [foot, side] of (["left", "right"] as const).entries()) {
    const floor = frames.reduce(
      (lowest, frame) => Math.min(lowest, frame.feet[foot].y),
      Infinity,
    );
    let first = -1;
    const finish = (last: number) => {
      const previous = result.at(-1);
      if (
        first >= 0 &&
        previous?.side === side &&
        frames[first].time - previous.end <= 0.15 &&
        frames[first].feet[foot].distanceTo(previous.samples.at(-1)!.point) <=
          legHeight * 0.035
      ) {
        const begin = frames.findIndex(
          (frame) => frame.time === previous.start,
        );
        previous.end = frames[last].time;
        previous.samples = frames.slice(begin, last + 1).map((frame) => ({
          time: frame.time,
          point: frame.feet[foot].clone(),
        }));
      } else if (first >= 0 && frames[last].time - frames[first].time >= 0.12)
        result.push({
          side,
          start: frames[first].time,
          end: frames[last].time,
          samples: frames.slice(first, last + 1).map((frame) => ({
            time: frame.time,
            point: frame.feet[foot].clone(),
          })),
        });
      first = -1;
    };
    for (let i = 0; i < frames.length; i++) {
      const a = frames[Math.max(0, i - 1)],
        b = frames[Math.min(frames.length - 1, i + 1)];
      const delta = b.feet[foot].clone().sub(a.feet[foot]);
      const speed = Math.hypot(delta.x, delta.z) / (b.time - a.time);
      const contact =
        (speed <= legHeight * (first < 0 ? 0.035 : 0.055) &&
          frames[i].feet[foot].y <= floor + legHeight * 0.035) ||
        boundedGroundSupport(frames, i, foot, legHeight);
      if (contact) {
        if (first < 0) first = i;
      } else if (first >= 0) finish(i - 1);
    }
    if (first >= 0) finish(frames.length - 1);
  }
  return result;
}

/** Native-world stance needs actual ground evidence. A stationary ankle in an
 * airborne take is not grounded merely because it is that take's lowest point. */
export function detectNativeFootContacts(
  frames: (FootSample & { heights?: [number, number] })[],
  legHeight: number,
): FootContact[] {
  const byTime = new Map(frames.map((frame) => [frame.time, frame]));
  return detectFootContacts(frames, legHeight).flatMap((contact) => {
    const result: FootContact[] = [];
    const side = contact.side === "left" ? 0 : 1;
    let first = -1;
    for (let i = 0; i <= contact.samples.length; i++) {
      const sample = contact.samples[i];
      const height = sample && byTime.get(sample.time)?.heights?.[side];
      const grounded =
        height !== undefined &&
        Number.isFinite(height) &&
        height >= -legHeight * 0.08 &&
        height <= legHeight * 0.035;
      if (grounded) {
        if (first < 0) first = i;
      } else if (first >= 0) {
        const samples = contact.samples.slice(first, i);
        if (samples.at(-1)!.time - samples[0].time >= 0.12)
          result.push({
            ...contact,
            start: samples[0].time,
            end: samples.at(-1)!.time,
            samples,
          });
        first = -1;
      }
    }
    return result;
  });
}
/** Trim existing support evidence instead of redetecting stance at a cut.
 * A source interval may start/end inside a planted foot's support window. */
export function trimFootContacts(
  contacts: FootContact[],
  start: number,
  end: number,
): FootContact[] {
  return contacts.flatMap((contact) => {
    const a = Math.max(start, contact.start),
      b = Math.min(end, contact.end);
    if (b <= a || !contact.samples.length) return [];
    const boundary = (time: number) => {
      let next = contact.samples.findIndex((sample) => sample.time >= time);
      if (next < 0) next = contact.samples.length - 1;
      const hi = contact.samples[next],
        lo = contact.samples[Math.max(0, next - 1)];
      const mix =
        hi.time > lo.time ? (time - lo.time) / (hi.time - lo.time) : 0;
      return {
        time: time - start,
        point: lo.point.clone().lerp(hi.point, mix),
        ...(lo.sole && hi.sole
          ? { sole: lo.sole.clone().lerp(hi.sole, mix) }
          : {}),
      };
    };
    return [
      {
        ...contact,
        start: a - start,
        end: b - start,
        samples: [
          boundary(a),
          ...contact.samples
            .filter((sample) => sample.time > a && sample.time < b)
            .map((sample) => ({
              ...sample,
              time: sample.time - start,
              point: sample.point.clone(),
              ...(sample.sole ? { sole: sample.sole.clone() } : {}),
            })),
          boundary(b),
        ],
      },
    ];
  });
}

export function contactPoint(contact: FootContact, time: number) {
  const frames = contact.samples;
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].time < time) low = mid;
    else high = mid;
  }
  const a = frames[low],
    b = frames[high];
  const weight =
    b.time > a.time
      ? T.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1)
      : 0;
  if (a.velocity && b.velocity && b.time > a.time) {
    const u2 = weight * weight,
      u3 = u2 * weight,
      dt = b.time - a.time;
    return a.point
      .clone()
      .multiplyScalar(2 * u3 - 3 * u2 + 1)
      .addScaledVector(a.velocity, (u3 - 2 * u2 + weight) * dt)
      .addScaledVector(b.point, -2 * u3 + 3 * u2)
      .addScaledVector(b.velocity, (u3 - u2) * dt);
  }
  return a.point.clone().lerp(b.point, weight);
}
const point = (node: T.Object3D) => node.getWorldPosition(new T.Vector3());
export function footPosition(group: T.Group, side: "left" | "right") {
  const bones = group.userData.bones as Record<string, T.Bone>;
  const foot = bones[side + "Foot"],
    shin = bones[side + "Shin"];
  const offset = group.userData.contacts?.[side + "Foot"] as
    T.Vector3 | undefined;
  return foot
    ? point(foot)
    : shin && offset
      ? shin.localToWorld(offset.clone())
      : undefined;
}
export function footContactPosition(group: T.Group, side: "left" | "right") {
  return footSurfaceContact(group, side) ?? footPosition(group, side);
}
/** Horizontal contact correction keeps native vertical motion and foot world
 * orientation. Unreachable targets are limited by the two-link leg, never by
 * stretching bones or moving the whole actor off the route. `reachReference`
 * retains the initial reach envelope across refinements without sharing their
 * per-pass correction budget. */
export function correctFootContact(
  group: T.Group,
  side: "left" | "right",
  desired: T.Vector3,
  weight: number,
  maxCorrection: number,
  endpoint?: T.Vector3,
  vertical = false,
  referencePoint?: T.Vector3,
  reachReference?: T.Vector3,
) {
  const bones = group.userData.bones as Record<string, T.Bone>;
  const upper = bones[side + "Leg"],
    lower = bones[side + "Shin"],
    foot = bones[side + "Foot"];
  // Without an independent ankle, solving an inferred ankle would rotate the
  // terminal shin and leave its visible sole away from the requested contact.
  const current = !foot && endpoint ? endpoint : footPosition(group, side);
  if (!upper || !lower || !current || weight <= 0) return;
  // Body support may lower the hip before the solve. Retain the captured
  // contact height from the pre-support frame while bending the actual leg.
  const reference = referencePoint ?? current;
  const delta = desired.clone().sub(reference);
  if (!vertical) delta.y = 0;
  // Report the policy limit separately from physical reach and IK precision.
  // A precise solve of a capped goal can still leave visible contact drift.
  const distanceLimited = Math.max(0, delta.length() - maxCorrection) * weight;
  delta.clampLength(0, maxCorrection).multiplyScalar(weight);
  const requestedDelta = delta.clone();
  const requested = delta.length();
  if (requested > 1e-9) {
    // Radial IK clamping changes coordinates that the caller meant to retain.
    // Use a horizontal disk for planting and a vertical interval for ground
    // support, with a small reserve of the current knee bend in either case.
    const hip = point(upper),
      knee = point(lower);
    const length = hip.distanceTo(knee) + knee.distanceTo(current);
    const currentOffset = reference.clone().sub(hip);
    const offset = reachReference
      ? reachReference.clone().sub(hip)
      : currentOffset;
    const reserve = Math.min(
      length * 0.005,
      Math.max(0, length - offset.length()) * 0.1,
    );
    const reach = Math.max(offset.length(), length - reserve - 1e-6);
    const originalRadius = vertical
      ? Math.abs(offset.y)
      : Math.hypot(offset.x, offset.z);
    const radius = Math.sqrt(
      Math.max(
        0,
        reach * reach -
          (vertical
            ? offset.x * offset.x + offset.z * offset.z
            : offset.y * offset.y),
      ),
    );
    const target = currentOffset.clone().add(delta);
    const desiredRadius = vertical
      ? Math.abs(target.y)
      : Math.hypot(target.x, target.z);
    const available = Math.max(0, radius - originalRadius);
    const soft = available * 0.2,
      threshold = originalRadius + available - soft;
    const distance =
      desiredRadius <= threshold
        ? desiredRadius
        : soft > 1e-9
          ? threshold +
            soft * (1 - Math.exp(-(desiredRadius - threshold) / soft))
          : originalRadius;
    if (desiredRadius > 1e-9) {
      if (vertical) {
        // Ground support must not move a planted foot sideways when the
        // downward goal lies beyond the leg's reach.
        delta.set(
          0,
          (target.y * distance) / desiredRadius - currentOffset.y,
          0,
        );
      } else {
        target.x *= distance / desiredRadius;
        target.z *= distance / desiredRadius;
        delta.set(target.x - currentOffset.x, 0, target.z - currentOffset.z);
      }
    }
  }
  const reachLimited = requestedDelta.distanceTo(delta);
  const target = reference.clone().add(delta);
  if (target.distanceToSquared(current) < 1e-18)
    return { correction: 0, error: 0, reachLimited, distanceLimited };
  const rotation = foot?.getWorldQuaternion(new T.Quaternion());
  const pole = point(lower).sub(point(upper));
  const axis = current.clone().sub(point(upper)).normalize();
  pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8)
    pole
      .set(0, 0, 1)
      .applyQuaternion(group.getWorldQuaternion(new T.Quaternion()));
  const offset = lower.worldToLocal(current.clone());
  const result = solveLimb(upper, lower, offset, target, pole);
  if (foot && rotation) {
    if (
      (
        group.userData.detachedJointAnchors as Map<T.Bone, T.Bone> | undefined
      )?.has(foot)
    )
      foot.position.copy(foot.parent!.worldToLocal(result.hand.clone()));
    foot.quaternion
      .copy(
        foot
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(rotation),
      )
      .normalize();
    foot.updateWorldMatrix(true, true);
  }
  return {
    correction: delta.length(),
    error: result.error,
    reachLimited,
    distanceLimited,
  };
}

export type RouteContactRequest = {
  side: "left" | "right";
  desired: T.Vector3;
  endpoint: T.Vector3;
  weight: number;
  limit: number;
};

/** Give a grounded leg room to reach without extending its bones or moving
 * its foot vertically. The other foot keeps its pre-support world position.
 * Only contact correction activates this; an unchanged pose stays unchanged. */
export function supportRouteContactReach(
  group: T.Group,
  requests: RouteContactRequest[],
) {
  const bones = group.userData.bones as Record<string, T.Bone>;
  const passive: { side: "left" | "right"; point: T.Vector3 }[] = [];
  let combined = 0,
    maximum = Infinity;
  for (const side of ["left", "right"] as const) {
    const upper = bones[side + "Leg"],
      lower = bones[side + "Shin"];
    const request = requests.find((r) => r.side === side);
    const current =
      request?.endpoint ??
      (bones[side + "Foot"]
        ? footPosition(group, side)
        : footContactPosition(group, side));
    if (!upper || !lower || !current) continue;
    const hip = point(upper),
      knee = point(lower);
    const length = hip.distanceTo(knee) + knee.distanceTo(current);
    if (!(length > 0)) continue;
    maximum = Math.min(maximum, length * 0.05);
    const delta = request
      ? request.desired
          .clone()
          .sub(current)
          .setY(0)
          .clampLength(0, request.limit)
          .multiplyScalar(request.weight)
      : new T.Vector3();
    const desired = current.clone().add(delta);
    const horizontal = Math.hypot(desired.x - hip.x, desired.z - hip.z);
    const verticalRoom = Math.sqrt(
      Math.max(0, length * length - horizontal * horizontal),
    );
    maximum = Math.min(maximum, Math.max(0, hip.y - desired.y + verticalRoom));
    if (!request) {
      passive.push({ side, point: current });
      continue;
    }
    const movement = delta.length();
    if (movement <= 1e-12) continue;
    const originalRadius = Math.hypot(current.x - hip.x, current.z - hip.z);
    // Stay out of the soft final 20% of horizontal reach used by the contact
    // solver, retaining its knee-bend reserve rather than pushing to extension.
    // Keep the signed radial change: flattening the inward half introduces a
    // support-velocity kink as a sideways contact crosses the old radius.
    const requiredRadius = Math.max(
      0,
      originalRadius + (horizontal - originalRadius) / 0.8,
    );
    const reach = length * 0.995 - 1e-6;
    const availableHeight = Math.sqrt(
      Math.max(0, reach * reach - requiredRadius * requiredRadius),
    );
    const needed = hip.y - desired.y - availableHeight;
    const band = length * 0.002;
    const smooth =
      needed <= -band
        ? 0
        : needed >= band
          ? needed
          : (needed + band) ** 2 / (4 * band);
    const u = Math.min(1, movement / (length * 0.01));
    const lowering = smooth * u * u * (3 - 2 * u);
    // A smooth conservative maximum avoids a height-velocity kink when
    // support switches legs. At zero correction it is exactly zero.
    combined += lowering ** 8;
  }
  const desired = combined ** (1 / 8),
    threshold = maximum * 0.8;
  const lowering =
    maximum > 0 && Number.isFinite(maximum)
      ? desired <= threshold
        ? desired
        : threshold +
          (maximum - threshold) *
            (1 - Math.exp(-(desired - threshold) / (maximum - threshold)))
      : 0;
  group.userData.routeContactSupport = lowering;
  if (lowering <= 1e-12) return [];
  const position = group
    .getWorldPosition(new T.Vector3())
    .add(new T.Vector3(0, -lowering, 0));
  group.position.copy(
    group.parent ? group.parent.worldToLocal(position) : position,
  );
  group.updateWorldMatrix(true, true);
  return passive;
}

/** Let the legs absorb the smoothed body support near landing/takeoff. A
 * source foot that is already clear of the contact band is left untouched. */
export function supportRouteFootContacts(
  group: T.Group,
  basePosition: T.Vector3,
  source: { left: number; right: number; bindFloor: number },
  ratio: number,
  sourceLegHeight: number,
) {
  const band = sourceLegHeight * 0.05;
  if (!(band > 0 && ratio > 0)) return;
  const offset = () =>
    group.position
      .clone()
      .sub(basePosition)
      .applyQuaternion(group.quaternion.clone().invert())
      .divide(group.scale).y;
  for (const side of ["left", "right"] as const) {
    const clearance = source[side] - source.bindFloor;
    const u = T.MathUtils.clamp(clearance / band, 0, 1);
    const weight = 1 - u * u * (3 - 2 * u);
    if (weight <= 0) continue;
    const initial = sampleFootSurfaces(group);
    if (!initial) return;
    const height = initial[side] - initial.bindFloor + offset();
    const desiredHeight = T.MathUtils.lerp(
      height,
      Math.max(0, clearance) * ratio,
      weight,
    );
    // Both geometry-refinement passes use the same original reach envelope.
    // Rebasing it on the first solve spends that solve's knee-bend reserve;
    // conditionally skipping the next pass instead introduces a pose step.
    const reference = group.userData.bones[side + "Foot"]
      ? footPosition(group, side)!
      : footContactPosition(group, side)!;
    for (let iteration = 0; iteration < 2; iteration++) {
      const surface = sampleFootSurfaces(group)!;
      const delta =
        desiredHeight - (surface[side] - surface.bindFloor + offset());
      // A visible-scale stopping threshold leaves a position step whenever a
      // continuous clearance crosses it. Only skip numerical-scale residuals.
      if (Math.abs(delta) < sourceLegHeight * ratio * 1e-10) break;
      const endpoint = group.userData.bones[side + "Foot"]
        ? footPosition(group, side)!
        : footContactPosition(group, side)!;
      const desired = endpoint
        .clone()
        .add(
          new T.Vector3(0, delta, 0)
            .multiply(group.scale)
            .applyQuaternion(group.quaternion),
        );
      correctFootContact(
        group,
        side,
        desired,
        1,
        sourceLegHeight * ratio * group.scale.y * 0.1,
        endpoint,
        true,
        undefined,
        reference,
      );
    }
  }
}
