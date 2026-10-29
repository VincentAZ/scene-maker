import * as T from "three";
import { boneNames } from "../shared/scene";
import { configureRigContacts, type RigContacts } from "./ik";

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
  roots: Map<T.AnimationClip, RootMotion>;
  attachmentRest: Partial<Record<BoneName, T.Vector3>>;
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
  leftleg: "leftShin",
  leftcalf: "leftShin",
  leftfoot: "leftFoot",
  rightupleg: "rightLeg",
  rightthigh: "rightLeg",
  rightleg: "rightShin",
  rightcalf: "rightShin",
  rightfoot: "rightFoot",
};
function restore(rig: HumanoidRig) {
  for (const t of rig.bind) {
    t.object.position.copy(t.position);
    t.object.quaternion.copy(t.rotation);
    t.object.scale.copy(t.scale);
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
            bones[side + "Shin"].localToWorld(
              contacts[(side + "Foot") as "leftFoot" | "rightFoot"]!.clone(),
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
) {
  const bones: Record<string, T.Bone> = {};
  const bind: Transform[] = [];
  imported.traverse((object) => {
    bind.push({
      object,
      position: object.position.clone(),
      rotation: object.quaternion.clone(),
      scale: object.scale.clone(),
    });
    if (!(object instanceof T.Bone)) return;
    const short = object.name
      .split(/[|:]/)
      .at(-1)!
      .replace(/^mixamorig[_:]?/i, "");
    const name = boneNames.includes(short as BoneName)
      ? short
      : aliases[short.replace(/[_\s-]/g, "").toLowerCase()];
    if (name && !bones[name]) bones[name] = object;
  });
  group.userData.bones = bones;
  group.userData.rest = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [
      name,
      bone.quaternion.clone(),
    ]),
  );
  group.userData.animations = animations;
  group.userData.mixer = new T.AnimationMixer(imported);
  const contacts = configureRigContacts(group);
  const compatible =
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
    const upper = bones[side + "Arm"],
      lower = bones[side + "Forearm"],
      hand = bones[side + "Hand"];
    const terminal = lower.worldToLocal(
      position(lower).add(position(lower).sub(position(upper))),
    );
    pointAtDirection(upper, position(lower), down);
    // A hand bone is optional; infer the forearm continuation when absent.
    const end = hand ? position(hand) : lower.localToWorld(terminal);
    pointAtDirection(lower, end, down);
  }
  const inverse = group.getWorldQuaternion(new T.Quaternion()).invert();
  for (const name of boneNames)
    data.neutralWorld[name] = inverse
      .clone()
      .multiply(bones[name].getWorldQuaternion(new T.Quaternion()));
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
  return true;
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
}

export function nativeRootMotion(
  group: T.Group,
  clip: T.AnimationClip,
): RootMotion | undefined {
  const data = rigs.get(group);
  if (!data || !group.userData.bones.hips) return;
  const cached = data.roots.get(clip);
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
  const start = sample(0),
    startHeading = facing() ?? 0;
  let heading = startHeading,
    end = start.clone();
  const frames = Math.max(1, Math.ceil(clip.duration * 24));
  for (let frame = 1; frame <= frames; frame++) {
    end = sample((clip.duration * frame) / frames);
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
  data.roots.set(clip, result);
  return result;
}

export function humanoidWarning(group: T.Group, name: string, native: boolean) {
  const data = rigs.get(group);
  return data && !data.compatible && !native
    ? `Studio actions cannot match ${name}'s body yet. Use this character's original actions or choose another character.`
    : "";
}

type Rotations = Partial<Record<BoneName, T.Quaternion>>;
type TransferProfile = {
  start: T.Vector3;
  delta: T.Vector3;
  startHeading: number;
  heading: number;
};
const transfers = new WeakMap<T.Group, Map<T.AnimationClip, TransferProfile>>();
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
  sampleNativeClip(source, clip, time);
  source.updateWorldMatrix(true, true);
}
function standingHeight(group: T.Group) {
  const data = rigs.get(group);
  if (data) return data.bindHips.y - data.bindRoot.y;
  // The same hip-to-ankle landmark as rootPoint, using fixed neutral offsets.
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  return bones?.leftLeg && bones.leftShin
    ? Math.abs(bones.leftLeg.position.y) +
        Math.abs(bones.leftShin.position.y) * (1 + 0.35 / 0.4)
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
    return "This action's original character needs a recognizable humanoid body before it can be shared.";
  const targetData = rigs.get(target);
  if (
    (targetData && !targetData.compatible) ||
    !boneNames.every((name) => target.userData.bones?.[name])
  )
    return "This character's body cannot use shared humanoid actions yet. Use its original actions.";
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
function transferProfile(source: T.Group, clip: T.AnimationClip) {
  let cache = transfers.get(source);
  if (!cache) transfers.set(source, (cache = new Map()));
  const known = cache.get(clip);
  if (known) return known;
  const original = nativeRootMotion(source, clip)!;
  const result = {
    start: original.start,
    delta: original.delta
      .clone()
      .applyAxisAngle(new T.Vector3(0, 1, 0), -original.startHeading),
    startHeading: original.startHeading,
    heading: original.heading,
  };
  cache.set(clip, result);
  return result;
}
export function transferredRootMotion(
  source: T.Group,
  target: T.Group,
  clip: T.AnimationClip,
) {
  if (transferWarning(source, target, clip)) return;
  const profile = transferProfile(source, clip);
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
) {
  const warning = transferWarning(source, target, clip);
  if (warning) return warning;
  const data = rigs.get(source)!,
    targetData = rigs.get(target);
  const profile = transferProfile(source, clip);
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
  return "";
}
