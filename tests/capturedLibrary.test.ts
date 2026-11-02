import { expect, it } from "vitest";
import * as T from "three";
import { libraryCharacters } from "../shared/characterLibrary";
import { setMotionSources } from "../src/rig";
import { locomotionScale } from "../src/locomotion";
import { sampleFootSurfaces } from "../src/footSurface";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import JSZip from "jszip";
import {
  capturedMotions,
  capturedMotionSources,
} from "../shared/motionLibrary";
import catalogue from "../shared/captured-motion-catalogue.json";
import {
  allAssets,
  allMotions,
  starterScene,
  validateScene,
  type Asset,
} from "../shared/scene";
import { actionPreview } from "../shared/actionPreview";
import {
  prepareImportedAsset,
  requiredMotionSources,
} from "../src/importedAsset";
import { locomotionProfile } from "../src/locomotion";
import { productionPackage } from "../src/productionPackage";
import {
  emptyStudioLibrary,
  studioLibraryCommands,
} from "../shared/studioLibrary";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";
import { compilePath } from "../shared/path";

async function load(asset: Asset) {
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return { bytes, gltf, group: prepareImportedAsset(asset, gltf) };
}

it.each(["cmu-capture-82-14", "quaternius-casual-female"])(
  "retains the original capture floor when a route hands over to a trimmed stop on %s",
  async (receiverId) => {
    const asset = capturedMotionSources.find(
      (a) => a.id === "cmu-capture-82-14",
    )!;
    const { group: source, gltf } = await load(asset),
      take = gltf.animations[0];
    const target =
      receiverId === asset.id
        ? source
        : (await load(libraryCharacters.find((a) => a.id === receiverId)!))
            .group;
    try {
      if (target !== source)
        setMotionSources(target, new Map([[asset.id, source]]));
      const profile = locomotionProfile(source, take, {
        start: 1.2,
        end: 2.375,
      })!;
      const scene = starterScene(),
        actor = scene.entities[0];
      scene.entities = [actor];
      scene.transcript = [];
      actor.assetId = receiverId;
      actor.position = [0.2, 0.7, -0.3];
      actor.rotation = 0.4;
      actor.scale = 1.3;
      actor.ending = "hold";
      const motion = {
        ...capturedMotions.find((m) => m.animationName === "82_14")!,
        id: "capture",
      };
      const route = {
        ...motion,
        id: "route",
        path: {
          points: [
            [0, 0, 0],
            [0, 0, profile.distance * locomotionScale(source, target) * 2],
          ] as [number, number, number][],
          smooth: false,
          sourceRange: { start: 1.2, end: 2.375 },
        },
      };
      scene.customMotions = [motion, route];
      const boundary = profile.duration * 2,
        entry = 1.6629956367257408;
      const whole = {
        ...actor,
        clips: [
          {
            id: "whole",
            motionId: motion.id,
            duration: take.duration,
            playbackRate: 1,
          },
        ],
      };
      const arrived = {
        ...actor,
        clips: [
          {
            id: "approach",
            motionId: route.id,
            duration: boundary,
            playbackRate: 1,
          },
          {
            id: "stop",
            motionId: motion.id,
            duration: take.duration - entry,
            sourceStart: entry,
            playbackRate: 1,
            transition: "smooth" as const,
          },
        ],
      };
      const splitArrival = {
        ...arrived,
        clips: [
          arrived.clips[0],
          { ...arrived.clips[1], duration: 1 },
          {
            ...arrived.clips[1],
            id: "continued-stop",
            sourceStart: entry + 1,
            duration: take.duration - entry - 1,
          },
        ],
      };
      const height = () =>
        target.userData.bones.hips.getWorldPosition(new T.Vector3()).y;
      const clearance = () => {
        const surface = sampleFootSurfaces(target)!;
        return (
          (surface.lowest - surface.bindFloor) * actor.scale +
          target.position.y -
          actor.position[1]
        );
      };
      for (const elapsed of [0.3, 0.8, 1, 1.01, 1.125, 1.7, 3, 3.8, 0.5]) {
        applyAnimatedEntityPose(target, whole, scene, entry + elapsed);
        // The capture itself sometimes penetrates the floor. The arrival
        // retains its height curve with only the necessary sole support.
        const expected = height() + Math.max(0, -clearance());
        for (const edited of [arrived, splitArrival]) {
          applyAnimatedEntityPose(target, edited, scene, boundary + elapsed);
          expect(height()).toBeCloseTo(expected, 6);
          expect(clearance()).toBeGreaterThanOrEqual(-1e-8);
        }
      }
    } finally {
      if (target !== source) disposeObject(target);
      disposeObject(source);
    }
  },
);

it.each(["35_01", "82_14"])(
  "preserves the actual %s capture across consecutive source cuts",
  async (trial) => {
    const asset = capturedMotionSources.find(
      (a) => a.id === `cmu-capture-${trial.replace("_", "-")}`,
    )!;
    const { group, gltf } = await load(asset);
    try {
      const scene = starterScene(),
        actor = scene.entities[0],
        take = gltf.animations[0];
      scene.entities = [actor];
      actor.assetId = asset.id;
      actor.position = [0, 0, 0];
      actor.rotation = 0;
      actor.scale = 1;
      const motion = {
        ...capturedMotions.find((m) => m.animationName === trial)!,
        id: "performance",
      };
      scene.customMotions = [motion];
      const cut = trial === "35_01" ? 1.5 : 1.7;
      const whole = {
        ...actor,
        clips: [
          {
            id: "whole",
            motionId: motion.id,
            duration: take.duration,
            playbackRate: 1,
          },
        ],
      };
      const split = {
        ...actor,
        clips: [
          { id: "first", motionId: motion.id, duration: cut, playbackRate: 1 },
          {
            id: "second",
            motionId: motion.id,
            duration: take.duration - cut,
            sourceStart: cut,
            playbackRate: 1,
            transition: "smooth" as const,
          },
        ],
      };
      const bones: T.Bone[] = [];
      group.traverse((n) => {
        if (n instanceof T.Bone) bones.push(n);
      });
      for (const time of [
        cut - 0.01,
        cut,
        cut + 0.008,
        cut + 0.08,
        cut + 0.125,
        cut + 0.249,
        cut + 0.3,
        cut + 0.04,
      ]) {
        applyAnimatedEntityPose(group, whole, scene, time);
        const poses = bones.map((b) => ({
          p: b.getWorldPosition(new T.Vector3()),
          q: b.getWorldQuaternion(new T.Quaternion()),
        }));
        applyAnimatedEntityPose(group, split, scene, time);
        bones.forEach((b, i) => {
          expect(
            b.getWorldPosition(new T.Vector3()).distanceTo(poses[i].p),
          ).toBeLessThan(1e-6);
          expect(
            b.getWorldQuaternion(new T.Quaternion()).angleTo(poses[i].q),
          ).toBeLessThan(1e-6);
        });
      }
    } finally {
      disposeObject(group);
    }
  },
);

it.each(["quaternius-pirate-male", "quaternius-pirate-female"])(
  "keeps the supported knee continuous near a curved captured repeat on %s",
  async (receiverId) => {
    const { capturedRouteGaits } = await import("../shared/motionLibrary");
    const gait = capturedRouteGaits.find((m) => m.animationName === "35_01")!;
    const asset = capturedMotionSources.find(
      (a) => a.id === gait.sourceAssetId,
    )!;
    const { group: source, gltf } = await load(asset);
    const target = (
      await load(libraryCharacters.find((a) => a.id === receiverId)!)
    ).group;
    try {
      setMotionSources(target, new Map([[asset.id, source]]));
      const profile = locomotionProfile(
        source,
        gltf.animations[0],
        gait.path!.sourceRange,
      )!;
      const scene = starterScene(),
        actor = scene.entities[0];
      scene.entities = [actor];
      scene.animationCollisions = false;
      actor.assetId = receiverId;
      actor.position = [0, 0, 0];
      actor.rotation = 0;
      actor.scale = 1;
      const initial = {
        ...gait.path!,
        smooth: true,
        points: [
          [0, 0, 0],
          [0.2, 0, 1.6],
          [1.2, 0, 3],
          [2.8, 0, 3.6],
          [4.2, 0, 2.6],
          [4.8, 0, 1],
        ] as [number, number, number][],
      };
      const length = profile.distance * locomotionScale(source, target) * 3;
      const scale = length / compilePath(initial).length;
      const path = {
        ...initial,
        points: initial.points.map(
          (p) => p.map((v) => v * scale) as [number, number, number],
        ),
      };
      expect(compilePath(path).length).toBeCloseTo(length, 8);
      scene.customMotions = [{ ...gait, id: "curve", path }];
      actor.clips = [
        {
          id: "curve",
          motionId: "curve",
          duration: profile.duration * 3,
          playbackRate: 1,
        },
      ];
      const knee = target.userData.bones.rightShin as T.Bone;
      const sample = (time: number) => {
        applyAnimatedEntityPose(target, actor, scene, time);
        target.updateMatrixWorld(true);
        return knee.getWorldPosition(new T.Vector3());
      };
      // The discontinuity lies just after the repeat, where a second ground
      // solve used to switch off. Checking only the exact wrap misses it.
      const dt = 2e-6,
        begin = profile.duration - 0.0005;
      let previous = sample(begin),
        speed = 0;
      for (let i = 1; i <= 500; i++) {
        const next = sample(begin + i * dt);
        speed = Math.max(speed, previous.distanceTo(next) / dt);
        previous = next;
      }
      expect(speed).toBeLessThan(5);
      const expected = sample(profile.duration + 0.0002);
      sample(profile.duration * 2 + 0.3);
      sample(0.1);
      expect(
        sample(profile.duration + 0.0002).distanceTo(expected),
      ).toBeLessThan(1e-9);
    } finally {
      disposeObject(target);
      disposeObject(source);
    }
  },
);
it.each(capturedMotions)(
  "loads and previews $name from the shipped original capture",
  async (motion) => {
    const scene = starterScene();
    const source = capturedMotionSources.find(
      (a) => a.id === motion.sourceAssetId,
    )!;
    expect(allAssets(scene).some((a) => a.id === source.id)).toBe(false);
    expect(allMotions(scene)).toContain(motion);
    expect(
      studioLibraryCommands(scene, emptyStudioLibrary(), {
        motionIds: [motion.id],
      }),
    ).toEqual([]);
    const original = actionPreview(
      scene,
      motion,
      scene.entities[0].id,
      undefined,
      "original",
    );
    const alias = original.scene.customAssets.find(
      (a) => a.id === original.actor.assetId,
    )!;
    expect(alias.rigMapping).toEqual(source.rigMapping);
    expect(requiredMotionSources(original.scene, original.actor)).toEqual([]);
    const { bytes, gltf, group } = await load(alias);
    const entry = catalogue.find((c) => c.trial === motion.animationName)!;
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      entry.sha256[`${entry.trial}.glb` as keyof typeof entry.sha256],
    );
    expect(gltf.animations[0].duration).toBeCloseTo(motion.duration, 5);
    expect(
      gltf.animations[0].tracks.some((t) => /fingers|thumb/.test(t.name)),
    ).toBe(false);
    expect(group.userData.bones.leftHand.name).toBe("lhand");
    expect(group.userData.bones.rightHand.name).toBe("rhand");
    for (const time of [0.17, motion.duration * 0.6, motion.duration, 0.17]) {
      applyAnimatedEntityPose(group, original.actor, original.scene, time);
      expect(group.userData.motionWarning || "").toBe("");
      expect(group.userData.mixer.time).toBeCloseTo(time, 5);
    }
    disposeObject(group);
    scene.customAssets.push(source);
    expect(() => validateScene(scene)).toThrow("Duplicate IDs");
  },
);
it("packages referenced capture files and their terms without changing the cast", async () => {
  const scene = starterScene();
  scene.entities[0].clips = capturedMotions.map((m) => ({
    id: m.id,
    motionId: m.id,
    duration: m.duration,
    playbackRate: 1,
  }));
  const read: typeof fetch = async (input) =>
    new Response(
      await fs.readFile(
        String(input).startsWith("/library/") ? "public" + input : "." + input,
      ),
    );
  const zip = await JSZip.loadAsync(
    await productionPackage(scene, new ArrayBuffer(0), read),
  );
  for (const source of capturedMotionSources) {
    const packaged = await zip
      .file("assets/actions/cmu/" + source.url!.split("/").pop())!
      .async("uint8array");
    const original = await fs.readFile("public" + source.url);
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    expect(hash(packaged)).toBe(hash(original));
  }
  expect(
    await zip.file("assets/actions/cmu/LICENSE.txt")!.async("string"),
  ).toContain("must not be resold");
  expect(zip.file("assets/actions/quaternius-actions.glb")).toBeNull();
  expect(
    JSON.parse(await zip.file("scene.json")!.async("string")).entities,
  ).toEqual(scene.entities);
  await expect(
    productionPackage(scene, new ArrayBuffer(0), async (input, options) =>
      String(input).endsWith("cmu/LICENSE.txt")
        ? new Response("", { status: 404 })
        : read(input, options),
    ),
  ).rejects.toThrow("capture terms");
});

it("finds grounded stance in the shipped captured stride without altering the source take", async () => {
  const { group, gltf } = await load(capturedMotionSources[0]);
  const clip = gltf.animations[0];
  const before = clip.tracks.map((t) => Array.from(t.values));
  const profile = locomotionProfile(group, clip, { start: 0.4, end: 1.525 })!;
  expect(new Set(profile.contacts!.map((c) => c.side))).toEqual(
    new Set(["left", "right"]),
  );
  expect(profile.contacts!.every((c) => c.end > c.start)).toBe(true);
  const left = profile.contacts!.filter((c) => c.side === "left");
  expect(left[0].start).toBe(0);
  expect(left.at(-1)!.end).toBeCloseTo(profile.duration, 8);
  expect(clip.tracks.map((t) => Array.from(t.values))).toEqual(before);
  disposeObject(group);
});

it("retains the earlier walking lead-in of a gradual recorded stop", async () => {
  const { matchCapturedArrival } = await import("../src/arrivalMatching");
  const motion = capturedMotions.find((m) => m.animationName === "82_14")!;
  const asset = capturedMotionSources.find(
    (a) => a.id === motion.sourceAssetId,
  )!;
  const { group, gltf } = await load(asset);
  try {
    const take = gltf.animations[0],
      range = { start: 1.3, end: 2.5 };
    // This interval exercises entry matching, not repeatability: matching
    // source phase alone is not proof of a safe full-body gait loop.
    const gait = locomotionProfile(group, take, range)!;
    const full = locomotionProfile(group, take)!;
    expect(full.stops).toHaveLength(1);
    const stop = full.stops![0];
    expect(stop.end - stop.settled).toBeGreaterThan(2);
    expect(
      stop.entries.some((e) => e.time < stop.settled - 2 && e.speed > 0.8),
    ).toBe(true);
    const result = matchCapturedArrival(
      group,
      take,
      gait,
      gait.distance * 4,
      (start) => {
        const time = start - range.start;
        if (time < 0.1 || time > gait.duration - 0.1) return undefined;
        const i = gait.frames.findIndex((f) => f.time >= time);
        const a = gait.frames[i - 1],
          b = gait.frames[i];
        return (
          gait.distance * 2 +
          a.distance +
          ((b.distance - a.distance) * (time - a.time)) / (b.time - a.time)
        );
      },
      full,
    );
    expect(result.match).toBeDefined();
    expect(result.match!.sourceStart).toBeLessThan(stop.settled - 2);
    expect(result.match!.positionMax).toBeLessThan(0.08);
    expect(result.match!.velocityRms).toBeLessThan(0.5);
  } finally {
    disposeObject(group);
  }
});

it.each([
  { trial: "35_01", receiverId: undefined },
  { trial: "35_01", receiverId: "quaternius-casual-female" },
  { trial: "35_18", receiverId: undefined },
  { trial: "35_18", receiverId: "quaternius-casual-female" },
])(
  "keeps the complete captured $trial body continuous at repeats on $receiverId",
  async ({ trial, receiverId }) => {
    const { capturedRouteGaits } = await import("../shared/motionLibrary");
    const gait = capturedRouteGaits.find((m) => m.animationName === trial)!;
    const asset = capturedMotionSources.find(
      (a) => a.id === gait.sourceAssetId,
    )!;
    const { group: source, gltf } = await load(asset);
    const target = receiverId
      ? (await load(libraryCharacters.find((a) => a.id === receiverId)!)).group
      : source;
    try {
      const original = gltf.animations[0].tracks.map((t) =>
        Array.from(t.values),
      );
      const profile = locomotionProfile(
        source,
        gltf.animations[0],
        gait.path!.sourceRange,
      )!;
      const scene = starterScene(),
        actor = scene.entities[0];
      actor.assetId = receiverId ?? asset.id;
      actor.position = [0, 0, 0];
      actor.rotation = 0;
      actor.scale = 1;
      const route = {
        ...gait,
        id: "walking-route",
        path: {
          ...gait.path!,
          points: [
            [0, 0, 0],
            [0, 0, profile.distance * locomotionScale(source, target) * 3],
          ] as [number, number, number][],
        },
      };
      scene.customMotions.push(route);
      actor.clips = [
        {
          id: "walking-route",
          motionId: route.id,
          duration: profile.duration * 3,
          playbackRate: 1,
        },
      ];
      if (target !== source)
        setMotionSources(target, new Map([[asset.id, source]]));
      const sample = (time: number) => {
        applyAnimatedEntityPose(target, actor, scene, time);
        target.updateMatrixWorld(true);
        const pose: { position: T.Vector3; rotation: T.Quaternion }[] = [];
        target.traverse((n) => {
          if (n instanceof T.Bone)
            pose.push({
              position: n.getWorldPosition(new T.Vector3()),
              rotation: n.getWorldQuaternion(new T.Quaternion()).normalize(),
            });
        });
        return pose;
      };
      for (const cycle of [1, 2]) {
        const before = sample(cycle * profile.duration - 1e-6),
          after = sample(cycle * profile.duration + 1e-6);
        expect(
          Math.max(
            ...before.map((p, i) => p.position.distanceTo(after[i].position)),
          ),
        ).toBeLessThan(0.0005);
        expect(
          Math.max(
            ...before.map((p, i) => p.rotation.angleTo(after[i].rotation)),
          ),
        ).toBeLessThan(0.001);
        expect(target.userData.motionNotice || "").not.toContain(
          "does not join smoothly",
        );
      }
      expect(
        gltf.animations[0].tracks.map((t) => Array.from(t.values)),
      ).toEqual(original);
    } finally {
      if (target !== source) disposeObject(target);
      disposeObject(source);
    }
  },
);
