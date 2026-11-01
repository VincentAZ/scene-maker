import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { expect, it } from "vitest";
import { libraryMotions, motionSource } from "../shared/motionLibrary";
import { starterScene } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { standingPerformance } from "../src/standingPerformance";
import { disposeObject } from "../src/world";

it("finds the calm standing loop of the bundled source by measurement, not by name", async () => {
  const bytes = await readFile("public" + motionSource.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  const source = prepareImportedAsset(motionSource, gltf);
  try {
    const walk = libraryMotions.find((m) => m.animationName === "Walk")!;
    const found = standingPerformance(starterScene(), source, walk)!;
    expect(found).toBeDefined();
    expect(found.motion.animationName).toBe("Idle");
    expect(found.travel).toBeLessThan(0.15);
    expect(found.footLift).toBeLessThan(0.04);
    // A loaded take can be registered under a new imported asset/motion ID.
    // Reusing its physical measurements must not return the old scene's ID.
    const importedIdle = {
      ...found.motion,
      id: "new-idle",
      sourceAssetId: "new-source",
    };
    const importedWalk = {
      ...walk,
      id: "new-walk",
      sourceAssetId: "new-source",
    };
    const imported = {
      ...starterScene(),
      customMotions: [importedIdle, importedWalk],
    };
    expect(standingPerformance(imported, source, importedWalk)?.motion).toEqual(
      importedIdle,
    );
    // Gestures and falls on the same source are stationary too but not calm
    // standing loops; they must not be chosen as a waiting performance.
    for (const name of ["Victory", "Defeat", "Death", "Punch"]) {
      const other = libraryMotions.find((m) => m.animationName === name)!;
      const measure = standingPerformance(
        { ...starterScene(), customMotions: [] },
        source,
        { ...walk, id: "gait" },
      )!;
      expect(measure.motion.id).not.toBe(other.id);
    }
  } finally {
    disposeObject(source);
  }
});
