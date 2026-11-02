import * as T from "three";
import { bodyJointRoles, detailJointRoles } from "../shared/rigMapping";

const anatomy = new Set(
  [...bodyJointRoles, ...detailJointRoles].map((role) => role.toLowerCase()),
);
const contains = (parent: T.Object3D, child: T.Object3D) => {
  for (let node: T.Object3D | null = child; node; node = node.parent)
    if (node === parent) return true;
  return false;
};

/** Conservative anatomical fallback from already identified body anchors.
 * The common arm/head branch identifies a chest; a single intervening bone
 * identifies a shoulder or neck. A known lower neck followed by one unbranched
 * segment identifies an upper neck; other multi-bone branches remain ambiguous.
 * Explicit mappings, disabled roles, and existing anatomical names win. */
export function inferDetailRoles(
  joints: { bone: T.Bone; key: string }[],
  canonical: Record<string, T.Bone>,
  explicit: Map<T.Bone, string> = new Map(),
  excluded: Set<T.Bone> = new Set(),
  disabled: Set<string> = new Set(),
) {
  const { spine, head, leftArm, rightArm } = canonical;
  if (!spine || !head || !leftArm || !rightArm) return;
  let branch = leftArm.parent;
  while (branch && !contains(branch, rightArm)) branch = branch.parent;
  if (
    !(branch instanceof T.Bone) ||
    !contains(spine, branch) ||
    !contains(branch, head)
  )
    return;
  const assign = (role: string, bone: T.Bone) => {
    if (
      disabled.has(role) ||
      joints.some((joint) => joint.key === role) ||
      explicit.has(bone) ||
      excluded.has(bone) ||
      Object.values(canonical).includes(bone)
    )
      return;
    const joint = joints.find((joint) => joint.bone === bone);
    if (joint && !joint.key.startsWith("unmapped:") && !anatomy.has(joint.key))
      joint.key = role;
  };
  const chests = joints.filter((joint) => joint.key === "chest");
  if (!chests.length) assign("chest", branch);
  else if (
    chests.length === 1 &&
    chests[0].bone !== branch &&
    contains(chests[0].bone, branch)
  )
    assign("upperchest", branch);
  const intermediate = (end: T.Bone) => {
    const bones: T.Bone[] = [];
    for (let node = end.parent; node && node !== branch; node = node.parent)
      if (node instanceof T.Bone) bones.push(node);
    return bones;
  };
  for (const [role, end] of [
    ["leftshoulder", leftArm],
    ["rightshoulder", rightArm],
    ["neck", head],
  ] as const) {
    const chain = intermediate(end);
    if (chain.length === 1) assign(role, chain[0]);
  }
  const necks = joints.filter((joint) => joint.key === "neck");
  const upper = head.parent;
  if (
    necks.length === 1 &&
    upper instanceof T.Bone &&
    upper.parent === necks[0].bone &&
    necks[0].bone.children.filter((child) => child instanceof T.Bone).length ===
      1 &&
    upper.children.filter((child) => child instanceof T.Bone).length === 1
  )
    assign("upperneck", upper);
}
