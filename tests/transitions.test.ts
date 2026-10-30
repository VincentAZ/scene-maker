import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  applyCommands,
  characters,
  starterScene,
  validateScene,
  type Entity,
  type Scene,
} from "../shared/scene";
import { transitionAt } from "../shared/transitions";
import { offlineCommands } from "../server/ai";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
} from "../src/world";
import { configureImportedRig } from "../src/rig";
import { configureRigContacts } from "../src/ik";
import { applyInteractions } from "../src/interactions";
import { BAKE_SAMPLE_FPS, bakeAnimation } from "../src/bakeAnimation";
import { exportSnapshot } from "../src/exportSnapshot";

const point = (object: T.Object3D) => object.getWorldPosition(new T.Vector3());
const rotation = (object: T.Object3D) =>
  object.getWorldQuaternion(new T.Quaternion());
const yaw = (angle: number) =>
  new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), angle);
function fixture() {
  const scene = starterScene(),
    actor = scene.entities[0];
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.scale = 1;
  actor.clips = [
    { id: "gesture", motionId: "gesture", duration: 1 },
    { id: "walk", motionId: "walk", duration: 2, transition: "smooth" },
  ];
  scene.entities = [actor];
  scene.customMotions.push({
    id: "gesture",
    name: "Raised greeting",
    kind: "custom",
    duration: 1,
    distance: 0,
    poses: [
      {
        at: 0,
        root: [0, 0, 0],
        rotations: { rightArm: [0, 0, -1.4], rightForearm: [-0.6, 0, 0] },
      },
      {
        at: 1,
        root: [0, 0, 2],
        rotations: { rightArm: [0, 0, -1.4], rightForearm: [-0.6, 0, 0] },
      },
    ],
  });
  const group = createCharacter(characters[0]);
  const sample = (time: number, e: Entity = actor, s: Scene = scene) => {
    applyAnimatedEntityPose(group, e, s, time);
    group.updateWorldMatrix(true, true);
  };
  return {
    scene,
    actor,
    group,
    bones: group.userData.bones as Record<string, T.Bone>,
    sample,
  };
}
function nativeFixture() {
  const f = fixture(),
    group = new T.Group(),
    body = createCharacter(characters[0]);
  group.add(body);
  const clip = new T.AnimationClip("Turning original", 2, [
    new T.VectorKeyframeTrack(
      body.uuid + ".position",
      [0, 2],
      [4, 0, 3, 4, 0, 5],
    ),
    new T.QuaternionKeyframeTrack(
      body.uuid + ".quaternion",
      [0, 1, 2],
      [Math.PI / 2, (3 * Math.PI) / 4, Math.PI].flatMap((angle) =>
        yaw(angle).toArray(),
      ),
    ),
    new T.QuaternionKeyframeTrack(
      body.userData.bones.rightArm.uuid + ".quaternion",
      [0, 2],
      [
        ...new T.Quaternion().toArray(),
        ...new T.Quaternion()
          .setFromAxisAngle(new T.Vector3(0, 0, 1), -1.4)
          .toArray(),
      ],
    ),
  ]);
  configureImportedRig(group, body, [clip]);
  f.scene.customMotions.push({
    id: "original",
    name: "Turning original",
    kind: "imported",
    duration: 2,
    distance: 0,
    poses: [],
    sourceAssetId: f.actor.assetId,
    animationName: clip.name,
  });
  f.actor.clips = [
    { id: "a", motionId: "original", duration: 2 },
    { id: "b", motionId: "walk", duration: 2, transition: "smooth" },
  ];
  const sample = (time: number) => {
    applyAnimatedEntityPose(group, f.actor, f.scene, time);
    group.updateWorldMatrix(true, true);
  };
  return {
    ...f,
    group,
    body,
    bones: body.userData.bones as Record<string, T.Bone>,
    sample,
  };
}
describe("action transitions and endings", () => {
  it("defaults new actions to smooth and new characters to hold while preserving older scene choices", () => {
    const f = fixture();
    expect(f.actor.ending).toBe("hold");
    const added = applyCommands(f.scene, [
      { type: "chain", id: f.actor.id, motionId: "wave" },
    ]);
    expect(added.entities[0].clips.at(-1)?.transition).toBe("smooth");
    const legacy = structuredClone(f.scene);
    delete legacy.entities[0].ending;
    delete legacy.entities[0].clips[1].transition;
    const valid = validateScene(legacy);
    expect(transitionAt(valid.entities[0], valid, 1.1)).toBeUndefined();
    expect(transitionAt(valid.entities[0], valid, 9)).toBeUndefined();
    const cut = applyCommands(
      f.scene,
      offlineCommands(f.scene, "Make Mila's transitions cut").commands,
    );
    expect(cut.entities[0].clips.map((c) => c.transition)).toEqual([
      "cut",
      "cut",
    ]);
    const held = applyCommands(
      cut,
      offlineCommands(cut, "Mila hold the final pose").commands,
    );
    expect(held.entities[0].ending).toBe("hold");
    expect(held.entities[0].clips.map((c) => [c.id, c.duration])).toEqual(
      f.actor.clips.map((c) => [c.id, c.duration]),
    );
  });
  it("removes the pose jump without easing or double-counting timeline travel", () => {
    const f = fixture();
    f.sample(1 - 1e-7);
    const previous = rotation(f.bones.rightArm),
      elbow = point(f.bones.rightForearm);
    f.sample(1);
    expect(rotation(f.bones.rightArm).angleTo(previous)).toBeLessThan(1e-6);
    expect(point(f.bones.rightForearm).distanceTo(elbow)).toBeLessThan(1e-5);
    const cut = {
      ...f.actor,
      clips: f.actor.clips.map((c) => ({ ...c, transition: "cut" as const })),
    };
    f.sample(1.125, cut);
    const incoming = rotation(f.bones.rightArm),
      travel = f.group.position.clone();
    f.sample(1.125);
    expect(
      rotation(f.bones.rightArm).angleTo(previous.clone().slerp(incoming, 0.5)),
    ).toBeLessThan(1e-6);
    expect(f.group.position.distanceTo(travel)).toBeLessThan(1e-8);
    expect(f.group.position.z).toBeCloseTo(2.125, 7);
    f.sample(1.25);
    const settled = rotation(f.bones.rightArm);
    f.sample(1.25, cut);
    expect(rotation(f.bones.rightArm).angleTo(settled)).toBeLessThan(1e-6);
  });
  it("preserves original native travel and final facing through a parent-animated turn", () => {
    const f = nativeFixture();
    f.sample(0);
    expect(point(f.bones.hips).x).toBeCloseTo(0, 6);
    expect(rotation(f.bones.hips).angleTo(yaw(0))).toBeLessThan(1e-6);
    f.sample(1);
    expect(point(f.bones.hips).x).toBeCloseTo(-1, 6);
    f.sample(2 - 1e-7);
    const before = point(f.bones.hips),
      arm = rotation(f.bones.rightArm);
    f.sample(2);
    expect(point(f.bones.hips).distanceTo(before)).toBeLessThan(1e-5);
    expect(rotation(f.bones.rightArm).angleTo(arm)).toBeLessThan(1e-6);
    f.sample(2.125);
    expect(point(f.bones.hips).x).toBeCloseTo(-1.875, 6);
    expect(point(f.bones.hips).z).toBeCloseTo(0, 6);
    f.sample(4);
    expect(f.group.position.length()).toBeLessThan(1e-5);
    expect(f.group.rotation.y).toBeCloseTo(Math.PI / 2, 6);
  });
  it("keeps exported subframes continuous when native parent motion transfers to the studio root", () => {
    const f = nativeFixture();
    f.actor.clips[0].duration = 2.017;
    const boundary = f.actor.clips[0].duration,
      root = new T.Group();
    root.add(f.group);
    const animation = bakeAnimation([f.group], 5, f.sample, [
      boundary,
      boundary + 2,
    ]);
    f.sample(0);
    const snapshot = exportSnapshot(root),
      mixer = new T.AnimationMixer(snapshot);
    const action = mixer.clipAction(animation);
    action.setLoop(T.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    const hips = snapshot.getObjectByProperty("uuid", f.bones.hips.uuid)!;
    for (const offset of [
      -0.025, -0.01, -0.001, -0.0001, 0, 0.0001, 0.001, 0.01, 0.125,
    ]) {
      const time = boundary + offset;
      f.sample(time);
      action.reset().play();
      mixer.setTime(time);
      snapshot.updateWorldMatrix(true, true);
      const actual = point(hips),
        expected = point(f.bones.hips);
      // Vertical gait is sampled on the bake grid; horizontal travel must stay exact.
      expect(
        Math.hypot(actual.x - expected.x, actual.z - expected.z),
        `at ${time}`,
      ).toBeLessThan(0.0001);
    }
    for (const track of animation.tracks)
      expect(
        [...track.times].every((time, i, times) => !i || time > times[i - 1]),
      ).toBe(true);
    const mesh = f.body.children.find(
      (object) => object instanceof T.SkinnedMesh,
    ) as T.SkinnedMesh;
    const exportedMesh = snapshot.getObjectByProperty(
      "uuid",
      mesh.uuid,
    ) as T.SkinnedMesh;
    for (const time of [0, 0.5, 1.5, 3, 4]) {
      f.sample(time);
      root.updateMatrixWorld(true);
      action.reset().play();
      mixer.setTime(time);
      snapshot.updateMatrixWorld(true);
      for (
        let vertex = 0;
        vertex < mesh.geometry.attributes.position.count;
        vertex += 47
      ) {
        const original = mesh
          .getVertexPosition(vertex, new T.Vector3())
          .applyMatrix4(mesh.matrixWorld);
        const exported = exportedMesh
          .getVertexPosition(vertex, new T.Vector3())
          .applyMatrix4(exportedMesh.matrixWorld);
        expect(
          exported.distanceTo(original),
          `skin at ${time}, vertex ${vertex}`,
        ).toBeLessThan(0.00001);
      }
    }
  });
  it("holds the final articulated body and restores an explicit neutral ending", () => {
    const f = fixture();
    f.actor.clips = f.actor.clips.slice(0, 1);
    f.sample(1 - 1e-7);
    const elbow = point(f.bones.rightForearm),
      q = rotation(f.bones.rightArm);
    f.sample(8);
    expect(point(f.bones.rightForearm).distanceTo(elbow)).toBeLessThan(1e-5);
    expect(rotation(f.bones.rightArm).angleTo(q)).toBeLessThan(1e-6);
    f.sample(8, { ...f.actor, ending: "rest" });
    expect(rotation(f.bones.rightArm).angleTo(q)).toBeGreaterThan(1);
  });
  it("invalidates cached boundary poses after edits and scrubs deterministically", () => {
    const f = nativeFixture();
    f.sample(2.125);
    const expected = point(f.bones.rightForearm);
    for (const time of [6, 0.3, 3, 2.125]) f.sample(time);
    expect(point(f.bones.rightForearm).distanceTo(expected)).toBeLessThan(1e-7);
    const changed = structuredClone(f.scene),
      actor = changed.entities[0];
    actor.position = [2, 0, 3];
    actor.scale = 1.5;
    actor.rotation = 0.7;
    applyAnimatedEntityPose(f.group, actor, changed, 2.125);
    f.group.updateWorldMatrix(true, true);
    const moved = expected
      .clone()
      .multiplyScalar(1.5)
      .applyQuaternion(yaw(0.7))
      .add(new T.Vector3(2, 0, 3));
    expect(point(f.bones.rightForearm).distanceTo(moved)).toBeLessThan(1e-5);
  });
  it("keeps targeted contact choreography and a carried cup in charge of hand contact", () => {
    const f = fixture(),
      cup = starterScene().entities[3];
    cup.position = [0, 1.01, 0.2];
    f.actor.position = [0.25, 0, 0];
    f.scene.entities.push(cup);
    f.actor.clips = [
      {
        id: "pick",
        motionId: "pick",
        duration: 2,
        targetId: cup.id,
        transition: "smooth",
      },
      { id: "a", motionId: "wave", duration: 2, transition: "smooth" },
      { id: "b", motionId: "idle", duration: 2, transition: "smooth" },
    ];
    expect(transitionAt(f.actor, f.scene, 2.1)).toBeUndefined();
    const prop = createProp("cup", cup.color),
      objects = new Map([
        [f.actor.id, f.group],
        [cup.id, prop],
      ]);
    configureRigContacts(f.group);
    for (const time of [4, 4.125, 4.25, 1, 4.125]) {
      for (const actor of f.scene.entities)
        applyAnimatedEntityPose(objects.get(actor.id)!, actor, f.scene, time);
      expect(applyInteractions(f.scene, time, objects)).toEqual([]);
      if (time >= 4) {
        const hand = f.bones.rightForearm.localToWorld(
          f.group.userData.contacts.hand.clone(),
        );
        expect(
          hand.distanceTo(prop.localToWorld(new T.Vector3(0.13, 0.08, 0))),
        ).toBeLessThan(1e-6);
      }
    }
  });
  it("fits short actions and bakes the same intermediate and held poses", () => {
    const f = fixture();
    f.actor.clips[1].duration = 0.2;
    f.sample(1.1);
    const ended = rotation(f.bones.rightArm);
    f.sample(1.1, {
      ...f.actor,
      clips: f.actor.clips.map((c) => ({ ...c, transition: "cut" })),
    });
    expect(rotation(f.bones.rightArm).angleTo(ended)).toBeLessThan(1e-6);
    const root = new T.Group();
    root.add(f.group);
    const animation = bakeAnimation([f.group], 3, (time) => f.sample(time));
    f.sample(1 + 1 / BAKE_SAMPLE_FPS);
    const expected = point(f.bones.rightForearm);
    f.sample(0);
    const snapshot = exportSnapshot(root),
      mixer = new T.AnimationMixer(snapshot);
    mixer.clipAction(animation).play();
    mixer.setTime(1 + 1 / BAKE_SAMPLE_FPS);
    snapshot.updateWorldMatrix(true, true);
    expect(
      point(
        snapshot.getObjectByProperty("uuid", f.bones.rightForearm.uuid)!,
      ).distanceTo(expected),
    ).toBeLessThan(1e-6);
  });
});
