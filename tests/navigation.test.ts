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
  type Scene,
} from "../shared/scene";
import { compilePath, pathToWorld, samplePath } from "../shared/path";
import { planObjectRoute, routeContext } from "../src/routePlanner";
import {
  applyAnimatedEntityPose,
  createCharacter,
  createProp,
  disposeObject,
} from "../src/world";
import { prepareImportedAsset } from "../src/importedAsset";
import { applyInteractions } from "../src/interactions";
import { offlinePlan } from "../server/ai";
import { validatePlan } from "../shared/studio";
import { runStudioPlan, StudioPlanError } from "../src/studioRunner";
import { libraryCharacters } from "../shared/characterLibrary";

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
    } else
      object =
        a.category === "characters"
          ? createCharacter(a, e.color)
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
    expect(context.frame.position[2]).toBeCloseTo(0, 6);
    const motion = planObjectRoute(
      scene,
      objects,
      "actor",
      "destination",
      "walk",
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
      rig = objects.get("actor")!,
      prop = objects.get("destination")!;
    const sample = (time: number) => {
      for (const e of scene.entities)
        applyAnimatedEntityPose(objects.get(e.id)!, e, scene, time);
      expect(applyInteractions(scene, time, objects), assetId).toEqual([]);
    };
    const arrival = 2 + motion.duration;
    sample(arrival);
    const facing = new T.Vector3(0, 0, 1).applyQuaternion(rig.quaternion);
    const toCup = new T.Vector3(3.13, rig.position.y, 0)
      .sub(rig.position)
      .normalize();
    expect(facing.dot(toCup), assetId).toBeGreaterThan(0.99999);
    sample(arrival + 1);
    const hand = rig.userData.bones.rightForearm.localToWorld(
      rig.userData.contacts.hand.clone(),
    );
    expect(
      hand.distanceTo(prop.localToWorld(new T.Vector3(0.13, 0.08, 0))),
      assetId,
    ).toBeLessThan(0.0001);
    const lifted = prop.position.clone();
    for (const t of [arrival + 3, arrival + 6, 0, arrival + 1]) sample(t);
    expect(prop.position.distanceTo(lifted)).toBeLessThan(1e-6);
    sample(arrival + 7);
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
  const time = 2 + motion.duration + 1.5;
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
  const route = planObjectRoute(scene, objects, "actor", "destination", "run");
  expect(route.kind).toBe("run");
  expect(samplePath(route.path!, 0).point).toEqual([0, 0, 0]);
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
    createCharacter(allAssets(scene).find((a) => a.id === "leo")!),
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
          );
          scene = applyCommands(scene, [
            { type: "createMotion", motion },
            { type: "chain", id: step.actorId, motionId: motion.id },
          ]);
        }
      },
    },
  );
  expect(
    scene.entities[0].clips.map(
      (c) => allMotions(scene).find((m) => m.id === c.motionId)!.kind,
    ),
  ).toEqual(["walk", "walk", "pick", "sip", "place"]);
  for (const object of objects.values()) disposeObject(object);
});
