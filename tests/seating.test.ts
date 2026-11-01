import { it, expect } from "vitest";
import * as T from "three";
import fs from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  applyCommands,
  starterScene,
  allAssets,
  allMotions,
  validateScene,
  type Scene,
} from "../shared/scene";
import { planSeat, seatProfile, validateSeating } from "../shared/seating";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
  disposeObject,
} from "../src/world";
import { prepareImportedAsset } from "../src/importedAsset";
import { applyInteractions } from "../src/interactions";
import { offlineCommands } from "../server/ai";
import { libraryCharacters } from "../shared/characterLibrary";
import { appendSpeech } from "../shared/conversation";
import { actionPreview } from "../shared/actionPreview";

function fixture(assetId = "mila", seatId = "chair") {
  return applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId, id: "actor", position: [0, 0, 0.65] },
    { type: "add", assetId: seatId, id: "seat", position: [0, 0, 0] },
    {
      type: "chain",
      id: "actor",
      motionId: "sit",
      targetId: "seat",
      duration: 3,
    },
    { type: "chain", id: "actor", motionId: "talk", duration: 3 },
    { type: "chain", id: "actor", motionId: "wave", duration: 2 },
    { type: "chain", id: "actor", motionId: "stand", duration: 2 },
    { type: "chain", id: "actor", motionId: "walk", duration: 4 },
  ]);
}
async function rigFor(scene: Scene) {
  const asset = allAssets(scene).find(
    (a) => a.id === scene.entities[0].assetId,
  )!;
  if (!asset.url) return createCharacter(asset, asset.color);
  const data = await fs.readFile("public" + asset.url);
  return prepareImportedAsset(
    asset,
    await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    ),
  );
}
const world = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
it("keeps seated hip height and planted feet through gestures, then stands before walking, with stable reverse scrubbing", async () => {
  for (const id of ["mila", ...libraryCharacters.map((a) => a.id)]) {
    const scene = fixture(id, id === "mila" ? "chair" : "bench"),
      actor = scene.entities[0],
      seat = scene.entities[1],
      rig = await rigFor(scene);
    // Fit chair height to the actual body; short stylized bodies need a lower seat.
    applyAnimatedEntityPose(rig, actor, scene, 0);
    const body = rig.userData.seatBody;
    seat.scale = Math.min(1, body.lowerLength / 0.38);
    actor.scale = 1.2;
    seat.scale *= 1.2;
    actor.rotation = 0.7;
    seat.rotation = 0.7;
    seat.position = [2, 0, -1];
    actor.position = [
      2 + Math.sin(0.7) * 0.65 * 1.2,
      0,
      -1 + Math.cos(0.7) * 0.65 * 1.2,
    ];
    const seatAsset = allAssets(scene).find(
      (asset) => asset.id === seat.assetId,
    )!;
    for (let attempt = 0; attempt < 10; attempt++) {
      const plan = planSeat(
        actor.position,
        actor.rotation,
        actor,
        seat,
        seatAsset,
        true,
        body,
      );
      if (!plan.warning?.includes("feet can reach")) break;
      seat.scale *= 0.9;
    }
    let hip: T.Vector3 | undefined, feet: T.Vector3[] | undefined;
    for (const t of [3, 4, 6.7, 7.5, 5, 3, 8, 9, 14, 6.7]) {
      applyAnimatedEntityPose(rig, actor, scene, t);
      rig.updateMatrixWorld(true);
      expect(rig.userData.motionWarning, id + " " + t).toBeFalsy();
      if (t >= 3 && t <= 8) {
        expect(
          Math.abs(new T.Box3().setFromObject(rig, true).min.y),
          id + " shoe sole",
        ).toBeLessThan(0.001);
        const current = world(rig.userData.bones.hips);
        expect(current.y).toBeCloseTo(
          0.54 * seat.scale + body.padding * actor.scale,
          5,
        );
        const contacts = rig.userData.contacts;
        const currentFeet = ["left", "right"].map((side) =>
          rig.userData.bones[side + "Shin"].localToWorld(
            contacts[side + "Foot"].clone(),
          ),
        );
        if (!hip) {
          hip = current;
          feet = currentFeet;
        } else {
          expect(current.distanceTo(hip), id).toBeLessThan(1e-5);
          currentFeet.forEach((p, i) =>
            expect(p.distanceTo(feet![i]), id).toBeLessThan(1e-5),
          );
        }
      }
    }
    applyAnimatedEntityPose(rig, actor, scene, 14);
    expect(rig.position.y).toBeCloseTo(0, 5);
    expect(
      Math.hypot(
        rig.position.x - seat.position[0],
        rig.position.z - seat.position[2],
      ),
    ).toBeGreaterThan(2 * actor.scale);
    disposeObject(rig);
  }
});
it("rejects occupied seats, invalid targets and standing before sitting, and requires standing before full-body travel", () => {
  const scene = fixture();
  expect(() =>
    applyCommands(scene, [
      {
        type: "update",
        id: "actor",
        changes: {
          clips: scene.entities[0].clips.filter((c) => c.motionId !== "stand"),
        },
      },
    ]),
  ).toThrow("Stand up");
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "leo", id: "other" },
      { type: "chain", id: "other", motionId: "sit", targetId: "seat" },
    ]),
  ).toThrow("occupied");
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "leo", id: "other" },
      { type: "chain", id: "other", motionId: "stand" },
    ]),
  ).toThrow("targeted Sit");
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "cup", id: "cup" },
      { type: "chain", id: "actor", motionId: "sit", targetId: "cup" },
    ]),
  ).toThrow("known sitting surface");
  const later = applyCommands(scene, [
    { type: "add", assetId: "leo", id: "other" },
    { type: "chain", id: "other", motionId: "idle", duration: 10 },
    { type: "chain", id: "other", motionId: "sit", targetId: "seat" },
  ]);
  expect(validateSeating(later, allMotions(later))).toHaveLength(2);
  const moving = structuredClone(scene);
  moving.entities[1].clips = [{ id: "bad", motionId: "walk", duration: 4 }];
  expect(() => validateScene(moving)).toThrow("seat still");
});
it("reports unreachable seating without moving the character into the furniture", async () => {
  const scene = fixture(),
    rig = await rigFor(scene),
    actor = scene.entities[0];
  scene.entities[1].scale = 3;
  applyAnimatedEntityPose(rig, actor, scene, 2);
  expect(rig.userData.motionWarning).toMatch(/Lower|shrink/);
  expect(rig.position.toArray()).toEqual(actor.position);
  disposeObject(rig);
});
it("targets a named seat through the offline assistant and stages both actions in disposable rehearsals", () => {
  let scene = fixture();
  scene.entities[0].clips = [];
  scene = applyCommands(scene, [
    {
      type: "add",
      assetId: "furniture-chair",
      id: "dining",
      position: [2, 0, 0],
    },
  ]);
  const result = offlineCommands(
    scene,
    "Mila sit on Dining chair then talk then stand up then walk",
  );
  expect(
    result.commands
      .filter((c) => c.type === "chain")
      .map((c) => [c.motionId, c.targetId]),
  ).toEqual([
    ["sit", "dining"],
    ["talk", undefined],
    ["stand", undefined],
    ["walk", undefined],
  ]);
  expect(() => applyCommands(scene, result.commands)).not.toThrow();
  const original = JSON.stringify(scene);
  for (const id of ["sit", "stand"]) {
    const preview = actionPreview(
      scene,
      allMotions(scene).find((m) => m.id === id)!,
      "actor",
    );
    expect(preview.scene.entities.some((e) => e.id === "preview-seat")).toBe(
      true,
    );
    expect(() => validateScene(preview.scene)).not.toThrow();
  }
  expect(JSON.stringify(scene)).toBe(original);
});
it("matches declared library seat surfaces to the actual shipped geometry", async () => {
  const scene = starterScene();
  for (const asset of allAssets(scene).filter((a) => a.url && a.seat)) {
    const data = await fs.readFile("public" + asset.url);
    const object = (
      await new GLTFLoader().parseAsync(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        "",
      )
    ).scene;
    object.updateMatrixWorld(true);
    const seat = seatProfile(asset)!;
    const hits = new T.Raycaster(
      new T.Vector3(
        seat.position[0],
        seat.position[1] + 0.15,
        seat.position[2],
      ),
      new T.Vector3(0, -1, 0),
    ).intersectObject(object, true);
    expect(hits.length, asset.name).toBeGreaterThan(0);
    expect(hits[0].point.y, asset.name).toBeCloseTo(seat.position[1], 3);
    disposeObject(object);
  }
});

it("keeps seat support during a sip and returns the cup before standing", async () => {
  let scene = fixture();
  scene.entities[0].clips = scene.entities[0].clips.slice(0, 2);
  scene = applyCommands(scene, [
    { type: "add", assetId: "cup", id: "cup", position: [-0.32, 0.8, 0.28] },
    {
      type: "chain",
      id: "actor",
      motionId: "sip",
      targetId: "cup",
      duration: 3,
    },
    { type: "chain", id: "actor", motionId: "stand", duration: 2 },
  ]);
  const rig = await rigFor(scene),
    cup = createProp("cup", "#abcdef"),
    seat = createProp("chair", "#abcdef");
  const objects = new Map([
    ["actor", rig],
    ["cup", cup],
    ["seat", seat],
  ]);
  const sample = (t: number) => {
    for (const entity of scene.entities)
      applyAnimatedEntityPose(objects.get(entity.id)!, entity, scene, t);
    const warnings = applyInteractions(scene, t, objects);
    expect(warnings).toEqual([]);
    rig.updateMatrixWorld(true);
    cup.updateMatrixWorld(true);
  };
  sample(5);
  const hip = world(rig.userData.bones.hips),
    foot = rig.userData.bones.rightShin.localToWorld(
      rig.userData.contacts.rightFoot.clone(),
    );
  for (const t of [6.9, 7.5, 8.1, 7.5]) {
    sample(t);
    expect(world(rig.userData.bones.hips).distanceTo(hip)).toBeLessThan(1e-5);
    expect(
      rig.userData.bones.rightShin
        .localToWorld(rig.userData.contacts.rightFoot.clone())
        .distanceTo(foot),
    ).toBeLessThan(1e-5);
    if (t === 7.5) {
      const hand = rig.userData.bones.rightForearm.localToWorld(
        rig.userData.contacts.hand.clone(),
      );
      const grip = cup.localToWorld(new T.Vector3(0.13, 0.08, 0));
      expect(hand.distanceTo(grip)).toBeLessThan(0.001);
      expect(cup.position.y).toBeGreaterThan(0.9);
    }
  }
  sample(9);
  expect(cup.position.toArray()).toEqual([-0.32, 0.8, 0.28]);
  [rig, cup, seat].forEach((group) => disposeObject(group));
});

it("detaches a removed seat without shifting later actions, and prevents carrying occupied furniture", () => {
  const scene = fixture(),
    clips = scene.entities[0].clips;
  const removed = applyCommands(scene, [{ type: "remove", id: "seat" }]);
  expect(removed.entities[0].clips.map((c) => c.motionId)).toEqual([
    "idle",
    "talk",
    "wave",
    "idle",
    "walk",
  ]);
  expect(removed.entities[0].clips.map((c) => [c.id, c.duration])).toEqual(
    clips.map((c) => [c.id, c.duration]),
  );
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "leo", id: "other" },
      { type: "chain", id: "other", motionId: "pick", targetId: "seat" },
    ]),
  ).toThrow("occupied seats");
});

it("keeps two characters seated through sequential dialogue and waiting", async () => {
  let scene = fixture();
  scene.entities[0].clips = scene.entities[0].clips.slice(0, 1);
  scene = applyCommands(scene, [
    { type: "add", assetId: "leo", id: "other", position: [2, 0, 0.65] },
    { type: "add", assetId: "chair", id: "other-seat", position: [2, 0, 0] },
    {
      type: "chain",
      id: "other",
      motionId: "sit",
      targetId: "other-seat",
      duration: 3,
    },
  ]);
  scene = appendSpeech(scene, "actor", {
    dialogue: "There is room for your story at this table.",
    action: "wave",
  });
  scene = appendSpeech(scene, "other", {
    dialogue: "Then let us take a moment and begin.",
    action: "talk",
  });
  const rig = await rigFor(scene),
    otherScene = {
      ...scene,
      entities: [
        scene.entities.find((e) => e.id === "other")!,
        ...scene.entities.filter((e) => e.id !== "other"),
      ],
    },
    other = await rigFor(otherScene);
  for (const [object, actor] of [
    [rig, scene.entities[0]],
    [other, otherScene.entities[0]],
  ] as const) {
    applyAnimatedEntityPose(object, actor, scene, 3);
    const hip = world(object.userData.bones.hips);
    for (const time of [4, 7, 10, 20, 4]) {
      applyAnimatedEntityPose(object, actor, scene, time);
      expect(world(object.userData.bones.hips).distanceTo(hip)).toBeLessThan(
        1e-5,
      );
      expect(object.userData.motionWarning).toBeFalsy();
    }
  }
  expect(scene.transcript.map((line) => line.characterId)).toEqual([
    "actor",
    "other",
  ]);
  [rig, other].forEach((group) => disposeObject(group));
});
