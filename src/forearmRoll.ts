import * as T from "three";

type Joint = {
  bone: T.Bone;
  key: string;
  bindPoint: T.Vector3;
  bindRotation: T.Quaternion;
};
type Rig<J extends Joint> = {
  joints: J[];
  rest: Map<
    T.Object3D,
    { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3 }
  >;
};

/** Match a captured axial segment to an available weighted forearm branch.
 * This transfers the measured rotation, without deriving roll from hand flexion
 * or synthesizing a distribution over helper bones. Existing matches win. */
export function forearmRollPairs<J extends Joint>(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
  a: Rig<J>,
  b: Rig<J>,
  existing: { source: J; target: J }[],
): { source: J; target: J }[] {
  if (
    !["left", "right"].some((side) => {
      const fore = source.userData.bones[side + "Forearm"],
        hand = source.userData.bones[side + "Hand"];
      return (
        fore && hand && hand.parent !== fore && hand.parent?.parent === fore
      );
    })
  )
    return [];
  const weighted = new Set<T.Bone>();
  target.traverse((node) => {
    if (!(node instanceof T.SkinnedMesh)) return;
    const indices = node.geometry.getAttribute("skinIndex"),
      weights = node.geometry.getAttribute("skinWeight");
    if (!indices || !weights) return;
    for (let i = 0; i < indices.count; i++)
      for (let k = 0; k < 4; k++)
        if (weights.getComponent(i, k) > 0)
          weighted.add(node.skeleton.bones[indices.getComponent(i, k)]);
  });
  const result: { source: J; target: J }[] = [];
  for (const side of ["left", "right"]) {
    const role = side + "forearmroll";
    const sourceRole = a.joints.find(
        (j) => source.userData.rigSemanticKeys?.get(j.bone) === role,
      ),
      targetRole = b.joints.find(
        (j) => target.userData.rigSemanticKeys?.get(j.bone) === role,
      );
    // The existing role set contains BOTH explicit assignments and nulls.
    // A valid assignment is a constraint, while an unassigned role disables it.
    if (
      (source.userData.disabledRigRoles?.has(role) && !sourceRole) ||
      (target.userData.disabledRigRoles?.has(role) && !targetRole)
    )
      continue;
    const fore = source.userData.bones[side + "Forearm"] as T.Bone | undefined,
      hand = source.userData.bones[side + "Hand"] as T.Bone | undefined,
      receivingFore = target.userData.bones[side + "Forearm"] as
        T.Bone | undefined,
      receivingHand = target.userData.bones[side + "Hand"] as
        T.Bone | undefined;
    if (
      !fore ||
      !hand ||
      !receivingFore ||
      !receivingHand ||
      receivingHand.parent !== receivingFore
    )
      continue;
    const roll = a.joints.find((j) => j.bone === hand.parent);
    if (
      !roll ||
      (sourceRole && sourceRole !== roll) ||
      roll.bone.parent !== fore ||
      roll.key.startsWith("unmapped:") ||
      (source.userData.rigSemanticKeys?.has(roll.bone) &&
        source.userData.rigSemanticKeys.get(roll.bone) !== role) ||
      existing.some((p) => p.source === roll)
    )
      continue;
    const sourceFore = a.joints.find((j) => j.bone === fore)!,
      sourceHand = a.joints.find((j) => j.bone === hand)!,
      targetFore = b.joints.find((j) => j.bone === receivingFore)!,
      targetHand = b.joints.find((j) => j.bone === receivingHand)!;
    if (!sourceFore || !sourceHand || !targetFore || !targetHand) continue;
    const sourceAxis = sourceHand.bindPoint.clone().sub(sourceFore.bindPoint),
      sourceLength = sourceAxis.length(),
      targetAxis = targetHand.bindPoint.clone().sub(targetFore.bindPoint),
      targetLength = targetAxis.length();
    if (
      !Number.isFinite(sourceLength) ||
      !Number.isFinite(targetLength) ||
      sourceLength < 1e-6 ||
      targetLength < 1e-6
    )
      continue;
    sourceAxis.normalize();
    targetAxis.normalize();
    const location = (
      joint: Joint,
      start: Joint,
      axis: T.Vector3,
      length: number,
    ) => {
      const v = joint.bindPoint.clone().sub(start.bindPoint),
        along = v.dot(axis);
      return {
        fraction: along / length,
        distance: v.addScaledVector(axis, -along).length() / length,
      };
    };
    const where = location(roll, sourceFore, sourceAxis, sourceLength);
    if (where.fraction < 0.2 || where.fraction > 0.9 || where.distance > 0.01)
      continue;
    const axis = sourceAxis
        .clone()
        .applyQuaternion(sourceFore.bindRotation.clone().invert())
        .normalize(),
      rest = a.rest.get(roll.bone)!;
    let rotation = false,
      supported = true;
    const root = (source.userData.mixer as T.AnimationMixer).getRoot();
    for (const track of clip.tracks) {
      const path = T.PropertyBinding.parseTrackName(track.name);
      if (T.PropertyBinding.findNode(root, path.nodeName) !== roll.bone)
        continue;
      if (!Array.from(track.values).every(Number.isFinite)) {
        supported = false;
        continue;
      }
      if (path.propertyName === "quaternion") {
        if (track.getValueSize() !== 4) {
          supported = false;
          continue;
        }
        rotation = true;
        for (let i = 0; i < track.values.length; i += 4) {
          const value = new T.Quaternion().fromArray(track.values, i);
          if (value.lengthSq() < 1e-12) {
            supported = false;
            break;
          }
          const q = value
            .normalize()
            .multiply(rest.quaternion.clone().normalize().invert());
          const vector = new T.Vector3(q.x, q.y, q.z);
          // A true axial segment has no swing around another axis.
          if (vector.addScaledVector(axis, -vector.dot(axis)).length() > 1e-4) {
            supported = false;
            break;
          }
        }
      } else if (
        path.propertyName === "position" ||
        path.propertyName === "scale"
      ) {
        if (track.getValueSize() !== 3) {
          supported = false;
          continue;
        }
        const values = rest[path.propertyName].toArray();
        if (
          Array.from(track.values).some(
            (v, i) => Math.abs(v - values[i % 3]) > 1e-4,
          )
        )
          supported = false;
      } else supported = false;
    }
    if (!rotation || !supported) continue;
    const candidates = b.joints
      .filter((j) => {
        if (
          (targetRole && targetRole !== j) ||
          !weighted.has(j.bone) ||
          j.key.startsWith("unmapped:") ||
          (target.userData.rigSemanticKeys?.has(j.bone) &&
            target.userData.rigSemanticKeys.get(j.bone) !== role) ||
          existing.some((p) => p.target === j) ||
          Object.values(target.userData.bones).includes(j.bone)
        )
          return false;
        let node: T.Object3D | null = j.bone;
        let childOnChain: T.Object3D | undefined;
        while (node && node !== receivingFore) {
          if (
            node === receivingHand ||
            Object.values(target.userData.bones).includes(node)
          )
            return false;
          // A leaf on one auxiliary chain, never another anatomical branch.
          if (
            node.children.some(
              (child) => child instanceof T.Bone && child !== childOnChain,
            )
          )
            return false;
          childOnChain = node;
          node = node.parent;
        }
        if (
          node !== receivingFore ||
          j.bone.children.some((child) => child instanceof T.Bone)
        )
          return false;
        const at = location(j, targetFore, targetAxis, targetLength);
        return at.fraction >= 0.2 && at.fraction <= 0.9 && at.distance <= 0.01;
      })
      .map((j) => ({
        joint: j,
        error: Math.abs(
          location(j, targetFore, targetAxis, targetLength).fraction -
            where.fraction,
        ),
      }))
      .sort((x, y) => x.error - y.error);
    if (
      !candidates.length ||
      candidates[0].error > 0.25 ||
      (candidates[1] && candidates[1].error - candidates[0].error < 0.05)
    )
      continue;
    result.push({ source: roll, target: candidates[0].joint });
  }
  return result;
}
