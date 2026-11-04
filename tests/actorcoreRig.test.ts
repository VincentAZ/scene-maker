import { describe, expect, it } from "vitest";
import * as T from "three";
import { boneNames, characters, starterScene } from "../shared/scene";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";
import {
  applyHumanoidPose,
  configureImportedRig,
  humanoidWarning,
  nativeRootMotion,
  setMotionSources,
  transferWarning,
} from "../src/rig";
import { locomotionScale } from "../src/locomotion";
import { roleMotion } from "../shared/motionLibrary";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

const point = (object: T.Object3D) => object.getWorldPosition(new T.Vector3());
const direction = (upper: T.Bone, lower: T.Bone) =>
  point(lower).sub(point(upper)).normalize();
const expectedNames = {
  hips: "CC_Base_Hip",
  spine: "CC_Base_Spine01",
  head: "CC_Base_Head",
  leftArm: "CC_Base_L_Upperarm",
  leftForearm: "CC_Base_L_Forearm",
  leftHand: "CC_Base_L_Hand",
  rightArm: "CC_Base_R_Upperarm",
  rightForearm: "CC_Base_R_Forearm",
  rightHand: "CC_Base_R_Hand",
  leftLeg: "CC_Base_L_Thigh",
  leftShin: "CC_Base_L_Calf",
  leftFoot: "CC_Base_L_Foot",
  rightLeg: "CC_Base_R_Thigh",
  rightShin: "CC_Base_R_Calf",
  rightFoot: "CC_Base_R_Foot",
};

// Representative subset of the hierarchy inspected with Blender in the supplied
// motion-dummy-male-643082.fbx. The party, toon-goon and female dummy exports
// use the same names and branches. Positions are rounded Blender head_local
// coordinates in centimeters; bone frames are deliberately varied below.
// No proprietary FBX or local asset data is required to run these regressions.
function fixture(rename = (name: string) => name, rollOffset = 0) {
  // Studio actions play on the rig from the recorded source skeletons.
  const group = withRecordedSources(new T.Group(), recordedSourceMap),
    imported = new T.Group();
  group.add(imported);
  const joints: Record<string, T.Bone> = {};
  const add = (
    name: string,
    parent: string | null,
    [x, y, z]: [number, number, number],
  ) => {
    const bone = new T.Bone();
    bone.name = rename(name);
    const world = new T.Vector3(x, z, -y).multiplyScalar(0.01);
    const ancestor = parent ? joints[parent] : imported;
    bone.position.copy(ancestor.worldToLocal(world));
    ancestor.add(bone);
    joints[name] = bone;
    group.updateWorldMatrix(true, true);
  };
  add("root", null, [0, 0, 0]);
  add("CC_Base_Hip", "root", [0, 0, 99.786]);
  add("CC_Base_Pelvis", "CC_Base_Hip", [0, 0, 99.786]);
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    const name = (part: string) => `CC_Base_${side}_${part}`;
    add(name("Thigh"), "CC_Base_Pelvis", [sign * 9.364, 0.294, 97.827]);
    // Visit helper branches before the downstream anatomical joints.
    add(name("ThighTwist01"), name("Thigh"), [sign * 9.364, 0.294, 97.827]);
    add(name("ThighTwist02"), name("ThighTwist01"), [
      sign * 8.946,
      1.258,
      75.194,
    ]);
    add(name("Calf"), name("Thigh"), [sign * 8.528, 2.221, 52.56]);
    add(name("CalfTwist01"), name("Calf"), [sign * 8.528, 2.221, 52.56]);
    add(name("CalfTwist02"), name("CalfTwist01"), [
      sign * 8.114,
      2.488,
      29.094,
    ]);
    add(name("KneeShareBone"), name("Calf"), [sign * 8.528, 2.221, 52.56]);
    add(name("Foot"), name("Calf"), [sign * 7.701, 2.755, 5.629]);
    add(name("ToeBaseShareBone"), name("Foot"), [sign * 9.277, -12.113, 2.1]);
    add(name("ToeBase"), name("Foot"), [sign * 9.277, -12.113, 2.1]);
  }
  add("CC_Base_Waist", "CC_Base_Hip", [0, -1.533, 107.844]);
  add("CC_Base_Spine01", "CC_Base_Waist", [0, -2.569, 112.166]);
  add("CC_Base_Spine02", "CC_Base_Spine01", [0, -0.76, 126.651]);
  add("CC_Base_NeckTwist01", "CC_Base_Spine02", [0, 4.785, 154.922]);
  add("CC_Base_NeckTwist02", "CC_Base_NeckTwist01", [0, 3.658, 158.647]);
  add("CC_Base_Head", "CC_Base_NeckTwist02", [0, 2.804, 163.302]);
  add("CC_Base_FacialBone", "CC_Base_Head", [0, 2.804, 163.302]);
  add("CC_Base_JawRoot", "CC_Base_FacialBone", [0, 0.219, 164.236]);
  add("CC_Base_Tongue01", "CC_Base_JawRoot", [0, -3.117, 163.249]);
  for (const [side, sign] of [
    ["L", 1],
    ["R", -1],
  ] as const) {
    const name = (part: string) => `CC_Base_${side}_${part}`;
    add(name("Eye"), "CC_Base_FacialBone", [sign * 3.173, -5.254, 170.137]);
    add(name("Clavicle"), "CC_Base_Spine02", [sign * 5.888, 3.627, 149.281]);
    add(name("Upperarm"), name("Clavicle"), [sign * 18.533, 6.544, 149.271]);
    add(name("UpperarmTwist01"), name("Upperarm"), [
      sign * 18.533,
      6.544,
      149.271,
    ]);
    add(name("UpperarmTwist02"), name("UpperarmTwist01"), [
      sign * 30.081,
      6.4,
      142.379,
    ]);
    add(name("Forearm"), name("Upperarm"), [sign * 41.629, 6.256, 135.488]);
    add(name("ForearmTwist01"), name("Forearm"), [
      sign * 41.629,
      6.256,
      135.488,
    ]);
    add(name("ForearmTwist02"), name("ForearmTwist01"), [
      sign * 52.649,
      6.304,
      128.89,
    ]);
    add(name("ElbowShareBone"), name("Forearm"), [
      sign * 41.629,
      6.256,
      135.488,
    ]);
    add(name("Hand"), name("Forearm"), [sign * 63.669, 6.354, 122.294]);
    add(name("Index1"), name("Hand"), [sign * 71.721, 3.24, 118.044]);
  }
  for (const [i, bone] of Object.values(joints).entries()) {
    const roll = new T.Quaternion().setFromEuler(
      new T.Euler(0.2 + rollOffset + i * 0.03, -0.3, 0.4),
    );
    bone.quaternion.multiply(roll);
    for (const child of bone.children) {
      child.position.applyQuaternion(roll.clone().invert());
      child.quaternion.premultiply(roll.clone().invert());
    }
  }
  group.updateWorldMatrix(true, true);
  const skeleton = new T.Skeleton(Object.values(joints));
  const inverses = skeleton.boneInverses.map((matrix) =>
    matrix.elements.slice(),
  );
  const bind = Object.values(joints).map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
  }));
  const configure = (clips: T.AnimationClip[] = []) =>
    configureImportedRig(group, imported, clips);
  const scene = starterScene(),
    actor = scene.entities[0];
  scene.entities = [actor];
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.scale = 1;
  actor.clips = [];
  const sample = (time: number, target = group) => {
    applyAnimatedEntityPose(target, actor, scene, time);
    target.updateWorldMatrix(true, true);
  };
  return {
    group,
    joints,
    skeleton,
    inverses,
    bind,
    configure,
    scene,
    actor,
    sample,
  };
}

describe("native ActorCore / Character Creator humanoid mapping", () => {
  it.each([
    ["native", (name: string) => name],
    ["namespaced", (name: string) => `Armature|Character:${name}`],
    [
      "separator/case normalization",
      (name: string) => name.replaceAll("_", "-").toLowerCase(),
    ],
  ])(
    "recognizes %s CC joints without selecting helper, twist or facial bones",
    (_label, rename) => {
      const f = fixture(rename);
      f.configure();
      expect(humanoidWarning(f.group, "ActorCore", false)).toBe("");
      expect(Object.keys(f.group.userData.bones).sort()).toEqual(
        Object.keys(expectedNames).sort(),
      );
      for (const [canonical, original] of Object.entries(expectedNames))
        expect(f.group.userData.bones[canonical], canonical).toBe(
          f.joints[original],
        );
      // Calibration must restore all original transforms, including helper joints.
      for (const { bone, position, quaternion } of f.bind) {
        expect(bone.position.equals(position), bone.name).toBe(true);
        expect(bone.quaternion.equals(quaternion), bone.name).toBe(true);
      }
      expect(f.skeleton.boneInverses.map((matrix) => matrix.elements)).toEqual(
        f.inverses,
      );
      for (const side of ["left", "right"]) {
        const bones = f.group.userData.bones;
        const key = side === "right" ? "hand" : "leftHand";
        expect(
          bones[side + "Forearm"]
            .localToWorld(f.group.userData.contacts[key].clone())
            .distanceTo(point(bones[side + "Hand"])),
        ).toBeLessThan(1e-8);
        expect(
          bones[side + "Shin"]
            .localToWorld(f.group.userData.contacts[side + "Foot"].clone())
            .distanceTo(point(bones[side + "Foot"])),
        ).toBeLessThan(1e-8);
      }
    },
  );

  it.each([
    "hips",
    "spine",
    "head",
    "leftArm",
    "leftForearm",
    "rightArm",
    "rightForearm",
    "leftLeg",
    "leftShin",
    "rightLeg",
    "rightShin",
  ] as const)(
    "does not substitute a helper when the %s joint is missing",
    (name) => {
      const f = fixture();
      f.joints[expectedNames[name]].name = "UnrecognizedJoint";
      f.configure();
      expect(f.group.userData.bones[name]).toBeUndefined();
      expect(humanoidWarning(f.group, "ActorCore", false)).toContain(
        "original actions",
      );
      expect(humanoidWarning(f.group, "ActorCore", true)).toBe("");
    },
  );

  it("plays canonical walk and wave actions without warnings and scrubs back deterministically", () => {
    const f = fixture();
    f.configure();
    const bones = f.group.userData.bones;
    // The calibrated rest relaxes the T-pose: the arms hang straight down.
    f.sample(0);
    for (const side of ["left", "right"]) {
      expect(
        direction(bones[side + "Arm"], bones[side + "Forearm"]).distanceTo(
          new T.Vector3(0, -1, 0),
        ),
      ).toBeLessThan(1e-6);
      expect(
        direction(bones[side + "Forearm"], bones[side + "Hand"]).distanceTo(
          new T.Vector3(0, -1, 0),
        ),
      ).toBeLessThan(1e-6);
    }
    const rest = point(bones.rightHand).y;
    f.actor.clips = [
      { id: "walk", motionId: "walk", duration: 4, playbackRate: 1 },
      { id: "wave", motionId: "wave", duration: 3, playbackRate: 1 },
    ];
    // 1.1 s into the recorded Walk the left thigh swings well out of its
    // bind orientation.
    f.sample(1.1);
    const walking = boneNames.map((name) => point(bones[name]));
    expect(
      Math.abs(
        bones.leftLeg.quaternion.angleTo(
          f.bind.find(({ bone }) => bone === bones.leftLeg)!.quaternion,
        ),
      ),
    ).toBeGreaterThan(0.3);
    // Half a second into the recorded Wave hello the hand is raised above
    // the shoulder.
    f.sample(4.5);
    expect(f.group.userData.motionWarning).toBe("");
    expect(point(bones.rightHand).y).toBeGreaterThan(
      point(bones.rightArm).y + 0.1,
    );
    expect(point(bones.rightHand).y).toBeGreaterThan(rest + 0.5);
    // By its end the walk travelled its captured distance, scaled to this
    // rig's standing height, along the actor's facing (+Z).
    f.sample(3.9);
    const source = recordedSourceMap.get(roleMotion("walk").sourceAssetId!)!;
    const walked = nativeRootMotion(
      source,
      source.userData.animations[0],
    )!.delta;
    const travel =
      Math.hypot(walked.x, walked.z) * locomotionScale(source, f.group);
    expect(
      Math.abs(Math.hypot(f.group.position.x, f.group.position.z) - travel),
    ).toBeLessThan(0.01 * travel);
    expect(f.group.position.z).toBeGreaterThan(
      5 * Math.abs(f.group.position.x),
    );
    for (const time of [7, 0, 1.1]) {
      f.sample(time);
      expect(f.group.userData.motionWarning).toBe("");
      f.group.traverse((object) =>
        expect(object.matrixWorld.elements.every(Number.isFinite)).toBe(true),
      );
    }
    boneNames.forEach((name, index) =>
      expect(point(bones[name]).distanceTo(walking[index]), name).toBeLessThan(
        1e-7,
      ),
    );
    expect(f.skeleton.boneInverses.map((matrix) => matrix.elements)).toEqual(
      f.inverses,
    );
  });

  it("keeps original animation tracks on native CC names and restores the canonical pose afterwards", () => {
    const f = fixture();
    const arm = f.joints.CC_Base_R_Upperarm;
    const pose = arm.quaternion
      .clone()
      .multiply(new T.Quaternion().setFromEuler(new T.Euler(0.5, 0.2, -0.4)));
    const clip = new T.AnimationClip("Original", 2, [
      new T.QuaternionKeyframeTrack(
        `${arm.name}.quaternion`,
        [0, 2],
        [...pose.toArray(), ...pose.toArray()],
      ),
    ]);
    f.scene.customMotions.push({
      id: "original",
      name: "Original",
      kind: "imported",
      duration: 2,
      poses: [],
      distance: 0,
      sourceAssetId: f.actor.assetId,
      animationName: clip.name,
    });
    f.actor.clips = [
      { id: "wave", motionId: "wave", duration: 3 },
      { id: "original", motionId: "original", duration: 2 },
    ];
    f.configure([clip]);
    f.sample(1.5);
    const before = point(f.joints.CC_Base_R_Forearm);
    f.sample(4);
    expect(f.group.userData.motionWarning).toBe("");
    expect(
      arm.quaternion.clone().normalize().angleTo(pose.clone().normalize()),
    ).toBeLessThan(1e-6);
    f.sample(1.5);
    expect(point(f.joints.CC_Base_R_Forearm).distanceTo(before)).toBeLessThan(
      1e-7,
    );
  });

  it("shares a native CC action onto procedural and imported rigs with different bone axes", () => {
    const source = fixture();
    source.configure();
    const values = Object.fromEntries(
      boneNames.map((name) => [name, [] as number[]]),
    );
    for (const amount of [0, 1, 0]) {
      applyHumanoidPose(
        source.group,
        {
          rightArm: [0, 0, -1.3 * amount],
          rightForearm: [-0.7 * amount, 0, 0],
        },
        false,
      );
      for (const name of boneNames)
        values[name].push(
          ...source.group.userData.bones[name].quaternion.toArray(),
        );
    }
    applyHumanoidPose(source.group, {}, true);
    const clip = new T.AnimationClip("CC wave and travel", 2, [
      ...boneNames.map(
        (name) =>
          new T.QuaternionKeyframeTrack(
            `${source.group.userData.bones[name].name}.quaternion`,
            [0, 1, 2],
            values[name],
          ),
      ),
      new T.VectorKeyframeTrack(
        `${source.joints.root.name}.position`,
        [0, 2],
        [0, 0, 0, 0, 0, 2],
      ),
    ]);
    source.configure([clip]);
    const receiving = fixture((name) => `Receiver:${name}`, -0.6);
    receiving.configure();
    const procedural = withRecordedSources(
      createCharacter(characters[0]),
      recordedSourceMap,
    );
    source.scene.customAssets.push({
      ...characters[0],
      id: "actorcore-source",
      name: "ActorCore source",
      url: "/uploads/actorcore.glb",
    });
    source.scene.customMotions.push({
      id: "cc-shared",
      name: clip.name,
      kind: "imported",
      duration: 2,
      poses: [],
      distance: 0,
      sourceAssetId: "actorcore-source",
      animationName: clip.name,
    });
    source.actor.clips = [{ id: "shared", motionId: "cc-shared", duration: 2 }];
    const native = nativeRootMotion(source.group, clip)!;
    expect(native.delta.distanceTo(new T.Vector3(0, 0, 2))).toBeLessThan(1e-6);
    for (const target of [procedural, receiving.group]) {
      expect(transferWarning(source.group, target, clip)).toBe("");
      setMotionSources(target, new Map([["actorcore-source", source.group]]));
      source.sample(1, target);
      expect(target.userData.motionWarning).toBe("");
      expect(target.position.z).toBeGreaterThan(0.7);
      const raised = point(target.userData.bones.rightForearm);
      expect(raised.y).toBeGreaterThan(
        point(target.userData.bones.rightArm).y - 0.1,
      );
      source.sample(0, target);
      source.sample(1.8, target);
      source.sample(1, target);
      expect(
        point(target.userData.bones.rightForearm).distanceTo(raised),
      ).toBeLessThan(1e-7);
    }
    const upperRotation = new T.Quaternion().setFromEuler(
      new T.Euler(0, 0, -1.3),
    );
    const lowerRotation = upperRotation
      .clone()
      .multiply(new T.Quaternion().setFromEuler(new T.Euler(-0.7, 0, 0)));
    for (const [upper, lower, expected] of [
      ["rightArm", "rightForearm", upperRotation],
      ["rightForearm", "rightHand", lowerRotation],
    ] as const) {
      expect(
        procedural.userData.bones[upper]
          .getWorldQuaternion(new T.Quaternion())
          .angleTo(expected),
      ).toBeLessThan(1e-6);
      expect(
        direction(
          receiving.group.userData.bones[upper],
          receiving.group.userData.bones[lower],
        ).distanceTo(new T.Vector3(0, -1, 0).applyQuaternion(expected)),
      ).toBeLessThan(1e-6);
    }
    expect(
      receiving.skeleton.boneInverses.map((matrix) => matrix.elements),
    ).toEqual(receiving.inverses);
  });
});
