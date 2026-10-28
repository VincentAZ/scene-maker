import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  allAssets,
  allMotions,
  type Asset,
  type Entity,
  type Scene,
} from "../shared/scene";
import { configureImportedRig } from "./rig";

export async function loadImportedAsset(asset: Asset): Promise<T.Group> {
  if (!asset.url)
    throw Error(`Reimport ${asset.name} to use its original motions.`);
  const gltf = await new GLTFLoader().loadAsync(asset.url);
  const group = new T.Group(),
    imported = gltf.scene;
  // Keep node UUIDs: original animation tracks may bind to unnamed nodes.
  const bounds = new T.Box3().setFromObject(imported);
  const height = bounds.max.y - bounds.min.y;
  imported.scale.setScalar(
    asset.category === "characters" ? 1.85 / (height || 1) : 1,
  );
  imported.position.y = -bounds.min.y * imported.scale.y;
  group.add(imported);
  if (asset.category === "characters")
    configureImportedRig(group, imported, gltf.animations);
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
  return allAssets(scene).filter((asset) => sourceIds.has(asset.id));
}
