import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  starterScene,
  applyCommands,
  allAssets,
  validateScene,
  type Scene,
} from "../shared/scene";
import { entityPose } from "../shared/animation";
import {
  defaultLadder,
  ladderPoint,
  planLadder,
  sampleLadder,
  type LadderSample,
} from "../shared/ladder";
import {
  createCharacter,
  createProp,
  applyAnimatedEntityPose,
} from "../src/world";
import { configureRigContacts, type RigContacts } from "../src/ik";
import { applyInteractions } from "../src/interactions";
import { offlineCommands } from "../server/ai";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();

function fixture() {
  const empty = starterScene();
  empty.entities = [];
  const scene = applyCommands(empty, [
    { type: "add", id: "actor", assetId: "mila", position: [0.8, 0, 1.5] },
    { type: "add", id: "ladder", assetId: "ladder", position: [0, 0, 0] },
    { type: "chain", id: "actor", motionId: "climb", targetId: "ladder" },
  ]);
  return { scene, actor: scene.entities[0], ladder: scene.entities[1] };
}
function renderer(scene: Scene) {
  const root = new T.Group(),
    objects = new Map<string, T.Group>();
  for (const entity of scene.entities) {
    const asset = allAssets(scene).find((a) => a.id === entity.assetId)!;
    const object =
      asset.category === "characters"
        ? withRecordedSources(
            createCharacter(asset, entity.color),
            recordedSourceMap,
          )
        : createProp(asset.style, entity.color, asset.parts, asset.ladder);
    root.add(object);
    configureRigContacts(object);
    objects.set(entity.id, object);
  }
  const sample = (time: number) => {
    for (const entity of scene.entities)
      applyAnimatedEntityPose(objects.get(entity.id)!, entity, scene, time);
    root.updateMatrixWorld(true);
    const warnings = applyInteractions(scene, time, objects);
    root.updateMatrixWorld(true);
    return warnings;
  };
  return { objects, sample };
}
function endpoint(rig: T.Group, limb: keyof LadderSample["contacts"]) {
  const contacts = rig.userData.contacts as RigContacts;
  const side = limb.startsWith("left") ? "left" : "right";
  return rig.userData.bones[
    side + (limb.endsWith("Hand") ? "Forearm" : "Shin")
  ].localToWorld(
    (limb === "rightHand" ? contacts.hand : contacts[limb])!.clone(),
  ) as T.Vector3;
}

describe("targeted ladder choreography", () => {
  it.each([1, 1.5])(
    "keeps all four contacts on their planned rungs for a rotated pair at scale %s",
    (scale) => {
      const { scene, actor, ladder } = fixture();
      actor.scale = ladder.scale = scale;
      ladder.position = [2, 0, -1];
      ladder.rotation = 0.7;
      const { objects, sample } = renderer(scene),
        rig = objects.get(actor.id)!;
      for (let i = 30; i <= 100; i++) {
        const time = i * 0.06;
        expect(sample(time), `warnings at ${time}`).toEqual([]);
        const planned = rig.userData.climb as LadderSample;
        for (const limb of Object.keys(
          planned.contacts,
        ) as (keyof LadderSample["contacts"])[]) {
          expect(
            endpoint(rig, limb).distanceTo(
              new T.Vector3(...planned.contacts[limb]),
            ),
            `${limb} at ${time}`,
          ).toBeLessThan(1e-5);
          if (!planned.swing[limb]) {
            const local = objects
              .get(ladder.id)!
              .worldToLocal(endpoint(rig, limb));
            const rung =
              (local.y -
                defaultLadder.firstRung -
                (limb.endsWith("Foot") ? 0.0975 : 0)) /
              defaultLadder.spacing;
            expect(rung).toBeCloseTo(Math.round(rung), 5);
            expect(local.z).toBeCloseTo(0.0325, 5);
          }
        }
      }
    },
  );
  it("moves only one contact at a time and preserves the others throughout each step", () => {
    const { actor, ladder, scene } = fixture();
    const asset = allAssets(scene).find((a) => a.id === ladder.assetId)!;
    const plan = planLadder(
      actor.position,
      actor.rotation,
      actor,
      ladder,
      asset,
    );
    for (let phase = 0; phase < 4; phase++) {
      const a = sampleLadder(plan, 0.3 + (phase * 0.25 + 0.05) * 0.2);
      const b = sampleLadder(plan, 0.3 + (phase * 0.25 + 0.2) * 0.2);
      expect(Object.values(a.swing).filter(Boolean)).toHaveLength(1);
      for (const limb of Object.keys(
        a.contacts,
      ) as (keyof LadderSample["contacts"])[])
        if (!a.swing[limb]) expect(b.contacts[limb]).toEqual(a.contacts[limb]);
    }
  });
  it("approaches continuously, holds the upper stance, and scrubs deterministically", () => {
    const { scene, actor } = fixture(),
      { sample, objects } = renderer(scene),
      rig = objects.get(actor.id)!;
    sample(0);
    expect(rig.position.toArray()).toEqual(actor.position);
    for (const time of [1.08, 1.8, 5.4, 6]) {
      sample(time - 1e-5);
      const before = rig.position.clone(),
        hand = endpoint(rig, "leftHand");
      sample(time + 1e-5);
      expect(rig.position.distanceTo(before)).toBeLessThan(0.001);
      expect(endpoint(rig, "leftHand").distanceTo(hand)).toBeLessThan(0.001);
    }
    sample(6);
    const end = rig.position.clone(),
      hand = endpoint(rig, "rightHand");
    expect(end.y).toBeCloseTo(1.2175, 5);
    sample(12);
    expect(rig.position.distanceTo(end)).toBeLessThan(1e-8);
    expect(endpoint(rig, "rightHand").distanceTo(hand)).toBeLessThan(1e-8);
    sample(3.3);
    const middle = endpoint(rig, "leftFoot");
    sample(0);
    sample(8);
    sample(3.3);
    expect(endpoint(rig, "leftFoot").distanceTo(middle)).toBeLessThan(1e-8);
  });
  it("derives climb height from custom rungs and keeps the endpoint and facing for the next action", () => {
    const { scene, actor, ladder } = fixture();
    scene.customAssets.push({
      ...allAssets(scene).find((a) => a.id === "ladder")!,
      id: "tall-ladder",
      style: "cup",
      ladder: { ...defaultLadder, height: 4, rungs: 11 },
    });
    ladder.assetId = "tall-ladder";
    const { sample, objects } = renderer(scene);
    expect(
      new T.Box3()
        .setFromObject(objects.get(ladder.id)!)
        .getSize(new T.Vector3()).y,
    ).toBeCloseTo(4, 5);
    expect(sample(6)).toEqual([]);
    expect(objects.get(actor.id)!.position.y).toBeCloseTo(2.6175, 5);
    const end = entityPose(actor, scene, 6);
    actor.clips.push({ id: "walk", motionId: "walk", duration: 3 });
    expect(entityPose(actor, scene, 6).root).toEqual(end.root);
    // The recorded walk starts from the climb's endpoint and facing; its own
    // travel comes from the take once its source is loaded.
    const walked = entityPose(actor, scene, 6.5);
    expect(walked.root).toEqual(end.root);
    expect(walked.heading).toBeCloseTo(end.heading!, 5);
  });
  it("starts the approach from accumulated native root travel", () => {
    const { scene, actor } = fixture();
    scene.customMotions.push({
      id: "native",
      kind: "imported",
      name: "Travel",
      duration: 2,
      distance: 0,
      poses: [],
      sourceAssetId: actor.assetId,
      animationName: "Travel",
    });
    actor.clips.unshift({ id: "native", motionId: "native", duration: 2 });
    const pose = entityPose(actor, scene, 2, {
      nativeRoot: () => ({ start: [0, 0, 0], delta: [0, 0, 2] }),
    });
    expect(pose.root).toEqual([0.8, 0, 3.5]);
    expect(pose.climb?.plan.from).toEqual(pose.root);
  });
  it("leaves unsupported climbs at their starting position with actionable feedback", () => {
    for (const issue of ["small", "hidden", "high", "rig", "moving"] as const) {
      const { scene, actor, ladder } = fixture();
      if (issue === "small") ladder.scale = 0.3;
      if (issue === "hidden") ladder.visible = false;
      if (issue === "high") ladder.position[1] = 2;
      if (issue === "moving")
        ladder.clips.push({ id: "move", motionId: "walk", duration: 3 });
      const { sample, objects } = renderer(scene);
      if (issue === "rig")
        delete objects.get(actor.id)!.userData.bones.leftShin;
      expect(sample(4)).toHaveLength(1);
      expect(objects.get(actor.id)!.position.toArray()).toEqual(actor.position);
    }
  });
  it("rejects unknown rungs, simultaneous climbers, and climbing while carrying", () => {
    const { scene, actor } = fixture();
    const wrong = structuredClone(scene);
    wrong.entities[1].assetId = "cup";
    expect(() => validateScene(wrong)).toThrow("known rungs");
    expect(() =>
      applyCommands(scene, [
        { type: "add", id: "other", assetId: "leo" },
        { type: "chain", id: "other", motionId: "climb", targetId: "ladder" },
      ]),
    ).toThrow("one character at a time");
    expect(() =>
      applyCommands(scene, [
        { type: "add", id: "later", assetId: "leo" },
        { type: "chain", id: "later", motionId: "idle", duration: 8 },
        { type: "chain", id: "later", motionId: "climb", targetId: "ladder" },
      ]),
    ).toThrow("one character at a time");
    actor.clips = [];
    expect(() =>
      applyCommands(scene, [
        { type: "add", id: "cup", assetId: "cup" },
        { type: "chain", id: actor.id, motionId: "pick", targetId: "cup" },
        { type: "chain", id: actor.id, motionId: "climb", targetId: "ladder" },
      ]),
    ).toThrow("both hands");
  });
  it("preserves climbing contact after a completed pick and put-down session", () => {
    const { scene, actor } = fixture();
    const next = applyCommands(scene, [
      { type: "add", id: "cup", assetId: "cup", position: [0.55, 1.01, 1.7] },
    ]);
    next.entities[0].clips.unshift(
      { id: "pick", motionId: "pick", duration: 2, targetId: "cup" },
      { id: "place", motionId: "place", duration: 2, targetId: "cup" },
    );
    validateScene(next);
    const { objects, sample } = renderer(next),
      rig = objects.get(actor.id)!;
    expect(sample(8.2)).toEqual([]);
    expect(
      endpoint(rig, "rightHand").distanceTo(
        new T.Vector3(...rig.userData.climb.contacts.rightHand),
      ),
    ).toBeLessThan(1e-5);
  });
  it("targets a named ladder or the nearest visible ladder in the offline assistant", () => {
    const { scene, actor, ladder } = fixture();
    actor.clips = [];
    ladder.position = [10, 0, 0];
    ladder.name = "Tall steps";
    const next = applyCommands(scene, [
      {
        type: "add",
        id: "near",
        assetId: "ladder",
        name: "Near steps",
        position: [0, 0, 0],
      },
    ]);
    const plain = offlineCommands(next, "Mila climb then wave");
    expect(plain.commands[0]).toMatchObject({
      type: "chain",
      targetId: "near",
      motionId: "climb",
    });
    const named = offlineCommands(next, "Mila climb Tall steps");
    expect(named.commands[0]).toMatchObject({
      type: "chain",
      targetId: "ladder",
    });
    expect(ladderPoint(ladder, [0, 0, 0])).toEqual(ladder.position);
    expect(offlineCommands(next, "Climb Tall steps").commands[0]).toMatchObject(
      { id: actor.id, targetId: ladder.id },
    );
    next.entities = [next.entities[0]];
    expect(offlineCommands(next, "Mila climb").response).toContain(
      "Add a ladder",
    );
    expect(offlineCommands(next, "Mila climb").commands).toEqual([]);
  });
});
