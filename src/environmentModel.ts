import * as T from "three";
import { allAssets, type Asset, type Scene } from "../shared/scene";
import type { PhotoSet } from "./hdriBackdrop";
import { loadImportedAsset, type DownloadProgress } from "./importedAsset";
import {
  loadSetLight,
  markSetCollision,
  ModelSet,
  setBlockFor,
  type SetLight,
} from "./modelSet";
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
    environmentAsset(scene)?.set ?? null,
  ]);

/** A photographic set: a 360° photo instead of a model. */
export const photoSetAsset = (scene: Scene) => {
  const asset = environmentAsset(scene);
  return asset?.hdri && !asset.url ? asset : undefined;
};

/** A real 3D set: a model the cast walks around in, from the library or the
 * creator's own files. */
export const modelSetAsset = (scene: Scene) => {
  const asset = environmentAsset(scene);
  return asset?.url ? asset : undefined;
};

/** What the viewport is told to show around the cast. */
export type EnvironmentViewer = {
  /** Loads a photographic set. */
  load: (asset: Asset) => Promise<PhotoSet>;
  /** Told whenever the shown set changes: a photo, a 3D set, or none. */
  show: (view: PhotoSet | ModelSet | null) => void;
  /** Loads the HDR that lights a 3D set. */
  light?: (url: string) => Promise<SetLight>;
  /** A 3D set's download so far, or null once it is in. */
  progress?: (state: { received: number; total: number } | null) => void;
};

/** One environment, outside the entity/collider map but inside export content. */
export class EnvironmentModel {
  key = "";
  root: T.Group | null = null;
  ready = false;
  error: Error | null = null;
  /** The loaded photographic set, shown and lit by the viewport. */
  photo: PhotoSet | null = null;
  /** The loaded 3D set's staging and light, applied by the viewport. */
  modelSet: ModelSet | null = null;
  private pending: object | null = null;

  constructor(
    private content: T.Group,
    private load: (
      asset: Asset,
      progress?: DownloadProgress,
    ) => Promise<T.Group> = loadImportedAsset,
    /** Without a viewer (tests, exports) a photographic set is an empty,
     * ready environment and a 3D set is loaded without its light. */
    private viewer?: EnvironmentViewer,
  ) {}

  /** The set the viewport shows: a photo, a 3D set, or the plain studio. */
  get view() {
    return this.photo ?? this.modelSet;
  }

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
    // A photographic set's floor is the photo itself, outside scene content,
    // and a 3D set brings its own floor: neither gets the studio slab, so
    // nothing but the set's own meshes collides or is exported.
    const root =
      photo || asset?.url
        ? new T.Group()
        : createEnvironment(scene.environment);
    root.name = "SceneMakerEnvironment";
    this.root = root;
    this.content.add(root);
    if (photo && !this.viewer) {
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
      this.viewer?.progress?.(null);
      this.error =
        error instanceof Error
          ? error
          : Error("Could not load the environment.");
      onError(this.error.message);
      settled();
    };
    if (photo && this.viewer) {
      const viewer = this.viewer;
      viewer.load(photo).then((loaded) => {
        if (this.pending !== job) {
          loaded.dispose();
          return;
        }
        this.photo = loaded;
        viewer.show(loaded);
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
    // The HDR that lights the set loads beside the model; the set settles as
    // soon as both are in, and a model without a light settles at once.
    const light =
      asset.hdri && this.viewer?.light ? this.viewer.light(asset.hdri) : null;
    light?.catch(() => {});
    this.load(asset, (received, total) => {
      if (this.pending === job) this.viewer?.progress?.({ received, total });
    }).then(async (object) => {
      let loaded: SetLight | null = null;
      if (light)
        try {
          loaded = await light;
        } catch (error) {
          disposeObject(object);
          failed(error);
          return;
        }
      if (this.pending !== job) {
        disposeObject(object);
        loaded?.map.dispose();
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
      const set = setBlockFor(asset, object);
      markSetCollision(object, set);
      this.modelSet = new ModelSet(asset, set, loaded);
      this.viewer?.progress?.(null);
      this.viewer?.show(this.modelSet);
      this.pending = null;
      this.ready = true;
      settled();
    }, failed);
  }

  dispose() {
    const loading = this.pending;
    this.pending = null;
    this.ready = false;
    this.key = "";
    if (loading) this.viewer?.progress?.(null);
    if (this.photo) {
      const photo = this.photo;
      this.photo = null;
      this.viewer?.show(null);
      photo.dispose();
    }
    if (this.modelSet) {
      const shown = this.modelSet;
      this.modelSet = null;
      this.viewer?.show(null);
      shown.dispose();
    }
    if (this.root) {
      this.content.remove(this.root);
      disposeObject(this.root);
      this.root = null;
    }
  }
}
