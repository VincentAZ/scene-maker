import * as T from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { Asset } from "../shared/scene";
import { defaultSetBlock, shellBox, type SetBlock } from "../shared/sets";
import { extractSun, type PhotoLight } from "./hdriBackdrop";

/** A 3D set's image-based light: its HDR with the sun moved to a light. */
export type SetLight = { map: T.Texture; sun: PhotoLight };

/** A loaded real 3D set: how it is staged and, when its catalogue entry
 * provides an HDR, the light that falls on it. */
export class ModelSet {
  readonly bounds: T.Box3;
  constructor(
    readonly asset: Asset,
    readonly set: SetBlock,
    readonly light: SetLight | null,
  ) {
    this.bounds = new T.Box3(
      new T.Vector3(...set.bounds.min),
      new T.Vector3(...set.bounds.max),
    );
  }

  dispose() {
    this.light?.map.dispose();
  }
}

/** The set's staging: its catalogue block, or one derived from the model's
 * extent for a creator's own file. */
export function setBlockFor(asset: Asset, model: T.Object3D): SetBlock {
  if (asset.set) return asset.set;
  model.updateWorldMatrix(true, true);
  const bounds = new T.Box3().setFromObject(model, true);
  if (bounds.isEmpty())
    bounds.set(new T.Vector3(-4, 0, -4), new T.Vector3(4, 3, 4));
  return defaultSetBlock({
    min: bounds.min.toArray(),
    max: bounds.max.toArray(),
  });
}

/** The studio's home view in a 3D set: its authored camera, orbiting freely
 * around the target down to the floor, no further out than the set allows. */
export function setHome(set: SetBlock) {
  return {
    position: new T.Vector3(...set.camera.position),
    target: new T.Vector3(...set.camera.target),
    maxDistance: set.camera.maxDistance ?? 25,
  };
}

/** Loads the HDR that lights a 3D set. Like a photographic set, a compact sun
 * is moved out of the map into the studio's key light so it casts shadows. */
export async function loadSetLight(url: string): Promise<SetLight> {
  const hdr = await new HDRLoader().setDataType(T.FloatType).loadAsync(url);
  const { width, height } = hdr.image as { width: number; height: number };
  const data = hdr.image.data as Float32Array;
  const sun = extractSun(data, width, height);
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++)
    half[i] = T.DataUtils.toHalfFloat(data[i]);
  hdr.image.data = half;
  hdr.type = T.HalfFloatType;
  hdr.mapping = T.EquirectangularReflectionMapping;
  hdr.needsUpdate = true;
  return { map: hdr, sun };
}

/** A mesh's part in the set, from the glTF extras its author tagged on it or
 * on a parent (`sceneMaker.role`), otherwise from where its box lies in the
 * set (`shellBox`): the floor, rugs, a ceiling and a room built as one mesh
 * are shell; the rest is furniture. */
export function setMeshRole(
  mesh: T.Mesh,
  set: SetBlock,
): "shell" | "furniture" {
  for (let node: T.Object3D | null = mesh; node; node = node.parent) {
    const role = (node.userData.sceneMaker as { role?: unknown } | undefined)
      ?.role;
    if (role === "shell" || role === "floor") return "shell";
    if (role === "furniture") return "furniture";
  }
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  return shellBox(box.min.toArray(), box.max.toArray(), set)
    ? "shell"
    : "furniture";
}

/** Marks which of a loaded set's meshes stop the cast (`userData.passable`
 * on the rest), so collisions and routes read the decision, not the model. */
export function markSetCollision(model: T.Object3D, set: SetBlock) {
  model.updateWorldMatrix(true, true);
  model.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.userData.passable =
      set.collision === "none" || setMeshRole(node, set) === "shell";
  });
}

/**
 * Fits the sun's shadow to the stage: the studio's ±9 m box around the origin
 * by default, or a box around a set's bounds, with the light far enough out
 * to see all of it from its direction.
 */
export function fitSunShadow(
  sun: T.DirectionalLight,
  direction: T.Vector3,
  bounds: T.Box3 | null,
) {
  const centre = bounds
    ? bounds.getCenter(new T.Vector3())
    : new T.Vector3(0, 0, 0);
  const radius = bounds
    ? Math.min(60, Math.max(9, bounds.getSize(new T.Vector3()).length() / 2))
    : 9;
  const distance = bounds ? radius + 6 : 15;
  sun.position
    .copy(centre)
    .addScaledVector(direction.clone().normalize(), distance);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  Object.assign(sun.shadow.camera, {
    left: -radius,
    right: radius,
    top: radius,
    bottom: -radius,
    near: 0.1,
    far: bounds ? distance + radius + 1 : 30,
  });
  sun.shadow.camera.updateProjectionMatrix();
}
