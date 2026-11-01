import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import { motionSource } from "../shared/motionLibrary";
import { prepareImportedAsset } from "../src/importedAsset";
import {
  locomotionProfile,
  sampleLocomotion,
  sampleRouteLocomotion,
} from "../src/locomotion";
import { disposeObject } from "../src/world";
import { measureNativeTravel } from "../src/nativeTravel";

it("measures the real bundled in-place Walk and Run through their skinned foot controls", async () => {
  const bytes = await readFile("public" + motionSource.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const source = prepareImportedAsset(motionSource, gltf);
  try {
    // The foot controls actually skin the shoes despite living outside hips.
    expect(source.userData.bones.leftFoot.name).toBe("FootL");
    expect(source.userData.bones.rightFoot.name).toBe("FootR");
    expect(source.userData.detachedJointAnchors.size).toBe(2);
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
      const native = measureNativeTravel(source, source, clip, {
        id: "native",
        motionId: "native",
        duration: clip.duration,
        playbackRate: 1,
      })!;
      // Virtual distance makes these in-place gaits useful on routes, but the
      // scheduled native take must not acquire travel that its source lacks.
      expect(
        Math.hypot(native.destination.x, native.destination.z),
      ).toBeLessThan(1e-5);
      expect(native.profile).toBe(profile);
      expect(profile.warning, name).toBe("");
      expect(profile.stops, name).toEqual([]);
      // These in-place gaits move their feet backwards during stance. Virtual
      // route support is valid after adding travel, but is not a stationary
      // world contact for a standalone transition.
      expect(profile.nativeContacts, name).toEqual([]);
      if (name === "Run") {
        // Actual alternating support must carry route travel through flight.
        const speeds = profile.frames
          .slice(1)
          .map(
            (frame, i) =>
              (frame.distance - profile.frames[i].distance) /
              (frame.time - profile.frames[i].time),
          );
        expect(Math.min(...speeds)).toBeGreaterThan(1);
        expect(Math.max(...speeds)).toBeLessThan(5);
        expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(1e-6);
        expect(profile.contacts?.map((c) => c.side).sort()).toEqual([
          "left",
          "right",
        ]);
        expect(
          profile.contacts?.every((c) => c.samples.every((s) => !!s.sole)),
        ).toBe(true);
        // Reconstructed distance must not warp the source clock.
        expect(
          sampleRouteLocomotion(profile, profile.distance * 2, 0.3).time,
        ).toBeCloseTo(clip.duration * 0.6, 8);
      }
      const phase = sampleLocomotion(profile, profile.distance / 2);
      expect(phase.time, name).toBeGreaterThan(0);
      expect(phase.time, name).toBeLessThan(clip.duration);
      expect(
        sampleLocomotion(profile, profile.distance * 1.5).time,
        name,
      ).toBeCloseTo(phase.time, 5);
    }
    const idle = T.AnimationClip.findByName(
      source.userData.animations,
      "Idle",
    )!;
    const standing = locomotionProfile(source, idle)!;
    expect(standing.mode).toBe("in-place");
    expect(standing.nativeContacts?.map((c) => c.side).sort()).toEqual([
      "left",
      "right",
    ]);
    expect(
      standing.nativeContacts?.every(
        (c) => c.start === 0 && c.end === idle.duration,
      ),
    ).toBe(true);
    expect(standing.turns).toEqual([]);
  } finally {
    disposeObject(source);
  }
});
