import { describe, it, expect } from "vitest";
import * as T from "three";
import { allAssets, starterScene, type Scene } from "../shared/scene";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
} from "../src/world";
import {
  configureImportedRig,
  humanoidWarning,
  standingHeight,
  rotateHumanoidJoint,
  humanoidJointOrientation,
  applyHumanoidPose,
  applyTransferredClip,
  sampleNativeClip,
} from "../src/rig";
import { applyInteractions } from "../src/interactions";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

const point = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
it("normalizes sampled rotation rounding before native skinning and retargeting", () => {
  const group = new T.Group(),
    parent = new T.Group(),
    bone = new T.Bone();
  group.add(parent);
  parent.add(bone);
  group.userData.mixer = new T.AnimationMixer(group);
  const rotation = new T.Quaternion().setFromEuler(new T.Euler(0.4, -0.2, 0.7));
  const rounded = rotation.toArray().map((value) => value * (1 + 2e-7));
  const clip = new T.AnimationClip("Rounded source", 1, [
    new T.QuaternionKeyframeTrack(
      `${parent.uuid}.quaternion`,
      [0, 1],
      [...rounded, ...rounded],
    ),
    new T.QuaternionKeyframeTrack(
      `${bone.uuid}.quaternion`,
      [0, 1],
      [...rounded, ...rounded],
    ),
  ]);
  for (const time of [0, 0.4, 1, 0.4]) {
    sampleNativeClip(group, clip, time);
    group.updateMatrixWorld(true);
    expect(parent.quaternion.length()).toBeCloseTo(1, 13);
    expect(bone.quaternion.length()).toBeCloseTo(1, 13);
    expect(
      bone.localToWorld(new T.Vector3(0.3, 0.4, 0.5)).length(),
    ).toBeCloseTo(Math.sqrt(0.5), 12);
  }
});
it("measures fallback rig proportions from neutral offsets after translated poses", () => {
  const scene = starterScene();
  const actor = scene.entities[0];
  const group = withRecordedSources(
    createCharacter(allAssets(scene).find((a) => a.id === actor.assetId)!),
    recordedSourceMap,
  );
  const original = standingHeight(group);
  group.userData.bones.leftLeg.position.y += 0.03;
  group.userData.bones.leftShin.position.y -= 0.02;
  expect(standingHeight(group)).toBe(original);
});
function fixture(tPose = false, rolls = false) {
  const scene = starterScene(),
    entity = scene.entities[0];
  entity.position = [0, 0, 0];
  entity.rotation = 0;
  entity.clips = [];
  const source = withRecordedSources(
    createCharacter(allAssets(scene).find((a) => a.id === entity.assetId)!),
    recordedSourceMap,
  );
  const bones = source.userData.bones as Record<string, T.Bone>;
  if (tPose) {
    bones.leftArm.rotation.z = Math.PI / 2;
    bones.rightArm.rotation.z = -Math.PI / 2;
  }
  if (rolls)
    for (const [i, bone] of Object.values(bones).entries()) {
      const roll = new T.Quaternion().setFromEuler(
        new T.Euler(0.4 + i * 0.1, -0.3, 0.7),
      );
      bone.quaternion.multiply(roll);
      for (const child of bone.children) {
        child.position.applyQuaternion(roll.clone().invert());
        child.quaternion.premultiply(roll.clone().invert());
      }
    }
  // The configured imported rig is the performer: studio actions play on
  // it from the recorded source skeletons.
  const group = withRecordedSources(new T.Group(), recordedSourceMap);
  group.add(source);
  group.updateMatrixWorld(true);
  const configure = (animations: T.AnimationClip[] = []) =>
    configureImportedRig(group, source, animations);
  const sample = (time: number) => {
    applyAnimatedEntityPose(group, entity, scene, time);
    group.updateWorldMatrix(true, true);
  };
  return { scene, entity, group, source, bones, configure, sample };
}
function native(scene: Scene, name: string, duration = 2) {
  scene.customMotions.push({
    id: name,
    name,
    kind: "imported",
    duration,
    poses: [],
    distance: 0,
    sourceAssetId: scene.entities[0].assetId,
    animationName: name,
  });
  return { id: crypto.randomUUID(), motionId: name, duration };
}
describe("imported humanoid calibration", () => {
  it("transfers a straight captured stance from splayed, bent bind legs without crossing the receiver's legs", () => {
    const source = fixture(true),
      target = fixture(true, true);
    for (const f of [source, target])
      for (const side of ["left", "right"]) {
        const shin = f.bones[side + "Shin"],
          foot = new T.Bone();
        foot.name = side + "Foot";
        // Place the endpoint independently of the receiver's bone rolls.
        foot.position.copy(
          shin.worldToLocal(point(shin).add(new T.Vector3(0, -0.35, 0))),
        );
        shin.add(foot);
      }
    for (const [side, sign] of [
      ["left", 1],
      ["right", -1],
    ] as const) {
      source.bones[side + "Leg"].rotation.z = sign * 0.35;
      source.bones[side + "Shin"].rotation.x = -0.18;
    }
    const clip = new T.AnimationClip("Standing turn", 1, [
      new T.QuaternionKeyframeTrack(
        "hips.quaternion",
        [0, 1],
        [
          0,
          0,
          0,
          1,
          ...new T.Quaternion()
            .setFromAxisAngle(new T.Vector3(0, 1, 0), 0.8)
            .toArray(),
        ],
      ),
      ...["leftLeg", "rightLeg", "leftShin", "rightShin"].map(
        (name) =>
          new T.QuaternionKeyframeTrack(
            name + ".quaternion",
            [0, 1],
            [0, 0, 0, 1, 0, 0, 0, 1],
          ),
      ),
    ]);
    source.group.updateMatrixWorld(true);
    const bind = Object.values(source.bones).map((bone) =>
      bone.matrixWorld.clone(),
    );
    source.configure([clip]);
    target.configure();
    for (const time of [0, 0.5, 1, 0.2]) {
      target.group.position.set(0, 0, 0);
      applyHumanoidPose(target.group, {}, true);
      expect(applyTransferredClip(source.group, target.group, clip, time)).toBe(
        "",
      );
      for (const side of ["left", "right"]) {
        const direction = point(target.bones[side + "Shin"])
          .sub(point(target.bones[side + "Leg"]))
          .normalize();
        expect(direction.distanceTo(new T.Vector3(0, -1, 0))).toBeLessThan(
          1e-6,
        );
        const lower = point(target.group.userData.bones[side + "Foot"])
          .sub(point(target.bones[side + "Shin"]))
          .normalize();
        expect(lower.distanceTo(new T.Vector3(0, -1, 0))).toBeLessThan(1e-6);
      }
    }
    // Calibration must not rewrite the original bind transforms or source motion.
    source.group.userData.mixer.stopAllAction();
    applyHumanoidPose(source.group, {}, true);
    source.group.updateMatrixWorld(true);
    Object.values(source.bones).forEach((bone, index) => {
      bone.matrixWorld.elements.forEach((value, i) =>
        expect(value).toBeCloseTo(bind[index].elements[i], 10),
      );
    });
    sampleNativeClip(source.group, clip, 0);
    for (const side of ["left", "right"])
      expect(point(source.bones[side + "Shin"]).x).toBeCloseTo(
        point(source.bones[side + "Leg"]).x,
        10,
      );
  });
  it("carries a detached hand's sampled offset with additive forearm attention", () => {
    const f = fixture();
    const hand = new T.Bone();
    hand.name = "leftHand";
    hand.add(
      new T.Mesh(
        new T.BoxGeometry(0.05, 0.08, 0.03),
        new T.MeshBasicMaterial(),
      ),
    );
    f.source.add(hand);
    hand.position.copy(
      f.source.worldToLocal(
        f.bones.leftForearm.localToWorld(new T.Vector3(0, -0.3, 0)),
      ),
    );
    f.configure();
    expect(f.group.userData.bones.leftHand).toBe(hand);
    f.sample(0);
    hand.position.x += 0.02;
    hand.rotation.y += 0.1;
    const offset = f.bones.leftForearm.worldToLocal(point(hand));
    const rotation = f.bones.leftForearm
      .getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(hand.getWorldQuaternion(new T.Quaternion()));
    rotateHumanoidJoint(
      f.group,
      "leftForearm",
      new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -0.4),
    );
    expect(
      f.bones.leftForearm.worldToLocal(point(hand)).distanceTo(offset),
    ).toBeLessThan(1e-10);
    expect(
      f.bones.leftForearm
        .getWorldQuaternion(new T.Quaternion())
        .invert()
        .multiply(hand.getWorldQuaternion(new T.Quaternion()))
        .angleTo(rotation),
    ).toBeLessThan(1e-7);
  });
  it("applies additive attention in anatomical space on rolled provider bones without changing the legs", () => {
    const plain = fixture(true),
      rolled = fixture(true, true);
    for (const f of [plain, rolled]) {
      f.configure();
      f.sample(0);
      const legs = [
        "hips",
        "leftLeg",
        "leftShin",
        "rightLeg",
        "rightShin",
      ].flatMap((n) => [...f.bones[n].matrixWorld.elements]);
      for (const name of [
        "spine",
        "head",
        "rightArm",
        "rightForearm",
      ] as const) {
        const before = humanoidJointOrientation(f.group, name)!;
        const delta = new T.Quaternion().setFromEuler(
          new T.Euler(0.12, -0.2, 0.07),
        );
        rotateHumanoidJoint(f.group, name, delta);
        expect(
          humanoidJointOrientation(f.group, name)!.angleTo(
            before.multiply(delta),
          ),
        ).toBeLessThan(1e-7);
      }
      f.group.updateWorldMatrix(true, true);
      expect(
        ["hips", "leftLeg", "leftShin", "rightLeg", "rightShin"].flatMap(
          (n) => [...f.bones[n].matrixWorld.elements],
        ),
      ).toEqual(legs);
    }
    for (const name of Object.keys(plain.bones))
      expect(
        point(plain.bones[name]).distanceTo(point(rolled.bones[name])),
      ).toBeLessThan(1e-6);
  });
  it.each(["suffix", "prefix", "semantic"])(
    "maps %s anatomical conventions without capturing helpers",
    (convention) => {
      const f = fixture(true, true);
      const parts: Record<string, string> = {
        Arm: "upperarm",
        Forearm: "lowerarm",
        Leg: "upperleg",
        Shin: "lowerleg",
      };
      for (const [name, bone] of Object.entries(f.bones)) {
        const match = name.match(/^(left|right)(Arm|Forearm|Leg|Shin)$/);
        if (!match) continue;
        const part = parts[match[2]],
          side = match[1];
        bone.name =
          convention === "semantic"
            ? side + part
            : convention === "suffix"
              ? part + "." + side[0].toUpperCase()
              : side[0] + "_" + part;
        const helper = new T.Bone();
        helper.name = bone.name + "_twist";
        bone.add(helper);
      }
      f.configure();
      for (const [name, bone] of Object.entries(f.bones))
        expect(f.group.userData.bones[name]).toBe(bone);
      expect(humanoidWarning(f.group, "Actor", false)).toBe("");
      f.sample(0);
      expect(point(f.bones.leftForearm).y).toBeLessThan(
        point(f.bones.leftArm).y,
      );
    },
  );
  it("reports ambiguous anatomical joints instead of choosing by traversal order", () => {
    const f = fixture();
    const duplicate = new T.Bone();
    duplicate.name = "OtherRig:LeftUpperArm";
    f.source.add(duplicate);
    f.configure();
    expect(f.group.userData.bones.leftArm).toBeUndefined();
    expect(humanoidWarning(f.group, "Actor", false)).toContain(
      "Ambiguous joints: leftArm",
    );
    expect(humanoidWarning(f.group, "Actor", false)).toContain(
      "OtherRig:LeftUpperArm",
    );
    expect(humanoidWarning(f.group, "Actor", true)).toBe("");
  });
  it("leaves an incompatible imported rig at the base instead of attempting a climb", () => {
    const f = fixture();
    f.source.scale.y = 1.1;
    f.scene.entities = [
      f.entity,
      {
        ...f.scene.entities[3],
        id: "ladder",
        name: "Ladder",
        assetId: "ladder",
        position: [0, 0, 0],
        clips: [],
      },
    ];
    f.entity.clips = [
      { id: "climb", motionId: "climb", duration: 6, targetId: "ladder" },
    ];
    f.configure();
    f.sample(4);
    expect(f.group.position.toArray()).toEqual(f.entity.position);
    expect(f.group.userData.climb.plan.warning).toContain("recognizable");
  });
  it("places all four climbing contacts on an imported T-pose rig with rotated bone axes", () => {
    const f = fixture(true, true);
    f.scene.entities = [
      f.entity,
      {
        ...f.scene.entities[3],
        id: "ladder",
        name: "Ladder",
        assetId: "ladder",
        position: [0, 0, 0],
        clips: [],
      },
    ];
    f.entity.position = [0.8, 0, 1.5];
    f.entity.clips = [
      { id: "climb", motionId: "climb", duration: 6, targetId: "ladder" },
    ];
    f.configure();
    const objects = new Map([
      [f.entity.id, f.group],
      ["ladder", createProp("ladder", "#777777")],
    ]);
    for (let time = 1.8; time <= 6; time += 0.12) {
      f.sample(time);
      expect(applyInteractions(f.scene, time, objects)).toEqual([]);
      for (const side of ["left", "right"])
        for (const hand of [true, false]) {
          const key = side + (hand ? "Hand" : "Foot");
          const point = f.bones[
            side + (hand ? "Forearm" : "Shin")
          ].localToWorld(
            f.group.userData.contacts[
              key === "rightHand" ? "hand" : key
            ].clone(),
          );
          expect(
            point.distanceTo(
              new T.Vector3(...f.group.userData.climb.contacts[key]),
            ),
          ).toBeLessThan(1e-5);
        }
    }
  });
  it("keeps targeted cup contact on a calibrated T-pose rig with rotated axes", () => {
    const f = fixture(true, true),
      cup = f.scene.entities.find((e) => e.assetId === "cup")!;
    cup.position = [0, 1.01, 0.2];
    f.scene.entities = [f.entity, cup];
    f.entity.clips = [
      { id: "pick", motionId: "pick", duration: 2, targetId: cup.id },
      { id: "sip", motionId: "sip", duration: 3, targetId: cup.id },
      { id: "place", motionId: "place", duration: 2, targetId: cup.id },
    ];
    f.configure();
    const prop = createProp("cup", cup.color),
      objects = new Map([
        [f.entity.id, f.group],
        [cup.id, prop],
      ]);
    for (const time of [0.8, 1.5, 2, 3.5, 5, 6.25]) {
      f.sample(time);
      applyAnimatedEntityPose(prop, cup, f.scene, time);
      expect(applyInteractions(f.scene, time, objects)).toEqual([]);
      expect(
        prop
          .localToWorld(new T.Vector3(0.13, 0.08, 0))
          .distanceTo(
            f.bones.rightForearm.localToWorld(
              f.group.userData.contacts.hand.clone(),
            ),
          ),
      ).toBeLessThan(1e-5);
    }
  });
  it("maps namespaced humanoids and relaxes a T-pose without changing the skin binding", () => {
    const { entity, source, bones, configure, sample, group } = fixture(true);
    const skin = source.children.find(
      (o) => o instanceof T.SkinnedMesh,
    ) as T.SkinnedMesh;
    const inverses = skin.skeleton.boneInverses.map((m) => [...m.elements]);
    const names: Record<string, string> = {
      leftLeg: "LeftUpLeg",
      rightLeg: "RightUpLeg",
      leftShin: "LeftLeg",
      rightShin: "RightLeg",
    };
    for (const [name, bone] of Object.entries(bones))
      bone.name =
        "Armature|mixamorig:" +
        (names[name] || name[0].toUpperCase() + name.slice(1));
    configure();
    sample(0);
    expect(Object.keys(group.userData.bones)).toHaveLength(11);
    for (const side of ["left", "right"]) {
      const direction = point(bones[side + "Forearm"])
        .sub(point(bones[side + "Arm"]))
        .normalize();
      expect(direction.distanceTo(new T.Vector3(0, -1, 0))).toBeLessThan(1e-6);
    }
    // The recorded Wave hello lifts the relaxed arm until the elbow is
    // level with the shoulder, exactly as on an unmodified rig.
    const reference = fixture();
    for (const f of [{ entity, configure }, reference]) {
      f.entity.clips = [
        { id: "wave", motionId: "wave", duration: 2.48, playbackRate: 1 },
      ];
      f.configure();
    }
    sample(0.6);
    reference.sample(0.6);
    expect(
      point(bones.rightForearm).y - point(bones.rightArm).y,
    ).toBeGreaterThan(-0.03);
    for (const name of Object.keys(bones))
      expect(
        point(bones[name]).distanceTo(point(reference.bones[name])),
        name,
      ).toBeLessThan(1e-5);
    expect(skin.skeleton.boneInverses.map((m) => m.elements)).toEqual(inverses);
  });
  it("produces equivalent joint trajectories with rotated bone axes and helper bones", () => {
    const reference = fixture(false, false),
      imported = fixture(true, true);
    // A helper may sit between mapped joints; it must not receive the same
    // parent rotation twice when reconstructing the anatomical pose.
    const head = imported.bones.head,
      parent = head.parent!;
    const helper = new T.Bone();
    helper.name = "NeckHelper";
    parent.add(helper);
    helper.add(head);
    for (const f of [reference, imported]) {
      f.entity.clips = [
        { id: "walk", motionId: "walk", duration: 3 },
        { id: "wave", motionId: "wave", duration: 3 },
      ];
      f.entity.rotation = 0.6;
      f.entity.scale = 1.3;
      f.configure();
    }
    for (const time of [0, 0.3, 0.6, 1.2, 3.75, 4.5, 6, 0.6]) {
      reference.sample(time);
      imported.sample(time);
      for (const name of Object.keys(reference.bones))
        expect(
          point(imported.bones[name]).distanceTo(point(reference.bones[name])),
          name,
        ).toBeLessThan(1e-5);
    }
  });
  it("preserves an original native pose and restores the calibrated pose when scrubbing back", () => {
    const f = fixture(true, true);
    const q = f.bones.rightArm.quaternion
      .clone()
      .multiply(
        new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 0.5),
      );
    const clip = new T.AnimationClip("Original", 2, [
      new T.QuaternionKeyframeTrack(
        "rightArm.quaternion",
        [0, 2],
        [...q.toArray(), ...q.toArray()],
      ),
    ]);
    f.entity.clips = [
      { id: "wave", motionId: "wave", duration: 3 },
      native(f.scene, "Original"),
    ];
    f.configure([clip]);
    f.sample(1.5);
    const before = point(f.bones.rightForearm);
    f.sample(4);
    expect(
      f.bones.rightArm.quaternion
        .clone()
        .normalize()
        .angleTo(q.clone().normalize()),
    ).toBeLessThan(1e-6);
    f.sample(1.5);
    expect(point(f.bones.rightForearm).distanceTo(before)).toBeLessThan(1e-6);
  });
  it("keeps an unknown skeleton's native animation usable and explains unsupported studio actions", () => {
    const f = fixture();
    f.bones.rightArm.name = "unmapped-arm";
    const rotation = new T.Quaternion().setFromAxisAngle(
      new T.Vector3(1, 0, 0),
      0.4,
    );
    const clip = new T.AnimationClip("Original", 2, [
      new T.QuaternionKeyframeTrack(
        "spine.quaternion",
        [0, 2],
        [...rotation.toArray(), ...rotation.toArray()],
      ),
    ]);
    f.configure([clip]);
    f.entity.clips = [{ id: "walk", motionId: "walk", duration: 3 }];
    f.sample(1);
    expect(f.group.userData.motionWarning).toContain("original actions");
    f.entity.clips = [native(f.scene, "Original")];
    f.sample(1);
    expect(f.group.userData.motionWarning).toBe("");
    expect(f.bones.spine.rotation.x).toBeCloseTo(0.4, 5);
    f.entity.clips = [];
    f.sample(0);
    expect(f.group.userData.motionWarning).toBe("");
  });
});

describe("native animation travel in action chains", () => {
  it("retains ancestor/root movement across repeated native clips and the next studio action", () => {
    const f = fixture();
    f.source.name = "ImportedRoot";
    const clip = new T.AnimationClip("Travel", 2, [
      new T.VectorKeyframeTrack(
        f.source.uuid + ".position",
        [0, 2],
        [4, 0, 3, 4, 0, 5],
      ),
    ]);
    f.entity.clips = [
      native(f.scene, "Travel"),
      { id: "second", motionId: "Travel", duration: 4 },
      { id: "walk", motionId: "walk", duration: 3, playbackRate: 1 },
    ];
    f.entity.rotation = Math.PI / 2;
    f.entity.scale = 1.5;
    f.entity.position = [1, 0, -2];
    f.configure([clip]);
    const chain = f.entity.clips;
    // The recorded Walk performed alone from where the native travel ends.
    const alone = (time: number) => {
      f.entity.clips = chain.slice(2);
      f.entity.position = [7, 0, -2];
      f.sample(time);
      f.entity.clips = chain;
      f.entity.position = [1, 0, -2];
      return point(f.bones.hips);
    };
    for (const [time, x] of [
      [0, 1],
      [1, 2.5],
      [2, 4],
      [4, 5.5],
      [6, 7],
      [9],
      [7.5],
      [1, 2.5],
    ]) {
      const expected = x === undefined ? alone(time - 6) : undefined;
      f.sample(time);
      if (expected) {
        expect(point(f.bones.hips).distanceTo(expected)).toBeLessThan(1e-5);
        continue;
      }
      expect(point(f.bones.hips).x).toBeCloseTo(x, 5);
      expect(point(f.bones.hips).z).toBeCloseTo(-2, 5);
    }
    // The walk carries on along the facing (+X), at the actor's scale.
    f.sample(9);
    expect(point(f.bones.hips).x).toBeGreaterThan(7 + 1.5 * 2);
    expect(Math.abs(point(f.bones.hips).z + 2)).toBeLessThan(1);
    f.sample(2 - 1e-6);
    const before = point(f.bones.hips);
    f.sample(2 + 1e-6);
    expect(point(f.bones.hips).distanceTo(before)).toBeLessThan(1e-5);
  });
  it("uses foot height to keep a crouching animation from creating vertical travel", () => {
    const f = fixture();
    // Lower hips and move the shins oppositely: the feet remain at the same height.
    const clip = new T.AnimationClip("Crouch", 2, [
      new T.VectorKeyframeTrack(
        "hips.position",
        [0, 2],
        [0, 0.9, 0, 0, 0.6, 0],
      ),
      ...["leftShin", "rightShin"].map(
        (side) =>
          new T.VectorKeyframeTrack(
            side + ".position",
            [0, 2],
            [0, -0.4, 0, 0, -0.1, 0],
          ),
      ),
    ]);
    f.entity.clips = [
      native(f.scene, "Crouch"),
      { id: "idle", motionId: "idle", duration: 3 },
    ];
    f.configure([clip]);
    // The recorded idle that follows starts on the same floor as when it
    // is performed alone: the crouch added no vertical travel.
    const chain = f.entity.clips;
    f.entity.clips = chain.slice(1);
    f.sample(0);
    const standing = f.group.position.y,
      hips = point(f.bones.hips).y;
    expect(Math.abs(standing)).toBeLessThan(0.05);
    f.entity.clips = chain;
    f.sample(2);
    expect(f.group.position.y).toBeCloseTo(standing, 5);
    expect(point(f.bones.hips).y).toBeCloseTo(hips, 5);
  });
});
