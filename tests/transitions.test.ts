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
import { sampleWithTransitions } from "../src/transitions";
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
  it("preserves a continuous original performance when adjacent cuts meet at the same source frame", () => {
    const f = nativeFixture();
    const whole = {
      ...f.actor,
      clips: [
        { id: "whole", motionId: "original", duration: 2, playbackRate: 1 },
      ],
    };
    const split = {
      ...f.actor,
      clips: [
        { id: "first", motionId: "original", duration: 1, playbackRate: 1 },
        {
          id: "second",
          motionId: "original",
          duration: 1,
          sourceStart: 1,
          playbackRate: 1,
          transition: "smooth" as const,
        },
      ],
    };
    for (const time of [0.99, 1, 1.001, 1.05, 1.125, 1.249, 1.3, 1.8, 1.05]) {
      applyAnimatedEntityPose(f.group, whole, f.scene, time);
      const expected = Object.values(f.bones).map((b) => ({
        p: point(b),
        q: rotation(b),
      }));
      applyAnimatedEntityPose(f.group, split, f.scene, time);
      Object.values(f.bones).forEach((bone, i) => {
        expect(point(bone).distanceTo(expected[i].p)).toBeLessThan(1e-5);
        expect(rotation(bone).angleTo(expected[i].q)).toBeLessThan(1e-5);
      });
    }
  });

  it("retains outgoing body and expression velocity and settles into the moving incoming take", () => {
    const f = fixture(),
      bone = f.bones.rightArm;
    const rest = bone.position.clone(),
      face = new T.Mesh();
    face.morphTargetInfluences = [0];
    f.group.add(face);
    const raw = (t: number) => {
      const prior = t < 1,
        elapsed = t - 1;
      bone.quaternion.setFromAxisAngle(
        new T.Vector3(prior ? 0 : 1, 0, prior ? 1 : 0),
        prior ? 0.3 + 0.6 * t : -0.4 + 1.2 * elapsed,
      );
      bone.position.copy(rest);
      bone.position.x += prior ? 0.02 * t : 0.07 + 0.1 * elapsed;
      bone.scale.setScalar(prior ? 1 + 0.03 * t : 1.2 + 0.02 * elapsed);
      face.morphTargetInfluences![0] = prior
        ? 0.2 + 0.1 * t
        : 0.7 - 0.2 * elapsed;
      f.group.updateWorldMatrix(true, true);
    };
    const sample = (t: number) => {
      sampleWithTransitions(f.group, f.actor, f.scene, t, raw);
      return {
        q: rotation(bone),
        x: bone.position.x,
        s: bone.scale.x,
        m: face.morphTargetInfluences![0],
      };
    };
    const angular = (a: T.Quaternion, b: T.Quaternion, dt: number) => {
      const q = b.clone().multiply(a.clone().invert());
      const angle = 2 * Math.atan2(Math.hypot(q.x, q.y, q.z), q.w);
      return new T.Vector3(q.x, q.y, q.z)
        .normalize()
        .multiplyScalar(angle / dt);
    };
    const dt = 1e-5;
    for (const boundary of [1, 1.25]) {
      const a = sample(boundary - dt),
        b = sample(boundary),
        c = sample(boundary + dt);
      expect(
        angular(a.q, b.q, dt).distanceTo(angular(b.q, c.q, dt)),
      ).toBeLessThan(0.002);
      for (const key of ["x", "s", "m"] as const)
        expect(
          Math.abs((b[key] - a[key]) / dt - (c[key] - b[key]) / dt),
        ).toBeLessThan(0.002);
    }
    const expected = sample(1.125);
    sample(3.5);
    sample(0.2);
    const replay = sample(1.125);
    expect(replay.x).toBeCloseTo(expected.x, 12);
    expect(replay.q.angleTo(expected.q)).toBeLessThan(1e-7);
    expect(replay.m).toBe(expected.m);
    raw(1.25);
    const final = rotation(bone),
      expression = face.morphTargetInfluences![0];
    const settled = sample(1.25);
    expect(settled.q.angleTo(final)).toBeLessThan(1e-7);
    expect(settled.m).toBe(expression);
  });
  it("bounds transient spins and stretching when a fast performance meets a still pose", () => {
    const f = fixture(),
      bone = f.bones.rightArm,
      rest = bone.position.clone();
    const sample = (time: number) =>
      sampleWithTransitions(f.group, f.actor, f.scene, time, (t) => {
        bone.quaternion.setFromAxisAngle(
          new T.Vector3(0, 0, 1),
          t < 1 ? 100 * (t - 1) : 0,
        );
        bone.position.copy(rest);
        if (t < 1) bone.position.x += 100 * (t - 1);
        bone.scale.setScalar(t < 1 ? 1 + 20 * (t - 1) : 1);
      });
    for (let i = 0; i <= 30; i++) {
      sample(1 + i / 120);
      expect(bone.quaternion.angleTo(new T.Quaternion())).toBeLessThanOrEqual(
        0.350001,
      );
      expect(bone.position.distanceTo(rest)).toBeLessThan(0.1);
      expect(bone.scale.x).toBeGreaterThan(0.94999);
      expect(bone.scale.x).toBeLessThan(1.05001);
    }
  });
  it("keeps detached rig roots continuous when imported parent travel changes frames", () => {
    const f = nativeFixture(),
      root = new T.Bone();
    root.name = "unweighted-provider-origin";
    f.body.add(root);
    f.actor.clips[0].duration = 2.017;
    const boundary = f.actor.clips[0].duration;
    f.sample(boundary - 1e-7);
    const before = point(root);
    f.sample(boundary);
    expect(point(root).distanceTo(before)).toBeLessThan(1e-5);
    const world = new T.Group();
    world.add(f.group);
    const animation = bakeAnimation([f.group], 5, f.sample, [
      boundary,
      boundary + 2,
    ]);
    f.sample(0);
    const snapshot = exportSnapshot(world),
      mixer = new T.AnimationMixer(snapshot);
    const action = mixer.clipAction(animation).play();
    const exported = snapshot.getObjectByProperty("uuid", root.uuid)!;
    for (const offset of [-0.01, -0.00001, 0, 0.00001, 0.1, 0.25, 0.001]) {
      f.sample(boundary + offset);
      action.reset().play();
      mixer.setTime(boundary + offset);
      snapshot.updateMatrixWorld(true);
      // The adaptive bake's world-position contract is 0.25 mm.
      expect(
        point(exported).distanceTo(point(root)),
        `at ${offset}`,
      ).toBeLessThan(0.00025);
    }
  });

  it("holds the complete imported hierarchy through an animated parent and detached deformer", () => {
    const f = nativeFixture(),
      detached = new T.Bone(),
      attachment = new T.Group();
    detached.name = "unrelated-provider-deformer";
    f.body.add(detached, attachment);
    f.actor.clips = f.actor.clips.slice(0, 1);
    const native = f.group.userData.animations[0] as T.AnimationClip;
    native.tracks.push(
      new T.VectorKeyframeTrack(
        detached.uuid + ".position",
        [0, 2],
        [0, 0, 0, 1, 0.2, 0],
      ),
      new T.VectorKeyframeTrack(
        attachment.uuid + ".position",
        [0, 2],
        [0, 0, 0, 0, 0.4, 1],
      ),
    );
    f.sample(2 - 1e-7);
    const nodes = [
      f.body,
      detached,
      attachment,
      f.bones.hips,
      f.bones.rightForearm,
    ];
    const poses = nodes.map((node) => node.matrixWorld.clone());
    for (const time of [2, 8, 0.2, 3, 2]) {
      f.sample(time);
      if (time < 2) continue;
      nodes.forEach((node, index) => {
        node.matrixWorld.elements.forEach((value, element) =>
          expect(value).toBeCloseTo(poses[index].elements[element], 8),
        );
      });
    }
  });

  it("blends facial expressions and holds them through deterministic seeks", () => {
    const f = fixture();
    const face = new T.Mesh();
    face.morphTargetInfluences = [0, 0];
    face.morphTargetDictionary = { smile: 0, blink: 1 };
    f.group.add(face);
    const sample = (time: number, actor = f.actor) =>
      sampleWithTransitions(f.group, actor, f.scene, time, (t) => {
        // Model the complete evaluated face, including a reset after the take.
        face.morphTargetInfluences =
          t < 1 ? [0.8, 0.2] : t < 3 ? [0.2, 0.6] : [0, 0];
      });
    sample(1);
    expect(face.morphTargetInfluences[0]).toBeCloseTo(0.8);
    sample(1.125);
    expect(face.morphTargetInfluences[0]).toBeCloseTo(0.5);
    expect(face.morphTargetInfluences[1]).toBeCloseTo(0.4);
    sample(8);
    expect(face.morphTargetInfluences).toEqual([0.2, 0.6]);
    sample(0.2);
    sample(1.125);
    expect(face.morphTargetInfluences[0]).toBeCloseTo(0.5);
    sample(8, { ...f.actor, ending: "rest" });
    expect(face.morphTargetInfluences).toEqual([0, 0]);
  });
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
    f.sample(1, cut);
    const initialGap = rotation(f.bones.rightArm).angleTo(previous);
    f.sample(1.125);
    expect(rotation(f.bones.rightArm).angleTo(incoming)).toBeLessThan(
      initialGap,
    );
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
