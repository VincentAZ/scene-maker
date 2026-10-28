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
type RootMotion = { start: T.Vector3; delta: T.Vector3 };
type HumanoidRig = {
  bind: Transform[];
  neutralWorld: Partial<Record<BoneName, T.Quaternion>>;
  compatible: boolean;
  bindRoot: T.Vector3;
  roots: Map<T.AnimationClip, RootMotion>;
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
    bindRoot: bones.hips ? rootPoint(group) : new T.Vector3(),
    roots: new Map(),
  };
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
  const start = sample(0),
    end = sample(clip.duration);
  const result = {
    start: start.clone().sub(data.bindRoot),
    delta: end.sub(start),
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
