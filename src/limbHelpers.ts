import * as T from "three";

type Joint = {
  bone: T.Bone;
  key: string;
  bindPoint: T.Vector3;
};

const SEGMENTS = [
  ["leftArm", "leftForearm"],
  ["leftForearm", "leftHand"],
  ["rightArm", "rightForearm"],
  ["rightForearm", "rightHand"],
  ["leftLeg", "leftShin"],
  ["leftShin", "leftFoot"],
  ["rightLeg", "rightShin"],
  ["rightShin", "rightFoot"],
] as const;

function contains(parent: T.Object3D, child: T.Object3D) {
  for (let node: T.Object3D | null = child; node; node = node.parent)
    if (node === parent) return true;
  return false;
}

/** Auxiliary bones of one limb segment: below its start joint, off the path to
 * the next joint, close to the segment axis. Located by fraction along it. */
function helpers<J extends Joint>(
  group: T.Group,
  joints: J[],
  start: string,
  end: string,
  usable: (joint: J) => boolean,
) {
  const bones = group.userData.bones as Record<string, T.Bone>;
  const a = bones[start],
    b = bones[end];
  if (!a || !b || !contains(a, b)) return [];
  const from = joints.find((j) => j.bone === a),
    to = joints.find((j) => j.bone === b);
  if (!from || !to) return [];
  const axis = to.bindPoint.clone().sub(from.bindPoint);
  const length = axis.length();
  if (!(length > 1e-6)) return [];
  axis.divideScalar(length);
  const anatomical = new Set(Object.values(bones));
  return joints.flatMap((joint) => {
    const bone = joint.bone;
    if (
      anatomical.has(bone) ||
      !contains(a, bone) ||
      contains(bone, b) ||
      contains(b, bone) ||
      joint.key.startsWith("unmapped:") ||
      group.userData.rigSemanticKeys?.has(bone) ||
      !usable(joint)
    )
      return [];
    // Only the nearest anatomical ancestor counts: a helper of a finger or
    // of another segment is not this segment's helper.
    for (let n = bone.parent; n && n !== a; n = n.parent)
      if (anatomical.has(n as T.Bone)) return [];
    const offset = joint.bindPoint.clone().sub(from.bindPoint);
    const along = offset.dot(axis) / length;
    const across =
      offset.addScaledVector(axis, -along * length).length() / length;
    if (along < -0.05 || along > 1.05 || across > 0.1) return [];
    return [{ joint, at: along }];
  });
}

/** Pair auxiliary limb bones (twist/roll/share helpers) by their measured place
 * on the anatomical segment when names do not match across conventions. Only
 * mutual, unambiguous nearest matches are used; existing pairs win. A helper
 * without a counterpart keeps following its parent as before. */
export function limbHelperPairs<J extends Joint>(
  source: T.Group,
  target: T.Group,
  a: { joints: J[] },
  b: { joints: J[] },
  existing: { source: J; target: J }[],
  weighted: Set<T.Bone>,
) {
  const usedSource = new Set(existing.map((p) => p.source)),
    usedTarget = new Set(existing.map((p) => p.target));
  const result: { source: J; target: J }[] = [];
  for (const [start, end] of SEGMENTS) {
    const sources = helpers(
        source,
        a.joints,
        start,
        end,
        (j) => !usedSource.has(j),
      ),
      targets = helpers(
        target,
        b.joints,
        start,
        end,
        // Weighted helpers only, so unweighted controls are never driven (a
        // receiver without skin has nothing visible to protect).
        (j) => !usedTarget.has(j) && (!weighted.size || weighted.has(j.bone)),
      );
    const nearest = <X extends { at: number }>(at: number, list: X[]) => {
      const sorted = [...list].sort(
        (p, q) => Math.abs(p.at - at) - Math.abs(q.at - at),
      );
      const best = sorted[0],
        second = sorted[1];
      if (!best || Math.abs(best.at - at) > 0.2) return undefined;
      if (second && Math.abs(second.at - at) - Math.abs(best.at - at) < 0.1)
        return undefined;
      return best;
    };
    for (const t of targets) {
      const s = nearest(t.at, sources);
      if (s && nearest(s.at, targets) === t)
        result.push({ source: s.joint, target: t.joint });
    }
  }
  return result;
}
