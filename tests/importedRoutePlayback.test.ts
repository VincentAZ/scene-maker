import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  boneNames,
  characters,
  starterScene,
  type Motion,
} from "../shared/scene";
import { pathToWorld, samplePath } from "../shared/path";
import {
  locomotionProfile,
  locomotionScale,
  sampleLocomotion,
  type LocomotionProfile,
} from "../src/locomotion";
import {
  applyHumanoidPose,
  configureImportedRig,
  sampleNativeClip,
  setMotionSources,
} from "../src/rig";
import { applyAnimatedEntityPose } from "../src/world";

const up = new T.Vector3(0, 1, 0);
const worldPosition = (node: T.Object3D) =>
  node.getWorldPosition(new T.Vector3());
const worldRotation = (node: T.Object3D) =>
  node.getWorldQuaternion(new T.Quaternion()).normalize();

/** A real imported hierarchy: all eleven core bones plus feet, hands, toes,
 * and a finger. A separate animated root sits below the imported size transform.
 * No renderer, external asset, mocked mixer, or procedural gait is involved. */
function makeRig(size = 1) {
  const group = new T.Group();
  const imported = new T.Group();
  const root = new T.Group();
  const bones: Record<string, T.Bone> = {};
  imported.scale.setScalar(size);
  group.add(imported);
  imported.add(root);
  const add = (
    name: string,
    parent: string | undefined,
    position: [number, number, number],
  ) => {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(...position);
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
  return { group, imported, root, bones };
}
type Rig = ReturnType<typeof makeRig>;

function rotationTrack(
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

function addTravelClip(
  rig: Rig,
  options: { accelerating?: boolean; seam?: boolean } = {},
) {
  const times = [0, 0.5, 1, 1.5, 2];
  const { root, bones } = rig;
  const clip = new T.AnimationClip("Authored travelling gait", 2, [
    new T.VectorKeyframeTrack(
      `${root.uuid}.position`,
      times,
      times.flatMap((time) => [
        1.5,
        0,
        -2 + (options.accelerating ? time * time : time * 2),
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
      [0, 0.04, 0, 0.04, 0].flatMap((bob) => [0, 0.95 + bob, 0]),
    ),
    rotationTrack(bones.leftLeg, times, [
      0,
      0.35,
      0,
      -0.35,
      options.seam ? 0.8 : 0,
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

function routeFixture(
  size = 1,
  options: Parameters<typeof addTravelClip>[1] = {},
) {
  const source = makeRig();
  const original = addTravelClip(source, options);
  const native = makeRig(size);
  const nativeClip = addTravelClip(native, options);
  const target = makeRig(size);
  setMotionSources(target.group, new Map([["route-source", source.group]]));
  const scene = starterScene();
  const actor = scene.entities[0];
  actor.position = [2, 0, -1];
  actor.rotation = -0.45;
  actor.scale = 1.3;
  actor.clips = [
    {
      id: "route-clip",
      motionId: "imported-route",
      duration: 8,
      transition: "cut",
    },
  ];
  scene.entities = [actor];
  scene.customAssets.push({
    ...characters[0],
    id: "route-source",
    name: "Route performer",
    url: "/uploads/route-fixture.glb",
  });
  const motion: Motion = {
    id: "imported-route",
    name: "Curved original gait",
    kind: "imported",
    duration: 2,
    distance: 0,
    poses: [],
    sourceAssetId: "route-source",
    animationName: original.name,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 2],
        [2, 0, 3],
        [3, 0, 1],
      ],
      smooth: true,
    },
  };
  scene.customMotions.push(motion);
  const sample = (rig: Rig, progress: number, isNative = false) => {
    const entity = {
      ...actor,
      assetId: isNative ? "route-source" : actor.assetId,
    };
    applyAnimatedEntityPose(
      rig.group,
      entity,
      scene,
      progress * actor.clips[0].duration,
    );
    rig.group.updateWorldMatrix(true, true);
  };
  return {
    source,
    original,
    native,
    nativeClip,
    target,
    scene,
    actor,
    motion,
    sample,
  };
}

function sampleOriginal(rig: Rig, clip: T.AnimationClip, time: number) {
  (rig.group.userData.mixer as T.AnimationMixer).stopAllAction();
  applyHumanoidPose(rig.group, {}, true);
  sampleNativeClip(rig.group, clip, time);
  rig.group.updateWorldMatrix(true, true);
}

function capture(rig: Rig) {
  rig.group.updateWorldMatrix(true, true);
  return Object.fromEntries(
    Object.entries(rig.bones).map(([name, bone]) => [
      name,
      {
        position: worldPosition(bone),
        quaternion: worldRotation(bone),
      },
    ]),
  );
}

function expectSamePose(
  actual: ReturnType<typeof capture>,
  expected: ReturnType<typeof capture>,
) {
  for (const [name, pose] of Object.entries(expected)) {
    expect(
      actual[name].position.distanceTo(pose.position),
      `${name} position`,
    ).toBeLessThan(2e-6);
    expect(
      actual[name].quaternion.angleTo(pose.quaternion),
      `${name} orientation`,
    ).toBeLessThan(2e-6);
  }
}

describe("imported locomotion distance profiles", () => {
  it("inverts a nonuniform distance table and wraps cycles without frame-history dependence", () => {
    const profile: LocomotionProfile = {
      duration: 2,
      distance: 4,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [
        { time: 0, distance: 0, center: new T.Vector3(0, 1, 0), heading: 0 },
        {
          time: 1,
          distance: 0.2,
          center: new T.Vector3(0, 1, 0.2),
          heading: 0.2,
        },
        {
          time: 1.5,
          distance: 2,
          center: new T.Vector3(0, 1, 2),
          heading: 0.6,
        },
        { time: 2, distance: 4, center: new T.Vector3(0, 1, 4), heading: 0.8 },
      ],
    };
    for (const distance of [9.1, 1.1, 5.1, 1.1]) {
      const sample = sampleLocomotion(profile, distance);
      expect(sample.time).toBeCloseTo(1.25, 8);
      expect(sample.center.z).toBeCloseTo(1.1, 8);
      expect(sample.heading).toBeCloseTo(0.4, 8);
      expect(sample.repeated).toBe(distance >= 4);
      sample.center.set(99, 99, 99);
    }
    expect(sampleLocomotion(profile, 0).time).toBe(0);
    expect(sampleLocomotion(profile, 4)).toMatchObject({
      time: 0,
      repeated: true,
    });
    expect(profile.frames[1].center.toArray()).toEqual([0, 1, 0.2]);
  });

  it("measures authored root travel and uses distance, not a linear fraction of source time", () => {
    const rig = makeRig();
    const clip = addTravelClip(rig, { accelerating: true });
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.mode).toBe("travel");
    expect(profile.distance).toBeCloseTo(4, 5);
    expect(profile.startHeading).toBeCloseTo(0.7, 6);
    expect(profile.warning).toBe("");
    const sample = sampleLocomotion(profile, profile.distance / 2);
    expect(sample.time).toBeGreaterThan(1.3);
    expect(sample.time).toBeLessThan(1.5);
    expect(sample.center.z - profile.frames[0].center.z).toBeCloseTo(
      profile.distance / 2,
      6,
    );
    expect(
      profile.frames.every(
        (frame, index) =>
          !index || frame.distance >= profile.frames[index - 1].distance,
      ),
    ).toBe(true);
  });

  it("restores every current local transform after measurement and reuses the measured profile", () => {
    const rig = makeRig();
    const clip = addTravelClip(rig);
    rig.group.position.set(3, 0.2, -5);
    rig.group.rotation.y = 1.1;
    rig.group.scale.setScalar(1.6);
    sampleOriginal(rig, clip, 0.73);
    const saved: {
      node: T.Object3D;
      position: number[];
      quaternion: number[];
      scale: number[];
    }[] = [];
    rig.group.traverse((node) =>
      saved.push({
        node,
        position: node.position.toArray(),
        quaternion: node.quaternion.toArray(),
        scale: node.scale.toArray(),
      }),
    );
    const profile = locomotionProfile(rig.group, clip)!;
    for (const entry of saved) {
      expect(entry.node.position.toArray()).toEqual(entry.position);
      expect(entry.node.quaternion.toArray()).toEqual(entry.quaternion);
      expect(entry.node.scale.toArray()).toEqual(entry.scale);
    }
    expect(profile.distance).toBeCloseTo(4, 5);
    expect(locomotionProfile(rig.group, clip)).toBe(profile);
  });

  it("derives an in-place stride from the low stance foot, not the raised returning foot", () => {
    const rig = makeRig();
    const times = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    const tracks = (["left", "right"] as const).map((side) => {
      const z =
        side === "left"
          ? [0.3, 0, -0.3, 0, 0.3, 0, -0.3, 0, 0.3]
          : [-0.3, 0, 0.3, 0, -0.3, 0, 0.3, 0, -0.3];
      const lift =
        side === "left"
          ? [0, 0, 0, 0.2, 0, 0, 0, 0.2, 0]
          : [0, 0.2, 0, 0, 0, 0.2, 0, 0, 0];
      return new T.VectorKeyframeTrack(
        `${rig.bones[`${side}Foot`].uuid}.position`,
        times,
        z.flatMap((value, i) => [0, -0.42 + lift[i], 0.08 + value]),
      );
    });
    const clip = new T.AnimationClip("In-place foot cycle", 2, tracks);
    configureImportedRig(rig.group, rig.imported, [clip]);
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.mode).toBe("in-place");
    expect(profile.distance).toBeGreaterThan(2.3);
    expect(profile.distance).toBeLessThanOrEqual(2.4 + 1e-6);
    expect(profile.warning).toBe("");
    expect(
      profile.frames.every(
        (frame) => Math.hypot(frame.center.x, frame.center.z) < 1e-8,
      ),
    ).toBe(true);
    expect(sampleLocomotion(profile, profile.distance / 4).time).toBeCloseTo(
      0.5,
      1,
    );

    const f = routeFixture();
    f.motion.animationName = clip.name;
    f.sample(rig, 0.31, true);
    const path = samplePath(f.motion.path!, 0.31);
    const expected = pathToWorld(path.point, {
      position: f.actor.position,
      heading: f.actor.rotation,
      scale: f.actor.scale,
    });
    const hip = worldPosition(rig.bones.hips);
    expect(hip.x).toBeCloseTo(expected[0], 6);
    expect(hip.z).toBeCloseTo(expected[2], 6);
    expect(rig.group.userData.motionWarning).toBe("");

    // Route distance selects the source timestamp; the native foot channels
    // must match that exact authored sample, not an arbitrary motion amplitude.
    const sourceTime = sampleLocomotion(profile, path.travelled).time;
    expect((rig.group.userData.mixer as T.AnimationMixer).time).toBeCloseTo(
      sourceTime,
      8,
    );
    const feet = ["leftFoot", "rightFoot"].map((name) => ({
      name,
      position: rig.bones[name].position.clone(),
      quaternion: rig.bones[name].quaternion.clone(),
    }));
    sampleOriginal(rig, clip, sourceTime);
    for (const foot of feet) {
      expect(
        foot.position.distanceTo(rig.bones[foot.name].position),
        `${foot.name} authored position`,
      ).toBeLessThan(1e-8);
      expect(
        foot.quaternion.angleTo(rig.bones[foot.name].quaternion),
        `${foot.name} authored orientation`,
      ).toBeLessThan(1e-8);
    }
  });
});

describe("imported route playback through the world sampler", () => {
  it.each([1, 1.4])(
    "centers native and transferred rigs of size %s on the same curve while retaining authored joints",
    (size) => {
      const f = routeFixture(size);
      expect(
        boneNames.every((name) => f.source.group.userData.bones[name]),
      ).toBe(true);
      expect(locomotionScale(f.source.group, f.target.group)).toBeCloseTo(
        size,
        6,
      );
      for (const progress of [0.19, 0.43, 0.81, 0.43]) {
        f.sample(f.native, progress, true);
        f.sample(f.target, progress);
        const path = samplePath(f.motion.path!, progress);
        const expected = pathToWorld(path.point, {
          position: f.actor.position,
          heading: f.actor.rotation,
          scale: f.actor.scale,
        });
        for (const rig of [f.native, f.target]) {
          const hip = worldPosition(rig.bones.hips);
          expect(hip.x).toBeCloseTo(expected[0], 5);
          expect(hip.z).toBeCloseTo(expected[2], 5);
          expect(rig.group.userData.motionWarning).toBe("");
        }
        expectSamePose(capture(f.target), capture(f.native));
        const phase = sampleLocomotion(
          locomotionProfile(f.source.group, f.original)!,
          path.travelled / size,
        );
        sampleOriginal(f.source, f.original, phase.time);
        for (const name of [
          "leftArm",
          "rightForearm",
          "leftFoot",
          "leftHand",
          "leftHandIndex1",
          "leftToeBase",
        ]) {
          expect(
            f.native.bones[name].quaternion
              .clone()
              .normalize()
              .angleTo(f.source.bones[name].quaternion.clone().normalize()),
            name,
          ).toBeLessThan(2e-6);
          expect(
            f.target.bones[name].quaternion
              .clone()
              .normalize()
              .angleTo(f.source.bones[name].quaternion.clone().normalize()),
            name,
          ).toBeLessThan(2e-6);
        }
      }
      expect(
        f.target.bones.leftHandIndex1.quaternion.angleTo(new T.Quaternion()),
      ).toBeGreaterThan(0.1);
      expect(f.target.group.userData.retargetReport.unsupported).toEqual([]);
    },
  );

  it.each([true, false])(
    "keeps gait phase at equal route distance when duration changes (native=%s)",
    (isNative) => {
      const f = routeFixture(1.2);
      const rig = isNative ? f.native : f.target;
      f.sample(rig, 0.37, isNative);
      const first = capture(rig);
      f.sample(rig, 0.9, isNative);
      f.actor.clips[0] = { ...f.actor.clips[0], duration: 19 };
      f.sample(rig, 0.37, isNative);
      expectSamePose(capture(rig), first);
      f.sample(rig, 0.1, isNative);
      f.sample(rig, 0.37, isNative);
      expectSamePose(capture(rig), first);
    },
  );

  it("keeps a rejected transfer on the route instead of applying unsampled source travel", () => {
    const f = routeFixture();
    // Animated bone scale is deliberately unsupported by transfer, while
    // both rigs and the source's measurable root-travel profile remain valid.
    f.original.tracks.push(
      new T.VectorKeyframeTrack(
        `${f.source.bones.leftShin.uuid}.scale`,
        [0, 1, 2],
        [1, 1, 1, 1, 1.2, 1, 1, 1, 1],
      ),
    );
    configureImportedRig(f.source.group, f.source.imported, [f.original]);
    for (const progress of [0.19, 0.81, 0.43, 0.19]) {
      f.sample(f.target, progress);
      expect(f.target.group.userData.motionWarning).toMatch(
        /bone lengths or scale/i,
      );
      const path = samplePath(f.motion.path!, progress);
      const expected = pathToWorld(path.point, {
        position: f.actor.position,
        heading: f.actor.rotation,
        scale: f.actor.scale,
      });
      const hip = worldPosition(f.target.bones.hips);
      expect(hip.x).toBeCloseTo(expected[0], 6);
      expect(hip.z).toBeCloseTo(expected[2], 6);
      // Rejection must not silently replace the imported action with a gait.
      for (const name of ["leftLeg", "rightLeg", "leftShin", "rightShin"])
        expect(
          f.target.bones[name].quaternion.angleTo(new T.Quaternion()),
        ).toBeLessThan(1e-8);
    }
  });

  it("warns when a take has no measurable stride instead of substituting a procedural gait", () => {
    const f = routeFixture();
    const clip = new T.AnimationClip("Stationary hand gesture", 2, [
      rotationTrack(f.native.bones.leftHand, [0, 1, 2], [0, 0.8, 0]),
    ]);
    configureImportedRig(f.native.group, f.native.imported, [clip]);
    f.motion.animationName = clip.name;
    const profile = locomotionProfile(f.native.group, clip)!;
    expect(profile.distance).toBeLessThan(1e-8);
    expect(profile.warning).toMatch(/no reliable locomotion stride/i);
    f.sample(f.native, 0.4, true);
    expect(f.native.group.userData.motionWarning).toMatch(
      /measurable foot stride/i,
    );
    for (const name of ["leftLeg", "rightLeg", "leftShin", "rightShin"])
      expect(
        f.native.bones[name].quaternion.angleTo(new T.Quaternion()),
      ).toBeLessThan(1e-8);
  });

  it.each([true, false])(
    "discloses a mismatched foot seam only once the take repeats (native=%s)",
    (isNative) => {
      const f = routeFixture(1, { seam: true });
      const rig = isNative ? f.native : f.target;
      const profile = locomotionProfile(f.source.group, f.original)!;
      expect(profile.warning).toMatch(/loop boundary/i);
      const length = samplePath(f.motion.path!, 1).length;
      f.sample(rig, (profile.distance * 0.6) / length, isNative);
      expect(rig.group.userData.motionNotice).not.toMatch(/loop boundary/i);
      f.sample(rig, (profile.distance * 1.25) / length, isNative);
      expect(rig.group.userData.motionWarning).toBe("");
      expect(rig.group.userData.motionNotice).toMatch(/loop boundary/i);
      f.sample(rig, (profile.distance * 0.6) / length, isNative);
      expect(rig.group.userData.motionNotice).not.toMatch(/loop boundary/i);
    },
  );
});
