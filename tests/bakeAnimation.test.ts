import { describe, expect, it } from "vitest";
import * as T from "three";
import { starterScene } from "../shared/scene";
import { sourceSecondsAt } from "../shared/clipTiming";
import {
  animationSampleBoundaries,
  BAKE_SAMPLE_FPS,
  bakeAnimation,
} from "../src/bakeAnimation";
import { exportSnapshot } from "../src/exportSnapshot";
import { sampleNativeClip, setMotionSources } from "../src/rig";

function timingFixture(native = false) {
  const scene = starterScene(),
    actor = scene.entities[0],
    target = new T.Group(),
    source = native ? target : new T.Group();
  scene.entities = [actor];
  const take = new T.AnimationClip("Take", 0.713, [
    new T.VectorKeyframeTrack(
      source.uuid + ".position",
      [0, 0.713],
      [0, 0, 0, 1, 0, 0],
    ),
  ]);
  source.userData.animations = [new T.AnimationClip("Other", 8, []), take];
  source.userData.mixer = new T.AnimationMixer(source);
  setMotionSources(target, new Map([["original", source]]));
  scene.customMotions.push({
    id: "take",
    name: "Take",
    kind: "imported",
    // Deliberately stale metadata: export must use the loaded take's length.
    duration: 1.8,
    distance: 0,
    poses: [],
    sourceAssetId: native ? actor.assetId : "original",
    animationName: "Take",
  });
  const clip = {
    id: "take-slot",
    motionId: "take",
    duration: 1.4,
    playbackRate: 2,
  };
  actor.clips = [
    { id: "before", motionId: "idle", duration: 0.231 },
    clip,
    { id: "after", motionId: "idle", duration: 0.317 },
  ];
  const objects = new Map([[actor.id, target]]);
  return { scene, actor, target, source, take, clip, objects };
}

function playback(snapshot: T.Group, animation: T.AnimationClip) {
  const mixer = new T.AnimationMixer(snapshot),
    action = mixer.clipAction(animation);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  return (time: number) => {
    action.reset().play();
    mixer.setTime(time);
    snapshot.updateMatrixWorld(true);
  };
}

describe("export sample boundaries", () => {
  it.each([false, true])(
    "uses the selected loaded %s-native source duration for hold boundaries",
    (native) => {
      const f = timingFixture(native);
      const boundaries = animationSampleBoundaries(f.scene, f.objects);
      expect(boundaries.length).toBeGreaterThan(4);
      expect(boundaries[0]).toBeCloseTo(0.231, 10);
      expect(boundaries.at(-3)).toBeCloseTo(0.231 + 0.713 / 2, 10);
      expect(boundaries.at(-2)).toBeCloseTo(0.231 + 1.4, 10);
      expect(boundaries.at(-1)).toBeCloseTo(0.231 + 1.4 + 0.317, 10);
    },
  );

  it("falls back to metadata when the original take is unavailable", () => {
    const f = timingFixture();
    f.source.userData.animations = [];
    const boundaries = animationSampleBoundaries(f.scene, f.objects);
    expect(boundaries[1]).toBeCloseTo(0.231 + 1.8 / 2, 10);
    expect(animationSampleBoundaries(f.scene, new Map())).toEqual(boundaries);
  });

  it("adds no interior hold for a trimmed or legacy-fit take", () => {
    const f = timingFixture();
    f.clip.playbackRate = 0.25;
    expect(animationSampleBoundaries(f.scene, f.objects)).toHaveLength(3);
    const { playbackRate: _, ...legacy } = f.clip;
    f.actor.clips[1] = legacy;
    expect(animationSampleBoundaries(f.scene, f.objects)).toHaveLength(3);
  });

  it("maps off-grid source keys at the actual rate without sampling trimmed or held source time", () => {
    const f = timingFixture();
    f.take.duration = 1;
    f.take.tracks = [
      new T.VectorKeyframeTrack(
        f.source.uuid + ".position",
        [0, 0.1234, 0.5, 1],
        [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
    ];
    f.clip.playbackRate = 100;
    f.clip.duration = 0.0035;
    f.actor.clips = [f.clip];
    let boundaries = animationSampleBoundaries(f.scene, f.objects);
    expect(boundaries).toContain(f.take.tracks[0].times[1] / 100);
    expect(boundaries).not.toContain(0.5 / 100);
    expect(boundaries.every((time) => time <= f.clip.duration)).toBe(true);
    expect(boundaries.at(-1)).toBe(f.clip.duration);

    f.clip.duration = 0.05;
    boundaries = animationSampleBoundaries(f.scene, f.objects);
    expect(boundaries).toContain(0.5 / 100);
    expect(boundaries.at(-2)).toBe(0.01);
    expect(boundaries.filter((time) => time > 0.01)).toEqual([0.05]);

    const { playbackRate: _, ...legacy } = f.clip;
    f.actor.clips = [legacy];
    boundaries = animationSampleBoundaries(f.scene, f.objects);
    expect(boundaries).toContain(f.take.tracks[0].times[1] / 20);
    expect(boundaries.at(-1)).toBe(0.05);
  });

  it("replays the exact start of a hold between regular grid samples without smearing motion", () => {
    const f = timingFixture(true),
      start = f.actor.clips[0].duration,
      hold = start + f.take.duration / f.clip.playbackRate,
      boundaries = animationSampleBoundaries(f.scene, f.objects),
      total = boundaries.at(-1)!;
    const render = (time: number) => {
      sampleNativeClip(
        f.target,
        f.take,
        sourceSecondsAt(f.clip, time - start, f.take.duration),
      );
    };
    const animation = bakeAnimation([f.target], total, render, [
      ...boundaries,
      hold, // Duplicate Float32 times must not create duplicate keys.
    ]);
    render(0);
    const snapshot = exportSnapshot(f.target),
      replay = playback(snapshot, animation);
    for (const time of [
      start - 0.001,
      start,
      start + 0.001,
      hold - 0.005,
      hold - 0.0001,
      hold,
      hold + 0.0001,
      hold + 0.005,
      total,
    ]) {
      render(time);
      replay(time);
      expect(snapshot.position.x, `at ${time}`).toBeCloseTo(
        f.target.position.x,
        5,
      );
    }
    for (const track of animation.tracks) {
      expect([...track.times]).toContain(Math.fround(hold));
      expect(
        [...track.times].every(
          (time, index, times) => !index || time > times[index - 1],
        ),
      ).toBe(true);
    }
  });
});

describe("baked animation fidelity", () => {
  it.each([false, true])(
    "preserves fast quaternion gestures and nonlinear motion from a %s-native source",
    (native) => {
      for (const rate of [100, 300]) {
        const f = timingFixture(native),
          sourceBone = new T.Bone(),
          targetBone = native ? sourceBone : new T.Bone();
        f.source.add(sourceBone);
        if (!native) f.target.add(targetBone);
        const quaternion = (angle: number) =>
          new T.Quaternion()
            .setFromAxisAngle(new T.Vector3(0, 1, 0), angle)
            .toArray();
        f.take.duration = 1;
        f.take.tracks = [
          new T.QuaternionKeyframeTrack(
            sourceBone.uuid + ".quaternion",
            [0, 0.5, 1],
            [...quaternion(0), ...quaternion(Math.PI), ...quaternion(0)],
          ),
          // Smooth interpolation adds acceleration between sparse source keys.
          new T.VectorKeyframeTrack(
            sourceBone.uuid + ".position",
            [0, 0.23, 0.6, 1],
            [0, 0, 0, 1, 0.3, 0, -0.2, 1, 0, 0, 0, 0],
            T.InterpolateSmooth,
          ),
          // This pulse falls between even the extra source-grid samples.
          new T.VectorKeyframeTrack(
            sourceBone.uuid + ".scale",
            [0, 0.347, 0.349, 1],
            [1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1],
          ),
        ];
        // Use the source curve's tangents, without mixer endpoint-ease overrides.
        const action = (f.source.userData.mixer as T.AnimationMixer).clipAction(
          f.take,
        );
        action.zeroSlopeAtStart = false;
        action.zeroSlopeAtEnd = false;
        f.clip.playbackRate = rate;
        f.clip.duration = 1 / rate;
        f.actor.clips = [f.clip];
        const render = (time: number) => {
          sampleNativeClip(
            f.source,
            f.take,
            sourceSecondsAt(f.clip, time, f.take.duration),
          );
          if (!native) {
            targetBone.position.copy(sourceBone.position);
            targetBone.quaternion.copy(sourceBone.quaternion);
            targetBone.scale.copy(sourceBone.scale);
          }
        };
        const boundaries = animationSampleBoundaries(f.scene, f.objects);
        expect(boundaries).toContain(0.5 / rate);
        const animation = bakeAnimation(
          [f.target],
          f.clip.duration,
          render,
          boundaries,
        );
        render(0);
        const snapshot = exportSnapshot(f.target),
          exportedBone = snapshot.getObjectByProperty("uuid", targetBone.uuid)!,
          replay = playback(snapshot, animation);
        const pulseTime = f.take.tracks[2].times[1];
        // Non-monotonic seeks exercise deterministic preview/export evaluation.
        for (const sourceTime of [
          0.5,
          pulseTime,
          0.111,
          0.9,
          1,
          0.25,
          0.75,
          0,
          0.5,
        ]) {
          const time = sourceTime / rate;
          render(time);
          replay(time);
          expect(
            exportedBone.quaternion
              .clone()
              .normalize()
              .angleTo(targetBone.quaternion.clone().normalize()),
          ).toBeLessThan(0.0001);
          expect(
            exportedBone.position.distanceTo(targetBone.position),
            `source ${sourceTime}, rate ${rate}, baked ${exportedBone.position.toArray()}, preview ${targetBone.position.toArray()}`,
          ).toBeLessThan(0.003);
          expect(exportedBone.scale.distanceTo(targetBone.scale)).toBeLessThan(
            0.0001,
          );
        }
        replay(0.5 / rate);
        expect(exportedBone.quaternion.angleTo(new T.Quaternion())).toBeCloseTo(
          Math.PI,
          4,
        );
        replay(pulseTime / rate);
        expect(exportedBone.scale.x).toBeCloseTo(2, 4);
        for (const track of animation.tracks) {
          expect([...track.times]).toContain(Math.fround(0.5 / rate));
          expect(
            [...track.times].every(
              (time, i, times) => !i || time > times[i - 1],
            ),
          ).toBe(true);
        }
      }
    },
  );

  it("records transferred facial weights on nested meshes with no native target animations", () => {
    const geometry = new T.PlaneGeometry(1, 1);
    geometry.morphAttributes.position = [
      geometry.attributes.position.clone(),
      geometry.attributes.position.clone(),
    ];
    geometry.morphAttributes.position[0].name = "jawOpen";
    geometry.morphAttributes.position[1].name = "eyeBlinkLeft";
    const source = new T.Group(),
      sourceFace = new T.Mesh(geometry, new T.MeshBasicMaterial()),
      target = new T.Group(),
      nested = new T.Group(),
      face = sourceFace.clone();
    source.add(sourceFace);
    target.add(nested);
    nested.add(face);
    target.userData.animations = [];
    expect(target.userData.mixer).toBeUndefined();
    const take = new T.AnimationClip("Facial detail", 0.2, [
      new T.NumberKeyframeTrack(
        sourceFace.uuid + ".morphTargetInfluences",
        [0, 1 / 60, 2 / 60, 3 / 60, 0.2],
        [0, 0, 1, 0.75, 0, 0, 0, 1, 0.2, 0.4],
      ),
    ]);
    source.userData.mixer = new T.AnimationMixer(source);
    // This is the baker's contract: record preview-evaluated receiving weights,
    // not source clip bindings (the receiving rig has no native animation).
    const render = (time: number) => {
      sampleNativeClip(source, take, time);
      face.morphTargetInfluences!.splice(
        0,
        2,
        ...sourceFace.morphTargetInfluences!,
      );
    };
    const animation = bakeAnimation([target], 0.2, render),
      track = animation.tracks.find(
        (track) => track.name === face.uuid + ".morphTargetInfluences",
      );
    expect(track).toBeDefined();
    expect(track!.getValueSize()).toBe(2);
    render(0);
    const snapshot = exportSnapshot(target),
      exportedFace = snapshot.getObjectByProperty("uuid", face.uuid) as T.Mesh,
      replay = playback(snapshot, animation);
    for (const time of [0, 1 / 60, 1.5 / 60, 2 / 60, 3 / 60, 0.2, 1 / 60]) {
      render(time);
      replay(time);
      for (let i = 0; i < 2; i++)
        expect(exportedFace.morphTargetInfluences![i]).toBeCloseTo(
          face.morphTargetInfluences![i],
          5,
        );
    }
    replay(1 / 60);
    expect(exportedFace.morphTargetInfluences![0]).toBeCloseTo(1, 5);
  });

  it("samples 60 Hz mocap detail with a bounded cadence and includes the final partial frame", () => {
    const actor = new T.Group(),
      bone = new T.Bone();
    actor.add(bone);
    const take = new T.AnimationClip("Fast gesture", 1.005, [
      new T.VectorKeyframeTrack(
        bone.uuid + ".position",
        [0, 1 / 60, 2 / 60, 1.005],
        [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
      ),
    ]);
    actor.userData.mixer = new T.AnimationMixer(actor);
    const render = (time: number) => sampleNativeClip(actor, take, time),
      animation = bakeAnimation([actor], take.duration, render);
    expect(BAKE_SAMPLE_FPS).toBe(60);
    for (const track of animation.tracks) {
      expect(track.times).toHaveLength(Math.ceil(take.duration * 60) + 1);
      expect(track.times.at(-1)).toBe(Math.fround(take.duration));
    }
    render(0);
    const snapshot = exportSnapshot(actor),
      exportedBone = snapshot.getObjectByProperty("uuid", bone.uuid)!,
      replay = playback(snapshot, animation);
    replay(1 / 60);
    expect(exportedBone.position.x).toBeCloseTo(1, 5);
    replay(2 / 60);
    expect(exportedBone.position.x).toBeCloseTo(0, 5);
  });
});
