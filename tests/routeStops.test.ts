import { readFile } from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  allAssets,
  allMotions,
  applyCommands,
  starterScene,
  validateScene,
  type Asset,
  type Motion,
  type Scene,
} from "../shared/scene";
import { compilePath, savePathCommands } from "../shared/path";
import { libraryMotions, motionSource } from "../shared/motionLibrary";
import { routeActiveDuration } from "../shared/clipTiming";
import { prepareImportedAsset } from "../src/importedAsset";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { planObjectRoute } from "../src/routePlanner";
import { inspectRouteClearance } from "../src/routeClearance";
import { locomotionProfile, routeEntryHeading } from "../src/locomotion";
import { importedClip, rigHeading } from "../src/rig";
import { groundedPhases, routeStopCandidates } from "../src/routeStops";
import {
  applyAnimatedEntityPose,
  createProp,
  disposeObject,
} from "../src/world";

const asset: Asset = {
  ...motionSource,
  id: "performer",
  name: "Performer",
  url: "/uploads/performer.glb",
};
let rig: T.Group;
beforeAll(async () => {
  const bytes = await readFile("public" + motionSource.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  rig = prepareImportedAsset(asset, gltf);
});
afterAll(() => disposeObject(rig));

/** An actor whose own imported source carries the gait and, unless excluded,
 * the standing performances the library catalogues on it. */
function fixture(takes = libraryMotions.map((m) => m.animationName!)) {
  let scene = applyCommands(starterScene(), [{ type: "clear" }]);
  scene.environment = "studio";
  scene.customAssets.push(asset);
  scene = applyCommands(scene, [
    { type: "add", assetId: asset.id, id: "actor", position: [-3, 0, 0] },
    { type: "update", id: "actor", changes: { rotation: Math.PI / 2 } },
    { type: "add", assetId: "crate", id: "destination", position: [3, 0, 0] },
    { type: "add", assetId: "crate", id: "obstacle", position: [0, 0, 4] },
  ]);
  for (const motion of libraryMotions)
    if (takes.includes(motion.animationName!))
      scene.customMotions.push({
        ...motion,
        id: `performer-${motion.animationName}`,
        sourceAssetId: asset.id,
      });
  const objects = new Map<string, T.Group>([["actor", rig]]);
  for (const e of scene.entities) {
    if (e.id === "actor") continue;
    const a = allAssets(scene).find((a) => a.id === e.assetId)!;
    objects.set(e.id, createProp(a.style, a.color));
  }
  const walk = scene.customMotions.find((m) => m.animationName === "Walk")!;
  const take = importedClip(rig.userData.animations, "Walk")!;
  const profile = locomotionProfile(rig, take)!;
  const cycle = {
    duration: profile.duration,
    entryHeading: routeEntryHeading(profile),
    distance: profile.distance,
    samples: profile.frames.map((f) => ({
      time: f.time,
      distance: f.distance,
    })),
  };
  const motion = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "walk",
    undefined,
    undefined,
    walk,
    cycle,
  );
  scene = applyCommands(scene, savePathCommands(scene, "actor", motion));
  scene.entities[0].clips[0].navigation = {
    targetId: "destination",
    movement: "walk",
  };
  scene = validateScene(scene);
  return { scene, objects, motion, profile };
}

function enclose(f: ReturnType<typeof fixture>, open = false) {
  const walls: [string, [number, number, number]][] = [
    ["wall-n", [3, 0, 1.6]],
    ["wall-s", [3, 0, -1.6]],
    ["wall-e", [4.6, 0, 0]],
    ["wall-w", [1.4, 0, 0]],
  ];
  const scene = applyCommands(f.scene, [
    ...walls.map(([id, position]) => ({
      type: "add" as const,
      assetId: "table",
      id,
      position,
    })),
    ...(open
      ? [
          {
            type: "update" as const,
            id: "wall-w",
            changes: { position: [1.7, 0, 4] as [number, number, number] },
          },
        ]
      : []),
  ]);
  for (const [id] of walls)
    if (!f.objects.has(id)) f.objects.set(id, createProp("table", "#997744"));
  return scene;
}

function body(scene: Scene, objects: Map<string, T.Group>, time: number) {
  for (const entity of scene.entities)
    applyAnimatedEntityPose(objects.get(entity.id)!, entity, scene, time);
  rig.updateMatrixWorld(true);
  const bones = rig.userData.bones as Record<string, T.Bone>;
  const world = (name: string) =>
    bones[name].getWorldPosition(new T.Vector3()).toArray();
  return {
    root: rig.position.toArray(),
    heading: rig.rotation.y,
    facing: rigHeading(rig) ?? 0,
    hips: world("hips"),
    leftFoot: world("leftFoot"),
    rightFoot: world("rightFoot"),
    head: world("head"),
    leftHand: world("leftHand"),
    rightHand: world("rightHand"),
  };
}
const distance = (a: ReturnType<typeof body>, b: ReturnType<typeof body>) =>
  Math.max(
    ...(
      ["root", "hips", "leftFoot", "rightFoot", "head", "leftHand"] as const
    ).map((key) => Math.hypot(...a[key].map((n, i) => n - b[key][i]))),
    Math.abs(
      Math.atan2(
        Math.sin(a.heading - b.heading),
        Math.cos(a.heading - b.heading),
      ),
    ),
  );

function overlaps(scene: Scene, objects: Map<string, T.Group>) {
  const actor = scene.entities.find((e) => e.id === "actor")!;
  return actor.clips.flatMap((clip) => {
    const check = inspectRouteClearance(scene, objects, "actor", clip.id);
    return check.blocked ? [`${clip.id}: ${check.blocked}`] : [];
  });
}

/** Both feet within the gait's own stance height band of the floor. */
function onBothFeet(
  pose: ReturnType<typeof body>,
  floor: number,
  band: number,
) {
  return pose.leftFoot[1] - floor < band && pose.rightFoot[1] - floor < band;
}

it("measures grounded moments on the bundled walk and maps them onto a route's travelling time", () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const take = importedClip(rig.userData.animations, "Walk")!;
  const phases = groundedPhases(rig, take);
  // A walk hands over support twice per cycle; a run has no shared floor
  // moment and offers only its most grounded one.
  expect(phases).toHaveLength(2);
  expect(
    groundedPhases(rig, importedClip(rig.userData.animations, "Run")!),
  ).toHaveLength(1);
  const active = routeActiveDuration(clip);
  const real = routeStopCandidates(
    rig,
    take,
    f.profile,
    compilePath(f.motion.path!).length,
    active,
  );
  expect(real.length).toBeGreaterThan(phases.length);
  expect(real.every((t, i) => i === 0 || t > real[i - 1])).toBe(true);
  expect(real.at(-1)!).toBeLessThan(active);
  // At every candidate both feet are at stance height in the played route,
  // and measuring left the actor's pose untouched.
  const before = body(f.scene, f.objects, active * 0.4);
  groundedPhases(rig, importedClip(rig.userData.animations, "Jump")!);
  const after = {
    ...before,
    hips: (rig.userData.bones.hips as T.Bone)
      .getWorldPosition(new T.Vector3())
      .toArray(),
  };
  expect(distance(before, after)).toBeLessThan(1e-9);
  const floor = Math.min(
    ...Array.from({ length: 50 }, (_, i) => {
      const pose = body(f.scene, f.objects, (active * i) / 50);
      return Math.min(pose.leftFoot[1], pose.rightFoot[1]);
    }),
  );
  for (const time of real.slice(0, 6))
    expect(
      onBothFeet(body(f.scene, f.objects, time), floor, 0.08),
      `${time}`,
    ).toBe(true);
});

it("stops an imported route on both feet, waits standing with a measured performance, and continues from the wait however long it lasted", () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const active = routeActiveDuration(clip);
  const at = active * 0.3;
  const blocked = enclose(f);
  const result = prepareAutomaticRoutes(blocked, f.objects, undefined, at);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].message).toContain("waits standing (Relaxed idle)");
  const stopped = result.scene.entities[0].clips[0];
  expect(stopped.id).toBe(clip.id);
  expect(stopped.routeStop).toBeGreaterThan(at);
  expect(stopped.routeStop).toBeLessThan(at + f.profile.duration);
  expect(stopped.duration).toBe(clip.duration);
  const stop = stopped.routeStop!;
  // The stop is a measured double-support moment of the played gait.
  const floor = Math.min(
    ...Array.from({ length: 50 }, (_, i) => {
      const pose = body(f.scene, f.objects, (active * i) / 50);
      return Math.min(pose.leftFoot[1], pose.rightFoot[1]);
    }),
  );
  const atStop = body(f.scene, f.objects, stop - 1e-7);
  expect(onBothFeet(atStop, floor, 0.06)).toBe(true);
  // Playback: unchanged up to the stop, then a standing wait in place with
  // visible breathing and both feet grounded, however far the timeline runs.
  const playback = result.playbackScene.entities[0];
  expect(playback.clips[0]).toMatchObject({
    id: clip.id,
    duration: stop,
    routeStop: stop,
    routeActive: active,
  });
  expect(playback.clips.length).toBeGreaterThan(2);
  for (const wait of playback.clips.slice(1))
    expect(
      allMotions(result.playbackScene).find((m) => m.id === wait.motionId),
    ).toMatchObject({ animationName: "Idle" });
  for (const time of [0, at * 0.5, at, stop - 0.25])
    expect(
      distance(
        body(result.playbackScene, f.objects, time),
        body(f.scene, f.objects, time),
      ),
      `time ${time}`,
    ).toBeLessThan(1e-9);
  // Within the last quarter second the foot about to be planted settles
  // against a contact window the cut now ends: millimetres, on that foot only.
  for (const time of [stop - 0.15, stop - 0.08, stop - 1e-4]) {
    const a = body(result.playbackScene, f.objects, time),
      b = body(f.scene, f.objects, time);
    expect(distance(a, b), `time ${time}`).toBeLessThan(3e-3);
    expect(Math.hypot(...a.hips.map((n, i) => n - b.hips[i]))).toBeLessThan(
      1e-9,
    );
  }
  const waiting = [stop + 0.5, stop + 3, clip.duration + 5, 30].map((time) =>
    body(result.playbackScene, f.objects, time),
  );
  for (const [i, pose] of waiting.entries()) {
    expect(
      Math.hypot(pose.hips[0] - atStop.hips[0], pose.hips[2] - atStop.hips[2]),
      `drift ${i}`,
    ).toBeLessThan(0.2);
    expect(onBothFeet(pose, floor, 0.08), `feet ${i}`).toBe(true);
  }
  expect(distance(waiting[0], waiting[1])).toBeGreaterThan(0.005);
  expect(overlaps(result.playbackScene, f.objects)).toEqual([]);
  // Still blocked much later: the same stop, the same wait.
  const later = prepareAutomaticRoutes(
    result.scene,
    f.objects,
    undefined,
    clip.duration + 70,
  );
  expect(later.issues).toHaveLength(1);
  expect(later.scene.entities[0].clips[0].routeStop).toBeCloseTo(stop, 9);
  expect(
    distance(
      body(later.playbackScene, f.objects, clip.duration + 5),
      waiting[2],
    ),
  ).toBeLessThan(1e-6);
  // The passage opens after more than a minute: the wait is kept as chained
  // standing clips and the route continues from the waiting body.
  const resumeAt = clip.duration + 75;
  const opened = applyCommands(later.scene, [
    { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
  ]);
  const resumed = prepareAutomaticRoutes(
    opened,
    f.objects,
    undefined,
    resumeAt,
  );
  expect(resumed.issues).toEqual([]);
  const clips = resumed.scene.entities[0].clips;
  expect(clips[0]).toMatchObject({
    id: clip.id,
    duration: stop,
    routeStop: stop,
    routeActive: active,
  });
  expect(clips[0].navigation).toBeUndefined();
  const waits = clips.slice(1, -1);
  expect(waits.length).toBeGreaterThan(10);
  expect(
    waits.every((c) => c.duration <= 60 && c.transition === "smooth"),
  ).toBe(true);
  expect(waits.reduce((sum, c) => sum + c.duration, 0)).toBeCloseTo(
    resumeAt - stop,
    6,
  );
  const continuation = clips.at(-1)!;
  expect(continuation.navigation).toMatchObject(clip.navigation!);
  expect(continuation.transition).toBe("smooth");
  expect(continuation.routeStop).toBeUndefined();
  expect(continuation.routeActive).toBeUndefined();
  for (const time of [0, at, stop - 0.25])
    expect(
      distance(
        body(resumed.scene, f.objects, time),
        body(f.scene, f.objects, time),
      ),
      `time ${time}`,
    ).toBeLessThan(1e-9);
  expect(
    distance(
      body(resumed.scene, f.objects, stop - 1e-4),
      body(result.playbackScene, f.objects, stop - 1e-4),
    ),
  ).toBeLessThan(1e-5);
  for (const time of [stop + 3, clip.duration + 5])
    expect(
      distance(
        body(resumed.scene, f.objects, time),
        body(result.playbackScene, f.objects, time),
      ),
      `wait ${time}`,
    ).toBeLessThan(1e-6);
  const beforeResume = body(resumed.scene, f.objects, resumeAt - 1e-4);
  const start = body(resumed.scene, f.objects, resumeAt + 1e-3);
  expect(
    Math.hypot(
      start.hips[0] - beforeResume.hips[0],
      start.hips[2] - beforeResume.hips[2],
    ),
  ).toBeLessThan(0.02);
  const total = clips.reduce((sum, c) => sum + c.duration, 0);
  const end = body(resumed.scene, f.objects, total + 0.01);
  const destination = resumed.scene.entities.find(
    (e) => e.id === "destination",
  )!.position;
  expect(
    Math.hypot(end.root[0] - destination[0], end.root[2] - destination[2]),
  ).toBeLessThan(1.5);
  expect(overlaps(resumed.scene, f.objects)).toEqual([]);
  expect(
    prepareAutomaticRoutes(resumed.scene, f.objects, undefined, resumeAt + 1)
      .scene,
  ).toBe(resumed.scene);
  expect(() =>
    validateScene(JSON.parse(JSON.stringify(resumed.scene))),
  ).not.toThrow();
}, 120000);

it("holds the stopped pose on both feet when the source has no standing performance, and says so", () => {
  const f = fixture(["Walk"]);
  const clip = f.scene.entities[0].clips[0];
  const at = routeActiveDuration(clip) * 0.3;
  const result = prepareAutomaticRoutes(enclose(f), f.objects, undefined, at);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].message).toContain(
    "No measured standing performance",
  );
  const stop = result.scene.entities[0].clips[0].routeStop!;
  expect(stop).toBeGreaterThan(at);
  expect(result.playbackScene.entities[0].clips).toHaveLength(1);
  const held = body(result.playbackScene, f.objects, stop);
  for (const time of [stop + 1, clip.duration + 5, 30])
    expect(
      distance(body(result.playbackScene, f.objects, time), held),
    ).toBeLessThan(1e-6);
  expect(overlaps(result.playbackScene, f.objects)).toEqual([]);
  const resumeAt = 125.25;
  const opened = applyCommands(result.scene, [
    { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
  ]);
  const resumed = prepareAutomaticRoutes(
    opened,
    f.objects,
    undefined,
    resumeAt,
  );
  expect(resumed.issues).toEqual([]);
  const saved = validateScene(JSON.parse(JSON.stringify(resumed.scene)));
  expect(saved.entities[0].clips.every((c) => c.duration <= 60)).toBe(true);
  for (const time of [stop + 1, 59.99, 60, 60.01, 119.99, 120, resumeAt - 1e-4])
    expect(
      distance(body(saved, f.objects, time), held),
      `held at ${time}`,
    ).toBeLessThan(1e-6);
  const restart = body(saved, f.objects, resumeAt + 1e-3);
  expect(
    Math.hypot(...restart.hips.map((n, i) => n - held.hips[i])),
  ).toBeLessThan(0.01);
});

it.each([0.03, 0.06, 0.5, 0.9, 0.97])(
  "keeps every played frame of an imported route when a replan lands at %s of it, inside its heading windows",
  (fraction) => {
    const f = fixture();
    const clip = f.scene.entities[0].clips[0];
    const at = routeActiveDuration(clip) * fraction;
    const edited = applyCommands(f.scene, [
      { type: "update", id: "destination", changes: { position: [3, 0, 2.5] } },
    ]);
    const result = prepareAutomaticRoutes(edited, f.objects, undefined, at);
    expect(result.issues).toEqual([]);
    const after = result.scene.entities[0].clips[0];
    const motion = allMotions(result.scene).find(
      (m) => m.id === after.motionId,
    )!;
    expect(motion.path!.points).not.toEqual(f.motion.path!.points);
    for (const time of [0, at * 0.3, at * 0.7, at * 0.95, at])
      expect(
        distance(
          body(f.scene, f.objects, time),
          body(result.scene, f.objects, time),
        ),
        `time ${time}`,
      ).toBeLessThan(1e-9);
    // The facing keeps turning after the edit at a walking rate: measured
    // 0.03 rad/frame for early replans, 0.05 mid-route and 0.09 (5.6 rad/s)
    // for the hook back to a destination behind the body at 0.9 and 0.97 of
    // the route; the untouched route turns 0.0024 rad/frame at most.
    const steps = (scene: Scene, from: number, to: number) => {
      let previous = body(scene, f.objects, from).facing,
        largest = 0,
        when = from;
      for (let time = from + 1 / 60; time <= to; time += 1 / 60) {
        const heading = body(scene, f.objects, time).facing;
        const step = Math.abs(
          Math.atan2(
            Math.sin(heading - previous),
            Math.cos(heading - previous),
          ),
        );
        if (step > largest) ((largest = step), (when = time));
        previous = heading;
      }
      return { largest, when };
    };
    const original = steps(f.scene, 0, clip.duration);
    const replanned = steps(result.scene, at, after.duration);
    expect(replanned.largest).toBeLessThan(0.1);
    expect(original.largest).toBeLessThan(0.01);
    expect(overlaps(result.scene, f.objects)).toEqual([]);
  },
  60000,
);

it("repeats block-and-reopen cycles on the continuation without rewinding anything already played, keeping the action scheduled after the route", () => {
  const f = fixture();
  f.scene = validateScene({
    ...f.scene,
    entities: f.scene.entities.map((e) =>
      e.id !== "actor"
        ? e
        : {
            ...e,
            clips: [
              ...e.clips,
              {
                id: "after",
                motionId: "performer-Victory",
                duration: 1.875,
                playbackRate: 1,
              },
            ],
          },
    ),
  });
  const clip = f.scene.entities[0].clips[0];
  const open = (scene: Scene) =>
    applyCommands(scene, [
      { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
    ]);
  const close = (scene: Scene) =>
    applyCommands(scene, [
      { type: "update", id: "wall-w", changes: { position: [1.4, 0, 0] } },
    ]);
  const at1 = routeActiveDuration(clip) * 0.3;
  const first = prepareAutomaticRoutes(enclose(f), f.objects, undefined, at1);
  const stop1 = first.scene.entities[0].clips[0].routeStop!;
  const resume1 = stop1 + 3;
  const resumed1 = prepareAutomaticRoutes(
    open(first.scene),
    f.objects,
    undefined,
    resume1,
  );
  expect(resumed1.issues).toEqual([]);
  const continuation1 = resumed1.scene.entities[0].clips.at(-2)!;
  expect(continuation1.id).toBe(`${clip.id}:continue`);
  expect(resumed1.scene.entities[0].clips.at(-1)!.id).toBe("after");
  // The passage closes again while the continuation is being walked.
  const at2 = resume1 + 0.8;
  const second = prepareAutomaticRoutes(
    close(resumed1.scene),
    f.objects,
    undefined,
    at2,
  );
  expect(second.issues).toHaveLength(1);
  expect(second.issues[0].clipId).toBe(continuation1.id);
  const stopped2 = second.scene.entities[0].clips.at(-2)!;
  expect(stopped2.id).toBe(continuation1.id);
  expect(stopped2.routeStop).toBeGreaterThan(at2 - resume1);
  const stop2 = resume1 + stopped2.routeStop!;
  for (const time of [0, at1, stop1 + 1, resume1 + 0.3, at2])
    expect(
      distance(
        body(second.playbackScene, f.objects, time),
        body(resumed1.scene, f.objects, time),
      ),
      `time ${time}`,
    ).toBeLessThan(1e-9);
  const held2 = body(second.playbackScene, f.objects, stop2 + 0.5);
  // It opens once more; both cycles stay in the saved sequence.
  const resume2 = stop2 + 2;
  const resumed2 = prepareAutomaticRoutes(
    open(second.scene),
    f.objects,
    undefined,
    resume2,
  );
  expect(resumed2.issues).toEqual([]);
  const clips = resumed2.scene.entities[0].clips;
  expect(clips.at(-2)!.id).toBe(`${clip.id}:continue:continue`);
  // The action scheduled after the route is still there, after both waits.
  expect(clips.at(-1)).toMatchObject({ id: "after", duration: 1.875 });
  const waited = clips
    .filter((c) => c.id.includes(":wait:"))
    .reduce((sum, c) => sum + c.duration, 0);
  expect(waited).toBeCloseTo(resume1 - stop1 + (resume2 - stop2), 6);
  expect(clips.filter((c) => c.id.includes(":wait:")).length).toBeGreaterThan(
    1,
  );
  for (const time of [0, at1, stop1 + 1, resume1 + 0.3, at2])
    expect(
      distance(
        body(resumed2.scene, f.objects, time),
        body(resumed1.scene, f.objects, time),
      ),
      `time ${time}`,
    ).toBeLessThan(1e-9);
  expect(
    distance(body(resumed2.scene, f.objects, stop2 + 0.5), held2),
  ).toBeLessThan(1e-6);
  const total = clips.slice(0, -1).reduce((sum, c) => sum + c.duration, 0);
  const end = body(resumed2.scene, f.objects, total + 0.01);
  const destination = resumed2.scene.entities.find(
    (e) => e.id === "destination",
  )!.position;
  expect(
    Math.hypot(end.root[0] - destination[0], end.root[2] - destination[2]),
  ).toBeLessThan(1.5);
  expect(overlaps(resumed2.scene, f.objects)).toEqual([]);
  expect(() =>
    validateScene(JSON.parse(JSON.stringify(resumed2.scene))),
  ).not.toThrow();
}, 120000);

it("drops a scheduled stop the body has not reached when the passage opens first", () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const at = routeActiveDuration(clip) * 0.3;
  const stopped = prepareAutomaticRoutes(enclose(f), f.objects, undefined, at);
  const stop = stopped.scene.entities[0].clips[0].routeStop!;
  const opened = applyCommands(stopped.scene, [
    { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
  ]);
  const early = at + (stop - at) * 0.5;
  const resumed = prepareAutomaticRoutes(opened, f.objects, undefined, early);
  expect(resumed.issues).toEqual([]);
  expect(resumed.scene.entities[0].clips).toHaveLength(1);
  expect(resumed.scene.entities[0].clips[0].routeStop).toBeUndefined();
  for (const time of [0, at, early])
    expect(
      distance(
        body(resumed.scene, f.objects, time),
        body(f.scene, f.objects, time),
      ),
    ).toBeLessThan(1e-9);
});
