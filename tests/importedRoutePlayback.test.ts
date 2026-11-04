import {
  findCapturedContinuations,
  findCapturedContinuationSteps,
} from "../src/capturedContinuations";
import { sourcePoseSampler, compareSourceJoin } from "../src/sourceJoins";
import { withAutomaticMovement } from "../shared/aiMovement";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { inspectRouteClearance } from "../src/routeClearance";
import { routeContext } from "../src/routePlanner";
import { inspectNativeLoop } from "../src/nativeLoop";
import { inspectCapturedLoopBlend } from "../src/capturedLoop";
import { createProp } from "../src/world";
import { describe, expect, it } from "vitest";
import {
  addTravelClip,
  makeRig,
  rotationTrack,
  type Rig,
} from "./helpers/travelRig";
import * as T from "three";
import {
  boneNames,
  characters,
  starterScene,
  type Motion,
  type Scene,
  allMotions,
  applyCommands,
  validateScene,
} from "../shared/scene";
import { pathToWorld, samplePath } from "../shared/path";
import {
  locomotionProfile,
  locomotionScale,
  sampleLocomotion,
  sampleRouteLocomotion,
  routeSourceDuration,
  routeLocomotionProfile,
  routeSourceBoundaries,
  routeEntryHeading,
  type LocomotionProfile,
} from "../src/locomotion";
import { measureNativeTravel } from "../src/nativeTravel";
import {
  applyHumanoidPose,
  configureImportedRig,
  sampleNativeClip,
  setMotionSources,
} from "../src/rig";
import { applyAnimatedEntityPose } from "../src/world";
import { animationSampleBoundaries } from "../src/bakeAnimation";
import { recordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

const up = new T.Vector3(0, 1, 0);
const worldPosition = (node: T.Object3D) =>
  node.getWorldPosition(new T.Vector3());
const worldRotation = (node: T.Object3D) =>
  node.getWorldQuaternion(new T.Quaternion()).normalize();

it.each([0, 5])(
  "retains the full captured trajectory frame in curved source windows (timestamp offset=%s)",
  (offset) => {
    const rig = makeRig();
    const times = Array.from({ length: 121 }, (_, i) => i / 30);
    const clip = new T.AnimationClip("Curved captured travel", offset + 4, [
      new T.VectorKeyframeTrack(
        `${rig.root.uuid}.position`,
        times.map((time) => time + offset),
        times.flatMap((time) => [
          2 * (1 - Math.cos(time * 0.6)),
          0,
          2 * Math.sin(time * 0.6),
        ]),
      ),
      rotationTrack(
        rig.root,
        times.map((time) => time + offset),
        times.map((time) => time * 0.6),
        up,
      ),
    ]);
    rig.group.userData.animations = [clip];
    const full = locomotionProfile(
      rig.group,
      clip,
      offset ? { start: offset, end: offset + 4 } : undefined,
    )!;
    const start = 1.173,
      end = 2.623;
    const selected = locomotionProfile(rig.group, clip, {
      start: offset + start,
      end: offset + end,
    })!;
    expect(full.mode).toBe("travel");
    expect(selected.mode).toBe("travel");
    // Preserve actual track keys, including non-frame-aligned source windows;
    // contact fitting must not silently replace them with its uniform grid.
    const authoredKeys = Array.from(clip.tracks[0].times)
      .filter((time) => time >= offset + start && time <= offset + end)
      .map((time) => time - offset - start);
    expect(selected.keyTimes).toEqual(authoredKeys);
    expect(selected.keyTimes![0]).toBeGreaterThan(0);
    const reference = (time: number) => {
      const high = full.frames.findIndex((frame) => frame.time >= time);
      const b = full.frames[high],
        a = full.frames[Math.max(0, high - 1)];
      const u = b.time === a.time ? 0 : (time - a.time) / (b.time - a.time);
      return {
        center: a.center.clone().lerp(b.center, u),
        heading: T.MathUtils.lerp(a.heading, b.heading, u),
        distance: T.MathUtils.lerp(a.distance, b.distance, u),
      };
    };
    const origin = reference(start).distance;
    for (const frame of selected.frames) {
      const expected = reference(start + frame.time);
      expect(frame.center.distanceTo(expected.center)).toBeLessThan(1e-12);
      expect(frame.heading).toBeCloseTo(expected.heading, 12);
      expect(frame.distance).toBeCloseTo(expected.distance - origin, 12);
    }
    expect(selected.distance).toBeCloseTo(reference(end).distance - origin, 12);
  },
);

function routeFixture(
  size = 1,
  options: Parameters<typeof addTravelClip>[1] = {},
  units = { source: 1, target: 1 },
) {
  const source = makeRig(1, units.source);
  const original = addTravelClip(source, options);
  const native = makeRig(size, units.target);
  const nativeClip = addTravelClip(native, options);
  const target = makeRig(size, units.target);
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
  it.each(["travel", "in-place"] as const)(
    "closes measured %s travel speed at a verified loop, including a zero-speed entry",
    (mode) => {
      const profile: LocomotionProfile = {
        duration: 1,
        distance: 1,
        startHeading: 0,
        mode,
        warning: "",
        contactLoopSides: ["left", "right"],
        frames: [
          [0, 0],
          [0.1, 0],
          [0.8, 0.8],
          [1, 1],
        ].map(([time, distance]) => ({
          time,
          distance,
          center: new T.Vector3(),
          heading: 0,
        })),
      };
      for (const distance of [1, 1.02, 2.3]) {
        const duration = routeSourceDuration(profile, distance),
          at = (time: number) =>
            sampleRouteLocomotion(profile, distance, time / duration);
        expect(at(duration).travelled).toBeCloseTo(distance, 10);
        if (distance === 1) {
          expect(at(0.9).travelled).toBeCloseTo(0.9, 10);
          continue;
        }
        const h = 1e-7,
          incoming = (at(1).travelled - at(1 - h).travelled) / h,
          outgoing = (at(1 + h).travelled - at(1).travelled) / h;
        expect(incoming).toBeCloseTo(outgoing, 4);
        expect(at(1 + h).time).toBeCloseTo(h, 10);
        let previous = 0;
        for (let i = 0; i <= 500; i++) {
          const sample = at((duration * i) / 500);
          expect(sample.travelled).toBeGreaterThanOrEqual(previous - 1e-12);
          previous = sample.travelled;
        }
      }
    },
  );
  it("matches travel velocity across captured seams without changing source time or partial endpoints", () => {
    const profile: LocomotionProfile = {
      duration: 1,
      distance: 0.9,
      startHeading: 0,
      mode: "travel",
      warning: "",
      loopSpeed: 0.75,
      frames: [
        [0, 0],
        [0.2, 0.1],
        [0.8, 0.6],
        [1, 0.9],
      ].map(([time, distance]) => ({
        time,
        distance,
        center: new T.Vector3(),
        heading: 0,
      })),
    };
    for (const distance of [0.3, 0.91, 1.3, 1.8, 2.71]) {
      const duration = routeSourceDuration(profile, distance);
      let previous = -1;
      for (let i = 0; i <= 1000; i++) {
        const sample = sampleRouteLocomotion(profile, distance, i / 1000);
        expect(sample.travelled).toBeGreaterThanOrEqual(previous - 1e-12);
        expect(sample.time).toBeCloseTo(((duration * i) / 1000) % 1, 9);
        previous = sample.travelled;
      }
      expect(previous).toBeCloseTo(distance, 12);
      if (duration <= 1) continue;
      const at = (t: number) =>
        sampleRouteLocomotion(profile, distance, t / duration).travelled;
      const h = 1e-7;
      const incoming = (at(1) - at(1 - h)) / h,
        outgoing = (at(1 + h) - at(1)) / h;
      expect(incoming).toBeCloseTo(0.75, 4);
      expect(outgoing).toBeCloseTo(incoming, 4);
    }
  });
  it.each([
    { source: 100, target: 1 },
    { source: 1, target: 100 },
    { source: 0.01, target: 1000 },
  ])("preserves route poses and cadence across import units %j", (units) => {
    const options = { residual: 0.015 };
    const reference = routeFixture(1.2, options),
      candidate = routeFixture(1.2, options, units);
    const expectedProfile = locomotionProfile(
      reference.source.group,
      reference.original,
    )!;
    const actualProfile = locomotionProfile(
      candidate.source.group,
      candidate.original,
    )!;
    expect(actualProfile.duration).toBe(expectedProfile.duration);
    expect(actualProfile.distance).toBeCloseTo(expectedProfile.distance, 5);
    expect(actualProfile.contactLoopSides).toEqual(
      expectedProfile.contactLoopSides,
    );
    expect(actualProfile.contactLoopSides).toHaveLength(2);
    const sourceDuration = routeSourceDuration(
      expectedProfile,
      samplePath(reference.motion.path!, 1).length /
        locomotionScale(reference.source.group, reference.target.group),
    );
    const seam = expectedProfile.duration / sourceDuration;
    for (const progress of [
      0,
      0.12,
      0.49,
      seam - 1e-5,
      seam + 1e-5,
      0.93,
      0.2,
    ]) {
      for (const native of [false, true]) {
        const a = native ? reference.native : reference.target;
        const b = native ? candidate.native : candidate.target;
        reference.sample(a, progress, native);
        candidate.sample(b, progress, native);
        expect(b.group.userData.motionWarning ?? "").toBe("");
        expectSamePose(capture(b), capture(a));
      }
    }
  });

  it("closes a repeat using an authored terminal turn without changing a one-shot take", () => {
    const rig = makeRig();
    const times = Array.from({ length: 61 }, (_, i) => i / 6);
    const clip = new T.AnimationClip("Curved travel and terminal turn", 10, [
      new T.VectorKeyframeTrack(
        `${rig.root.uuid}.position`,
        times,
        times.flatMap((time) => {
          const angle = Math.min(time, 6) * 0.75;
          return [1 - Math.cos(angle), 0, Math.sin(angle)];
        }),
      ),
      rotationTrack(
        rig.root,
        times,
        times.map((time) =>
          time <= 6
            ? (time * 3.5) / 6
            : 3.5 + ((time - 6) * (Math.PI * 2 - 3.5)) / 4,
        ),
        up,
      ),
    ]);
    configureImportedRig(rig.group, rig.imported, [clip]);
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.warning).toMatch(/loop boundary/);
    expect(profile.loopProfile).toBeDefined();
    const loop = routeLocomotionProfile(profile, profile.distance * 2);
    expect(loop.warning).toBe("");
    expect(loop.loopAlignment!.start).toBeGreaterThan(6);
    expect(routeLocomotionProfile(profile, profile.distance)).toBe(profile);
    expect(loop.duration).toBe(clip.duration);
    expect(loop.frames.map((frame) => frame.distance)).toEqual(
      profile.frames.map((frame) => frame.distance),
    );
    const feet = [0, clip.duration].map((time, i) => {
      sampleOriginal(rig, clip, time);
      const hip = worldPosition(rig.bones.hips);
      const heading = i ? loop.frames.at(-1)!.heading : loop.frames[0].heading;
      return [rig.bones.leftFoot, rig.bones.rightFoot].map((bone) =>
        worldPosition(bone).sub(hip).applyAxisAngle(up, -heading),
      );
    });
    expect(feet[0][0].distanceTo(feet[1][0])).toBeLessThan(1e-6);
    expect(feet[0][1].distanceTo(feet[1][1])).toBeLessThan(1e-6);
  });

  it.each([1, -1])(
    "aligns sideways travel independently of hip facing (direction %s)",
    (direction) => {
      const rig = makeRig();
      const clip = new T.AnimationClip("Sideways", 4, [
        new T.VectorKeyframeTrack(
          `${rig.root.uuid}.position`,
          [0, 4],
          [0, 0, 0, direction * 2, 0, 0],
        ),
      ]);
      configureImportedRig(rig.group, rig.imported, [clip]);
      const profile = locomotionProfile(rig.group, clip)!;
      expect(profile.mode).toBe("travel");
      expect(profile.frames[120].heading).toBeCloseTo(
        (direction * Math.PI) / 2,
      );
    },
  );
  it("discloses foot seams too large for loop closure even below twelve centimeters", () => {
    const rig = makeRig();
    const clip = addTravelClip(rig, { residual: 0.06 });
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.contactLoopSides).toEqual(["right"]);
    expect(profile.loopProfile).toBeUndefined();
    expect(profile.warning).toMatch(/loop boundary after route alignment/);
  });
  it("reports a route seam when matching body poses have different travel directions", () => {
    const rig = makeRig();
    const clip = new T.AnimationClip("Changing trajectory", 4, [
      new T.VectorKeyframeTrack(
        `${rig.root.uuid}.position`,
        [0, 1, 2, 3, 4],
        [0, 0, 0, 0, 0, 1, 0, 0, 2, 1, 0, 2, 2, 0, 2],
      ),
    ]);
    configureImportedRig(rig.group, rig.imported, [clip]);
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.warning).toMatch(/loop boundary after route alignment/);
    expect(profile.contactLoopSides).toEqual([]);
  });
  it("retains a source pivot during a travel pause rather than cancelling hip yaw", () => {
    const rig = makeRig();
    const clip = new T.AnimationClip("Walk pause pivot", 6, [
      new T.VectorKeyframeTrack(
        `${rig.root.uuid}.position`,
        [0, 1, 5, 6],
        [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 2],
      ),
      rotationTrack(
        rig.bones.hips,
        [0, 1, 3, 6],
        [0, 0, Math.PI / 2, Math.PI / 2],
        up,
      ),
    ]);
    configureImportedRig(rig.group, rig.imported, [clip]);
    const profile = locomotionProfile(rig.group, clip)!;
    expect(profile.frames[180].heading).toBeCloseTo(0);
    sampleOriginal(rig, clip, 3);
    const sourceYaw = new T.Euler().setFromQuaternion(
      rig.bones.hips.quaternion,
      "YXZ",
    ).y;
    expect(sourceYaw - profile.frames[180].heading).toBeCloseTo(Math.PI / 2);
  });
  it("keeps source pauses and uniform source cadence while reaching the route endpoint", () => {
    const profile: LocomotionProfile = {
      duration: 4,
      distance: 3,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [0, 1, 2, 3, 4].map((time, index) => ({
        time,
        distance: [0, 1, 1, 2, 3][index],
        center: new T.Vector3(0, 0, [0, 1, 1, 2, 3][index]),
        heading: 0,
      })),
    };
    const before = sampleRouteLocomotion(profile, 3, 0.3);
    const after = sampleRouteLocomotion(profile, 3, 0.45);
    expect(before.time).toBeCloseTo(1.2);
    expect(after.time).toBeCloseTo(1.8);
    expect(before.travelled).toBe(1);
    expect(after.travelled).toBe(1);
    expect(sampleRouteLocomotion(profile, 3, 1).travelled).toBe(3);
    expect(routeSourceDuration(profile, 4.5)).toBeCloseTo(6.5);
    expect(sampleRouteLocomotion(profile, 4.5, 1).travelled).toBeCloseTo(4.5);
    expect(sampleRouteLocomotion(profile, 0, 0.5).travelled).toBe(0);
  });
  it("preserves off-grid source keys in accelerated route exports using distance pacing", () => {
    const f = routeFixture(1.2, { accelerating: true });
    f.actor.clips[0].duration = 0.1;
    const finger = rotationTrack(
      f.source.bones.leftHandIndex1,
      [0, 0.1234, 0.1334, 2],
      [0, 1, 0, 0],
    );
    f.original.tracks.push(finger);
    const profile = locomotionProfile(f.source.group, f.original)!;
    const ratio = locomotionScale(f.source.group, f.target.group);
    const length = samplePath(f.motion.path!, 1).length / ratio;
    const sourceTime = finger.times[1];
    const boundaries = animationSampleBoundaries(
      f.scene,
      new Map([[f.actor.id, f.target.group]]),
    );
    const expected =
      (f.actor.clips[0].duration * sourceTime) /
      routeSourceDuration(profile, length);
    expect(boundaries.some((value) => Math.abs(value - expected) < 1e-9)).toBe(
      true,
    );
    const repeated =
      (f.actor.clips[0].duration * (sourceTime + profile.duration)) /
      routeSourceDuration(profile, length);
    expect(boundaries.some((value) => Math.abs(value - repeated) < 1e-9)).toBe(
      true,
    );
    expect(
      sampleRouteLocomotion(
        profile,
        length,
        expected / f.actor.clips[0].duration,
      ).time,
    ).toBeCloseTo(sourceTime, 7);
    expect(boundaries.every((value) => value > 0 && value <= 0.1)).toBe(true);
  });
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
    const routeLength = samplePath(f.motion.path!, 1).length;
    const phase = sampleRouteLocomotion(profile, routeLength, 0.31);
    const path = samplePath(f.motion.path!, phase.travelled / routeLength);
    const expected = pathToWorld(path.point, {
      position: f.actor.position,
      heading: f.actor.rotation,
      scale: f.actor.scale,
    });
    const hip = worldPosition(rig.bones.hips);
    expect(hip.x).toBeCloseTo(expected[0], 6);
    expect(hip.z).toBeCloseTo(expected[2], 6);
    expect(rig.group.userData.motionWarning).toBe("");

    // Contact alignment may correct world yaw to keep a shoe planted. It must
    // preserve the captured foot tilt/roll and authored bone translations.
    const sourceTime = phase.time;
    expect((rig.group.userData.mixer as T.AnimationMixer).time).toBeCloseTo(
      sourceTime,
      8,
    );
    const feet = ["leftFoot", "rightFoot"].map((name) => ({
      name,
      position: rig.bones[name].position.clone(),
      quaternion: worldRotation(rig.bones[name]),
    }));
    sampleOriginal(rig, clip, sourceTime);
    for (const foot of feet) {
      expect(
        foot.position.distanceTo(rig.bones[foot.name].position),
        `${foot.name} authored position`,
      ).toBeLessThan(1e-8);
      const correction = foot.quaternion
        .clone()
        .multiply(worldRotation(rig.bones[foot.name]).invert())
        .normalize();
      expect(
        Math.hypot(correction.x, correction.z),
        `${foot.name} captured tilt`,
      ).toBeLessThan(1e-8);
    }
  });
});

describe("imported route playback through the world sampler", () => {
  it.each([true, false])(
    "carries evaluated facing across chained curved routes and reverse seeks (native=%s)",
    (native) => {
      const f = routeFixture(),
        rig = native ? f.native : f.target;
      f.actor.clips.push(
        { ...f.actor.clips[0], id: "second-route" },
        { id: "rest", motionId: "idle", duration: 2, transition: "cut" },
      );
      const direction = () =>
        new T.Vector3(0, 0, 1)
          .applyQuaternion(worldRotation(rig.bones.hips))
          .normalize();
      // Seek directly beyond both routes first: facing cannot rely on a previously
      // played frame, and recursively resolving predecessors must stay bounded.
      f.sample(rig, 2.1, native);
      const final = direction();
      for (const boundary of [2, 1, 2]) {
        f.sample(rig, boundary - 1e-8, native);
        const before = direction();
        f.sample(rig, boundary + 1e-8, native);
        expect(direction().angleTo(before)).toBeLessThan(2e-6);
      }
      f.sample(rig, 0, native);
      f.sample(rig, 2.1, native);
      expect(direction().angleTo(final)).toBeLessThan(2e-6);
    },
  );
  it.each([
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ])(
    "retains native entry facing and detailed motion for travel (%s, %s)",
    (x, z) => {
      const f = routeFixture(1.4),
        reference = makeRig(1.4),
        referenceClip = addTravelClip(reference);
      for (const [rig, take] of [
        [f.source, f.original],
        [f.native, f.nativeClip],
        [reference, referenceClip],
      ] as const) {
        const track = take.tracks[0];
        track.times.forEach((time, i) => {
          track.values[i * 3] = (1.5 + x * time * 2) * rig.units;
          track.values[i * 3 + 2] = (-2 + z * time * 2) * rig.units;
        });
      }
      const range = { start: 0.4, end: 1.4 },
        profile = locomotionProfile(f.source.group, f.original, range)!;
      const heading = routeEntryHeading(profile),
        length = profile.distance * 1.4;
      f.motion.path = {
        points: [
          [0, 0, 0],
          [Math.sin(heading) * length, 0, Math.cos(heading) * length],
        ],
        smooth: false,
        sourceRange: range,
      };
      f.actor.clips[0].duration = 1;
      f.actor.clips[0].playbackRate = 1;
      f.actor.clips.push({
        id: "after-route",
        motionId: "idle",
        duration: 1,
        transition: "cut",
      });
      // The following Standing idle is a recording: every rig needs its source.
      for (const rig of [f.native, reference])
        setMotionSources(rig.group, new Map(recordedSourceMap));
      setMotionSources(
        f.target.group,
        new Map([...recordedSourceMap, ["route-source", f.source.group]]),
      );
      const nativeMotion = {
        ...f.motion,
        id: "native-reference",
        path: undefined,
      };
      const referenceScene = {
        ...f.scene,
        customMotions: [...f.scene.customMotions, nativeMotion],
      };
      const referenceActor = {
        ...f.actor,
        assetId: "route-source",
        clips: [
          {
            ...f.actor.clips[0],
            motionId: nativeMotion.id,
            sourceStart: range.start,
          },
          f.actor.clips[1],
        ],
      };
      for (const progress of [
        0,
        0.000001,
        0.03,
        0.4,
        0.9,
        1 - 1e-7,
        1,
        1.1,
        0,
      ]) {
        applyAnimatedEntityPose(
          reference.group,
          referenceActor,
          referenceScene,
          progress,
        );
        for (const [rig, native] of [
          [f.native, true],
          [f.target, false],
        ] as const) {
          f.sample(rig, progress, native);
          expect(rig.group.userData.motionWarning).toBe("");
          for (const name of [
            "hips",
            "head",
            "leftArm",
            "rightForearm",
            "leftHand",
            "leftHandIndex1",
          ])
            expect(
              worldRotation(rig.bones[name]).angleTo(
                worldRotation(reference.bones[name]),
              ),
              `${name} at ${progress}, native=${native}`,
            ).toBeLessThan(2e-6);
          if (progress < 1)
            expect(
              (native ? rig.group : f.source.group).userData.mixer.time,
            ).toBeCloseTo(range.start + progress, 6);
        }
      }
    },
  );
  it.each([1, 1.4])(
    "centers native and transferred rigs of size %s with matching poses and unchanged authored joints outside loop blends",
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
        const window = Math.min(0.2, f.original.duration * 0.2);
        const blending =
          phase.time > f.original.duration - window ||
          (phase.repeated && phase.time < window);
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
          ).toBeLessThan(blending ? 0.35 : 2e-6);
          expect(
            f.target.bones[name].quaternion
              .clone()
              .normalize()
              .angleTo(f.source.bones[name].quaternion.clone().normalize()),
            name,
          ).toBeLessThan(blending ? 0.35 : 2e-6);
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
    applyHumanoidPose(f.target.group, {}, false);
    const neutral = Object.fromEntries(
      Object.entries(f.target.bones).map(([name, bone]) => [
        name,
        bone.quaternion.clone(),
      ]),
    );
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
          f.target.bones[name].quaternion.angleTo(neutral[name]),
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
    applyHumanoidPose(f.native.group, {}, false);
    const neutral = Object.fromEntries(
      Object.entries(f.native.bones).map(([name, bone]) => [
        name,
        bone.quaternion.clone(),
      ]),
    );
    f.sample(f.native, 0.4, true);
    expect(f.native.group.userData.motionWarning).toMatch(
      /measurable foot stride/i,
    );
    for (const name of ["leftLeg", "rightLeg", "leftShin", "rightShin"])
      expect(
        f.native.bones[name].quaternion.angleTo(neutral[name]),
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

describe("native source intervals for navigation", () => {
  it.each([1, 100])(
    "measures exact trimmed travel and explicit speed with source units %s",
    (units) => {
      const f = routeFixture(1.5, {}, { source: units, target: 1 });
      const scheduled = {
        id: "native",
        motionId: "native",
        sourceStart: 0.73,
        duration: 0.3,
        playbackRate: 2,
      };
      const measured = measureNativeTravel(
        f.source.group,
        f.target.group,
        f.original,
        scheduled,
      )!;
      expect(measured.sourceStart).toBe(0.73);
      expect(measured.sourceEnd).toBeCloseTo(1.33, 12);
      expect(measured.activeDuration).toBe(0.3);
      expect(measured.holdDuration).toBe(0);
      expect(measured.playbackRate).toBe(2);
      expect(measured.ratio).toBeCloseTo(1.5, 8);
      const expected = new T.Vector3(0, 0, 1.2 * 1.5).applyAxisAngle(up, -0.7);
      expect(
        Math.hypot(
          measured.destination.x - expected.x,
          measured.destination.z - expected.z,
        ),
      ).toBeLessThan(1e-6);
      // The captured feet also change height; retain that evidence for the
      // planner rather than silently projecting a nonlevel take onto ground.
      expect(Math.abs(measured.destination.y)).toBeGreaterThan(0.001);
      expect(measured.endHeading).toBeCloseTo(0, 8);
      const profile = measured.profile!;
      expect(profile.sourceStart).toBe(0.73);
      expect(profile.duration).toBeCloseTo(0.6, 12);
      expect(profile.frames[0].time).toBe(0);
      expect(profile.frames.at(-1)!.time).toBeCloseTo(0.6, 12);
      expect(profile.distance).toBeCloseTo(1.2, 5);
      expect(profile.startHeading).toBeCloseTo(0.7, 6);
      expect(profile.mode).toBe("travel");
      for (const contact of [
        ...profile.contacts!,
        ...profile.nativeContacts!,
      ]) {
        expect(contact.start).toBeGreaterThanOrEqual(0);
        expect(contact.end).toBeLessThanOrEqual(profile.duration);
      }
      const sample = sampleRouteLocomotion(profile, profile.distance, 0.25);
      expect(sample.time).toBeCloseTo(0.15, 8);
      expect(sample.sourceTime).toBeCloseTo(0.88, 8);
      expect(
        routeSourceBoundaries(
          profile,
          [0, 0.8, 1.11, 1.9],
          profile.distance,
          0.3,
        ),
      ).toContainEqual(expect.closeTo((1.11 - 0.73) / 2, 8));
    },
  );

  it("retains travelling classification for short windows and separates final holds from captured travel", () => {
    const f = routeFixture();
    const window = locomotionProfile(f.source.group, f.original, {
      start: 1.1,
      end: 1.2,
    })!;
    expect(window.mode).toBe("travel");
    expect(window.distance).toBeCloseTo(0.2, 5);
    const held = measureNativeTravel(
      f.source.group,
      f.source.group,
      f.original,
      {
        id: "held",
        motionId: "native",
        sourceStart: 1.5,
        duration: 3,
        playbackRate: 2,
      },
    )!;
    expect(held.activeDuration).toBe(0.25);
    expect(held.holdDuration).toBe(2.75);
    expect(held.sourceEnd).toBe(2);
    expect(held.profile!.duration).toBe(0.5);
    expect(Math.hypot(held.destination.x, held.destination.z)).toBeCloseTo(
      1,
      5,
    );
    const finalHold = measureNativeTravel(
      f.source.group,
      f.source.group,
      f.original,
      {
        id: "final",
        motionId: "native",
        sourceStart: 2,
        duration: 3,
        playbackRate: 2,
      },
    )!;
    expect(finalHold.activeDuration).toBe(0);
    expect(finalHold.holdDuration).toBe(3);
    expect(finalHold.destination.length()).toBe(0);
    expect(finalHold.endHeading).toBe(0);
    expect(finalHold.profile).toBeUndefined();
  });

  it("preserves the complete displayed source pose and isolates interval caches", () => {
    const f = routeFixture();
    sampleNativeClip(f.source.group, f.original, 0.4567);
    f.source.group.position.set(3, 4, 5);
    f.source.group.rotation.y = 0.4;
    const transforms = () => {
      const result: number[][] = [];
      f.source.group.traverse((n) =>
        result.push([
          ...n.position.toArray(),
          ...n.quaternion.toArray(),
          ...n.scale.toArray(),
        ]),
      );
      return result;
    };
    const before = transforms();
    const full = locomotionProfile(f.source.group, f.original)!;
    const snapshot = JSON.stringify(full);
    const first = locomotionProfile(f.source.group, f.original, {
      start: 0.7,
      end: 1.3,
    })!;
    expect(transforms()).toEqual(before);
    const second = locomotionProfile(f.source.group, f.original, {
      start: 0.8,
      end: 1.4,
    })!;
    expect(second).not.toBe(first);
    expect(
      locomotionProfile(f.source.group, f.original, { start: 0.7, end: 1.3 }),
    ).toBe(first);
    expect(
      locomotionProfile(f.source.group, f.original, { start: 0, end: 2 }),
    ).toBe(full);
    expect(JSON.stringify(full)).toBe(snapshot);
    expect(transforms()).toEqual(before);
    for (const range of [
      { start: -1, end: 1 },
      { start: 1, end: 0 },
      { start: 0, end: 3 },
      { start: NaN, end: 1 },
      { start: 1, end: 1 },
    ]) {
      expect(
        locomotionProfile(f.source.group, f.original, range),
      ).toBeUndefined();
      expect(transforms()).toEqual(before);
    }
  });
});

describe("selected imported source intervals on routes", () => {
  it.each([true, false])(
    "keeps source time and detailed joints while mapped waypoints retain their captured phase (native=%s)",
    (native) => {
      const f = routeFixture(1.2),
        profile = locomotionProfile(f.source.group, f.original)!;
      const length = profile.distance * 1.2;
      f.motion.path = {
        points: [
          [0, 0, 0],
          [0, 0, length * 0.45],
          [0, 0, length],
        ],
        smooth: false,
        strideScale: 1,
        sourceProgress: [0, 0.5, 1],
        sourceRange: { start: 0, end: 2 },
      };
      f.actor.clips[0].duration = 2;
      const rig = native ? f.native : f.target;
      sampleOriginal(f.source, f.original, 1);
      const finger = f.source.bones.leftHandIndex1.quaternion
        .clone()
        .normalize();
      for (const progress of [0.5, 0.8, 0.5]) {
        f.sample(rig, progress, native);
        expect(
          (native ? rig.group : f.source.group).userData.mixer.time,
        ).toBeCloseTo(2 * progress, 7);
        if (progress !== 0.5) continue;
        const expected = pathToWorld([0, 0, length * 0.45], {
          position: f.actor.position,
          heading: f.actor.rotation,
          scale: f.actor.scale,
        });
        const hip = rig.bones.hips.getWorldPosition(new T.Vector3());
        expect(
          Math.hypot(hip.x - expected[0], hip.z - expected[2]),
        ).toBeLessThan(1e-6);
        expect(
          rig.bones.leftHandIndex1.quaternion
            .clone()
            .normalize()
            .angleTo(finger),
        ).toBeLessThan(1e-6);
      }
      f.motion.path = { ...f.motion.path!, sourceProgress: [0, 0.413, 1] };
      const boundaries = animationSampleBoundaries(
        f.scene,
        new Map([[f.actor.id, f.target.group]]),
      );
      expect(boundaries.some((t) => Math.abs(t - 0.826) < 1e-8)).toBe(true);
    },
  );

  it.each([0.9, 1, 1.1])(
    "plays the selected source seconds and detailed joints with step length %s on native and transferred receivers",
    (strideScale) => {
      const f = routeFixture(1.2),
        range = { start: 0.73, end: 1.33 };
      const profile = locomotionProfile(f.source.group, f.original, range)!;
      f.motion.path = {
        points: [
          [0, 0, 0],
          [0, 0, profile.distance * 1.2 * strideScale],
        ],
        smooth: false,
        strideScale,
        sourceRange: range,
      };
      f.actor.clips[0].duration = profile.duration / 1.25;
      for (const progress of [0.1, 0.7, 0.4, 0.99, 0.1]) {
        const seconds = range.start + profile.duration * progress;
        sampleOriginal(f.source, f.original, seconds);
        const expected = f.source.bones.leftHandIndex1.quaternion.clone();
        for (const native of [false, true]) {
          const rig = native ? f.native : f.target;
          f.sample(rig, progress, native);
          expect(rig.group.userData.motionWarning ?? "").toBe("");
          expect(
            rig.bones.leftHandIndex1.quaternion.angleTo(expected),
          ).toBeLessThan(1e-6);
          expect(
            (native ? rig.group : f.source.group).userData.mixer.time,
          ).toBeCloseTo(seconds, 7);
        }
      }
      const boundaries = animationSampleBoundaries(
        f.scene,
        new Map([[f.actor.id, f.target.group]]),
      );
      expect(
        boundaries.some((t) => Math.abs(t - (1 - range.start) / 1.25) < 1e-7),
      ).toBe(true);
      f.motion.path.sourceRange = { start: 8, end: 9 };
      f.sample(f.target, 0.3);
      expect(f.target.group.userData.motionWarning).toMatch(/unavailable/);
    },
  );

  it.each([false, true])(
    "retains every evaluated joint and foot contact when a %s-native gait is offset inside a longer source file",
    (native) => {
      const reference = routeFixture(1.2),
        offset = routeFixture(1.2);
      for (const clip of [offset.original, offset.nativeClip]) {
        clip.tracks.forEach((track) => track.shift(5));
        clip.duration = 7;
      }
      offset.motion.path!.sourceRange = { start: 5, end: 7 };
      for (const progress of [0, 0.04, 0.19, 0.43, 0.69, 0.9, 0.99999, 0.12]) {
        const a = native ? reference.native : reference.target,
          b = native ? offset.native : offset.target;
        reference.sample(a, progress, native);
        offset.sample(b, progress, native);
        expect(b.group.userData.motionWarning ?? "").toBe("");
        expectSamePose(capture(b), capture(a));
      }
    },
  );
});

describe("standalone imported AI navigation", () => {
  function fixture(native: boolean, hold = 0.5, rate = 1) {
    const f = routeFixture(),
      rig = native ? f.native : f.target;
    // Use smooth periodic keys at all detailed joints, with a stable root frame.
    for (const take of [f.original, f.nativeClip]) {
      take.tracks = take.tracks.map((track, i) => {
        if (i < 2 || track.ValueTypeName !== "quaternion") return track;
        const times = Array.from({ length: 121 }, (_, j) => j / 60);
        return new T.QuaternionKeyframeTrack(
          track.name,
          times,
          times.flatMap((t) =>
            new T.Quaternion()
              .setFromAxisAngle(
                new T.Vector3(1, 0, 0),
                0.15 * Math.sin(t * Math.PI * 2),
              )
              .toArray(),
          ),
        );
      });
    }
    f.actor.assetId = native ? "route-source" : f.actor.assetId;
    f.actor.position = [0, 0, 0];
    f.actor.rotation = 0;
    f.actor.scale = 1;
    f.actor.ending = "hold";
    f.motion.path = undefined;
    f.actor.clips = [
      {
        id: "native-walk",
        motionId: f.motion.id,
        duration: 2 / rate + hold,
        playbackRate: rate,
        transition: "cut",
      },
    ];
    for (const bone of Object.values(rig.bones))
      bone.add(
        new T.Mesh(
          new T.SphereGeometry(0.045, 6, 4),
          new T.MeshBasicMaterial(),
        ),
      );
    const previous = { ...f.scene, entities: [{ ...f.actor, clips: [] }] };
    let scene = withAutomaticMovement(previous, validateScene(f.scene));
    const travel = measureNativeTravel(
      native ? rig.group : f.source.group,
      rig.group,
      native ? f.nativeClip : f.original,
      scene.entities[0].clips[0],
    )!;
    const midpoint = travel.destination.clone().multiplyScalar(0.5).toArray();
    midpoint[1] = 0;
    scene = applyCommands(scene, [
      { type: "add", assetId: "crate", id: "block", position: midpoint },
    ]);
    const objects = new Map([
      [f.actor.id, rig.group],
      ["block", createProp("crate", "#888888")],
    ]);
    return { ...f, rig, scene, travel, objects };
  }
  it.each([true, false])(
    "reroutes a measured repeating performance at unchanged speed and retains its held tail (native=%s)",
    (native) => {
      const f = fixture(native),
        original = JSON.stringify(f.scene),
        actorId = f.actor.id;
      expect(
        inspectNativeLoop(
          native ? f.rig.group : f.source.group,
          native ? f.nativeClip : f.original,
          f.travel.profile!,
        ).allowed,
      ).toBe(true);
      expect(
        inspectRouteClearance(f.scene, f.objects, actorId, "native-walk")
          .blocked,
      ).not.toBeNull();
      const prepared = prepareAutomaticRoutes(f.scene, f.objects);
      expect(prepared.issues).toEqual([]);
      const actor = prepared.scene.entities[0],
        clip = actor.clips[0],
        motion = allMotions(prepared.scene).find(
          (m) => m.id === clip.motionId,
        )!;
      expect(motion.path).toBeDefined();
      expect(clip.duration).toBeGreaterThan(2.5);
      expect(clip.playbackRate).toBe(1);
      expect(clip.routeHold).toBeCloseTo(0.5, 8);
      expect(motion.path?.sourceRange).toEqual({ start: 0, end: 2 });
      expect(
        inspectRouteClearance(prepared.scene, f.objects, actorId, clip.id)
          .blocked,
      ).toBeNull();
      const active = clip.duration - clip.routeHold!;
      applyAnimatedEntityPose(
        f.rig.group,
        actor,
        prepared.scene,
        active - 1e-7,
      );
      const last = capture(f.rig);
      for (const t of [active, active + 0.2, clip.duration, active + 0.1]) {
        applyAnimatedEntityPose(f.rig.group, actor, prepared.scene, t);
        expectSamePose(capture(f.rig), last);
      }
      expect(animationSampleBoundaries(prepared.scene, f.objects)).toContain(
        active,
      );
      const final = routeContext(prepared.scene, f.objects, actorId).frame;
      expect(
        new T.Vector3(...final.position).distanceTo(f.travel.destination),
      ).toBeLessThan(1e-5);
      expect(Math.abs(final.heading - f.travel.endHeading)).toBeLessThan(1e-5);
      expect(JSON.stringify(f.scene)).toBe(original);
      const clear = applyCommands(prepared.scene, [
        { type: "update", id: "block", changes: { position: [20, 0, 20] } },
      ]);
      const restored = prepareAutomaticRoutes(clear, f.objects);
      expect(restored.issues).toEqual([]);
      expect(restored.scene.entities[0].clips).toEqual(
        f.scene.entities[0].clips,
      );
      expect(restored.scene.customMotions).toEqual(f.scene.customMotions);
      const blockedAgain = applyCommands(restored.scene, [
        {
          type: "update",
          id: "block",
          changes: {
            position: f.scene.entities.find((e) => e.id === "block")!.position,
          },
        },
      ]);
      const again = prepareAutomaticRoutes(blockedAgain, f.objects);
      expect(again.issues).toEqual([]);
      expect(again.scene.entities[0].clips[0].motionId).toBe(clip.motionId);
      expect(again.scene.customMotions).toHaveLength(
        prepared.scene.customMotions.length,
      );
    },
  );
  it.each([true, false])(
    "stops an authored travelling performance blocked while playing, holds the reached frame, and continues the rest of the take once clear (native=%s)",
    (native) => {
      const f = fixture(native),
        actorId = f.actor.id;
      const clear = applyCommands(f.scene, [
        { type: "update", id: "block", changes: { position: [20, 0, 20] } },
      ]);
      // Tables around the destination leave no clear way to it at all.
      const goal = f.travel.destination;
      const walls: [string, [number, number, number]][] = (
        [
          [1.3, 0],
          [-1.3, 0],
          [0, 1.3],
          [0, -1.3],
        ] as const
      ).map(([dx, dz], index) => [
        `wall-${index}`,
        [goal.x + dx, 0, goal.z + dz],
      ]);
      const enclosed = applyCommands(f.scene, [
        {
          type: "update",
          id: "block",
          changes: { position: [goal.x * 0.8, 0, goal.z * 0.8] },
        },
        ...walls.map(([id, position]) => ({
          type: "add" as const,
          assetId: "table",
          id,
          position,
        })),
      ]);
      for (const [id] of walls)
        f.objects.set(id, createProp("table", "#997744"));
      const pose = (scene: Scene, time: number) => {
        applyAnimatedEntityPose(
          f.rig.group,
          scene.entities.find((e) => e.id === actorId)!,
          scene,
          time,
        );
        f.rig.group.updateWorldMatrix(true, true);
        return {
          hips: worldPosition(f.rig.bones.hips).toArray(),
          leftFoot: worldPosition(f.rig.bones.leftFoot).toArray(),
          rightFoot: worldPosition(f.rig.bones.rightFoot).toArray(),
          head: worldPosition(f.rig.bones.head).toArray(),
          hand: worldPosition(f.rig.bones.leftHand).toArray(),
        };
      };
      const same = (
        a: ReturnType<typeof pose>,
        b: ReturnType<typeof pose>,
        tolerance: number,
      ) => {
        for (const key of Object.keys(a) as (keyof typeof a)[])
          expect(
            Math.hypot(...a[key].map((n, i) => n - b[key][i])),
            key,
          ).toBeLessThan(tolerance);
      };
      // The block arrives while the authored take is being played.
      const at = 0.3;
      const stopped = prepareAutomaticRoutes(
        enclosed,
        f.objects,
        undefined,
        at,
      );
      expect(stopped.issues).toHaveLength(1);
      expect(stopped.issues[0].message).toContain("stopped before");
      expect(stopped.issues[0].message).toContain(
        "No measured standing performance",
      );
      const saved = stopped.scene.entities[0].clips[0];
      expect(saved.id).toBe("native-walk");
      expect(saved.navigation?.native).toEqual(
        f.scene.entities[0].clips[0].navigation!.native,
      );
      // It walks on to its next grounded moment before the block.
      expect(saved.routeStop).toBeGreaterThan(at + 0.1);
      expect(saved.routeStop).toBeLessThan(saved.duration);
      expect(stopped.issues[0].message).toContain("walks on");
      const stop = saved.routeStop!;
      expect(() =>
        validateScene(JSON.parse(JSON.stringify(stopped.scene))),
      ).not.toThrow();
      // Nothing played before the stop moved; the held body stays where it
      // stopped, in the frame it had reached, however far the timeline runs.
      for (const time of [0, at * 0.5, at, stop - 1e-4])
        same(pose(stopped.playbackScene, time), pose(clear, time), 1e-9);
      const held = pose(stopped.playbackScene, stop);
      for (const time of [stop + 0.3, 2, 5, 40])
        same(pose(stopped.playbackScene, time), held, 1e-6);
      expect(
        inspectRouteClearance(
          stopped.playbackScene,
          f.objects,
          actorId,
          "native-walk",
        ).blocked,
      ).toBeNull();
      // The block leaves after a long wait: the played take is cut at the
      // stop, the wait holds the reached source frame in clips of up to a
      // minute, and the rest of the take continues as the same native intent.
      const resumeAt = 70;
      const opened = applyCommands(stopped.scene, [
        { type: "update", id: "block", changes: { position: [20, 0, 20] } },
        ...walls.map(([id], index) => ({
          type: "update" as const,
          id,
          changes: {
            position: [20 + index * 3, 0, 25] as [number, number, number],
          },
        })),
      ]);
      const resumed = prepareAutomaticRoutes(
        opened,
        f.objects,
        undefined,
        resumeAt,
      );
      expect(resumed.issues).toEqual([]);
      const clips = resumed.scene.entities[0].clips;
      expect(clips[0]).toMatchObject({ id: "native-walk", duration: stop });
      expect(clips[0].navigation).toBeUndefined();
      expect(clips[0].routeStop).toBeUndefined();
      const waits = clips.slice(1, -1);
      expect(waits.length).toBeGreaterThanOrEqual(2);
      expect(
        waits.every(
          (c) =>
            c.duration <= 60 &&
            c.motionId === f.motion.id &&
            c.sourceStart === stop &&
            c.routeStop !== undefined &&
            c.routeStop < 1e-3,
        ),
      ).toBe(true);
      expect(waits.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(
        resumeAt - stop,
        6,
      );
      const continuation = clips.at(-1)!;
      expect(continuation.id).toBe("native-walk:continue");
      expect(continuation.sourceStart).toBeCloseTo(stop, 9);
      expect(continuation.duration).toBeCloseTo(2 + 0.5 - stop, 6);
      expect(continuation.navigation?.native).toMatchObject({
        motionId: f.motion.id,
        sourceStart: stop,
        playbackRate: 1,
      });
      expect(continuation.transition).toBe("smooth");
      expect(() =>
        validateScene(JSON.parse(JSON.stringify(resumed.scene))),
      ).not.toThrow();
      for (const time of [0, at, stop - 1e-4])
        same(pose(resumed.scene, time), pose(clear, time), 1e-9);
      for (const time of [stop + 1, 30, 59.9, 60.1, resumeAt - 1e-3])
        same(pose(resumed.scene, time), held, 1e-5);
      // The continuation picks the take up where it was cut and reaches the
      // authored destination.
      const start = pose(resumed.scene, resumeAt + 1e-3);
      same(start, held, 0.02);
      const total = clips.reduce((sum, c) => sum + c.duration, 0);
      const end = routeContext(resumed.scene, f.objects, actorId).frame;
      expect(
        new T.Vector3(...end.position).distanceTo(f.travel.destination),
      ).toBeLessThan(0.05);
      expect(total).toBeGreaterThan(resumeAt);
      expect(
        prepareAutomaticRoutes(
          resumed.scene,
          f.objects,
          undefined,
          resumeAt + 1,
        ).scene,
      ).toBe(resumed.scene);
    },
  );
  it.each([0.75, 1.6])(
    "retains an explicit %s source speed through a detour and hold",
    (rate) => {
      const f = fixture(false, 0.37, rate),
        prepared = prepareAutomaticRoutes(f.scene, f.objects);
      expect(prepared.issues).toEqual([]);
      const actor = prepared.scene.entities[0],
        clip = actor.clips[0],
        active = clip.duration - clip.routeHold!;
      expect(clip.playbackRate).toBe(rate);
      expect(clip.routeHold).toBeCloseTo(0.37, 8);
      for (const t of [0.03, active * 0.43, active * 0.91, 0.03]) {
        applyAnimatedEntityPose(f.rig.group, actor, prepared.scene, t);
        expect(f.source.group.userData.mixer.time).toBeCloseTo(
          (t * rate) % 2,
          6,
        );
      }
    },
  );
  it.each([false, true])(
    "checks an animated crossing during native travel/hold and replans when spatially possible (destination=%s)",
    (atDestination) => {
      const f = fixture(false),
        endpoint = f.travel.destination
          .clone()
          .multiplyScalar(atDestination ? 1 : 0.5);
      const crossingDuration = atDestination ? 4.4 : 2;
      const moving = applyCommands(f.scene, [
        {
          type: "update",
          id: "block",
          changes: { position: [endpoint.x + 3, 0, endpoint.z], scale: 0.3 },
        },
        {
          type: "createMotion",
          motion: {
            id: "cross-native",
            name: "Cross destination",
            kind: "walk",
            distance: 0,
            duration: crossingDuration,
            poses: [],
            path: {
              points: [
                [0, 0, 0],
                [-20, 0, 0],
              ],
              smooth: false,
            },
          },
        },
        {
          type: "update",
          id: "block",
          changes: {
            clips: [
              {
                id: "cross-native-clip",
                motionId: "cross-native",
                duration: crossingDuration,
              },
            ],
          },
        },
      ]);
      const blocked = inspectRouteClearance(
        moving,
        f.objects,
        f.actor.id,
        "native-walk",
      );
      expect(blocked.blocked).not.toBeNull();
      expect(blocked.conflicts[0].moving).toBe(true);
      const prepared = prepareAutomaticRoutes(moving, f.objects);
      if (atDestination) {
        // Waiting for a temporary goal obstruction still needs a captured
        // waiting/continuation performance. Until then, retain the authored
        // take and hold before it rather than accepting a colliding destination.
        expect(prepared.issues[0]?.message).toMatch(/stopping place/);
        expect(prepared.scene).toBe(moving);
        expect(prepared.playbackScene.entities[0].clips).toEqual([]);
        return;
      }
      expect(prepared.issues).toEqual([]);
      expect(prepared.scene.entities[0].clips[0].routeHold).toBeCloseTo(0.5, 8);
      expect(
        inspectRouteClearance(
          prepared.scene,
          f.objects,
          f.actor.id,
          "native-walk",
        ).blocked,
      ).toBeNull();
    },
  );
  it("keeps clear source poses, source windows and timing unchanged, and honors collision disabling", () => {
    const f = fixture(false),
      actor = f.scene.entities[0];
    const disabled = { ...f.scene, animationCollisions: false };
    expect(prepareAutomaticRoutes(disabled, f.objects).scene).toBe(disabled);
    const clear = applyCommands(f.scene, [
      { type: "update", id: "block", changes: { position: [20, 0, 20] } },
    ]);
    const before: ReturnType<typeof capture>[] = [];
    for (const t of [0, 0.43, 1.7, 2.4, 0.2]) {
      applyAnimatedEntityPose(f.rig.group, clear.entities[0], clear, t);
      before.push(capture(f.rig));
    }
    const prepared = prepareAutomaticRoutes(clear, f.objects);
    expect(prepared.issues).toEqual([]);
    expect(prepared.scene).toBe(clear);
    [0, 0.43, 1.7, 2.4, 0.2].forEach((t, i) => {
      applyAnimatedEntityPose(f.rig.group, actor, prepared.scene, t);
      expectSamePose(capture(f.rig), before[i]);
    });
  });
  it.each([true, false])(
    "retains a one-off performance's full clock, ending and hold on a small detour (native=%s)",
    (native) => {
      const rate = 1.4,
        f = fixture(native, 0.37, rate);
      const take = native ? f.nativeClip : f.original;
      const source = native ? f.rig : f.source;
      const finger = take.tracks.find(
        (t) => t.name === source.bones.leftHandIndex1.uuid + ".quaternion",
      )!;
      finger.values.set(
        new T.Quaternion()
          .setFromAxisAngle(new T.Vector3(1, 0, 0), 0.8)
          .toArray(),
        finger.values.length - 4,
      );
      // Controlled ground evidence isolates the planner's non-loop branch. Real
      // source-contact detection and receiving stance correction have separate tests.
      // Keep the controlled contact in the take's actual source coordinates;
      // the clip starts away from the origin and contact warping consumes it.
      sampleOriginal(source, take, 0);
      const planted = source.group.worldToLocal(
        worldPosition(source.bones.leftFoot),
      );
      f.travel.profile!.nativeContacts = [
        {
          side: "left",
          start: 0,
          end: 0.2,
          samples: [
            { time: 0, point: planted.clone() },
            { time: 0.2, point: planted.clone() },
          ],
        },
      ];
      const obstacle = f.scene.entities.find((e) => e.id === "block")!;
      f.scene = applyCommands(f.scene, [
        {
          type: "update",
          id: "block",
          changes: {
            scale: 0.1,
            position: [obstacle.position[0] + 0.2, 0, obstacle.position[2]],
          },
        },
      ]);
      expect(
        inspectNativeLoop(source.group, take, f.travel.profile!).allowed,
      ).toBe(false);
      expect(
        inspectRouteClearance(f.scene, f.objects, f.actor.id, "native-walk")
          .blocked,
      ).not.toBeNull();
      const prepared = prepareAutomaticRoutes(f.scene, f.objects);
      expect(prepared.issues).toEqual([]);
      const actor = prepared.scene.entities[0],
        clip = actor.clips[0];
      const motion = allMotions(prepared.scene).find(
        (m) => m.id === clip.motionId,
      )!;
      expect(motion.path?.strideScale).toBeGreaterThanOrEqual(0.9);
      expect(motion.path?.strideScale).toBeLessThanOrEqual(1.1);
      expect(clip.duration).toBe(f.scene.entities[0].clips[0].duration);
      expect(clip.playbackRate).toBe(rate);
      expect(clip.routeHold).toBeCloseTo(0.37, 8);
      expect(motion.path?.sourceRange).toEqual({ start: 0, end: 2 });
      expect(
        inspectRouteClearance(prepared.scene, f.objects, actor.id, clip.id)
          .blocked,
      ).toBeNull();
      for (const t of [0.03, 0.8, 1.42, 0.03]) {
        sampleOriginal(source, take, t * rate);
        const expected = source.bones.leftHandIndex1.quaternion
          .clone()
          .normalize();
        applyAnimatedEntityPose(f.rig.group, actor, prepared.scene, t);
        expect(source.group.userData.mixer.time).toBeCloseTo(t * rate, 7);
        expect(
          f.rig.bones.leftHandIndex1.quaternion
            .clone()
            .normalize()
            .angleTo(expected),
        ).toBeLessThan(1e-6);
      }
      applyAnimatedEntityPose(
        f.rig.group,
        actor,
        prepared.scene,
        clip.duration,
      );
      expect(source.group.userData.mixer.time).toBeCloseTo(2, 6);
      const clear = applyCommands(prepared.scene, [
        { type: "update", id: "block", changes: { position: [20, 0, 20] } },
      ]);
      const restored = prepareAutomaticRoutes(clear, f.objects);
      expect(restored.issues).toEqual([]);
      expect(restored.scene.entities[0].clips).toEqual(
        f.scene.entities[0].clips,
      );
      expect(restored.scene.customMotions).toEqual(f.scene.customMotions);
    },
  );
  it("holds an incompatible one-off performance without repeating or losing its saved data", () => {
    const f = fixture(false);
    const finger = f.original.tracks.find(
      (t) => t.name === f.source.bones.leftHandIndex1.uuid + ".quaternion",
    )!;
    finger.values.set(
      new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), 1).toArray(),
      finger.values.length - 4,
    );
    const prepared = prepareAutomaticRoutes(f.scene, f.objects);
    expect(prepared.issues[0]?.message).toMatch(/continuously|continuation/);
    expect(prepared.scene).toBe(f.scene);
    expect(prepared.playbackScene.entities[0].clips).toEqual([]);
  });
});

describe("captured continuation source evidence", () => {
  function fixture() {
    const f = routeFixture(),
      take = f.original;
    take.duration = 4;
    take.tracks[0] = new T.VectorKeyframeTrack(
      take.tracks[0].name,
      [0, 4],
      [1.5, 0, -2, 1.5, 0, 0],
    );
    for (let i = 2; i < take.tracks.length; i++)
      if (take.tracks[i].ValueTypeName === "quaternion") {
        const times = Array.from({ length: 241 }, (_, j) => j / 60);
        take.tracks[i] = new T.QuaternionKeyframeTrack(
          take.tracks[i].name,
          times,
          times.flatMap((t) =>
            new T.Quaternion()
              .setFromAxisAngle(
                new T.Vector3(1, 0, 0),
                0.15 * Math.sin(t * Math.PI * 2),
              )
              .toArray(),
          ),
        );
      }
    // A unique ending prevents whole-take repetition. Interior steps remain
    // periodic. Contact-classification tests cover measured support separately;
    // this search test supplies a controlled support interval, with real poses.
    take.tracks.push(
      rotationTrack(f.source.bones.head, [0, 3.5, 4], [0, 0, 0.7]),
    );
    const profile = locomotionProfile(f.source.group, take)!;
    profile.nativeContacts = [
      {
        side: "left",
        start: 0,
        end: 4,
        samples: [
          { time: 0, point: new T.Vector3() },
          { time: 4, point: new T.Vector3() },
        ],
      },
    ];
    return { ...f, profile };
  }
  it("finds compatible interior phases without treating a unique ending as repeatable", () => {
    const f = fixture();
    expect(
      inspectNativeLoop(f.source.group, f.original, f.profile).allowed,
    ).toBe(false);
    const result = findCapturedContinuations(
      f.source.group,
      f.original,
      f.profile,
    );
    expect(result.matches.length).toBeGreaterThan(0);
    const match = result.matches[0];
    expect(match.sourceStart).toBeGreaterThan(0.2);
    expect(match.sourceEnd).toBeLessThan(3.5);
    expect(match.positionMax).toBeLessThan(0.05);
    expect(match.rotationMax).toBeLessThan(0.35);
    expect(match.support).toBe(1);
  });
  it("restores sampled bones, morphs and mixer time when continuation search is cancelled", () => {
    const f = fixture();
    f.source.bones.leftHand.rotation.z = 0.41;
    f.source.group.userData.mixer.time = 1.234;
    const before = capture(f.source),
      work = findCapturedContinuationSteps(
        f.source.group,
        f.original,
        f.profile,
      );
    expect(work.next().done).toBe(false);
    work.return(undefined as never);
    expectSamePose(capture(f.source), before);
    expect(f.source.group.userData.mixer.time).toBe(1.234);
    const unsupported = findCapturedContinuations(f.source.group, f.original, {
      ...f.profile,
      nativeContacts: [],
    });
    expect(unsupported.matches).toEqual([]);
    expect(unsupported.examined).toBe(0);
  });
  it("requires matching grounded support and detailed source motion before enabling an interior blend", () => {
    const f = fixture();
    const profile = locomotionProfile(f.source.group, f.original, {
      start: 1,
      end: 2,
    })!;
    // Supply controlled ground evidence here; surface/contact classification
    // has separate tests and real captured-window verification.
    const contact = { ...f.profile.nativeContacts![0], end: 1 };
    profile.nativeContacts = [contact];
    f.source.group.userData.mixer.time = 1.234;
    const before = capture(f.source);
    expect(
      inspectCapturedLoopBlend(f.source.group, f.original, profile).allowed,
    ).toBe(true);
    expectSamePose(capture(f.source), before);
    expect(f.source.group.userData.mixer.time).toBe(1.234);
    for (const contacts of [
      [],
      [{ ...contact, end: 0.8 }],
      [
        { ...contact, end: 0.3 },
        { ...contact, side: "right" as const, start: 0.7 },
      ],
    ]) {
      expect(
        inspectCapturedLoopBlend(f.source.group, f.original, {
          ...profile,
          nativeContacts: contacts,
        }).allowed,
      ).toBe(false);
    }
    const finger = f.original.tracks.find(
      (track) =>
        track.name === `${f.source.bones.leftHandIndex1.uuid}.quaternion`,
    )!;
    const index = Array.from(finger.times).indexOf(2);
    finger.values.set(
      new T.Quaternion().setFromAxisAngle(up, 0.8).toArray(),
      index * 4,
    );
    expect(
      inspectCapturedLoopBlend(f.source.group, f.original, profile).allowed,
    ).toBe(false);
  });
  it("ignores unweighted control bones while retaining positively weighted finger channels", () => {
    const f = routeFixture(),
      profile = locomotionProfile(f.source.group, f.original)!;
    const helper = new T.Bone();
    helper.name = "Unweighted control";
    f.source.root.add(helper);
    f.original.tracks.push(rotationTrack(helper, [0, 2], [0, 2]));
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0], 3),
    );
    geometry.setAttribute(
      "skinIndex",
      new T.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4),
    );
    const skin = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    skin.name = "Visible skin";
    f.source.group.add(skin);
    skin.bind(
      new T.Skeleton([f.source.bones.hips, f.source.bones.leftHandIndex1]),
    );
    const sampler = sourcePoseSampler(f.source.group, f.original, profile);
    try {
      expect(sampler.labels).toContain("leftHandIndex1");
      expect(sampler.labels).not.toContain(helper.name);
      const a = sampler.poseAt(0),
        b = sampler.poseAt(2);
      expect(
        Math.max(...a.rotations.map((q, i) => q.angleTo(b.rotations[i]))),
      ).toBeLessThan(1e-6);
    } finally {
      sampler.restore();
    }
    const finger = f.original.tracks.find(
      (t) => t.name === f.source.bones.leftHandIndex1.uuid + ".quaternion",
    )!;
    finger.values.set(
      new T.Quaternion()
        .setFromAxisAngle(new T.Vector3(1, 0, 0), 0.8)
        .toArray(),
      finger.values.length - 4,
    );
    const changed = sourcePoseSampler(f.source.group, f.original, profile);
    try {
      const result = compareSourceJoin(
        changed.poseAt(0),
        changed.poseAt(2),
        changed.velocityAt(0),
        changed.velocityAt(2),
        0,
      );
      expect(result.allowed).toBe(false);
      expect(result.rotationMax).toBeGreaterThan(0.79);
    } finally {
      changed.restore();
    }
  });
});
