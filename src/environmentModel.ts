import * as T from "three";
import { allAssets, type Asset, type Scene } from "../shared/scene";
import type { PhotoSet } from "./hdriBackdrop";
import { loadImportedAsset, type DownloadProgress } from "./importedAsset";
import {
  cameraRoom,
  clearHomeView,
  hasFloor,
  markSetCollision,
  measureCeiling,
  measureWalls,
  ModelSet,
  setBlockFor,
  type SetLight,
} from "./modelSet";
import { createEnvironment, disposeObject } from "./world";
import { obstacleMesh, snapshotCollider } from "./collision";
import { FLOOR_TOP } from "../shared/sets";

/** A standing body's reach from its centre and its height, for placing new
 * cast members clear of a set's furniture. */
const BODY_HALF_WIDTH = 0.28,
  BODY_HEIGHT = 1.7,
  /** How far above a hit point a furniture top still holds a prop. */
  RESTING_REACH = 0.06;

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
  light?: (url: string, signal?: AbortSignal) => Promise<SetLight>;
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
  /** The loaded 3D set's furniture within a standing body's height. */
  private furniture: T.Box3[] = [];
  /** The loaded 3D set's furniture meshes, which props can be put on. */
  surfaces: T.Mesh[] = [];
  private pending: AbortController | null = null;

  constructor(
    private content: T.Group,
    private load: (
      asset: Asset,
      progress?: DownloadProgress,
      signal?: AbortSignal,
    ) => Promise<T.Group> = loadImportedAsset,
    /** Without a viewer (tests, exports) a photographic set is an empty,
     * ready environment and a 3D set is loaded without its light. */
    private viewer?: EnvironmentViewer,
  ) {}

  /** The set the viewport shows: a photo, a 3D set, or the plain studio. */
  get view() {
    return this.photo ?? this.modelSet;
  }

  /** Would a body standing at this floor point touch the loaded 3D set's
   * furniture? New cast members are placed clear of it. */
  floorBlocked = (x: number, z: number) => {
    const body = new T.Box3(
      new T.Vector3(x - BODY_HALF_WIDTH, FLOOR_TOP, z - BODY_HALF_WIDTH),
      new T.Vector3(x + BODY_HALF_WIDTH, BODY_HEIGHT, z + BODY_HALF_WIDTH),
    );
    return this.furniture.some((box) => box.intersectsBox(body));
  };

  /** The height a prop put down on the set's furniture at this point rests
   * at: the highest furniture top there within a few centimetres above where
   * the pointer met it, so a soft or uneven top (a duvet, a cushion, a
   * bevelled edge) holds the prop instead of swallowing it. */
  restingHeight = (x: number, z: number, y: number) => {
    let top = y;
    for (const box of this.furniture)
      if (
        box.max.y > top &&
        box.max.y <= y + RESTING_REACH &&
        x >= box.min.x &&
        x <= box.max.x &&
        z >= box.min.z &&
        z <= box.max.z
      )
        top = box.max.y;
    return top;
  };

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
    const job = new AbortController();
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
    const library = asset.url.startsWith("/content/");
    // The HDR that lights the set loads beside the model; the set settles as
    // soon as both are in, and a model without a light settles at once.
    const light =
      asset.hdri && this.viewer?.light
        ? this.viewer.light(asset.hdri, job.signal)
        : null;
    light?.catch(() => {});
    this.load(
      asset,
      (received, total) => {
        if (this.pending === job) this.viewer?.progress?.({ received, total });
      },
      job.signal,
    ).then(async (object) => {
      let loaded: SetLight | null = null;
      let unlit = false;
      if (light)
        try {
          loaded = await light;
        } catch {
          unlit = true;
        }
      if (this.pending !== job) {
        disposeObject(object);
        loaded?.map.dispose();
        return;
      }
      // The set is still worth showing without its own light: the studio's
      // preset lights it instead.
      if (unlit)
        onError(
          `The light for ${asset.name} could not load, so the studio lights it for now.`,
        );
      object.name = "environment_" + asset.id;
      object.traverse((node) => {
        if (node instanceof T.Mesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      root.add(object);
      const staged = setBlockFor(asset, object);
      markSetCollision(object, staged);
      // A library set's home view is authored; a creator's is fitted to the
      // model's extent and may need moving to see the cast.
      const set = library ? staged : clearHomeView(object, staged);
      // An environment model without a floor (a facade, a prop used as a
      // backdrop) keeps the studio's floor under the cast.
      if (!hasFloor(object, set)) {
        const floor = createEnvironment("studio");
        floor.position.set(set.spawn[0], 0, set.spawn[2]);
        root.add(floor);
      }
      this.furniture = snapshotCollider(object, obstacleMesh).boxes.filter(
        (box) => box.max.y > FLOOR_TOP && box.min.y < BODY_HEIGHT,
      );
      this.surfaces = [];
      object.traverse((node) => {
        if (node instanceof T.Mesh && !node.userData.passable)
          this.surfaces.push(node);
      });
      // An interior keeps the camera inside its walls and under its ceiling;
      // a creator's own set counts as one when it has a ceiling over the cast.
      const ceiling =
        asset.style === "Outdoor" ? null : measureCeiling(object, set);
      const room =
        asset.style === "Indoor" || ceiling !== null
          ? cameraRoom(set, ceiling, measureWalls(object, set))
          : null;
      this.modelSet = new ModelSet(asset, set, loaded, room);
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
    // Stop downloading and parsing a set nobody waits for any more.
    loading?.abort();
    this.ready = false;
    this.key = "";
    if (loading) this.viewer?.progress?.(null);
    if (this.photo) {
      const photo = this.photo;
      this.photo = null;
      this.viewer?.show(null);
      photo.dispose();
    }
    this.furniture = [];
    this.surfaces = [];
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
