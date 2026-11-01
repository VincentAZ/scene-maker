import type { Point } from "./ladder";
import { clearSegment, findRoute, inside, type Footprint } from "./navigation";
import {
  compilePath,
  pathToWorld,
  worldToPath,
  type MotionPath,
  type PathFrame,
} from "./path";

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[2] - b[2]);

/** Plan the actual interpolated route, with departure and arrival aligned to
 * the selected forward/backward travel direction where staging has room. A short lead-in avoids
 * rotating the body away from its direction of travel during the last step.
 * Existing tight passages retain the feasible polyline as a fallback; they
 * still need stop/pivot choreography rather than a claim of natural turning. */
export function routeWithApproaches(
  frame: PathFrame,
  goals: Point[],
  obstacles: Footprint[],
  destination: Point,
  targetId: string,
  leadDistance: number,
  backward = false,
  entryHeading = 0,
  exitOccupied = false,
): MotionPath {
  const baseline = findRoute(frame.position, goals, obstacles, exitOccupied);
  // Different visibility margins often produce the exact same guide points.
  // Evaluate each distinct curve once; retain the original search order and
  // curvature/length tie-breaks for every geometrically different candidate.
  const evaluated = new Set<string>();
  const pathFor = (route: Point[], smooth = true): MotionPath => {
    const last = route.at(-1)!;
    const angle =
      Math.atan2(destination[0] - last[0], destination[2] - last[2]) -
      frame.heading;
    return {
      points: route.map((p) => worldToPath(p, frame)),
      smooth,
      ...(backward ? { backward: true } : {}),
      endHeading: Math.atan2(Math.sin(angle), Math.cos(angle)),
    };
  };
  const occupying = exitOccupied
    ? obstacles.filter((box) => inside(frame.position, box))
    : [];
  const clear = (path: MotionPath) => {
    const samples = compilePath(path).samples.map((s) =>
      pathToWorld(s.point, frame),
    );
    // The first leg may still be stepping out of the footprints the start
    // lies within; every later sample must be clear of all of them.
    let left = occupying.length === 0;
    return samples.slice(1).every((point, i) => {
      if (!left && !occupying.some((box) => inside(point, box))) left = true;
      return clearSegment(
        samples[i],
        point,
        left ? obstacles : obstacles.filter((box) => !occupying.includes(box)),
      );
    });
  };
  // Preserve the caller's already-at-destination check instead of making a loop.
  if (distance(frame.position, baseline.at(-1)!) < 0.05 * frame.scale)
    return pathFor(baseline, false);
  const minSpacing = 0.05 * frame.scale;
  for (const departure of [true, false]) {
    let best: { path: MotionPath; bend: number } | undefined;
    for (const multiplier of [1, 1.5, 2, 3]) {
      const lead = leadDistance * multiplier;
      const start: Point = departure
        ? [
            frame.position[0] +
              Math.sin(frame.heading + entryHeading) *
                lead *
                (backward ? -1 : 1),
            frame.position[1],
            frame.position[2] +
              Math.cos(frame.heading + entryHeading) *
                lead *
                (backward ? -1 : 1),
          ]
        : frame.position;
      if (
        !clearSegment(
          frame.position,
          start,
          exitOccupied
            ? obstacles.filter((box) => !inside(frame.position, box))
            : obstacles,
        )
      )
        continue;
      const approaches = goals.flatMap((goal) => {
        const radius = distance(goal, destination);
        if (radius < 1e-6 || distance(frame.position, goal) < lead * 2)
          return [];
        const entry: Point = [
          goal[0] +
            ((goal[0] - destination[0]) * lead * (backward ? -1 : 1)) / radius,
          goal[1],
          goal[2] +
            ((goal[2] - destination[2]) * lead * (backward ? -1 : 1)) / radius,
        ];
        return clearSegment(entry, goal, obstacles) ? [{ goal, entry }] : [];
      });
      if (!approaches.length) continue;
      for (const margin of [
        0,
        0.15 * frame.scale,
        0.35 * frame.scale,
        0.7 * frame.scale,
      ]) {
        const routing = obstacles.map((box) =>
          box.id === targetId
            ? box
            : {
                ...box,
                minX: box.minX - margin,
                maxX: box.maxX + margin,
                minZ: box.minZ - margin,
                maxZ: box.maxZ + margin,
              },
        );
        try {
          const middle = findRoute(
            start,
            approaches.map((p) => p.entry),
            routing,
            exitOccupied,
          );
          const goal = approaches.find(
            (p) => distance(p.entry, middle.at(-1)!) < 1e-7,
          )!.goal;
          // Uniform Catmull-Rom overshoots a short lead beside a long segment,
          // even reversing on an otherwise straight route. Keep neighbouring
          // spans comparable before interpolating the approach guides.
          const spaced = middle.flatMap((point, i) => {
            if (!i) return [point];
            const previous = middle[i - 1];
            const count = Math.ceil(distance(previous, point) / (2 * lead));
            return Array.from(
              { length: count },
              (_, step) =>
                previous.map(
                  (n, axis) => n + ((point[axis] - n) * (step + 1)) / count,
                ) as Point,
            );
          });
          const route = [
            ...(departure ? [frame.position] : []),
            ...spaced,
            goal,
          ];
          // Do not silently remove the tangent-control points to fit the schema.
          if (
            route.length > 32 ||
            route.slice(1).some((p, i) => distance(route[i], p) < minSpacing)
          )
            continue;
          const rounded = route.flatMap((point, i) =>
            i === 0 || i === route.length - 1
              ? [point]
              : [route[i - 1], route[i + 1]].map(
                  (neighbour) =>
                    point.map(
                      (n, axis) => n * 0.75 + neighbour[axis] * 0.25,
                    ) as Point,
                ),
          );
          for (const points of [route, rounded]) {
            if (
              points.length > 32 ||
              points
                .slice(1)
                .some((p, i) => distance(points[i], p) < minSpacing)
            )
              continue;
            const path = pathFor(points);
            const key = JSON.stringify(path);
            if (evaluated.has(key)) continue;
            evaluated.add(key);
            if (!clear(path)) continue;
            const compiled = compilePath(path);
            let bend = 0;
            for (let i = 1; i < compiled.samples.length; i++) {
              const a = compiled.samples[i - 1],
                b = compiled.samples[i];
              const span = b.distance - a.distance;
              if (span > 1e-8)
                bend = Math.max(bend, Math.abs(b.heading - a.heading) / span);
            }
            // Prefer gentler turns among feasible approaches. Length breaks
            // curvature ties without changing authored cadence.
            if (
              !best ||
              bend < best.bend - 1e-6 ||
              (Math.abs(bend - best.bend) <= 1e-6 &&
                compiled.length < compilePath(best.path).length)
            )
              best = { path, bend };
          }
        } catch {
          // Extra turning room may be unavailable even though the baseline
          // visibility route is feasible. Try less restrictive candidates.
        }
      }
    }
    if (best) return best.path;
  }
  const smooth = pathFor(baseline);
  return clear(smooth) ? smooth : pathFor(baseline, false);
}
