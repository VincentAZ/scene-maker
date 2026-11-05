import { z } from "zod";
import type { Footprint } from "./navigation";

const vec3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const floorPoint = z.tuple([z.number().finite(), z.number().finite()]);
export type Vec3 = z.infer<typeof vec3>;
export type FloorPoint = z.infer<typeof floorPoint>;

/** Meshes at least this wide along both floor axes are part of a set's shell
 * (floor, ceiling, a merged room) rather than furniture the cast walks around. */
export const SHELL_SPAN = 5;
/** Meshes whose top is no higher than this above the floor (y = 0) are walked
 * over: the floor itself, rugs, mats and thresholds. */
export const FLOOR_TOP = 0.05;

/**
 * How a real 3D set is staged (`set` in shared/content/sets.json, or derived
 * from a creator's own model): metres, Y-up, the walkable floor at y = 0 and
 * the cast facing +Z toward the home camera.
 */
export const setSchema = z
  .object({
    /** The home view: where the camera opens, what it looks at and how far
     * it may pull back (metres; 25 when absent). */
    camera: z.object({
      position: vec3,
      target: vec3,
      maxDistance: z.number().min(2).max(100).optional(),
    }),
    /** The set's extent in metres. */
    bounds: z
      .object({ min: vec3, max: vec3 })
      .refine(
        (box) => box.min.every((value, axis) => value < box.max[axis]),
        "A set's bounds need a positive size on every axis.",
      ),
    /** Where new cast members appear and which way they face (radians, 0 = +Z). */
    spawn: vec3,
    heading: z.number().finite(),
    /** Open floor as a polygon of (x, z) corners: drops and spawn stay inside. */
    walkable: z.array(floorPoint).min(3).max(256).optional(),
    /** What stops the cast: furniture-scale meshes (the default) or nothing.
     * The shell never blocks: anything tagged `sceneMaker.role` "shell" or
     * "floor", anything no higher than 5 cm (floor, rugs), anything spanning
     * 5 m both ways, and a mesh built around the room (see `shellBox`). */
    collision: z.enum(["furniture", "none"]).optional(),
    lighting: z
      .object({
        exposure: z.number().min(0.05).max(20).optional(),
        /** Direction toward the sun. */
        sun: vec3
          .refine(
            (direction) => Math.hypot(...direction) > 1e-6,
            "The sun needs a direction.",
          )
          .optional(),
        sunIntensity: z.number().min(0).max(50).optional(),
        hemisphere: z.number().min(0).max(20).optional(),
        fog: z.boolean().optional(),
        /** Show the set's HDR as the sky behind the model. */
        sky: z.boolean().optional(),
      })
      .optional(),
  })
  .refine(
    (set) =>
      [0, 2].every(
        (axis) =>
          set.spawn[axis] >= set.bounds.min[axis] &&
          set.spawn[axis] <= set.bounds.max[axis],
      ),
    "The spawn point must lie within the set's bounds.",
  );
export type SetBlock = z.infer<typeof setSchema>;

/** Even–odd test of a floor point against a polygon of (x, z) corners. */
export function insidePolygon(
  x: number,
  z: number,
  polygon: readonly FloorPoint[],
) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i],
      [xj, zj] = polygon[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi)
      inside = !inside;
  }
  return inside;
}

/**
 * The nearest spot on open floor: the point itself when it is inside the
 * walkable polygon, otherwise the closest point on the polygon's edge, nudged
 * a centimetre inward so it counts as inside too.
 */
export function onWalkableFloor(
  x: number,
  z: number,
  polygon: readonly FloorPoint[],
): FloorPoint {
  if (insidePolygon(x, z, polygon)) return [x, z];
  let best: FloorPoint = [x, z],
    bestDistance = Infinity,
    normal: FloorPoint = [0, 0];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j],
      [bx, bz] = polygon[i];
    const dx = bx - ax,
      dz = bz - az,
      length = dx * dx + dz * dz;
    const t = length
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
      : 0;
    const px = ax + dx * t,
      pz = az + dz * t;
    const distance = Math.hypot(x - px, z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [px, pz];
      const edge = Math.sqrt(length) || 1;
      normal = [-dz / edge, dx / edge];
    }
  }
  // Step a centimetre off the edge to the inside: along its normal, or, at a
  // corner, in whichever direction around the corner lies inside.
  const directions: FloorPoint[] = [normal, [-normal[0], -normal[1]]];
  for (let i = 0; i < 8; i++)
    directions.push([Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  for (const [dx, dz] of directions) {
    const candidate: FloorPoint = [best[0] + dx * 0.01, best[1] + dz * 0.01];
    if (insidePolygon(candidate[0], candidate[1], polygon)) return candidate;
  }
  return best;
}

/** A set's open floor as a polygon of (x, z) corners: its walkable outline,
 * or for a set without one (a creator's own model) its bounds less a margin
 * for the walls. */
export function floorPlan(set: SetBlock): FloorPoint[] {
  if (set.walkable) return set.walkable;
  const { min, max } = set.bounds;
  const x = Math.min(0.25, (max[0] - min[0]) / 4),
    z = Math.min(0.25, (max[2] - min[2]) / 4);
  return [
    [min[0] + x, min[2] + z],
    [max[0] - x, min[2] + z],
    [max[0] - x, max[2] - z],
    [min[0] + x, max[2] - z],
  ];
}

/** Route planners keep a body's clearance from every footprint, so the
 * floor plan's edge is drawn as thin footprints about a body's radius beyond
 * it: a route's centre line may come up to the edge but never cross it. */
const EDGE_OFFSET = 0.3,
  EDGE_THICKNESS = 0.05,
  /** A slanted edge is split into pieces whose boxes reach no further than
   * this back toward the floor, so they stay outside it. */
  EDGE_SLACK = 0.2;

/**
 * The edge of a set's open floor as footprints just outside it. Routes plan
 * around footprints, so with these they stay on the floor plan even where a
 * set's walls are walked through (part of a room built as one mesh). At a
 * convex corner the pieces run on past it so the corner has no gap.
 */
export function floorEdges(set: SetBlock): Footprint[] {
  const plan = floorPlan(set);
  let area = 0;
  for (let i = 0, j = plan.length - 1; i < plan.length; j = i++)
    area += plan[j][0] * plan[i][1] - plan[i][0] * plan[j][1];
  // +1 when the corners run counter-clockwise in (x, z).
  const turn = Math.sign(area) || 1;
  const direction = (i: number): FloorPoint => {
    const [ax, az] = plan[i % plan.length],
      [bx, bz] = plan[(i + 1) % plan.length];
    const length = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / length, (bz - az) / length];
  };
  const convex = (before: FloorPoint, after: FloorPoint) =>
    (before[0] * after[1] - before[1] * after[0]) * turn > 1e-9;
  const edges: Footprint[] = [];
  const reach = EDGE_OFFSET + EDGE_THICKNESS;
  for (let i = 0; i < plan.length; i++) {
    const [ax, az] = plan[i],
      [bx, bz] = plan[(i + 1) % plan.length];
    const length = Math.hypot(bx - ax, bz - az);
    if (length < 1e-6) continue;
    const [ux, uz] = direction(i);
    const [nx, nz] = [turn * uz, -turn * ux];
    const start = convex(direction(i + plan.length - 1), [ux, uz]) ? -reach : 0,
      end = length + (convex([ux, uz], direction(i + 1)) ? reach : 0);
    // A piece's box reaches length × |ux × uz| back across its own line.
    const pieces = Math.max(
      1,
      Math.ceil(((end - start) * Math.abs(ux * uz)) / EDGE_SLACK),
    );
    for (let k = 0; k < pieces; k++) {
      const xs: number[] = [],
        zs: number[] = [];
      for (const t of [k, k + 1]) {
        const along = start + ((end - start) * t) / pieces;
        for (const out of [EDGE_OFFSET, reach]) {
          xs.push(ax + ux * along + nx * out);
          zs.push(az + uz * along + nz * out);
        }
      }
      edges.push({
        id: `floor-edge-${i}-${k}`,
        name: "the edge of the set",
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minZ: Math.min(...zs),
        maxZ: Math.max(...zs),
      });
    }
  }
  return edges;
}

/** The extent of a set's open floor along X and Z. */
function floorExtent(set: SetBlock) {
  const plan = floorPlan(set);
  const xs = plan.map((point) => point[0]),
    zs = plan.map((point) => point[1]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)];
}

/**
 * Whether an untagged mesh with this world box is part of the set's shell
 * rather than furniture. Besides the floor and anything spanning 5 m both
 * ways, a mesh built around the room — its walls, a ceiling, pipes along
 * them — has a box that holds the spawn point on open floor and spans at
 * least half the floor one way or the other: as an obstacle it would fill
 * the room, so it is walked through like the floor.
 */
export function shellBox(
  min: readonly number[],
  max: readonly number[],
  set: SetBlock,
) {
  if (max[1] <= FLOOR_TOP) return true;
  const width = max[0] - min[0],
    depth = max[2] - min[2];
  if (width >= SHELL_SPAN && depth >= SHELL_SPAN) return true;
  const [x, , z] = set.spawn,
    margin = 0.05;
  const holdsSpawn =
    min[0] < x - margin &&
    max[0] > x + margin &&
    min[2] < z - margin &&
    max[2] > z + margin;
  const [floorWidth, floorDepth] = floorExtent(set);
  return holdsSpawn && (width >= floorWidth / 2 || depth >= floorDepth / 2);
}

/** A position kept on a set's open floor. Only what stands on the floor is
 * moved; a placement resting higher up, like a cup on a table, stays put. */
export function keepOnSetFloor(
  set: SetBlock | undefined,
  position: Vec3,
): Vec3 {
  if (!set || Math.abs(position[1]) > FLOOR_TOP) return position;
  const [x, z] = onWalkableFloor(position[0], position[2], floorPlan(set));
  return [x, position[1], z];
}

/** How far a floor point lies inside a polygon: its distance to the nearest
 * edge, negative outside. */
export function depthInside(
  x: number,
  z: number,
  polygon: readonly FloorPoint[],
) {
  let nearest = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, az] = polygon[j],
      [bx, bz] = polygon[i];
    const dx = bx - ax,
      dz = bz - az,
      length = dx * dx + dz * dz;
    const t = length
      ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / length))
      : 0;
    nearest = Math.min(nearest, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return insidePolygon(x, z, polygon) ? nearest : -nearest;
}

/** Room a body keeps from the edge of the open floor, and from each other
 * cast member, when it is placed. */
const BODY_RADIUS = 0.25,
  CAST_SPACING = 0.75;

/** Does a body standing here keep its radius from the edge of the set's
 * open floor? A library set's walkable outline leaves out its furniture. */
export const standsOnFloor = (set: SetBlock, x: number, z: number) =>
  depthInside(x, z, floorPlan(set)) >= BODY_RADIUS;

/** Is this floor point taken by the set's furniture? Known only once the
 * set's model has loaded (src/environmentModel.ts). */
export type FloorBlocked = (x: number, z: number) => boolean;

/**
 * Where a new cast member stands in a 3D set: the spawn point itself when it
 * is free, otherwise the nearest free spot searched outward from it in the
 * set's own frame — across the view first, then behind, then in front. A free
 * spot is on the open floor at least a body's radius from its edge, clear of
 * the set's furniture and CAST_SPACING from everyone already placed, and not
 * straight behind one of them as seen from the home camera. A crowded floor
 * gives up being seen, then the spacing, and then the furniture, before the
 * spawn.
 */
export function freeSpot(
  set: SetBlock,
  taken: readonly (readonly number[])[],
  blocked?: FloorBlocked,
): Vec3 {
  const plan = floorPlan(set);
  const sin = Math.sin(set.heading),
    cos = Math.cos(set.heading);
  const step = 0.4,
    reach = 12;
  const offsets: [number, number, number][] = [];
  for (let i = -reach; i <= reach; i++)
    for (let j = -reach; j <= reach; j++) {
      const across = i * step,
        ahead = j * step;
      // Rows in front of the first would hide it from the home camera.
      const cost =
        Math.abs(across) +
        1.5 * Math.abs(ahead) +
        (ahead > 0 ? 0.6 * ahead : 0);
      offsets.push([cost, across, ahead]);
    }
  offsets.sort((a, b) => a[0] - b[0] || b[1] - a[1] || a[2] - b[2]);
  const spots = offsets.map(([, across, ahead]): Vec3 => [
    set.spawn[0] + across * cos + ahead * sin,
    0,
    set.spawn[2] - across * sin + ahead * cos,
  ]);
  const open = (spot: Vec3) =>
    depthInside(spot[0], spot[2], plan) >= BODY_RADIUS &&
    !blocked?.(spot[0], spot[2]);
  const apart = (spot: Vec3) =>
    taken.every(
      (other) =>
        Math.hypot(other[0] - spot[0], other[2] - spot[2]) >= CAST_SPACING,
    );
  // The home camera looks along the heading's reverse: someone less than
  // most of a shoulder's width across from a cast member and further back
  // is hidden behind them.
  const seen = (spot: Vec3) =>
    taken.every((other) => {
      const dx = spot[0] - other[0],
        dz = spot[2] - other[2];
      const across = dx * cos - dz * sin,
        ahead = dx * sin + dz * cos;
      return ahead >= -0.05 || Math.abs(across) >= 0.35;
    });
  const found =
    spots.find((spot) => open(spot) && apart(spot) && seen(spot)) ??
    spots.find((spot) => open(spot) && apart(spot)) ??
    spots.find(open) ??
    spots.find(
      (spot) =>
        depthInside(spot[0], spot[2], plan) >= BODY_RADIUS && apart(spot),
    );
  return found ?? keepOnSetFloor(set, [set.spawn[0], 0, set.spawn[2]]);
}

/**
 * Where a new scene object stands: in a 3D set, the nearest free spot to its
 * spawn point (`freeSpot`); on the studio stage, the next cell of a 4 × 3
 * grid of one-metre cells around the origin.
 */
export function spawnPosition(
  set: SetBlock | undefined,
  entities: readonly { position: readonly number[] }[],
  blocked?: FloorBlocked,
): Vec3 {
  if (set)
    return freeSpot(
      set,
      entities.map((entity) => entity.position),
      blocked,
    );
  const index = entities.length;
  return [(index % 4) - 1.5, 0, Math.floor(index / 4) % 3];
}

/** The home view for a set without an authored one: a standing camera at
 * eye height inside the set, far enough back to take in most of the floor. */
export function fitSetCamera(
  bounds: SetBlock["bounds"],
  spawn: Vec3,
): SetBlock["camera"] {
  const width = bounds.max[0] - bounds.min[0],
    depth = bounds.max[2] - bounds.min[2];
  const distance = Math.min(14, Math.max(3, Math.max(width, depth) * 0.65));
  const back = Math.max(
    spawn[2] + 1.5,
    Math.min(spawn[2] + distance, bounds.max[2] - 0.5),
  );
  return {
    position: [spawn[0], 1.6, back],
    target: [spawn[0], spawn[1] + 1, spawn[2]],
    maxDistance: Math.min(25, Math.max(6, Math.hypot(width, depth) * 0.9)),
  };
}

/**
 * The staging block for a model that has none (a creator's own set): its
 * measured extent, the cast at the authored origin when that is on the floor
 * plan and otherwise at the floor's centre, facing +Z, with a fitted camera.
 * Flat or thin models are padded so every axis has a size.
 */
export function defaultSetBlock(bounds: {
  min: readonly number[];
  max: readonly number[];
}): SetBlock {
  const min = [...bounds.min] as Vec3,
    max = [...bounds.max] as Vec3;
  for (let axis = 0; axis < 3; axis++)
    if (max[axis] - min[axis] < 0.01) {
      min[axis] -= 0.5;
      max[axis] += 0.5;
    }
  const onPlan = min[0] <= 0 && 0 <= max[0] && min[2] <= 0 && 0 <= max[2];
  const spawn: Vec3 = onPlan
    ? [0, 0, 0]
    : [(min[0] + max[0]) / 2, 0, (min[2] + max[2]) / 2];
  const camera = fitSetCamera({ min, max }, spawn);
  // Millimetres are plenty for a saved staging block.
  const mm = (values: Vec3) =>
    values.map((value) => Math.round(value * 1000) / 1000) as Vec3;
  return {
    camera: {
      position: mm(camera.position),
      target: mm(camera.target),
      maxDistance: Math.round(camera.maxDistance! * 1000) / 1000,
    },
    bounds: { min: mm(min), max: mm(max) },
    spawn: mm(spawn),
    heading: 0,
    collision: "furniture",
  };
}
