import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
  applyCommands,
  assetSchema,
  motionSchema,
  resolveMotionSource,
  starterScene,
  validateScene,
  type Asset,
} from "../shared/scene";
import { capturedMotions } from "../shared/motionLibrary";
import {
  emptyStudioLibrary,
  studioLibraryAssets,
  studioLibraryCommands,
  studioLibraryMotions,
  studioLibrarySchema,
} from "../shared/studioLibrary";
import { productionPackage } from "../src/productionPackage";
import { actionPreview } from "../shared/actionPreview";

const asset = (id: string, category: Asset["category"] = "props") =>
  assetSchema.parse({
    id,
    name: id,
    category,
    style: "Imported",
    color: "#739480",
    url: `/uploads/${id}.glb`,
  });
const imported = (id = "private-greeting", sourceAssetId = "private-source") =>
  motionSchema.parse({
    id,
    name: "Greeting",
    kind: "imported",
    duration: 2,
    sourceAssetId,
    animationName: "Greeting",
  });
const fixture = () =>
  studioLibrarySchema.parse({
    version: 1,
    assets: [
      asset("private-actor", "characters"),
      asset("private-source", "characters"),
      asset("private-bench"),
      asset("private-set", "environments"),
    ],
    motions: [imported()],
  });

describe("private studio library helpers", () => {
  it("returns independent empty catalogs and shows saved characters, props, environments and actions in fresh projects", () => {
    const a = emptyStudioLibrary(),
      b = emptyStudioLibrary();
    a.assets.push(asset("only-a"));
    expect(b).toEqual({ version: 1, assets: [], motions: [] });
    const scene = starterScene(),
      library = fixture();
    const before = JSON.stringify({ scene, library });
    expect(studioLibraryAssets(scene, library)).toEqual(
      expect.arrayContaining(library.assets),
    );
    expect(studioLibraryMotions(scene, library)).toEqual(
      expect.arrayContaining(library.motions),
    );
    const commands = studioLibraryCommands(scene, library, {
      assetIds: ["private-actor", "private-bench", "private-set"],
    });
    const next = applyCommands(scene, commands);
    expect(next.customAssets.map((entry) => entry.id)).toEqual([
      "private-actor",
      "private-bench",
      "private-set",
    ]);
    expect(next.entities).toEqual(scene.entities);
    expect(next.customMotions).toEqual([]);
    const placed = applyCommands(next, [
      { type: "add", assetId: "private-actor" },
      { type: "add", assetId: "private-bench" },
      { type: "add", assetId: "private-set" },
    ]);
    expect(placed.environmentAssetId).toBe("private-set");
    expect(placed.entities).toHaveLength(scene.entities.length + 2);
    expect(JSON.stringify({ scene, library })).toBe(before);
  });

  it("keeps same-ID current project versions without replacing them or copying the catalog's wrong source", () => {
    const scene = starterScene(),
      library = fixture();
    const localSource = {
      ...asset("local-source", "characters"),
      name: "Project rig",
    };
    scene.customAssets = [
      { ...library.assets[0], name: "Project actor" },
      localSource,
    ];
    scene.customMotions = [
      {
        ...library.motions[0],
        sourceAssetId: localSource.id,
        name: "Project take",
      },
    ];
    expect(
      studioLibraryAssets(scene, library).find(
        (entry) => entry.id === "private-actor",
      )?.name,
    ).toBe("Project actor");
    expect(
      studioLibraryMotions(scene, library).find(
        (entry) => entry.id === "private-greeting",
      )?.name,
    ).toBe("Project take");
    expect(
      studioLibraryCommands(scene, library, {
        assetIds: ["private-actor"],
        motionIds: ["private-greeting"],
      }),
    ).toEqual([]);
    // Current-scene definitions stay visible even when no longer on disk/in the catalog.
    expect(studioLibraryAssets(scene, emptyStudioLibrary())).toContain(
      localSource,
    );
  });

  it("copies a shared motion's source before its action, without placing it, and repeated selections are no-ops", async () => {
    const scene = starterScene(),
      library = fixture();
    const before = JSON.stringify({ scene, library });
    const commands = studioLibraryCommands(scene, library, {
      motionIds: ["private-greeting", "private-greeting"],
    });
    expect(commands.map((command) => command.type)).toEqual([
      "createAsset",
      "createMotion",
    ]);
    let next = applyCommands(scene, commands);
    expect(next.entities).toEqual(scene.entities);
    expect(next.customAssets.map((entry) => entry.id)).toEqual([
      "private-source",
    ]);
    expect(
      studioLibraryCommands(next, library, { motionIds: ["private-greeting"] }),
    ).toEqual([]);
    next = applyCommands(next, [
      { type: "chain", id: scene.entities[0].id, motionId: "private-greeting" },
    ]);
    expect(validateScene(next)).toEqual(next);
    expect(
      resolveMotionSource(next, next.customMotions[0].sourceAssetId)?.url,
    ).toBe("/uploads/private-source.glb");
    const reads: string[] = [];
    const bytes = new Uint8Array([1, 2, 3]);
    const exported = await productionPackage(next, bytes.buffer, (async (
      url,
    ) => {
      reads.push(String(url));
      return new Response(bytes);
    }) as typeof fetch);
    const zip = await JSZip.loadAsync(exported);
    expect(reads).toContain("/uploads/private-source.glb");
    expect(
      await zip.file("assets/private-source.glb")!.async("uint8array"),
    ).toEqual(bytes);
    expect(
      JSON.parse(await zip.file("scene.json")!.async("string")).customAssets,
    ).toEqual(next.customAssets);
    expect(JSON.stringify({ scene, library })).toBe(before);
  });

  it("previews an unregistered library motion without changing or placing anything in the project", () => {
    const scene = starterScene(),
      library = fixture();
    const before = JSON.stringify(scene);
    const rehearsalSource = applyCommands(
      scene,
      studioLibraryCommands(scene, library, {
        motionIds: [library.motions[0].id],
      }),
    );
    const rehearsal = actionPreview(
      rehearsalSource,
      library.motions[0],
      scene.entities[0].id,
    );
    expect(validateScene(rehearsal.scene)).toEqual(rehearsal.scene);
    expect(rehearsal.scene.customAssets.map((entry) => entry.id)).toEqual([
      "private-source",
    ]);
    expect(rehearsal.scene.entities).toHaveLength(1);
    expect(rehearsal.actor.assetId).toBe(scene.entities[0].assetId);
    expect(rehearsal.actor.clips[0].motionId).toBe(library.motions[0].id);
    expect(JSON.stringify(scene)).toBe(before);
    expect(scene.customMotions).toHaveLength(0);
    expect(
      actionPreview(rehearsalSource, library.motions[0]).scene.entities,
    ).toHaveLength(1);
  });

  it("deduplicates bundled IDs and shared dependencies within and across selections", () => {
    // A recording bundled with the studio (the stylized clips are retired).
    const scene = starterScene(),
      library = fixture(),
      bundled = capturedMotions.find((m) => m.id === "wave")!;
    library.assets.push({
      ...asset("mila", "characters"),
      name: "Not bundled Mila",
    });
    library.motions.push(bundled, imported("another-greeting"));
    expect(
      studioLibraryAssets(scene, library).filter(
        (entry) => entry.id === "mila",
      ),
    ).toHaveLength(1);
    expect(
      studioLibraryMotions(scene, library).filter(
        (entry) => entry.id === bundled.id,
      ),
    ).toHaveLength(1);
    expect(
      studioLibraryCommands(scene, library, {
        assetIds: ["mila"],
        motionIds: ["idle", bundled.id],
      }),
    ).toEqual([]);
    const commands = studioLibraryCommands(scene, library, {
      assetIds: ["private-source", "private-source"],
      motionIds: ["private-greeting", "another-greeting"],
    });
    expect(commands.map((command) => command.type)).toEqual([
      "createAsset",
      "createMotion",
      "createMotion",
    ]);
    expect(applyCommands(scene, commands).customAssets).toHaveLength(1);
  });

  it("rejects unknown selections, malformed definitions, duplicates and dangling or non-character source references", () => {
    const scene = starterScene(),
      library = fixture();
    expect(() =>
      studioLibraryCommands(scene, library, { assetIds: ["unknown"] }),
    ).toThrow("Unknown studio library asset");
    expect(() =>
      studioLibraryCommands(scene, library, { motionIds: ["unknown"] }),
    ).toThrow("Unknown studio library motion");
    for (const invalid of [
      { ...library, version: 2 },
      { ...library, assets: [...library.assets, library.assets[0]] },
      { ...library, motions: [...library.motions, library.motions[0]] },
      {
        ...library,
        assets: [{ ...library.assets[0], url: "https://example.com/rig.glb" }],
      },
      { ...library, motions: [{ ...imported(), animationName: undefined }] },
      { ...library, motions: [imported("dangling", "missing")] },
      { ...library, motions: [imported("prop-source", "private-bench")] },
      {
        ...library,
        assets: library.assets.map((entry) => ({ ...entry, url: undefined })),
      },
    ])
      expect(studioLibrarySchema.safeParse(invalid).success).toBe(false);
    scene.customAssets = [{ ...asset("private-source"), category: "props" }];
    expect(() =>
      studioLibraryCommands(scene, library, {
        motionIds: ["private-greeting"],
      }),
    ).toThrow("source character");
  });

  it("allows large catalogs but rejects registrations exceeding scene or command limits without changing inputs", () => {
    const library = fixture();
    library.assets.push(
      ...Array.from({ length: 101 }, (_, i) => asset(`catalog-${i}`)),
    );
    expect(studioLibrarySchema.safeParse(library).success).toBe(true);
    const scene = starterScene();
    scene.customAssets = Array.from({ length: 99 }, (_, i) =>
      asset(`existing-${i}`),
    );
    const before = JSON.stringify({ scene, library });
    const commands = studioLibraryCommands(scene, library, {
      motionIds: ["private-greeting"],
    });
    expect(applyCommands(scene, commands).customAssets).toHaveLength(100);
    expect(() =>
      studioLibraryCommands(scene, library, {
        assetIds: ["private-bench"],
        motionIds: ["private-greeting"],
      }),
    ).toThrow();
    scene.customMotions = Array.from({ length: 100 }, (_, i) =>
      motionSchema.parse({
        id: `existing-motion-${i}`,
        name: "Existing",
        kind: "idle",
        duration: 2,
      }),
    );
    const fullBefore = JSON.stringify(scene);
    expect(() =>
      studioLibraryCommands(scene, library, {
        motionIds: ["private-greeting"],
      }),
    ).toThrow();
    expect(JSON.stringify(scene)).toBe(fullBefore);
    scene.customMotions = [];
    expect(JSON.stringify({ scene, library })).toBe(before);
    expect(() =>
      studioLibraryCommands(starterScene(), library, {
        assetIds: library.assets.slice(-101).map((entry) => entry.id),
      }),
    ).toThrow("maximum 100");
  });
});
