import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  applyCommands,
  boneNames,
  characters,
  starterScene,
  validateScene,
} from "../shared/scene";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";
import {
  applyHumanoidPose,
  configureImportedRig,
  setMotionSources,
} from "../src/rig";
import { bakeAnimation } from "../src/bakeAnimation";
import { exportSnapshot } from "../src/exportSnapshot";
import { requiredMotionSources } from "../src/importedAsset";
import { offlinePlan } from "../server/ai";

const world = (object: T.Object3D) => object.getWorldPosition(new T.Vector3());
const turn = (angle: number) =>
  new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), angle);
function imported(tPose: boolean, rollOffset: number) {
  const body = createCharacter(characters[0]),
    group = new T.Group();
  const bones = body.userData.bones as Record<string, T.Bone>;
  if (tPose) {
    bones.leftArm.rotation.z = Math.PI / 2;
    bones.rightArm.rotation.z = -Math.PI / 2;
  }
  for (const [i, bone] of Object.values(bones).entries()) {
    const roll = new T.Quaternion().setFromEuler(
      new T.Euler(0.25 + rollOffset, i * 0.09, -0.35),
    );
    bone.quaternion.multiply(roll);
    for (const child of bone.children) {
      child.position.applyQuaternion(roll.clone().invert());
      child.quaternion.premultiply(roll.clone().invert());
    }
  }
  group.add(body);
  configureImportedRig(group, body, []);
  return { group, body, bones };
}
function fixture() {
  const source = imported(true, 0.3);
  const values = Object.fromEntries(
    boneNames.map((name) => [name, [] as number[]]),
  );
  for (const amount of [0, 1, 0]) {
    applyHumanoidPose(
      source.group,
      {
        rightArm: [0, 0, -1.3 * amount],
        rightForearm: [-0.7 * amount, 0, 0],
        leftLeg: [0.35 * amount, 0, 0],
        rightLeg: [-0.35 * amount, 0, 0],
      },
      false,
    );
    for (const name of boneNames)
      values[name].push(...source.bones[name].quaternion.toArray());
  }
  applyHumanoidPose(source.group, {}, true);
  const clip = new T.AnimationClip("Original turn and wave", 2, [
    ...boneNames.map(
      (name) =>
        new T.QuaternionKeyframeTrack(
          source.bones[name].uuid + ".quaternion",
          [0, 1, 2],
          values[name],
        ),
    ),
    new T.VectorKeyframeTrack(
      source.body.uuid + ".position",
      [0, 1, 2],
      [3, 0, 2, 3.5, 0, 3, 4, 0, 4],
    ),
    new T.QuaternionKeyframeTrack(
      source.body.uuid + ".quaternion",
      [0, 1, 2],
      [Math.PI / 2, (3 * Math.PI) / 4, Math.PI].flatMap((angle) =>
        turn(angle).toArray(),
      ),
    ),
  ]);
  configureImportedRig(source.group, source.body, [clip]);
  const scene = starterScene(),
    actor = scene.entities[0];
  actor.position = [1, 0, -2];
  actor.rotation = -0.4;
  actor.scale = 1.3;
  actor.clips = [
    { id: "shared", motionId: "turn-wave", duration: 4 },
    { id: "walk", motionId: "walk", duration: 4 },
  ];
  scene.entities = [actor];
  scene.customAssets.push({
    ...characters[0],
    id: "original",
    name: "Original body",
    url: "/uploads/original.glb",
  });
  scene.customMotions.push({
    id: "turn-wave",
    name: clip.name,
    kind: "imported",
    duration: 2,
    distance: 0,
    poses: [],
    sourceAssetId: "original",
    animationName: clip.name,
  });
  const target = createCharacter(characters[0]);
  setMotionSources(target, new Map([["original", source.group]]));
  const sample = (time: number, group = target) => {
    applyAnimatedEntityPose(group, actor, scene, time);
    group.updateWorldMatrix(true, true);
  };
  return { source, clip, scene, actor, target, sample };
}
describe("shared imported humanoid actions", () => {
  it("rebases off-center receiving parents and rigid attachments through a source cut", () => {
    const f = fixture(),
      target = imported(false, -0.2);
    target.body.position.set(0.3, 0.1, -0.25);
    target.body.rotation.set(0.1, -0.3, 0.05);
    target.body.scale.setScalar(0.8);
    const attachment = new T.Mesh(new T.BoxGeometry(0.1, 0.2, 0.1));
    attachment.position.set(0.5, 0.8, 0.2);
    target.body.add(attachment);
    configureImportedRig(target.group, target.body, []);
    // An application overlay is not part of the imported bind hierarchy.
    const overlay = new T.Object3D();
    overlay.position.set(0.2, 2, 0.1);
    target.group.add(overlay);
    setMotionSources(target.group, new Map([["original", f.source.group]]));
    const whole = {
      ...f.actor,
      clips: [
        { id: "whole", motionId: "turn-wave", duration: 2, playbackRate: 1 },
      ],
    };
    const split = {
      ...f.actor,
      clips: [
        { id: "first", motionId: "turn-wave", duration: 1, playbackRate: 1 },
        {
          id: "second",
          motionId: "turn-wave",
          duration: 1,
          sourceStart: 1,
          playbackRate: 1,
          transition: "smooth" as const,
        },
      ],
    };
    const nodes: T.Object3D[] = [...Object.values(target.bones), attachment];
    const sample = (actor: typeof whole | typeof split, t: number) => {
      applyAnimatedEntityPose(target.group, actor, f.scene, t);
      target.group.updateMatrixWorld(true);
      expect(overlay.position.toArray()).toEqual([0.2, 2, 0.1]);
      expect(overlay.quaternion.toArray()).toEqual([0, 0, 0, 1]);
      return nodes.map((n) => ({
        p: world(n),
        q: n.getWorldQuaternion(new T.Quaternion()).normalize(),
        v: n.localToWorld(new T.Vector3(0.1, 0.2, -0.1)),
      }));
    };
    for (const t of [0.5, 1, 1.001, 1.125, 1.249, 1.3, 1.7, 1.125]) {
      const a = sample(whole, t),
        b = sample(split, t);
      a.forEach((pose, i) => {
        expect(pose.p.distanceTo(b[i].p)).toBeLessThan(1e-6);
        expect(pose.q.angleTo(b[i].q)).toBeLessThan(1e-6);
        expect(pose.v.distanceTo(b[i].v)).toBeLessThan(1e-6);
      });
    }
  });
  it("allows the same original action on another character and retains its source without a source actor", () => {
    const f = fixture();
    f.actor.clips = [];
    const scene = applyCommands(f.scene, [
      { type: "chain", id: f.actor.id, motionId: "turn-wave" },
    ]);
    expect(scene.entities[0].clips[0].motionId).toBe("turn-wave");
    expect(
      requiredMotionSources(scene, scene.entities[0]).map((a) => a.id),
    ).toEqual(["original"]);
    expect(
      requiredMotionSources(
        { ...scene, entities: [] },
        { ...f.actor, assetId: "original", clips: scene.entities[0].clips },
      ),
    ).toEqual([]);
    expect(() => validateScene({ ...scene, customAssets: [] })).toThrow(
      "original asset",
    );
    const plan = offlinePlan(f.scene, `Mila ${f.clip.name}`, f.actor.id, {});
    expect(plan.steps).toEqual([
      {
        type: "edit",
        commands: [{ type: "chain", id: f.actor.id, motionId: "turn-wave" }],
      },
    ]);
    f.scene.customMotions[0].name = "Original wave";
    const repeated = offlinePlan(
      f.scene,
      "Mila Original wave then wave then Original wave",
      f.actor.id,
      {},
    );
    expect(repeated.steps).toEqual([
      {
        type: "edit",
        commands: [
          { type: "chain", id: f.actor.id, motionId: "turn-wave" },
          { type: "chain", id: f.actor.id, motionId: "wave" },
          { type: "chain", id: f.actor.id, motionId: "turn-wave" },
        ],
      },
    ]);
  });
  it("transfers an original T-pose rig with rotated axes, initial heading and arm articulation", () => {
    const f = fixture();
    f.sample(2);
    // The halfway source translation is (.5,0,1), normalized from its initial +X facing.
    const expectedPosition = new T.Vector3(0.5, 0, 1)
      .applyQuaternion(turn(-Math.PI / 2))
      .multiplyScalar(f.actor.scale)
      .applyQuaternion(turn(f.actor.rotation))
      .add(new T.Vector3(...f.actor.position));
    expect(f.target.position.distanceTo(expectedPosition)).toBeLessThan(1e-6);
    const q = turn(f.actor.rotation + Math.PI / 4).multiply(
      new T.Quaternion().setFromEuler(new T.Euler(0, 0, -1.3)),
    );
    expect(
      f.target.userData.bones.rightArm
        .getWorldQuaternion(new T.Quaternion())
        .angleTo(q),
    ).toBeLessThan(1e-6);
    expect(f.target.userData.motionWarning).toBe("");
  });
  it("adapts onto a second imported rig with different axes and keeps skin inverse matrices unchanged", () => {
    const f = fixture(),
      receiving = imported(false, -0.6);
    setMotionSources(receiving.group, new Map([["original", f.source.group]]));
    const mesh = receiving.body.children.find(
      (o) => o instanceof T.SkinnedMesh,
    ) as T.SkinnedMesh;
    const inverses = mesh.skeleton.boneInverses.map((m) => m.elements.slice());
    f.sample(2);
    f.sample(2, receiving.group);
    for (const [upper, lower] of [
      ["rightArm", "rightForearm"],
      ["leftLeg", "leftShin"],
      ["head", "spine"],
    ]) {
      const a = world(f.target.userData.bones[lower])
        .sub(world(f.target.userData.bones[upper]))
        .normalize();
      const b = world(receiving.bones[lower])
        .sub(world(receiving.bones[upper]))
        .normalize();
      expect(a.distanceTo(b)).toBeLessThan(1e-6);
    }
    expect(mesh.skeleton.boneInverses.map((m) => m.elements)).toEqual(inverses);
  });
  it("carries travel and final facing into the next action and supports independent reverse scrubbing", () => {
    const f = fixture(),
      other = createCharacter(characters[1]);
    setMotionSources(other, new Map([["original", f.source.group]]));
    f.sample(2);
    const middle = world(f.target.userData.bones.rightForearm);
    f.sample(0.4, other);
    f.sample(3.9);
    f.sample(2);
    expect(
      world(f.target.userData.bones.rightForearm).distanceTo(middle),
    ).toBeLessThan(1e-7);
    f.sample(4 - 1e-6);
    const before = world(f.target.userData.bones.hips);
    f.sample(4 + 1e-6);
    expect(world(f.target.userData.bones.hips).distanceTo(before)).toBeLessThan(
      1e-5,
    );
    f.sample(8);
    const delta = new T.Vector3(1, 0, 2).applyQuaternion(turn(-Math.PI / 2));
    delta
      .add(new T.Vector3(0, 0, 2).applyQuaternion(turn(Math.PI / 2)))
      .multiplyScalar(f.actor.scale)
      .applyQuaternion(turn(f.actor.rotation))
      .add(new T.Vector3(...f.actor.position));
    expect(f.target.position.distanceTo(delta)).toBeLessThan(1e-6);
    expect(f.target.rotation.y).toBeCloseTo(f.actor.rotation + Math.PI / 2, 6);
  });
  it("keeps complete turns when the transferred action repeats", () => {
    const f = fixture(),
      times = Array.from({ length: 17 }, (_, i) => i / 8);
    const spin = new T.AnimationClip("Spin", 2, [
      new T.QuaternionKeyframeTrack(
        f.source.body.uuid + ".quaternion",
        times,
        times.flatMap((t) => turn(t * Math.PI * 2).toArray()),
      ),
    ]);
    configureImportedRig(f.source.group, f.source.body, [spin]);
    f.scene.customMotions[0].animationName = "Spin";
    f.actor.clips = [
      { id: "a", motionId: "turn-wave", duration: 2 },
      { id: "b", motionId: "turn-wave", duration: 2 },
    ];
    f.sample(4);
    expect(f.target.rotation.y).toBeCloseTo(f.actor.rotation + 8 * Math.PI, 6);
    // The unwrapped turn count and its rendered orientation must both survive.
    expect(
      f.target
        .getWorldQuaternion(new T.Quaternion())
        .angleTo(turn(f.actor.rotation)),
    ).toBeLessThan(1e-6);
  });
  it("shows clear feedback for incompatible bodies and missing original animation data", () => {
    const f = fixture();
    delete f.target.userData.bones.rightForearm;
    f.sample(1);
    expect(f.target.userData.motionWarning).toContain("cannot use shared");
    expect(f.target.position.toArray()).toEqual(f.actor.position);
    setMotionSources(f.target, new Map());
    f.sample(1);
    expect(f.target.userData.motionWarning).toContain("original file");
  });
  it("bakes the adapted target without adding the hidden original character", () => {
    const f = fixture(),
      content = new T.Group();
    content.add(f.target);
    const animation = bakeAnimation([f.target], 8, (time) => f.sample(time));
    f.sample(2);
    const expected = world(f.target.userData.bones.rightForearm);
    f.sample(0);
    const snapshot = exportSnapshot(content),
      mixer = new T.AnimationMixer(snapshot);
    mixer.clipAction(animation).play();
    mixer.setTime(2);
    snapshot.updateWorldMatrix(true, true);
    const elbow = snapshot.getObjectByProperty(
      "uuid",
      f.target.userData.bones.rightForearm.uuid,
    )!;
    expect(world(elbow).distanceTo(expected)).toBeLessThan(1e-6);
    expect(snapshot.children).toHaveLength(1);
    expect(
      snapshot.getObjectByProperty("uuid", f.source.body.uuid),
    ).toBeUndefined();
  });
  it("preserves the original action but declines to share animated limb lengths", () => {
    const f = fixture(),
      shin = f.source.bones.leftShin;
    const stretch = new T.AnimationClip("Stretch", 2, [
      new T.VectorKeyframeTrack(
        shin.uuid + ".position",
        [0, 2],
        [
          ...shin.position.toArray(),
          ...shin.position.clone().multiplyScalar(1.3).toArray(),
        ],
      ),
    ]);
    configureImportedRig(f.source.group, f.source.body, [stretch]);
    f.scene.customMotions[0].animationName = "Stretch";
    f.sample(1);
    expect(f.target.userData.motionWarning).toContain("bone lengths or scale");
    const originalActor = { ...f.actor, assetId: "original" };
    applyAnimatedEntityPose(f.source.group, originalActor, f.scene, 1);
    expect(shin.position.length()).toBeGreaterThan(0.4);
  });
  it("scales shared travel by anatomical size instead of the source file's units", () => {
    const original = fixture(),
      scaled = fixture();
    scaled.source.body.scale.setScalar(2);
    const clip = scaled.clip.clone();
    for (const track of clip.tracks)
      if (track.name.endsWith(".position"))
        track.values = Float32Array.from(track.values, (value) => value * 2);
    configureImportedRig(scaled.source.group, scaled.source.body, [clip]);
    original.sample(2);
    scaled.sample(2);
    expect(
      scaled.target.position.distanceTo(original.target.position),
    ).toBeLessThan(1e-6);
    const receiving = imported(false, 0.1);
    receiving.body.scale.setScalar(1.4);
    configureImportedRig(receiving.group, receiving.body, []);
    setMotionSources(
      receiving.group,
      new Map([["original", scaled.source.group]]),
    );
    scaled.sample(4, receiving.group);
    const expected = new T.Vector3(1, 0, 2)
      .applyQuaternion(turn(-Math.PI / 2))
      .multiplyScalar(1.4 * scaled.actor.scale)
      .applyQuaternion(turn(scaled.actor.rotation))
      .add(new T.Vector3(...scaled.actor.position));
    expect(receiving.group.position.distanceTo(expected)).toBeLessThan(1e-6);
  });
});
