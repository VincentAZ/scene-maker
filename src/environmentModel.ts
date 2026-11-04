import * as T from "three";
import { allAssets, type Asset, type Scene } from "../shared/scene";
import type { PhotoSet } from "./hdriBackdrop";
import { loadImportedAsset } from "./importedAsset";
import { createEnvironment, disposeObject } from "./world";

export const environmentAsset = (scene: Scene) =>
  allAssets(scene).find((asset) => asset.id === scene.environmentAssetId);

// Include the URL, not just the scene revision or asset ID: an asset can be
// replaced while a previous download is still in flight.
export const environmentModelKey = (scene: Scene) =>
  JSON.stringify([
    scene.environment,
    scene.environmentAssetId ?? null,
    environmentAsset(scene)?.url ?? null,
    environmentAsset(scene)?.hdri ?? null,
    environmentAsset(scene)?.backdrop ?? null,
  ]);

/** A photographic set: a 360° photo instead of a model. */
export const photoSetAsset = (scene: Scene) => {
  const asset = environmentAsset(scene);
  return asset?.hdri && !asset.url ? asset : undefined;
};

/** One environment, outside the entity/collider map but inside export content. */
export class EnvironmentModel {
  key = "";
  root: T.Group | null = null;
  ready = false;
  error: Error | null = null;
  /** The loaded photographic set, shown and lit by the viewport. */
  photo: PhotoSet | null = null;
  private pending: object | null = null;

  constructor(
    private content: T.Group,
    private load: (asset: Asset) => Promise<T.Group> = loadImportedAsset,
    /** Loads a photographic set; without one (tests, exports) the set is an
     * empty, ready environment. `show` is told whenever `photo` changes. */
    private photos?: {
      load: (asset: Asset) => Promise<PhotoSet>;
      show: (photo: PhotoSet | null) => void;
    },
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
    const photo = photoSetAsset(scene);
    // A photographic set's floor is the photo itself, outside scene content:
    // the environment root stays empty, so nothing collides or is exported.
    const root = photo ? new T.Group() : createEnvironment(scene.environment);
    root.name = "SceneMakerEnvironment";
    this.root = root;
    this.content.add(root);
    if (photo && !this.photos) {
      this.ready = true;
      settled();
      return;
    }
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
    if (photo && this.photos) {
      const photos = this.photos;
      photos.load(photo).then((loaded) => {
        if (this.pending !== job) {
          loaded.dispose();
          return;
        }
        this.photo = loaded;
        photos.show(loaded);
        this.pending = null;
        this.ready = true;
        settled();
      }, failed);
      return;
    }
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
    if (this.photo) {
      const photo = this.photo;
      this.photo = null;
      this.photos?.show(null);
      photo.dispose();
    }
    if (this.root) {
      this.content.remove(this.root);
      disposeObject(this.root);
      this.root = null;
    }
  }
}
