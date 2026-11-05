import { z } from "zod";

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
     * The shell — floor, walls, ceiling, anything spanning 5 m both ways, or
     * tagged `sceneMaker.role` "shell"/"floor" — never blocks. */
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

/** A floor position kept on a set's open floor, when the set declares one. */
export function keepOnSetFloor(
  set: SetBlock | undefined,
  position: Vec3,
): Vec3 {
  if (!set?.walkable) return position;
  const [x, z] = onWalkableFloor(position[0], position[2], set.walkable);
  return [x, position[1], z];
}

/**
 * Where the n-th new scene object stands: a 4 × 3 grid of one-metre cells
 * around the set's spawn point, turned to its heading and kept on open floor.
 * Without a set the grid surrounds the studio origin.
 */
export function spawnPosition(set: SetBlock | undefined, index: number): Vec3 {
  const across = (index % 4) - 1.5,
    ahead = Math.floor(index / 4) % 3;
  if (!set) return [across, 0, ahead];
  const sin = Math.sin(set.heading),
    cos = Math.cos(set.heading);
  return keepOnSetFloor(set, [
    set.spawn[0] + across * cos + ahead * sin,
    set.spawn[1],
    set.spawn[2] - across * sin + ahead * cos,
  ]);
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
