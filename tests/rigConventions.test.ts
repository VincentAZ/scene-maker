import { expect, it } from "vitest";
import * as T from "three";
import { characters, type Asset } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";

/** One body layout; each standard convention only renames it. */
const LAYOUT: [string, string | null, number[]][] = [
  ["hips", null, [0, 100, 0]],
  ["spine", "hips", [0, 10, 0]],
  ["chest", "spine", [0, 12, 0]],
  ["upperChest", "chest", [0, 13, 0]],
  ["neck", "upperChest", [0, 20, 0]],
  ["head", "neck", [0, 10, 0]],
  ["lShoulder", "upperChest", [6, 15, 0]],
  ["lArm", "lShoulder", [12, 0, 0]],
  ["lForearm", "lArm", [28, 0, 0]],
  ["lHand", "lForearm", [25, 0, 0]],
  ["rShoulder", "upperChest", [-6, 15, 0]],
  ["rArm", "rShoulder", [-12, 0, 0]],
  ["rForearm", "rArm", [-28, 0, 0]],
  ["rHand", "rForearm", [-25, 0, 0]],
  ["lThigh", "hips", [9, -5, 0]],
  ["lShin", "lThigh", [0, -42, 0]],
  ["lFoot", "lShin", [0, -42, 0]],
  ["rThigh", "hips", [-9, -5, 0]],
  ["rShin", "rThigh", [0, -42, 0]],
  ["rFoot", "rShin", [0, -42, 0]],
];
const sided = (l: string, r: string) => (k: string) =>
  k[0] === "l" ? l : k[0] === "r" ? r : "";
const conventions: Record<string, Record<string, string>> = {
  unreal: {
    hips: "pelvis",
    spine: "spine_01",
    chest: "spine_02",
    upperChest: "spine_03",
    neck: "neck_01",
    head: "head",
    lShoulder: "clavicle_l",
    lArm: "upperarm_l",
    lForearm: "lowerarm_l",
    lHand: "hand_l",
    rShoulder: "clavicle_r",
    rArm: "upperarm_r",
    rForearm: "lowerarm_r",
    rHand: "hand_r",
    lThigh: "thigh_l",
    lShin: "calf_l",
    lFoot: "foot_l",
    rThigh: "thigh_r",
    rShin: "calf_r",
    rFoot: "foot_r",
  },
  rigify: {
    hips: "DEF-spine",
    spine: "DEF-spine.001",
    chest: "DEF-spine.002",
    upperChest: "DEF-spine.003",
    neck: "DEF-spine.004",
    head: "DEF-spine.006",
    lShoulder: "DEF-shoulder.L",
    lArm: "DEF-upper_arm.L",
    lForearm: "DEF-forearm.L",
    lHand: "DEF-hand.L",
    rShoulder: "DEF-shoulder.R",
    rArm: "DEF-upper_arm.R",
    rForearm: "DEF-forearm.R",
    rHand: "DEF-hand.R",
    lThigh: "DEF-thigh.L",
    lShin: "DEF-shin.L",
    lFoot: "DEF-foot.L",
    rThigh: "DEF-thigh.R",
    rShin: "DEF-shin.R",
    rFoot: "DEF-foot.R",
  },
  daz: {
    hips: "hip",
    spine: "abdomenLower",
    chest: "abdomenUpper",
    upperChest: "chestUpper",
    neck: "neckLower",
    head: "head",
    lShoulder: "lCollar",
    lArm: "lShldrBend",
    lForearm: "lForearmBend",
    lHand: "lHand",
    rShoulder: "rCollar",
    rArm: "rShldrBend",
    rForearm: "rForearmBend",
    rHand: "rHand",
    lThigh: "lThighBend",
    lShin: "lShin",
    lFoot: "lFoot",
    rThigh: "rThighBend",
    rShin: "rShin",
    rFoot: "rFoot",
  },
  vrm: {
    hips: "J_Bip_C_Hips",
    spine: "J_Bip_C_Spine",
    chest: "J_Bip_C_Chest",
    upperChest: "J_Bip_C_UpperChest",
    neck: "J_Bip_C_Neck",
    head: "J_Bip_C_Head",
    lShoulder: "J_Bip_L_Shoulder",
    lArm: "J_Bip_L_UpperArm",
    lForearm: "J_Bip_L_LowerArm",
    lHand: "J_Bip_L_Hand",
    rShoulder: "J_Bip_R_Shoulder",
    rArm: "J_Bip_R_UpperArm",
    rForearm: "J_Bip_R_LowerArm",
    rHand: "J_Bip_R_Hand",
    lThigh: "J_Bip_L_UpperLeg",
    lShin: "J_Bip_L_LowerLeg",
    lFoot: "J_Bip_L_Foot",
    rThigh: "J_Bip_R_UpperLeg",
    rShin: "J_Bip_R_LowerLeg",
    rFoot: "J_Bip_R_Foot",
  },
  blender: {
    hips: "hips",
    spine: "spine",
    chest: "chest",
    upperChest: "upper_chest",
    neck: "neck",
    head: "head",
    lShoulder: "shoulder.L",
    lArm: "upper_arm.L",
    lForearm: "forearm.L",
    lHand: "hand.L",
    rShoulder: "shoulder.R",
    rArm: "upper_arm.R",
    rForearm: "forearm.R",
    rHand: "hand.R",
    lThigh: "thigh.L",
    lShin: "shin.L",
    lFoot: "foot.L",
    rThigh: "thigh.R",
    rShin: "shin.R",
    rFoot: "foot.R",
  },
  // NVIDIA SOMA: "Leg" is the thigh, the spine is numbered from 1.
  soma: {
    hips: "Hips",
    spine: "Spine1",
    chest: "Spine2",
    upperChest: "Chest",
    neck: "Neck1",
    head: "Head",
    lShoulder: "LeftShoulder",
    lArm: "LeftArm",
    lForearm: "LeftForeArm",
    lHand: "LeftHand",
    rShoulder: "RightShoulder",
    rArm: "RightArm",
    rForearm: "RightForeArm",
    rHand: "RightHand",
    lThigh: "LeftLeg",
    lShin: "LeftShin",
    lFoot: "LeftFoot",
    rThigh: "RightLeg",
    rShin: "RightShin",
    rFoot: "RightFoot",
  },
  // Mixamo / CMU BVH / LAFAN: "Leg" is the shin, "Spine" sits below "Spine1".
  mixamo: {
    hips: "Hips",
    spine: "Spine",
    chest: "Spine1",
    upperChest: "Spine2",
    neck: "Neck",
    head: "Head",
    lShoulder: "LeftShoulder",
    lArm: "LeftArm",
    lForearm: "LeftForeArm",
    lHand: "LeftHand",
    rShoulder: "RightShoulder",
    rArm: "RightArm",
    rForearm: "RightForeArm",
    rHand: "RightHand",
    lThigh: "LeftUpLeg",
    lShin: "LeftLeg",
    lFoot: "LeftFoot",
    rThigh: "RightUpLeg",
    rShin: "RightLeg",
    rFoot: "RightFoot",
  },
  unity: Object.fromEntries(
    LAYOUT.map(([k]) => {
      const side = sided("Left ", "Right ")(k);
      const part: Record<string, string> = {
        Shoulder: "Shoulder",
        Arm: "Upper Arm",
        Forearm: "Lower Arm",
        Hand: "Hand",
        Thigh: "Upper Leg",
        Shin: "Lower Leg",
        Foot: "Foot",
      };
      return [
        k,
        side ? side + part[k.slice(1)] : k[0].toUpperCase() + k.slice(1),
      ];
    }),
  ),
  biped: Object.fromEntries(
    LAYOUT.map(([k]) => {
      const side = sided("L ", "R ")(k);
      const part: Record<string, string> = {
        Shoulder: "Clavicle",
        Arm: "UpperArm",
        Forearm: "Forearm",
        Hand: "Hand",
        Thigh: "Thigh",
        Shin: "Calf",
        Foot: "Foot",
      };
      const torso: Record<string, string> = {
        hips: "Pelvis",
        spine: "Spine",
        chest: "Spine1",
        upperChest: "Spine2",
        neck: "Neck",
        head: "Head",
      };
      return [k, "Bip01 " + (side ? side + part[k.slice(1)] : torso[k])];
    }),
  ),
};
const ROLES: Record<string, string> = {
  hips: "hips",
  spine: "spine",
  head: "head",
  lArm: "leftArm",
  lForearm: "leftForearm",
  lHand: "leftHand",
  rArm: "rightArm",
  rForearm: "rightForearm",
  rHand: "rightHand",
  lThigh: "leftLeg",
  lShin: "leftShin",
  lFoot: "leftFoot",
  rThigh: "rightLeg",
  rShin: "rightShin",
  rFoot: "rightFoot",
};

/** A skinned box body, each vertex bound to its nearest joint. */
function body(
  names: Record<string, string>,
  extra: [string, string | null][] = [],
) {
  const scene = new T.Group();
  const joints: Record<string, T.Bone> = {};
  for (const [key, parent, xyz] of LAYOUT) {
    const bone = new T.Bone();
    bone.name = names[key];
    bone.position.fromArray(xyz);
    if (parent) joints[parent].add(bone);
    else scene.add(bone);
    joints[key] = bone;
  }
  for (const [name, parent] of extra) {
    const bone = new T.Bone();
    bone.name = name;
    if (parent) joints[parent].add(bone);
    else scene.add(bone);
    joints[name] = bone;
  }
  scene.updateMatrixWorld(true);
  const bones = Object.values(joints);
  const at = bones.map((b) => b.getWorldPosition(new T.Vector3()));
  const geometry = new T.BoxGeometry(160, 180, 30, 16, 24, 4);
  geometry.translate(0, 90, 0);
  const vertex = new T.Vector3(),
    index: number[] = [],
    weight: number[] = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    vertex.fromBufferAttribute(geometry.attributes.position, i);
    let best = 0;
    at.forEach((p, k) => {
      if (p.distanceTo(vertex) < at[best].distanceTo(vertex)) best = k;
    });
    index.push(best, 0, 0, 0);
    weight.push(1, 0, 0, 0);
  }
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(index, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weight, 4));
  const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial());
  scene.add(mesh);
  mesh.bind(new T.Skeleton(bones));
  const asset = { ...characters[0], id: "convention", url: "/x.glb" } as Asset;
  const group = prepareImportedAsset(asset, { scene, animations: [] });
  return {
    group,
    joints,
    roles: group.userData.bones as Record<string, T.Bone>,
  };
}

it.each(Object.keys(conventions))(
  "recognises every body joint of a standard %s skeleton",
  (convention) => {
    const { group, joints, roles } = body(conventions[convention]);
    for (const [key, role] of Object.entries(ROLES))
      expect(roles[role], role).toBe(joints[key]);
    expect(group.userData.rigMappingReport.missing).toEqual([]);
    expect(group.userData.rigMappingReport.ambiguous).toEqual([]);
  },
);

it.each(Object.keys(conventions))(
  "recognises a %s skeleton under the names three.js gives it on load",
  (convention) => {
    // GLTFLoader sanitizes node names: "DEF-spine.001" -> "DEF-spine001",
    // "Bip01 L UpperArm" -> "Bip01_L_UpperArm".
    const names = Object.fromEntries(
      Object.entries(conventions[convention]).map(([k, v]) => [
        k,
        T.PropertyBinding.sanitizeNodeName(v),
      ]),
    );
    const { group, joints, roles } = body(names);
    for (const [key, role] of Object.entries(ROLES))
      expect(roles[role], role).toBe(joints[key]);
    expect(group.userData.rigMappingReport.missing).toEqual([]);
  },
);

it("takes the hip above the pelvis branch, as on Daz and Character Creator bodies", () => {
  const names = { ...conventions.daz };
  const { joints, roles } = body(names, [["pelvis", "hips"]]);
  expect(roles.hips).toBe(joints.hips);
  expect(roles.hips.name).toBe("hip");
});

it("keeps twist segments, mechanism and control layers out of the body roles", () => {
  const { roles } = body(conventions.rigify, [
    ["DEF-upper_arm.L.001", "lArm"],
    ["MCH-upper_arm_parent.L", "lShoulder"],
    ["ORG-forearm.L", "lArm"],
    ["upper_arm_fk.L", "lShoulder"],
    ["lShldrTwist", "lArm"],
    ["upperarm_twist_01_l", "lArm"],
    ["thigh_l_ik", "lThigh"],
  ]);
  expect(roles.leftArm.name).toBe("DEF-upper_arm.L");
  expect(roles.leftForearm.name).toBe("DEF-forearm.L");
  expect(roles.leftLeg.name).toBe("DEF-thigh.L");
});

it("reports a named control bone beside the deform skeleton as ambiguous", () => {
  // Full Rigify exports also carry a control called "hips"; choosing between
  // it and DEF-spine is left to the rig mapping, not to traversal order.
  const { group, roles } = body(conventions.rigify, [["hips", null]]);
  expect(roles.hips).toBeUndefined();
  expect(group.userData.rigMappingReport.ambiguous).toEqual([
    { joint: "hips", candidates: ["DEF-spine", "hips"] },
  ]);
});

const asf = {
  hips: "root",
  spine: "lowerback",
  chest: "upperback",
  upperChest: "thorax",
  neck: "lowerneck",
  head: "head",
  lShoulder: "lclavicle",
  lArm: "lhumerus",
  lForearm: "lradius",
  lHand: "lhand",
  rShoulder: "rclavicle",
  rArm: "rhumerus",
  rForearm: "rradius",
  rHand: "rhand",
  lThigh: "lfemur",
  lShin: "ltibia",
  lFoot: "lfoot",
  rThigh: "rfemur",
  rShin: "rtibia",
  rFoot: "rfoot",
};

it("recognises a CMU ASF skeleton, whose hips joint carries both hip joints", () => {
  const { group, joints, roles } = body(asf, [
    ["lhipjoint", "hips"],
    ["rhipjoint", "hips"],
  ]);
  for (const [key, role] of Object.entries(ROLES))
    expect(roles[role], role).toBe(joints[key]);
  expect(group.userData.rigMappingReport.missing).toEqual([]);
});

it("never takes a bone called root for the hips without the ASF hip joints", () => {
  // Unreal's root is a ground bone above the pelvis; plain "root" means nothing.
  const { roles } = body({ ...asf });
  expect(roles.hips).toBeUndefined();
});
