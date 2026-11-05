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
import { recordedStanding } from "../shared/motionLibrary";
import { embeddedHumanoidMapping } from "./vrmHumanoid";

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

/** Animation-only files (an armature without a mesh, e.g. a "without skin"
 * export) load their joints as plain nodes, because only skins mark nodes as
 * bones. Promote the animated joint hierarchy to bones so the rig can be
 * recognised: every non-mesh node at or below the topmost animated nodes.
 * Files that already have bones, and meshes/cameras/lights, are untouched.
 * UUIDs, names, transforms and child order are kept. */
function promoteAnimatedJoints(root: T.Object3D, clips: T.AnimationClip[]) {
  let hasBones = false;
  root.traverse((n) => {
    if (n instanceof T.Bone) hasBones = true;
  });
  if (hasBones || !clips.length) return;
  const plain = (n: T.Object3D) =>
    n.constructor === T.Object3D || n.constructor === T.Group;
  const animated = new Set<T.Object3D>();
  for (const clip of clips)
    for (const track of clip.tracks) {
      const node = T.PropertyBinding.findNode(
        root,
        T.PropertyBinding.parseTrackName(track.name).nodeName,
      );
      if (node instanceof T.Object3D && node !== root && plain(node))
        animated.add(node);
    }
  const tops = [...animated].filter((node) => {
    for (let p = node.parent; p && p !== root; p = p.parent)
      if (animated.has(p)) return false;
    return true;
  });
  const joints: T.Object3D[] = [];
  for (const top of tops)
    top.traverse((n) => {
      if (plain(n)) joints.push(n);
    });
  for (const node of joints) {
    const bone = new T.Bone();
    bone.uuid = node.uuid;
    bone.name = node.name;
    bone.position.copy(node.position);
    bone.quaternion.copy(node.quaternion);
    bone.scale.copy(node.scale);
    bone.userData = node.userData;
    const parent = node.parent!;
    const index = parent.children.indexOf(node);
    for (const child of [...node.children]) bone.add(child);
    parent.children[index] = bone;
    bone.parent = parent;
    node.parent = null;
  }
}

/** The rotation that brings a character's body axis (hips to head) onto +Y
 * when it lies along another axis (a Z-up export, a capture lying down), or
 * undefined for an upright body. Leaning poses stay as authored. */
function uprightCorrection(group: T.Group) {
  const bones = group.userData.bones as Record<string, T.Object3D> | undefined;
  if (!bones?.hips || !bones.head) return;
  group.updateMatrixWorld(true);
  const up = group
    .worldToLocal(bones.head.getWorldPosition(new T.Vector3()))
    .sub(group.worldToLocal(bones.hips.getWorldPosition(new T.Vector3())));
  if (up.lengthSq() < 1e-12) return;
  const axis = new T.Vector3();
  const [k] = (["x", "y", "z"] as const)
    .map((a) => [a, Math.abs(up[a])] as const)
    .sort((p, q) => q[1] - p[1])[0];
  axis[k] = Math.sign(up[k]);
  if (k === "y" && axis.y > 0) return;
  return new T.Quaternion().setFromUnitVectors(axis, new T.Vector3(0, 1, 0));
}

/** Grounding and, given a `height` (characters), a uniform size that makes
 * the subject that many metres tall, applied on a node outside the animation
 * hierarchy so authored transforms keep their units. */
function normalize(
  normalization: T.Object3D,
  subject: T.Object3D,
  height: number | undefined,
) {
  normalization.scale.setScalar(1);
  normalization.position.set(0, 0, 0);
  normalization.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(subject);
  // An armature without a mesh has no geometric bounds: use its joints.
  if (bounds.isEmpty()) {
    subject.updateMatrixWorld(true);
    subject.traverse((n) => {
      if (n instanceof T.Bone)
        bounds.expandByPoint(n.getWorldPosition(new T.Vector3()));
    });
  }
  const measured = bounds.max.y - bounds.min.y;
  const factor = height ? height / (measured || 1) : 1;
  normalization.scale.setScalar(factor);
  normalization.position.y = -bounds.min.y * factor;
  normalization.updateMatrixWorld(true);
}

/** Quarter turns that bring a character's anatomical forward (left-to-right
 * across the hips, crossed with up) to +Z, or 0 within 45 degrees of it. */
function facingCorrection(group: T.Group) {
  const bones = group.userData.bones as Record<string, T.Object3D> | undefined;
  const left = bones?.leftLeg ?? bones?.leftArm,
    right = bones?.rightLeg ?? bones?.rightArm;
  if (!left || !right) return 0;
  group.updateMatrixWorld(true);
  const across = group
    .worldToLocal(left.getWorldPosition(new T.Vector3()))
    .sub(group.worldToLocal(right.getWorldPosition(new T.Vector3())));
  across.y = 0;
  if (across.lengthSq() < 1e-12) return 0;
  const forward = new T.Vector3().crossVectors(
    across.normalize(),
    new T.Vector3(0, 1, 0),
  );
  const yaw = Math.atan2(forward.x, forward.z);
  return Math.abs(yaw) <= Math.PI / 4
    ? 0
    : -Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
}

export function prepareImportedAsset(
  asset: Asset,
  gltf: Pick<GLTF, "scene" | "animations"> & { parser?: unknown },
): T.Group {
  const group = new T.Group(),
    imported = gltf.scene;
  // A VRM file declares its own humanoid joints; the user's mapping refines it.
  const declared =
    asset.category === "characters" ? embeddedHumanoidMapping(gltf) : undefined;
  const rigMapping = declared
    ? { ...declared, ...asset.rigMapping }
    : asset.rigMapping;
  repairOpaqueImportedMaterials(imported);
  if (asset.category === "characters")
    promoteAnimatedJoints(imported, gltf.animations);
  imported.traverse((object) => {
    // SkinnedMesh bounds are cached, but captured travel can move the entire
    // body through its bones without moving the mesh node. A bind/earlier-pose
    // sphere can then reject a body that is visibly inside the camera. Keep
    // skins drawable without rescanning every deformed vertex each frame.
    if (object instanceof T.SkinnedMesh) object.frustumCulled = false;
  });
  let content: T.Object3D = imported;
  // A character stands at its recorded height, or 1.85 m; props keep their size.
  const height =
    asset.category === "characters" ? (asset.height ?? 1.85) : undefined;
  // Keep node UUIDs: original animation tracks may bind to unnamed nodes.
  // Rooms must keep their authored transforms: grounding by bounds can lift
  // a whole interior when its foundation extends below the floor.
  if (asset.category !== "environments") {
    // Normalize outside the animation hierarchy. Provider-authored transforms
    // (and tracks targeting them) must retain their original units and values.
    const normalization = new T.Group();
    normalization.add(imported);
    normalize(normalization, imported, height);
    content = normalization;
  }
  group.add(content);
  if (asset.category === "characters") {
    const configure = () =>
      configureImportedRig(
        group,
        content,
        gltf.animations,
        imported,
        rigMapping,
      );
    configure();
    // A body lying along another axis (Z-up export or capture) is stood up
    // on a node outside the animation hierarchy, then measured again.
    const tilt = uprightCorrection(group);
    if (tilt) {
      const orient = new T.Group();
      orient.quaternion.copy(tilt);
      content.remove(imported);
      orient.add(imported);
      content.add(orient);
      normalize(content, orient, height);
      configure();
    }
    // glTF assets face +Z, and placement, routes and in-place stride
    // measurement rely on it. A character authored in another convention
    // (facing -Z or sideways) is turned by the nearest quarter turn outside the
    // animation hierarchy, so its tracks keep their values, then configured
    // again. Small artistic yaw in a bind pose is left alone.
    const turn = facingCorrection(group);
    if (turn) {
      content.rotation.y += turn;
      content.updateMatrixWorld(true);
      configure();
    }
  } else {
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

/** Preload measured standing candidates for automatic routes. Export dependency
 * collection still includes only performances actually used by saved clips. */
export function planningMotionSources(scene: Scene, entity: Entity): Asset[] {
  const required = requiredMotionSources(scene, entity);
  const motions = allMotions(scene);
  if (
    !entity.clips.some(
      (clip) =>
        clip.navigation &&
        motions.some(
          (motion) => motion.id === clip.motionId && motion.kind === "imported",
        ),
    )
  )
    return required;
  const ids = new Set(required.map((asset) => asset.id));
  for (const motion of recordedStanding) {
    const asset = resolveMotionSource(scene, motion.sourceAssetId);
    if (asset && asset.id !== entity.assetId && !ids.has(asset.id)) {
      required.push(asset);
      ids.add(asset.id);
    }
  }
  return required;
}

export async function loadPlanningMotionSources(
  scene: Scene,
  entity: Entity,
  load: (asset: Asset) => Promise<T.Group>,
): Promise<Map<string, T.Group>> {
  const required = new Set(
    requiredMotionSources(scene, entity).map((asset) => asset.id),
  );
  const loaded = await Promise.all(
    planningMotionSources(scene, entity).map(async (asset) => {
      try {
        return [asset.id, await load(asset)] as const;
      } catch (error) {
        // Optional standing is an improvement to a playable gait, not permission
        // to hide the character when its extra source cannot be downloaded.
        if (required.has(asset.id)) throw error;
        return undefined;
      }
    }),
  );
  return new Map(loaded.filter((entry) => entry !== undefined));
}
