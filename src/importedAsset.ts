import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import {
  resolveMotionSource,
  allMotions,
  type Asset,
  type Entity,
  type Scene,
} from "../shared/scene";
import { configureImportedRig } from "./rig";
import { repairOpaqueImportedMaterials } from "./importedMaterials";

// Imported files are immutable per URL, so the bytes are downloaded once and
// kept for the session. Each use is parsed separately: original animation
// tracks may bind to unnamed nodes by UUID, so copies cannot share one parse.
const downloads = new Map<string, Promise<ArrayBuffer>>();
const DOWNLOAD_CACHE_LIMIT = 24;
let loader: GLTFLoader | undefined;
function downloadModel(url: string): Promise<ArrayBuffer> {
  let pending = downloads.get(url);
  if (!pending) {
    pending = fetch(url).then((response) => {
      if (!response.ok)
        throw Error(`Could not download the model file (${response.status}).`);
      return response.arrayBuffer();
    });
    pending.catch(() => {
      if (downloads.get(url) === pending) downloads.delete(url);
    });
    downloads.set(url, pending);
    while (downloads.size > DOWNLOAD_CACHE_LIMIT)
      downloads.delete(downloads.keys().next().value!);
  }
  return pending;
}

export async function loadImportedAsset(asset: Asset): Promise<T.Group> {
  if (!asset.url)
    throw Error(`Reimport ${asset.name} to use its original motions.`);
  const bytes = await downloadModel(asset.url);
  loader ??= new GLTFLoader();
  // Parse from a copy: geometry attributes keep views into the parsed buffer.
  const gltf = await loader.parseAsync(
    bytes.slice(0),
    T.LoaderUtils.extractUrlBase(asset.url),
  );
  return prepareImportedAsset(asset, gltf);
}

export function prepareImportedAsset(
  asset: Asset,
  gltf: Pick<GLTF, "scene" | "animations">,
): T.Group {
  const group = new T.Group(),
    imported = gltf.scene;
  repairOpaqueImportedMaterials(imported);
  let content: T.Object3D = imported;
  // Keep node UUIDs: original animation tracks may bind to unnamed nodes.
  // Rooms must keep their authored transforms: grounding by bounds can lift
  // a whole interior when its foundation extends below the floor.
  if (asset.category !== "environments") {
    const bounds = new T.Box3().setFromObject(imported);
    const height = bounds.max.y - bounds.min.y;
    // Normalize outside the animation hierarchy. Provider-authored transforms
    // (and tracks targeting them) must retain their original units and values.
    const normalization = new T.Group();
    const factor = asset.category === "characters" ? 1.85 / (height || 1) : 1;
    normalization.scale.setScalar(factor);
    normalization.position.y = -bounds.min.y * factor;
    normalization.add(imported);
    content = normalization;
  }
  group.add(content);
  if (asset.category === "characters")
    configureImportedRig(
      group,
      content,
      gltf.animations,
      imported,
      asset.rigMapping,
    );
  else {
    group.userData.mixer = new T.AnimationMixer(imported);
    group.userData.animations = gltf.animations;
  }
  return group;
}

export function requiredMotionSources(scene: Scene, entity: Entity): Asset[] {
  const used = new Set(entity.clips.map((clip) => clip.motionId));
  const sourceIds = new Set(
    allMotions(scene)
      .filter(
        (motion) =>
          used.has(motion.id) &&
          motion.kind === "imported" &&
          motion.sourceAssetId !== entity.assetId,
      )
      .map((motion) => motion.sourceAssetId),
  );
  return [...sourceIds].flatMap((id) => {
    const asset = resolveMotionSource(scene, id);
    return asset ? [asset] : [];
  });
}
