import * as T from "three";
import type { Entity, Scene } from "../shared/scene";
import { transitionAt } from "../shared/transitions";
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
      offset: T.Vector3;
      rootOffsets: Map<T.Bone, T.Vector3>;
      contacts: TransitionContact[];
    }
  | undefined;
const cache = new WeakMap<
  T.Group,
  { scene: Scene; entity: Entity; boundaries: Map<number, Boundary> }
>();
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

/** Blend the body in world space while leaving timeline travel on the root.
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
    const contacts = captureTransitionContacts(
      group,
      entity,
      scene,
      transition.boundary,
      before,
      raw,
    );
    before(Math.max(0, transition.boundary - 1e-7));
    const previous = capture(group);
    raw(transition.boundary);
    const incoming = capture(group);
    saved.boundaries.set(
      transition.boundary,
      previous && incoming
        ? {
            previous,
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
  for (const [mesh, weights] of current.morphs) {
    const previous = boundary.previous.morphs.get(mesh);
    if (!previous) continue;
    for (let index = 0; index < weights.length; index++)
      mesh.morphTargetInfluences![index] = T.MathUtils.lerp(
        previous[index] ?? weights[index],
        weights[index],
        weight,
      );
  }
  const hipPosition = current.hips
    .clone()
    .addScaledVector(boundary.offset, 1 - weight);
  for (const [index, pose] of current.bones.entries()) {
    const previous = boundary.previous.bones[index];
    if (!previous || previous.bone !== pose.bone) continue;
    const bone = pose.bone;
    bone.position.lerpVectors(previous.position, pose.position, weight);
    bone.scale.lerpVectors(previous.scale, pose.scale, weight);
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
    const rotation = previous.rotation.clone().slerp(pose.rotation, weight);
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
