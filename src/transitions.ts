import * as T from "three";
import type { Entity, Scene } from "../shared/scene";
import { transitionAt } from "../shared/transitions";

type BonePose = {
  bone: T.Bone;
  rotation: T.Quaternion;
  position: T.Vector3;
  scale: T.Vector3;
};
type BodyPose = { hips: T.Vector3; bones: BonePose[] };
type Boundary = { previous: BodyPose; offset: T.Vector3 } | undefined;
const cache = new WeakMap<
  T.Group,
  { scene: Scene; entity: Entity; boundaries: Map<number, Boundary> }
>();
function capture(group: T.Group): BodyPose | undefined {
  const hips = group.userData.bones?.hips as T.Bone | undefined;
  if (!hips || group.userData.motionWarning) return;
  group.updateWorldMatrix(true, true);
  const bones: BonePose[] = [];
  group.traverse((bone) => {
    if (bone instanceof T.Bone)
      bones.push({
        bone,
        rotation: bone.getWorldQuaternion(new T.Quaternion()),
        position: bone.position.clone(),
        scale: bone.scale.clone(),
      });
  });
  return { hips: hips.getWorldPosition(new T.Vector3()), bones };
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
  const transition = transitionAt(entity, scene, time);
  if (!transition) {
    raw(time);
    return;
  }
  let saved = cache.get(group);
  if (!saved || saved.scene !== scene || saved.entity !== entity) {
    saved = { scene, entity, boundaries: new Map() };
    cache.set(group, saved);
  }
  if (!saved.boundaries.has(transition.boundary)) {
    raw(Math.max(0, transition.boundary - 1e-7));
    const previous = capture(group);
    raw(transition.boundary);
    const incoming = capture(group);
    saved.boundaries.set(
      transition.boundary,
      previous && incoming
        ? { previous, offset: previous.hips.clone().sub(incoming.hips) }
        : undefined,
    );
  }
  raw(time);
  const boundary = saved.boundaries.get(transition.boundary),
    current = capture(group);
  if (!boundary || !current) return;
  const weight = transition.weight,
    hips = group.userData.bones.hips as T.Bone;
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
}
