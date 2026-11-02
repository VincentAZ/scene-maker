import * as T from "three";

type Side = "left" | "right";
type Surface = { mesh: T.Mesh; indices: number[] }[];
type FootSurfaces = {
  left: Surface;
  right: Surface;
  contact: Record<Side, Surface>;
  floor: number;
};
/** A skeleton without any mesh (BVH, animation-only export): points on the
 * bind floor under the foot and each joint below it, carried by that joint,
 * so they roll with heel and toe like a sole. Used only as a transfer
 * source's ground clearance; native playback and route contacts see no
 * surface, as before. */
type SkeletonSoles = {
  points: Record<Side, { bone: T.Object3D; local: T.Vector3 }[]>;
  floor: number;
};
const skeletonSoles = new WeakMap<T.Group, SkeletonSoles>();
const surfaces = new WeakMap<T.Group, FootSurfaces>();
export function hasFootSurfaceContacts(group: T.Group) {
  const saved = surfaces.get(group);
  return !!(saved?.contact.left.length && saved.contact.right.length);
}
const below = (node: T.Object3D | undefined, root: T.Object3D) => {
  for (; node; node = node.parent ?? undefined) if (node === root) return true;
  return false;
};

/** Capture actual sole vertices from skin weights or rigid bone attachments.
 * No mesh/provider names are involved. Without a foot joint, use the bottom of
 * the shin's geometry instead of assuming that its length equals the thigh's. */
export function captureFootSurfaces(group: T.Group) {
  surfaces.delete(group);
  skeletonSoles.delete(group);
  const bones = group.userData.bones as Record<string, T.Bone> | undefined;
  if (!bones?.leftShin || !bones.rightShin) return;
  group.updateWorldMatrix(true, false);
  group.updateMatrixWorld(true);
  const point = new T.Vector3();
  const result = {} as Record<Side, Surface>;
  const contact = {} as Record<Side, Surface>;
  for (const side of ["left", "right"] as const) {
    const foot = bones[side + "Foot"],
      shin = bones[side + "Shin"];
    const candidates: {
      mesh: T.Mesh;
      vertices: { index: number; point: T.Vector3; wholeFoot: boolean }[];
    }[] = [];
    let minimum = Infinity;
    group.traverse((node) => {
      if (!(node instanceof T.Mesh) || !node.geometry.attributes.position)
        return;
      const indices = node.geometry.attributes.skinIndex;
      const weights = node.geometry.attributes.skinWeight;
      const joints =
        node instanceof T.SkinnedMesh
          ? node.skeleton.bones.map((bone) => ({
              foot: !!foot && below(bone, foot),
              lower: below(bone, shin) || (!!foot && below(bone, foot)),
            }))
          : undefined;
      if (!joints && !below(node, shin) && !(foot && below(node, foot))) return;
      if (joints && (!indices || !weights)) return;
      const vertices: {
        index: number;
        point: T.Vector3;
        wholeFoot: boolean;
      }[] = [];
      for (
        let index = 0;
        index < node.geometry.attributes.position.count;
        index++
      ) {
        let footInfluence = foot && below(node, foot) ? 1 : 0;
        if (joints) {
          let influence = 0;
          for (let component = 0; component < weights.itemSize; component++) {
            const joint = joints[indices.getComponent(index, component)];
            if (joint?.lower)
              influence += weights.getComponent(index, component);
            if (joint?.foot)
              footInfluence += weights.getComponent(index, component);
          }
          if (influence < 0.5) continue;
        }
        node.getVertexPosition(index, point);
        group.worldToLocal(node.localToWorld(point));
        if (!Number.isFinite(point.y)) continue;
        vertices.push({
          index,
          point: point.clone(),
          wholeFoot: footInfluence >= 0.5,
        });
        minimum = Math.min(minimum, point.y);
      }
      if (vertices.length) candidates.push({ mesh: node, vertices });
    });
    const knee = group.worldToLocal(shin.getWorldPosition(new T.Vector3()));
    // Keep the full foot when mapped. For a terminal shin, keep a band large
    // enough for toe/heel roll while excluding the knee and trouser geometry.
    const ceiling = minimum + Math.max(0, knee.y - minimum) * 0.3;
    result[side] = candidates.flatMap(({ mesh, vertices }) => {
      const indices = vertices
        .filter(({ point, wholeFoot }) => wholeFoot || point.y <= ceiling)
        .map(({ index }) => index);
      return indices.length ? [{ mesh, indices }] : [];
    });
    // A material point on the sole, fixed in bind-space selection, survives
    // heel/toe roll and loop seams. Spatial deduplication avoids giving dense
    // mesh regions (or overlapping shoe/body meshes) disproportionate weight.
    const height = Math.max(0.001, knee.y - minimum);
    const cells = new Set<string>();
    contact[side] = candidates.flatMap(({ mesh, vertices }) => {
      const indices = vertices
        .filter(({ point }) => {
          if (point.y > minimum + height * 0.04) return false;
          const cell = point
            .toArray()
            .map((n) => Math.round(n / (height * 0.02)))
            .join(",");
          if (cells.has(cell)) return false;
          cells.add(cell);
          return true;
        })
        .map(({ index }) => index);
      return indices.length ? [{ mesh, indices }] : [];
    });
  }
  if (!result.left.length || !result.right.length) {
    captureSkeletonSoles(group);
    return;
  }
  const saved = { ...result, contact, floor: 0 };
  surfaces.set(group, saved);
  saved.floor = sampleFootSurfaces(group)!.lowest;
}

/** Virtual soles for a skeleton without any mesh: the floor point under each
 * foot-chain joint at bind (the lowest of them sets the floor). Files with
 * any mesh keep their real geometry or have no surface. */
function captureSkeletonSoles(group: T.Group) {
  let meshes = false;
  group.traverse((node) => {
    if (node instanceof T.Mesh) meshes = true;
  });
  const bones = group.userData.bones as Record<string, T.Bone>;
  if (meshes || !bones.leftFoot || !bones.rightFoot) return;
  const chains = {} as Record<Side, T.Object3D[]>;
  let floor = Infinity;
  for (const side of ["left", "right"] as const) {
    chains[side] = [];
    bones[side + "Foot"].traverse((node) => {
      if (node instanceof T.Bone) chains[side].push(node);
    });
    for (const bone of chains[side])
      floor = Math.min(
        floor,
        group.worldToLocal(bone.getWorldPosition(new T.Vector3())).y,
      );
  }
  const points = {} as Record<Side, { bone: T.Object3D; local: T.Vector3 }[]>;
  for (const side of ["left", "right"] as const)
    points[side] = chains[side].map((bone) => {
      const at = group.worldToLocal(bone.getWorldPosition(new T.Vector3()));
      at.y = floor;
      return { bone, local: bone.worldToLocal(group.localToWorld(at)) };
    });
  skeletonSoles.set(group, { points, floor });
}

/** Sole heights of a skeleton without any mesh, in the same form as
 * `sampleFootSurfaces`. */
export function sampleSkeletonSoles(group: T.Group) {
  const saved = skeletonSoles.get(group);
  if (!saved) return;
  group.updateMatrixWorld(true);
  const lowest = (side: Side) =>
    Math.min(
      ...saved.points[side].map(
        ({ bone, local }) =>
          group.worldToLocal(bone.localToWorld(local.clone())).y,
      ),
    );
  const left = lowest("left"),
    right = lowest("right");
  return { left, right, lowest: Math.min(left, right), bindFloor: saved.floor };
}

/** World-space position of a stable sole material point. Unlike the ankle,
 * its lever arm reflects the receiver's actual shoe/foot shape. */
export function footSurfaceContact(group: T.Group, side: Side) {
  const surface = surfaces.get(group)?.contact[side];
  if (!surface?.length) return;
  group.updateWorldMatrix(true, false);
  group.updateMatrixWorld(true);
  const center = new T.Vector3(),
    point = new T.Vector3();
  let count = 0;
  for (const { mesh, indices } of surface) {
    for (const index of indices) {
      mesh.getVertexPosition(index, point).applyMatrix4(mesh.matrixWorld);
      center.add(point);
      count++;
    }
  }
  return count ? center.divideScalar(count) : undefined;
}

/** Deform only the selected foot vertices, including current morph weights. */
export function sampleFootSurfaces(group: T.Group) {
  const saved = surfaces.get(group);
  if (!saved) return;
  // SkinnedMesh.updateMatrixWorld refreshes bindMatrixInverse in attached mode.
  // Object3D.updateWorldMatrix alone skips that override and would double-apply
  // animated mesh/root transforms during CPU vertex measurements.
  group.updateWorldMatrix(true, false);
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const point = new T.Vector3();
  const minimum = (surface: Surface) => {
    let height = Infinity;
    for (const { mesh, indices } of surface) {
      const transform = inverse.clone().multiply(mesh.matrixWorld);
      for (const index of indices) {
        mesh.getVertexPosition(index, point).applyMatrix4(transform);
        height = Math.min(height, point.y);
      }
    }
    return height;
  };
  const left = minimum(saved.left),
    right = minimum(saved.right);
  return { left, right, lowest: Math.min(left, right), bindFloor: saved.floor };
}

/** Preserve source ground clearance, including airborne frames, after changing
 * limb proportions. This adjusts body height rather than stretching the legs. */
export function transferFootClearance(
  source: T.Group,
  target: T.Group,
  basePosition: T.Vector3,
  ratio: number,
  sourceSurface = sampleFootSurfaces(source) ?? sampleSkeletonSoles(source),
  sourceOriginY = 0,
) {
  const a = sourceSurface,
    b = sampleFootSurfaces(target);
  if (!a || !b) return;
  const offset = target.position
    .clone()
    .sub(basePosition)
    .applyQuaternion(target.quaternion.clone().invert())
    .divide(target.scale);
  // Native playback removes the selected take's starting root displacement.
  // Clearance must use that same origin, or the correction reintroduces the
  // capture-space height offset after transfer has already removed it.
  const clearance = a.lowest - a.bindFloor - sourceOriginY;
  const desired = b.bindFloor + clearance * ratio;
  const delta = desired - b.lowest - offset.y;
  target.position.add(
    new T.Vector3(0, delta, 0)
      .multiply(target.scale)
      .applyQuaternion(target.quaternion),
  );
  target.updateMatrixWorld(true);
  target.userData.footClearance = {
    source: clearance,
    correction: delta,
  };
}

/** Raise the model to the route's requested minimum sole clearance without
 * changing joints. With no additional envelope, positive airborne clearance
 * is untouched. Reapplying the same minimum is idempotent. */
export function supportRouteGround(
  group: T.Group,
  basePosition: T.Vector3,
  minimumClearance = 0,
) {
  const surface = sampleFootSurfaces(group);
  if (!surface) return;
  const offset = group.position
    .clone()
    .sub(basePosition)
    .applyQuaternion(group.quaternion.clone().invert())
    .divide(group.scale);
  const correction = Math.max(
    0,
    surface.bindFloor +
      Math.max(0, minimumClearance) -
      surface.lowest -
      offset.y,
  );
  if (correction > 1e-9) {
    group.position.add(
      new T.Vector3(0, correction, 0)
        .multiply(group.scale)
        .applyQuaternion(group.quaternion),
    );
    group.updateMatrixWorld(true);
  }
  group.userData.routeGroundSupport = correction;
}
