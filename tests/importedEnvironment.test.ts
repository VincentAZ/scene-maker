import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  applyCommands,
  assetSchema,
  starterScene,
  validateScene,
  type Asset,
  type Scene,
} from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { EnvironmentModel, environmentModelKey } from "../src/environmentModel";
import { exportSnapshot } from "../src/exportSnapshot";
import { bakeAnimation } from "../src/bakeAnimation";
import { disposeObject } from "../src/world";
import { setAssets } from "../shared/setLayouts";

const asset = assetSchema.parse({
  id: "generated-room",
  name: "Generated room",
  category: "environments",
  style: "generated",
  color: "#ffffff",
  url: "/uploads/generated-room.glb",
});
const importedScene = (): Scene =>
  applyCommands(starterScene(), [
    { type: "createAsset", asset },
    { type: "add", assetId: asset.id },
  ]);
const room = () => {
  const root = new T.Group();
  root.position.set(4, -2, 7);
  root.rotation.set(0.1, 0.4, -0.2);
  root.scale.set(2, 3, 4);
  const mesh = new T.Mesh(
    new T.BoxGeometry(8, 6, 10),
    new T.MeshStandardMaterial(),
  );
  mesh.position.set(1, -1, 2);
  root.add(mesh);
  return { scene: root, animations: [] };
};
const deferred = () => {
  let resolve!: (group: T.Group) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T.Group>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe("imported environment scene selection", () => {
  it("places an imported set without creating an entity and removes furnished dressing", () => {
    const furnished = applyCommands(starterScene(), [
      { type: "add", assetId: setAssets[0].id },
    ]);
    expect(furnished.entities.some((entity) => entity.setDressing)).toBe(true);
    const scene = applyCommands(furnished, [
      { type: "createAsset", asset },
      { type: "add", assetId: asset.id },
    ]);
    expect(scene.entities.some((entity) => entity.setDressing)).toBe(false);
    expect(scene.environmentAssetId).toBe(asset.id);
  });

  it("uses a studio base and preserves manually placed objects", () => {
    const original = starterScene();
    original.entities[2].setDressing = true;
    const scene = applyCommands(original, [
      { type: "createAsset", asset },
      { type: "add", assetId: asset.id },
    ]);
    expect(scene.environment).toBe("studio");
    expect(scene.environmentAssetId).toBe(asset.id);
    expect(scene.entities).toHaveLength(original.entities.length - 1);
    expect(scene.entities.some((entity) => entity.assetId === asset.id)).toBe(
      false,
    );
    expect(scene.entities[0]).toEqual(original.entities[0]);
    expect(original.environmentAssetId).toBeUndefined();
  });

  it("clears the imported selection when adding a built-in environment", () => {
    for (const builtin of ["studio", "park", "cafe"]) {
      const scene = applyCommands(importedScene(), [
        { type: "add", assetId: builtin },
      ]);
      expect(scene.environment).toBe(builtin);
      expect(scene.environmentAssetId).toBeUndefined();
    }
  });

  it("supports scene commands for selecting and explicitly clearing the environment", () => {
    const scene = importedScene();
    const selected = applyCommands(
      { ...scene, environmentAssetId: undefined, environment: "cafe" },
      [{ type: "scene", changes: { environmentAssetId: asset.id } }],
    );
    expect(selected.environmentAssetId).toBe(asset.id);
    expect(selected.environment).toBe("studio");
    expect(
      applyCommands(selected, [
        { type: "scene", changes: { environment: "studio" } },
      ]).environmentAssetId,
    ).toBeUndefined();
    expect(
      applyCommands(selected, [
        { type: "scene", changes: { environmentAssetId: null } },
      ]).environmentAssetId,
    ).toBeNull();
    expect(
      applyCommands(selected, [
        { type: "scene", changes: { lighting: "moonlight" } },
      ]).environmentAssetId,
    ).toBe(asset.id);
  });

  it("rejects dangling, non-environment, URL-less, and incompatible references", () => {
    const scene = importedScene();
    for (const id of ["missing", "studio", "mila"]) {
      expect(() => validateScene({ ...scene, environmentAssetId: id })).toThrow(
        "custom environment asset",
      );
    }
    expect(() =>
      validateScene({
        ...scene,
        customAssets: [{ ...asset, category: "props" }],
      }),
    ).toThrow("custom environment asset");
    expect(() =>
      validateScene({ ...scene, customAssets: [{ ...asset, url: undefined }] }),
    ).toThrow("custom environment asset");
    expect(() => validateScene({ ...scene, environment: "cafe" })).toThrow(
      "studio base",
    );
    expect(() =>
      applyCommands(scene, [
        { type: "scene", changes: { environmentAssetId: "missing" } },
      ]),
    ).toThrow();
  });

  it("continues to accept legacy scene JSON without an environment asset", () => {
    const scene = starterScene();
    expect(validateScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene);
    expect(
      validateScene({ ...scene, environmentAssetId: null }).environmentAssetId,
    ).toBeNull();
  });
});

describe("imported environment lifecycle", () => {
  it("retains authored positions, rotations, and nonuniform real-world scale", () => {
    const gltf = room();
    const before = gltf.scene.matrix.clone();
    gltf.scene.updateMatrix();
    before.copy(gltf.scene.matrix);
    const prepared = prepareImportedAsset(asset, gltf);
    prepared.updateMatrixWorld(true);
    expect(prepared.children[0].matrix.elements).toEqual(before.elements);
    expect(prepared.position.toArray()).toEqual([0, 0, 0]);
    expect(new T.Box3().setFromObject(prepared).min.y).toBeLessThan(0);
    disposeObject(prepared);
  });

  it("still grounds props and normalizes characters", () => {
    for (const category of ["props", "characters"] as const) {
      const scene = new T.Group();
      scene.add(
        new T.Mesh(new T.BoxGeometry(1, 4, 1), new T.MeshStandardMaterial()),
      );
      const prepared = prepareImportedAsset(
        { ...asset, category },
        { scene, animations: [] },
      );
      const bounds = new T.Box3().setFromObject(prepared);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.getSize(new T.Vector3()).y).toBeCloseTo(
        category === "characters" ? 1.85 : 4,
      );
      disposeObject(prepared);
    }
  });

  it("shows a character at its recorded height and leaves a prop's alone", () => {
    for (const category of ["characters", "props"] as const) {
      const scene = new T.Group();
      scene.add(
        new T.Mesh(new T.BoxGeometry(1, 4, 1), new T.MeshStandardMaterial()),
      );
      const prepared = prepareImportedAsset(
        { ...asset, category, height: 1.43 },
        { scene, animations: [] },
      );
      const bounds = new T.Box3().setFromObject(prepared);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.getSize(new T.Vector3()).y).toBeCloseTo(
        category === "characters" ? 1.43 : 4,
      );
      disposeObject(prepared);
    }
  });

  it("preserves provider root transforms and animated units during normalization", () => {
    const scene = new T.Group();
    scene.name = "ProviderRoot";
    scene.position.set(2, 3, 4);
    scene.scale.set(0.01, 0.02, 0.01);
    scene.add(new T.Mesh(new T.BoxGeometry(100, 200, 100)));
    const clip = new T.AnimationClip("Root travel", 1, [
      new T.VectorKeyframeTrack(
        "ProviderRoot.position",
        [0, 1],
        [2, 3, 4, 2, 5, 4],
      ),
    ]);
    const prepared = prepareImportedAsset(
      { ...asset, category: "characters" },
      { scene, animations: [clip] },
    );
    expect(scene.position.toArray()).toEqual([2, 3, 4]);
    expect(scene.scale.toArray()).toEqual([0.01, 0.02, 0.01]);
    const bounds = new T.Box3().setFromObject(prepared);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.getSize(new T.Vector3()).y).toBeCloseTo(1.85);
    const before = scene.getWorldPosition(new T.Vector3());
    const mixer = prepared.userData.mixer as T.AnimationMixer;
    mixer.clipAction(clip).setLoop(T.LoopOnce, 1).play();
    mixer.setTime(0.5);
    const after = scene.getWorldPosition(new T.Vector3());
    expect(after.y - before.y).toBeCloseTo(1.85 / 4);
    expect(scene.scale.toArray()).toEqual([0.01, 0.02, 0.01]);
  });

  it("waits for the model, retains it across lighting changes, and includes it in snapshot/bake content", async () => {
    const job = deferred(),
      load = vi.fn(() => job.promise);
    const content = new T.Group(),
      model = new EnvironmentModel(content, load);
    const settled = vi.fn(),
      error = vi.fn(),
      scene = importedScene();
    model.update(scene, settled, error);
    expect(model.ready).toBe(false);
    const imported = prepareImportedAsset(asset, room());
    job.resolve(imported);
    await job.promise;
    expect(model.ready).toBe(true);
    expect(settled).toHaveBeenCalledOnce();
    expect(imported.parent).toBe(model.root);
    expect(content.children).toContain(model.root);
    model.update(
      { ...scene, lighting: "moonlight", revision: 1 },
      settled,
      error,
    );
    expect(load).toHaveBeenCalledOnce();
    const animation = bakeAnimation([model.root!], 0.1, () => {});
    const snapshot = exportSnapshot(content);
    expect(snapshot.getObjectByName("environment_" + asset.id)).toBeDefined();
    expect(
      animation.tracks.some((track) => track.name.startsWith(model.root!.uuid)),
    ).toBe(true);
    const originalBounds = new T.Box3().setFromObject(content);
    expect(new T.Box3().setFromObject(snapshot).equals(originalBounds)).toBe(
      true,
    );
    model.dispose();
    expect(snapshot.getObjectByName("environment_" + asset.id)).toBeDefined();
    disposeObject(snapshot);
  });

  it("disposes a stale completion after switching to a built-in set", async () => {
    const job = deferred(),
      content = new T.Group();
    const model = new EnvironmentModel(content, () => job.promise);
    const settled = vi.fn(),
      error = vi.fn();
    model.update(importedScene(), settled, error);
    model.update(starterScene(), settled, error);
    const imported = prepareImportedAsset(asset, room());
    const mesh = imported.children[0].children[0] as T.Mesh;
    const dispose = vi.spyOn(mesh.geometry, "dispose");
    job.resolve(imported);
    await job.promise;
    expect(dispose).toHaveBeenCalledOnce();
    expect(model.ready).toBe(true);
    expect(imported.parent).toBeNull();
    expect(settled).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    model.dispose();
  });

  it("includes URLs in identity and ignores older loads at the same scene revision", async () => {
    const first = deferred(),
      second = deferred();
    const load = vi
      .fn<(asset: Asset) => Promise<T.Group>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const content = new T.Group(),
      model = new EnvironmentModel(content, load);
    const scene = importedScene(),
      changed = {
        ...scene,
        customAssets: [{ ...asset, url: "/uploads/replaced-room.glb" }],
      };
    expect(environmentModelKey(scene)).not.toBe(environmentModelKey(changed));
    const error = vi.fn();
    model.update(scene, () => {}, error);
    model.update(changed, () => {}, error);
    const latest = prepareImportedAsset(asset, room());
    second.resolve(latest);
    await second.promise;
    first.reject(Error("Old load failed"));
    await first.promise.catch(() => {});
    expect(latest.parent).toBe(model.root);
    expect(model.ready).toBe(true);
    expect(model.error).toBeNull();
    expect(error).not.toHaveBeenCalled();
    model.dispose();
  });

  it("reports current failures without claiming readiness and disposes loads after unmount", async () => {
    const failed = deferred(),
      model = new EnvironmentModel(new T.Group(), () => failed.promise);
    const error = vi.fn(),
      settled = vi.fn();
    model.update(importedScene(), settled, error);
    failed.reject(Error("Environment unavailable"));
    await failed.promise.catch(() => {});
    expect(model.ready).toBe(false);
    expect(model.error?.message).toBe("Environment unavailable");
    expect(error).toHaveBeenCalledWith("Environment unavailable");
    model.dispose();
    const pending = deferred(),
      unmounted = new EnvironmentModel(new T.Group(), () => pending.promise);
    unmounted.update(importedScene(), settled, error);
    unmounted.dispose();
    const imported = prepareImportedAsset(asset, room());
    const dispose = vi.spyOn(
      (imported.children[0].children[0] as T.Mesh).geometry,
      "dispose",
    );
    pending.resolve(imported);
    await pending.promise;
    expect(dispose).toHaveBeenCalledOnce();
    expect(unmounted.ready).toBe(false);
  });
});
