import { beforeEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { characters, type Asset } from "../shared/scene";
import { configureImportedRig } from "../src/rig";
import { loadImportedAsset } from "../src/importedAsset";
import { loadRouteGait } from "../src/useRouteGait";

vi.mock("../src/importedAsset", () => ({ loadImportedAsset: vi.fn() }));
const sourceAsset: Asset = {
  ...characters[0],
  id: "source",
  name: "Original performer",
  url: "/source.glb",
};
const actorAsset: Asset = {
  ...sourceAsset,
  id: "actor",
  name: "Actor",
  url: "/actor.glb",
};
beforeEach(() => vi.resetAllMocks());

/** An actual imported hierarchy and root-travel track, not a fake profile. */
function gaitRig(size = 1, travel = 4) {
  const group = new T.Group(),
    imported = new T.Group(),
    root = new T.Group();
  imported.scale.setScalar(size);
  group.add(imported);
  imported.add(root);
  const bones: Record<string, T.Bone> = {};
  const add = (
    name: string,
    parent: string | undefined,
    x: number,
    y: number,
    z = 0,
  ) => {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    (parent ? bones[parent] : root).add(bone);
    bones[name] = bone;
  };
  add("hips", undefined, 0, 0.95);
  add("spine", "hips", 0, 0.2);
  add("head", "spine", 0, 0.5);
  for (const [side, sign] of [
    ["left", 1],
    ["right", -1],
  ] as const) {
    add(`${side}Arm`, "spine", sign * 0.25, 0.3);
    add(`${side}Forearm`, `${side}Arm`, 0, -0.3);
    add(`${side}Hand`, `${side}Forearm`, 0, -0.25);
    add(`${side}Leg`, "hips", sign * 0.12, -0.05);
    add(`${side}Shin`, `${side}Leg`, 0, -0.42);
    add(`${side}Foot`, `${side}Shin`, 0, -0.42, 0.08);
  }
  const clip = new T.AnimationClip("Walk", 2, [
    new T.VectorKeyframeTrack(
      `${root.uuid}.position`,
      [0, 1, 2],
      [0, 0, 0, 0, 0, travel / 2, 0, 0, travel],
    ),
  ]);
  configureImportedRig(group, imported, [clip]);
  return { group, root, bones, clip };
}
function trackedResources(group: T.Group) {
  const texture = new T.Texture(),
    geometry = new T.BoxGeometry();
  const material = new T.MeshStandardMaterial({
    map: texture,
    normalMap: texture,
  });
  const material2 = new T.MeshStandardMaterial({ map: texture });
  group.add(
    new T.Mesh(geometry, [material, material2]),
    new T.Mesh(geometry, material),
  );
  return {
    geometry: vi.spyOn(geometry, "dispose"),
    texture: vi.spyOn(texture, "dispose"),
    material: vi.spyOn(material, "dispose"),
    material2: vi.spyOn(material2, "dispose"),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

describe("isolated route gait measurement", () => {
  it("returns a measured backward entry frame for the selected source window", async () => {
    const source = gaitRig(1, -4);
    vi.mocked(loadImportedAsset).mockResolvedValue(source.group);
    const cycle = await loadRouteGait(
      sourceAsset,
      sourceAsset,
      "Walk",
      undefined,
      { start: 0.4, end: 1.4 },
    );
    expect(Math.abs(cycle.entryHeading!)).toBeCloseTo(Math.PI, 8);
    expect(cycle.duration).toBeCloseTo(1, 8);
    expect(cycle.distance).toBeCloseTo(2, 6);
  });
  it.each([0.9, 1.1])(
    "measures step length %s without changing source duration",
    async (strideScale) => {
      const source = gaitRig(),
        actor = gaitRig(1.4);
      vi.mocked(loadImportedAsset).mockImplementation(async (asset) =>
        asset.id === sourceAsset.id ? source.group : actor.group,
      );
      const cycle = await loadRouteGait(
        sourceAsset,
        actorAsset,
        "Walk",
        undefined,
        { start: 0.4, end: 1.4 },
        strideScale,
      );
      expect(cycle.duration).toBeCloseTo(1, 8);
      expect(cycle.distance).toBeCloseTo(2 * 1.4 * strideScale, 6);
      expect(cycle.samples!.at(-1)!.distance).toBeCloseTo(cycle.distance, 8);
      expect(cycle.samples!.at(-1)!.time).toBeCloseTo(1, 8);
    },
  );
  it.each([0.89, 1.11, NaN, Infinity])(
    "rejects invalid step length %s before loading assets",
    async (strideScale) => {
      await expect(
        loadRouteGait(
          sourceAsset,
          actorAsset,
          "Walk",
          undefined,
          undefined,
          strideScale,
        ),
      ).rejects.toThrow(/step length/);
      expect(loadImportedAsset).not.toHaveBeenCalled();
    },
  );
  it("loads the original source and target actor and measures full native duration with target proportions", async () => {
    const source = gaitRig(),
      actor = gaitRig(2);
    const resources = trackedResources(source.group),
      targetResources = trackedResources(actor.group);
    source.root.position.set(1, 2, 3);
    source.bones.leftArm.rotation.x = 0.4;
    const savedRoot = source.root.position.clone(),
      savedArm = source.bones.leftArm.quaternion.clone();
    vi.mocked(loadImportedAsset).mockImplementation(async (asset) =>
      asset.id === sourceAsset.id ? source.group : actor.group,
    );
    const cycle = await loadRouteGait(sourceAsset, actorAsset, "Walk");
    expect(loadImportedAsset).toHaveBeenCalledWith(sourceAsset);
    expect(loadImportedAsset).toHaveBeenCalledWith(actorAsset);
    expect(cycle.duration).toBe(2);
    expect(cycle.distance).toBeCloseTo(8, 5);
    expect(source.root.position.toArray()).toEqual(savedRoot.toArray());
    expect(source.bones.leftArm.quaternion.toArray()).toEqual(
      savedArm.toArray(),
    );
    for (const dispose of [
      ...Object.values(resources),
      ...Object.values(targetResources),
    ])
      expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("loads native actor/source only once and never applies the retarget ratio twice", async () => {
    const source = gaitRig(2);
    const resources = trackedResources(source.group);
    vi.mocked(loadImportedAsset).mockResolvedValue(source.group);
    const cycle = await loadRouteGait(sourceAsset, sourceAsset, "Walk");
    expect(loadImportedAsset).toHaveBeenCalledTimes(1);
    expect(cycle.duration).toBe(2);
    expect(cycle.distance).toBeCloseTo(8, 5);
    Object.values(resources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
  });

  it("measures natural pace from the selected source window", async () => {
    const source = gaitRig(2);
    vi.mocked(loadImportedAsset).mockResolvedValue(source.group);
    const cycle = await loadRouteGait(
      sourceAsset,
      sourceAsset,
      "Walk",
      undefined,
      { start: 0.6, end: 1.1 },
    );
    expect(cycle.duration).toBeCloseTo(0.5, 10);
    expect(cycle.distance).toBeCloseTo(2, 5);
    expect(cycle.samples![0].time).toBe(0);
    expect(cycle.samples!.at(-1)!.time).toBeCloseTo(0.5, 10);
  });

  it("creates a procedural target locally rather than fetching an absent model", async () => {
    const source = gaitRig();
    vi.mocked(loadImportedAsset).mockResolvedValue(source.group);
    const cycle = await loadRouteGait(sourceAsset, characters[0], "Walk");
    expect(cycle.duration).toBe(2);
    expect(cycle.distance).toBeGreaterThan(0);
    expect(loadImportedAsset).toHaveBeenCalledTimes(1);
  });

  it("disposes loaded and late assets after cancellation without measuring a stale rig", async () => {
    const source = gaitRig(),
      actor = gaitRig();
    const sourceResources = trackedResources(source.group),
      targetResources = trackedResources(actor.group);
    const pending = deferred<T.Group>(),
      controller = new AbortController();
    vi.mocked(loadImportedAsset)
      .mockResolvedValueOnce(source.group)
      .mockReturnValueOnce(pending.promise);
    const measurement = loadRouteGait(
      sourceAsset,
      actorAsset,
      "Walk",
      controller.signal,
    );
    const failed = expect(measurement).rejects.toThrow();
    await Promise.resolve();
    controller.abort();
    Object.values(sourceResources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
    Object.values(targetResources).forEach((dispose) =>
      expect(dispose).not.toHaveBeenCalled(),
    );
    pending.resolve(actor.group);
    await failed;
    Object.values(sourceResources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
    Object.values(targetResources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
  });

  it("reports a source load failure and frees a target that resolves after failure", async () => {
    const target = gaitRig();
    const resources = trackedResources(target.group);
    const pending = deferred<T.Group>();
    vi.mocked(loadImportedAsset)
      .mockRejectedValueOnce(new Error("404 missing"))
      .mockReturnValueOnce(pending.promise);
    await expect(
      loadRouteGait(sourceAsset, actorAsset, "Walk"),
    ).rejects.toThrow(
      "Could not load gait source “Original performer”: 404 missing",
    );
    pending.resolve(target.group);
    await pending.promise;
    Object.values(resources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
  });

  it("reports missing native clips and unmeasurable strides instead of returning a guessed pace", async () => {
    const missing = gaitRig();
    vi.mocked(loadImportedAsset).mockResolvedValueOnce(missing.group);
    await expect(
      loadRouteGait(sourceAsset, sourceAsset, "Removed"),
    ).rejects.toThrow("original animation “Removed” is unavailable");
    const idle = gaitRig(1, 0),
      resources = trackedResources(idle.group);
    vi.mocked(loadImportedAsset).mockResolvedValueOnce(idle.group);
    await expect(
      loadRouteGait(sourceAsset, sourceAsset, "Walk"),
    ).rejects.toThrow("no reliable locomotion stride");
    Object.values(resources).forEach((dispose) =>
      expect(dispose).toHaveBeenCalledTimes(1),
    );
    await expect(loadRouteGait(undefined, actorAsset, "Walk")).rejects.toThrow(
      "source is unavailable",
    );
  });
});
