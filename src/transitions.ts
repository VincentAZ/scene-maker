import * as T from "three";
import { allMotions, type Entity, type Scene } from "../shared/scene";
import { transitionAt } from "../shared/transitions";
import { clipPlaybackRate, clipSourceStart } from "../shared/clipTiming";
import { importedClip, motionSource, standingHeight } from "./rig";
import {
  applyTransitionContacts,
  captureTransitionContacts,
  transitionContactTargets,
  type TransitionContact,
} from "./transitionContacts";

type BonePose = {
  bone: T.Bone;
  rotation: T.Quaternion;
  position: T.Vector3;
  worldPosition: T.Vector3;
  scale: T.Vector3;
};
type BodyPose = {
  hips: T.Vector3;
  bones: BonePose[];
  morphs: Map<T.Mesh, number[]>;
};
type Boundary =
  | {
      previous: BodyPose;
      incoming: BodyPose;
      velocity: BodyVelocity;
      continuousSource: boolean;
      offset: T.Vector3;
      rootOffsets: Map<T.Bone, T.Vector3>;
      contacts: TransitionContact[];
    }
  | undefined;
type BodyVelocity = {
  bones: {
    position: T.Vector3;
    rotation: T.Vector3;
    scale: T.Vector3;
  }[];
  morphs: Map<T.Mesh, number[]>;
};
function angularVelocity(a: T.Quaternion, b: T.Quaternion, dt: number) {
  const delta = b.clone().multiply(a.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const sine = Math.hypot(delta.x, delta.y, delta.z);
  return sine > 1e-12
    ? new T.Vector3(delta.x, delta.y, delta.z).multiplyScalar(
        (2 * Math.atan2(sine, delta.w)) / (sine * dt),
      )
    : new T.Vector3();
}
function velocityDifference(
  earliest: BodyPose,
  early: BodyPose,
  previous: BodyPose,
  incoming: BodyPose,
  late: BodyPose,
  latest: BodyPose,
  dt: number,
): BodyVelocity {
  const difference = (
    a: T.Vector3,
    b: T.Vector3,
    c: T.Vector3,
    d: T.Vector3,
    e: T.Vector3,
    f: T.Vector3,
  ) =>
    c
      .clone()
      .multiplyScalar(3)
      .addScaledVector(b, -4)
      .add(a)
      .addScaledVector(d, 3)
      .addScaledVector(e, -4)
      .add(f)
      .divideScalar(2 * dt);
  return {
    bones: previous.bones.map((p, i) => {
      const a = earliest.bones[i],
        b = early.bones[i],
        c = incoming.bones[i],
        d = late.bones[i],
        e = latest.bones[i];
      const correction = p.rotation
        .clone()
        .multiply(c.rotation.clone().invert());
      const outgoing = angularVelocity(b.rotation, p.rotation, dt)
        .multiplyScalar(1.5)
        .addScaledVector(angularVelocity(a.rotation, b.rotation, dt), -0.5);
      const entering = angularVelocity(c.rotation, d.rotation, dt)
        .multiplyScalar(1.5)
        .addScaledVector(angularVelocity(d.rotation, e.rotation, dt), -0.5);
      return {
        position: difference(
          a.position,
          b.position,
          p.position,
          c.position,
          d.position,
          e.position,
        ),
        scale: difference(a.scale, b.scale, p.scale, c.scale, d.scale, e.scale),
        rotation: outgoing.sub(entering.applyQuaternion(correction)),
      };
    }),
    morphs: new Map(
      [...previous.morphs].map(([mesh, values]) => [
        mesh,
        values.map((value, i) => {
          const get = (pose: BodyPose) => pose.morphs.get(mesh)?.[i] ?? value;
          return (
            (3 * value -
              4 * get(early) +
              get(earliest) +
              3 * get(incoming) -
              4 * get(late) +
              get(latest)) /
            (2 * dt)
          );
        }),
      ]),
    ),
  };
}

/** A mismatched or highly accelerated take must not launch the body into an
 * extra spin or stretch. Bound only the transient velocity correction; the
 * incoming source animation and the boundary pose offset remain untouched. */
function boundVelocity(
  velocity: BodyVelocity,
  pose: BodyPose,
  group: T.Group,
  duration: number,
) {
  const peak = (duration * 4) / 27;
  const height = standingHeight(group) * group.getWorldScale(new T.Vector3()).y;
  velocity.bones.forEach((v, i) => {
    v.rotation.clampLength(0, 0.35 / peak);
    const worldSpeed = v.position
      .clone()
      .multiply(pose.bones[i].bone.parent!.getWorldScale(new T.Vector3()))
      .length();
    if (worldSpeed * peak > height * 0.05)
      v.position.multiplyScalar((height * 0.05) / (worldSpeed * peak));
    for (const axis of ["x", "y", "z"] as const) {
      const limit = (Math.abs(pose.bones[i].scale[axis]) * 0.05) / peak;
      v.scale[axis] = T.MathUtils.clamp(v.scale[axis], -limit, limit);
    }
  });
  for (const values of velocity.morphs.values())
    for (let i = 0; i < values.length; i++)
      values[i] = T.MathUtils.clamp(values[i], -0.1 / peak, 0.1 / peak);
  return velocity;
}
const cache = new WeakMap<
  T.Group,
  { scene: Scene; entity: Entity; boundaries: Map<number, Boundary> }
>();

/** Splitting a performance is editing, not a new performance. In particular,
 * do not smooth away the original capture's own changes of keyframe velocity. */
function continuesSource(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  boundary: number,
) {
  let time = 0;
  const index = entity.clips.findIndex((clip) => {
    const found = Math.abs(time - boundary) < 1e-8;
    time += clip.duration;
    return found;
  });
  if (index < 1) return false;
  const previous = entity.clips[index - 1],
    incoming = entity.clips[index];
  const motions = allMotions(scene);
  const a = motions.find((m) => m.id === previous.motionId),
    b = motions.find((m) => m.id === incoming.motionId);
  if (
    a?.kind !== "imported" ||
    b?.kind !== "imported" ||
    a.path ||
    b.path ||
    a.sourceAssetId !== b.sourceAssetId ||
    a.animationName !== b.animationName ||
    previous.stationary ||
    incoming.stationary ||
    previous.routeStop !== undefined
  )
    return false;
  const source =
    a.sourceAssetId === entity.assetId
      ? group
      : motionSource(group, a.sourceAssetId!);
  const take =
    source &&
    importedClip(source.userData.animations ?? [], a.animationName ?? "");
  if (!take) return false;
  const rate = clipPlaybackRate(previous, take.duration);
  const end =
    clipSourceStart(previous, take.duration) + previous.duration * rate;
  return (
    end < take.duration &&
    Math.abs(rate - clipPlaybackRate(incoming, take.duration)) < 1e-9 &&
    Math.abs(end - clipSourceStart(incoming, take.duration)) < 1e-8
  );
}
function capture(group: T.Group): BodyPose | undefined {
  const hips = group.userData.bones?.hips as T.Bone | undefined;
  if (!hips || group.userData.motionWarning) return;
  group.updateWorldMatrix(true, true);
  const bones: BonePose[] = [];
  const morphs = new Map<T.Mesh, number[]>();
  group.traverse((bone) => {
    if (bone instanceof T.Mesh && bone.morphTargetInfluences)
      morphs.set(bone, [...bone.morphTargetInfluences]);
    if (bone instanceof T.Bone)
      bones.push({
        bone,
        rotation: bone.getWorldQuaternion(new T.Quaternion()),
        position: bone.position.clone(),
        worldPosition: bone.getWorldPosition(new T.Vector3()),
        scale: bone.scale.clone(),
      });
  });
  return { hips: hips.getWorldPosition(new T.Vector3()), bones, morphs };
}

/** Decay the boundary pose/velocity difference over the incoming performance,
 * rather than blending away its motion toward a frozen outgoing pose.
 * Leave timeline travel on the root.
 * Native parent movement must not be blended twice with accumulated root travel.
 */
export function sampleWithTransitions(
  group: T.Group,
  entity: Entity,
  scene: Scene,
  time: number,
  raw: (time: number) => void,
) {
  const transition = transitionAt(entity, scene, time, true);
  if (!transition) {
    raw(time);
    return;
  }
  if (transition.hold) {
    // Keep the complete evaluated hierarchy, including animated non-bone
    // parents and detached deformers. Rebuilding only the articulated body on
    // a reset root changes the pose and makes export interpolate across a jump.
    raw(transition.boundary);
    const completedHeading = group.rotation.y;
    sampleWithTransitions(
      group,
      entity,
      scene,
      Math.max(0, transition.boundary - 1e-7),
      raw,
    );
    // Keep accumulated complete turns for timeline consumers without changing
    // the held orientation or moving any part of the imported hierarchy.
    group.rotation.y +=
      Math.round((completedHeading - group.rotation.y) / (2 * Math.PI)) *
      2 *
      Math.PI;
    return;
  }
  let saved = cache.get(group);
  if (!saved || saved.scene !== scene || saved.entity !== entity) {
    saved = { scene, entity, boundaries: new Map() };
    cache.set(group, saved);
  }
  if (!saved.boundaries.has(transition.boundary)) {
    const before = (sampleTime: number) =>
      sampleWithTransitions(group, entity, scene, sampleTime, raw);
    const continuousSource = continuesSource(
      group,
      entity,
      scene,
      transition.boundary,
    );
    const contacts = continuousSource
      ? []
      : captureTransitionContacts(
          group,
          entity,
          scene,
          transition.boundary,
          before,
          raw,
        );
    const dt = Math.min(1 / 240, transition.boundary / 4);
    // Stay on the outgoing clip without a visible finite-step pause at entry.
    const end =
      transition.boundary -
      Math.max(1e-9, 2 * Number.EPSILON * transition.boundary);
    before(Math.max(0, end - 2 * dt));
    const earliest = capture(group);
    before(Math.max(0, end - dt));
    const early = capture(group);
    before(Math.max(0, end));
    const previous = capture(group);
    raw(transition.boundary);
    const incoming = capture(group);
    raw(transition.boundary + dt);
    const late = capture(group);
    raw(transition.boundary + 2 * dt);
    const latest = capture(group);
    saved.boundaries.set(
      transition.boundary,
      earliest && early && previous && incoming && late && latest
        ? {
            previous,
            incoming,
            continuousSource,
            velocity: boundVelocity(
              velocityDifference(
                earliest,
                early,
                previous,
                incoming,
                late,
                latest,
                dt,
              ),
              incoming,
              group,
              transition.duration,
            ),
            offset: previous.hips.clone().sub(incoming.hips),
            rootOffsets: new Map(
              previous.bones.flatMap((pose, index) => {
                const next = incoming.bones[index];
                return !(pose.bone.parent instanceof T.Bone) &&
                  next?.bone === pose.bone
                  ? [
                      [
                        pose.bone,
                        pose.worldPosition.clone().sub(next.worldPosition),
                      ],
                    ]
                  : [];
              }),
            ),
            contacts,
          }
        : undefined,
    );
  }
  raw(time);
  const boundary = saved.boundaries.get(transition.boundary);
  if (!boundary) return;
  const targets = transitionContactTargets(group, boundary.contacts, time);
  if (transition.weight >= 1) {
    applyTransitionContacts(group, targets);
    return;
  }
  const current = capture(group);
  if (!current) return;
  const weight = transition.weight,
    hips = group.userData.bones.hips as T.Bone;
  // Cubic Hermite offset: retain compatible outgoing velocity at entry and
  // converge to the incoming motion with zero correction velocity at exit.
  const u = T.MathUtils.clamp(
    (time - transition.boundary) / transition.duration,
    0,
    1,
  );
  const velocityWeight = boundary.continuousSource
    ? 0
    : transition.duration * u * (1 - u) ** 2;
  for (const [mesh, weights] of current.morphs) {
    const previous = boundary.previous.morphs.get(mesh);
    const incoming = boundary.incoming.morphs.get(mesh);
    const velocity = boundary.velocity.morphs.get(mesh);
    if (!previous || !incoming || !velocity) continue;
    for (let index = 0; index < weights.length; index++)
      mesh.morphTargetInfluences![index] =
        weights[index] +
        ((previous[index] ?? 0) - (incoming[index] ?? 0)) * (1 - weight) +
        (velocity[index] ?? 0) * velocityWeight;
  }
  const hipPosition = current.hips
    .clone()
    .addScaledVector(boundary.offset, 1 - weight);
  for (const [index, pose] of current.bones.entries()) {
    const previous = boundary.previous.bones[index];
    const incoming = boundary.incoming.bones[index];
    const velocity = boundary.velocity.bones[index];
    if (!previous || previous.bone !== pose.bone || !incoming || !velocity)
      continue;
    const bone = pose.bone;
    bone.position
      .copy(pose.position)
      .addScaledVector(
        previous.position.clone().sub(incoming.position),
        1 - weight,
      )
      .addScaledVector(velocity.position, velocityWeight);
    bone.scale
      .copy(pose.scale)
      .addScaledVector(previous.scale.clone().sub(incoming.scale), 1 - weight)
      .addScaledVector(velocity.scale, velocityWeight);
    if (bone === hips)
      bone.position.copy(bone.parent!.worldToLocal(hipPosition.clone()));
    else if (boundary.rootOffsets.has(bone)) {
      // Armature roots and detached deformers also cross coordinate frames
      // when native travel hands over to timeline travel. Preserve their world
      // continuity, including roots with no skin weights of their own.
      const position = pose.worldPosition
        .clone()
        .addScaledVector(boundary.rootOffsets.get(bone)!, 1 - weight);
      bone.position.copy(bone.parent!.worldToLocal(position));
    }
    const correction = previous.rotation
      .clone()
      .multiply(incoming.rotation.clone().invert())
      .slerp(new T.Quaternion(), weight);
    const angle = velocity.rotation.length() * velocityWeight;
    if (angle > 1e-12)
      correction.premultiply(
        new T.Quaternion().setFromAxisAngle(
          velocity.rotation.clone().normalize(),
          angle,
        ),
      );
    const rotation = correction.multiply(pose.rotation);
    bone.quaternion
      .copy(
        bone
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(rotation),
      )
      .normalize();
    bone.updateWorldMatrix(true, true);
  }
  applyTransitionContacts(group, targets);
}
