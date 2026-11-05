import * as T from "three";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
import type { Asset } from "../shared/scene";
import {
  defaultSetBlock,
  FLOOR_TOP,
  shellBox,
  type SetBlock,
} from "../shared/sets";
import { extractSun, type PhotoLight } from "./hdriBackdrop";

/** A 3D set's image-based light: its HDR with the sun moved to a light, and
 * how much light the rest of its sky throws on a level floor. */
export type SetLight = {
  map: T.Texture;
  sun: PhotoLight;
  skyIrradiance: number;
};

/** A loaded real 3D set: how it is staged, when its catalogue entry
 * provides an HDR the light that falls on it, and for an interior the room
 * the camera stays in. */
export class ModelSet {
  readonly bounds: T.Box3;
  constructor(
    readonly asset: Asset,
    readonly set: SetBlock,
    readonly light: SetLight | null,
    readonly room: T.Box3 | null = null,
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

/** Is there a floor under the cast: a mesh tagged "floor", or one whose top
 * is level with y = 0 and that spans the spawn point? A facade or a prop
 * used as a backdrop has none and keeps the studio's floor. */
export function hasFloor(model: T.Object3D, set: SetBlock) {
  model.updateWorldMatrix(true, true);
  const [x, , z] = set.spawn;
  let found = false;
  model.traverse((node) => {
    if (found || !(node instanceof T.Mesh)) return;
    for (let up: T.Object3D | null = node; up; up = up.parent)
      if (
        (up.userData.sceneMaker as { role?: unknown } | undefined)?.role ===
        "floor"
      ) {
        found = true;
        return;
      }
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const box = node.geometry
      .boundingBox!.clone()
      .applyMatrix4(node.matrixWorld);
    found =
      Math.abs(box.max.y) <= FLOOR_TOP &&
      box.min.x <= x &&
      box.max.x >= x &&
      box.min.z <= z &&
      box.max.z >= z;
  });
  return found;
}

/**
 * A creator's set opens on a clear view of the cast. When something stands
 * between the derived home camera and its target (the camera fitted behind
 * a wall), the camera moves to the first spot that sees the target: nearer
 * in the same direction, then around the target at the same height, always
 * inside the set and at least 1.5 m away.
 */
export function clearHomeView(model: T.Object3D, set: SetBlock): SetBlock {
  model.updateWorldMatrix(true, true);
  const target = new T.Vector3(...set.camera.target);
  const home = new T.Vector3(...set.camera.position).sub(target);
  const room = new T.Box3(
    new T.Vector3(...set.bounds.min),
    new T.Vector3(...set.bounds.max),
  ).expandByScalar(-WALL_GAP);
  const ray = new T.Raycaster();
  const clear = (offset: T.Vector3) => {
    const position = target.clone().add(offset);
    if (!room.containsPoint(position)) return false;
    ray.set(target, offset.clone().normalize());
    ray.far = offset.length();
    return !ray
      .intersectObject(model, true)
      .some((hit) => hit.point.y > FLOOR_TOP);
  };
  if (clear(home)) return set;
  const level = Math.hypot(home.x, home.z);
  // Nearer or around, the camera keeps its height.
  const spot = (turn: number, scale: number) =>
    home
      .clone()
      .applyAxisAngle(new T.Vector3(0, 1, 0), (turn * Math.PI) / 4)
      .multiply(new T.Vector3(scale, 1, scale));
  const candidates = [0.75, 0.5, 0.35].map((scale) => spot(0, scale));
  for (const turn of [1, -1, 2, -2, 3, -3, 4])
    for (const scale of [1, 0.75, 0.5]) candidates.push(spot(turn, scale));
  const found = candidates.find(
    (offset) =>
      Math.hypot(offset.x, offset.z) >= Math.min(1.5, level) && clear(offset),
  );
  if (!found) return set;
  const position = target.clone().add(found);
  return {
    ...set,
    camera: {
      ...set.camera,
      position: position.toArray().map((v) => Math.round(v * 1000) / 1000) as [
        number,
        number,
        number,
      ],
    },
  };
}

/** How close the camera may come to an interior's walls and ceiling. */
const WALL_GAP = 0.3,
  CEILING_GAP = 0.25;

/**
 * The height of an interior's ceiling over the cast: the lowest part of the
 * set's shell (not a hanging lamp) straight above the home view's target or
 * the spawn point, higher than a standing person. Null under an open sky.
 */
export function measureCeiling(model: T.Object3D, set: SetBlock) {
  model.updateWorldMatrix(true, true);
  const ray = new T.Raycaster();
  ray.far = 100;
  for (const [x, , z] of [set.camera.target, set.spawn]) {
    ray.set(new T.Vector3(x, 1.2, z), new T.Vector3(0, 1, 0));
    const hit = ray
      .intersectObject(model, true)
      .find((hit) => hit.object.userData.passable && hit.point.y > 1.9);
    if (hit) return hit.point.y;
  }
  return null;
}

/** The space an interior's camera stays in: the set's bounds less a gap
 * from the walls, and below its ceiling when it has one. */
export function cameraRoom(set: SetBlock, ceiling: number | null) {
  const { min, max } = set.bounds;
  const room = new T.Box3(
    new T.Vector3(min[0] + WALL_GAP, min[1], min[2] + WALL_GAP),
    new T.Vector3(
      max[0] - WALL_GAP,
      (ceiling ?? max[1]) - CEILING_GAP,
      max[2] - WALL_GAP,
    ),
  );
  return room.isEmpty() ? null : room;
}

/** How far a camera may stand from `target` in `direction` and still be in
 * the room; unlimited when the target is not in it. */
export function reachInRoom(
  room: T.Box3,
  target: T.Vector3,
  direction: T.Vector3,
) {
  if (!room.containsPoint(target)) return Infinity;
  const unit = direction.clone().normalize();
  let reach = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(unit[axis]) < 1e-9) continue;
    const wall = unit[axis] > 0 ? room.max[axis] : room.min[axis];
    reach = Math.min(reach, (wall - target[axis]) / unit[axis]);
  }
  return reach;
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

/** The light an equirectangular sky (linear RGBA) throws on a level floor:
 * its luminance over the upper half, weighted by the cosine to the floor. */
export function floorIrradiance(
  data: ArrayLike<number>,
  width: number,
  height: number,
) {
  let total = 0;
  for (let row = 0; row < height; row++) {
    const elevation = (0.5 - (row + 0.5) / height) * Math.PI;
    if (elevation <= 0) continue;
    const weight =
      Math.sin(elevation) *
      Math.cos(elevation) *
      ((2 * Math.PI) / width) *
      (Math.PI / height);
    for (let column = 0; column < width; column++) {
      const i = (row * width + column) * 4;
      total +=
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) *
        weight;
    }
  }
  return total;
}

/** Loads the HDR that lights a 3D set. Like a photographic set, a compact sun
 * is moved out of the map into the studio's key light so it casts shadows. */
export async function loadSetLight(
  url: string,
  signal?: AbortSignal,
): Promise<SetLight> {
  const response = await fetch(url, { signal });
  if (!response.ok)
    throw Error(`Could not download the set's light (${response.status}).`);
  const parsed = new HDRLoader()
    .setDataType(T.FloatType)
    .parse(await response.arrayBuffer());
  const { width, height } = parsed;
  const data = parsed.data as Float32Array;
  const sun = extractSun(data, width, height);
  const skyIrradiance = floorIrradiance(data, width, height);
  const half = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++)
    half[i] = T.DataUtils.toHalfFloat(data[i]);
  const map = new T.DataTexture(
    half,
    width,
    height,
    T.RGBAFormat,
    T.HalfFloatType,
    T.EquirectangularReflectionMapping,
  );
  map.colorSpace = T.LinearSRGBColorSpace;
  map.minFilter = map.magFilter = T.LinearFilter;
  map.generateMipmaps = false;
  map.flipY = true;
  map.needsUpdate = true;
  return { map, sun, skyIrradiance };
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

/** Beyond this half-size a set's shadow covers only the cast's surroundings,
 * so a 2048-texel shadow map stays sharp around them. */
const SHADOW_REACH = 30;

/**
 * Fits the sun's shadow to the stage: the studio's ±9 m box around the origin
 * by default, or a box around a set's bounds — around its spawn point within
 * SHADOW_REACH when the set is larger — with the light far enough out to see
 * all of it from its direction.
 */
export function fitSunShadow(
  sun: T.DirectionalLight,
  direction: T.Vector3,
  bounds: T.Box3 | null,
  focus?: T.Vector3,
) {
  const half = bounds ? bounds.getSize(new T.Vector3()).length() / 2 : 9;
  const radius = bounds ? Math.min(SHADOW_REACH, Math.max(9, half)) : 9;
  const centre = !bounds
    ? new T.Vector3(0, 0, 0)
    : half > SHADOW_REACH && focus
      ? bounds.clampPoint(focus, new T.Vector3())
      : bounds.getCenter(new T.Vector3());
  const distance = bounds ? radius + 6 : 15;
  sun.position
    .copy(centre)
    .addScaledVector(direction.clone().normalize(), distance);
  sun.target.position.copy(centre);
  sun.target.updateMatrixWorld();
  const near = 0.1,
    far = bounds ? distance + radius + 1 : 30;
  Object.assign(sun.shadow.camera, {
    left: -radius,
    right: radius,
    top: radius,
    bottom: -radius,
    near,
    far,
  });
  sun.shadow.camera.updateProjectionMatrix();
  // three.js adds the bias in the shadow's depth range (0 at near, 1 at far):
  // keep it 3 cm whatever the box, and offset half a texel along the normal.
  sun.shadow.bias = -0.03 / (far - near);
  sun.shadow.normalBias = radius / sun.shadow.mapSize.x;
}
