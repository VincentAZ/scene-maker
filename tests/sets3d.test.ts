import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  applyCommands,
  assetSchema,
  blankScene,
  starterScene,
  validateScene,
  type Asset,
  type Scene,
} from "../shared/scene";
import {
  defaultSetBlock,
  insidePolygon,
  onWalkableFloor,
  setSchema,
  spawnPosition,
  type SetBlock,
} from "../shared/sets";
import { creditGroups, contentCredits } from "../shared/contentLibrary";
import {
  EnvironmentModel,
  modelSetAsset,
  photoSetAsset,
} from "../src/environmentModel";
import {
  fitSunShadow,
  markSetCollision,
  ModelSet,
  setBlockFor,
  setHome,
  setMeshRole,
} from "../src/modelSet";
import { applyStageLighting } from "../src/stageLighting";
import { obstacleMesh, snapshotCollider } from "../src/collision";
import {
  sceneCollisionWarning,
  sceneObstacles,
} from "../src/assetManipulation";
import { extractSun } from "../src/hdriBackdrop";
import { disposeObject } from "../src/world";

const classroom: SetBlock = {
  camera: { position: [0, 1.6, 5], target: [0, 1, 0], maxDistance: 12 },
  bounds: { min: [-5, -0.1, -4], max: [5, 3.2, 6] },
  spawn: [0, 0, 0],
  heading: Math.PI / 2,
  walkable: [
    [-4, -3],
    [4, -3],
    [4, 5],
    [-4, 5],
  ],
  collision: "furniture",
  lighting: { exposure: 1.1, sun: [1, 2, 1], sunIntensity: 3, sky: true },
};
const set: Asset = {
  id: "set-classroom",
  name: "Classroom",
  category: "environments",
  style: "Indoor",
  color: "#9aa58f",
  skin: "#c99a7c",
  body: "masculine",
  description: "A classroom, 10 × 10 m.",
  url: "/content/sets/set-classroom.glb",
  thumbnail: "/content/sets/set-classroom.png",
  hdri: "/content/sets/set-classroom.hdr",
  set: classroom,
};
const withSet = (asset = set): Scene =>
  applyCommands(blankScene(), [
    { type: "createAsset", asset },
    { type: "add", assetId: asset.id },
  ]);

/** A room: a 10 × 8 m floor and ceiling, a thin wall, a chair and a table. */
function room() {
  const material = new T.MeshStandardMaterial();
  const mesh = (name: string, size: [number, number, number], y: number) => {
    const m = new T.Mesh(new T.BoxGeometry(...size), material);
    m.name = name;
    m.position.y = y;
    return m;
  };
  const root = new T.Group();
  root.add(
    mesh("floor", [10, 0.1, 8], -0.05),
    mesh("ceiling", [10, 0.1, 8], 3),
    mesh("wall", [10, 3, 0.2], 1.5),
    mesh("chair", [0.5, 1, 0.5], 0.5),
    mesh("table", [1.8, 0.8, 0.9], 0.4),
  );
  return root;
}
const names = (root: T.Object3D) =>
  snapshotCollider(root, obstacleMesh).boxes.map(
    (box) =>
      root.children.find((child) =>
        new T.Box3().setFromObject(child).equals(box),
      )!.name,
  );
const lights = () => {
  const world = new T.Scene();
  world.add(new T.HemisphereLight(), new T.DirectionalLight());
  return world;
};
const renderer = () => ({ toneMappingExposure: 1 }) as T.WebGLRenderer;
const light = (sun?: T.Vector3) => {
  const data = new Float32Array(64 * 32 * 4).fill(1);
  if (sun) {
    const i = (8 * 64 + 16) * 4;
    data[i] = data[i + 1] = data[i + 2] = 5e4;
  }
  return { map: new T.Texture(), sun: extractSun(data, 64, 32) };
};

describe("3D set catalogue schema", () => {
  it("accepts a set with a model, its HDR light and a staging block", () => {
    expect(() => assetSchema.parse(set)).not.toThrow();
    expect(() => setSchema.parse({ ...classroom, collision: undefined })).not
      .toThrow;
    const scene = withSet();
    expect(scene.environment).toBe("studio");
    expect(scene.environmentAssetId).toBe(set.id);
    expect(validateScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(modelSetAsset(scene)?.id).toBe(set.id);
    expect(photoSetAsset(scene)).toBeUndefined();
  });

  it("rejects malformed staging", () => {
    const bad = (changes: object) =>
      expect(() => setSchema.parse({ ...classroom, ...changes })).toThrow();
    bad({ bounds: { min: [0, 0, 0], max: [0, 3, 4] } });
    bad({ bounds: { min: [5, 0, 0], max: [-5, 3, 4] } });
    bad({
      walkable: [
        [0, 0],
        [1, 1],
      ],
    });
    bad({ collision: "walls" });
    bad({ lighting: { exposure: 100 } });
    bad({ lighting: { sun: [0, 0, 0] } });
    bad({ spawn: [40, 0, 0] });
    bad({ camera: { position: [0, 1, 0], target: [0, 1, 0], maxDistance: 1 } });
    expect(() => assetSchema.parse({ ...set, url: undefined })).toThrow(
      "model file",
    );
    expect(() => assetSchema.parse({ ...set, category: "props" })).toThrow(
      "model file",
    );
  });
});

describe("a 3D set in the environment model", () => {
  it("brings its own floor, applies its home view and light, and reports download progress", async () => {
    const content = new T.Group();
    const model = room();
    let progress!: (received: number, total: number) => void;
    const load = vi.fn((_asset: Asset, report?: typeof progress) => {
      progress = report!;
      return Promise.resolve(model);
    });
    const show = vi.fn(),
      loaded = light(),
      reported: ({ received: number; total: number } | null)[] = [];
    const environment = new EnvironmentModel(content, load, {
      load: () => Promise.reject(Error("not a photo")),
      show,
      light: vi.fn(() => Promise.resolve(loaded)),
      progress: (state) => reported.push(state),
    });
    const settled = vi.fn();
    environment.update(withSet(), settled, () => {});
    // No studio slab under a 3D set: the root waits, empty, for the model.
    expect(environment.root?.children).toHaveLength(0);
    progress(5, 20);
    expect(reported).toEqual([{ received: 5, total: 20 }]);
    await new Promise((done) => setTimeout(done));
    expect(environment.ready).toBe(true);
    expect(settled).toHaveBeenCalledOnce();
    expect(model.parent).toBe(environment.root);
    expect(environment.root?.children).toEqual([model]);
    expect(reported.at(-1)).toBeNull();
    const shown = show.mock.lastCall?.[0] as ModelSet;
    expect(shown).toBeInstanceOf(ModelSet);
    expect(shown.set).toEqual(classroom);
    expect(shown.light).toBe(loaded);
    expect(environment.view).toBe(shown);
    const home = setHome(shown.set);
    expect(home.position.toArray()).toEqual([0, 1.6, 5]);
    expect(home.target.toArray()).toEqual([0, 1, 0]);
    expect(home.maxDistance).toBe(12);
    // The shell never blocks; the furniture keeps its boxes.
    expect(names(model)).toEqual(["wall", "chair", "table"]);
    environment.update(starterScene(), settled, () => {});
    expect(show).toHaveBeenLastCalledWith(null);
    expect(environment.modelSet).toBeNull();
  });

  it("derives staging for a creator's own model and loads it without a light", async () => {
    const own: Asset = { ...set, id: "own", url: "/uploads/own.glb" };
    delete own.set;
    delete own.hdri;
    const model = room();
    model.position.set(3, 0, 2);
    const show = vi.fn();
    const environment = new EnvironmentModel(
      new T.Group(),
      () => Promise.resolve(model),
      { load: () => Promise.reject(Error("not a photo")), show },
    );
    environment.update(
      withSet(own),
      () => {},
      () => {},
    );
    await new Promise((done) => setTimeout(done));
    const shown = show.mock.lastCall?.[0] as ModelSet;
    expect(shown.light).toBeNull();
    expect(shown.set.bounds).toEqual({
      min: [-2, -0.1, -2],
      max: [8, 3.05, 6],
    });
    // The authored origin lies on the floor plan, so the cast starts there,
    // seen from eye height inside the room.
    expect(shown.set.spawn).toEqual([0, 0, 0]);
    expect(shown.set.camera.position[1]).toBe(1.6);
    expect(shown.set.camera.position[2]).toBeLessThan(6);
    expect(shown.set.camera.position[2]).toBeGreaterThanOrEqual(1.5);
    expect(shown.set.collision).toBe("furniture");
    expect(() => setSchema.parse(shown.set)).not.toThrow();
  });

  it("puts the cast at the floor's centre when the origin is off the plan", () => {
    const block = defaultSetBlock({ min: [10, 0, 10], max: [20, 3, 18] });
    expect(block.spawn).toEqual([15, 0, 14]);
    expect(block.camera.target.slice(0, 1)).toEqual([15]);
    const flat = defaultSetBlock({ min: [-3, 0, -3], max: [3, 0, 3] });
    expect(flat.bounds.max[1]).toBeGreaterThan(flat.bounds.min[1]);
    expect(() => setSchema.parse(flat)).not.toThrow();
  });
});

describe("lighting a 3D set", () => {
  it("lights the model with its HDR, shows it as the sky when asked, and fits the shadow to the set", () => {
    const world = lights(),
      gpu = renderer();
    const loaded = light(new T.Vector3(1, 1, 0));
    const view = new ModelSet(set, classroom, loaded);
    applyStageLighting(world, gpu, "daylight", view);
    expect(world.environment).toBe(loaded.map);
    expect(world.background).toBe(loaded.map);
    expect(world.fog).toBeNull();
    expect(gpu.toneMappingExposure).toBe(1.1);
    const sun = world.children.find(
      (o) => o instanceof T.DirectionalLight,
    ) as T.DirectionalLight;
    const sky = world.children.find(
      (o) => o instanceof T.HemisphereLight,
    ) as T.HemisphereLight;
    expect(sun.intensity).toBe(3);
    expect(sky.intensity).toBe(0);
    // The authored sun direction wins over the measured one.
    const direction = sun.position.clone().sub(sun.target.position).normalize();
    expect(direction.angleTo(new T.Vector3(1, 2, 1))).toBeLessThan(1e-6);
    expect(sun.target.position.toArray()).toEqual([0, 1.55, 1]);
    // A set smaller than the studio's ±9 m box keeps that box; a larger one
    // gets a box around its own half-diagonal.
    expect(sun.shadow.camera.right).toBe(9);
    const hall = new ModelSet(
      set,
      { ...classroom, bounds: { min: [-20, 0, -15], max: [20, 6, 15] } },
      loaded,
    );
    applyStageLighting(world, gpu, "daylight", hall);
    const radius = new T.Vector3(40, 6, 30).length() / 2;
    expect(sun.shadow.camera.right).toBeCloseTo(radius);
    expect(sun.shadow.camera.far).toBeGreaterThan(radius * 2);
    expect(sun.target.position.toArray()).toEqual([0, 3, 0]);
  });

  it("falls back to the preset lights with the set's notes and no fog", () => {
    const world = lights(),
      gpu = renderer();
    const notes = {
      ...classroom,
      lighting: { hemisphere: 1.2, sunIntensity: 2 },
    };
    applyStageLighting(world, gpu, "moonlight", new ModelSet(set, notes, null));
    const sun = world.children.find(
      (o) => o instanceof T.DirectionalLight,
    ) as T.DirectionalLight;
    const sky = world.children.find(
      (o) => o instanceof T.HemisphereLight,
    ) as T.HemisphereLight;
    expect(world.environment).toBeNull();
    expect(world.background).toBeInstanceOf(T.Color);
    expect(world.fog).toBeNull();
    expect(sky.intensity).toBe(1.2);
    expect(sun.intensity).toBe(2);
    expect(sun.color.getHexString()).toBe("a6c5ef");
    applyStageLighting(
      world,
      gpu,
      "daylight",
      new ModelSet(set, { ...classroom, lighting: { fog: true } }, null),
    );
    expect(world.fog).toBeInstanceOf(T.Fog);
    expect(sun.intensity).toBe(4);
    // Back on the studio stage the shadow box is the fixed ±9 m again.
    applyStageLighting(world, gpu, "daylight", null);
    expect(sun.shadow.camera.right).toBe(9);
    expect(sun.shadow.camera.far).toBe(30);
    expect(sun.target.position.toArray()).toEqual([0, 0, 0]);
    expect(world.fog).toBeInstanceOf(T.Fog);
  });

  it("keeps the default shadow geometry for the studio", () => {
    const sun = new T.DirectionalLight();
    fitSunShadow(sun, new T.Vector3(-3, 8, 4), null);
    expect(sun.shadow.camera.left).toBe(-9);
    expect(sun.position.length()).toBeCloseTo(15);
  });
});

describe("shell and furniture in a 3D set", () => {
  it("tells the shell from furniture by footprint and by tags", () => {
    const model = room();
    model.updateWorldMatrix(true, true);
    const [floor, ceiling, wall, chair, table] = model.children as T.Mesh[];
    expect(setMeshRole(floor)).toBe("shell");
    expect(setMeshRole(ceiling)).toBe("shell");
    expect(setMeshRole(wall)).toBe("furniture");
    expect(setMeshRole(chair)).toBe("furniture");
    expect(setMeshRole(table)).toBe("furniture");
    wall.userData.sceneMaker = { role: "shell" };
    expect(setMeshRole(wall)).toBe("shell");
    // A tag on a parent group covers every mesh below it.
    const rug = new T.Group();
    rug.userData.sceneMaker = { role: "floor" };
    rug.add(chair);
    model.add(rug);
    expect(setMeshRole(chair)).toBe("shell");
    table.userData.sceneMaker = { role: "furniture" };
    table.scale.set(10, 1, 10);
    model.updateWorldMatrix(true, true);
    expect(setMeshRole(table)).toBe("furniture");
  });

  it("marks what blocks so collisions, warnings and routes skip the shell", () => {
    const model = room();
    markSetCollision(model, classroom);
    expect(names(model)).toEqual(["wall", "chair", "table"]);
    const scene = withSet();
    const actor = new T.Group();
    actor.add(new T.Mesh(new T.BoxGeometry(0.6, 1.8, 0.6)));
    actor.children[0].position.y = 0.9;
    actor.position.set(3, 0, 2);
    const objects = new Map([["actor", actor]]);
    scene.entities = [
      {
        ...starterScene().entities[0],
        id: "actor",
        name: "Actor",
        position: [3, 0, 2],
        clips: [],
      },
    ];
    // Standing on the floor under the ceiling is not a collision.
    expect(
      sceneCollisionWarning(sceneObstacles(scene, objects, undefined, model)),
    ).toBe("");
    actor.position.set(0, 0, 0);
    expect(
      sceneCollisionWarning(sceneObstacles(scene, objects, undefined, model)),
    ).toContain("the backdrop");
    markSetCollision(model, { ...classroom, collision: "none" });
    expect(names(model)).toEqual([]);
    expect(
      sceneCollisionWarning(sceneObstacles(scene, objects, undefined, model)),
    ).toBe("");
  });
});

describe("spawn and drops on a set's floor", () => {
  it("places new cast members around the spawn point, turned to the heading, on open floor", () => {
    const scene = withSet();
    const placed = applyCommands(scene, [
      { type: "add", assetId: "mila" },
      { type: "add", assetId: "leo" },
    ]);
    expect(placed.entities[0].rotation).toBe(Math.PI / 2);
    // Grid cell (-1.5, 0) turned a quarter turn: across becomes depth.
    expect(placed.entities[0].position[0]).toBeCloseTo(0);
    expect(placed.entities[0].position[2]).toBeCloseTo(1.5);
    expect(placed.entities[1].position[2]).toBeCloseTo(0.5);
    for (const entity of placed.entities)
      expect(
        insidePolygon(
          entity.position[0],
          entity.position[2],
          classroom.walkable!,
        ),
      ).toBe(true);
    expect(spawnPosition(undefined, 0)).toEqual([-1.5, 0, 0]);
    expect(spawnPosition(undefined, 5)).toEqual([-0.5, 0, 1]);
  });

  it("keeps a chosen spot inside the walkable floor", () => {
    const dropped = applyCommands(withSet(), [
      { type: "add", assetId: "mila", position: [9, 0, -7] },
    ]);
    const [x, , z] = dropped.entities[0].position;
    expect(x).toBeCloseTo(4, 1);
    expect(z).toBeCloseTo(-3, 1);
    expect(insidePolygon(x, z, classroom.walkable!)).toBe(true);
    expect(onWalkableFloor(1, 1, classroom.walkable!)).toEqual([1, 1]);
    const [ex, ez] = onWalkableFloor(0, 9, classroom.walkable!);
    expect(ex).toBeCloseTo(0);
    expect(ez).toBeCloseTo(5, 1);
    expect(insidePolygon(ex, ez, classroom.walkable!)).toBe(true);
    // A concave floor plan: the nudge stays on the inside of the edge.
    const l: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ];
    const [lx, lz] = onWalkableFloor(3, 3, l);
    expect(insidePolygon(lx, lz, l)).toBe(true);
    // Both inner edges are two metres away; the point lands on one of them.
    expect(Math.min(Math.abs(lx - 1), Math.abs(lz - 1))).toBeLessThan(0.02);
  });

  it("uses the studio grid when the scene has no 3D set", () => {
    const scene = applyCommands(blankScene(), [
      { type: "add", assetId: "mila" },
    ]);
    expect(scene.entities[0].position).toEqual([-1.5, 0, 0]);
    expect(scene.entities[0].rotation).toBe(0);
  });
});

describe("library credits", () => {
  it("groups every credited character, prop and set by its collection", () => {
    const groups = creditGroups();
    const total = groups.reduce((n, group) => n + group.items.length, 0);
    expect(total).toBe(contentCredits.size);
    const polyHaven = groups.find((g) => g.collection === "Poly Haven")!;
    expect(polyHaven.licenses).toEqual(["CC0"]);
    expect(new Set(polyHaven.items.map((item) => item.category))).toEqual(
      new Set(["props", "environments"]),
    );
    const rocketbox = groups.find(
      (g) => g.collection === "Microsoft Rocketbox",
    )!;
    expect(
      rocketbox.items.every((item) => item.category === "characters"),
    ).toBe(true);
    for (const item of [...polyHaven.items, ...rocketbox.items]) {
      expect(item.author).toBeTruthy();
      expect(item.source).toMatch(/^https:\/\//);
      expect([
        "CC0",
        "MIT",
        "CC BY",
        "CC BY 4.0",
        "CC BY 3.0",
        "CC BY-SA 4.0",
        "CC BY-SA 3.0",
      ]).toContain(item.license);
    }
    // Props and sets of one collection are sorted by category, then name.
    const categories = polyHaven.items.map((item) => item.category);
    expect(categories.indexOf("environments")).toBeGreaterThan(
      categories.lastIndexOf("props"),
    );
  });
});

describe("packaging a 3D set", () => {
  it("ships a library set's files and credit with the production package", async () => {
    const { productionPackage } = await import("../src/productionPackage");
    const { readFile } = await import("node:fs/promises");
    const JSZip = (await import("jszip")).default;
    const { contentAssets } = await import("../shared/contentLibrary");
    // Stand in for a catalogue set until the first batch lands.
    const library = contentAssets.find((asset) => asset.id === set.id);
    if (!library) {
      contentAssets.push(set);
      contentCredits.set(set.id, {
        author: "Christophe Seux",
        license: "CC0",
        source: "https://www.blender.org/download/demo-files/",
      });
    }
    try {
      const read: typeof fetch = async (input) => {
        const url = String(input);
        if (url.startsWith("/engine/"))
          return new Response(await readFile("." + url));
        if (url.startsWith("/content/sets/")) return new Response("set bytes");
        return new Response("Missing", { status: 404 });
      };
      const scene = { ...blankScene(), environmentAssetId: set.id };
      const zip = await JSZip.loadAsync(
        await productionPackage(scene, new ArrayBuffer(8), read),
      );
      expect(
        await zip.file("assets/sets/set-classroom.glb")!.async("string"),
      ).toBe("set bytes");
      expect(zip.file("assets/sets/set-classroom.hdr")).not.toBeNull();
      expect(
        await zip.file("assets/sets/CREDITS.txt")!.async("string"),
      ).toContain("Christophe Seux");
    } finally {
      if (!library) {
        contentAssets.splice(contentAssets.indexOf(set), 1);
        contentCredits.delete(set.id);
      }
    }
  });
});

it("disposes a set's light with the set", () => {
  const loaded = light();
  const dispose = vi.spyOn(loaded.map, "dispose");
  new ModelSet(set, classroom, loaded).dispose();
  expect(dispose).toHaveBeenCalledOnce();
  disposeObject(room());
  expect(setBlockFor(set, room())).toBe(classroom);
});
