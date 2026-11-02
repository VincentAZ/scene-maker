import { describe, it, expect } from "vitest";
import {
  starterScene,
  applyCommands,
  validateScene,
  allAssets,
  allMotions,
  characters,
  motions,
} from "../shared/scene";
import { entityPose, motionPose } from "../shared/animation";
import { createCharacter } from "../src/world";
import * as T from "three";
import { offlineCommands } from "../server/ai";
describe("creator scene workflows", () => {
  it("ships rigged characters, props, sets and distinct actions", () => {
    const s = starterScene();
    expect(allAssets(s).length).toBeGreaterThanOrEqual(32);
    expect(allMotions(s).length).toBe(38);
    for (const a of characters) {
      const rig = createCharacter(a);
      const mesh = rig.children.find(
        (c) => c instanceof T.SkinnedMesh,
      ) as T.SkinnedMesh;
      expect(mesh.skeleton.bones).toHaveLength(11);
      const weights = mesh.geometry.getAttribute("skinWeight");
      for (let i = 0; i < weights.count; i++)
        expect(
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i),
        ).toBeCloseTo(1);
    }
  });
  it("chains actions with cumulative root motion in the facing direction", () => {
    const s = starterScene(),
      actor = s.entities[0];
    actor.clips = [];
    actor.position = [0, 0, 0];
    actor.rotation = Math.PI / 2;
    const next = applyCommands(s, [
      { type: "chain", id: actor.id, motionId: "walk" },
      { type: "chain", id: actor.id, motionId: "jump" },
      { type: "chain", id: actor.id, motionId: "walk" },
    ]);
    expect(entityPose(next.entities[0], next, 4).root[0]).toBeCloseTo(2);
    expect(entityPose(next.entities[0], next, 4.75).root[1]).toBeCloseTo(1);
    expect(entityPose(next.entities[0], next, 9.5).root[0]).toBeCloseTo(4);
  });
  it("reorders and removes actions without changing source state", () => {
    const s = starterScene(),
      actor = s.entities[0],
      clip = actor.clips[1];
    const next = applyCommands(s, [
      {
        type: "reorderClip",
        id: actor.id,
        clipId: clip.id,
        direction: "earlier",
      },
    ]);
    expect(next.entities[0].clips[0].id).toBe(clip.id);
    expect(s.entities[0].clips[0].id).not.toBe(clip.id);
    expect(
      applyCommands(next, [
        { type: "removeClip", id: actor.id, clipId: clip.id },
      ]).entities[0].clips,
    ).toHaveLength(1);
  });
  it("removes prop references when a target is deleted", () => {
    const s = starterScene(),
      cup = s.entities.find((e) => e.assetId === "cup")!;
    expect(s.entities[1].clips[1].targetId).toBe(cup.id);
    const next = applyCommands(s, [{ type: "remove", id: cup.id }]);
    expect(next.entities[1].clips[1].targetId).toBeUndefined();
  });
  it("rejects invalid scene imports, invalid actions and duplicate IDs atomically", () => {
    const s = starterScene();
    expect(() =>
      applyCommands(s, [
        { type: "add", assetId: "cup" },
        { type: "chain", id: s.entities[0].id, motionId: "missing" },
      ]),
    ).toThrow();
    expect(s.entities).toHaveLength(5);
    expect(() =>
      validateScene({ ...s, entities: [s.entities[0], s.entities[0]] }),
    ).toThrow("Duplicate");
    expect(() => validateScene({ ...s, id: "../../secret" })).toThrow();
    expect(() =>
      applyCommands(s, [
        { type: "update", id: s.entities[0].id, changes: { scale: -1 } },
      ]),
    ).toThrow();
  });
  it("interpolates custom action poses and supports vertical paths", () => {
    const custom = {
      ...motions[0],
      kind: "custom" as const,
      poses: [
        { at: 0, root: [0, 0, 0] as [number, number, number], rotations: {} },
        { at: 1, root: [0, 3, 0] as [number, number, number], rotations: {} },
      ],
    };
    expect(motionPose(custom, 0.5).root).toEqual([0, 1.5, 0]);
    expect(
      motionPose(
        motions.find((m) => m.id === "climb")!,
        1,
      ).root[1],
    ).toBe(1);
  });
  it("keeps local helper honest and obeys motion order", () => {
    const s = starterScene();
    const result = offlineCommands(s, "Mila walk then jump then wave");
    expect(result.mode).toBe("offline");
    expect(
      result.commands.map((c) => (c.type === "chain" ? c.motionId : null)),
    ).toEqual(["walk", "jump", "wave"]);
    expect(
      offlineCommands(s, "build a photorealistic alien").commands,
    ).toHaveLength(0);
    expect(offlineCommands(s, "Add a coffee cup").commands).toEqual([
      { type: "add", assetId: "cup" },
    ]);
    const interaction = offlineCommands(
      s,
      "Leo pick up the cup then sip then put down",
    );
    expect(
      interaction.commands.map((c) => (c.type === "chain" ? c.motionId : "")),
    ).toEqual(["pick", "sip", "place"]);
    expect(() => applyCommands(s, interaction.commands)).not.toThrow();
  });
});

describe("generated shape compositions", () => {
  it("keeps novel props as declared geometry, rather than substituting a preset", async () => {
    const { createProp } = await import("../src/world");
    const s = starterScene();
    const asset = {
      ...allAssets(s).find((a) => a.id === "cup")!,
      id: "rocket-prop",
      name: "Little rocket",
      parts: [
        {
          shape: "cylinder" as const,
          position: [0, 0.6, 0] as [number, number, number],
          scale: [0.3, 1.2, 0.3] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          color: "#e0d3ae",
        },
        {
          shape: "cone" as const,
          position: [0, 1.4, 0] as [number, number, number],
          scale: [0.3, 0.4, 0.3] as [number, number, number],
          rotation: [0, 0, 0] as [number, number, number],
          color: "#b86f50",
        },
      ],
    };
    const next = applyCommands(s, [
      { type: "createAsset", asset },
      { type: "add", assetId: asset.id },
    ]);
    expect(next.entities.at(-1)?.assetId).toBe("rocket-prop");
    const object = createProp(asset.style, asset.color, asset.parts);
    expect(object.children).toHaveLength(2);
    expect(object.children[1].position.y).toBe(1.4);
    expect((object.children[1] as T.Mesh).geometry.type).toBe("ConeGeometry");
  });
});

it("creates and directs a new character atomically from one assistant response", () => {
  const scene = starterScene();
  const next = applyCommands(scene, [
    { type: "add", assetId: "nora", id: "new-doctor", name: "Dr. Robin" },
    {
      type: "update",
      id: "new-doctor",
      changes: {
        personality: "A reassuring physician.",
        provider: "anthropic",
      },
    },
    { type: "chain", id: "new-doctor", motionId: "walk" },
    { type: "chain", id: "new-doctor", motionId: "wave" },
  ]);
  expect(next.entities.at(-1)?.clips.map((c) => c.motionId)).toEqual([
    "walk",
    "wave",
  ]);
  expect(next.entities.at(-1)?.provider).toBe("anthropic");
  expect(() =>
    applyCommands(next, [{ type: "add", assetId: "leo", id: "new-doctor" }]),
  ).toThrow("Duplicate");
});
