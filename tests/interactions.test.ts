import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  starterScene,
  applyCommands,
  allAssets,
  allMotions,
  validateScene,
  type Scene,
} from "../shared/scene";
import { interactionSessions } from "../shared/interactions";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
} from "../src/world";
import { applyInteractions } from "../src/interactions";
import { configureRigContacts, solveLimb, type RigContacts } from "../src/ik";

function fixture(standalone = false, low = false) {
  const scene = starterScene();
  scene.entities = [scene.entities[0], scene.entities[3]];
  const [actor, cup] = scene.entities;
  actor.position = [0.25, 0, 0];
  actor.rotation = 0;
  actor.clips = [];
  cup.position = [0, low ? 0 : 1.01, 0.2];
  const next = applyCommands(
    scene,
    standalone
      ? [{ type: "chain", id: actor.id, motionId: "sip", targetId: cup.id }]
      : [
          { type: "chain", id: actor.id, motionId: "pick", targetId: cup.id },
          { type: "chain", id: actor.id, motionId: "sip", targetId: cup.id },
          { type: "chain", id: actor.id, motionId: "idle" },
          { type: "chain", id: actor.id, motionId: "place", targetId: cup.id },
        ],
  );
  return { scene: next, actor: next.entities[0], cup: next.entities[1] };
}
function renderer(scene: Scene) {
  const root = new T.Group(),
    objects = new Map<string, T.Group>();
  for (const e of scene.entities) {
    const asset = allAssets(scene).find((a) => a.id === e.assetId)!;
    const object =
      asset.category === "characters"
        ? createCharacter(asset, e.color)
        : createProp(asset.style, e.color, asset.parts);
    root.add(object);
    configureRigContacts(object);
    objects.set(e.id, object);
  }
  const sessions = interactionSessions(scene, allMotions(scene));
  const sample = (time: number) => {
    for (const e of scene.entities)
      applyAnimatedEntityPose(objects.get(e.id)!, e, scene, time);
    root.updateMatrixWorld(true);
    const warnings = applyInteractions(scene, time, objects, sessions);
    root.updateMatrixWorld(true);
    return warnings;
  };
  return { objects, sample };
}
function hand(rig: T.Group) {
  return rig.userData.bones.rightForearm.localToWorld(
    (rig.userData.contacts as RigContacts).hand.clone(),
  ) as T.Vector3;
}
function grip(prop: T.Group) {
  return prop.localToWorld(new T.Vector3(0.13, 0.08, 0));
}

describe("targeted prop choreography", () => {
  it("preserves native animation on the rest of the body while carrying a prop", () => {
    const { scene, actor, cup } = fixture();
    scene.customMotions.push({
      id: "native",
      name: "Native gesture",
      kind: "imported",
      duration: 3,
      distance: 0,
      poses: [],
      sourceAssetId: actor.assetId,
      animationName: "Gesture",
    });
    actor.clips[2].motionId = "native";
    const { objects, sample } = renderer(scene),
      rig = objects.get(actor.id)!,
      bones = rig.userData.bones as Record<string, T.Bone>,
      turn = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 0.9);
    rig.userData.animations = [
      new T.AnimationClip("Gesture", 3, [
        new T.QuaternionKeyframeTrack(
          "leftArm.quaternion",
          [0, 3],
          [0, 0, 0, 1, ...turn.toArray()],
        ),
        new T.VectorKeyframeTrack(
          "hips.position",
          [0, 3],
          [0, 0.9, 0, 0, 0.9, 0.06],
        ),
      ]),
    ];
    rig.userData.mixer = new T.AnimationMixer(rig);
    expect(sample(6)).toEqual([]);
    expect(bones.leftArm.rotation.x).toBeCloseTo(0.3, 5);
    expect(bones.hips.position.z).toBeCloseTo(0.02, 5);
    expect(grip(objects.get(cup.id)!).distanceTo(hand(rig))).toBeLessThan(1e-5);
    const expected = objects.get(cup.id)!.matrixWorld.clone();
    sample(0);
    sample(10);
    sample(6);
    expect(objects.get(cup.id)!.matrixWorld.elements).toEqual(
      expected.elements,
    );
    expect(bones.leftArm.rotation.x).toBeCloseTo(0.3, 5);
  });
  it("reaches before lifting, holds across chained actions and returns the cup only when put down", () => {
    const { scene, actor, cup } = fixture(),
      { objects, sample } = renderer(scene);
    const prop = objects.get(cup.id)!,
      rig = objects.get(actor.id)!;
    for (const t of [0, 0.3, 0.799]) {
      expect(sample(t)).toEqual([]);
      expect(
        prop.position.distanceTo(new T.Vector3(...cup.position)),
      ).toBeLessThan(1e-8);
    }
    for (const t of [0.8, 1.5, 2, 3.5, 5, 7.5, 8, 9.2]) {
      expect(sample(t)).toEqual([]);
      expect(grip(prop).distanceTo(hand(rig))).toBeLessThan(1e-5);
    }
    sample(5);
    expect(
      prop.position.distanceTo(new T.Vector3(...cup.position)),
    ).toBeGreaterThan(0.05);
    sample(10);
    expect(
      prop.position.distanceTo(new T.Vector3(...cup.position)),
    ).toBeLessThan(1e-8);
  });
  it("keeps motion continuous at grasp, action boundaries and release, including reverse scrubbing", () => {
    const { scene, cup } = fixture(),
      { objects, sample } = renderer(scene),
      prop = objects.get(cup.id)!;
    for (const t of [0.8, 2, 5, 8, 9.3, 10]) {
      sample(t - 1e-5);
      const before = prop.position.clone();
      sample(t + 1e-5);
      expect(prop.position.distanceTo(before)).toBeLessThan(0.001);
    }
    sample(3.5);
    const middle = prop.matrixWorld.clone();
    sample(10);
    sample(0);
    sample(3.5);
    expect(prop.matrixWorld.elements).toEqual(middle.elements);
  });
  it("brings the cup rim to the mouth during a sip and preserves grip contact", () => {
    const { scene, actor, cup } = fixture(),
      { objects, sample } = renderer(scene);
    const rig = objects.get(actor.id)!,
      prop = objects.get(cup.id)!;
    sample(3.5);
    const mouth = rig.userData.bones.head
      .getWorldPosition(new T.Vector3())
      .add(new T.Vector3(0, -0.03, 0.18));
    expect(
      prop.localToWorld(new T.Vector3(0, 0.15, -0.04)).distanceTo(mouth),
    ).toBeLessThan(0.03);
    expect(grip(prop).distanceTo(hand(rig))).toBeLessThan(1e-5);
  });
  it("returns a standalone sip to the table without teleporting at either boundary", () => {
    const { scene, cup } = fixture(true),
      { objects, sample } = renderer(scene),
      prop = objects.get(cup.id)!;
    sample(0);
    expect(prop.position.toArray()).toEqual(cup.position);
    sample(1.5);
    expect(prop.position.y).toBeGreaterThan(cup.position[1] + 0.2);
    sample(3);
    expect(prop.position.toArray()).toEqual(cup.position);
  });
  it("crouches for a low prop while keeping feet planted", () => {
    const { scene, actor, cup } = fixture(false, true),
      { objects, sample } = renderer(scene);
    const rig = objects.get(actor.id)!,
      prop = objects.get(cup.id)!,
      contacts = rig.userData.contacts as RigContacts;
    sample(0);
    const feet = ["left", "right"].map(
      (side) =>
        rig.userData.bones[side + "Shin"].localToWorld(
          contacts[(side + "Foot") as "leftFoot" | "rightFoot"]!.clone(),
        ) as T.Vector3,
    );
    expect(sample(0.8)).toEqual([]);
    expect(rig.position.y).toBeLessThan(-0.5);
    expect(grip(prop).distanceTo(hand(rig))).toBeLessThan(1e-5);
    ["left", "right"].forEach((side, i) =>
      expect(
        rig.userData.bones[side + "Shin"]
          .localToWorld(
            contacts[(side + "Foot") as "leftFoot" | "rightFoot"]!.clone(),
          )
          .distanceTo(feet[i]),
      ).toBeLessThan(0.001),
    );
  });
  it("leaves unreachable props in place at every frame and explains how to fix the staging", () => {
    const { scene, cup } = fixture();
    cup.position = [8, 1, 0.2];
    const { objects, sample } = renderer(scene),
      prop = objects.get(cup.id)!;
    for (const time of [0.5, 1, 3.5, 7.5, 9]) {
      expect(sample(time)[0].message).toContain("closer");
      expect(prop.position.toArray()).toEqual(cup.position);
    }
  });
  it("keeps a carried prop in hand when a walk makes its put-down spot unreachable", () => {
    const { scene, actor, cup } = fixture();
    actor.clips[2].motionId = "walk";
    const { objects, sample } = renderer(scene),
      prop = objects.get(cup.id)!,
      rig = objects.get(actor.id)!;
    for (const time of [8, 9.3, 10, 12]) {
      expect(sample(time)[0].message).toContain("still in hand");
      expect(grip(prop).distanceTo(hand(rig))).toBeLessThan(1e-5);
      expect(
        prop.position.distanceTo(new T.Vector3(...cup.position)),
      ).toBeGreaterThan(1);
    }
    sample(9);
    const during = prop.matrixWorld.clone();
    sample(0);
    sample(12);
    sample(9);
    expect(prop.matrixWorld.elements).toEqual(during.elements);
  });
  it("works with a rotated and scaled character/prop pair", () => {
    const { scene, actor, cup } = fixture();
    const rotation = new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      Math.PI / 2,
    );
    for (const e of scene.entities) {
      e.position = new T.Vector3(...e.position)
        .multiplyScalar(1.5)
        .applyQuaternion(rotation)
        .add(new T.Vector3(2, 0, -3))
        .toArray();
      e.rotation = Math.PI / 2;
      e.scale = 1.5;
    }
    const { objects, sample } = renderer(scene);
    expect(sample(1.5)).toEqual([]);
    expect(
      grip(objects.get(cup.id)!).distanceTo(hand(objects.get(actor.id)!)),
    ).toBeLessThan(1e-5);
  });
  it("rejects conflicting ownership and requires a prop target", () => {
    const { scene, actor, cup } = fixture();
    const next = applyCommands(scene, [
      { type: "add", assetId: "leo", id: "other" },
    ]);
    expect(() =>
      applyCommands(next, [
        { type: "chain", id: "other", motionId: "pick", targetId: cup.id },
      ]),
    ).toThrow("same prop");
    expect(() =>
      applyCommands(next, [
        { type: "chain", id: actor.id, motionId: "pick", targetId: "other" },
      ]),
    ).toThrow("Choose a prop");
    const after = applyCommands(next, [
      { type: "chain", id: "other", motionId: "idle", duration: 11 },
      { type: "chain", id: "other", motionId: "pick", targetId: cup.id },
    ]);
    expect(validateScene(after)).toBeDefined();
  });
});
describe("two-bone reach solving", () => {
  it("respects limb lengths and noncanonical rest axes", () => {
    const parent = new T.Group(),
      upper = new T.Bone(),
      lower = new T.Bone();
    parent.rotation.set(0.3, 0.4, 0.2);
    parent.scale.setScalar(1.7);
    parent.add(upper);
    upper.add(lower);
    upper.quaternion.setFromAxisAngle(new T.Vector3(0, 0, 1), 0.8);
    lower.position.set(0.4, 0, 0);
    lower.rotation.y = 0.5;
    parent.updateMatrixWorld(true);
    const tip = new T.Vector3(0.3, 0, 0),
      start = upper.getWorldPosition(new T.Vector3());
    const target = start.clone().add(new T.Vector3(0.5, 0.4, 0.2));
    const result = solveLimb(upper, lower, tip, target, new T.Vector3(0, 0, 1));
    expect(result.error).toBeLessThan(1e-6);
    expect(
      start.distanceTo(lower.getWorldPosition(new T.Vector3())),
    ).toBeCloseTo(0.4 * 1.7);
    expect(
      lower.getWorldPosition(new T.Vector3()).distanceTo(result.hand),
    ).toBeCloseTo(0.3 * 1.7);
  });
});
