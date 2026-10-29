import type { Point } from "./ladder";

export type Footprint = {
  id: string;
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};
const epsilon = 1e-6;
export function inside(point: Point, box: Footprint) {
  return (
    point[0] > box.minX + epsilon &&
    point[0] < box.maxX - epsilon &&
    point[2] > box.minZ + epsilon &&
    point[2] < box.maxZ - epsilon
  );
}
/** Segment versus rectangle interior. Boundary tangency is allowed. */
export function crosses(a: Point, b: Point, box: Footprint) {
  let enter = 0,
    leave = 1;
  for (const [axis, min, max] of [
    [0, box.minX + epsilon, box.maxX - epsilon],
    [2, box.minZ + epsilon, box.maxZ - epsilon],
  ]) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < epsilon) {
      if (a[axis] <= min || a[axis] >= max) return false;
    } else {
      const one = (min - a[axis]) / delta,
        two = (max - a[axis]) / delta;
      enter = Math.max(enter, Math.min(one, two));
      leave = Math.min(leave, Math.max(one, two));
      if (enter >= leave) return false;
    }
  }
  return enter < leave;
}
export const clearSegment = (a: Point, b: Point, boxes: Footprint[]) =>
  !boxes.some((box) => crosses(a, b, box));
/** Shortest visible polyline around expanded, static footprints. */
export function findRoute(
  start: Point,
  goals: Point[],
  boxes: Footprint[],
): Point[] {
  const occupied = boxes.find((box) => inside(start, box));
  if (occupied)
    throw Error(
      `Move the character clear of ${occupied.name} before planning a route.`,
    );
  const freeGoals = goals.filter(
    (point) => !boxes.some((box) => inside(point, box)),
  );
  if (!freeGoals.length)
    throw Error(
      "There is no clear stopping place beside that object. Move nearby furniture or choose another destination.",
    );
  const corners = boxes
    .flatMap(
      (box) =>
        [
          [box.minX, start[1], box.minZ],
          [box.minX, start[1], box.maxZ],
          [box.maxX, start[1], box.minZ],
          [box.maxX, start[1], box.maxZ],
        ] as Point[],
    )
    .filter((point) => !boxes.some((box) => inside(point, box)));
  const nodes = [start, ...freeGoals, ...corners];
  const distances = nodes.map(() => Infinity),
    previous = nodes.map(() => -1),
    visited = new Set<number>();
  distances[0] = 0;
  for (;;) {
    let next = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!visited.has(i) && (next < 0 || distances[i] < distances[next]))
        next = i;
    if (next < 0 || !Number.isFinite(distances[next])) break;
    if (next > 0 && next <= freeGoals.length) {
      const route: Point[] = [];
      for (let i = next; i >= 0; i = previous[i]) route.unshift([...nodes[i]]);
      return route;
    }
    visited.add(next);
    for (let i = 1; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const cost =
        distances[next] +
        Math.hypot(nodes[next][0] - nodes[i][0], nodes[next][2] - nodes[i][2]);
      if (cost >= distances[i] || !clearSegment(nodes[next], nodes[i], boxes))
        continue;
      distances[i] = cost;
      previous[i] = next;
    }
  }
  throw Error(
    "No clear route reaches that object. Open a gap in the furniture and try again.",
  );
}
