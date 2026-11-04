import { contentAssets } from "../shared/contentLibrary";
import { describe, it, expect } from "vitest";
import {
  starterScene,
  applyCommands,
  validateScene,
  allAssets,
  allMotions,
  assetSchema,
  offeredAssets,
  characters,
  actionRoles,
} from "../shared/scene";
import {
  capturedMotions,
  capturedRouteGaits,
  libraryMotions,
} from "../shared/motionLibrary";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";
import * as T from "three";
import { offlineCommands } from "../server/ai";
import { recordedSources, withRecordedSources } from "./recordedSources";
const recordedSourceMap = await recordedSources();
describe("creator scene workflows", () => {
  it("ships rigged characters, props, sets and distinct actions", () => {
    const s = starterScene();
    // Old projects still resolve every built-in, but only the plain studio
    // stage and the downloaded realistic library are offered.
    expect(allAssets(s).length).toBeGreaterThanOrEqual(32);
    expect(offeredAssets(s).map((a) => a.id)).toEqual([
      "studio",
      ...contentAssets.map((a) => a.id),
    ]);
    // Every action is a motion-capture recording, each with its own id; the
    // retired stylized clips are not offered. Every role a seat, ladder, prop
    // or dialogue line relies on names exactly one recording.
    expect(capturedMotions.length).toBeGreaterThanOrEqual(74);
    expect(allMotions(s).length).toBe(capturedMotions.length);
    for (const stylized of libraryMotions)
      expect(allMotions(s).some((m) => m.id === stylized.id)).toBe(false);
    expect(new Set(allMotions(s).map((m) => m.id)).size).toBe(
      allMotions(s).length,
    );
    expect(allMotions(s).every((m) => m.kind === "imported")).toBe(true);
    for (const role of actionRoles) {
      const recorded = allMotions(s).filter((m) => m.role === role);
      expect(recorded.map((m) => m.id)).toEqual([role]);
      expect(recorded[0].sourceAssetId).toMatch(/^cmu-capture-/);
    }
    for (const a of characters) {
      const rig = withRecordedSources(createCharacter(a), recordedSourceMap);
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
    const [walk, jump] = next.entities[0].clips;
    // Recorded clips play at their captured speed and length.
    expect(walk.playbackRate).toBe(1);
    expect(walk.duration).toBeCloseTo(2.975);
    expect(jump.duration).toBeCloseTo(3.45);
    const rig = withRecordedSources(
      createCharacter(characters.find((a) => a.id === actor.assetId)!),
      recordedSourceMap,
    );
    const at = (time: number) => {
      applyAnimatedEntityPose(rig, next.entities[0], next, time);
      return rig.position.clone();
    };
    const walked = at(walk.duration - 1e-6),
      jumped = at(walk.duration + jump.duration - 1e-6),
      end = at(walk.duration * 2 + jump.duration - 1e-6);
    // The take travels forward along the actor's facing (+X), not the
    // capture room's axes.
    expect(walked.x).toBeGreaterThan(3);
    expect(Math.abs(walked.z)).toBeLessThan(walked.x * 0.2);
    // The recorded jump leaves the ground and lands further forward.
    let peak = -Infinity;
    for (let t = walk.duration; t < walk.duration + jump.duration; t += 0.05)
      peak = Math.max(peak, at(t).y);
    expect(peak - walked.y).toBeGreaterThan(0.15);
    expect(jumped.x - walked.x).toBeGreaterThan(0.8);
    // The second walk starts where the jump landed and covers the same
    // recorded distance again, rather than restarting at the origin.
    expect(end.distanceTo(jumped)).toBeCloseTo(walked.length(), 2);
    expect(end.x).toBeGreaterThan(jumped.x + 2.5);
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
  it("migrates formula actions in saved scenes to recordings", () => {
    const s = starterScene(),
      actor = s.entities[0];
    s.customMotions = [
      // An assistant-made keyframe action and a formula-gait route.
      {
        id: "custom-hop",
        name: "Hop",
        kind: "custom",
        duration: 2,
        distance: 0,
        poses: [
          { at: 0, root: [0, 0, 0], rotations: {} },
          { at: 1, root: [0, 3, 0], rotations: {} },
        ],
      },
      {
        id: "old-route",
        name: "Old route",
        kind: "walk",
        duration: 4,
        distance: 0,
        poses: [],
        path: {
          points: [
            [0, 0, 0],
            [0, 0, 4],
          ],
          smooth: false,
        },
      },
    ];
    actor.clips = [
      { id: "w", motionId: "walk", duration: 4 },
      { id: "h", motionId: "custom-hop", duration: 2 },
      { id: "r", motionId: "old-route", duration: 4 },
      { id: "v", motionId: "wave", duration: 1 },
      { id: "c", motionId: "captured-77-02", duration: 3, playbackRate: 1 },
    ];
    const next = validateScene(JSON.parse(JSON.stringify(s)));
    const clips = next.entities[0].clips;
    // A travelling formula walk becomes a private straight route on the
    // recorded stride, keeping its scheduled time.
    const walkRoute = next.customMotions.find(
      (m) => m.id === clips[0].motionId,
    )!;
    expect(walkRoute.id).toBe(`recorded-route-${actor.id}-w`);
    expect(walkRoute).toMatchObject({
      kind: "imported",
      duration: 4,
      sourceAssetId: capturedRouteGaits[0].sourceAssetId,
      animationName: capturedRouteGaits[0].animationName,
      path: { sourceRange: capturedRouteGaits[0].path!.sourceRange },
    });
    expect(walkRoute.path!.points).toEqual([
      [0, 0, 0],
      [0, 0, 2],
    ]);
    // Keyframe actions are replaced by recorded standing.
    expect(clips[1].motionId).toBe("idle");
    expect(next.customMotions.some((m) => m.id === "custom-hop")).toBe(false);
    // A formula-gait route keeps its path but plays the recorded stride.
    expect(next.customMotions.find((m) => m.id === "old-route")).toMatchObject({
      kind: "imported",
      sourceAssetId: capturedRouteGaits[0].sourceAssetId,
      path: {
        points: [
          [0, 0, 0],
          [0, 0, 4],
        ],
        sourceRange: capturedRouteGaits[0].path!.sourceRange,
      },
    });
    // Role clips play the recording at its own speed; former capture ids
    // alias to their role.
    expect(clips[3]).toMatchObject({ motionId: "wave", playbackRate: 1 });
    expect(clips[4].motionId).toBe("idle");
    expect(clips.every((clip) => clip.playbackRate === 1)).toBe(true);
    // Migration is stable across save/reload.
    expect(validateScene(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it("deletes only the user's own actions, with every clip playing them", () => {
    const s = starterScene(),
      actor = s.entities[0];
    const route = {
      ...capturedRouteGaits[0],
      id: "my-route",
      name: "My route",
    };
    const next = applyCommands(s, [
      { type: "createMotion", motion: route },
      { type: "chain", id: actor.id, motionId: "my-route" },
      { type: "chain", id: actor.id, motionId: "wave" },
    ]);
    expect(next.entities[0].clips.map((c) => c.motionId)).toContain("my-route");
    const removed = applyCommands(next, [
      { type: "deleteMotion", motionId: "my-route" },
    ]);
    expect(removed.customMotions.some((m) => m.id === "my-route")).toBe(false);
    expect(removed.entities[0].clips.map((c) => c.motionId)).toEqual([
      ...s.entities[0].clips.map((c) => c.motionId),
      "wave",
    ]);
    for (const motionId of ["wave", libraryMotions[0].id])
      expect(() =>
        applyCommands(next, [{ type: "deleteMotion", motionId }]),
      ).toThrow("Only your own actions can be deleted.");
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
    // The retired cup is not offered; the creator's imported one is.
    expect(offlineCommands(s, "Add a coffee cup").commands).toEqual([]);
    const imported = {
      ...s,
      customAssets: [
        assetSchema.parse({
          id: "imported-cup",
          name: "Coffee cup",
          category: "props",
          style: "Imported",
          color: "#f2efe8",
          url: "/uploads/cup.glb",
        }),
      ],
    };
    expect(offlineCommands(imported, "Add a coffee cup").commands).toEqual([
      { type: "add", assetId: "imported-cup" },
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
