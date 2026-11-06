import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Box3, Ray, Vector3 } from "three";
import catalogue from "../shared/content/sets.json";
import { shellBox, type SetBlock } from "../shared/sets";
import { imageSizes, meshBounds, readGLB, selfContained } from "./helpers/glb";

const sets = catalogue as {
  id: string;
  url?: string;
  set?: SetBlock;
}[];

// The library files are downloaded, not committed: every built 3D set
// present on disk is checked, and the suite is skipped when none is.
const content = path.resolve(process.env.SCENE_MAKER_CONTENT || "content");
const built = sets.filter(
  (set) => set.url && fs.existsSync(path.join(content, set.url.slice(9))),
);

// The studio's standing body (src/environmentModel.ts) and what it treats
// as the set's shell rather than furniture (shared/sets.ts).
const BODY_HALF_WIDTH = 0.28;
const BODY_HEIGHT = 1.7;
const FLOOR_TOP = 0.05;
const SHELL_SPAN = 5;

describe.skipIf(!built.length)("built 3D set files", () => {
  const glb = (set: (typeof built)[number]) =>
    readGLB(
      new Uint8Array(fs.readFileSync(path.join(content, set.url!.slice(9)))),
    );

  it.each(
    built
      .filter((set) =>
        ["set-cosy-bedroom", "set-white-living-room"].includes(set.id),
      )
      .map((set) => [set.id, set] as const),
  )(
    "%s opens with both feet visible past the foreground furniture",
    (_, set) => {
      const block = set.set!;
      const camera = new Vector3(...block.camera.position);
      // The former views looked through the bed/sofa at the cast's shoes.
      // Check the actual converted meshes, rather than pinning camera numbers.
      // A merged room's AABB surrounds empty space, so use the same shell
      // exclusions as placement; browser review also checks the visible walls.
      const furniture = meshBounds(glb(set)).filter(
        (mesh) =>
          mesh.role !== "floor" &&
          mesh.role !== "shell" &&
          !shellBox(mesh.min, mesh.max, block),
      );
      expect(furniture.length).toBeGreaterThan(0);
      for (const side of [-0.1, 0, 0.1]) {
        const foot = new Vector3(
          block.spawn[0] + side * Math.cos(block.heading),
          block.spawn[1] + 0.05,
          block.spawn[2] - side * Math.sin(block.heading),
        );
        const ray = new Ray(camera, foot.clone().sub(camera).normalize());
        const obstructing = furniture.filter((mesh) => {
          const box = new Box3(
            new Vector3().fromArray(mesh.min),
            new Vector3().fromArray(mesh.max),
          );
          const hit = ray.intersectBox(box, new Vector3());
          return (
            box.containsPoint(camera) ||
            (hit && camera.distanceTo(hit) < camera.distanceTo(foot))
          );
        });
        expect(
          obstructing.map((mesh) => mesh.name),
          `foreground meshes hiding the foot at lateral offset ${side}`,
        ).toEqual([]);
      }
    },
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

  it.each(built.map((set) => [set.id, set] as const))(
    "%s lets a new cast member appear at the spawn without touching furniture",
    (_, set) => {
      const plan = set.set!.walkable ?? [];
      const extent = (k: number) =>
        plan.length
          ? Math.max(...plan.map((p) => p[k])) -
            Math.min(...plan.map((p) => p[k]))
          : 0;
      const touching = meshBounds(glb(set)).filter((mesh) => {
        if (mesh.role === "floor" || mesh.role === "shell") return false;
        if (mesh.max[1] <= FLOOR_TOP) return false;
        const width = mesh.max[0] - mesh.min[0];
        const depth = mesh.max[2] - mesh.min[2];
        if (width >= SHELL_SPAN && depth >= SHELL_SPAN) return false;
        // A box around the spawn spanning half the floor is the room.
        const holdsSpawn =
          mesh.min[0] < -0.05 &&
          mesh.max[0] > 0.05 &&
          mesh.min[2] < -0.05 &&
          mesh.max[2] > 0.05;
        if (holdsSpawn && (width >= extent(0) / 2 || depth >= extent(1) / 2))
          return false;
        return (
          mesh.min[0] < BODY_HALF_WIDTH &&
          mesh.max[0] > -BODY_HALF_WIDTH &&
          mesh.min[2] < BODY_HALF_WIDTH &&
          mesh.max[2] > -BODY_HALF_WIDTH &&
          mesh.min[1] < BODY_HEIGHT &&
          mesh.max[1] > FLOOR_TOP
        );
      });
      expect(touching.map((mesh) => mesh.name)).toEqual([]);
    },
  );

  it.each(built.map((set) => [set.id, set] as const))(
    "%s shows glass as glass, not as a mirror, and cobwebs as cut-outs",
    (_, set) => {
      for (const material of glb(set).json.materials ?? []) {
        const name = material.name ?? "";
        const pbr = material.pbrMetallicRoughness ?? {};
        if (/cobweb|spiderweb/i.test(name))
          expect(["MASK", "BLEND"]).toContain(material.alphaMode);
        const glows =
          material.emissiveTexture !== undefined ||
          (material.emissiveFactor ?? []).some((value) => value > 0);
        if (/glass/i.test(name) && !glows)
          expect(pbr.metallicFactor ?? 1, name).toBeLessThan(0.5);
      }
    },
  );
});

// Benedikt Bitterli's scenes describe their materials in Mitsuba XML; a
// plain colour there must reach the GLB as it is.
const mitsuba = {
  "set-bathroom": "bathroom",
  "set-cosy-bedroom": "bedroom",
  "set-country-kitchen": "country-kitchen",
};
const sources = path.join(content, ".cache/sets-models");

function findScene(dir: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === "scene_v3.xml") return file;
    if (entry.isDirectory()) {
      const found = findScene(file);
      if (found) return found;
    }
  }
  return null;
}

/** The plain colour of each named BSDF: its diffuse reflectance, or a
 * plastic's diffuse_reflectance, when that is an <rgb> and not a texture. */
function mitsubaColours(xml: string) {
  const colours = new Map<string, number[]>();
  const tags = /<(\/?)(\w+)([^>]*?)(\/?)>/g;
  let depth = 0;
  let current: { id: string; types: string[]; colour?: number[] } | null = null;
  for (const [, closing, tag, attributes, selfClosing] of xml.matchAll(tags)) {
    const attribute = (name: string) =>
      new RegExp(`${name}="([^"]*)"`).exec(attributes)?.[1];
    if (closing) {
      depth--;
      if (current && depth === 1 && tag === "bsdf") {
        const plain = current.types.every((type) =>
          ["twosided", "diffuse", "plastic", "roughplastic", "mask"].includes(
            type,
          ),
        );
        if (plain && current.colour) colours.set(current.id, current.colour);
        current = null;
      }
      continue;
    }
    if (tag === "bsdf" && depth === 1 && attribute("id"))
      current = { id: attribute("id")!, types: [] };
    if (current && tag === "bsdf") current.types.push(attribute("type") ?? "");
    const name = attribute("name");
    if (current && (name === "reflectance" || name === "diffuse_reflectance")) {
      if (tag === "rgb" && !current.colour)
        current.colour = attribute("value")!
          .split(/[,\s]+/)
          .filter(Boolean)
          .map(Number);
      else if (tag === "texture") current.types.push("texture");
    }
    if (!selfClosing) depth++;
  }
  return colours;
}

const scenes = Object.entries(mitsuba)
  .map(([id, slug]) => ({
    id,
    xml: findScene(path.join(sources, slug)),
    set: built.find((set) => set.id === id),
  }))
  .filter((scene) => scene.xml && scene.set);

describe.skipIf(!scenes.length)("Mitsuba sets", () => {
  it.each(scenes.map((scene) => [scene.id, scene] as const))(
    "%s keeps every plain colour of its scene description",
    (_, scene) => {
      const colours = mitsubaColours(fs.readFileSync(scene.xml!, "utf8"));
      expect(colours.size).toBeGreaterThan(5);
      const file = readGLB(
        new Uint8Array(
          fs.readFileSync(path.join(content, scene.set!.url!.slice(9))),
        ),
      );
      let compared = 0;
      for (const material of file.json.materials ?? []) {
        const expected = colours.get(material.name ?? "");
        if (!expected) continue;
        const actual = material.pbrMetallicRoughness?.baseColorFactor ?? [
          1, 1, 1,
        ];
        for (let k = 0; k < 3; k++)
          expect(actual[k], material.name).toBeCloseTo(expected[k], 2);
        compared++;
      }
      expect(compared).toBeGreaterThan(5);
    },
  );
});

// The converter's own record of each set, kept beside its sources.
function measurement(id: string) {
  if (!fs.existsSync(sources)) return null;
  for (const slug of fs.readdirSync(sources)) {
    const file = path.join(sources, slug, `${id}.json`);
    if (fs.existsSync(file))
      return JSON.parse(fs.readFileSync(file, "utf8")) as {
        floorArea?: number;
        spawnDepth?: number;
        materials?: { white?: number };
        bakes?: Record<string, [number, number]>;
      };
  }
  return null;
}

const measured = built
  .map((set) => ({ set, m: measurement(set.id) }))
  .filter(({ m }) => m?.floorArea !== undefined);

describe.skipIf(!measured.length)("3D set conversions", () => {
  it.each(measured.map(({ set, m }) => [set.id, set, m!] as const))(
    "%s bakes no surface plain white and outlines most of its open floor",
    (_, set, m) => {
      expect(m.materials?.white ?? 0).toBe(0);
      for (const [name, [mean, spread]] of Object.entries(m.bakes ?? {}))
        expect(mean > 250 && spread < 2, name).toBe(false);
      expect(m.spawnDepth).toBeGreaterThanOrEqual(0.3);
      const plan = set.set!.walkable!;
      const area =
        Math.abs(
          plan.reduce((sum, [x, z], i) => {
            const [nx, nz] = plan[(i + 1) % plan.length];
            return sum + x * nz - nx * z;
          }, 0),
        ) / 2;
      // The outline covers the open floor it was drawn around (and, inside
      // a room, the furniture standing on it).
      expect(area).toBeGreaterThanOrEqual(0.6 * m.floorArea!);
    },
  );
});
