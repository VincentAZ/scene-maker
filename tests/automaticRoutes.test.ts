import { expect, it } from "vitest";
import * as T from "three";
import {
  allAssets,
  allMotions,
  applyCommands,
  characters,
  starterScene,
  validateScene,
  type Scene,
} from "../shared/scene";
import { compilePath, pathToWorld, savePathCommands } from "../shared/path";
import { clearSegment } from "../shared/navigation";
import {
  prepareAutomaticRoutes,
  prepareAutomaticRoutesAsync,
} from "../src/automaticRoutes";
import {
  planObjectRoute,
  planPointRoute,
  routeContext,
} from "../src/routePlanner";
import {
  movingObstacleIds,
  inspectRouteClearance,
  inspectRouteClearanceSteps,
} from "../src/routeClearance";
import { applyInteractions } from "../src/interactions";
import { appendSpeech, dialogueTiming } from "../shared/conversation";
import { configureRigContacts } from "../src/ik";
import {
  sceneCollisionWarning,
  sceneObstacles,
} from "../src/assetManipulation";
import {
  applyAnimatedEntityPose,
  createCharacter,
  createProp,
} from "../src/world";

function fixture() {
  let scene = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "actor", position: [-3, 0, 0] },
    { type: "update", id: "actor", changes: { rotation: Math.PI / 2 } },
    { type: "add", assetId: "crate", id: "destination", position: [3, 0, 0] },
    { type: "add", assetId: "crate", id: "obstacle", position: [0, 0, 3] },
  ]);
  scene.environment = "studio";
  const objects = new Map<string, T.Group>();
  for (const e of scene.entities) {
    const a = allAssets(scene).find((a) => a.id === e.assetId)!;
    objects.set(
      e.id,
      a.category === "characters"
        ? createCharacter(characters[0])
        : createProp(a.style, a.color),
    );
  }
  const motion = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "walk",
  );
  scene = applyCommands(scene, savePathCommands(scene, "actor", motion));
  scene.entities[0].clips[0].navigation = {
    targetId: "destination",
    movement: "walk",
  };
  return { scene, objects, motion };
}

function movingCrate(
  f: ReturnType<typeof fixture>,
  startZ: number,
  endZ: number,
  seconds: number,
) {
  const scene = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, startZ] } },
    {
      type: "createMotion",
      motion: {
        id: "crossing",
        name: "Cross the aisle",
        kind: "walk",
        duration: seconds,
        distance: 0,
        poses: [],
        path: {
          points: [
            [0, 0, 0],
            [0, 0, endZ - startZ],
          ],
          smooth: false,
        },
      },
    },
    {
      type: "update",
      id: "obstacle",
      changes: {
        clips: [
          { id: "crossing-clip", motionId: "crossing", duration: seconds },
        ],
      },
    },
  ]);
  return scene;
}

it("replans around a stationary obstacle even when the actor has a later acquisition scheduled", () => {
  const f = fixture();
  let scene = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 0] } },
    { type: "chain", id: "actor", motionId: "idle", duration: 30 },
    { type: "chain", id: "actor", motionId: "pick", targetId: "obstacle" },
  ]);
  const clip = scene.entities[0].clips[0];
  expect(movingObstacleIds(scene).has("obstacle")).toBe(true);
  const before = inspectRouteClearance(scene, f.objects, "actor", clip.id);
  expect(
    before.conflicts.find((c) => c.footprint.id === "obstacle")?.moving,
  ).toBe(false);
  const prepared = prepareAutomaticRoutes(scene, f.objects);
  expect(prepared.issues).toEqual([]);
  expect(
    inspectRouteClearance(prepared.scene, f.objects, "actor", clip.id).blocked,
  ).toBeNull();
  expect(prepared.scene.entities[0].clips.at(-1)?.motionId).toBe("pick");
});

it("rejects obstructed arrival candidates early while retaining complete scans for clear candidates", () => {
  const f = fixture();
  const run = (early: boolean) => {
    const work = inspectRouteClearanceSteps(
      f.scene,
      f.objects,
      "actor",
      f.scene.entities[0].clips[0].id,
      undefined,
      { stopAtFirstConflict: early },
    );
    let samples = 0;
    for (;;) {
      const step = work.next();
      if (step.done) return { samples, ...step.value };
      samples++;
    }
  };
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [-3, 0, 0];
  const complete = run(false),
    early = run(true);
  expect(early.blocked).toBe(complete.blocked);
  expect(early.conflicts[0]).toEqual(complete.conflicts[0]);
  expect(early.samples).toBe(1);
  expect(complete.samples).toBeGreaterThan(60);
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 3];
  const clear = run(true);
  expect(clear.blocked).toBeNull();
  expect(clear.samples).toBe(complete.samples);
});

it("uses isolated terminal rejection checks without skipping the full scan or sweeping across unrelated probe times", () => {
  const f = fixture(),
    clipId = f.scene.entities[0].clips[0].id;
  const run = (scene: typeof f.scene, rejectionTimes?: number[]) => {
    const work = inspectRouteClearanceSteps(
      scene,
      f.objects,
      "actor",
      clipId,
      undefined,
      { stopAtFirstConflict: true, rejectionTimes },
    );
    let samples = 0;
    for (;;) {
      const step = work.next();
      if (step.done) return { ...step.value, samples };
      samples++;
    }
  };
  const end = f.scene.entities[0].clips[0].duration;
  applyAnimatedEntityPose(
    f.objects.get("actor")!,
    f.scene.entities[0],
    f.scene,
    end,
  );
  f.scene.entities.find((e) => e.id === "obstacle")!.position = f.objects
    .get("actor")!
    .position.toArray();
  const late = run(f.scene),
    terminal = run(f.scene, [end]);
  expect(terminal.blocked).toBe(late.blocked);
  expect(terminal.conflicts[0].time).toBe(end);
  expect(terminal.samples).toBe(1);
  expect(late.samples).toBeGreaterThan(60);
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  // Clear endpoints must not conceal a collision halfway through a straight path.
  const crossing = run(f.scene, [end, 0]);
  expect(crossing.blocked).not.toBeNull();
  expect(crossing.samples).toBeGreaterThan(3);
  expect(crossing.conflicts[0].time).toBeGreaterThan(0);
  expect(crossing.conflicts[0].time).toBeLessThan(end);
  // The resolved curved route is clear. A sweep from end to start would falsely
  // cut across the crate, so each preflight pose must be tested independently.
  const resolved = prepareAutomaticRoutes(f.scene, f.objects);
  expect(resolved.issues).toEqual([]);
  const total = resolved.scene.entities[0].clips[0].duration;
  const full = run(resolved.scene),
    probed = run(resolved.scene, [total, 0, total, -1, total + 1, NaN]);
  expect(probed.blocked).toBeNull();
  expect(probed.samples).toBe(full.samples + 2);
});

it("retimes existing speakers around a geometry detour without stretching their actions", () => {
  const f = fixture();
  f.scene.transcript = [
    {
      characterId: "actor",
      name: "Mila",
      text: "Over here.",
      clipId: f.scene.entities[0].clips[0].id,
    },
  ];
  f.scene = applyCommands(f.scene, [
    { type: "add", id: "partner", assetId: "leo", position: [4, 0, -4] },
  ]);
  f.objects.set("partner", createCharacter(characters[1]));
  f.scene = appendSpeech(f.scene, "partner", {
    dialogue: "I see you.",
    performance: [{ motionId: "talk", duration: 4 }],
  });
  f.scene = appendSpeech(f.scene, "actor", {
    dialogue: "Now we can talk.",
    performance: [{ motionId: "wave", duration: 3 }],
  });
  const speech = f.scene.entities
    .find((e) => e.id === "partner")!
    .clips.at(-1)!;
  const before = dialogueTiming(f.scene, f.scene.transcript[0])!.end;
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const times = result.scene.transcript.map((line) =>
    dialogueTiming(result.scene, line)!,
  );
  expect(times[0].end).toBeGreaterThan(before);
  expect(times[1]).toEqual({ start: times[0].end, end: times[0].end + 4 });
  expect(times[2].start).toBeCloseTo(times[1].end, 10);
  expect(
    result.scene.entities.find((e) => e.id === "partner")!.clips.at(-1),
  ).toEqual(speech);
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );
});

it.each([0.4, 2])(
  "keeps coordinate destinations relative to preceding travel and facing at scale %s",
  (scale) => {
    const f = fixture(),
      actor = f.scene.entities[0];
    actor.scale = scale;
    actor.rotation = 0.7;
    actor.clips = [
      { id: "before", motionId: "walk", duration: 2 },
      { id: "point", motionId: f.motion.id, duration: 4 },
    ];
    for (const entity of f.scene.entities.slice(1))
      entity.position = [40, 0, 40];
    const point: [number, number, number] = [1, 0, 3];
    const frame = routeContext(f.scene, f.objects, "actor", "point").frame;
    const expected = pathToWorld(point, frame);
    const motion = planPointRoute(
      f.scene,
      f.objects,
      "actor",
      point,
      "walk",
      "point",
      undefined,
      undefined,
      undefined,
      0,
      undefined,
      0.4,
    );
    const scene = applyCommands(
      f.scene,
      savePathCommands(
        f.scene,
        "actor",
        { ...motion, id: f.motion.id },
        "point",
      ),
    );
    const end = scene.entities[0].clips.reduce((sum, c) => sum + c.duration, 0);
    const group = f.objects.get("actor")!;
    applyAnimatedEntityPose(group, scene.entities[0], scene, end - 1e-7);
    expect(
      Math.hypot(
        group.position.x - expected[0],
        group.position.z - expected[2],
      ),
    ).toBeLessThan(1e-5);
    const turn = group.rotation.y - frame.heading - 0.4;
    expect(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))).toBeLessThan(
      1e-5,
    );
  },
);

it("replans a coordinate goal around a newly placed obstacle and preserves its intended endpoint", () => {
  const f = fixture(),
    point = f.motion.path!.points.at(-1)!;
  f.scene.entities[0].clips[0].navigation = {
    point: [...point],
    endHeading: f.motion.path!.endHeading,
    movement: "walk",
  };
  f.scene.entities.find((e) => e.id === "destination")!.position = [3, 0, 3];
  const initial = structuredClone(f.scene);
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  const path = allMotions(result.scene).find(
    (m) => m.id === clip.motionId,
  )!.path!;
  expect(path.points.at(-1)).toEqual(point);
  expect(path.points).not.toEqual(f.motion.path!.points);
  expect(clip.duration / compilePath(path).length).toBeCloseTo(
    initial.entities[0].clips[0].duration / compilePath(f.motion.path!).length,
    8,
  );
  expect(
    overlapsDuring(result.playbackScene, f.objects, clip.duration),
  ).toEqual([]);
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );
  const disabled = { ...f.scene, animationCollisions: false };
  expect(prepareAutomaticRoutes(disabled, f.objects).scene).toBe(disabled);
});

it("predicts moving obstacles for point goals and holds a blocked coordinate without deleting its route", () => {
  const f = fixture(),
    point = f.motion.path!.points.at(-1)!;
  f.scene.entities[0].clips[0].navigation = {
    point: [...point],
    endHeading: f.motion.path!.endHeading,
    movement: "walk",
  };
  f.scene.entities.find((e) => e.id === "destination")!.position = [3, 0, 3];
  const moving = movingCrate(f, -2, 2, 5);
  const planned = prepareAutomaticRoutes(moving, f.objects);
  expect(planned.issues).toEqual([]);
  expect(
    overlapsDuring(
      planned.playbackScene,
      f.objects,
      planned.scene.entities[0].clips[0].duration,
    ),
  ).toEqual([]);
  const frame = routeContext(
    f.scene,
    f.objects,
    "actor",
    f.scene.entities[0].clips[0].id,
  ).frame;
  const blocked = applyCommands(f.scene, [
    {
      type: "update",
      id: "obstacle",
      changes: { position: pathToWorld(point, frame) },
    },
  ]);
  const result = prepareAutomaticRoutes(blocked, f.objects);
  expect(result.issues).toHaveLength(1);
  expect(result.scene.entities[0].clips).toEqual(blocked.entities[0].clips);
  expect(result.playbackScene.entities[0].clips).toEqual([]);
});

function overlapsDuring(
  scene: ReturnType<typeof starterScene>,
  objects: Map<string, T.Group>,
  end: number,
) {
  const overlaps: string[] = [];
  for (let i = 0; i <= 241; i++) {
    const time = (end * i) / 241;
    for (const entity of scene.entities)
      applyAnimatedEntityPose(objects.get(entity.id)!, entity, scene, time);
    const warning = sceneCollisionWarning(sceneObstacles(scene, objects));
    if (warning) overlaps.push(`${time}: ${warning}`);
  }
  return overlaps;
}

it("predicts a moving prop crossing an otherwise clear route and replans at the same gait pace", () => {
  const f = fixture();
  const scene = movingCrate(f, -2, 2, 5);
  const before = scene.entities[0].clips[0];
  expect(
    overlapsDuring(scene, f.objects, before.duration).length,
  ).toBeGreaterThan(0);
  const result = prepareAutomaticRoutes(scene, f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  expect(clip.id).toBe(before.id);
  expect(overlapsDuring(result.scene, f.objects, clip.duration)).toEqual([]);
  const path = allMotions(result.scene).find(
    (m) => m.id === clip.motionId,
  )!.path!;
  expect(path.points.length).toBeGreaterThan(2);
  expect(clip.duration / compilePath(path).length).toBeCloseTo(
    before.duration / compilePath(f.motion.path!).length,
    8,
  );
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );
});

it("uses space after a moving obstacle has vacated it instead of excluding its entire trajectory", () => {
  const f = fixture();
  const result = prepareAutomaticRoutes(movingCrate(f, 0, 4, 1), f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  const path = allMotions(result.scene).find(
    (m) => m.id === clip.motionId,
  )!.path!;
  // Collinear approach guides may add control points; vacated space should
  // still permit the direct route rather than a detour around its old position.
  expect(compilePath(path).length).toBeCloseTo(
    new T.Vector3(...path.points[0]).distanceTo(
      new T.Vector3(...path.points.at(-1)!),
    ),
    8,
  );
  expect(overlapsDuring(result.scene, f.objects, clip.duration)).toEqual([]);
});

it("validates a detour at the selected pace rather than rejecting its unscaled native duration", async () => {
  const { libraryMotions } = await import("../shared/motionLibrary");
  const f = fixture(),
    gait = libraryMotions.find((m) => m.animationName === "Walk")!;
  const cycle = { distance: 1, duration: 100 };
  const clipId = f.scene.entities[0].clips[0].id;
  expect(() =>
    planObjectRoute(
      f.scene,
      f.objects,
      "actor",
      "destination",
      "walk",
      clipId,
      undefined,
      gait,
      cycle,
    ),
  ).toThrow("too far");
  const route = planObjectRoute(
    f.scene,
    f.objects,
    "actor",
    "destination",
    "walk",
    clipId,
    undefined,
    gait,
    cycle,
    0,
    { movingIds: new Set(), conflicts: [], durationScale: 0.01 },
  );
  expect(route.duration).toBeCloseTo(compilePath(route.path!).length, 12);
  expect(route.duration).toBeLessThan(60);
});

it("chooses a clear stopping place when an obstacle arrives during the final hold", () => {
  const f = fixture();
  const scene = movingCrate(f, -3, 3, 10);
  scene.entities.find((e) => e.id === "obstacle")!.position[0] = 2;
  expect(overlapsDuring(scene, f.objects, 12).length).toBeGreaterThan(0);
  const result = prepareAutomaticRoutes(scene, f.objects);
  expect(result.issues).toEqual([]);
  expect(overlapsDuring(result.playbackScene, f.objects, 12)).toEqual([]);
  // Two complete animated schedules plus coupled replanning exceed the default
  // timeout on busy runners now that skins have separate collision regions.
}, 10000);

it("rechecks the final combined schedule of two AI-controlled crossing actors", () => {
  const f = fixture();
  let scene = applyCommands(f.scene, [
    { type: "remove", id: "obstacle" },
    { type: "add", assetId: "mila", id: "second", position: [0, 0, -3] },
    { type: "add", assetId: "crate", id: "second-goal", position: [0, 0, 3] },
  ]);
  f.objects.delete("obstacle");
  f.objects.set("second", createCharacter(characters[0]));
  f.objects.set("second-goal", createProp("crate", "#997744"));
  const motion = planObjectRoute(
    scene,
    f.objects,
    "second",
    "second-goal",
    "walk",
  );
  scene = applyCommands(scene, savePathCommands(scene, "second", motion));
  scene.entities.find((e) => e.id === "second")!.clips[0].navigation = {
    targetId: "second-goal",
    movement: "walk",
  };
  const result = prepareAutomaticRoutes(scene, f.objects);
  expect(result.issues).toEqual([]);
  expect(overlapsDuring(result.playbackScene, f.objects, 12)).toEqual([]);
  // Two coupled 60 Hz mesh sweeps take about 4.5 s alone; a concurrent full
  // run must not turn that into a timeout.
}, 15000);

it("keeps cooperative planning deterministic while the viewport renders between batches", async () => {
  const f = fixture();
  const scene = movingCrate(f, -2, 2, 5);
  const expected = prepareAutomaticRoutes(scene, f.objects);
  let yields = 0;
  const actual = await prepareAutomaticRoutesAsync(
    scene,
    f.objects,
    undefined,
    {
      onYield: () => {
        yields++;
        for (const entity of scene.entities)
          applyAnimatedEntityPose(
            f.objects.get(entity.id)!,
            entity,
            scene,
            (yields % 13) * 0.41,
          );
      },
    },
  );
  expect(yields).toBeGreaterThan(2);
  expect(actual).toEqual(expected);
}, 15000);

it("cancels superseded planning and can prepare the next scene without stale mutations", async () => {
  const f = fixture();
  const scene = movingCrate(f, -2, 2, 5),
    saved = JSON.stringify(scene);
  const controller = new AbortController();
  let yields = 0;
  await expect(
    prepareAutomaticRoutesAsync(scene, f.objects, undefined, {
      signal: controller.signal,
      onYield: () => {
        if (++yields === 2) controller.abort();
      },
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(JSON.stringify(scene)).toBe(saved);
  const replacement = movingCrate(f, 0, 4, 1);
  const result = await prepareAutomaticRoutesAsync(replacement, f.objects);
  expect(result.issues).toEqual([]);
  expect(overlapsDuring(result.playbackScene, f.objects, 12)).toEqual([]);
}, 15000);

it("keeps intentional hand contact while including a carried prop in route clearance", () => {
  const f = fixture();
  f.scene.entities[0].clips = [];
  const actor = f.scene.entities[0],
    group = f.objects.get(actor.id)!;
  configureRigContacts(group);
  applyAnimatedEntityPose(group, actor, f.scene, 0);
  const hand = group.userData.bones.rightForearm.localToWorld(
    group.userData.contacts.hand.clone(),
  );
  const position = hand.sub(new T.Vector3(0.13, 0.08, 0)).toArray();
  let scene = applyCommands(f.scene, [
    { type: "add", assetId: "cup", id: "carried", position },
    { type: "chain", id: actor.id, motionId: "pick", targetId: "carried" },
  ]);
  f.objects.set("carried", createProp("cup", "#557799"));
  const motion = planObjectRoute(
    scene,
    f.objects,
    actor.id,
    "destination",
    "walk",
    undefined,
    undefined,
    undefined,
    undefined,
    0,
    { movingIds: movingObstacleIds(scene), conflicts: [] },
  );
  scene = applyCommands(scene, savePathCommands(scene, actor.id, motion));
  scene.entities[0].clips.at(-1)!.navigation = {
    targetId: "destination",
    movement: "walk",
  };
  const result = prepareAutomaticRoutes(scene, f.objects);
  expect(result.issues).toEqual([]);
  const walking = result.scene.entities[0].clips.at(-1)!;
  expect(
    inspectRouteClearance(result.scene, f.objects, actor.id, walking.id)
      .conflicts,
  ).toEqual([]);
  const time =
    result.scene.entities[0].clips[0].duration + walking.duration * 0.5;
  for (const entity of result.scene.entities)
    applyAnimatedEntityPose(
      f.objects.get(entity.id)!,
      entity,
      result.scene,
      time,
    );
  expect(applyInteractions(result.scene, time, f.objects)).toEqual([]);
  const grip = f.objects
    .get("carried")!
    .localToWorld(new T.Vector3(0.13, 0.08, 0));
  expect(
    grip.distanceTo(
      group.userData.bones.rightForearm.localToWorld(
        group.userData.contacts.hand.clone(),
      ),
    ),
  ).toBeLessThan(1e-5);
});

it("replans a saved AI destination after a prop blocks its route, preserving pace and clip identity", () => {
  const f = fixture();
  const moved = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 0] } },
  ]);
  const clip = moved.entities[0].clips[0];
  clip.duration *= 1.7; // Deliberate user pace, retained through the detour.
  const result = prepareAutomaticRoutes(moved, f.objects);
  expect(result.issues).toEqual([]);
  expect(result.scene).not.toBe(moved);
  const after = result.scene.entities[0].clips[0];
  const motion = allMotions(result.scene).find((m) => m.id === after.motionId)!;
  expect(after.id).toBe(clip.id);
  expect(after.navigation).toMatchObject(clip.navigation!);
  expect(compilePath(motion.path!).length).toBeGreaterThan(
    compilePath(f.motion.path!).length,
  );
  expect(after.duration / compilePath(motion.path!).length).toBeCloseTo(
    clip.duration / compilePath(f.motion.path!).length,
    9,
  );
  const context = routeContext(result.scene, f.objects, "actor", after.id);
  const padding = context.radius + 0.04;
  const obstacles = context.footprints.map((p) => ({
    ...p,
    minX: p.minX - padding,
    maxX: p.maxX + padding,
    minZ: p.minZ - padding,
    maxZ: p.maxZ + padding,
  }));
  const samples = compilePath(motion.path!).samples.map((s) =>
    pathToWorld(s.point, context.frame),
  );
  expect(
    samples
      .slice(1)
      .every((point, i) => clearSegment(samples[i], point, obstacles)),
  ).toBe(true);
  expect(moved.customMotions.find((m) => m.id === f.motion.id)!.path).toEqual(
    f.motion.path,
  );
  const again = prepareAutomaticRoutes(result.scene, f.objects);
  expect(again.scene).toBe(result.scene);
  expect(
    validateScene(JSON.parse(JSON.stringify(result.scene))).entities[0].clips[0]
      .navigation,
  ).toEqual(after.navigation);
});

it("allows for visible attachments and animated limbs rather than shoulder width alone", () => {
  const f = fixture();
  const attachment = new T.Mesh(
    new T.BoxGeometry(1.8, 0.25, 0.45),
    new T.MeshBasicMaterial(),
  );
  attachment.position.y = 0.7;
  f.objects.get("actor")!.add(attachment);
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  // The 1.8 m bar spans the facing: its half-width is the passing clearance.
  expect(clip.navigation!.clearance).toBeGreaterThanOrEqual(0.9);
  // Off the planner's frame grid, inspect the actual mesh collider in the same
  // way as playback diagnostics, including the final arrival and held pose.
  for (const progress of [
    0,
    ...Array.from({ length: 119 }, (_, i) => (i + 0.5) / 120),
    1,
    1.1,
  ]) {
    for (const entity of result.scene.entities)
      applyAnimatedEntityPose(
        f.objects.get(entity.id)!,
        entity,
        result.scene,
        clip.duration * progress,
      );
    expect(
      sceneCollisionWarning(sceneObstacles(result.scene, f.objects)),
      `progress ${progress}`,
    ).toBe("");
  }
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );
});

it("passes beside an obstacle at the body's width across its facing, not its full stride extent", () => {
  const wide = fixture();
  const bar = new T.Mesh(
    new T.BoxGeometry(1.8, 0.25, 0.45),
    new T.MeshBasicMaterial(),
  );
  bar.position.y = 0.7;
  wide.objects.get("actor")!.add(bar);
  wide.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  const wideResult = prepareAutomaticRoutes(wide.scene, wide.objects);
  const f = fixture();
  // The same reach along the facing (a stride or arm swing) is narrow across it.
  const rod = new T.Mesh(
    new T.BoxGeometry(0.3, 0.25, 0.8),
    new T.MeshBasicMaterial(),
  );
  rod.position.y = 0.7;
  f.objects.get("actor")!.add(rod);
  f.scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
  const result = prepareAutomaticRoutes(f.scene, f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  const wideClip = wideResult.scene.entities[0].clips[0];
  // Full-extent widening gave 0.6 here; width across the facing gives 0.5.
  expect(clip.navigation!.clearance ?? 0).toBeLessThan(0.55);
  expect(clip.navigation!.clearance ?? 0).toBeLessThan(
    wideClip.navigation!.clearance!,
  );
  const length = (scene: Scene) =>
    compilePath(
      allMotions(scene).find(
        (m) => m.id === scene.entities[0].clips[0].motionId,
      )!.path!,
    ).length;
  expect(length(result.scene)).toBeLessThan(length(wideResult.scene));
  for (const progress of [
    0,
    ...Array.from({ length: 119 }, (_, i) => (i + 0.5) / 120),
    1,
    1.1,
  ]) {
    for (const entity of result.scene.entities)
      applyAnimatedEntityPose(
        f.objects.get(entity.id)!,
        entity,
        result.scene,
        clip.duration * progress,
      );
    expect(
      sceneCollisionWarning(sceneObstacles(result.scene, f.objects)),
      `progress ${progress}`,
    ).toBe("");
  }
  expect(prepareAutomaticRoutes(result.scene, f.objects).scene).toBe(
    result.scene,
  );
});

it("holds before an unreachable route and suppresses following actions without deleting saved intent", () => {
  const f = fixture();
  const blocked = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [-3, 0, 0] } },
    { type: "chain", id: "actor", motionId: "wave" },
  ]);
  const result = prepareAutomaticRoutes(blocked, f.objects);
  expect(result.issues).toHaveLength(1);
  expect(result.scene.entities[0].clips).toHaveLength(2);
  expect(result.playbackScene.entities[0].clips).toEqual([]);
  for (const time of [0, 8, 1, 8]) {
    applyAnimatedEntityPose(
      f.objects.get("actor")!,
      result.playbackScene.entities[0],
      result.playbackScene,
      time,
    );
    expect(f.objects.get("actor")!.position.toArray()).toEqual([-3, 0, 0]);
  }
  const disabled = { ...blocked, animationCollisions: false };
  expect(prepareAutomaticRoutes(disabled, f.objects)).toEqual({
    scene: disabled,
    playbackScene: disabled,
    issues: [],
  });
  const restored = applyCommands(blocked, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 3] } },
  ]);
  expect(prepareAutomaticRoutes(restored, f.objects).issues).toEqual([]);
});

it("keeps a missing destination as recoverable intent and leaves manual routes alone", () => {
  const f = fixture();
  const removed = applyCommands(f.scene, [
    { type: "remove", id: "destination" },
  ]);
  const result = prepareAutomaticRoutes(removed, f.objects);
  expect(result.issues).toHaveLength(1);
  expect(result.scene.entities[0].clips[0].navigation?.targetId).toBe(
    "destination",
  );
  const manual = structuredClone(f.scene);
  delete manual.entities[0].clips[0].navigation;
  expect(prepareAutomaticRoutes(manual, f.objects).scene).toBe(manual);
});

it("keeps an explicit path edit instead of restoring the previous AI destination", () => {
  const f = fixture();
  const edited = {
    ...f.motion,
    path: {
      ...f.motion.path!,
      points: [
        [0, 0, 0],
        [1, 0, 1],
        [2, 0, 2],
      ] as [number, number, number][],
    },
  };
  const scene = applyCommands(
    f.scene,
    savePathCommands(f.scene, "actor", edited, f.scene.entities[0].clips[0].id),
  );
  expect(scene.entities[0].clips[0].navigation).toBeUndefined();
  expect(prepareAutomaticRoutes(scene, f.objects).scene).toBe(scene);
  expect(allMotions(scene).find((m) => m.id === edited.id)!.path).toEqual(
    edited.path,
  );
});

it.each([
  { destinationKind: "object", window: false },
  { destinationKind: "point", window: false },
  { destinationKind: "object", window: true },
  { destinationKind: "point", window: true },
] as const)(
  "keeps imported gait phase and explicit pace through a longer $destinationKind detour with window=$window",
  async ({ destinationKind, window }) => {
    const { readFile } = await import("node:fs/promises");
    const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
    const { prepareImportedAsset } = await import("../src/importedAsset");
    const { motionSource: sourceAsset, libraryMotions } =
      await import("../shared/motionLibrary");
    const { setMotionSources } = await import("../src/rig");
    const { locomotionProfile, locomotionScale } =
      await import("../src/locomotion");
    const { gaitTravelTime } = await import("../src/routeLocomotion");
    const f = fixture();
    f.scene.entities[0].clips = [];
    f.scene.customMotions = [];
    const bytes = await readFile("public" + sourceAsset.url);
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const source = prepareImportedAsset(sourceAsset, gltf);
    const group = f.objects.get("actor")!;
    setMotionSources(group, new Map([[sourceAsset.id, source]]));
    let locomotion = libraryMotions.find((m) => m.animationName === "Walk")!;
    const native = T.AnimationClip.findByName(
      source.userData.animations,
      "Walk",
    )!;
    if (window) {
      native.tracks.forEach((track) => track.shift(5));
      native.duration += 5;
      locomotion = {
        ...locomotion,
        path: {
          points: [
            [0, 0, 0],
            [0, 0, 1],
          ],
          smooth: false,
          sourceRange: { start: 5, end: native.duration },
          strideScale: 1.05,
        },
      };
    }
    const profile = locomotionProfile(
      source,
      native,
      locomotion.path?.sourceRange,
    )!;
    const ratio =
      locomotionScale(source, group) * (locomotion.path?.strideScale ?? 1);
    const cycle = {
      distance: profile.distance * ratio,
      duration: profile.duration,
      samples: profile.frames.map((frame) => ({
        time: frame.time,
        distance: frame.distance * ratio,
      })),
    };
    const motion = planObjectRoute(
      f.scene,
      f.objects,
      "actor",
      "destination",
      "walk",
      undefined,
      undefined,
      locomotion,
      cycle,
    );
    expect(motion.duration).toBeCloseTo(
      gaitTravelTime(cycle, compilePath(motion.path!).length),
      12,
    );
    const scene = applyCommands(
      f.scene,
      savePathCommands(f.scene, "actor", motion),
    );
    const clip = scene.entities[0].clips[0];
    clip.navigation =
      destinationKind === "object"
        ? { targetId: "destination", movement: "walk" }
        : {
            point: [...motion.path!.points.at(-1)!],
            endHeading: motion.path!.endHeading,
            movement: "walk",
          };
    clip.duration *= 1.25;
    if (destinationKind === "point")
      scene.entities.find((e) => e.id === "destination")!.position = [3, 0, 3];
    scene.entities.find((e) => e.id === "obstacle")!.position = [0, 0, 0];
    const result = prepareAutomaticRoutes(scene, f.objects);
    expect(result.issues).toEqual([]);
    const after = result.scene.entities[0].clips[0];
    const moved = allMotions(result.scene).find(
      (m) => m.id === after.motionId,
    )!;
    expect(moved.kind).toBe("imported");
    expect(moved.sourceAssetId).toBe(sourceAsset.id);
    expect(moved.animationName).toBe("Walk");
    expect(moved.path?.sourceRange).toEqual(locomotion.path?.sourceRange);
    expect(moved.path?.strideScale).toBe(locomotion.path?.strideScale);
    expect(
      gaitTravelTime(cycle, compilePath(moved.path!).length) / after.duration,
    ).toBeCloseTo(
      gaitTravelTime(cycle, compilePath(motion.path!).length) / clip.duration,
      9,
    );
    const points: number[][] = [];
    for (const progress of [0.2, 0.8, 0.2]) {
      applyAnimatedEntityPose(
        group,
        result.scene.entities[0],
        result.scene,
        after.duration * progress,
      );
      points.push(
        group.userData.bones.hips.getWorldPosition(new T.Vector3()).toArray(),
      );
    }
    expect(
      new T.Vector3(...points[2]).distanceTo(new T.Vector3(...points[0])),
    ).toBeLessThan(1e-7);
  },
);

it("rechecks a saved safe path when the destination moves or a new static obstacle blocks it", () => {
  const f = fixture();
  const firstScene = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 0] } },
  ]);
  const first = prepareAutomaticRoutes(firstScene, f.objects);
  expect(first.issues).toEqual([]);
  const firstClip = first.scene.entities[0].clips[0];
  const firstPath = allMotions(first.scene).find(
    (m) => m.id === firstClip.motionId,
  )!.path!;
  const midpoint =
    compilePath(firstPath).samples[
      Math.floor(compilePath(firstPath).samples.length / 2)
    ].point;
  const worldPoint = pathToWorld(midpoint, {
    position: [-3, 0, 0],
    heading: Math.PI / 2,
    scale: 1,
  });
  const blocked = applyCommands(first.scene, [
    { type: "update", id: "obstacle", changes: { position: worldPoint } },
  ]);
  const second = prepareAutomaticRoutes(blocked, f.objects);
  expect(second.issues).toEqual([]);
  expect(
    overlapsDuring(
      second.scene,
      f.objects,
      second.scene.entities[0].clips[0].duration,
    ),
  ).toEqual([]);
  expect(
    allMotions(second.scene).find((m) => m.id === firstClip.motionId)!.path,
  ).not.toEqual(firstPath);

  const relocated = applyCommands(second.scene, [
    { type: "update", id: "destination", changes: { position: [4, 0, -2] } },
  ]);
  const third = prepareAutomaticRoutes(relocated, f.objects);
  expect(third.issues).toEqual([]);
  const thirdPath = allMotions(third.scene).find(
    (m) => m.id === firstClip.motionId,
  )!.path!;
  expect(thirdPath.points.at(-1)).not.toEqual(firstPath.points.at(-1));
  expect(prepareAutomaticRoutes(third.scene, f.objects).scene).toBe(
    third.scene,
  );
});

/** World pose of the body at a timeline time: root, facing and both lower legs. */
function bodyPose(scene: Scene, objects: Map<string, T.Group>, time: number) {
  for (const entity of scene.entities)
    applyAnimatedEntityPose(objects.get(entity.id)!, entity, scene, time);
  const group = objects.get("actor")!;
  group.updateMatrixWorld(true);
  const bones = group.userData.bones as Record<string, T.Bone>;
  return {
    root: group.position.toArray(),
    heading: group.rotation.y,
    hips: bones.hips.getWorldPosition(new T.Vector3()).toArray(),
    leftFoot: bones.leftShin.getWorldPosition(new T.Vector3()).toArray(),
    rightFoot: bones.rightShin.getWorldPosition(new T.Vector3()).toArray(),
  };
}
const poseDistance = (
  a: ReturnType<typeof bodyPose>,
  b: ReturnType<typeof bodyPose>,
) =>
  Math.max(
    ...(["root", "hips", "leftFoot", "rightFoot"] as const).map((key) =>
      Math.hypot(...a[key].map((n, i) => n - b[key][i])),
    ),
    Math.abs(
      Math.atan2(
        Math.sin(a.heading - b.heading),
        Math.cos(a.heading - b.heading),
      ),
    ),
  );

it.each([
  [
    "an obstacle placed ahead",
    (scene: Scene) =>
      applyCommands(scene, [
        { type: "update", id: "obstacle", changes: { position: [1.4, 0, 0] } },
      ]),
    0.4,
  ],
  [
    "a moved destination",
    (scene: Scene) =>
      applyCommands(scene, [
        {
          type: "update",
          id: "destination",
          changes: { position: [3, 0, 2.5] },
        },
      ]),
    0.5,
  ],
])(
  "replans %s during playback without moving the body at the current time",
  (_label, edit, fraction) => {
    const f = fixture();
    const clip = f.scene.entities[0].clips[0];
    const at = clip.duration * fraction;
    const edited = edit(f.scene);
    // The defect: a plan rebuilt from the route start moves the body now.
    const rebuilt = prepareAutomaticRoutes(edited, f.objects);
    expect(rebuilt.issues).toEqual([]);
    const before = bodyPose(f.scene, f.objects, at);
    expect(
      poseDistance(before, bodyPose(rebuilt.scene, f.objects, at)),
    ).toBeGreaterThan(0.05);
    // Planning for the current time keeps the travelled prefix exactly.
    const result = prepareAutomaticRoutes(edited, f.objects, undefined, at);
    expect(result.issues).toEqual([]);
    const after = result.scene.entities[0].clips[0];
    const motion = allMotions(result.scene).find(
      (m) => m.id === after.motionId,
    )!;
    expect(after.id).toBe(clip.id);
    expect(after.navigation).toMatchObject(clip.navigation!);
    expect(motion.path!.points).not.toEqual(f.motion.path!.points);
    const kept = motion.path!.points.filter((point, i) =>
      f.motion.path!.points[i]?.every((n, axis) => n === point[axis]),
    ).length;
    expect(kept).toBeGreaterThanOrEqual(2);
    for (const time of [0, at * 0.25, at * 0.5, at * 0.9, at]) {
      expect(
        poseDistance(
          bodyPose(f.scene, f.objects, time),
          bodyPose(result.scene, f.objects, time),
        ),
        `time ${time}`,
      ).toBeLessThan(1e-9);
    }
    // Pace is unchanged: the same distance per second before and after.
    expect(after.duration / compilePath(motion.path!).length).toBeCloseTo(
      clip.duration / compilePath(f.motion.path!).length,
      9,
    );
    // The new remainder is verified like any other route and reaches the goal.
    expect(overlapsDuring(result.scene, f.objects, after.duration)).toEqual([]);
    const end = bodyPose(result.scene, f.objects, after.duration + 0.01);
    const destination = result.scene.entities.find(
      (e) => e.id === "destination",
    )!.position;
    expect(
      Math.hypot(end.root[0] - destination[0], end.root[2] - destination[2]),
    ).toBeLessThan(1.5);
    // Stable: replanning the result again at the same time changes nothing.
    expect(
      prepareAutomaticRoutes(result.scene, f.objects, undefined, at).scene,
    ).toBe(result.scene);
    expect(
      validateScene(JSON.parse(JSON.stringify(result.scene))).entities[0]
        .clips[0].navigation,
    ).toEqual(after.navigation);
  },
);

it.each([0.03, 0.06, 0.12, 0.86, 0.9, 0.97])(
  "keeps heading continuity when a replan lands inside the entry or arrival blend windows (at %s of the route)",
  (fraction) => {
    const f = fixture();
    const clip = f.scene.entities[0].clips[0];
    const at = clip.duration * fraction;
    const edited = applyCommands(f.scene, [
      {
        type: "update",
        id: "destination",
        changes: { position: [3, 0, 2.5] },
      },
    ]);
    const result = prepareAutomaticRoutes(edited, f.objects, undefined, at);
    expect(result.issues).toEqual([]);
    const after = result.scene.entities[0].clips[0];
    const motion = allMotions(result.scene).find(
      (m) => m.id === after.motionId,
    )!;
    expect(motion.path!.points).not.toEqual(f.motion.path!.points);
    // Nothing already played moves, including the facing inside the first
    // and last blend windows of the original curve.
    for (const time of [0, at * 0.3, at * 0.7, at * 0.95, at]) {
      expect(
        poseDistance(
          bodyPose(f.scene, f.objects, time),
          bodyPose(result.scene, f.objects, time),
        ),
        `time ${time}`,
      ).toBeLessThan(1e-9);
    }
    // The facing keeps turning smoothly after the edit: no step larger than
    // a few degrees between consecutive frames.
    let previous = bodyPose(result.scene, f.objects, at).heading;
    for (let time = at + 1 / 60; time <= after.duration; time += 1 / 60) {
      const heading = bodyPose(result.scene, f.objects, time).heading;
      const step = Math.abs(
        Math.atan2(Math.sin(heading - previous), Math.cos(heading - previous)),
      );
      expect(step, `heading step at ${time}`).toBeLessThan(0.08);
      previous = heading;
    }
    expect(overlapsDuring(result.scene, f.objects, after.duration)).toEqual([]);
  },
);

it("applies only the newest plan when edits arrive while an earlier job is still running", async () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const first = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [1.4, 0, 0] } },
  ]);
  const second = applyCommands(first, [
    { type: "update", id: "obstacle", changes: { position: [1.4, 0, 0.6] } },
  ]);
  const controller = new AbortController();
  const stale = prepareAutomaticRoutesAsync(first, f.objects, undefined, {
    signal: controller.signal,
    at: clip.duration * 0.4,
    onYield: () => controller.abort(),
  });
  await expect(stale).rejects.toThrow();
  const at = clip.duration * 0.55;
  const expected = prepareAutomaticRoutes(second, f.objects, undefined, at);
  const actual = await prepareAutomaticRoutesAsync(
    second,
    f.objects,
    undefined,
    {
      at,
    },
  );
  expect(actual).toEqual(expected);
  expect(actual.issues).toEqual([]);
  expect(
    poseDistance(
      bodyPose(f.scene, f.objects, at),
      bodyPose(actual.scene, f.objects, at),
    ),
  ).toBeLessThan(1e-9);
});

function enclose(f: ReturnType<typeof fixture>, open = false) {
  // Round tables around the destination crate: every stopping place lies
  // inside their expanded footprints until the west table is taken away.
  const walls: [string, [number, number, number]][] = [
    ["wall-n", [3, 0, 1.6]],
    ["wall-s", [3, 0, -1.6]],
    ["wall-e", [4.6, 0, 0]],
    ["wall-w", [1.4, 0, 0]],
  ];
  let scene = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 4] } },
    ...walls.map(([id, position]) => ({
      type: "add" as const,
      assetId: "table",
      id,
      position,
    })),
  ]);
  for (const [id] of walls)
    if (!f.objects.has(id)) f.objects.set(id, createProp("table", "#997744"));
  if (open)
    scene = applyCommands(scene, [
      { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
    ]);
  return scene;
}

it("stops where it is when its route is blocked while playing, holds there as the timeline advances, and continues once a passage opens", () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const at = clip.duration * 0.45;
  const blocked = enclose(f);
  const result = prepareAutomaticRoutes(blocked, f.objects, undefined, at);
  expect(result.issues).toHaveLength(1);
  expect(result.issues[0].message).toContain("stopped before a blocked route");
  // The saved sequence records the stop; the destination intent survives.
  const stoppedClip = result.scene.entities[0].clips[0];
  expect(stoppedClip.id).toBe(clip.id);
  expect(stoppedClip.navigation).toMatchObject(clip.navigation!);
  expect(stoppedClip.routeStop).toBeCloseTo(at, 9);
  expect(
    validateScene(JSON.parse(JSON.stringify(result.scene))).entities[0].clips[0]
      .routeStop,
  ).toBeCloseTo(at, 9);
  // Playback holds the pose of the stop time: no snap back to the start and
  // no further travel, however far the timeline runs.
  const held = bodyPose(result.playbackScene, f.objects, at);
  const original = bodyPose(f.scene, f.objects, at - 1e-7);
  expect(poseDistance(held, original)).toBeLessThan(1e-9);
  for (const time of [at, at + 0.5, clip.duration, clip.duration + 5, 30])
    expect(
      poseDistance(bodyPose(result.playbackScene, f.objects, time), held),
      `held at ${time}`,
    ).toBeLessThan(1e-6);
  expect(overlapsDuring(result.playbackScene, f.objects, 30)).toEqual([]);
  // Planning again later while still blocked keeps the same stop.
  const later = prepareAutomaticRoutes(
    result.scene,
    f.objects,
    undefined,
    clip.duration + 3,
  );
  expect(later.issues).toHaveLength(1);
  expect(later.scene.entities[0].clips[0].routeStop).toBeCloseTo(at, 9);
  expect(
    poseDistance(
      bodyPose(later.playbackScene, f.objects, clip.duration + 3),
      held,
    ),
  ).toBeLessThan(1e-6);
  // The passage opens after the original clip would have ended.
  const resumeAt = clip.duration + 4;
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
  expect(clips).toHaveLength(2);
  expect(clips[0].id).toBe(clip.id);
  expect(clips[0].navigation).toBeUndefined();
  expect(clips[0].routeStop).toBeCloseTo(at, 9);
  expect(clips[0].duration).toBeCloseTo(resumeAt, 9);
  expect(clips[1].navigation).toMatchObject(clip.navigation!);
  expect(clips[1].transition).toBe("smooth");
  // Already-played motion and the wait are unchanged; the continuation starts
  // from the held body and reaches the destination.
  for (const time of [0, at * 0.5, at - 1e-4])
    expect(
      poseDistance(
        bodyPose(resumed.scene, f.objects, time),
        bodyPose(f.scene, f.objects, time),
      ),
      `time ${time}`,
    ).toBeLessThan(1e-9);
  for (const time of [at + 0.1, clip.duration + 2, resumeAt - 1e-4])
    expect(
      poseDistance(bodyPose(resumed.scene, f.objects, time), held),
      `held ${time}`,
    ).toBeLessThan(1e-6);
  const start = bodyPose(resumed.scene, f.objects, resumeAt + 1e-3);
  expect(
    Math.hypot(start.root[0] - held.root[0], start.root[2] - held.root[2]),
  ).toBeLessThan(0.01);
  const total = clips[0].duration + clips[1].duration;
  const end = bodyPose(resumed.scene, f.objects, total + 0.01);
  const destination = resumed.scene.entities.find(
    (e) => e.id === "destination",
  )!.position;
  expect(
    Math.hypot(end.root[0] - destination[0], end.root[2] - destination[2]),
  ).toBeLessThan(1.5);
  expect(overlapsDuring(resumed.scene, f.objects, total)).toEqual([]);
  // Stable afterwards.
  expect(
    prepareAutomaticRoutes(resumed.scene, f.objects, undefined, resumeAt + 1)
      .scene,
  ).toBe(resumed.scene);
});

it.each([60.1, 125.25])(
  "recovers a frozen studio route after a %s second wait without replaying travel",
  (resumeAt) => {
    const f = fixture();
    const clip = f.scene.entities[0].clips[0];
    const at = clip.duration * 0.45;
    const blocked = prepareAutomaticRoutes(
      enclose(f),
      f.objects,
      undefined,
      at,
    );
    const held = bodyPose(blocked.playbackScene, f.objects, at);
    const opened = applyCommands(blocked.scene, [
      { type: "update", id: "wall-w", changes: { position: [1.7, 0, 4] } },
    ]);
    const resumed = prepareAutomaticRoutes(
      opened,
      f.objects,
      undefined,
      resumeAt,
    );
    expect(resumed.issues).toEqual([]);
    const scene = validateScene(JSON.parse(JSON.stringify(resumed.scene)));
    const clips = scene.entities[0].clips;
    expect(clips.every((c) => c.duration >= 0.2 && c.duration <= 60)).toBe(
      true,
    );
    expect(
      clips.slice(0, -1).reduce((sum, c) => sum + c.duration, 0),
    ).toBeCloseTo(resumeAt, 9);
    expect(clips.at(-1)?.navigation).toMatchObject(clip.navigation!);
    for (const time of [0, at / 2, at - 0.01])
      expect(
        poseDistance(
          bodyPose(scene, f.objects, time),
          bodyPose(f.scene, f.objects, time),
        ),
      ).toBeLessThan(1e-9);
    for (const time of [at + 0.1, 59.9, 60, 60.01, resumeAt - 1e-5].filter(
      (t) => t < resumeAt,
    ))
      expect(
        poseDistance(bodyPose(scene, f.objects, time), held),
        `hold at ${time}`,
      ).toBeLessThan(1e-6);
    const restart = bodyPose(scene, f.objects, resumeAt + 0.001);
    // The route guide hands its vertical bob over to the body at the join;
    // compare the visible joints and horizontal position, not guide height.
    for (const key of ["hips", "leftFoot", "rightFoot"] as const)
      expect(
        Math.hypot(...restart[key].map((n, i) => n - held[key][i])),
      ).toBeLessThan(0.01);
    expect(
      Math.hypot(
        restart.root[0] - held.root[0],
        restart.root[2] - held.root[2],
      ),
    ).toBeLessThan(0.01);
    const total = clips.reduce((sum, c) => sum + c.duration, 0);
    const end = bodyPose(scene, f.objects, total + 0.01);
    expect(Math.hypot(end.root[0] - 3, end.root[2])).toBeLessThan(1.5);
    expect(
      prepareAutomaticRoutes(scene, f.objects, undefined, resumeAt + 1).issues,
    ).toEqual([]);
    const removed = applyCommands(scene, [
      { type: "removeClip", id: "actor", clipId: clip.id },
    ]);
    expect(removed.entities[0].clips).toHaveLength(1);
    expect(removed.entities[0].clips[0].id).toBe(clips.at(-1)!.id);
    const reordered = applyCommands(scene, [
      { type: "reorderClip", id: "actor", clipId: clip.id, direction: "later" },
    ]);
    expect(reordered.entities[0].clips.map((c) => c.id)).toEqual([
      clips.at(-1)!.id,
      ...clips.slice(0, -1).map((c) => c.id),
    ]);
    expect(
      applyCommands(reordered, [
        {
          type: "reorderClip",
          id: "actor",
          clipId: clips[1].id,
          direction: "earlier",
        },
      ]).entities[0].clips,
    ).toEqual(clips);
    const invalid = structuredClone(scene);
    invalid.entities[0].clips[1].routeWait = "missing-stop";
    expect(() => validateScene(invalid)).toThrow("earlier stopped clip");
    // Editing a stopped path preserves the recorded wait, including when a
    // second actor forces the editor to fork the shared motion definition.
    const shared = structuredClone(scene);
    shared.entities.push({
      ...shared.entities[0],
      id: "second-actor",
      clips: [{ ...clips[0], id: "second-route" }],
    });
    const route = allMotions(shared).find((m) => m.id === clips[0].motionId)!;
    const edited = applyCommands(
      shared,
      savePathCommands(
        shared,
        "actor",
        { ...route, duration: clips[0].routeActive! + 0.3 },
        clip.id,
      ),
    );
    const changed = edited.entities[0].clips;
    expect(changed[0].motionId).not.toBe(clips[0].motionId);
    expect(changed[0].duration).toBe(clips[0].duration);
    expect(
      changed
        .slice(1, -1)
        .every(
          (c) => c.motionId === changed[0].motionId && c.routeWait === clip.id,
        ),
    ).toBe(true);
    expect(edited.entities.at(-1)!.clips[0].motionId).toBe(clips[0].motionId);
  },
);

it("continues a stopped route at its scheduled end when the passage opens earlier", () => {
  const f = fixture();
  const clip = f.scene.entities[0].clips[0];
  const at = clip.duration * 0.45;
  const stopped = prepareAutomaticRoutes(enclose(f), f.objects, undefined, at);
  expect(stopped.issues).toHaveLength(1);
  const held = bodyPose(stopped.playbackScene, f.objects, at);
  const opened = applyCommands(stopped.scene, [
    { type: "update", id: "wall-w", changes: { position: [1.4, 0, 4] } },
  ]);
  const resumed = prepareAutomaticRoutes(
    opened,
    f.objects,
    undefined,
    at + 0.5,
  );
  expect(resumed.issues).toEqual([]);
  const clips = resumed.scene.entities[0].clips;
  expect(clips).toHaveLength(2);
  // The prefix keeps its distance-time mapping, so it cannot end before its
  // scheduled end; the body waits there and continues from that moment.
  expect(clips[0].duration).toBeCloseTo(clip.duration, 9);
  expect(clips[0].routeHold).toBeUndefined();
  expect(clips[0].routeStop).toBeCloseTo(at, 9);
  for (const time of [at + 0.1, clip.duration - 1e-4])
    expect(
      poseDistance(bodyPose(resumed.scene, f.objects, time), held),
      `held ${time}`,
    ).toBeLessThan(1e-6);
  const start = bodyPose(resumed.scene, f.objects, clip.duration + 1e-3);
  expect(
    Math.hypot(start.root[0] - held.root[0], start.root[2] - held.root[2]),
  ).toBeLessThan(0.01);
  expect(
    overlapsDuring(
      resumed.scene,
      f.objects,
      clips[0].duration + clips[1].duration,
    ),
  ).toEqual([]);
});

it("does not let a width learned for one obstacle inflate later routes once it is gone", () => {
  const f = fixture();
  const blocked = applyCommands(f.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 0] } },
  ]);
  const detour = prepareAutomaticRoutes(blocked, f.objects);
  expect(detour.issues).toEqual([]);
  const widened = detour.scene.entities[0].clips[0].navigation!.clearance!;
  expect(widened).toBeGreaterThan(0);
  // The obstacle leaves and the destination moves: a fresh plan is needed.
  const cleared = applyCommands(detour.scene, [
    { type: "update", id: "obstacle", changes: { position: [0, 0, 4] } },
    { type: "update", id: "destination", changes: { position: [3, 0, 0.6] } },
  ]);
  const result = prepareAutomaticRoutes(cleared, f.objects);
  expect(result.issues).toEqual([]);
  const clip = result.scene.entities[0].clips[0];
  expect(clip.navigation!.clearance ?? 0).toBeLessThan(widened);
  const motion = allMotions(result.scene).find((m) => m.id === clip.motionId)!;
  // Nearly the straight line to the moved destination's stopping place.
  expect(compilePath(motion.path!).length).toBeLessThan(6.2);
  expect(overlapsDuring(result.scene, f.objects, clip.duration)).toEqual([]);
  // The saved route itself still carries what it had to widen to.
  expect(
    validateScene(JSON.parse(JSON.stringify(detour.scene))).entities[0].clips[0]
      .navigation!.clearance,
  ).toBe(widened);
});
