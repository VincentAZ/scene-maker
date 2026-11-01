import type { Point } from "./ladder";
import { clearSegment, findRoute, inside, type Footprint } from "./navigation";
import { compilePath } from "./path";

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[2] - b[2]);
function error(point: Point, a: Point, b: Point) {
  const x = b[0] - a[0],
    z = b[2] - a[2],
    squared = x * x + z * z;
  const t = squared
    ? Math.max(
        0,
        Math.min(1, ((point[0] - a[0]) * x + (point[2] - a[2]) * z) / squared),
      )
    : 0;
  return Math.hypot(point[0] - a[0] - t * x, point[2] - a[2] - t * z);
}

function simplify(
  points: Point[],
  tolerance: number,
  obstacles: Footprint[],
): Point[] {
  if (points.length <= 2) return points;
  let maximum = -1,
    split = 1;
  for (let i = 1; i < points.length - 1; i++) {
    const value = error(points[i], points[0], points.at(-1)!);
    if (value > maximum) {
      maximum = value;
      split = i;
    }
  }
  if (
    maximum <= tolerance &&
    clearSegment(points[0], points.at(-1)!, obstacles)
  )
    return [points[0], points.at(-1)!];
  return [
    ...simplify(points.slice(0, split + 1), tolerance, obstacles).slice(0, -1),
    ...simplify(points.slice(split), tolerance, obstacles),
  ];
}

/** Repair obstructed spans of a captured trajectory, retaining its clear
 * excursions and return travel. A shortest route to the final point would
 * discard those parts of a performance. Inputs/outputs share world coordinates.
 * Every simplified/interpolated segment is checked against the same obstacles. */
export function repairCapturedTrajectory(
  captured: Point[],
  obstacles: Footprint[],
  scale = 1,
  sourceProgress?: number[],
) {
  if (captured.length < 2)
    throw Error("The captured trajectory is unavailable.");
  const first = captured[0],
    last = captured.at(-1)!;
  if (obstacles.some((box) => inside(first, box) || inside(last, box)))
    throw Error("The captured performance starts or ends inside an obstacle.");
  const spacing = 0.05 * scale;
  const travelled = [0];
  for (let i = 1; i < captured.length; i++)
    travelled.push(travelled[i - 1] + distance(captured[i - 1], captured[i]));
  const total = travelled.at(-1)!;
  if (!(total > 0)) throw Error("The captured trajectory has no travel.");
  const fractions = sourceProgress ?? travelled.map((d) => d / total);
  if (
    fractions.length !== captured.length ||
    fractions[0] !== 0 ||
    fractions.at(-1) !== 1 ||
    fractions.some(
      (p, i) =>
        !Number.isFinite(p) ||
        p < 0 ||
        p > 1 ||
        (i > 0 && p < fractions[i - 1]),
    )
  )
    throw Error("The captured trajectory has invalid source correspondence.");
  const progress = new Map(captured.map((point, i) => [point, fractions[i]]));
  // Route between meaningful captured bends. Dense samples on a straight
  // approach otherwise force a late right-angle sidestep at the obstacle.
  const landmarks = simplify(captured, 0.005 * scale, []);
  let fallback:
    { points: Point[]; smooth: boolean; sourceProgress: number[] } | undefined;
  for (const margin of [0, 0.04, 0.08, 0.16]) {
    const routing = obstacles.map((box) => ({
      ...box,
      minX: box.minX - margin * scale,
      maxX: box.maxX + margin * scale,
      minZ: box.minZ - margin * scale,
      maxZ: box.maxZ + margin * scale,
    }));
    if (routing.some((box) => inside(first, box) || inside(last, box)))
      continue;
    const route: Point[] = [[...first]];
    progress.set(route[0], 0);
    try {
      for (let i = 1; i < landmarks.length; i++) {
        const point = landmarks[i];
        if (routing.some((box) => inside(point, box))) continue;
        if (
          i < landmarks.length - 1 &&
          distance(route.at(-1)!, point) < spacing
        )
          continue;
        const detour = findRoute(route.at(-1)!, [point], routing);
        const distances = [0];
        for (let j = 1; j < detour.length; j++)
          distances.push(distances[j - 1] + distance(detour[j - 1], detour[j]));
        const from = progress.get(route.at(-1)!)!,
          to = progress.get(point)!;
        detour
          .slice(1)
          .forEach((p, j) =>
            progress.set(
              p,
              j + 1 === detour.length - 1
                ? to
                : from + ((to - from) * distances[j + 1]) / distances.at(-1)!,
            ),
          );
        route.push(...detour.slice(1));
      }
    } catch {
      // A wider smoothing margin can seal a gap that was open for the
      // original footprint. Retain any already verified polyline fallback.
      continue;
    }
    for (const tolerance of [0.005, 0.01, 0.02]) {
      const points = simplify(route, tolerance * scale, obstacles);
      // Remove redundant near-neighbours only when the replacement is clear.
      for (let i = 1; i < points.length; i++) {
        if (distance(points[i - 1], points[i]) >= spacing) continue;
        if (
          i < points.length - 1 &&
          clearSegment(points[i - 1], points[i + 1], obstacles)
        )
          points.splice(i--, 1);
        else if (i > 1 && clearSegment(points[i - 2], points[i], obstacles))
          points.splice(--i, 1);
      }
      if (
        points.length > 32 ||
        points.length < 2 ||
        points.some((p, i) => i && distance(p, points[i - 1]) < spacing)
      )
        continue;
      const clear = (smooth: boolean) => {
        const samples = compilePath({ points, smooth }).samples;
        return samples
          .slice(1)
          .every((p, i) => clearSegment(samples[i].point, p.point, obstacles));
      };
      const sourceProgress = points.map((p) => progress.get(p)!);
      if (sourceProgress.some((p, i) => i > 0 && p <= sourceProgress[i - 1]))
        continue;
      if (clear(true)) return { points, smooth: true, sourceProgress };
      if (!fallback && clear(false))
        fallback = { points, smooth: false, sourceProgress };
    }
  }
  if (fallback) return fallback;
  throw Error(
    "The captured trajectory cannot be detoured within the available route bounds.",
  );
}
