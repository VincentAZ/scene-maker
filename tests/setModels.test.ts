import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import catalogue from "../shared/content/sets.json";
import { imageSizes, meshBounds, readGLB, selfContained } from "./helpers/glb";

const sets = catalogue as {
  id: string;
  url?: string;
  set?: { bounds: { min: number[]; max: number[] } };
}[];

// The library files are downloaded, not committed: every built 3D set
// present on disk is checked, and the suite is skipped when none is.
const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const built = sets.filter(
  (set) => set.url && fs.existsSync(path.join(content, set.url.slice(9))),
);

describe.skipIf(!built.length)("built 3D set files", () => {
  const glb = (set: (typeof built)[number]) =>
    readGLB(
      new Uint8Array(fs.readFileSync(path.join(content, set.url!.slice(9)))),
    );

  it.each(built.map((set) => [set.id, set] as const))(
    "%s is one self-contained GLB with plain JPEG/PNG textures of at most 2048 px",
    (_, set) => {
      const file = glb(set);
      expect(selfContained(file)).toBe(true);
      expect(file.json.extensionsRequired ?? []).toEqual([]);
      const images = imageSizes(file);
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.width).toBeGreaterThan(0);
        expect(Math.max(image.width, image.height)).toBeLessThanOrEqual(2048);
        expect(["image/jpeg", "image/png"]).toContain(image.mimeType);
      }
    },
  );

  it.each(built.map((set) => [set.id, set] as const))(
    "%s stands on a floor at y = 0 that spans the catalogue bounds",
    (_, set) => {
      const meshes = meshBounds(glb(set));
      const floors = meshes.filter((mesh) => mesh.role === "floor");
      expect(floors.length).toBeGreaterThan(0);
      const lowest = Math.min(...floors.map((mesh) => mesh.min[1]));
      expect(lowest).toBeGreaterThan(-0.02);
      expect(lowest).toBeLessThan(0.02);
      // The spawn point at the origin stands on a floor mesh.
      expect(
        floors.some(
          (mesh) =>
            mesh.min[0] <= 0.3 &&
            mesh.max[0] >= -0.3 &&
            mesh.min[2] <= 0.3 &&
            mesh.max[2] >= -0.3,
        ),
      ).toBe(true);
      // The catalogue bounds come from the vertices; the boxes read here
      // are each node's local box turned into place, so a sofa set at an
      // angle reads a little larger, never smaller.
      const { bounds } = set.set!;
      for (let k = 0; k < 3; k++) {
        const low = Math.min(...meshes.map((mesh) => mesh.min[k]));
        const high = Math.max(...meshes.map((mesh) => mesh.max[k]));
        expect(low).toBeLessThanOrEqual(bounds.min[k] + 0.02);
        expect(low).toBeGreaterThanOrEqual(bounds.min[k] - 1.5);
        expect(high).toBeGreaterThanOrEqual(bounds.max[k] - 0.02);
        expect(high).toBeLessThanOrEqual(bounds.max[k] + 1.5);
      }
    },
  );
});
