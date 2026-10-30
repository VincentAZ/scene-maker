import * as T from "three";
import type { Asset, Scene } from "../shared/scene";
import { loadImportedAsset } from "./importedAsset";
import { createEnvironment, disposeObject } from "./world";

export const environmentAsset = (scene: Scene) =>
  scene.customAssets.find((asset) => asset.id === scene.environmentAssetId);

// Include the URL, not just the scene revision or asset ID: an asset can be
// replaced while a previous download is still in flight.
export const environmentModelKey = (scene: Scene) =>
  JSON.stringify([
    scene.environment,
    scene.environmentAssetId ?? null,
    environmentAsset(scene)?.url ?? null,
  ]);

/** One environment, outside the entity/collider map but inside export content. */
export class EnvironmentModel {
  key = "";
  root: T.Group | null = null;
  ready = false;
  error: Error | null = null;
  private pending: object | null = null;

  constructor(
    private content: T.Group,
    private load: (asset: Asset) => Promise<T.Group> = loadImportedAsset,
  ) {}

  update(
    scene: Scene,
    settled: () => void,
    onError: (message: string) => void,
  ) {
    const key = environmentModelKey(scene);
    if (key === this.key) return;
    this.dispose();
    this.key = key;
    this.error = null;
    const asset = environmentAsset(scene);
    const root = createEnvironment(scene.environment);
    root.name = "SceneMakerEnvironment";
    this.root = root;
    this.content.add(root);
    if (!scene.environmentAssetId) {
      this.ready = true;
      settled();
      return;
    }
    const job = {};
    this.pending = job;
    const failed = (error: unknown) => {
      if (this.pending !== job) return;
      this.pending = null;
      this.error =
        error instanceof Error
          ? error
          : Error("Could not load the environment.");
      onError(this.error.message);
      settled();
    };
    if (!asset?.url) {
      failed(Error("The imported environment model is missing."));
      return;
    }
    this.load(asset).then((object) => {
      if (this.pending !== job) {
        disposeObject(object);
        return;
      }
      object.name = "environment_" + asset.id;
      object.traverse((node) => {
        if (node instanceof T.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      root.add(object);
      this.pending = null;
      this.ready = true;
      settled();
    }, failed);
  }

  dispose() {
    this.pending = null;
    this.ready = false;
    this.key = "";
    if (this.root) {
      this.content.remove(this.root);
      disposeObject(this.root);
      this.root = null;
    }
  }
}
