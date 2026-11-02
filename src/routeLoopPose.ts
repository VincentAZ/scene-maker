import * as T from "three";
import type { Entity, Scene } from "../shared/scene";
import type { LocomotionProfile } from "./locomotion";
import { standingHeight } from "./rig";

type Frame = {
  root: T.Vector3;
  heading: number;
  routeTime?: number;
  clearance?: { left: number; right: number; bindFloor: number };
};
type Joint = {
  bone: T.Bone;
  rotation: T.Quaternion;
  position: T.Vector3;
  scale: T.Vector3;
  anchor?: T.Bone;
  routeRoot: boolean;
};
type Pose = { hips: T.Vector3; joints: Joint[]; morphs: Map<T.Mesh, number[]> };
type Velocity = {
  hips: T.Vector3;
  positions: T.Vector3[];
  rotations: T.Vector3[];
  scales: T.Vector3[];
  morphs: Map<T.Mesh, number[]>;
};
type Closure = {
  first: Pose;
  last: Pose;
  allowed: boolean;
  velocity: Velocity;
  clearanceDelta?: { left: number; right: number };
  clearanceVelocity?: { left: number; right: number };
};
type Saved = {
  scene: Scene;
  entity: Entity;
  profile: LocomotionProfile;
  key: string;
  closure?: Closure;
};
// A viewport render and a planning sweep evaluate the same body under
// different scene objects in turn; keep a few recent closures per body so
// that alternation does not recapture the loop on every call.
const cache = new WeakMap<T.Group, Saved[]>();
const RECENT = 4;
const up = new T.Vector3(0, 1, 0);
function angularVelocity(a: T.Quaternion, b: T.Quaternion, dt: number) {
  const delta = b.clone().multiply(a.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const sine = Math.hypot(delta.x, delta.y, delta.z);
  return sine < 1e-12
    ? new T.Vector3()
    : new T.Vector3(delta.x, delta.y, delta.z).multiplyScalar(
        (2 * Math.atan2(sine, delta.w)) / sine / dt,
      );
}
function velocity(a: Pose, b: Pose, dt: number): Velocity {
  return {
    hips: b.hips.clone().sub(a.hips).divideScalar(dt),
    positions: b.joints.map((j, i) =>
      j.position.clone().sub(a.joints[i].position).divideScalar(dt),
    ),
    rotations: b.joints.map((j, i) =>
      angularVelocity(a.joints[i].rotation, j.rotation, dt),
    ),
    scales: b.joints.map((j, i) =>
      j.scale.clone().sub(a.joints[i].scale).divideScalar(dt),
    ),
    morphs: new Map(
      [...b.morphs].map(([mesh, weights]) => [
        mesh,
        weights.map((weight, i) => (weight - a.morphs.get(mesh)![i]) / dt),
      ]),
    ),
  };
}
function endpointVelocity(
  a: Pose,
  middle: Pose,
  b: Pose,
  dt: number,
  end: boolean,
): Velocity {
  const average = velocity(a, b, dt);
  const endpoint = end
    ? velocity(middle, b, dt / 2)
    : velocity(a, middle, dt / 2);
  // Cancel the leading one-sided sampling bias. Closing the interval-average
  // velocities leaves a residual jump when the authored endpoints accelerate.
  endpoint.hips.multiplyScalar(2).sub(average.hips);
  for (const key of ["positions", "rotations", "scales"] as const)
    endpoint[key].forEach((value, i) =>
      value.multiplyScalar(2).sub(average[key][i]),
    );
  for (const [mesh, values] of endpoint.morphs)
    values.forEach((value, i) => {
      values[i] = 2 * value - average.morphs.get(mesh)![i];
    });
  return endpoint;
}
function worldRotation(node: T.Object3D) {
  const rotation = node.quaternion.clone();
  for (let parent = node.parent; parent; parent = parent.parent)
    rotation.premultiply(parent.quaternion);
  // Keep rotation separate from authored scale. Decomposing a world matrix
  // with nonuniform scaled ancestors folds shear into the quaternion, so
  // converting the closed world rotation back to local space changes even
  // the matching endpoint pose. The quaternion hierarchy is reversible.
  return rotation.normalize();
}
function capture(group: T.Group, frame: Frame): Pose {
  const hips = group.userData.bones.hips as T.Bone;
  const detached = group.userData.detachedJointAnchors as
    Map<T.Bone, T.Bone> | undefined;
  const inverse = new T.Quaternion().setFromAxisAngle(up, -frame.heading);
  group.updateWorldMatrix(true, true);
  const joints: Joint[] = [],
    morphs = new Map<T.Mesh, number[]>();
  group.traverse((node) => {
    if (node instanceof T.Mesh && node.morphTargetInfluences)
      morphs.set(node, [...node.morphTargetInfluences]);
    // Skeleton roots and sibling branches can drive skin or attachments too.
    // Closing only descendants of the hips leaves those branches with the raw
    // source-facing jump, even when the body's world pose is continuous.
    if (!(node instanceof T.Bone)) return;
    const anchor = detached?.get(node);
    let routeRoot = !anchor;
    for (
      let parent = node.parent;
      parent && parent !== group;
      parent = parent.parent
    )
      if (parent instanceof T.Bone) routeRoot = false;
    joints.push({
      bone: node,
      anchor,
      routeRoot,
      scale: node.scale.clone(),
      rotation: inverse.clone().multiply(worldRotation(node)).normalize(),
      position: anchor
        ? anchor.worldToLocal(node.getWorldPosition(new T.Vector3()))
        : routeRoot
          ? node
              .getWorldPosition(new T.Vector3())
              .sub(frame.root)
              .applyQuaternion(inverse)
          : node.position.clone(),
    });
  });
  return {
    hips: hips
      .getWorldPosition(new T.Vector3())
      .sub(frame.root)
      .applyQuaternion(inverse),
    joints,
    morphs,
  };
}

export const routeLoopBlendStart = (duration: number) =>
  duration - Math.min(0.2, duration * 0.2);

/** Match the mean endpoint velocity on both sides of an actual wrap. The first
 * entry stays authored; a final partial entry returns to its authored pose by
 * its end. Source phase is supplied by playback to avoid a second modulo at an
 * exact floating-point boundary. */
export function routeLoopBlendWeights(
  period: number,
  phase: number,
  elapsed: number,
  sourceDuration: number,
) {
  const begin = routeLoopBlendStart(period),
    window = period - begin,
    cycle = Math.round((elapsed - phase) / period);
  if (phase > begin) {
    const u = T.MathUtils.clamp((phase - begin) / window, 0, 1);
    return {
      position: u * u * (3 - 2 * u),
      velocity: ((u * u * u - u * u) * window) / 2,
    };
  }
  const entry = Math.min(window, sourceDuration - cycle * period);
  if (cycle > 0 && entry > 0 && phase < entry) {
    const u = Math.max(0, phase / entry);
    return {
      position: 0,
      velocity: (-(u * u * u - 2 * u * u + u) * entry) / 2,
    };
  }
  return { position: 0, velocity: 0 };
}

/** Close small residual pose differences only on repeated, verified gait loops.
 * Correct in the route frame so path travel and turning are not blended away.
 * The original take and one-shot playback are unchanged. */
export function closeRouteLoopPose(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  time: number,
  route: {
    profile: LocomotionProfile;
    start: number;
    duration: number;
    sourceDuration: number;
    sample: { time: number };
    heading: number;
  },
  frame: Frame,
  raw: (time: number) => Frame | undefined,
) {
  const { profile, start, duration, sourceDuration } = route;
  if (
    sourceDuration <= profile.duration + 1e-6 ||
    profile.contactLoopSides?.length !== 2
  )
    return;
  const key = JSON.stringify([
    entity.position,
    entity.rotation,
    entity.scale,
    start,
    duration,
    sourceDuration,
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
    const step = Math.min(1e-4, profile.duration / 100),
      timeScale = duration / sourceDuration;
    const firstFrame = raw(start),
      first = firstFrame && capture(group, firstFrame);
    const halfNextFrame = raw(start + (step * timeScale) / 2),
      halfNext = halfNextFrame && capture(group, halfNextFrame);
    const nextFrame = raw(start + step * timeScale),
      next = nextFrame && capture(group, nextFrame);
    const lastTime =
      start + ((profile.duration - 1e-7) * duration) / sourceDuration;
    const previousFrame = raw(lastTime - step * timeScale),
      previous = previousFrame && capture(group, previousFrame);
    const halfPreviousFrame = raw(lastTime - (step * timeScale) / 2),
      halfPrevious = halfPreviousFrame && capture(group, halfPreviousFrame);
    const lastFrame = raw(lastTime),
      last = lastFrame && capture(group, lastFrame);
    raw(time);
    let closure: Closure | undefined;
    if (first && halfNext && next && previous && halfPrevious && last) {
      const height = standingHeight(group),
        hips = group.userData.bones.hips;
      const firstVelocity = endpointVelocity(
          first,
          halfNext,
          next,
          step,
          false,
        ),
        lastVelocity = endpointVelocity(
          previous,
          halfPrevious,
          last,
          step,
          true,
        );
      // Sampling just before the wrap avoids selecting the next cycle. Extend
      // that sample to the endpoint, otherwise the sampling offset itself
      // remains as a small position/morph/rotation discontinuity at every wrap.
      const endpointGap =
        profile.duration - (lastFrame?.routeTime ?? profile.duration - 1e-7);
      last.hips.addScaledVector(lastVelocity.hips, endpointGap);
      last.joints.forEach((joint, i) => {
        joint.position.addScaledVector(lastVelocity.positions[i], endpointGap);
        joint.scale.addScaledVector(lastVelocity.scales[i], endpointGap);
        const angular = lastVelocity.rotations[i].clone(),
          speed = angular.length();
        if (speed > 0)
          joint.rotation
            .premultiply(
              new T.Quaternion().setFromAxisAngle(
                angular.divideScalar(speed),
                speed * endpointGap,
              ),
            )
            .normalize();
      });
      for (const [mesh, values] of last.morphs)
        values.forEach((value, i) => {
          values[i] = value + lastVelocity.morphs.get(mesh)![i] * endpointGap;
        });
      const deltaVelocity: Velocity = {
        hips: firstVelocity.hips.clone().sub(lastVelocity.hips),
        positions: firstVelocity.positions.map((v, i) =>
          v.clone().sub(lastVelocity.positions[i]),
        ),
        scales: firstVelocity.scales.map((v, i) =>
          v.clone().sub(lastVelocity.scales[i]),
        ),
        // At the endpoint the constant pose correction has already rotated
        // the outgoing world angular velocity. Correct that rotated velocity,
        // not a component-wise difference in unrelated orientation frames.
        rotations: firstVelocity.rotations.map((v, i) =>
          v
            .clone()
            .sub(
              lastVelocity.rotations[i]
                .clone()
                .applyQuaternion(
                  first.joints[i].rotation
                    .clone()
                    .multiply(last.joints[i].rotation.clone().invert()),
                ),
            ),
        ),
        morphs: new Map(
          [...firstVelocity.morphs].map(([mesh, values]) => [
            mesh,
            values.map((value, i) => value - lastVelocity.morphs.get(mesh)![i]),
          ]),
        ),
      };
      // Bound the actual correction, not an absolute source angular speed.
      // Each Hermite tangent has maximum magnitude 4/27 of its window; sharing
      // the velocity difference across both sides halves that contribution.
      const peakVelocityWeight =
        ((profile.duration - routeLoopBlendStart(profile.duration)) * 2) / 27;
      const allowed =
        first.hips.distanceTo(last.hips) +
          deltaVelocity.hips.length() * peakVelocityWeight <=
          height * entity.scale * 0.05 &&
        first.joints.every((joint, i) => {
          const end = last.joints[i];
          const parentScale = joint.routeRoot
            ? 1
            : Math.abs(
                (joint.anchor ?? joint.bone.parent!).getWorldScale(
                  new T.Vector3(),
                ).x,
              );
          return (
            end?.bone === joint.bone &&
            joint.rotation.angleTo(end.rotation) +
              deltaVelocity.rotations[i].length() * peakVelocityWeight <=
              0.35 &&
            // Exporters can introduce a few parts per million of scale noise.
            // Reject meaningful length changes, using relative units so a
            // small imported skeleton scale is not treated as harmless zero.
            ["x", "y", "z"].every((axis) => {
              const key = axis as "x" | "y" | "z";
              return (
                Math.abs(joint.scale[key] - end.scale[key]) +
                  Math.abs(deltaVelocity.scales[i][key]) * peakVelocityWeight <=
                1e-5 *
                  Math.max(Math.abs(joint.scale[key]), Math.abs(end.scale[key]))
              );
            }) &&
            (joint.bone === hips ||
              (joint.position.distanceTo(end.position) +
                deltaVelocity.positions[i].length() * peakVelocityWeight) *
                parentScale <=
                height * entity.scale * 0.05)
          );
        }) &&
        [...first.morphs].every(([mesh, values]) =>
          values.every(
            (value, i) =>
              Math.abs(value - (last.morphs.get(mesh)?.[i] ?? value)) +
                Math.abs(deltaVelocity.morphs.get(mesh)![i]) *
                  peakVelocityWeight <=
              0.25,
          ),
        );
      const a = firstFrame?.clearance,
        b = lastFrame?.clearance;
      const clearanceSlope = (
        from: Frame | undefined,
        to: Frame | undefined,
        dt: number,
        side: "left" | "right",
      ) =>
        from?.clearance && to?.clearance
          ? (to.clearance[side] -
              to.clearance.bindFloor -
              (from.clearance[side] - from.clearance.bindFloor)) /
            dt
          : 0;
      const entryClearance = (side: "left" | "right") =>
        2 * clearanceSlope(firstFrame, halfNextFrame, step / 2, side) -
        clearanceSlope(firstFrame, nextFrame, step, side);
      const exitClearance = (side: "left" | "right") =>
        2 * clearanceSlope(halfPreviousFrame, lastFrame, step / 2, side) -
        clearanceSlope(previousFrame, lastFrame, step, side);
      closure = {
        first,
        last,
        allowed,
        velocity: deltaVelocity,
        clearanceDelta:
          a && b
            ? {
                left:
                  a.left -
                  a.bindFloor -
                  (b.left - b.bindFloor) -
                  exitClearance("left") * endpointGap,
                right:
                  a.right -
                  a.bindFloor -
                  (b.right - b.bindFloor) -
                  exitClearance("right") * endpointGap,
              }
            : undefined,
        clearanceVelocity:
          a &&
          b &&
          halfNextFrame?.clearance &&
          halfPreviousFrame?.clearance &&
          nextFrame?.clearance &&
          previousFrame?.clearance
            ? {
                left: entryClearance("left") - exitClearance("left"),
                right: entryClearance("right") - exitClearance("right"),
              }
            : undefined,
      };
    }
    saved = { scene, entity, profile, key, closure };
    cache.set(group, [saved, ...recent].slice(0, RECENT));
  }
  const closure = saved.closure;
  if (!closure) return;
  if (!closure.allowed) {
    group.userData.motionNotice = [
      group.userData.motionNotice,
      "This take's body motion does not join smoothly enough for a route loop.",
    ]
      .filter(Boolean)
      .join(" ");
    return;
  }
  const { position: weight, velocity: velocityWeight } = routeLoopBlendWeights(
    profile.duration,
    route.sample.time,
    ((time - start) / duration) * sourceDuration,
    sourceDuration,
  );
  if (weight === 0 && velocityWeight === 0) return;
  const current = capture(group, frame);
  const heading = new T.Quaternion().setFromAxisAngle(up, frame.heading);
  const hips = group.userData.bones.hips as T.Bone;
  const hipPoint = hips
    .getWorldPosition(new T.Vector3())
    .add(
      closure.first.hips
        .clone()
        .sub(closure.last.hips)
        .multiplyScalar(weight)
        .addScaledVector(closure.velocity.hips, velocityWeight)
        .applyQuaternion(heading),
    );
  for (const [i, joint] of current.joints.entries()) {
    // Even tolerated exporter rounding affects visible vertices and child
    // positions. Close its value and velocity with the pose instead of leaving
    // a small but discontinuous mesh scale at every wrap.
    joint.bone.scale
      .copy(joint.scale)
      .addScaledVector(
        closure.first.joints[i].scale.clone().sub(closure.last.joints[i].scale),
        weight,
      )
      .addScaledVector(closure.velocity.scales[i], velocityWeight);
    if (joint.bone !== hips && !joint.anchor && !joint.routeRoot)
      joint.bone.position
        .copy(joint.position)
        .addScaledVector(
          closure.first.joints[i].position
            .clone()
            .sub(closure.last.joints[i].position),
          weight,
        )
        .addScaledVector(closure.velocity.positions[i], velocityWeight);
  }
  group.updateWorldMatrix(true, true);
  for (const [i, joint] of current.joints.entries()) {
    const delta = closure.first.joints[i].rotation
      .clone()
      .multiply(closure.last.joints[i].rotation.clone().invert());
    const rotation = new T.Quaternion()
      .slerp(delta, weight)
      .multiply(joint.rotation);
    const angular = closure.velocity.rotations[i]
      .clone()
      .multiplyScalar(velocityWeight);
    const angle = angular.length();
    if (angle > 1e-12)
      rotation.premultiply(
        new T.Quaternion().setFromAxisAngle(angular.divideScalar(angle), angle),
      );
    rotation.premultiply(heading);
    joint.bone.quaternion
      .copy(worldRotation(joint.bone.parent!).invert().multiply(rotation))
      .normalize();
    joint.bone.updateWorldMatrix(true, true);
  }
  for (const [i, joint] of current.joints.entries())
    if (joint.routeRoot && joint.bone !== hips) {
      const point = joint.position
        .clone()
        .addScaledVector(
          closure.first.joints[i].position
            .clone()
            .sub(closure.last.joints[i].position),
          weight,
        )
        .addScaledVector(closure.velocity.positions[i], velocityWeight)
        .applyQuaternion(heading)
        .add(frame.root);
      joint.bone.position.copy(joint.bone.parent!.worldToLocal(point));
      joint.bone.updateWorldMatrix(true, true);
    }
  // Move the pelvis within its parent rather than translating the whole actor.
  // A group translation would move the already-closed skeleton root and sibling
  // attachments by the pelvis's remaining local displacement at the repeat.
  hips.position.copy(hips.parent!.worldToLocal(hipPoint));
  group.updateWorldMatrix(true, true);
  for (const [i, joint] of current.joints.entries())
    if (joint.anchor) {
      const point = joint.position
        .clone()
        .addScaledVector(
          closure.first.joints[i].position
            .clone()
            .sub(closure.last.joints[i].position),
          weight,
        )
        .addScaledVector(closure.velocity.positions[i], velocityWeight);
      joint.bone.position.copy(
        joint.bone.parent!.worldToLocal(joint.anchor.localToWorld(point)),
      );
      joint.bone.updateWorldMatrix(true, true);
    }
  for (const [mesh, values] of current.morphs)
    values.forEach((value, i) => {
      mesh.morphTargetInfluences![i] =
        value +
        ((closure.first.morphs.get(mesh)?.[i] ?? value) -
          (closure.last.morphs.get(mesh)?.[i] ?? value)) *
          weight +
        closure.velocity.morphs.get(mesh)![i] * velocityWeight;
    });
  // The receiving pose is now closed, so its ground/contact constraints must
  // use the same closed source clearance rather than reintroducing the raw
  // source's endpoint mismatch. Native receivers already measure their closed
  // mesh and do not need this source-space correction.
  return (
    closure.clearanceDelta && {
      left:
        closure.clearanceDelta.left * weight +
        (closure.clearanceVelocity?.left ?? 0) * velocityWeight,
      right:
        closure.clearanceDelta.right * weight +
        (closure.clearanceVelocity?.right ?? 0) * velocityWeight,
    }
  );
}
