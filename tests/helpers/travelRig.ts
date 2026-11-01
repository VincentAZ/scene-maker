import * as T from "three";
import { configureImportedRig } from "../../src/rig";

const up = new T.Vector3(0, 1, 0);

/** A real imported hierarchy: all eleven core bones plus feet, hands, toes,
 * and a finger. A separate animated root sits below the imported size transform.
 * No renderer, external asset, mocked mixer, or procedural gait is involved. */
export function makeRig(size = 1, units = 1) {
  const group = new T.Group();
  const imported = new T.Group();
  const root = new T.Group();
  const bones: Record<string, T.Bone> = {};
  imported.scale.setScalar(size / units);
  group.add(imported);
  imported.add(root);
  const add = (
    name: string,
    parent: string | undefined,
    position: [number, number, number],
  ) => {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(...position).multiplyScalar(units);
    (parent ? bones[parent] : root).add(bone);
    bones[name] = bone;
  };
  add("hips", undefined, [0, 0.95, 0]);
  add("spine", "hips", [0, 0.2, 0]);
  add("head", "spine", [0, 0.5, 0]);
  for (const [side, sign] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    add(`${side}Arm`, "spine", [sign * 0.25, 0.3, 0]);
    add(`${side}Forearm`, `${side}Arm`, [0, -0.3, 0]);
    add(`${side}Hand`, `${side}Forearm`, [0, -0.25, 0]);
    add(`${side}Leg`, "hips", [sign * 0.12, -0.05, 0]);
    add(`${side}Shin`, `${side}Leg`, [0, -0.42, 0]);
    add(`${side}Foot`, `${side}Shin`, [0, -0.42, 0.08]);
    add(`${side}ToeBase`, `${side}Foot`, [0, 0, 0.14]);
  }
  add("leftHandIndex1", "leftHand", [0.025, -0.08, 0]);
  configureImportedRig(group, imported, []);
  return { group, imported, root, bones, units };
}
export type Rig = ReturnType<typeof makeRig>;

export function rotationTrack(
  node: T.Object3D,
  times: number[],
  angles: number[],
  axis = new T.Vector3(1, 0, 0),
) {
  return new T.QuaternionKeyframeTrack(
    `${node.uuid}.quaternion`,
    times,
    angles.flatMap((angle) =>
      new T.Quaternion().setFromAxisAngle(axis, angle).toArray(),
    ),
  );
}

export function addTravelClip(
  rig: Rig,
  options: { accelerating?: boolean; seam?: boolean; residual?: number } = {},
) {
  const times = [0, 0.5, 1, 1.5, 2];
  const { root, bones, units } = rig;
  const clip = new T.AnimationClip("Authored travelling gait", 2, [
    new T.VectorKeyframeTrack(
      `${root.uuid}.position`,
      times,
      times.flatMap((time) => [
        1.5 * units,
        0,
        (-2 + (options.accelerating ? time * time : time * 2)) * units,
      ]),
    ),
    rotationTrack(
      root,
      times,
      times.map(() => 0.7),
      up,
    ),
    new T.VectorKeyframeTrack(
      `${bones.hips.uuid}.position`,
      times,
      [0, 0.04, 0, 0.04, 0].flatMap((bob) => [0, (0.95 + bob) * units, 0]),
    ),
    rotationTrack(bones.leftLeg, times, [
      0,
      0.35,
      0,
      -0.35,
      options.seam ? 0.8 : (options.residual ?? 0),
    ]),
    rotationTrack(bones.rightLeg, times, [0, -0.35, 0, 0.35, 0]),
    rotationTrack(bones.leftShin, times, [0, 0.15, 0, 0.25, 0]),
    rotationTrack(bones.rightShin, times, [0, 0.25, 0, 0.15, 0]),
    // Distinct non-procedural upper-body and extremity channels must survive.
    rotationTrack(bones.leftArm, times, [0, -0.45, 0.2, 0.3, 0]),
    rotationTrack(bones.rightForearm, times, [0, -0.8, -0.3, -0.6, 0]),
    rotationTrack(bones.leftFoot, times, [0, 0.2, -0.12, 0.16, 0]),
    rotationTrack(bones.rightFoot, times, [0, -0.12, 0.2, 0.1, 0]),
    rotationTrack(
      bones.leftHand,
      times,
      [0, 0.6, -0.15, 0.3, 0],
      new T.Vector3(0, 0, 1),
    ),
    rotationTrack(bones.leftHandIndex1, times, [0, 0.9, 0.4, 0.7, 0]),
    rotationTrack(bones.leftToeBase, times, [0, 0.3, -0.2, 0.1, 0]),
  ]);
  configureImportedRig(rig.group, rig.imported, [clip]);
  return clip;
}
