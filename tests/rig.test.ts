import { describe, it, expect } from "vitest";
import * as T from "three";
import { allAssets, starterScene, type Scene } from "../shared/scene";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
} from "../src/world";
import { configureImportedRig } from "../src/rig";
import { applyInteractions } from "../src/interactions";

const point = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
function fixture(tPose = false, rolls = false) {
  const scene = starterScene(),
    entity = scene.entities[0];
  entity.position = [0, 0, 0];
  entity.rotation = 0;
  entity.clips = [];
  const source = createCharacter(
    allAssets(scene).find((a) => a.id === entity.assetId)!,
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
  const group = new T.Group();
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
    entity.clips = [{ id: "wave", motionId: "wave", duration: 3 }];
    sample(1.5);
    expect(point(bones.rightForearm).y).toBeGreaterThan(
      point(bones.rightArm).y,
    );
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
      { id: "walk", motionId: "walk", duration: 3 },
    ];
    f.entity.rotation = Math.PI / 2;
    f.entity.scale = 1.5;
    f.entity.position = [1, 0, -2];
    f.configure([clip]);
    for (const [time, x] of [
      [0, 1],
      [1, 2.5],
      [2, 4],
      [4, 5.5],
      [6, 7],
      [9, 10],
      [1, 2.5],
    ]) {
      f.sample(time);
      expect(point(f.bones.hips).x).toBeCloseTo(x, 5);
      expect(point(f.bones.hips).z).toBeCloseTo(-2, 5);
    }
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
    f.sample(2);
    expect(f.group.position.y).toBeCloseTo(0, 5);
    expect(point(f.bones.hips).y).toBeCloseTo(0.9, 5);
  });
});
