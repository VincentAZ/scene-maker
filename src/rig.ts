import * as T from "three";
import type { RigMapping } from "../shared/rigMapping";
import { untitledAnimationName } from "../shared/animation";
import { resolveRigMapping } from "./rigMapping";
import {
  captureDetailBind,
  captureDetailNeutral,
  restoreDetailMorphs,
  applyDetailedTransfer,
  applyRetargetNotice,
} from "./detailedRetarget";
import { boneNames } from "../shared/scene";
import { configureRigContacts, type RigContacts } from "./ik";
import { captureFootSurfaces, transferFootClearance } from "./footSurface";

type BoneName = (typeof boneNames)[number];
type Transform = {
  object: T.Object3D;
  position: T.Vector3;
  rotation: T.Quaternion;
  scale: T.Vector3;
};
type RootMotion = {
  start: T.Vector3;
  delta: T.Vector3;
  startHeading: number;
  heading: number;
};
type HumanoidRig = {
  bind: Transform[];
  neutralWorld: Partial<Record<BoneName, T.Quaternion>>;
  compatible: boolean;
  bindRoot: T.Vector3;
  bindHips: T.Vector3;
  bindFacing: T.Quaternion;
  roots: Map<T.AnimationClip, Map<string, RootMotion>>;
  attachmentRest: Partial<Record<BoneName, T.Vector3>>;
  detachedRest: {
    bone: T.Bone;
    anchor: T.Bone;
    position: T.Vector3;
    rotation: T.Quaternion;
  }[];
};
const rigs = new WeakMap<T.Group, HumanoidRig>();
const parents: Partial<Record<BoneName, BoneName>> = {
  spine: "hips",
  head: "spine",
  leftArm: "spine",
  leftForearm: "leftArm",
  rightArm: "spine",
  rightForearm: "rightArm",
  leftLeg: "hips",
  leftShin: "leftLeg",
  rightLeg: "hips",
  rightShin: "rightLeg",
};
const aliases: Record<string, string> = {
  hips: "hips",
  pelvis: "hips",
  spine: "spine",
  head: "head",
  leftarm: "leftArm",
  leftupperarm: "leftArm",
  leftforearm: "leftForearm",
  leftlowerarm: "leftForearm",
  lefthand: "leftHand",
  rightarm: "rightArm",
  rightupperarm: "rightArm",
  rightforearm: "rightForearm",
  rightlowerarm: "rightForearm",
  righthand: "rightHand",
  leftupleg: "leftLeg",
  leftthigh: "leftLeg",
  leftupperleg: "leftLeg",
  leftlowerleg: "leftShin",
  leftleg: "leftShin",
  leftcalf: "leftShin",
  leftfoot: "leftFoot",
  rightupleg: "rightLeg",
  rightthigh: "rightLeg",
  rightupperleg: "rightLeg",
  rightlowerleg: "rightShin",
  rightleg: "rightShin",
  rightcalf: "rightShin",
  rightfoot: "rightFoot",
  // Native ActorCore / Character Creator exports. Hip is the common ancestor
  // of the separate Pelvis (legs) and Waist (torso) branches; mapping Pelvis
  // instead would detach the torso from canonical hip rotations. Keep these
  // exact: UpperarmTwist, ForearmTwist, CalfTwist and ShareBone are not joints.
  ccbasehip: "hips",
  ccbasespine01: "spine",
  ccbasehead: "head",
  ccbaselupperarm: "leftArm",
  ccbaselforearm: "leftForearm",
  ccbaselhand: "leftHand",
  ccbaserupperarm: "rightArm",
  ccbaserforearm: "rightForearm",
  ccbaserhand: "rightHand",
  ccbaselthigh: "leftLeg",
  ccbaselcalf: "leftShin",
  ccbaselfoot: "leftFoot",
  ccbaserthigh: "rightLeg",
  ccbasercalf: "rightShin",
  ccbaserfoot: "rightFoot",
};
/** Exact anatomical tokens only. Suffix helpers (twist/IK/end) never match. */
function canonicalBoneName(name: string): string | undefined {
  const short = name
    .split(/[|:]/)
    .at(-1)!
    .replace(/^mixamorig[_:]?/i, "");
  if (boneNames.includes(short as BoneName)) return short;
  const direct = aliases[short.replace(/[_\s-]/g, "").toLowerCase()];
  if (direct) return direct;
  const suffix = short.match(
    /^(upperarm|arm|forearm|lowerarm|hand|thigh|upperleg|upleg|calf|shin|lowerleg|foot)[_. -]?(l|r|left|right)$/i,
  );
  const prefix = short.match(
    /^(l|r|left|right)[_. -]?(upperarm|arm|forearm|lowerarm|hand|thigh|upperleg|upleg|calf|shin|lowerleg|foot)$/i,
  );
  const sided = suffix || (prefix && [short, prefix[2], prefix[1]]);
  if (!sided) return;
  const side = /^(l|left)$/i.test(sided[2]) ? "left" : "right";
  const part: Record<string, string> = {
    arm: "Arm",
    upperarm: "Arm",
    forearm: "Forearm",
    lowerarm: "Forearm",
    hand: "Hand",
    thigh: "Leg",
    upperleg: "Leg",
    upleg: "Leg",
    calf: "Shin",
    shin: "Shin",
    lowerleg: "Shin",
    foot: "Foot",
  };
  return side + part[sided[1].toLowerCase()];
}

function restore(rig: HumanoidRig) {
  for (const t of rig.bind) {
    t.object.position.copy(t.position);
    t.object.quaternion.copy(t.rotation);
    t.object.scale.copy(t.scale);
  }
}
function followDetachedJoints(data: HumanoidRig) {
  for (const {
    bone,
    anchor,
    position: offset,
    rotation,
  } of data.detachedRest) {
    bone.position.copy(
      bone.parent!.worldToLocal(anchor.localToWorld(offset.clone())),
    );
    bone.quaternion.copy(
      bone
        .parent!.getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(anchor.getWorldQuaternion(new T.Quaternion()))
        .multiply(rotation),
    );
    bone.updateWorldMatrix(true, true);
  }
}
function hasAncestor(child: T.Object3D, ancestor: T.Object3D) {
  for (let p = child.parent; p; p = p.parent) if (p === ancestor) return true;
  return false;
}
const position = (object: T.Object3D) =>
  object.getWorldPosition(new T.Vector3());
function pointAtDirection(
  bone: T.Bone,
  endpoint: T.Vector3,
  direction: T.Vector3,
) {
  const from = endpoint.sub(position(bone)).normalize();
  const world = bone
    .getWorldQuaternion(new T.Quaternion())
    .premultiply(new T.Quaternion().setFromUnitVectors(from, direction));
  bone.quaternion.copy(
    bone
      .parent!.getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(world),
  );
  bone.updateWorldMatrix(true, true);
}
function rootPoint(group: T.Group) {
  const bones = group.userData.bones as Record<string, T.Bone>;
  const contacts = group.userData.contacts as RigContacts | undefined;
  const root = group.worldToLocal(position(bones.hips));
  // Foot height separates vertical travel from crouching at the hips.
  if (
    contacts?.leftFoot &&
    contacts.rightFoot &&
    bones.leftShin &&
    bones.rightShin
  ) {
    root.y = Math.min(
      ...(["left", "right"] as const).map(
        (side) =>
          group.worldToLocal(
            bones[side + "Foot"]
              ? position(bones[side + "Foot"])
              : bones[side + "Shin"].localToWorld(
                  contacts[
                    (side + "Foot") as "leftFoot" | "rightFoot"
                  ]!.clone(),
                ),
          ).y,
      ),
    );
  }
  return root;
}

/** Capture the original bind pose before any frame is sampled. Never change skin inverse matrices. */
export function configureImportedRig(
  group: T.Group,
  imported: T.Object3D,
  animations: T.AnimationClip[],
  animationRoot: T.Object3D = imported,
  mapping?: RigMapping,
) {
  const bones: Record<string, T.Bone> = {};
  const bind: Transform[] = [];
  const candidates = new Map<string, T.Bone[]>();
  const weighted = new Set<T.Bone>();
  const explicit = resolveRigMapping(animationRoot, mapping);
  group.userData.rigSemanticKeys = explicit.semanticKeys;
  group.userData.disabledRigRoles = explicit.roles;
  const unmappedBones = new Set<T.Bone>();
  group.userData.unmappedRigBones = unmappedBones;
  const coreNames = [
    ...boneNames,
    "leftHand",
    "rightHand",
    "leftFoot",
    "rightFoot",
  ];

  imported.traverse((object) => {
    bind.push({
      object,
      position: object.position.clone(),
      rotation: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
    if (object instanceof T.SkinnedMesh) {
      const indices = object.geometry.attributes.skinIndex;
      const weights = object.geometry.attributes.skinWeight;
      if (indices && weights)
        for (let i = 0; i < weights.count; i++)
          for (let j = 0; j < weights.itemSize; j++)
            if (weights.getComponent(i, j) > 1e-6)
              weighted.add(object.skeleton.bones[indices.getComponent(i, j)]);
    } else if (object instanceof T.Mesh) {
      for (let parent = object.parent; parent; parent = parent.parent)
        if (parent instanceof T.Bone) {
          weighted.add(parent);
          break;
        }
    }
    if (!(object instanceof T.Bone)) return;
    const semantic = explicit.semanticKeys.get(object);
    const automatic = canonicalBoneName(object.name);
    if (!semantic && automatic && explicit.roles.has(automatic.toLowerCase()))
      unmappedBones.add(object);
    const name = semantic
      ? coreNames.find((role) => role.toLowerCase() === semantic)
      : automatic && !explicit.roles.has(automatic.toLowerCase())
        ? automatic
        : undefined;
    if (name) candidates.set(name, [...(candidates.get(name) || []), object]);
  });
  const ambiguous: { joint: string; candidates: string[] }[] = [];
  const extremityParents: Record<string, string> = {
    leftFoot: "leftShin",
    rightFoot: "rightShin",
    leftHand: "leftForearm",
    rightHand: "rightForearm",
  };
  for (const [name, allMatches] of candidates) {
    const parent = candidates.get(extremityParents[name])?.[0];
    const matches = allMatches.filter(
      (bone) =>
        !parent ||
        hasAncestor(bone, parent) ||
        explicit.semanticKeys.has(bone) ||
        [...weighted].some(
          (joint) => joint === bone || hasAncestor(joint, bone),
        ),
    );
    if (matches.length === 1) bones[name] = matches[0];
    else if (matches.length > 1)
      ambiguous.push({
        joint: name,
        candidates: matches.map((bone) => bone.name),
      });
  }
  const detached = new Map<T.Bone, T.Bone>();
  for (const [role, parentRole] of Object.entries(extremityParents)) {
    const bone = bones[role],
      parent = bones[parentRole];
    if (
      bone &&
      parent &&
      !hasAncestor(bone, parent) &&
      !hasAncestor(parent, bone)
    )
      detached.set(bone, parent);
  }
  group.userData.detachedJointAnchors = detached;
  group.userData.rigMappingReport = {
    ambiguous,
    missing: boneNames.filter((name) => !bones[name]),
    invalid: explicit.invalid,
  };
  group.userData.bones = bones;
  group.userData.rest = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      bone.quaternion.clone(),
    ]),
  );
  group.userData.animations = animations;
  group.userData.mixer = new T.AnimationMixer(animationRoot);
  captureDetailBind(group);
  const contacts = configureRigContacts(group);
  captureFootSurfaces(group);
  const compatible =
    explicit.invalid.length === 0 &&
    boneNames.every(
      (name) =>
        bones[name] &&
        (!parents[name] || hasAncestor(bones[name], bones[parents[name]!])),
    ) &&
    bind
      .filter(
        ({ object }) =>
          object instanceof T.Bone ||
          Object.values(bones).some((bone) => hasAncestor(bone, object)),
      )
      .every(
        ({ scale }) =>
          scale.x > 0 &&
          Math.abs(scale.x - scale.y) < 1e-5 &&
          Math.abs(scale.x - scale.z) < 1e-5,
      );
  group.updateWorldMatrix(true, true);
  const data: HumanoidRig = {
    bind,
    neutralWorld: {},
    compatible,
    bindFacing: bones.hips
      ? group
          .getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(bones.hips.getWorldQuaternion(new T.Quaternion()))
      : new T.Quaternion(),
    bindRoot: bones.hips ? rootPoint(group) : new T.Vector3(),
    bindHips: bones.hips
      ? group.worldToLocal(position(bones.hips))
      : new T.Vector3(),
    roots: new Map(),
    attachmentRest: {},
    detachedRest: [...detached].map(([bone, anchor]) => ({
      bone,
      anchor,
      position: anchor.worldToLocal(position(bone)),
      rotation: anchor
        .getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(bone.getWorldQuaternion(new T.Quaternion())),
    })),
  };
  for (const name of boneNames.filter((name) => parents[name])) {
    const parent = bones[parents[name]!];
    if (bones[name] && parent)
      data.attachmentRest[name] = parent.worldToLocal(position(bones[name]));
  }
  rigs.set(group, data);
  if (!compatible || !contacts) return;
  const down = new T.Vector3(0, -1, 0).applyQuaternion(
    group.getWorldQuaternion(new T.Quaternion()),
  );
  for (const side of ["left", "right"] as const) {
    // Bind stances can splay or bend the legs just as arms can use A/T poses.
    // Compare animation against the same anatomical neutral on both rigs;
    // otherwise straight captured legs cross when transferred from a wide bind.
    // These temporary rotations only establish neutral frames. The original
    // bind transforms and skin inverse matrices are restored below.
    const thigh = bones[side + "Leg"],
      shin = bones[side + "Shin"],
      ankle = contacts[side === "left" ? "leftFoot" : "rightFoot"];
    pointAtDirection(thigh, position(shin), down);
    if (ankle) pointAtDirection(shin, shin.localToWorld(ankle.clone()), down);
    const upper = bones[side + "Arm"],
      lower = bones[side + "Forearm"],
      hand = side === "left" ? contacts.leftHand! : contacts.hand;
    pointAtDirection(upper, position(lower), down);
    // The measured local contact follows the limb even for detached skin joints.
    pointAtDirection(lower, lower.localToWorld(hand.clone()), down);
  }
  followDetachedJoints(data);
  const inverse = group.getWorldQuaternion(new T.Quaternion()).invert();
  for (const name of boneNames)
    data.neutralWorld[name] = inverse
      .clone()
      .multiply(bones[name].getWorldQuaternion(new T.Quaternion()));
  captureDetailNeutral(group);
  restore(data);
  group.updateWorldMatrix(true, true);
}

/** Apply canonical anatomical rotations in character space, not imported bone axes. */
export function applyHumanoidPose(
  group: T.Group,
  rotations: Record<string, [number, number, number]>,
  native: boolean,
) {
  const data = rigs.get(group);
  if (!data) return false;
  restore(data);
  restoreDetailMorphs(group);
  group.updateWorldMatrix(true, true);
  if (native || !data.compatible) return true;
  const bones = group.userData.bones as Record<string, T.Bone>;
  const heading = group.getWorldQuaternion(new T.Quaternion());
  const cumulative: Partial<Record<BoneName, T.Quaternion>> = {};
  for (const name of boneNames) {
    const rotation = new T.Quaternion().setFromEuler(
      new T.Euler(...(rotations[name] || [0, 0, 0])),
    );
    cumulative[name] = (
      parents[name] ? cumulative[parents[name]!]!.clone() : new T.Quaternion()
    ).multiply(rotation);
    const desired = heading
      .clone()
      .multiply(cumulative[name]!)
      .multiply(data.neutralWorld[name]!);
    const bone = bones[name];
    bone.quaternion
      .copy(
        bone
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(desired),
      )
      .normalize();
    bone.updateWorldMatrix(true, true);
  }
  followDetachedJoints(data);
  return true;
}

/** Current anatomical orientation, independent of a provider's bone rolls. */
export function humanoidJointOrientation(group: T.Group, name: BoneName) {
  const bone = group.userData.bones?.[name] as T.Bone | undefined;
  const data = rigs.get(group);
  if (!bone || (data && !data.compatible)) return;
  const orientation = bone.getWorldQuaternion(new T.Quaternion());
  if (data) orientation.multiply(data.neutralWorld[name]!.clone().invert());
  return orientation;
}

/** Add a joint rotation without restoring or replacing the sampled pose. */
export function rotateHumanoidJoint(
  group: T.Group,
  name: BoneName,
  rotation: T.Quaternion,
  space: "anatomical" | "world" = "anatomical",
) {
  const anatomical = humanoidJointOrientation(group, name);
  if (!anatomical) return;
  const bone = group.userData.bones[name] as T.Bone;
  // Some providers put weighted hand deformers beside the articulated chain.
  // Carry their current offset, not their bind pose, with the rotating anchor.
  const attachments = (rigs.get(group)?.detachedRest || [])
    .filter(({ anchor }) => anchor === bone || hasAncestor(anchor, bone))
    .map(({ bone: attached, anchor }) => ({
      bone: attached,
      anchor,
      position: anchor.worldToLocal(position(attached)),
      rotation: anchor
        .getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(attached.getWorldQuaternion(new T.Quaternion())),
    }));
  const delta =
    space === "world"
      ? rotation.clone()
      : anatomical.clone().multiply(rotation).multiply(anatomical.invert());
  const desired = bone
    .getWorldQuaternion(new T.Quaternion())
    .premultiply(delta);
  bone.quaternion
    .copy(
      bone
        .parent!.getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(desired),
    )
    .normalize();
  bone.updateWorldMatrix(true, true);
  for (const attached of attachments) {
    attached.bone.position.copy(
      attached.bone.parent!.worldToLocal(
        attached.anchor.localToWorld(attached.position),
      ),
    );
    attached.bone.quaternion.copy(
      attached.bone
        .parent!.getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(attached.anchor.getWorldQuaternion(new T.Quaternion()))
        .multiply(attached.rotation),
    );
    attached.bone.updateWorldMatrix(true, true);
  }
}

export function sampleNativeClip(
  group: T.Group,
  clip: T.AnimationClip,
  time: number,
) {
  const mixer = group.userData.mixer as T.AnimationMixer;
  const action = mixer.clipAction(clip);
  action.reset().setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(Math.min(clip.duration, Math.max(0, time)));
  // Float32 source keys can be slightly non-unit. A quaternion matrix built
  // from those values deforms the skin, and mixing it with normalized IK/loop
  // poses leaves a small discontinuity. Normalize before either native skinning
  // or transfer, including animated non-bone parents of the skeleton.
  group.traverse((node) => {
    const length = node.quaternion.lengthSq();
    if (length > 0 && Number.isFinite(length) && length !== 1)
      node.quaternion.normalize();
  });
}

/** Run a measurement that samples a rig's takes, then put back every local
 * transform and morph weight so measuring never changes a visible pose. Each
 * sample starts from the bind pose with no lingering mixer action. */
export function measureOnRig<R>(
  group: T.Group,
  measure: (sample: (clip: T.AnimationClip, time: number) => void) => R,
): R {
  const saved: {
    node: T.Object3D;
    p: T.Vector3;
    q: T.Quaternion;
    s: T.Vector3;
    weights?: number[];
  }[] = [];
  group.traverse((node) =>
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
      weights:
        node instanceof T.Mesh
          ? node.morphTargetInfluences?.slice()
          : undefined,
    }),
  );
  const mixer = group.userData.mixer as T.AnimationMixer | undefined;
  try {
    return measure((clip, time) => {
      mixer?.stopAllAction();
      applyHumanoidPose(group, {}, true);
      sampleNativeClip(group, clip, time);
      group.updateWorldMatrix(true, true);
    });
  } finally {
    mixer?.stopAllAction();
    for (const { node, p, q, s, weights } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
      if (weights && node instanceof T.Mesh && node.morphTargetInfluences)
        node.morphTargetInfluences.splice(0, weights.length, ...weights);
    }
    group.updateWorldMatrix(true, true);
  }
}

/** World body facing relative to the receiver's original anatomical bind axes.
 * Bone-local axes are provider-dependent, so a raw pelvis quaternion is not a
 * portable heading. This reads the current pose without sampling or mutating it. */
export function rigHeading(group: T.Group) {
  const hips = group.userData.bones?.hips as T.Bone | undefined;
  if (!hips) return;
  const bind = rigs.get(group)?.bindFacing ?? new T.Quaternion();
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(
    hips.getWorldQuaternion(new T.Quaternion()).multiply(bind.clone().invert()),
  );
  return Math.hypot(forward.x, forward.z) > 1e-6
    ? Math.atan2(forward.x, forward.z)
    : undefined;
}

export function nativeRootMotion(
  group: T.Group,
  clip: T.AnimationClip,
  endTime = clip.duration,
  startTime = 0,
): RootMotion | undefined {
  const data = rigs.get(group);
  if (!data || !group.userData.bones.hips) return;
  endTime = Math.max(0, Math.min(clip.duration, endTime));
  startTime = Math.max(0, Math.min(endTime, startTime));
  let cache = data.roots.get(clip);
  if (!cache) data.roots.set(clip, (cache = new Map()));
  const key = `${startTime}:${endTime}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const mixer = group.userData.mixer as T.AnimationMixer;
  const sample = (time: number) => {
    mixer.stopAllAction();
    restore(data);
    sampleNativeClip(group, clip, time);
    group.updateWorldMatrix(true, true);
    return rootPoint(group);
  };
  const facing = () => {
    const rotation = group
      .getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(
        group.userData.bones.hips.getWorldQuaternion(new T.Quaternion()),
      )
      .multiply(data.bindFacing.clone().invert());
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(rotation);
    return Math.hypot(forward.x, forward.z) > 1e-6
      ? Math.atan2(forward.x, forward.z)
      : undefined;
  };
  const start = sample(startTime),
    startHeading = facing() ?? 0;
  let heading = startHeading,
    end = start.clone();
  const frames = Math.max(1, Math.ceil((endTime - startTime) * 60));
  for (let frame = 1; frame <= frames; frame++) {
    end = sample(startTime + ((endTime - startTime) * frame) / frames);
    const angle = facing() ?? heading;
    heading += Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading));
  }
  const result = {
    start: start.clone().sub(data.bindRoot),
    delta: end.sub(start),
    startHeading,
    heading: heading - startHeading,
  };
  mixer.stopAllAction();
  restore(data);
  group.updateWorldMatrix(true, true);
  cache.set(key, result);
  return result;
}

function mappingIssue(group: T.Group): string {
  const report = group.userData.rigMappingReport as
    | {
        ambiguous: { joint: string; candidates: string[] }[];
        missing: string[];
        invalid: string[];
      }
    | undefined;
  if (report?.ambiguous.length)
    return ` Ambiguous joints: ${report.ambiguous.map(({ joint, candidates }) => `${joint} (${candidates.join(", ")})`).join("; ")}.`;
  if (report?.invalid.length)
    return ` Invalid bone paths: ${report.invalid.join(", ")}.`;
  if (report?.missing.length)
    return ` Unmapped joints: ${report.missing.join(", ")}.`;
  return "";
}
export function humanoidWarning(group: T.Group, name: string, native: boolean) {
  const data = rigs.get(group);
  return data && !data.compatible && !native
    ? `Studio actions cannot match ${name}'s body yet. Use this character's original actions or choose another character.${mappingIssue(group)}`
    : "";
}

type Rotations = Partial<Record<BoneName, T.Quaternion>>;
type TransferProfile = {
  start: T.Vector3;
  delta: T.Vector3;
  startHeading: number;
  heading: number;
};
const transfers = new WeakMap<
  T.Group,
  Map<T.AnimationClip, Map<string, TransferProfile>>
>();
const transferIssues = new WeakMap<T.Group, Map<T.AnimationClip, string>>();
const sources = new WeakMap<T.Group, Map<string, T.Group>>();
export function setMotionSources(
  target: T.Group,
  originals: Map<string, T.Group>,
) {
  sources.set(target, originals);
}
export function motionSource(target: T.Group, assetId: string) {
  return sources.get(target)?.get(assetId);
}
/** Finds the take an imported motion refers to inside a loaded asset.
 * Projects saved before the import service adopted the loader's naming stored
 * the service's "Animation N" label for an untitled take; that label still
 * resolves to the same untitled take at index N - 1, never to a titled one. */
export function importedClip(
  animations: T.AnimationClip[] | undefined,
  animationName: string | undefined,
): T.AnimationClip | undefined {
  if (!animations?.length || !animationName) return undefined;
  const exact = T.AnimationClip.findByName(animations, animationName);
  if (exact) return exact;
  const label = /^Animation (\d+)$/.exec(animationName);
  if (!label) return undefined;
  const clip = animations[Number(label[1]) - 1];
  return clip?.name === untitledAnimationName(Number(label[1]) - 1)
    ? clip
    : undefined;
}
function canonicalRotations(group: T.Group): Rotations {
  const data = rigs.get(group)!;
  const bones = group.userData.bones as Record<string, T.Bone>;
  const inverse = group.getWorldQuaternion(new T.Quaternion()).invert();
  return Object.fromEntries(
    boneNames.map((name) => [
      name,
      inverse
        .clone()
        .multiply(bones[name].getWorldQuaternion(new T.Quaternion()))
        .multiply(data.neutralWorld[name]!.clone().invert())
        .normalize(),
    ]),
  );
}
function sampleOriginal(source: T.Group, clip: T.AnimationClip, time: number) {
  (source.userData.mixer as T.AnimationMixer).stopAllAction();
  restore(rigs.get(source)!);
  restoreDetailMorphs(source);
  sampleNativeClip(source, clip, time);
  source.updateWorldMatrix(true, true);
}
export function standingHeight(group: T.Group) {
  const data = rigs.get(group);
  if (data) return data.bindHips.y - data.bindRoot.y;
  // The same hip-to-ankle landmark as rootPoint, using fixed neutral offsets.
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  const bind = group.userData.bindPositions as
    Record<string, T.Vector3> | undefined;
  return bones?.leftLeg && bones.leftShin
    ? Math.abs((bind?.leftLeg ?? bones.leftLeg.position).y) +
        Math.abs((bind?.leftShin ?? bones.leftShin.position).y) *
          (1 + 0.35 / 0.4)
    : 0;
}
// Torso/hip/shoulder attachment chains may translate for pelvic sway and shrugs.
// Elbows and knees remain fixed-length links; detached IK targets are not joints.
function attachmentChain(group: T.Group, name: BoneName): T.Object3D[] {
  if (!["spine", "leftLeg", "rightLeg", "leftArm", "rightArm"].includes(name))
    return [];
  const bones = group.userData.bones as Record<string, T.Bone>;
  const end = bones[parents[name]!];
  const chain: T.Object3D[] = [];
  for (
    let node: T.Object3D | null = bones[name];
    node && node !== end;
    node = node.parent
  )
    chain.push(node);
  return chain;
}
export function transferWarning(
  source: T.Group,
  target: T.Group,
  clip?: T.AnimationClip,
) {
  if (!rigs.get(source)?.compatible)
    return (
      "This action's original character needs a recognizable humanoid body before it can be shared." +
      mappingIssue(source)
    );
  const targetData = rigs.get(target);
  if (
    (targetData && !targetData.compatible) ||
    !boneNames.every((name) => target.userData.bones?.[name])
  )
    return (
      "This character's body cannot use shared humanoid actions yet. Use its original actions." +
      mappingIssue(target)
    );
  if (standingHeight(source) < 0.1 || standingHeight(target) < 0.1)
    return "This action needs an upright humanoid bind pose before it can be shared.";
  if (clip) {
    let cache = transferIssues.get(source);
    if (!cache) transferIssues.set(source, (cache = new Map()));
    if (!cache.has(clip)) {
      const data = rigs.get(source)!,
        hips = source.userData.bones.hips as T.Bone;
      const root = (source.userData.mixer as T.AnimationMixer).getRoot();
      const unsupported = clip.tracks.some((track) => {
        const path = T.PropertyBinding.parseTrackName(track.name);
        const node = T.PropertyBinding.findNode(root, path.nodeName);
        if (!(node instanceof T.Object3D)) return false;
        const bind = data.bind.find((entry) => entry.object === node);
        if (!bind) return false;
        // Exporters also animate unweighted IK controls. Only joints on an
        // anatomical chain constrain sharing; moving a detached pole is harmless.
        const relevant = Object.values(
          source.userData.bones as Record<string, T.Bone>,
        ).some((bone) => bone === node || hasAncestor(bone, node));
        const attachment = (
          ["spine", "leftLeg", "rightLeg", "leftArm", "rightArm"] as BoneName[]
        ).some((name) => attachmentChain(source, name).includes(node));
        const baseline =
          path.propertyName === "scale" && relevant
            ? bind.scale
            : path.propertyName === "position" &&
                relevant &&
                !attachment &&
                !(
                  source.userData.detachedJointAnchors as Map<T.Bone, T.Bone>
                ).has(node as T.Bone) &&
                node instanceof T.Bone &&
                node !== hips &&
                !hasAncestor(hips, node)
              ? bind.position
              : undefined;
        return (
          baseline &&
          Array.from(track.values).some(
            (value, index) =>
              Math.abs(value - baseline.getComponent(index % 3)) > 1e-4,
          )
        );
      });
      cache.set(
        clip,
        unsupported
          ? "This action changes bone lengths or scale. Keep it on its original character; shared actions support joint rotations and body travel."
          : "",
      );
    }
    return cache.get(clip)!;
  }
  return "";
}
function transferProfile(
  source: T.Group,
  clip: T.AnimationClip,
  endTime = clip.duration,
  startTime = 0,
) {
  let cache = transfers.get(source);
  if (!cache) transfers.set(source, (cache = new Map()));
  let endpoints = cache.get(clip);
  if (!endpoints) cache.set(clip, (endpoints = new Map()));
  const key = `${startTime}:${endTime}`;
  const known = endpoints.get(key);
  if (known) return known;
  const original = nativeRootMotion(source, clip, endTime, startTime)!;
  const result = {
    start: original.start,
    delta: original.delta
      .clone()
      .applyAxisAngle(new T.Vector3(0, 1, 0), -original.startHeading),
    startHeading: original.startHeading,
    heading: original.heading,
  };
  endpoints.set(key, result);
  return result;
}
export function transferredRootMotion(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
  endTime = clip.duration,
  startTime = 0,
) {
  if (transferWarning(source, target, clip)) return;
  const profile = transferProfile(source, clip, endTime, startTime);
  return {
    start: [0, 0, 0] as [number, number, number],
    delta: profile.delta
      .clone()
      .multiplyScalar(standingHeight(target) / standingHeight(source))
      .toArray(),
    heading: profile.heading,
  };
}
/** Transfer anatomical world rotations, compensating for both rigs' bone axes and neutral poses. */
export function applyTransferredClip(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
  time: number,
  startTime = 0,
) {
  const warning = transferWarning(source, target, clip);
  if (warning) return warning;
  const data = rigs.get(source)!,
    targetData = rigs.get(target);
  const profile = transferProfile(source, clip, clip.duration, startTime);
  const basePosition = target.position.clone();
  sampleOriginal(source, clip, time);
  const rotations = canonicalRotations(source);
  const initialTurn = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    -profile.startHeading,
  );
  for (const name of boneNames) rotations[name]!.premultiply(initialTurn);
  const offset = source
    .worldToLocal(position(source.userData.bones.hips))
    .sub(data.bindHips)
    .sub(profile.start)
    .applyQuaternion(initialTurn)
    .multiplyScalar(standingHeight(target) / standingHeight(source));
  const heading = target.getWorldQuaternion(new T.Quaternion());
  const scale = target.getWorldScale(new T.Vector3()).x;
  target.position.add(offset.multiplyScalar(scale).applyQuaternion(heading));
  target.updateWorldMatrix(true, true);
  if (
    targetData &&
    applyDetailedTransfer(
      source,
      target,
      clip,
      initialTurn,
      standingHeight(target) / standingHeight(source),
    )
  ) {
    transferFootClearance(
      source,
      target,
      basePosition,
      standingHeight(target) / standingHeight(source),
    );
    return "";
  }
  applyRetargetNotice(source, target, clip);
  const bones = target.userData.bones as Record<string, T.Bone>;
  for (const name of boneNames) {
    const desired = heading.clone().multiply(rotations[name]!);
    if (targetData) desired.multiply(targetData.neutralWorld[name]!);
    const bone = bones[name];
    // Preserve the attachment origin relative to its anatomical parent, including
    // translation and rotation of intermediary shoulder/pelvis helper joints.
    // Comparing to the bind origin avoids transferring the source's body proportions.
    const rest = data.attachmentRest[name];
    if (rest) {
      const parent = source.userData.bones[parents[name]!] as T.Bone;
      const local = parent
        .worldToLocal(position(source.userData.bones[name]))
        .sub(rest);
      const point = source.worldToLocal(parent.localToWorld(local));
      const base = source.worldToLocal(parent.localToWorld(new T.Vector3()));
      const delta = point
        .sub(base)
        .applyQuaternion(initialTurn)
        .multiplyScalar(
          (standingHeight(target) / standingHeight(source)) * scale,
        )
        .applyQuaternion(heading);
      const origin = bone.parent!.getWorldPosition(new T.Vector3());
      bone.position.add(
        bone
          .parent!.worldToLocal(origin.clone().add(delta))
          .sub(bone.parent!.worldToLocal(origin)),
      );
    }
    bone.quaternion
      .copy(
        bone
          .parent!.getWorldQuaternion(new T.Quaternion())
          .invert()
          .multiply(desired),
      )
      .normalize();
    bone.updateWorldMatrix(true, true);
  }
  transferFootClearance(
    source,
    target,
    basePosition,
    standingHeight(target) / standingHeight(source),
  );
  return "";
}
