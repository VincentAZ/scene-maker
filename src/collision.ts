import * as T from "three";
import { skinColliderRegions } from "./skinCollider";

/** World AABBs per mesh, instance or complete-triangle skin region. */
export type Collider = { boxes: T.Box3[]; bounds: T.Box3 };
export type CollisionObstacle = {
  id: string;
  name: string;
  collider: Collider;
};

/** Contacts and tiny numerical penetrations, in scene/world units, are allowed. */
export const COLLISION_EPSILON = 1e-5;

/** First overlap while both mesh bounds interpolate between two snapshots.
 * Relative motion matters: two fast objects travelling together must not
 * collide merely because their swept world-space boxes overlap. This is exact
 * for translated AABBs, and a sampled approximation for rotating/deforming
 * meshes; callers must sample those changes rather than claim exact physics. */
export function firstInterpolatedOverlap(
  a0: Collider,
  a1: Collider,
  b0: Collider,
  b1: Collider,
): number | null {
  if (
    !a0.bounds
      .clone()
      .union(a1.bounds)
      .intersectsBox(b0.bounds.clone().union(b1.bounds))
  )
    return null;
  const preceding = (from: Collider, to: Collider) => {
    const old = parts.get(from),
      next = parts.get(to);
    const indices = old && new Map(old.map((part, index) => [part.id, index]));
    return to.boxes.map((box, index) => {
      const previous = indices && next ? indices.get(next[index].id) : index;
      return previous === undefined ? box : from.boxes[previous] || box;
    });
  };
  const aBefore = preceding(a0, a1),
    bBefore = preceding(b0, b1);
  // Region skins contain many parts. Cache each obstacle's swept bounds once
  // rather than recomputing six extrema for every region pair.
  const sweptB = new Float64Array(b1.boxes.length * 6);
  for (let j = 0; j < b1.boxes.length; j++) {
    const old = bBefore[j],
      box = b1.boxes[j],
      offset = j * 6;
    sweptB[offset] = Math.min(old.min.x, box.min.x);
    sweptB[offset + 1] = Math.min(old.min.y, box.min.y);
    sweptB[offset + 2] = Math.min(old.min.z, box.min.z);
    sweptB[offset + 3] = Math.max(old.max.x, box.max.x);
    sweptB[offset + 4] = Math.max(old.max.y, box.max.y);
    sweptB[offset + 5] = Math.max(old.max.z, box.max.z);
  }
  let first = Infinity;
  for (let i = 0; i < a1.boxes.length; i++) {
    const a = a1.boxes[i],
      beforeA = aBefore[i],
      minX = Math.min(beforeA.min.x, a.min.x),
      minY = Math.min(beforeA.min.y, a.min.y),
      minZ = Math.min(beforeA.min.z, a.min.z),
      maxX = Math.max(beforeA.max.x, a.max.x),
      maxY = Math.max(beforeA.max.y, a.max.y),
      maxZ = Math.max(beforeA.max.z, a.max.z);
    for (let j = 0; j < b1.boxes.length; j++) {
      const offset = j * 6;
      if (
        maxX <= sweptB[offset] ||
        minX >= sweptB[offset + 3] ||
        maxY <= sweptB[offset + 1] ||
        minY >= sweptB[offset + 4] ||
        maxZ <= sweptB[offset + 2] ||
        minZ >= sweptB[offset + 5]
      )
        continue;
      const b = b1.boxes[j],
        beforeB = bBefore[j];
      let enter = 0,
        leave = 1;
      for (const axis of axes) {
        for (const [start, end] of [
          [beforeA.max[axis] - beforeB.min[axis], a.max[axis] - b.min[axis]],
          [beforeB.max[axis] - beforeA.min[axis], b.max[axis] - a.min[axis]],
        ]) {
          const value = start - COLLISION_EPSILON,
            slope = end - start;
          if (Math.abs(slope) < 1e-12) {
            if (value <= 0) leave = -1;
          } else if (slope > 0) enter = Math.max(enter, -value / slope);
          else leave = Math.min(leave, -value / slope);
        }
      }
      if (enter < leave) first = Math.min(first, Math.max(0, enter));
    }
  }
  return Number.isFinite(first) ? first : null;
}

type Part = { id: string; matrix: T.Matrix4 };
const parts = new WeakMap<Collider, Part[]>();
const axes = ["x", "y", "z"] as const;

/** A carried prop belongs to the moving body's clearance, while intentional
 * hand/prop contact must not count as the actor colliding with itself. */
export function combineColliders(colliders: Collider[]): Collider {
  const combined: Collider = {
    boxes: colliders.flatMap((c) => c.boxes),
    bounds: new T.Box3(),
  };
  for (const collider of colliders) combined.bounds.union(collider.bounds);
  if (colliders.every((c) => parts.has(c)))
    parts.set(
      combined,
      colliders.flatMap((c) => parts.get(c)!),
    );
  return combined;
}

/** A set's shell — floor, walls, ceiling, a merged room — is marked passable
 * when it loads (modelSet.ts); only its furniture-scale meshes are obstacles. */
export const obstacleMesh = (mesh: T.Object3D) => !mesh.userData.passable;

/**
 * Detached snapshot of rendered mesh bounds, including ancestors' visibility and
 * transforms. Static geometry.boundingBox is cached by Three; after editing its
 * vertices, invalidate it (boundingBox = null) or recompute it. Skin/morph bounds
 * are refreshed on every snapshot, and instances retain separate boxes. Meshes
 * the optional filter rejects are left out.
 *
 * These are conservative geometric AABBs, not triangle/physics colliders: empty
 * space inside a region's box can still block. Skins use complete-triangle
 * regions so one body mesh does not fill the space between limbs. Separate
 * environment meshes never fill the room between them. Material groups, shader displacement,
 * clipping, camera layers and alpha holes are not resolved.
 */
export function snapshotCollider(
  root: T.Object3D,
  include?: (mesh: T.Mesh) => boolean,
): Collider {
  const collider: Collider = { boxes: [], bounds: new T.Box3() };
  const entries: Part[] = [];
  parts.set(collider, entries);
  for (
    let ancestor: T.Object3D | null = root;
    ancestor;
    ancestor = ancestor.parent
  )
    if (!ancestor.visible) return collider;
  root.updateWorldMatrix(true, true);
  const add = (local: T.Box3, matrix: T.Matrix4, id: string) => {
    const box = local.clone().applyMatrix4(matrix);
    if (
      box.isEmpty() ||
      ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
    )
      return;
    collider.boxes.push(box);
    collider.bounds.union(box);
    entries.push({ id, matrix: matrix.clone() });
  };
  root.traverseVisible((object) => {
    if (!(object instanceof T.Mesh) || (include && !include(object))) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (!materials.some((material) => material.visible)) return;
    const geometry = object.geometry;
    if (!geometry.getAttribute("position")) return;
    let local: T.Box3;
    if (object instanceof T.SkinnedMesh) {
      // Bones may live outside the supplied subtree. Also refresh the attached
      // skin's bindMatrixInverse, normally updated during the render pass.
      for (const bone of object.skeleton.bones)
        bone.updateWorldMatrix(true, false);
      object.updateMatrixWorld(true);
      const regions = skinColliderRegions(object);
      if (regions) {
        for (const { box, bone } of regions) {
          if (
            box.isEmpty() ||
            ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)
          )
            continue;
          collider.boxes.push(box);
          collider.bounds.union(box);
          entries.push({
            id: `${object.uuid}:skin:${bone}`,
            matrix: (
              object.skeleton.bones[bone]?.matrixWorld ?? object.matrixWorld
            ).clone(),
          });
        }
        return;
      }
      object.computeBoundingBox();
      local = object.boundingBox!;
    } else if (object.morphTargetInfluences?.some((weight) => weight !== 0)) {
      local = new T.Box3();
      const vertex = new T.Vector3();
      for (let i = 0; i < geometry.getAttribute("position").count; i++)
        local.expandByPoint(object.getVertexPosition(i, vertex));
    } else {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      local = geometry.boundingBox!;
    }
    if (object instanceof T.InstancedMesh) {
      const matrix = new T.Matrix4();
      for (let i = 0; i < object.count; i++) {
        object.getMatrixAt(i, matrix);
        matrix.premultiply(object.matrixWorld);
        add(local, matrix, `${object.uuid}:${i}`);
      }
    } else add(local, object.matrixWorld, object.uuid);
  });
  return collider;
}

type Overlap = { volume: number; depth: number };
function overlap(a: T.Box3, b: T.Box3): Overlap {
  // Separation distance, not just intersection size: a box entirely inside a
  // larger box must not be allowed to move deeper on an unchanged volume.
  const depth = Math.min(
    ...axes.flatMap((axis) => [
      a.max[axis] - b.min[axis],
      b.max[axis] - a.min[axis],
    ]),
  );
  if (depth <= COLLISION_EPSILON) return { volume: 0, depth: 0 };
  const volume = axes.reduce(
    (value, axis) =>
      value *
      Math.max(
        0,
        Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]),
      ),
    1,
  );
  return { volume, depth };
}
function worsened(before: Overlap, after: Overlap) {
  return (
    after.depth > before.depth + COLLISION_EPSILON ||
    after.volume >
      before.volume + COLLISION_EPSILON * Math.max(1e-6, before.volume)
  );
}

function canSweep(a: T.Box3, b: T.Box3, from?: Part, to?: Part) {
  if (
    axes.some(
      (axis) =>
        Math.abs(a.max[axis] - a.min[axis] - (b.max[axis] - b.min[axis])) >
        COLLISION_EPSILON,
    )
  )
    return false;
  // Equal AABB sizes alone do not imply translation (e.g. a quarter-turn cube).
  if (from && to)
    for (const index of [0, 1, 2, 4, 5, 6, 8, 9, 10])
      if (
        Math.abs(from.matrix.elements[index] - to.matrix.elements[index]) > 1e-9
      )
        return false;
  return true;
}

/** Open slab intersection: merely touching a face/edge at any time is allowed. */
function sweepsInto(a: T.Box3, delta: T.Vector3, b: T.Box3) {
  let enter = 0,
    exit = 1;
  for (const axis of axes) {
    const velocity = delta[axis];
    if (Math.abs(velocity) < 1e-12) {
      if (
        a.max[axis] - b.min[axis] <= COLLISION_EPSILON ||
        b.max[axis] - a.min[axis] <= COLLISION_EPSILON
      )
        return false;
      continue;
    }
    const t1 = (b.min[axis] + COLLISION_EPSILON - a.max[axis]) / velocity;
    const t2 = (b.max[axis] - COLLISION_EPSILON - a.min[axis]) / velocity;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter >= exit) return false;
  }
  return enter < exit;
}

/**
 * Check the maximum penetration during an already-overlapping translation.
 * Intersection extents are piecewise linear, their volume piecewise cubic.
 * Evaluate all breakpoints and derivative roots, rather than sampling a path
 * that could miss a narrow peak or forbid a genuine outward escape.
 */
function sweepWorsens(a: T.Box3, delta: T.Vector3, b: T.Box3, before: Overlap) {
  const times = new Set([0, 1]);
  const addTime = (t: number) => {
    if (t > 0 && t < 1) times.add(t);
  };
  const depths: [number, number][] = [];
  for (const axis of axes) {
    const velocity = delta[axis];
    if (Math.abs(velocity) > 1e-12)
      for (const moving of [a.min[axis], a.max[axis]])
        for (const fixed of [b.min[axis], b.max[axis]])
          addTime((fixed - moving) / velocity);
    depths.push(
      [a.max[axis] - b.min[axis], velocity],
      [b.max[axis] - a.min[axis], -velocity],
    );
  }
  // Penetration depth is the minimum of these six lines. Its maxima occur at
  // endpoints or line intersections, including when overlap volume is constant.
  for (let i = 0; i < depths.length; i++)
    for (let j = i + 1; j < depths.length; j++) {
      const slope = depths[i][1] - depths[j][1];
      if (Math.abs(slope) > 1e-12)
        addTime((depths[j][0] - depths[i][0]) / slope);
    }
  const moved = new T.Box3();
  const at = (t: number) =>
    moved.copy(a).translate(delta.clone().multiplyScalar(t));
  const ordered = [...times].sort((x, y) => x - y);
  for (const t of ordered) if (worsened(before, overlap(at(t), b))) return true;
  for (let i = 1; i < ordered.length; i++) {
    const lo = ordered[i - 1],
      hi = ordered[i];
    const extent = (t: number) =>
      axes.map((axis) =>
        Math.max(
          0,
          Math.min(a.max[axis] + delta[axis] * t, b.max[axis]) -
            Math.max(a.min[axis] + delta[axis] * t, b.min[axis]),
        ),
      );
    const e = extent(lo),
      last = extent(hi),
      d = last.map((v, j) => v - e[j]);
    // V(u) = product(e[j] + d[j]*u), u in [0, 1].
    const c1 = d[0] * e[1] * e[2] + e[0] * d[1] * e[2] + e[0] * e[1] * d[2];
    const c2 = d[0] * d[1] * e[2] + d[0] * e[1] * d[2] + e[0] * d[1] * d[2];
    const c3 = d[0] * d[1] * d[2];
    const roots: number[] = [];
    if (Math.abs(c3) < 1e-15) {
      if (Math.abs(c2) > 1e-15) roots.push(-c1 / (2 * c2));
    } else {
      const discriminant = 4 * c2 * c2 - 12 * c3 * c1;
      if (discriminant >= 0) {
        roots.push((-2 * c2 + Math.sqrt(discriminant)) / (6 * c3));
        roots.push((-2 * c2 - Math.sqrt(discriminant)) / (6 * c3));
      }
    }
    for (const u of roots)
      if (
        u > 0 &&
        u < 1 &&
        worsened(before, overlap(at(lo + (hi - lo) * u), b))
      )
        return true;
  }
  return false;
}

/**
 * Return the first blocking obstacle's name (or id), otherwise null. Compare
 * each mesh pair with its own initial overlap: unchanged/reduced penetration is
 * permitted, but a different mesh cannot acquire an overlap on that allowance.
 *
 * Translation sweeps prevent tunneling even when the endpoint is clear, and
 * reject crossing deeper through an initial overlap before exiting its far side.
 * Rotated/scaled parts use endpoint checks only; callers wanting path checks
 * should take intermediate transform snapshots. Pass sweep=false for teleports
 * or whenever the path is not a translation. No ground constraint is imposed.
 * Treat snapshots as immutable. Hand-authored colliders match boxes by index;
 * snapshots match stable mesh/instance identities, even if visibility changes.
 */
export function collisionBetween(
  start: Collider,
  end: Collider,
  obstacles: readonly CollisionObstacle[],
  sweep = true,
): string | null {
  const fromParts = parts.get(start),
    toParts = parts.get(end);
  const indices = fromParts
    ? new Map(fromParts.map((part, i) => [part.id, i]))
    : null;
  const travelBounds = end.bounds.clone().union(start.bounds);
  for (const obstacle of obstacles) {
    if (!travelBounds.intersectsBox(obstacle.collider.bounds)) continue;
    for (let i = 0; i < end.boxes.length; i++) {
      const index = indices && toParts ? indices.get(toParts[i].id) : i;
      const from = index === undefined ? undefined : start.boxes[index];
      const to = end.boxes[i];
      const translate =
        !!from &&
        sweep &&
        canSweep(
          from,
          to,
          index === undefined ? undefined : fromParts?.[index],
          toParts?.[i],
        );
      const travel = translate ? from!.clone().union(to) : to;
      for (const fixed of obstacle.collider.boxes) {
        if (!travel.intersectsBox(fixed)) continue;
        const before = from ? overlap(from, fixed) : { volume: 0, depth: 0 };
        if (worsened(before, overlap(to, fixed)))
          return obstacle.name || obstacle.id;
        if (!translate) continue;
        const delta = to.min.clone().sub(from!.min);
        if (
          before.depth === 0
            ? sweepsInto(from!, delta, fixed)
            : sweepWorsens(from!, delta, fixed, before)
        )
          return obstacle.name || obstacle.id;
      }
    }
  }
  return null;
}
