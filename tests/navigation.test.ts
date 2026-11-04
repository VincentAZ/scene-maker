import { it, expect } from "vitest";
import * as T from "three";
import fs from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  findRoute,
  clearSegment,
  crosses,
  type Footprint,
} from "../shared/navigation";
import {
  allAssets,
  allMotions,
  starterScene,
  applyCommands,
  type Motion,
  type Scene,
} from "../shared/scene";
import { compilePath, pathToWorld, samplePath } from "../shared/path";
import {
  assertObjectArrivalAvailable,
  planObjectRoute,
  routeContext,
} from "../src/routePlanner";
import {
  applyAnimatedEntityPose,
  createCharacter,
  createProp,
  disposeObject,
} from "../src/world";
import { prepareImportedAsset } from "../src/importedAsset";
import { applyInteractions } from "../src/interactions";
import { prepareAutomaticRoutes } from "../src/automaticRoutes";
import { offlinePlan } from "../server/ai";
import { validatePlan } from "../shared/studio";
import { runStudioPlan, StudioPlanError } from "../src/studioRunner";
import { libraryCharacters } from "../shared/characterLibrary";
import { capturedRouteGaits, roleMotion } from "../shared/motionLibrary";
import { measureNativeTravel } from "../src/nativeTravel";
import { importedClip, motionSource } from "../src/rig";
import {
  locomotionProfile,
  locomotionScale,
  routeEntryHeading,
} from "../src/locomotion";
import type { RouteGaitCycle } from "../src/routeLocomotion";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

/** Routes travel on the recorded stride at the pace measured from its take on
 * the receiving body, as automatic replanning measures it. */
const stride = capturedRouteGaits[0];
function measuredCycle(rig: T.Group, gait: Motion = stride): RouteGaitCycle {
  const source = motionSource(rig, gait.sourceAssetId!)!;
  const take = importedClip(source.userData.animations, gait.animationName!)!;
  const profile = locomotionProfile(source, take, gait.path!.sourceRange)!;
  const ratio = locomotionScale(source, rig);
  return {
    duration: profile.duration,
    entryHeading: routeEntryHeading(profile),
    distance: profile.distance * ratio,
    samples: profile.frames.map((frame) => ({
      time: frame.time,
      distance: frame.distance * ratio,
    })),
  };
}

const rect = (
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): Footprint => ({ id: "box", name: "Crate", minX, maxX, minZ, maxZ });
it("routes around overlapping footprints, permits tangency, and rejects blocked starts and enclosed destinations", () => {
  const boxes = [rect(-1, 1, -1, 1), rect(0.5, 1.5, -0.5, 1.5)];
  const route = findRoute([-3, 0, 0], [[3, 0, 0]], boxes);
  expect(route.length).toBeGreaterThan(2);
  route
    .slice(1)
    .forEach((p, i) => expect(clearSegment(route[i], p, boxes)).toBe(true));
  expect(crosses([-2, 0, 1], [2, 0, 1], boxes[0])).toBe(false);
  expect(crosses([-2, 0, 0.99], [2, 0, 0.99], boxes[0])).toBe(true);
  expect(() => findRoute([0, 0, 0], [[3, 0, 0]], boxes)).toThrow(
    "clear of Crate",
  );
  expect(() => findRoute([-3, 0, 0], [[0, 0, 0]], boxes)).toThrow(
    "stopping place",
  );
  expect(() =>
    findRoute(
      [-4, 0, 0],
      [[0, 0, 0]],
      [
        rect(-2, -1, -2, 2),
        rect(1, 2, -2, 2),
        rect(-2, 2, -2, -1),
        rect(-2, 2, 1, 2),
      ],
    ),
  ).toThrow("No clear route");
});
function fixture(assetId = "mila") {
  return applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId, id: "actor", position: [-3, 0, -2] },
    { type: "add", assetId: "crate", id: "obstacle", position: [0, 0, 0] },
    { type: "update", id: "obstacle", changes: { scale: 1.5, rotation: 0.4 } },
    { type: "add", assetId: "cup", id: "destination", position: [3, 0.985, 0] },
    { type: "chain", id: "actor", motionId: "walk", duration: 2 },
  ]);
}
it("allows only the arriving actor's acquisition boundary, not existing ownership or another actor's pickup", () => {
  const scene = applyCommands(fixture(), [
    { type: "chain", id: "actor", motionId: "pick", targetId: "destination" },
    { type: "chain", id: "actor", motionId: "place", targetId: "destination" },
  ]);
  expect(() =>
    assertObjectArrivalAvailable(scene, "destination", 2, "actor"),
  ).not.toThrow();
  for (const [time, actorId] of [
    [2, "other"],
    [2, undefined],
    [2.00001, "actor"],
  ] as const)
    expect(() =>
      assertObjectArrivalAvailable(scene, "destination", time, actorId),
    ).toThrow("before this character arrives");
  const released = scene.entities[0].clips.reduce(
    (sum, clip) => sum + clip.duration,
    0,
  );
  expect(() =>
    assertObjectArrivalAvailable(scene, "destination", released, "other"),
  ).not.toThrow();
});

it("replans an approach followed by pickup using the proposed arrival schedule without changing the saved scene", async () => {
  let scene = fixture();
  const objects = await objectsFor(scene);
  try {
    const cycle = measuredCycle(objects.get("actor")!);
    const route = planObjectRoute(
      scene,
      objects,
      "actor",
      "destination",
      "walk",
      undefined,
      undefined,
      stride,
      cycle,
    );
    scene = applyCommands(scene, [
      { type: "createMotion", motion: route },
      { type: "chain", id: "actor", motionId: route.id },
      { type: "chain", id: "actor", motionId: "pick", targetId: "destination" },
    ]);
    const clip = scene.entities[0].clips[1],
      before = structuredClone(scene);
    for (const durationScale of [1, 2, 0.5]) {
      const planned = planObjectRoute(
        scene,
        objects,
        "actor",
        "destination",
        "walk",
        clip.id,
        undefined,
        route,
        cycle,
        0,
        {
          movingIds: new Set(),
          conflicts: [],
          durationScale,
          existingPath: route.path,
        },
      );
      expect(planned.duration).toBeGreaterThan(0);
      if (durationScale === 2)
        expect(planned.duration).toBeGreaterThan(clip.duration);
      if (durationScale === 0.5)
        expect(planned.duration).toBeLessThan(clip.duration);
      expect(scene).toEqual(before);
    }
    clip.navigation = { targetId: "destination", movement: "walk" };
    const prepared = prepareAutomaticRoutes(scene, objects);
    // The cup sits outside the actual body regions. A whole-skin bounding box
    // used to fill the space between limbs and incorrectly reject this route.
    expect(prepared.issues).toEqual([]);
    expect(prepared.scene.entities[0].clips.at(-1)?.motionId).toBe("pick");
    expect(
      prepared.playbackScene.entities[0].clips.map((c) => c.motionId),
    ).toEqual(["walk", prepared.scene.entities[0].clips[1].motionId, "pick"]);
  } finally {
    for (const object of objects.values()) disposeObject(object);
  }
});
async function objectsFor(scene: Scene) {
  const objects = new Map<string, T.Group>();
  for (const e of scene.entities) {
    const a = allAssets(scene).find((a) => a.id === e.assetId)!;
    let object: T.Group;
    if (a.url) {
      const bytes = await fs.readFile("public" + a.url);
      object = prepareImportedAsset(
        a,
        await new GLTFLoader().parseAsync(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          "",
        ),
      );
      if (a.category === "characters")
        withRecordedSources(object, recordedSourceMap);
    } else
      object =
        a.category === "characters"
          ? withRecordedSources(createCharacter(a, e.color), recordedSourceMap)
          : createProp(a.style, e.color, a.parts, a.ladder);
    objects.set(e.id, object);
  }
  return objects;
}
it("plans from the preceding action endpoint around measured geometry and reaches a cup on procedural and bundled rigs", async () => {
  for (const assetId of ["mila", ...libraryCharacters.map((a) => a.id)]) {
    let scene = fixture(assetId);
    const original = JSON.stringify(scene),
      objects = await objectsFor(scene);
    const context = routeContext(scene, objects, "actor");
    // The route starts where the preceding recorded walk's own root travel
    // ends on this body, facing as that take finishes.
    const rig = objects.get("actor")!,
      walk = roleMotion("walk"),
      source = motionSource(rig, walk.sourceAssetId!)!;
    const travel = measureNativeTravel(
      source,
      rig,
      importedClip(source.userData.animations, walk.animationName!)!,
      scene.entities[0].clips[0],
    )!;
    expect(travel.destination.z, assetId).toBeGreaterThan(1);
    expect(context.frame.position[0], assetId).toBeCloseTo(
      -3 + travel.destination.x,
      6,
    );
    expect(context.frame.position[2], assetId).toBeCloseTo(
      -2 + travel.destination.z,
      6,
    );
    expect(context.frame.heading, assetId).toBeCloseTo(travel.endHeading, 6);
    const motion = planObjectRoute(
      scene,
      objects,
      "actor",
      "destination",
      "walk",
      undefined,
      undefined,
      stride,
      measuredCycle(rig),
    );
    expect(JSON.stringify(scene)).toBe(original);
    expect(motion.path!.points.length).toBeGreaterThan(2);
    const clearance = context.radius + 0.04;
    const expanded = context.footprints.map((p) => ({
      ...p,
      minX: p.minX - clearance,
      maxX: p.maxX + clearance,
      minZ: p.minZ - clearance,
      maxZ: p.maxZ + clearance,
    }));
    const samples = compilePath(motion.path!).samples.map((s) =>
      pathToWorld(s.point, context.frame),
    );
    samples
      .slice(1)
      .forEach((p, i) =>
        expect(clearSegment(samples[i], p, expanded), assetId).toBe(true),
      );
    scene = applyCommands(scene, [
      { type: "createMotion", motion },
      { type: "chain", id: "actor", motionId: motion.id },
      ...(["pick", "sip", "place"] as const).map((motionId) => ({
        type: "chain" as const,
        id: "actor",
        motionId,
        targetId: "destination",
      })),
    ]);
    const actor = scene.entities[0],
      prop = objects.get("destination")!;
    const sample = (time: number) => {
      for (const e of scene.entities)
        applyAnimatedEntityPose(objects.get(e.id)!, e, scene, time);
      expect(
        applyInteractions(scene, time, objects),
        `${assetId} at ${time}`,
      ).toEqual([]);
    };
    // The planned route ends exactly facing the cup.
    const end = samplePath(motion.path!, 1),
      endPoint = pathToWorld(end.point, context.frame),
      endHeading = context.frame.heading + end.heading;
    expect(
      new T.Vector3(Math.sin(endHeading), 0, Math.cos(endHeading)).dot(
        new T.Vector3(3.13 - endPoint[0], 0, -endPoint[2]).normalize(),
      ),
      assetId,
    ).toBeGreaterThan(0.99999);
    const arrival = 2 + motion.duration;
    sample(arrival);
    const facing = new T.Vector3(0, 0, 1).applyQuaternion(rig.quaternion);
    const toCup = new T.Vector3(3.13, rig.position.y, 0)
      .sub(rig.position)
      .normalize();
    // The body itself is recorded: the stride and Pick up keep the
    // performer's natural hip yaw around that direction (a few degrees,
    // varying with the receiving body), which the old formula body lacked.
    expect(facing.dot(toCup), assetId).toBeGreaterThan(Math.cos(Math.PI / 36));
    // The recorded takes set their own timing: the hand meets the grip at
    // the pick contact (40% through Pick up), and the cup is home again once
    // Put down has finished.
    const [pick, sip, place] = actor.clips.slice(2).map((c) => c.duration);
    const contact = arrival + pick * 0.4,
      returned = arrival + pick + sip + place;
    sample(contact);
    const hand = rig.userData.bones.rightForearm.localToWorld(
      rig.userData.contacts.hand.clone(),
    );
    expect(
      hand.distanceTo(prop.localToWorld(new T.Vector3(0.13, 0.08, 0))),
      assetId,
    ).toBeLessThan(0.0001);
    const lifted = prop.position.clone();
    for (const t of [
      arrival + pick + sip / 2,
      returned - place / 2,
      0,
      contact,
    ])
      sample(t);
    expect(prop.position.distanceTo(lifted)).toBeLessThan(1e-6);
    sample(returned + 0.5);
    expect(prop.position.distanceTo(new T.Vector3(3, 0.985, 0))).toBeLessThan(
      1e-5,
    );
    for (const object of objects.values()) disposeObject(object);
  }
});
it("finds a reachable side of a cup on a real table without crossing the support footprint", async () => {
  let scene = fixture();
  scene = applyCommands(scene, [
    { type: "add", assetId: "table", id: "support", position: [3, 0, 0] },
    {
      type: "update",
      id: "destination",
      changes: { position: [3.5, 0.985, 0] },
    },
  ]);
  const objects = await objectsFor(scene),
    frame = routeContext(scene, objects, "actor").frame;
  const motion = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "walk",
    undefined,
    undefined,
    stride,
    measuredCycle(objects.get("actor")!),
  );
  scene = applyCommands(scene, [
    { type: "createMotion", motion },
    { type: "chain", id: "actor", motionId: motion.id },
    { type: "chain", id: "actor", motionId: "sip", targetId: "destination" },
  ]);
  const table = new T.Box3().setFromObject(objects.get("support")!, true);
  for (const s of compilePath(motion.path!).samples) {
    const p = pathToWorld(s.point, frame);
    expect(
      p[0] < table.min.x - 0.28 ||
        p[0] > table.max.x + 0.28 ||
        p[2] < table.min.z - 0.28 ||
        p[2] > table.max.z + 0.28,
    ).toBe(true);
  }
  // Halfway through the recorded Take a sip the cup is raised to the mouth.
  const time =
    2 + motion.duration + scene.entities[0].clips.at(-1)!.duration / 2;
  for (const e of scene.entities)
    applyAnimatedEntityPose(objects.get(e.id)!, e, scene, time);
  expect(applyInteractions(scene, time, objects)).toEqual([]);
  const rig = objects.get("actor")!,
    cup = objects.get("destination")!;
  const mouth = rig.userData.bones.head.localToWorld(
    new T.Vector3(0, -0.035, 0.12),
  );
  expect(cup.position.y).toBeGreaterThan(1.2);
  expect(mouth.y).toBeGreaterThan(1.2);
  for (const object of objects.values()) disposeObject(object);
});
it("handles scaled and rotated actors, high or occupied props, and still-destination validation", async () => {
  let scene = fixture();
  scene.entities[0].rotation = Math.PI / 2;
  scene.entities[0].scale = 1.3;
  scene.entities[0].position = [-6, 0, -2];
  const objects = await objectsFor(scene);
  const running = capturedRouteGaits[1];
  const route = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "run",
    undefined,
    undefined,
    running,
    measuredCycle(objects.get("actor")!, running),
  );
  expect(route).toMatchObject({
    kind: "imported",
    animationName: running.animationName,
    path: { sourceRange: running.path!.sourceRange },
  });
  for (const n of samplePath(route.path!, 0).point)
    expect(n).toBeCloseTo(0, 12);
  scene.entities.find((e) => e.id === "destination")!.position[1] = 8;
  expect(() =>
    planObjectRoute(scene, objects, "actor", "destination", "walk"),
  ).toThrow("floor height");
  scene.entities.find((e) => e.id === "destination")!.clips = [
    { id: "moving", motionId: "walk", duration: 2 },
  ];
  expect(() =>
    planObjectRoute(scene, objects, "actor", "destination", "walk"),
  ).toThrow("still destination");
  const destination = scene.entities.find((e) => e.id === "destination")!;
  destination.clips = [];
  destination.position[1] = 0.985;
  scene = applyCommands(scene, [
    { type: "add", assetId: "leo", id: "holder", position: [8, 0, 0] },
    { type: "chain", id: "holder", motionId: "pick", targetId: "destination" },
  ]);
  objects.set(
    "holder",
    withRecordedSources(
      createCharacter(allAssets(scene).find((a) => a.id === "leo")!),
      recordedSourceMap,
    ),
  );
  expect(() =>
    planObjectRoute(scene, objects, "actor", "destination", "walk"),
  ).toThrow("before this character arrives");
  for (const object of objects.values()) disposeObject(object);
});
it("routes offline requests to the named destination and stops workflows after a planner failure", async () => {
  let scene = fixture();
  const plan = offlinePlan(
    scene,
    "Mila walk to Coffee cup then pick up then sip then put down",
    undefined,
    {},
  );
  expect(plan.steps[0]).toEqual({
    type: "walkTo",
    actorId: "actor",
    targetId: "destination",
    movement: "walk",
  });
  const edit = plan.steps[1];
  expect(edit.type).toBe("edit");
  if (edit.type === "edit")
    expect(
      edit.commands.map((c) => c.type === "chain" && [c.motionId, c.targetId]),
    ).toEqual([
      ["pick", "destination"],
      ["sip", "destination"],
      ["place", "destination"],
    ]);
  expect(() => validatePlan(plan, scene, () => scene)).not.toThrow();
  const twoCups = applyCommands(scene, [
    {
      type: "add",
      assetId: "cup",
      id: "second-cup",
      name: "Tea",
      position: [3, 0.985, 1],
    },
  ]);
  for (const request of [
    "Mila walk to Tea then pick up then sip then put down",
    "Mila walk to Wooden crate then pick up Tea then sip then put down",
  ]) {
    const directed = offlinePlan(twoCups, request, undefined, {});
    const actions = directed.steps[1];
    expect(actions?.type).toBe("edit");
    if (actions.type === "edit")
      expect(
        actions.commands.map((c) => c.type === "chain" && c.targetId),
      ).toEqual(["second-cup", "second-cup", "second-cup"]);
  }
  expect(() =>
    validatePlan(
      {
        ...plan,
        steps: [
          {
            type: "walkTo",
            actorId: "obstacle",
            targetId: "destination",
            movement: "walk",
          },
        ],
      },
      scene,
      () => scene,
    ),
  ).toThrow("visible character");
  const calls: string[] = [];
  await expect(
    runStudioPlan(
      { ...plan, mode: "offline", reads: {} },
      {
        getScene: () => scene,
        save: async () => {},
        read: async () => scene,
        load: () => {},
        edit: () => {
          calls.push("edit");
        },
        perform: async () => {
          throw Error("No clear route");
        },
      },
    ),
  ).rejects.toBeInstanceOf(StudioPlanError);
  expect(calls).toEqual([]);
  const objects = await objectsFor(scene);
  await runStudioPlan(
    { ...plan, mode: "offline", reads: {} },
    {
      getScene: () => scene,
      save: async () => {},
      read: async () => scene,
      load: () => {},
      edit: (commands) => {
        scene = applyCommands(scene, commands);
      },
      perform: async (step) => {
        if (step.type === "walkTo") {
          const motion = planObjectRoute(
            scene,
            objects,
            step.actorId,
            step.targetId,
            step.movement,
            undefined,
            undefined,
            stride,
            measuredCycle(objects.get(step.actorId)!),
          );
          scene = applyCommands(scene, [
            { type: "createMotion", motion },
            { type: "chain", id: step.actorId, motionId: motion.id },
          ]);
        }
      },
    },
  );
  // The studio Walk, then the planned route on the recorded stride, then the
  // recorded interactions.
  expect(
    scene.entities[0].clips.map((c) => {
      const motion = allMotions(scene).find((m) => m.id === c.motionId)!;
      return motion.path ? motion.animationName : motion.role;
    }),
  ).toEqual(["walk", stride.animationName, "pick", "sip", "place"]);
  for (const object of objects.values()) disposeObject(object);
});

it("includes low loaded props and backdrop obstacles while excluding the level floor", async () => {
  const scene = applyCommands(fixture(), [
    { type: "add", assetId: "crate", id: "low", position: [0, 0, 0] },
    { type: "update", id: "low", changes: { scale: 0.1 } },
  ]);
  const objects = await objectsFor(scene);
  const environment = new T.Group();
  const floor = new T.Mesh(new T.BoxGeometry(30, 0.1, 30));
  floor.position.y = -0.05;
  const curb = new T.Mesh(new T.BoxGeometry(0.2, 0.03, 1));
  curb.position.set(1, 0.015, 1);
  environment.add(floor, curb);
  const context = routeContext(scene, objects, "actor", undefined, environment);
  expect(context.footprints.some((p) => p.id === "low")).toBe(true);
  expect(
    context.footprints.filter((p) => p.name === "the backdrop"),
  ).toHaveLength(1);
  for (const object of objects.values()) disposeObject(object);
  disposeObject(environment);
});

it("plans around backdrop walls while excluding floor meshes from route footprints", async () => {
  const scene = fixture();
  const objects = await objectsFor(scene);
  const environment = new T.Group();
  const floor = new T.Mesh(new T.BoxGeometry(30, 0.1, 30));
  floor.position.y = -0.05;
  const wall = new T.Mesh(new T.BoxGeometry(0.3, 3, 5));
  wall.position.y = 1.5;
  environment.add(floor, wall);
  const original = JSON.stringify(scene);
  const before = routeContext(scene, objects, "actor");
  const context = routeContext(scene, objects, "actor", undefined, environment);
  const backdropFootprints = context.footprints.filter(
    (p) => p.name === "the backdrop",
  );
  expect(backdropFootprints).toHaveLength(1);
  expect(context.footprints.length).toBe(before.footprints.length + 1);
  const motion = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "walk",
    undefined,
    environment,
    stride,
    measuredCycle(objects.get("actor")!),
  );
  const expanded = context.footprints.map((p) => ({
    ...p,
    minX: p.minX - context.radius - 0.04,
    maxX: p.maxX + context.radius + 0.04,
    minZ: p.minZ - context.radius - 0.04,
    maxZ: p.maxZ + context.radius + 0.04,
  }));
  const samples = compilePath(motion.path!).samples.map((s) =>
    pathToWorld(s.point, context.frame),
  );
  samples
    .slice(1)
    .forEach((point, index) =>
      expect(clearSegment(samples[index], point, expanded)).toBe(true),
    );
  expect(JSON.stringify(scene)).toBe(original);
  objects.forEach((object) => disposeObject(object));
  disposeObject(environment);
});

it("can plan geometry with an explicitly selected imported gait without losing its original identity", async () => {
  const scene = fixture();
  const objects = await objectsFor(scene);
  // A recorded walk other than the studio stride (the CMU casual walk).
  const original = allMotions(scene).find(
    (motion) => motion.id === "captured-141-19",
  )!;
  const motion = planObjectRoute(
    scene,
    objects,
    "actor",
    "destination",
    "walk",
    undefined,
    undefined,
    original,
    { distance: 1.5, duration: 1 },
  );
  expect(motion.duration).toBeCloseTo(
    compilePath(motion.path!).length / 1.5,
    12,
  );
  expect(motion).toMatchObject({
    kind: "imported",
    sourceAssetId: original.sourceAssetId,
    animationName: original.animationName,
    distance: 0,
    poses: [],
  });
  expect(motion.id).not.toBe(original.id);
  expect(motion.path!.points.length).toBeGreaterThan(1);
  expect(() =>
    applyCommands(scene, [
      { type: "createMotion", motion },
      { type: "chain", id: "actor", motionId: motion.id },
    ]),
  ).not.toThrow();
  for (const object of objects.values()) disposeObject(object);
});

it("lets a start within clearance of furniture step out of it when asked, never through anything else", () => {
  const clearance = [rect(-1, 1, -1, 1)];
  expect(() => findRoute([0.8, 0, 0], [[3, 0, 0]], clearance)).toThrow(
    "clear of Crate",
  );
  const route = findRoute([0.8, 0, 0], [[3, 0, 0]], clearance, true);
  expect(route[0]).toEqual([0.8, 0, 0]);
  expect(route.at(-1)).toEqual([3, 0, 0]);
  // Only the leg leaving the occupied footprint may cross it.
  route
    .slice(2)
    .forEach((p, i) =>
      expect(clearSegment(route[i + 1], p, clearance)).toBe(true),
    );
  // Another footprint between start and goal is still respected.
  const blocked = [rect(-1, 1, -1, 1), rect(1.5, 2.5, -1, 1)];
  const around = findRoute([0.8, 0, 0], [[3, 0, 0]], blocked, true);
  around
    .slice(1)
    .forEach((p, i) =>
      expect(clearSegment(around[i], p, [blocked[1]])).toBe(true),
    );
  expect(around.length).toBeGreaterThan(2);
});
