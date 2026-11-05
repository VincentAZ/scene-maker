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
import {
  missingSitDown,
  planSeat,
  reseat,
  seatProfile,
  seatedAddPlan,
  validateSeating,
} from "../shared/seating";
import { entityPose } from "../shared/animation";
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
import { capturedMotionSources } from "../shared/motionLibrary";
import { appendSpeech } from "../shared/conversation";
import { actionPreview } from "../shared/actionPreview";
import { contactAction } from "../shared/transitions";
import { setMotionSources } from "../src/rig";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();
// Talk while seated (86_15), a take performed seated from start to finish.
const seatedTake = "captured-86-15";
const withSeatedTake = await (async () => {
  const asset = capturedMotionSources.find(
    (a) => a.id === "cmu-capture-86-15",
  )!;
  const data = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    "",
  );
  return new Map([
    ...recordedSourceMap,
    [asset.id, prepareImportedAsset(asset, gltf)],
  ]);
})();

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
  if (!asset.url)
    return withRecordedSources(
      createCharacter(asset, asset.color),
      recordedSourceMap,
    );
  const data = await fs.readFile("public" + asset.url);
  return withRecordedSources(
    prepareImportedAsset(
      asset,
      await new GLTFLoader().parseAsync(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        "",
      ),
    ),
    recordedSourceMap,
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
          // Recorded ankles flex while seated; sole correction (checked
          // above to 1 mm) keeps the shoe on the floor, so the ankle contact
          // may shift, never lift: up to 1.8 cm on heeled boots.
          currentFeet.forEach((p, i) =>
            expect(p.distanceTo(feet![i]), id).toBeLessThan(0.02),
          );
        }
      }
    }
    applyAnimatedEntityPose(rig, actor, scene, 14);
    // Walking again at standing height (well clear of the seat's), the root
    // following the recorded pelvis bob.
    expect(Math.abs(rig.position.y)).toBeLessThan(0.1 * actor.scale);
    expect(
      Math.hypot(
        rig.position.x - seat.position[0],
        rig.position.z - seat.position[2],
      ),
      // The recorded walk carries the character well away from the seat.
    ).toBeGreaterThan(1.5 * actor.scale);
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
  // A take performed seated takes the seat named for it.
  const seatedResult = offlineCommands(
    scene,
    "Mila talk while seated on Dining chair",
  );
  expect(
    seatedResult.commands
      .filter((c) => c.type === "chain")
      .map((c) => [c.motionId, c.targetId]),
  ).toEqual([[seatedTake, "dining"]]);
  expect(() => applyCommands(scene, seatedResult.commands)).not.toThrow();
  const original = JSON.stringify(scene);
  for (const id of ["sit", "stand", seatedTake]) {
    const preview = actionPreview(
      scene,
      allMotions(scene).find((m) => m.id === id)!,
      "actor",
    );
    expect(preview.scene.entities.some((e) => e.id === "preview-seat")).toBe(
      true,
    );
    expect(() => validateScene(preview.scene)).not.toThrow();
    // Standing up and a seated take rehearse after sitting down on the bench,
    // so the seated hold shows without asking for a Sit down.
    if (id !== "sit")
      expect(preview.actor.clips.map((c) => [c.motionId, c.targetId])).toEqual([
        ["sit", "preview-seat"],
        [id, id === "stand" ? undefined : "preview-seat"],
      ]);
  }
  expect(JSON.stringify(scene)).toBe(original);
});
it("matches declared library seat surfaces to the actual shipped geometry", async () => {
  const scene = starterScene();
  // Downloaded library seats (/content/) are measured in tests/props.test.ts.
  for (const asset of allAssets(scene).filter(
    (a) => a.url && a.seat && !a.url.startsWith("/content/"),
  )) {
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
    // Recorded ankles flex under the seat; sole correction may shift the
    // ankle contact by millimetres.
    expect(
      rig.userData.bones.rightShin
        .localToWorld(rig.userData.contacts.rightFoot.clone())
        .distanceTo(foot),
    ).toBeLessThan(0.01);
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

it("holds a targeted seated recording on its seat from the first action, hips on the seat and soles on the floor, for every library character", async () => {
  for (const id of ["mila", ...libraryCharacters.map((a) => a.id)]) {
    let scene = fixture(id, id === "mila" ? "chair" : "bench");
    scene.entities[0].clips = [];
    scene = applyCommands(scene, [
      {
        type: "chain",
        id: "actor",
        motionId: seatedTake,
        targetId: "seat",
        duration: 4,
      },
      { type: "chain", id: "actor", motionId: "wave", duration: 2 },
    ]);
    const actor = scene.entities[0],
      seat = scene.entities[1],
      rig = await rigFor(scene);
    setMotionSources(rig, withSeatedTake);
    // The seat is measured for this body even though nobody sits down.
    applyAnimatedEntityPose(rig, actor, scene, 0);
    const body = rig.userData.seatBody;
    expect(body, id).toBeDefined();
    seat.scale = Math.min(1, body.lowerLength / 0.38);
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
        true,
      );
      if (!plan.warning?.includes("feet can reach")) break;
      seat.scale *= 0.9;
    }
    for (const t of [0.5, 3, 5, 0.5]) {
      applyAnimatedEntityPose(rig, actor, scene, t);
      rig.updateMatrixWorld(true);
      expect(rig.userData.motionWarning, id + " " + t).toBeFalsy();
      // Sitting without a Sit down is staged, with advice.
      expect(rig.userData.motionNotice, id + " " + t).toMatch(
        /without sitting down first/,
      );
      expect(world(rig.userData.bones.hips).y, id + " " + t).toBeCloseTo(
        0.54 * seat.scale + body.padding * actor.scale,
        5,
      );
      expect(
        Math.abs(new T.Box3().setFromObject(rig, true).min.y),
        id + " shoe sole " + t,
      ).toBeLessThan(0.02);
      // The body sits where the seat is, facing the way it faces.
      expect(
        Math.hypot(
          rig.position.x - seat.position[0],
          rig.position.z - seat.position[2],
        ),
        id,
      ).toBeLessThan(0.05);
    }
    disposeObject(rig);
  }
});

it("plays a targeted seated recording after Sit down exactly as it plays untargeted, without the Sit down advice", async () => {
  const plain = fixture();
  plain.entities[0].clips[1] = {
    ...plain.entities[0].clips[1],
    motionId: seatedTake,
  };
  const chained = structuredClone(plain);
  chained.entities[0].clips[1].targetId = "seat";
  expect(() => validateScene(plain)).not.toThrow();
  expect(() => validateScene(chained)).not.toThrow();
  const rig = await rigFor(plain);
  setMotionSources(rig, withSeatedTake);
  for (const t of [3.2, 4, 5.9, 6.7]) {
    applyAnimatedEntityPose(rig, plain.entities[0], plain, t);
    const hip = world(rig.userData.bones.hips),
      heading = rig.rotation.y;
    applyAnimatedEntityPose(rig, chained.entities[0], chained, t);
    expect(rig.userData.motionWarning, String(t)).toBeFalsy();
    expect(rig.userData.motionNotice ?? "", String(t)).not.toMatch(
      /sitting down first/,
    );
    expect(world(rig.userData.bones.hips).distanceTo(hip)).toBeLessThan(1e-5);
    expect(Math.abs(rig.rotation.y - heading)).toBeLessThan(1e-6);
  }
  disposeObject(rig);
});

it("lets a targeted seated recording open or continue a seat's occupation, keeps Stand up required, and loses only its seat when the seat goes", () => {
  const scene = fixture();
  scene.entities[0].clips = [];
  const seated = applyCommands(scene, [
    {
      type: "chain",
      id: "actor",
      motionId: seatedTake,
      targetId: "seat",
      duration: 4,
    },
  ]);
  expect(validateSeating(seated, allMotions(seated))).toHaveLength(1);
  expect(contactAction(seated, seated.entities[0].clips[0])).toBe(true);
  expect(() =>
    applyCommands(seated, [
      { type: "add", assetId: "leo", id: "other" },
      { type: "chain", id: "other", motionId: "sit", targetId: "seat" },
    ]),
  ).toThrow("occupied");
  expect(() =>
    applyCommands(seated, [{ type: "chain", id: "actor", motionId: "walk" }]),
  ).toThrow("Stand up");
  const whole = applyCommands(scene, [
    { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
    { type: "chain", id: "actor", motionId: seatedTake, targetId: "seat" },
    { type: "chain", id: "actor", motionId: "wave" },
    { type: "chain", id: "actor", motionId: "stand" },
    { type: "chain", id: "actor", motionId: "walk" },
  ]);
  expect(validateSeating(whole, allMotions(whole))).toHaveLength(1);
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "chair", id: "other-seat", position: [2, 0, 0] },
      { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
      {
        type: "chain",
        id: "actor",
        motionId: seatedTake,
        targetId: "other-seat",
      },
    ]),
  ).toThrow("already seated");
  expect(() =>
    applyCommands(scene, [
      { type: "add", assetId: "cup", id: "cup" },
      { type: "chain", id: "actor", motionId: seatedTake, targetId: "cup" },
    ]),
  ).toThrow("known sitting surface");
  const untargeted = applyCommands(seated, [
    {
      type: "update",
      id: "actor",
      changes: {
        clips: [{ ...seated.entities[0].clips[0], targetId: undefined }],
      },
    },
  ]);
  expect(contactAction(untargeted, untargeted.entities[0].clips[0])).toBe(
    false,
  );
  const removed = applyCommands(
    applyCommands(seated, [{ type: "chain", id: "actor", motionId: "stand" }]),
    [{ type: "remove", id: "seat" }],
  );
  expect(
    removed.entities[0].clips.map((c) => [c.motionId, c.targetId]),
  ).toEqual([
    [seatedTake, undefined],
    ["idle", undefined],
  ]);
});

it("moves a whole seated stretch when one of its actions gets another seat", () => {
  const scene = applyCommands(fixture(), [
    { type: "add", assetId: "chair", id: "other-seat", position: [2, 0, 0] },
  ]);
  scene.entities[0].clips[1] = {
    ...scene.entities[0].clips[1],
    motionId: seatedTake,
    targetId: "seat",
  };
  const motions = allMotions(scene),
    clips = scene.entities[0].clips;
  const targets = (list: typeof clips) => list.map((c) => c.targetId);
  // sit, seated take, wave, stand, walk: the seat changes for the stretch
  // whichever of its seat actions is chosen, the gestures stay as they are.
  const moved = reseat(clips, motions, clips[1].id, "other-seat");
  expect(targets(moved)).toEqual([
    "other-seat",
    "other-seat",
    undefined,
    undefined,
    undefined,
  ]);
  expect(targets(reseat(clips, motions, clips[0].id, "other-seat"))).toEqual(
    targets(moved),
  );
  expect(() =>
    validateScene({
      ...scene,
      entities: [
        { ...scene.entities[0], clips: moved },
        ...scene.entities.slice(1),
      ],
    }),
  ).not.toThrow();
  // Clearing a seat, or seating an action that had none, is that action alone.
  expect(targets(reseat(clips, motions, clips[1].id, undefined))).toEqual([
    "seat",
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  const untargeted = clips.map((c, i) =>
    i === 1 ? { ...c, targetId: undefined } : c,
  );
  expect(targets(reseat(untargeted, motions, clips[1].id, "seat"))).toEqual(
    targets(clips),
  );
  // A stretch ends at Stand up: a later sit is not moved along.
  const twice = [
    ...clips,
    { ...clips[0], id: "sit-again" },
    { ...clips[1], id: "seated-again" },
  ];
  expect(targets(reseat(twice, motions, clips[1].id, "other-seat"))).toEqual([
    "other-seat",
    "other-seat",
    undefined,
    undefined,
    undefined,
    "seat",
    "seat",
  ]);
});

it("plans where an added seated recording sits: the nearest free seat after Sit down, the seat already taken while seated, nowhere without a free seat", () => {
  const scene = fixture();
  scene.entities[0].clips = [];
  const motions = allMotions(scene),
    assets = allAssets(scene);
  expect(seatedAddPlan(scene, assets, motions, "actor", seatedTake)).toEqual({
    targetId: "seat",
    leadIn: true,
    notice: `Sit down on ${scene.entities[1].name} comes first.`,
  });
  expect(seatedAddPlan(scene, assets, motions, "actor", "talk")).toEqual({});
  // Already seated: the take continues that seat, so its title and seat
  // picker read it and another seat moves the whole stretch.
  const seated = applyCommands(scene, [
    { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
  ]);
  expect(seatedAddPlan(seated, assets, motions, "actor", seatedTake)).toEqual({
    targetId: "seat",
  });
  expect(() =>
    applyCommands(seated, [
      { type: "chain", id: "actor", motionId: seatedTake, targetId: "seat" },
    ]),
  ).not.toThrow();
  const stood = applyCommands(seated, [
    { type: "chain", id: "actor", motionId: "stand" },
  ]);
  expect(
    seatedAddPlan(stood, assets, motions, "actor", seatedTake),
  ).toMatchObject({ targetId: "seat", leadIn: true });
  const bare = applyCommands(scene, [{ type: "remove", id: "seat" }]);
  expect(seatedAddPlan(bare, assets, motions, "actor", seatedTake)).toEqual({
    notice: "Add a chair, then choose it in Details.",
  });
  // A seat another character still occupies is not offered; the next free
  // one is, and without one the take is added as it is.
  const occupied = applyCommands(scene, [
    { type: "add", assetId: "leo", id: "other", position: [0.5, 0, 0.6] },
    { type: "chain", id: "other", motionId: "sit", targetId: "seat" },
  ]);
  expect(seatedAddPlan(occupied, assets, motions, "actor", seatedTake)).toEqual(
    { notice: "Every seat is taken. Add a chair, then choose it in Details." },
  );
  const spare = applyCommands(occupied, [
    { type: "add", assetId: "chair", id: "spare", position: [3, 0, 0] },
  ]);
  const plan = seatedAddPlan(spare, assets, motions, "actor", seatedTake);
  expect(plan).toMatchObject({ targetId: "spare", leadIn: true });
  expect(() =>
    applyCommands(spare, [
      { type: "chain", id: "actor", motionId: "sit", targetId: plan.targetId },
      {
        type: "chain",
        id: "actor",
        motionId: seatedTake,
        targetId: plan.targetId,
      },
    ]),
  ).not.toThrow();
  // Once the other character has stood up, the seat is free again.
  const vacated = applyCommands(occupied, [
    { type: "chain", id: "other", motionId: "stand" },
    { type: "chain", id: "actor", motionId: "idle", duration: 10 },
  ]);
  expect(
    seatedAddPlan(vacated, assets, motions, "actor", seatedTake),
  ).toMatchObject({ targetId: "seat", leadIn: true });
});

it("lets dialogue stage a seated recording on its seat, or without one to keep the seat already taken, and still refuses a cup as its seat", () => {
  const scene = fixture();
  scene.entities[0].clips = [];
  const line = (
    s: Scene,
    performance: { motionId: string; targetId?: string; duration?: number }[],
  ) =>
    appendSpeech(s, "actor", {
      dialogue: "Let me tell you a story.",
      performance,
    });
  const first = line(scene, [
    { motionId: seatedTake, targetId: "seat", duration: 4 },
  ]);
  expect(first.entities[0].clips.map((c) => [c.motionId, c.targetId])).toEqual([
    [seatedTake, "seat"],
  ]);
  const seated = applyCommands(scene, [
    { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
  ]);
  expect(() =>
    line(seated, [{ motionId: seatedTake, targetId: "seat", duration: 4 }]),
  ).not.toThrow();
  const inherited = line(seated, [{ motionId: seatedTake, duration: 4 }]);
  expect(inherited.entities[0].clips.at(-1)).toMatchObject({
    motionId: seatedTake,
    targetId: undefined,
  });
  expect(() =>
    line(applyCommands(scene, [{ type: "add", assetId: "cup", id: "cup" }]), [
      { motionId: seatedTake, targetId: "cup", duration: 4 },
    ]),
  ).toThrow("known sitting surface");
  expect(() =>
    line(scene, [{ motionId: "wave", targetId: "seat", duration: 2 }]),
  ).toThrow("does not take a prop target");
});

it("puts a Sit down in front of a seated take nobody sat down on, and names that fix when Sit down comes after it", () => {
  const scene = fixture();
  scene.entities[0].clips = [];
  const snapped = applyCommands(scene, [
    {
      type: "chain",
      id: "actor",
      motionId: seatedTake,
      targetId: "seat",
      duration: 4,
    },
    { type: "chain", id: "actor", motionId: "wave", duration: 2 },
  ]);
  const motions = allMotions(snapped);
  expect(missingSitDown(snapped.entities[0].clips, motions)).toEqual({
    index: 0,
    targetId: "seat",
    name: "Talk while seated",
  });
  // Appending Sit down instead is refused with the fix spelled out.
  expect(() =>
    applyCommands(snapped, [
      { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
    ]),
  ).toThrow("Move Sit down before Talk while seated.");
  const sit = motions.find((m) => m.id === "sit")!;
  const clips = [...snapped.entities[0].clips];
  clips.splice(0, 0, {
    id: "lead-in",
    motionId: "sit",
    duration: sit.duration,
    playbackRate: 1,
    targetId: "seat",
    transition: "smooth",
  });
  const fixed = applyCommands(snapped, [
    { type: "update", id: "actor", changes: { clips } },
  ]);
  expect(missingSitDown(fixed.entities[0].clips, motions)).toBeUndefined();
  expect(
    entityPose(fixed.entities[0], fixed, sit.duration + 1).seat?.notice,
  ).toBeUndefined();
  expect(validateSeating(fixed, motions)).toHaveLength(1);
  // After a Sit down, without a seat, or once stood up again: nothing missing.
  expect(missingSitDown(fixture().entities[0].clips, motions)).toBeUndefined();
  const untargeted = applyCommands(scene, [
    { type: "chain", id: "actor", motionId: seatedTake, duration: 4 },
  ]);
  expect(missingSitDown(untargeted.entities[0].clips, motions)).toBeUndefined();
  const again = applyCommands(fixed, [
    { type: "chain", id: "actor", motionId: "stand" },
    {
      type: "chain",
      id: "actor",
      motionId: seatedTake,
      targetId: "seat",
      duration: 4,
    },
  ]);
  expect(missingSitDown(again.entities[0].clips, motions)).toMatchObject({
    index: 4,
    targetId: "seat",
  });
});

it("plays a seated recording as it does without a seat when its seat cannot be used, and says why", async () => {
  const scene = fixture();
  scene.entities[0].clips = [];
  const targeted = applyCommands(scene, [
    {
      type: "chain",
      id: "actor",
      motionId: seatedTake,
      targetId: "seat",
      duration: 4,
    },
    { type: "chain", id: "actor", motionId: "wave", duration: 2 },
  ]);
  const plain = structuredClone(targeted);
  delete plain.entities[0].clips[0].targetId;
  const hidden = applyCommands(targeted, [
    { type: "update", id: "seat", changes: { visible: false } },
  ]);
  const pose = entityPose(hidden.entities[0], hidden, 2);
  expect(pose.seat).toBeUndefined();
  expect(pose.seatWarning).toMatch(/visible and still/);
  const bare = entityPose(plain.entities[0], plain, 2);
  expect(pose.root).toEqual(bare.root);
  expect(pose.heading).toBe(bare.heading);
  // The warning belongs to the take alone; the gesture after it is plain.
  expect(entityPose(hidden.entities[0], hidden, 5).seatWarning).toBeUndefined();
  const rig = await rigFor(hidden);
  setMotionSources(rig, withSeatedTake);
  applyAnimatedEntityPose(rig, hidden.entities[0], hidden, 2);
  rig.updateMatrixWorld(true);
  expect(rig.userData.motionWarning).toMatch(/visible and still/);
  const hip = world(rig.userData.bones.hips),
    lowest = new T.Box3().setFromObject(rig, true).min.y;
  applyAnimatedEntityPose(rig, plain.entities[0], plain, 2);
  rig.updateMatrixWorld(true);
  expect(rig.userData.motionWarning).toBeFalsy();
  expect(world(rig.userData.bones.hips).distanceTo(hip)).toBeLessThan(1e-5);
  expect(
    Math.abs(new T.Box3().setFromObject(rig, true).min.y - lowest),
  ).toBeLessThan(1e-5);
  disposeObject(rig);
  // A Sit down that cannot reach the chair carries its warning into the take.
  const far = applyCommands(scene, [
    { type: "update", id: "actor", changes: { position: [0, 0, 2.5] } },
    { type: "chain", id: "actor", motionId: "sit", targetId: "seat" },
    {
      type: "chain",
      id: "actor",
      motionId: seatedTake,
      targetId: "seat",
      duration: 4,
    },
  ]);
  const during = entityPose(far.entities[0], far, 4);
  expect(during.seat).toBeUndefined();
  expect(during.seatWarning).toMatch(/near the front/);
});
