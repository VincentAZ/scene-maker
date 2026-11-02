import * as T from "three";
import { forearmRollPairs } from "./forearmRoll";
import { limbHelperPairs } from "./limbHelpers";
import { inferDetailRoles } from "./rigDetailRoles";

const normalized = (name: string) =>
  name
    .split(/[|:]/)
    .at(-1)!
    .replace(/^mixamorig[_:]?/i, "")
    .replace(/[_\s-]/g, "")
    .toLowerCase();
/** Semantic names plus conservative hierarchy matching below. Twist/share/facial
 * joints are never guessed from substring matches. */
function jointKey(bone: T.Bone, canonical: Record<string, T.Bone>) {
  const known = Object.entries(canonical).find(
    ([, node]) => node === bone,
  )?.[0];
  if (known) return known.toLowerCase();
  const name = normalized(bone.name);
  const extra: Record<string, string> = {
    ccbasewaist: "waist",
    ccbasespine02: "chest",
    spine1: "chest",
    ccbasenecktwist01: "neck",
    neck: "neck",
    ccbaselclavicle: "leftshoulder",
    ccbaserclavicle: "rightshoulder",
    ccbaseltoebase: "lefttoebase",
    ccbasertoebase: "righttoebase",
  };
  if (extra[name]) return extra[name];
  const finger = name.match(
    /^ccbase([lr])(thumb|index|mid|ring|pinky)([123])$/,
  );
  if (finger)
    return `${finger[1] === "l" ? "left" : "right"}hand${finger[2] === "mid" ? "middle" : finger[2]}${finger[3]}`;
  return name;
}
type Joint = {
  bone: T.Bone;
  key: string;
  position: T.Vector3;
  bindPoint: T.Vector3;
  bindRotation: T.Quaternion;
  neutral: T.Quaternion;
};
type Morph = { mesh: T.Mesh; weights: number[] };
type DetailRig = {
  joints: Joint[];
  byKey: Map<string, Joint>;
  morphs: Morph[];
  rest: Map<
    T.Object3D,
    { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3 }
  >;
};
const rigs = new WeakMap<T.Group, DetailRig>();
export function captureDetailBind(group: T.Group) {
  const joints: Joint[] = [],
    morphs: Morph[] = [];
  group.updateWorldMatrix(true, true);
  const inverse = group.getWorldQuaternion(new T.Quaternion()).invert();
  const rest: DetailRig["rest"] = new Map();
  const canonical = group.userData.bones as Record<string, T.Bone>;
  group.traverse((node) => {
    rest.set(node, {
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
    });
    if (node instanceof T.Bone)
      joints.push({
        bone: node,
        key:
          (
            group.userData.rigSemanticKeys as Map<T.Bone, string> | undefined
          )?.get(node) ??
          ((group.userData.unmappedRigBones as Set<T.Bone> | undefined)?.has(
            node,
          ) ||
          (group.userData.disabledRigRoles as Set<string> | undefined)?.has(
            jointKey(node, canonical),
          )
            ? `unmapped:${node.uuid}`
            : jointKey(node, canonical)),
        position: node.position.clone(),
        bindPoint: group.worldToLocal(node.getWorldPosition(new T.Vector3())),
        bindRotation: inverse
          .clone()
          .multiply(node.getWorldQuaternion(new T.Quaternion())),
        neutral: new T.Quaternion(),
      });
    if (node instanceof T.Mesh && node.morphTargetInfluences)
      morphs.push({ mesh: node, weights: [...node.morphTargetInfluences] });
  });
  inferDetailRoles(
    joints,
    canonical,
    group.userData.rigSemanticKeys,
    group.userData.unmappedRigBones,
    group.userData.disabledRigRoles,
  );
  // Ambiguous names must not silently select the first bone.
  const byKey = new Map(
    joints
      .filter((j) => joints.filter((k) => k.key === j.key).length === 1)
      .map((j) => [j.key, j]),
  );
  rigs.set(group, { joints, byKey, morphs, rest });
}
export function captureDetailNeutral(group: T.Group) {
  const inverse = group.getWorldQuaternion(new T.Quaternion()).invert();
  for (const joint of rigs.get(group)?.joints || [])
    joint.neutral
      .copy(inverse)
      .multiply(joint.bone.getWorldQuaternion(new T.Quaternion()));
}
export function restoreDetailMorphs(group: T.Group) {
  for (const { mesh, weights } of rigs.get(group)?.morphs || [])
    mesh.morphTargetInfluences!.splice(0, weights.length, ...weights);
}
function ancestor(child: T.Object3D, parent: T.Object3D) {
  for (let p = child.parent; p; p = p.parent) if (p === parent) return true;
  return false;
}
function chestBranch(group: T.Group, bone: T.Bone) {
  const { leftArm, rightArm, head } = group.userData.bones;
  if (!leftArm || !rightArm || !head) return false;
  let branch = leftArm.parent;
  while (branch && !ancestor(rightArm, branch)) branch = branch.parent;
  return branch === bone && ancestor(head, bone);
}
/** Bones from just above the hips up to the common arm/head branch, or
 * undefined when that branch is not a simple descendant chain of the hips, a
 * chain bone is excluded, or a torso role is disabled or ambiguous (the user's
 * choice and conservative matching win). Explicit role assignments only say
 * which bone is which, so they do not prevent following the chain. */
function torsoChain(group: T.Group, rig: DetailRig) {
  const { hips, leftArm, rightArm, head } = group.userData.bones ?? {};
  if (!hips || !leftArm || !rightArm || !head) return;
  let branch = leftArm.parent;
  while (branch && !ancestor(rightArm, branch)) branch = branch.parent;
  if (!(branch instanceof T.Bone) || !ancestor(head, branch)) return;
  const chain: Joint[] = [];
  for (
    let node: T.Object3D | null = branch;
    node !== hips;
    node = node.parent
  ) {
    if (!node) return;
    if (!(node instanceof T.Bone)) continue;
    const joint = rig.joints.find((j) => j.bone === node);
    if (!joint || joint.key.startsWith("unmapped:")) return;
    chain.unshift(joint);
  }
  const base = rig.joints.find((j) => j.bone === hips);
  if (!base || !chain.length) return;
  // A role listed without an assigned bone is disabled (the listed set also
  // holds valid explicit assignments, which are constraints, not opt-outs).
  const assigned = new Set(
    (
      group.userData.rigSemanticKeys as Map<T.Bone, string> | undefined
    )?.values(),
  );
  if (
    ["waist", "spine", "chest", "upperchest"].some(
      (role) =>
        ((group.userData.disabledRigRoles as Set<string> | undefined)?.has(
          role,
        ) &&
          !assigned.has(role)) ||
        rig.joints.filter((j) => j.key === role).length > 1,
    )
  )
    return;
  // Normalized height of each joint origin along the bind chain from the hips.
  const points = [base, ...chain].map((j) => j.bindPoint);
  const lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
  const total = lengths.reduce((s, l) => s + l, 0);
  if (!(total > 0)) return;
  let run = 0;
  return {
    base,
    chain: chain.map((joint, i) => ({
      joint,
      at: (run += lengths[i]) / total,
    })),
  };
}
type Pair = {
  source: Joint;
  target: Joint;
  anchor?: Joint;
  attachment?: T.Vector3;
  targetAnchor?: Joint;
  targetAttachment?: T.Vector3;
  /** Torso chains of different layout: rotation interpolated toward `other`. */
  blend?: { other: Joint; t: number };
};
type MorphPair = {
  source: T.Mesh;
  sourceIndex: number;
  target: T.Mesh;
  targetIndex: number;
};
export type RetargetReport = {
  matchedJoints: number;
  transferred: string[];
  composed: { channel: string; target: string }[];
  unchanged: string[];
  unsupported: { channel: string; reason: string }[];
};
type Plan = { pairs: Pair[]; morphs: MorphPair[]; report: RetargetReport };
const plans = new WeakMap<
  T.Group,
  WeakMap<T.Group, Map<T.AnimationClip, Plan>>
>();
function planFor(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
): Plan | undefined {
  if (!rigs.has(target) && target.userData.bones) {
    captureDetailBind(target);
    captureDetailNeutral(target);
  }
  const a = rigs.get(source),
    b = rigs.get(target);
  if (!a || !b) return;
  let targets = plans.get(source);
  if (!targets) plans.set(source, (targets = new WeakMap()));
  let clips = targets.get(target);
  if (!clips) targets.set(target, (clips = new Map()));
  const cached = clips.get(clip);
  if (cached) return cached;
  const hips = source.userData.bones.hips as T.Bone;
  const detachedSource = source.userData.detachedJointAnchors as
    Map<T.Bone, T.Bone> | undefined;
  const detachedTarget = target.userData.detachedJointAnchors as
    Map<T.Bone, T.Bone> | undefined;
  const sourceTorso = torsoChain(source, a),
    targetTorso = torsoChain(target, b);
  const lowerChest = a.byKey.get("chest"),
    upperChest = a.byKey.get("upperchest"),
    targetChest = b.byKey.get("chest");
  // Match the anatomical end of the torso when the receiving chest has no
  // separate upper segment. Otherwise its skin loses the upper bend while
  // the head and arms still receive that bend through their world rotations.
  // Preserve distinct segments, explicit exclusions and ambiguous topology.
  const combinedChest =
    !(sourceTorso && targetTorso) &&
    lowerChest &&
    upperChest &&
    targetChest &&
    !b.joints.some((joint) => joint.key === "upperchest") &&
    !target.userData.disabledRigRoles?.has("upperchest") &&
    ancestor(upperChest.bone, lowerChest.bone) &&
    chestBranch(source, upperChest.bone) &&
    chestBranch(target, targetChest.bone);
  // A single receiving neck represents the source chain’s endpoint. Rigs
  // with two neck segments retain independent motion at both segments.
  const lowerNeck = a.byKey.get("neck"),
    upperNeck = a.byKey.get("upperneck"),
    targetNeck = b.byKey.get("neck");
  const combinedNeck =
    lowerNeck &&
    upperNeck &&
    targetNeck &&
    !b.joints.some((joint) => joint.key === "upperneck") &&
    !target.userData.disabledRigRoles?.has("upperneck") &&
    upperNeck.bone.parent === lowerNeck.bone &&
    source.userData.bones.head.parent === upperNeck.bone &&
    target.userData.bones.head.parent === targetNeck.bone &&
    lowerNeck.bone.children.filter((child) => child instanceof T.Bone)
      .length === 1 &&
    upperNeck.bone.children.filter((child) => child instanceof T.Bone)
      .length === 1 &&
    targetNeck.bone.children.filter((child) => child instanceof T.Bone)
      .length === 1;
  const pairs: Pair[] = b.joints.flatMap((t) => {
    const s =
      combinedChest && t === targetChest
        ? upperChest
        : combinedNeck && t === targetNeck
          ? upperNeck
          : a.byKey.get(t.key);
    return s &&
      b.byKey.has(t.key) &&
      (s.bone === hips ||
        ancestor(s.bone, hips) ||
        [...(detachedSource?.keys() || [])].some(
          (root) => root === s.bone || ancestor(s.bone, root),
        ))
      ? [{ source: s, target: t }]
      : [];
  });
  pairs.push(...forearmRollPairs(source, target, clip, a, b, pairs));
  const weighted = new Set<T.Bone>();
  target.traverse((node) => {
    if (!(node instanceof T.SkinnedMesh)) return;
    const indices = node.geometry.getAttribute("skinIndex"),
      weights = node.geometry.getAttribute("skinWeight");
    if (!indices || !weights) return;
    for (let i = 0; i < indices.count; i++)
      for (let k = 0; k < weights.itemSize; k++)
        if (weights.getComponent(i, k) > 0)
          weighted.add(node.skeleton.bones[indices.getComponent(i, k)]);
  });
  pairs.push(...limbHelperPairs(source, target, a, b, pairs, weighted));
  // Torso chains differ between conventions (Waist/Spine01/Spine02,
  // Spine/Spine1/Spine2, lowerback/upperback/thorax) and names disagree on
  // which segment is "spine". Identically named torso bones (same convention)
  // stay exact anchors; every other receiving torso joint follows the source
  // chain at the same normalized height between anchors. The arm/head branch
  // always maps to the source branch.
  const exactTorso = new Set<T.Bone>();
  if (sourceTorso && targetTorso) {
    const knots = [{ joint: sourceTorso.base, at: 0 }, ...sourceTorso.chain];
    // Exact names anchor only within one convention: at least one torso bone
    // that is not a canonical role label must match by its raw name. Role
    // labels ("spine") and prefix-stripped names do not prove the segments
    // agree (Mixamo "Spine" sits where Character Creator has "Waist").
    const canonicalSource = new Set(Object.values(source.userData.bones)),
      canonicalTarget = new Set(Object.values(target.userData.bones));
    const sameName = targetTorso.chain.map(({ joint: t, at }) => ({
      at,
      t,
      match: sourceTorso.chain.find(
        ({ joint }) => joint.bone.name === t.bone.name,
      ),
    }));
    const sameConvention = sameName.some(
      ({ t, match }) =>
        match &&
        !canonicalTarget.has(t.bone) &&
        !canonicalSource.has(match.joint.bone),
    );
    const anchors: [number, number][] = [[0, 0]];
    if (sameConvention)
      for (const { at, match } of sameName)
        // The branch carries arms and head: it always maps to the source branch.
        if (
          match &&
          at < 1 &&
          match.at < 1 &&
          match.at > anchors.at(-1)![0] &&
          at > anchors.at(-1)![1]
        )
          anchors.push([match.at, at]);
    anchors.push([1, 1]);
    const sourceAt = (at: number) => {
      let i = 0;
      while (i + 2 < anchors.length && anchors[i + 1][1] < at) i++;
      const [u0, v0] = anchors[i],
        [u1, v1] = anchors[i + 1];
      return v1 > v0 ? u0 + ((u1 - u0) * (at - v0)) / (v1 - v0) : u1;
    };
    const inChain = new Set(targetTorso.chain.map(({ joint }) => joint.bone));
    for (let i = pairs.length - 1; i >= 0; i--)
      if (inChain.has(pairs[i].target.bone)) pairs.splice(i, 1);
    for (const { joint: t, at: height } of targetTorso.chain) {
      const at = sourceAt(height);
      let i = 0;
      while (i + 2 < knots.length && knots[i + 1].at < at) i++;
      const lo = knots[i],
        hi = knots[i + 1];
      const f = T.MathUtils.clamp((at - lo.at) / (hi.at - lo.at), 0, 1);
      const near = f < 0.5 ? lo : hi;
      if (Math.abs(near.at - at) < 1e-3) {
        exactTorso.add(near.joint.bone);
        pairs.push({ source: near.joint, target: t });
      } else
        pairs.push({
          source: lo.joint,
          target: t,
          blend: { other: hi.joint, t: f },
        });
    }
  }
  for (const pair of pairs) {
    if (
      detachedSource?.has(pair.source.bone) ||
      detachedTarget?.has(pair.target.bone)
    ) {
      const parentKeys: Record<string, string> = {
        leftfoot: "leftshin",
        rightfoot: "rightshin",
        lefthand: "leftforearm",
        righthand: "rightforearm",
      };
      const anchor = pairs.find(
        (p) => p.source.key === parentKeys[pair.source.key],
      );
      if (anchor && !ancestor(anchor.target.bone, pair.target.bone)) {
        pair.anchor = anchor.source;
        pair.attachment = pair.source.bindPoint
          .clone()
          .sub(anchor.source.bindPoint)
          .applyQuaternion(anchor.source.bindRotation.clone().invert());
        pair.targetAnchor = anchor.target;
        pair.targetAttachment = pair.target.bindPoint
          .clone()
          .sub(anchor.target.bindPoint)
          .applyQuaternion(anchor.target.bindRotation.clone().invert());
        continue;
      }
    }
    for (let parent = pair.source.bone.parent; parent; parent = parent.parent) {
      const anchor = pairs.find(
        (p) =>
          p.source.bone === parent && ancestor(pair.target.bone, p.target.bone),
      );
      if (!anchor) continue;
      pair.anchor = anchor.source;
      pair.attachment = pair.source.bindPoint
        .clone()
        .sub(anchor.source.bindPoint)
        .applyQuaternion(anchor.source.bindRotation.clone().invert());
      break;
    }
  }
  // Detached skin joints may precede the hips in the imported tree. Their
  // anatomical anchors, and every real target parent, must be solved first.
  const ordered: Pair[] = [],
    visited = new Set<Pair>();
  const byTarget = new Map(pairs.map((pair) => [pair.target.bone, pair]));
  const visit = (pair: Pair) => {
    if (visited.has(pair)) return;
    visited.add(pair);
    for (let parent = pair.target.bone.parent; parent; parent = parent.parent) {
      const dependency = byTarget.get(parent as T.Bone);
      if (dependency) {
        visit(dependency);
        break;
      }
    }
    const anchor = pair.targetAnchor && byTarget.get(pair.targetAnchor.bone);
    if (anchor) visit(anchor);
    ordered.push(pair);
  };
  pairs.forEach(visit);
  const morphs: MorphPair[] = [];
  const report: RetargetReport = {
    matchedJoints: pairs.length,
    transferred: [],
    composed: [],
    unchanged: [],
    unsupported: [],
  };
  const root = (source.userData.mixer as T.AnimationMixer).getRoot();
  for (const track of clip.tracks) {
    const path = T.PropertyBinding.parseTrackName(track.name);
    const node = T.PropertyBinding.findNode(root, path.nodeName);
    const bind = node instanceof T.Object3D ? a.rest.get(node) : undefined;
    const property = path.propertyName as "position" | "quaternion" | "scale";
    const atBind =
      bind &&
      ["position", "quaternion", "scale"].includes(property) &&
      (() => {
        const size = track.getValueSize(),
          values = bind[property].toArray();
        if (property === "quaternion") {
          for (let i = 0; i < track.values.length; i += size)
            if (
              new T.Quaternion()
                .fromArray(track.values, i)
                .angleTo(bind.quaternion) > 1e-3
            )
              return false;
          return true;
        }
        return Array.from(track.values).every(
          (v, i) => Math.abs(v - values[i % size]) < 1e-4,
        );
      })();
    if (
      path.propertyName === "morphTargetInfluences" &&
      node instanceof T.Mesh
    ) {
      const dictionary = node.morphTargetDictionary || {};
      let count = 0;
      for (const [name, index] of Object.entries(dictionary)) {
        if (
          path.propertyIndex !== undefined &&
          String(index) !== path.propertyIndex &&
          name !== path.propertyIndex
        )
          continue;
        const candidates = b.morphs.filter(
          ({ mesh }) => mesh.morphTargetDictionary?.[name] !== undefined,
        );
        const sameMesh = candidates.filter(
          ({ mesh }) => normalized(mesh.name) === normalized(node.name),
        );
        // With different mesh layouts, only unambiguous source names are safe.
        const sourceCount = a.morphs.filter(
          ({ mesh }) => mesh.morphTargetDictionary?.[name] !== undefined,
        ).length;
        const matches = sameMesh.length
          ? sameMesh
          : sourceCount === 1
            ? candidates
            : [];
        for (const { mesh } of matches)
          morphs.push({
            source: node,
            sourceIndex: index,
            target: mesh,
            targetIndex: mesh.morphTargetDictionary![name],
          });
        if (matches.length) count++;
        else
          report.unsupported.push({
            channel: `${track.name}[${name}]`,
            reason: "No unambiguous named target morph",
          });
      }
      if (count) report.transferred.push(track.name);
      if (!Object.keys(dictionary).length)
        report.unsupported.push({
          channel: track.name,
          reason: "Unnamed morph weights cannot be safely matched",
        });
    } else if (
      ((combinedChest && node === lowerChest.bone) ||
        (combinedNeck && node === lowerNeck.bone)) &&
      ["position", "quaternion"].includes(path.propertyName)
    ) {
      report.composed.push({
        channel: track.name,
        target: (node === lowerNeck?.bone ? targetNeck! : targetChest!).bone
          .name,
      });
    } else if (
      sourceTorso &&
      targetTorso &&
      node instanceof T.Bone &&
      sourceTorso.chain.some(({ joint }) => joint.bone === node) &&
      !exactTorso.has(node) &&
      ["position", "quaternion"].includes(path.propertyName)
    ) {
      // Represented by interpolation onto a receiving torso of another layout.
      const at = sourceTorso.chain.find(({ joint }) => joint.bone === node)!.at;
      const nearest = targetTorso.chain.reduce((best, c) =>
        Math.abs(c.at - at) < Math.abs(best.at - at) ? c : best,
      );
      report.composed.push({
        channel: track.name,
        target: nearest.joint.bone.name,
      });
    } else if (
      node instanceof T.Bone &&
      pairs.some((p) => p.source.bone === node) &&
      ["position", "quaternion", "scale"].includes(path.propertyName)
    ) {
      // Scale is deliberately not transferred. Ignore constant exporter noise,
      // but disclose real animated scale rather than claiming to preserve it.
      if (path.propertyName === "scale") {
        if (atBind) report.unchanged.push(track.name);
        else
          report.unsupported.push({
            channel: track.name,
            reason: "Non-bind scale is not retargeted",
          });
      } else report.transferred.push(track.name);
    } else if (
      node instanceof T.Object3D &&
      (node === hips || ancestor(hips, node)) &&
      ["position", "quaternion"].includes(path.propertyName)
    ) {
      report.transferred.push(track.name); // composed into body travel/world rotations
    } else {
      if (atBind) report.unchanged.push(track.name);
      else
        report.unsupported.push({
          channel: track.name,
          reason:
            "No supported target joint/property; retained on the original only",
        });
    }
  }
  const result = { pairs: ordered, morphs, report };
  clips.set(clip, result);
  return result;
}
export function retargetReport(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
) {
  return planFor(source, target, clip)?.report;
}
export function applyRetargetNotice(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
) {
  const report = retargetReport(source, target, clip);
  target.userData.retargetReport = report;
  const unsupported = report?.unsupported.length
    ? `${report.unsupported.length} animation channels could not be transferred (${report.unsupported
        .slice(0, 3)
        .map((c) => c.channel)
        .join(", ")}). Use the original rig for these channels.`
    : "";
  target.userData.motionNotice = [
    unsupported,
    ...(["chest", "neck"] as const).map((role) =>
      report?.composed.some(
        ({ target: name }) =>
          name === rigs.get(target)?.byKey.get(role)?.bone.name,
      )
        ? `Upper and lower ${role} motion share one ${role} joint on this character.`
        : "",
    ),
  ]
    .filter(Boolean)
    .join(" ");
}
/** Full hierarchy solver. World orientation deltas preserve different bind axes;
 * translations preserve target proportions rather than copying source lengths. */
export function applyDetailedTransfer(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
  initialTurn: T.Quaternion,
  heightRatio: number,
) {
  const plan = planFor(source, target, clip);
  if (!plan) return false;
  const inverse = source.getWorldQuaternion(new T.Quaternion()).invert();
  const heading = target.getWorldQuaternion(new T.Quaternion());
  const targetScale = target.getWorldScale(new T.Vector3()).x;
  const motion = (joint: Joint) =>
    joint.bone
      .getWorldQuaternion(new T.Quaternion())
      .multiply(joint.neutral.clone().invert());
  for (const {
    source: a,
    target: b,
    anchor,
    attachment,
    targetAnchor,
    targetAttachment,
    blend,
  } of plan.pairs) {
    const rotation = blend
      ? motion(a).slerp(motion(blend.other), blend.t)
      : motion(a);
    const desired = heading
      .clone()
      .multiply(initialTurn)
      .multiply(inverse)
      .multiply(rotation)
      .multiply(b.neutral);
    // Local translation deltas only: never copy the source's bind proportions.
    // Hip translation has already been extracted onto the character group.
    if (a.bone !== source.userData.bones.hips) {
      let delta: T.Vector3;
      if (anchor && attachment) {
        const rotation = inverse
          .clone()
          .multiply(anchor.bone.getWorldQuaternion(new T.Quaternion()));
        const offset = source
          .worldToLocal(a.bone.getWorldPosition(new T.Vector3()))
          .sub(
            source.worldToLocal(anchor.bone.getWorldPosition(new T.Vector3())),
          )
          .applyQuaternion(rotation.clone().invert());
        delta = offset.sub(attachment).applyQuaternion(rotation);
      } else {
        const origin = a.bone.parent!.localToWorld(new T.Vector3());
        delta = a.bone
          .parent!.localToWorld(a.bone.position.clone().sub(a.position))
          .sub(origin)
          .applyQuaternion(inverse)
          .divideScalar(source.getWorldScale(new T.Vector3()).x);
      }
      const worldDelta = delta
        .applyQuaternion(initialTurn)
        .multiplyScalar(heightRatio * targetScale)
        .applyQuaternion(heading);
      if (targetAnchor && targetAttachment) {
        const point = targetAttachment
          .clone()
          .multiplyScalar(targetScale)
          .applyQuaternion(
            targetAnchor.bone.getWorldQuaternion(new T.Quaternion()),
          )
          .add(targetAnchor.bone.getWorldPosition(new T.Vector3()))
          .add(worldDelta);
        b.bone.position.copy(b.bone.parent!.worldToLocal(point));
      } else {
        const parentOrigin = b.bone.parent!.getWorldPosition(new T.Vector3());
        b.bone.position
          .copy(b.position)
          .add(
            b.bone
              .parent!.worldToLocal(parentOrigin.clone().add(worldDelta))
              .sub(b.bone.parent!.worldToLocal(parentOrigin)),
          );
      }
    }
    b.bone.quaternion
      .copy(
        b.bone
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(desired),
      )
      .normalize();
    b.bone.updateWorldMatrix(true, false);
  }
  for (const pair of plan.morphs)
    pair.target.morphTargetInfluences![pair.targetIndex] =
      pair.source.morphTargetInfluences![pair.sourceIndex];
  applyRetargetNotice(source, target, clip);
  return true;
}
