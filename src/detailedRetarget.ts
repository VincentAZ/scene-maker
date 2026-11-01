import * as T from "three";
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
type Pair = {
  source: Joint;
  target: Joint;
  anchor?: Joint;
  attachment?: T.Vector3;
  targetAnchor?: Joint;
  targetAttachment?: T.Vector3;
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
  const pairs: Pair[] = b.joints.flatMap((t) => {
    const s = a.byKey.get(t.key);
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
  target.userData.motionNotice = report?.unsupported.length
    ? `${report.unsupported.length} animation channels could not be transferred (${report.unsupported
        .slice(0, 3)
        .map((c) => c.channel)
        .join(", ")}). Use the original rig for these channels.`
    : "";
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
  for (const {
    source: a,
    target: b,
    anchor,
    attachment,
    targetAnchor,
    targetAttachment,
  } of plan.pairs) {
    const desired = heading
      .clone()
      .multiply(initialTurn)
      .multiply(inverse)
      .multiply(a.bone.getWorldQuaternion(new T.Quaternion()))
      .multiply(a.neutral.clone().invert())
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
