import * as T from "three";
import type { Entity, Scene } from "../shared/scene";
import type { LocomotionProfile } from "./locomotion";
import { routeLoopBlendWeights } from "./routeLoopPose";
import {
  fitContactLanding,
  fitContactSwing,
  contactSwingBump,
  sampleLandingConstraints,
  type LandingBlendConstraint,
  type ContactSwing,
  type LandingDisk,
} from "./contactLanding";
import {
  correctFootContact,
  footPosition,
  footContactPosition,
  supportRouteContactReach,
} from "./routeContacts";
import { standingHeight, humanoidWarning } from "./rig";
import { hasFootSurfaceContacts } from "./footSurface";
import {
  scheduleRouteContacts,
  scheduledContactPoint,
  type ScheduledContact,
} from "./routeContactSchedule";

type Anchor = {
  position: T.Vector3;
  turn: number;
  orientation: number;
  sourceTime: number;
  receiverPoint?: T.Vector3;
  receiverEnd?: T.Vector3;
  releaseDelta?: T.Vector3;
  approachDelta?: T.Vector3;
  approachVelocity?: T.Vector3;
  releaseVelocity?: T.Vector3;
  releaseTurn?: number;
  releaseTurnVelocity?: number;
  approachBump?: ContactSwing;
  releaseBump?: ContactSwing;
};
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const heading = (group: T.Group) => {
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(
    group.getWorldQuaternion(new T.Quaternion()),
  );
  return Math.atan2(forward.x, forward.z);
};
function turnFoot(group: T.Group, side: "left" | "right", turn: number) {
  const foot = group.userData.bones[side + "Foot"] as T.Bone | undefined;
  if (foot && Math.abs(turn) > 1e-12) {
    const rotation = foot
      .getWorldQuaternion(new T.Quaternion())
      .premultiply(
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), turn),
      );
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
}
type Saved = {
  scene: Scene;
  entity: Entity;
  profile: LocomotionProfile;
  key: string;
  anchors: Map<string, Anchor>;
};
// Renders and planning sweeps alternate scene objects for one body; keep a
// few recent anchor sets so neither invalidates the other every call.
const cache = new WeakMap<T.Group, Saved[]>();
const RECENT = 4;
const schedules = new WeakMap<
  LocomotionProfile,
  Partial<Record<"ankle" | "sole", ScheduledContact[]>>
>();
export function applyRouteFootPlanting(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  time: number,
  route: {
    profile: LocomotionProfile;
    sample: { time: number; center?: T.Vector3 };
    root?: T.Vector3;
    ratio: number;
    start: number;
    duration: number;
    sourceDuration: number;
  },
  transferred: boolean,
  raw: (time: number) => {
    routeTime: number;
    root?: T.Vector3;
    routeCenter?: T.Vector3;
  } | void,
) {
  const { profile, ratio, start, duration, sourceDuration } = route;
  if (!profile.contacts?.length || sourceDuration <= 0) return;
  if (humanoidWarning(group, entity.name, false)) {
    group.userData.motionNotice =
      "Foot contact correction needs a compatible humanoid leg hierarchy and uniform skeleton scale.";
    return;
  }
  const elapsed = ((time - start) / duration) * sourceDuration;
  let sampledPhase: number | undefined = route.sample.time;
  let sampledRoot = route.root,
    sampledCenter = route.sample.center;
  const resample = (sampleTime: number) => {
    const frame = raw(sampleTime);
    sampledPhase = frame?.routeTime;
    sampledRoot = frame?.root;
    sampledCenter = frame?.routeCenter;
  };
  const orientationFrame = (sourceElapsed: number) => {
    let angle = heading(group);
    if (sourceDuration <= profile.duration + 1e-6 || profile.frames.length < 2)
      return angle;
    const first = profile.frames[0],
      next = profile.frames[1];
    const last = profile.frames.at(-1)!,
      previous = profile.frames.at(-2)!;
    const elapsed = Math.max(0, Math.min(sourceDuration - 1e-7, sourceElapsed));
    // Use the phase that actually produced this pose. Equivalent timeline
    // arithmetic can land on opposite sides of an exact floating-point wrap.
    const cycle =
        sampledPhase === undefined
          ? Math.floor(elapsed / profile.duration)
          : Math.round((elapsed - sampledPhase) / profile.duration),
      phase = sampledPhase ?? elapsed - cycle * profile.duration;
    // Source coordinates restart at each cycle; the planted world frame does
    // not. Unfold that reset and match its endpoint angular velocity as well.
    angle -= cycle * (last.heading - first.heading);
    const entrySpeed =
      (next.heading - first.heading) / (next.time - first.time);
    const exitSpeed =
      (last.heading - previous.heading) / (last.time - previous.time);
    angle -=
      routeLoopBlendWeights(profile.duration, phase, elapsed, sourceDuration)
        .velocity *
      (entrySpeed - exitSpeed);
    return angle;
  };
  const currentHeading = orientationFrame(elapsed);
  const useSurface =
    hasFootSurfaceContacts(group) &&
    profile.contacts.every((contact) =>
      contact.samples.every((sample) => !!sample.sole),
    );
  const basis = useSurface ? "sole" : "ankle";
  const contactPosition = useSurface ? footContactPosition : footPosition;
  // Captured travel has a real source-space trajectory. In-place gait
  // contacts instead include reconstructed virtual travel: importing the
  // receiver's raw ankle excursion would undo its measured planted stride.
  const receiverAware =
    profile.mode === "travel" &&
    sourceDuration <= profile.duration + 1e-6 &&
    !!sampledRoot &&
    !!sampledCenter;
  const receiverPoint = (side: "left" | "right") => {
    if (!receiverAware || !sampledRoot || !sampledCenter) return;
    return contactPosition(group, side)
      ?.sub(sampledRoot)
      .applyQuaternion(group.getWorldQuaternion(new T.Quaternion()).invert())
      .divideScalar(ratio * entity.scale)
      .applyAxisAngle(
        new T.Vector3(0, 1, 0),
        transferred ? profile.startHeading : 0,
      )
      .add(sampledCenter);
  };
  // Reconstruct this receiver's captured contact in the source travel frame.
  // The same source pose can roll a differently proportioned foot by a different
  // amount; scaling the source sole track would erase that articulation.
  const currentReceiver = {
    left: receiverPoint("left"),
    right: receiverPoint("right"),
  };
  let variants = schedules.get(profile);
  if (!variants) schedules.set(profile, (variants = {}));
  let schedule = variants[basis];
  if (!schedule) {
    schedule = scheduleRouteContacts(
      useSurface
        ? profile.contacts.map((contact) => ({
            ...contact,
            samples: contact.samples.map((sample) => ({
              time: sample.time,
              point: sample.sole!,
            })),
          }))
        : profile.contacts,
      profile.duration,
      profile.contactLoopSides,
    );
    variants[basis] = schedule;
  }
  const active = schedule
    .map((scheduled) => {
      const cycle = scheduled.continuous
        ? 0
        : Math.floor((elapsed - scheduled.approachStart) / profile.duration);
      return {
        ...scheduled,
        cycle,
        // The first route has no preceding swing, even when later cycles do.
        // Begin its preparation at the actual route entry with zero influence.
        approachStart: Math.max(
          scheduled.approachStart,
          -cycle * profile.duration,
        ),
        sourceTime: elapsed - cycle * profile.duration,
      };
    })
    .filter(
      ({ contact, approachStart, continuous, releaseEnd, cycle, sourceTime }) =>
        (continuous || cycle * profile.duration + contact.end > 0) &&
        (continuous ||
          cycle * profile.duration + contact.start < sourceDuration) &&
        sourceTime >= approachStart &&
        sourceTime < releaseEnd,
    );
  if (!active.length) return;
  const key = JSON.stringify([
    entity.position,
    entity.rotation,
    entity.scale,
    start,
    duration,
    sourceDuration,
    basis,
    receiverAware,
  ]);
  const recent = cache.get(group) ?? [];
  let saved = recent.find(
    (entry) =>
      entry.scene === scene &&
      entry.entity === entity &&
      entry.profile === profile &&
      entry.key === key,
  );
  if (!saved) {
    saved = { scene, entity, profile, key, anchors: new Map() };
    cache.set(group, [saved, ...recent].slice(0, RECENT));
  }
  const goals: {
    side: "left" | "right";
    position: T.Vector3;
    weight: number;
    limit: number;
    delta?: T.Vector3;
    turn: number;
  }[] = [];
  let resampled = false;
  const legHeight = standingHeight(group) * entity.scale;
  for (const scheduled of active) {
    const {
      contact,
      approachStart,
      releaseEnd,
      continuous,
      cycle,
      sourceTime: currentSourceTime,
    } = scheduled;
    const limit = Math.min(
      legHeight * 0.4,
      Math.max(
        legHeight * 0.1,
        (contact.maxCorrection ?? 0) * ratio * entity.scale,
      ),
    );
    const id = `${cycle}:${contact.side}:${contact.start}`;
    let anchor = saved.anchors.get(id);
    if (!anchor) {
      const sourceTime = Math.max(
        -cycle * profile.duration,
        Math.min(
          contact.start,
          sourceDuration - cycle * profile.duration - 1e-6,
        ),
      );
      const anchorTime =
        start +
        ((cycle * profile.duration + sourceTime) / sourceDuration) * duration;
      const actualAnchorTime = Math.min(
        start + duration - 1e-7,
        Math.max(start, anchorTime),
      );
      resample(actualAnchorTime);
      resampled = true;
      const position = contactPosition(group, contact.side);
      if (!position || group.userData.motionWarning) continue;
      const forward = new T.Vector3(0, 0, 1).applyQuaternion(
        group.getWorldQuaternion(new T.Quaternion()),
      );
      anchor = {
        position,
        sourceTime,
        receiverPoint: receiverPoint(contact.side),
        orientation: orientationFrame(
          ((actualAnchorTime - start) / duration) * sourceDuration,
        ),
        turn:
          Math.atan2(forward.x, forward.z) -
          (transferred ? profile.startHeading : 0),
      };
      if (anchor.receiverPoint) {
        resample(
          start +
            (Math.min(contact.end, sourceDuration - 1e-7) / sourceDuration) *
              duration,
        );
        anchor.receiverEnd = receiverPoint(contact.side);
      }
      if (!continuous) {
        // Match the correction's velocity to the stance on both sides. Sample
        // the uncorrected receiver so imported units, proportions and path turns
        // are accounted for without changing the source clock.
        const reference = scheduledContactPoint(
          scheduled,
          sourceTime,
          profile.duration,
        );
        const residualAt = (phase: number, bounded = true) => {
          resample(
            start +
              ((cycle * profile.duration + phase) / sourceDuration) * duration,
          );
          const receiver = receiverPoint(contact.side);
          turnFoot(
            group,
            contact.side,
            wrap(
              anchor!.orientation -
                orientationFrame(cycle * profile.duration + phase),
            ),
          );
          const point = contactPosition(group, contact.side);
          if (!point) return undefined;
          const displacement = (
            receiver && anchor!.receiverPoint
              ? receiver.sub(anchor!.receiverPoint)
              : scheduledContactPoint(scheduled, phase, profile.duration).sub(
                  reference,
                )
          )
            .applyAxisAngle(new T.Vector3(0, 1, 0), anchor!.turn)
            .multiplyScalar(ratio * entity.scale);
          const delta = anchor!.position.clone().add(displacement).sub(point);
          delta.y = 0;
          // Match the bounded goal actually consumed by the contact solver.
          // An unrestricted derivative can leave a saturated correction
          // abruptly even though the stance goal is still at its limit.
          return bounded ? delta.clampLength(0, limit) : delta;
        };
        const step = Math.min(1e-4, (contact.end - contact.start) / 8);
        // Choose the nearest feasible landing from the complete stance rather
        // than spending the entire allowance after touching down. Prepare the
        // offset during the existing swing; an already active initial stance
        // must retain its original anchor.
        if (
          profile.mode === "in-place" &&
          contact.approachDuration &&
          contact.start > approachStart &&
          cycle * profile.duration + contact.start > 0
        ) {
          const end = Math.min(
            contact.end,
            sourceDuration - cycle * profile.duration - 1e-7,
          );
          const count = Math.max(2, Math.ceil((end - contact.start) * 60));
          const constraints: LandingDisk[] = [];
          const swingConstraints: [
            LandingBlendConstraint[],
            LandingBlendConstraint[],
          ] = [[], []];
          let needsFit = false;
          const add = (correction: T.Vector3, influence = 1) => {
            needsFit ||= correction.length() > limit;
            constraints.push({
              center: correction.clone().multiplyScalar(-1 / influence),
              radius: limit / influence,
            });
          };
          const physical = (correction: T.Vector3, influence = 1) => {
            const bones = group.userData.bones as Record<string, T.Bone>;
            const hip = bones[contact.side + "Leg"].getWorldPosition(
              new T.Vector3(),
            );
            const knee = bones[contact.side + "Shin"].getWorldPosition(
              new T.Vector3(),
            );
            const endpoint = footPosition(group, contact.side)!;
            const length = hip.distanceTo(knee) + knee.distanceTo(endpoint);
            // Reserve the existing support solver's soft region and bend.
            // A landing must not demand more than its bounded body lowering.
            const height = Math.max(0, hip.y - endpoint.y - length * 0.04);
            const reach = length * 0.995 - 1e-6;
            const radius = Math.sqrt(
              Math.max(0, reach * reach - height * height),
            );
            const offset = hip.clone().sub(endpoint).setY(0);
            const disk = {
              center: offset.clone().sub(correction).divideScalar(influence),
              radius: (radius * 0.8 + offset.length() * 0.2) / influence,
            };
            // A correction can fit its distance allowance but still exceed a
            // nearly extended leg's reach. Such a landing needs preparation
            // just as much as one that exceeds the correction allowance.
            needsFit ||= disk.center.length() > disk.radius;
            return disk;
          };
          const times = Array.from(
            { length: count + 1 },
            (_, i) => contact.start + ((end - contact.start) * i) / count,
          );
          for (
            let cycle = Math.floor(contact.start / profile.duration);
            cycle <= Math.floor(end / profile.duration);
            cycle++
          )
            for (const key of profile.keyTimes ?? []) {
              const phase = key + cycle * profile.duration;
              if (phase > contact.start && phase < end) times.push(phase);
            }
          const measured = new Map<number, LandingDisk[]>();
          const stanceAt = (phase: number) => {
            const known = measured.get(phase);
            if (known) return known;
            const correction = residualAt(phase, false);
            const disks: LandingDisk[] = correction
              ? [
                  { center: correction.clone().negate(), radius: limit },
                  physical(correction),
                ]
              : [];
            if (correction) needsFit ||= correction.length() > limit;
            measured.set(phase, disks);
            return disks;
          };
          for (const phase of times) constraints.push(...stanceAt(phase));
          const stanceConstraints = constraints.slice();

          // The approach/release Hermite tangent can exceed either endpoint.
          // Fit these blends too, so saturation cannot create a velocity kick.
          for (const entry of [true, false]) {
            const phase = entry ? contact.start : contact.end;
            if (cycle * profile.duration + phase >= sourceDuration) continue;
            const boundary = residualAt(phase, false);
            const adjacent = residualAt(phase + (entry ? step : -step), false);
            if (!boundary || !adjacent) continue;
            const velocity = entry
              ? adjacent.sub(boundary).divideScalar(step)
              : boundary.clone().sub(adjacent).divideScalar(step);
            const span = entry
              ? contact.start - approachStart
              : releaseEnd - contact.end;
            for (let i = 1; i < 32; i++) {
              const u = i / 32,
                smooth = u * u * (3 - 2 * u),
                influence = entry ? smooth : 1 - smooth;
              const tangent = entry
                ? u * u * u - u * u
                : u * u * u - 2 * u * u + u;
              const correction = boundary
                .clone()
                .multiplyScalar(influence)
                .addScaledVector(velocity, tangent * span);
              const firstConstraint = constraints.length;
              add(correction, influence);
              const time = phase + (entry ? u - 1 : u) * span;
              if (
                cycle * profile.duration + time >= 0 &&
                cycle * profile.duration + time < sourceDuration
              ) {
                residualAt(time, false);
                constraints.push(physical(correction, influence));
              }
              swingConstraints[entry ? 0 : 1].push(
                ...constraints.slice(firstConstraint).map((disk) => ({
                  ...disk,
                  influence,
                  phase: u,
                })),
              );
            }
          }
          if (needsFit) {
            let landing = fitContactLanding(constraints, limit);
            if (landing.lengthSq() > 0) {
              // The first fit identifies a reachable candidate. Refine its
              // curved stance geometry before accepting it, without spending
              // this sampling cost on an unchanged or infeasible landing.
              const refined = sampleLandingConstraints(
                times,
                stanceAt,
                limit * 1e-4,
              );
              landing = fitContactLanding([...constraints, ...refined], limit);
            }
            if (landing.lengthSq() === 0) {
              const stance = [
                ...stanceConstraints,
                ...sampleLandingConstraints(times, stanceAt, limit * 1e-4),
              ];
              const planted = fitContactLanding(stance, limit);
              if (
                stance.every(
                  ({ center, radius }) =>
                    planted.distanceTo(center) <= radius + limit * 1e-8,
                )
              ) {
                const approach = fitContactSwing(
                  swingConstraints[0],
                  planted,
                  limit,
                );
                const release = fitContactSwing(
                  swingConstraints[1],
                  planted,
                  limit,
                );
                if (approach && release) {
                  landing = planted;
                  anchor.approachBump = approach;
                  anchor.releaseBump = release;
                }
              }
            }
            anchor.position.add(landing);
          }
        }
        // Keep the one-sided derivative close to the boundary: a frame-sized
        // interval can cross a correction limit and average away its slope.
        if (
          contact.approachDuration &&
          step > 0 &&
          cycle * profile.duration + contact.start >= 0 &&
          cycle * profile.duration + contact.start + step < sourceDuration
        ) {
          const first = residualAt(contact.start),
            next = residualAt(contact.start + step);
          if (first && next) {
            anchor.approachDelta = first;
            anchor.approachVelocity = next.sub(first).divideScalar(step);
          }
        }
        if (
          step > 0 &&
          cycle * profile.duration + contact.end - step >= 0 &&
          cycle * profile.duration + contact.end < sourceDuration
        ) {
          const previous = residualAt(contact.end - step),
            last = residualAt(contact.end);
          if (previous && last) {
            anchor.releaseDelta = last.clone();
            anchor.releaseVelocity = last
              .clone()
              .sub(previous)
              .divideScalar(step);
          }
        }
      }
      saved.anchors.set(id, anchor);
    }
    const receiver =
      currentSourceTime < contact.start
        ? anchor.receiverPoint
        : currentSourceTime > contact.end
          ? anchor.receiverEnd
          : currentReceiver[contact.side];
    const sourceDelta = (
      receiver && anchor.receiverPoint
        ? receiver.clone().sub(anchor.receiverPoint)
        : scheduledContactPoint(
            scheduled,
            currentSourceTime,
            profile.duration,
          ).sub(
            scheduledContactPoint(
              scheduled,
              anchor.sourceTime,
              profile.duration,
            ),
          )
    )
      .applyAxisAngle(new T.Vector3(0, 1, 0), anchor.turn)
      .multiplyScalar(ratio * entity.scale);
    const position = anchor.position.clone().add(sourceDelta);
    if (continuous || currentSourceTime <= contact.end) {
      const u =
        currentSourceTime >= contact.start || contact.start <= approachStart
          ? 1
          : T.MathUtils.clamp(
              (currentSourceTime - approachStart) /
                (contact.start - approachStart),
              0,
              1,
            );
      const delta =
        u < 1 && anchor.approachDelta
          ? anchor.approachDelta
              .clone()
              .multiplyScalar(u * u * (3 - 2 * u))
              .addScaledVector(
                anchor.approachVelocity ?? new T.Vector3(),
                (u * u * u - u * u) * (contact.start - approachStart),
              )
          : undefined;
      if (delta && anchor.approachBump)
        delta.addScaledVector(
          anchor.approachBump.offset,
          contactSwingBump(u, anchor.approachBump),
        );
      goals.push({
        side: contact.side,
        position,
        delta,
        weight: delta ? 1 : u * u * (3 - 2 * u),
        limit,
        turn: wrap(anchor.orientation - currentHeading) * u * u * (3 - 2 * u),
      });
    } else {
      if (anchor.releaseTurn === undefined) {
        const step = Math.min(1e-4, (contact.end - contact.start) / 8);
        resample(
          start +
            ((cycle * profile.duration + contact.end - step) / sourceDuration) *
              duration,
        );
        const before = orientationFrame(
          cycle * profile.duration + contact.end - step,
        );
        resample(
          start +
            ((cycle * profile.duration + contact.end) / sourceDuration) *
              duration,
        );
        const last = orientationFrame(cycle * profile.duration + contact.end);
        resampled = true;
        anchor.releaseTurn = wrap(anchor.orientation - last);
        anchor.releaseTurnVelocity = step > 0 ? -wrap(last - before) / step : 0;
      }
      if (!anchor.releaseDelta) {
        resample(
          start +
            ((cycle * profile.duration + contact.end) / sourceDuration) *
              duration,
        );
        resampled = true;
        turnFoot(group, contact.side, anchor.releaseTurn);
        const end = contactPosition(group, contact.side);
        if (!end) continue;
        anchor.releaseDelta = position.clone().sub(end);
        anchor.releaseDelta.y = 0;
        anchor.releaseDelta.clampLength(0, limit);
      }
      const u = Math.min(
        1,
        (currentSourceTime - contact.end) / (releaseEnd - contact.end),
      );
      goals.push({
        side: contact.side,
        position,
        delta: anchor.releaseVelocity
          ? anchor.releaseDelta
              .clone()
              .multiplyScalar(1 - u * u * (3 - 2 * u))
              .addScaledVector(
                anchor.releaseVelocity,
                (u * u * u - 2 * u * u + u) * (releaseEnd - contact.end),
              )
              .addScaledVector(
                anchor.releaseBump?.offset ?? new T.Vector3(),
                contactSwingBump(u, anchor.releaseBump),
              )
          : anchor.releaseDelta,
        weight: anchor.releaseVelocity ? 1 : 1 - u * u * (3 - 2 * u),
        limit,
        turn:
          anchor.releaseTurn * (1 - u * u * (3 - 2 * u)) +
          (anchor.releaseTurnVelocity ?? 0) *
            (releaseEnd - contact.end) *
            (u * u * u - 2 * u * u + u),
      });
    }
  }
  if (resampled) resample(time);
  const requests = goals.map((goal) => {
    // Keep the captured foot roll/yaw in its planted frame. Turning the
    // route's body frame must not swivel the shoe against the ground.
    turnFoot(group, goal.side, goal.turn);
    const surface = contactPosition(group, goal.side)!;
    const endpoint =
      !useSurface || group.userData.bones[goal.side + "Foot"]
        ? footPosition(group, goal.side)!
        : surface.clone();
    return {
      side: goal.side,
      endpoint,
      desired: endpoint
        .clone()
        .add(goal.delta ?? goal.position.clone().sub(surface)),
      weight: goal.weight,
      limit: goal.limit,
    };
  });
  const passive = supportRouteContactReach(group, requests);
  group.userData.routeFootCorrection = Object.fromEntries(
    requests.map((goal) => [
      goal.side,
      correctFootContact(
        group,
        goal.side,
        goal.desired,
        goal.weight,
        goal.limit,
        group.userData.bones[goal.side + "Foot"]
          ? undefined
          : goal.endpoint
              .clone()
              .add(new T.Vector3(0, -group.userData.routeContactSupport, 0)),
        false,
        goal.endpoint,
      ),
    ]),
  );
  for (const foot of passive)
    correctFootContact(
      group,
      foot.side,
      foot.point,
      1,
      0,
      group.userData.bones[foot.side + "Foot"]
        ? undefined
        : foot.point
            .clone()
            .add(new T.Vector3(0, -group.userData.routeContactSupport, 0)),
      false,
      foot.point,
    );
}
