import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import { motionSource } from "../shared/motionLibrary";
import { prepareImportedAsset } from "../src/importedAsset";
import { locomotionProfile, sampleLocomotion } from "../src/locomotion";
import { disposeObject } from "../src/world";

it("measures the real bundled in-place Walk and Run through shin contact offsets", async () => {
  const bytes = await readFile("public" + motionSource.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const source = prepareImportedAsset(motionSource, gltf);
  try {
    // FootL/FootR on this rig are controls, not mapped deform bones. This is
    // the production editor's default source, not a synthetic foot fixture.
    expect(source.userData.bones.leftFoot).toBeUndefined();
    expect(source.userData.bones.rightFoot).toBeUndefined();
    expect(source.userData.contacts.leftFoot).toBeInstanceOf(T.Vector3);
    for (const name of ["Walk", "Run"]) {
      const clip = T.AnimationClip.findByName(
        source.userData.animations,
        name,
      )!;
      const profile = locomotionProfile(source, clip)!;
      expect(profile, name).toBeDefined();
      expect(profile.mode, name).toBe("in-place");
      expect(profile.duration, name).toBe(clip.duration);
      expect(profile.distance, name).toBeGreaterThan(0.5);
      expect(profile.warning, name).toBe("");
      const phase = sampleLocomotion(profile, profile.distance / 2);
      expect(phase.time, name).toBeGreaterThan(0);
      expect(phase.time, name).toBeLessThan(clip.duration);
      expect(
        sampleLocomotion(profile, profile.distance * 1.5).time,
        name,
      ).toBeCloseTo(phase.time, 5);
    }
  } finally {
    disposeObject(source);
  }
});
