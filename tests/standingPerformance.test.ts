import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import {
  libraryMotions,
  motionSource,
  recordedStanding,
  capturedMotionSources,
  capturedRouteGaits,
} from "../shared/motionLibrary";
import { starterScene } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import {
  standingPerformance,
  measureStanding,
  isStandingPerformance,
} from "../src/standingPerformance";
import { setMotionSources } from "../src/rig";
import * as T from "three";
import { disposeObject } from "../src/world";

it("finds the calm standing loop of an imported source by measurement, not by name", async () => {
  const bytes = await readFile("public" + motionSource.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const source = prepareImportedAsset(motionSource, gltf);
  try {
    // The bundled stylized takes are retired and never chosen on their own.
    const retiredWalk = libraryMotions.find((m) => m.animationName === "Walk")!;
    expect(
      standingPerformance(starterScene(), source, retiredWalk),
    ).toBeUndefined();
    // The same file stands in for a creator's import carrying its own takes.
    const takes = libraryMotions.map((m) => ({
      ...m,
      id: "user-" + m.id,
      sourceAssetId: "user-source",
    }));
    const scene = { ...starterScene(), customMotions: takes };
    const walk = takes.find((m) => m.animationName === "Walk")!;
    const found = standingPerformance(scene, source, walk)!;
    expect(found).toBeDefined();
    expect(found.motion.animationName).toBe("Idle");
    expect(found.travel).toBeLessThan(0.15);
    expect(found.footLift).toBeLessThan(0.04);
    // A loaded take can be registered under a new imported asset/motion ID.
    // Reusing its physical measurements must not return the old scene's ID.
    const importedIdle = {
      ...found.motion,
      id: "new-idle",
      sourceAssetId: "new-source",
    };
    const importedWalk = {
      ...walk,
      id: "new-walk",
      sourceAssetId: "new-source",
    };
    const imported = {
      ...starterScene(),
      customMotions: [importedIdle, importedWalk],
    };
    expect(standingPerformance(imported, source, importedWalk)?.motion).toEqual(
      importedIdle,
    );
    // Gestures and falls on the same source are stationary too but not calm
    // standing loops; they must not be chosen as a waiting performance.
    const measure = standingPerformance(scene, source, {
      ...walk,
      id: "gait",
    })!;
    for (const name of ["Victory", "Defeat", "Death", "Punch"]) {
      const other = takes.find((m) => m.animationName === name)!;
      expect(measure.motion.id).not.toBe(other.id);
    }
  } finally {
    disposeObject(source);
  }
});

it("uses the original 60 Hz standing performance as a measured fallback with planted feet", async () => {
  const motion = recordedStanding[0];
  const asset = capturedMotionSources.find(
    (a) => a.id === motion.sourceAssetId,
  )!;
  const bytes = await readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const source = prepareImportedAsset(asset, gltf);
  try {
    source.position.set(3, 2, -4);
    source.rotation.y = 0.8;
    source.scale.setScalar(2.3);
    const clip = gltf.animations[0];
    expect(clip.duration).toBeCloseTo(936 / 60, 5);
    expect(clip.tracks[0].times[1] - clip.tracks[0].times[0]).toBeCloseTo(
      1 / 60,
      7,
    );
    const measured = measureStanding(source, motion, clip)!;
    expect(measured.travel).toBeGreaterThan(0.15); // real weight shift, not stepping
    expect(measured.footTravel).toBeLessThan(0.035);
    expect(measured.hipHeight).toBeGreaterThan(0.65);
    expect(isStandingPerformance(measured)).toBe(true);
    expect(isStandingPerformance({ ...measured, footTravel: 0.1 })).toBe(false);
    expect(isStandingPerformance({ ...measured, hipHeight: 0.4 })).toBe(false);
    const target = new T.Group(),
      gait = capturedRouteGaits[0];
    expect(
      standingPerformance(starterScene(), target, gait, target),
    ).toBeUndefined();
    setMotionSources(target, new Map([[asset.id, source]]));
    expect(
      standingPerformance(starterScene(), target, gait, target)?.motion,
    ).toEqual(motion);
  } finally {
    disposeObject(source);
  }
});

it("hands a stopped capture to standing at the same floor height as standalone playback", async () => {
  const { applyAnimatedEntityPose } = await import("../src/world");
  const { standingHoldClips } = await import("../src/automaticRoutes");
  const { sampleFootSurfaces } = await import("../src/footSurface");
  const gait = capturedRouteGaits[0];
  const assets = [gait, recordedStanding[0]].map((m) =>
    capturedMotionSources.find((a) => a.id === m.sourceAssetId)!,
  );
  const groups = await Promise.all(
    assets.map(async (asset) => {
      const bytes = await readFile("public" + asset.url);
      const gltf = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
      return prepareImportedAsset(asset, gltf);
    }),
  );
  const [target, standing] = groups;
  try {
    const scene = starterScene(),
      actor = scene.entities[0];
    scene.customMotions.push(gait);
    actor.assetId = assets[0].id;
    actor.position = [2, 0.6, -3];
    actor.rotation = 0.7;
    actor.scale = 1.4;
    actor.clips = [
      { id: "route", motionId: gait.id, duration: 1, routeStop: 1 },
      ...standingHoldClips(recordedStanding[0], "wait", 40),
      { id: "resume", motionId: gait.id, duration: 1, transition: "smooth" },
    ];
    setMotionSources(target, new Map([[assets[1].id, standing]]));
    const solo = { ...actor, clips: actor.clips.slice(1) };
    const height = (entity: typeof actor, time: number) => {
      applyAnimatedEntityPose(target, entity, scene, time);
      const surface = sampleFootSurfaces(target)!;
      return surface.lowest * target.scale.y + target.position.y;
    };
    for (const time of [2, 17.3, 33.2, 3]) {
      expect(height(actor, time)).toBeCloseTo(height(solo, time - 1), 6);
    }
    for (const start of [1, 16.6, 32.2, 41])
      for (let frame = 0; frame <= 30; frame++)
        expect(height(actor, start + frame / 120)).toBeGreaterThanOrEqual(
          actor.position[1] - 1e-6,
        );
  } finally {
    groups.forEach((group) => disposeObject(group));
  }
});
