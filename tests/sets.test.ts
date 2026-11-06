import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import catalogue from "../shared/content/sets.json";
import { contentCredits } from "../shared/contentLibrary";
import {
  allAssets,
  applyCommands,
  assetSchema,
  offeredAssets,
  starterScene,
  validateScene,
  type Asset,
} from "../shared/scene";
import { EnvironmentModel, photoSetAsset } from "../src/environmentModel";
import { exportSnapshot } from "../src/exportSnapshot";
import {
  backdropHome,
  backdropLimits,
  extractSun,
  keepInsideBackdrop,
  matchExposure,
  ORBIT_MAX_POLAR,
  PhotoSet,
  texelDirection,
} from "../src/hdriBackdrop";
import { disposeObject } from "../src/world";

/** A catalogue entry: a 3D set (url + set block) or a photo backdrop. */
interface SetEntry {
  id: string;
  name: string;
  style: string;
  description: string;
  url?: string;
  thumbnail: string;
  hdri?: string;
  backdrop?: NonNullable<Asset["backdrop"]>;
  set?: {
    camera: { position: number[]; target: number[]; maxDistance: number };
    bounds: { min: number[]; max: number[] };
    spawn: number[];
    heading: number;
    walkable?: number[][];
    collision: string;
    lighting?: {
      exposure?: number;
      hemisphere?: number;
      fog?: boolean;
      sky?: boolean;
    };
  };
  lightCredit?: { author: string; license: string; source: string };
}
const sets = catalogue as SetEntry[];
// Real 3D sets come first in the catalogue, photographic backdrops last.
const modelSets = sets.filter((set) => set.url);
const photoSets = sets.filter((set) => set.backdrop);
const first = () =>
  allAssets(starterScene()).find((asset) => asset.id === photoSets[0].id)!;
const withSet = (id = photoSets[0].id) =>
  applyCommands(starterScene(), [{ type: "add", assetId: id }]);

const licences = /^(CC0|CC BY( [34]\.0)?|CC BY-SA( [34]\.0)?|MIT)$/;
const inside = (point: number[], min: number[], max: number[]) =>
  point.every((value, k) => value >= min[k] && value <= max[k]);
/** Even-odd test of (x, z) against a polygon of [x, z] points. */
const insidePolygon = ([x, z]: number[], polygon: number[][]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i];
    const [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      hit = !hit;
  }
  return hit;
};
/** Distance from (x, z) to the polygon's nearest edge. */
const edgeDistance = ([x, z]: number[], polygon: number[][]) => {
  let nearest = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j];
    const [bx, bz] = polygon[i];
    const dx = bx - ax;
    const dz = bz - az;
    const length = dx * dx + dz * dz;
    const t = length
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
      : 0;
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return nearest;
};
const polygonArea = (polygon: number[][]) =>
  Math.abs(
    polygon.reduce((sum, [x, z], i) => {
      const [nx, nz] = polygon[(i + 1) % polygon.length];
      return sum + x * nz - nx * z;
    }, 0),
  ) / 2;

describe("3D sets catalogue", () => {
  it("lists real sets first, each with a model, a thumbnail and a complete set block", () => {
    expect(modelSets.length).toBeGreaterThanOrEqual(1);
    // Two cards of the same name would only differ by their pictures.
    expect(new Set(sets.map((set) => set.name)).size).toBe(sets.length);
    expect(sets.slice(0, modelSets.length)).toEqual(modelSets);
    expect(photoSets.length + modelSets.length).toBe(sets.length);
    const offered = offeredAssets(starterScene()).map((asset) => asset.id);
    for (const set of modelSets) {
      const asset = allAssets(starterScene()).find((a) => a.id === set.id)!;
      expect(() => assetSchema.parse(asset)).not.toThrow();
      expect(asset.category).toBe("environments");
      expect(set.id).toMatch(/^set-[a-z0-9-]+$/);
      expect(["Indoor", "Outdoor"]).toContain(set.style);
      expect(set.url).toBe(`/content/sets/${set.id}.glb`);
      expect(set.thumbnail).toBe(`/content/sets/${set.id}.png`);
      // Every 3D set is lit by its own HDR, shown as the sky only outdoors
      // (indoors the windows would show another room).
      expect(set.hdri).toBe(`/content/sets/${set.id}.hdr`);
      const lighting = set.set!.lighting!;
      expect(lighting.exposure).toBeGreaterThanOrEqual(0.15);
      expect(lighting.exposure).toBeLessThanOrEqual(3);
      expect(lighting.fog).toBe(false);
      expect(lighting.sky).toBe(set.style === "Outdoor");
      expect(set.lightCredit!.author.length).toBeGreaterThan(2);
      expect(set.lightCredit!.license).toMatch(licences);
      expect(set.lightCredit!.source).toMatch(/^https:\/\//);
      expect(set.description).toMatch(/\d+ by \d+ metres/);
      expect(set.backdrop).toBeUndefined();
      const { camera, bounds, spawn, heading, walkable, collision } = set.set!;
      const size = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
      // From a narrow bathroom (2.5 by 5 m) to a street block.
      expect(Math.max(size[0], size[2])).toBeGreaterThanOrEqual(3);
      expect(Math.min(size[0], size[2])).toBeGreaterThanOrEqual(2);
      expect(size[1]).toBeGreaterThanOrEqual(2);
      expect(Math.max(size[0], size[2])).toBeLessThanOrEqual(120);
      expect(inside(camera.position, bounds.min, bounds.max)).toBe(true);
      expect(inside(camera.target, bounds.min, bounds.max)).toBe(true);
      expect(camera.position[1]).toBeGreaterThan(0.3);
      // The home camera looks at the cast from the +Z side.
      expect(camera.position[2]).toBeGreaterThan(camera.target[2]);
      expect(camera.maxDistance).toBeGreaterThanOrEqual(4);
      expect(camera.maxDistance).toBeLessThanOrEqual(25);
      expect(spawn).toEqual([0, 0, 0]);
      // The camera stays inside the measured bounds (checked above), but
      // may look from a wider angle to keep furniture out of the view.
      // The cast's normalized heading still turns it toward that camera.
      expect(Number.isFinite(heading)).toBe(true);
      expect(Math.abs(heading)).toBeLessThanOrEqual(Math.PI);
      expect(Math.atan2(camera.position[0], camera.position[2])).toBeCloseTo(
        heading,
        2,
      );
      expect(inside(spawn, bounds.min, bounds.max)).toBe(true);
      expect(bounds.min[1]).toBeLessThanOrEqual(0.02);
      if (walkable) {
        expect(walkable.length).toBeGreaterThanOrEqual(3);
        expect(walkable.length).toBeLessThanOrEqual(256);
        expect(insidePolygon([0, 0], walkable)).toBe(true);
        // The studio moves a new cast member that stands closer than its
        // body radius (0.25 m) to the edge of the floor.
        expect(edgeDistance([0, 0], walkable)).toBeGreaterThanOrEqual(0.3);
        expect(polygonArea(walkable)).toBeGreaterThanOrEqual(5);
        // No needle: an edge never turns straight back along the last one.
        walkable.forEach((b, i) => {
          const a = walkable.at(i - 1)!;
          const c = walkable[(i + 1) % walkable.length];
          const ab = [b[0] - a[0], b[1] - a[1]];
          const bc = [c[0] - b[0], c[1] - b[1]];
          const lengths = Math.hypot(...ab) * Math.hypot(...bc);
          expect(lengths).toBeGreaterThan(0);
          expect((ab[0] * bc[0] + ab[1] * bc[1]) / lengths).toBeGreaterThan(
            -0.99,
          );
        });
      }
      expect(["furniture", "none"]).toContain(collision);
      const credit = contentCredits.get(set.id)!;
      expect(credit.author.length).toBeGreaterThan(2);
      expect(credit.license).toMatch(licences);
      expect(credit.source).toMatch(/^https:\/\//);
      expect(offered).toContain(set.id);
    }
  });
});

describe("photographic sets catalogue", () => {
  it("offers a varied, credited CC0 library of valid environment assets", () => {
    expect(photoSets.length).toBeGreaterThanOrEqual(15);
    expect(new Set(sets.map((set) => set.id)).size).toBe(sets.length);
    expect(new Set(photoSets.map((set) => set.style))).toEqual(
      new Set(["Photo backdrop"]),
    );
    const offered = offeredAssets(starterScene()).map((asset) => asset.id);
    for (const set of photoSets) {
      const asset = allAssets(starterScene()).find((a) => a.id === set.id)!;
      expect(() => assetSchema.parse(asset)).not.toThrow();
      expect(asset.category).toBe("environments");
      expect(asset.url).toBeUndefined();
      expect(asset.hdri).toMatch(/^\/content\/sets\/[a-z0-9-]+\.hdr$/);
      expect(asset.backdrop?.image).toMatch(
        /^\/content\/sets\/[a-z0-9-]+\.jpg$/,
      );
      expect(asset.thumbnail).toMatch(/^\/content\/sets\/[a-z0-9-]+\.png$/);
      expect(asset.description.length).toBeGreaterThan(20);
      // The camera always fits inside the projection dome.
      const limits = backdropLimits(asset.backdrop!);
      expect(
        Math.hypot(limits.reach, limits.ceiling - asset.backdrop!.height),
      ).toBeLessThan(asset.backdrop!.radius * 0.85);
      // The cast at the origin stands on the flat, photographed floor.
      expect(limits.center.length()).toBeLessThan(
        (asset.backdrop!.radius * 2) / 3,
      );
      expect(contentCredits.get(set.id)).toMatchObject({
        license: "CC0",
        source: expect.stringMatching(/^https:\/\/polyhaven\.com\/a\/\w+$/),
      });
      expect(offered).toContain(set.id);
    }
  });
});

describe("placing a photographic set", () => {
  it("sets the studio base with the set as environment asset and validates", () => {
    const scene = withSet();
    expect(scene.environment).toBe("studio");
    expect(scene.environmentAssetId).toBe(photoSets[0].id);
    expect(validateScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(photoSetAsset(scene)?.id).toBe(photoSets[0].id);
    expect(scene.entities.some((e) => e.assetId === photoSets[0].id)).toBe(
      false,
    );
  });

  it("returns to the plain studio and still rejects unknown environments", () => {
    const scene = applyCommands(withSet(), [
      { type: "add", assetId: "studio" },
    ]);
    expect(scene.environmentAssetId).toBeUndefined();
    expect(photoSetAsset(scene)).toBeUndefined();
    expect(() =>
      validateScene({ ...withSet(), environmentAssetId: "not-a-set" }),
    ).toThrow("custom environment asset");
  });

  it("keeps lighting edits from replacing the set", () => {
    const scene = applyCommands(withSet(), [
      { type: "scene", changes: { lighting: "moonlight" } },
    ]);
    expect(scene.environmentAssetId).toBe(photoSets[0].id);
  });
});

describe("photographic set environment model", () => {
  it("is an empty, ready environment without a photo loader (tests, export)", () => {
    const content = new T.Group();
    const model = new EnvironmentModel(content);
    const settled = vi.fn();
    model.update(withSet(), settled, () => {});
    expect(model.ready).toBe(true);
    expect(settled).toHaveBeenCalledOnce();
    expect(model.root?.children).toHaveLength(0);
    const snapshot = exportSnapshot(content);
    expect(snapshot.getObjectByName("SceneMakerEnvironment")).toBeDefined();
    disposeObject(snapshot);
    model.dispose();
  });

  it("waits for the photo, shows it, and hides it when the set changes", async () => {
    const content = new T.Group();
    const photo = new PhotoSet(
      new T.Group(),
      new T.Texture(),
      extractSun(new Float32Array(8 * 4 * 4).fill(1), 8, 4),
      1.2,
      first().backdrop!,
    );
    const dispose = vi.spyOn(photo, "dispose");
    let resolve!: (photo: PhotoSet) => void;
    const load = vi.fn(() => new Promise<PhotoSet>((done) => (resolve = done)));
    const show = vi.fn();
    const model = new EnvironmentModel(content, undefined, { load, show });
    const settled = vi.fn();
    model.update(withSet(), settled, () => {});
    expect(model.ready).toBe(false);
    expect(load).toHaveBeenCalledWith(first());
    resolve(photo);
    await Promise.resolve();
    expect(model.ready).toBe(true);
    expect(model.photo).toBe(photo);
    expect(show).toHaveBeenLastCalledWith(photo);
    expect(settled).toHaveBeenCalledOnce();
    model.update(starterScene(), settled, () => {});
    expect(show).toHaveBeenLastCalledWith(null);
    expect(dispose).toHaveBeenCalledOnce();
    expect(model.photo).toBeNull();
    model.dispose();
  });

  it("reports a failed photo load", async () => {
    const model = new EnvironmentModel(new T.Group(), undefined, {
      load: () => Promise.reject(Error("offline")),
      show: () => {},
    });
    const error = vi.fn();
    model.update(withSet(), () => {}, error);
    await new Promise((done) => setTimeout(done));
    expect(error).toHaveBeenCalledWith("offline");
    expect(model.ready).toBe(false);
  });
});

/** An equirectangular sky of radiance 1 with a sun disc. */
function sky(width: number, height: number, sun?: T.Vector3, power = 5e4) {
  const data = new Float32Array(width * height * 4).fill(1);
  const direction = new T.Vector3();
  for (let row = 0; row < height; row++)
    for (let column = 0; column < width; column++) {
      texelDirection(column, row, width, height, direction);
      if (sun && direction.angleTo(sun) < 0.02) {
        const i = (row * width + column) * 4;
        data[i] = power;
        data[i + 1] = power * 0.9;
        data[i + 2] = power * 0.8;
      }
    }
  return data;
}

describe("photographed light", () => {
  it("finds the sun, moves it from the environment to a light, and darkens shadows", () => {
    const sun = new T.Vector3(0.4, 0.7, -0.5).normalize();
    const data = sky(1024, 512, sun);
    const light = extractSun(data, 1024, 512);
    expect(light.sun!.angleTo(sun)).toBeLessThan(0.02);
    expect(light.sunIntensity).toBeGreaterThan(5);
    expect(light.sunColor.r).toBeCloseTo(1);
    expect(light.sunColor.b).toBeCloseTo(0.8, 1);
    expect(data.reduce((a, b) => Math.max(a, b))).toBeLessThan(5e4 * 0.01);
    expect(light.shadowOpacity).toBeGreaterThan(0.5);
  });

  it("keeps an even sky in the environment with a soft overhead contact shadow", () => {
    const data = sky(256, 128);
    const light = extractSun(data, 256, 128);
    expect(light.sun).toBeNull();
    expect(light.key.y).toBeGreaterThan(0.85);
    expect(data.every((value) => value === 1)).toBe(true);
  });

  it("matches renderer exposure to the photographer's tonemapped panorama", () => {
    const hdr = {
      data: new Float32Array(64 * 32 * 4).fill(0.2),
      width: 64,
      height: 32,
    };
    const brighter = matchExposure(hdr, {
      data: new Uint8ClampedArray(64 * 32 * 4).fill(200),
      width: 64,
      height: 32,
    });
    const darker = matchExposure(hdr, {
      data: new Uint8ClampedArray(64 * 32 * 4).fill(60),
      width: 64,
      height: 32,
    });
    expect(brighter).toBeGreaterThan(darker * 2);
    expect(darker).toBeGreaterThan(0.05);
    expect(brighter).toBeLessThan(20);
  });
});

describe("camera in a photographic set", () => {
  const backdrop: NonNullable<Asset["backdrop"]> = {
    image: "/content/sets/x.jpg",
    height: 1.6,
    radius: 6,
    rotation: 0,
  };
  it("opens at the photographer's viewpoint, looking at the cast", () => {
    const home = backdropHome(backdrop);
    expect(home.position.y).toBe(backdrop.height);
    expect(home.position.distanceTo(backdropLimits(backdrop).center)).toBe(
      backdrop.height,
    );
    expect(home.position.z).toBeGreaterThanOrEqual(3);
    expect(home.target.x).toBe(0);
    expect(home.target.z).toBe(0);
    expect(keepInsideBackdrop(home.position.clone(), backdrop)).toBe(false);
    // Orbiting as far round the cast as allowed stays where the photo holds.
    const side = home.position
      .clone()
      .sub(home.target)
      .applyAxisAngle(new T.Vector3(0, 1, 0), home.azimuth)
      .add(home.target);
    expect(keepInsideBackdrop(side, backdrop)).toBe(false);
  });
  it("lets the orbit controls enforce every limit, so orbiting never dollies", () => {
    // Regression: the position clamp used to fire at the ceiling while the
    // creator orbited upward at full zoom-out, and the orbit's damping then
    // kept pulling the camera in for a second after the mouse was released.
    for (const set of photoSets) {
      const limits = backdropLimits(set.backdrop!);
      const { target, azimuth, minPolar, maxDistance } = limits;
      expect(maxDistance).toBeGreaterThanOrEqual(4.5);
      expect(maxDistance).toBeGreaterThan(
        backdropHome(set.backdrop!).position.distanceTo(target),
      );
      for (let i = 0; i <= 6; i++)
        for (let j = 0; j <= 6; j++)
          for (const radius of [2, maxDistance]) {
            const theta = -azimuth + (2 * azimuth * i) / 6;
            const phi = minPolar + ((ORBIT_MAX_POLAR - minPolar) * j) / 6;
            const position = new T.Vector3(
              Math.sin(phi) * Math.sin(theta),
              Math.cos(phi),
              Math.sin(phi) * Math.cos(theta),
            )
              .multiplyScalar(radius)
              .add(target);
            const before = position.clone();
            expect(keepInsideBackdrop(position, set.backdrop!)).toBe(false);
            expect(position.distanceTo(before)).toBe(0);
          }
    }
  });
  it("keeps orbiting and framing inside the dome and below a bird's-eye view", () => {
    const high = new T.Vector3(8, 6.5, 10);
    expect(keepInsideBackdrop(high, backdrop)).toBe(true);
    const { center, reach, ceiling } = backdropLimits(backdrop);
    expect(Math.hypot(high.x - center.x, high.z - center.z)).toBeCloseTo(reach);
    expect(high.y).toBe(ceiling);
    const below = new T.Vector3(0, -1, 1);
    keepInsideBackdrop(below, backdrop);
    expect(below.y).toBeGreaterThan(0);
  });
});

describe("exporting a photographic set", () => {
  it("packages the scene without needing the photo files", async () => {
    const { productionPackage } = await import("../src/productionPackage");
    const { readFile } = await import("node:fs/promises");
    const JSZip = (await import("jszip")).default;
    const requested: string[] = [];
    const read: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith("/engine/"))
        return new Response(await readFile("." + url));
      if (url.startsWith("/content/"))
        return new Response("Missing", { status: 404 });
      return new Response("bundled file");
    };
    const scene = withSet();
    const zip = await JSZip.loadAsync(
      await productionPackage(scene, new ArrayBuffer(8), read),
    );
    const saved = JSON.parse(await zip.file("scene.json")!.async("string"));
    expect(saved.environmentAssetId).toBe(photoSets[0].id);
    expect(requested.some((url) => url.startsWith("/content/"))).toBe(false);
  });
});
