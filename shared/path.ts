import type { Motion, Scene, Command } from "./scene";
import { ease, turnPoint, type Point } from "./ladder";

export type MotionPath = NonNullable<Motion["path"]>;
export type PathFrame = { position: Point; heading: number; scale: number };
type Sample = { point: Point; distance: number; heading: number };
type CompiledPath = { samples: Sample[]; length: number };
const cache = new WeakMap<MotionPath, CompiledPath>();
const distance = (a: Point, b: Point) =>
  Math.hypot(...a.map((n, i) => n - b[i]));
const mix = (a: Point, b: Point, t: number): Point =>
  a.map((n, i) => n + (b[i] - n) * t) as Point;

// Interpolating Catmull-Rom curve with an arc-length table. This remains pure
// scene data/math so authoring, AI plans, preview and export share one route.
export function compilePath(path: MotionPath): CompiledPath {
  const known = cache.get(path);
  if (known) return known;
  const points = path.points,
    last = points.length - 1;
  const closed = last > 2 && distance(points[0], points[last]) < 1e-6;
  const samples: Sample[] = [];
  let length = 0,
    heading = 0;
  for (let segment = 0; segment < last; segment++) {
    const a = points[segment],
      b = points[segment + 1];
    const before =
      points[segment - 1] || (closed ? points[last - 1] : mix(b, a, 2));
    const after = points[segment + 2] || (closed ? points[1] : mix(a, b, 2));
    for (let step = segment ? 1 : 0; step <= 40; step++) {
      const t = step / 40,
        t2 = t * t,
        t3 = t2 * t;
      const point = path.smooth
        ? (a.map(
            (n, i) =>
              (2 * t3 - 3 * t2 + 1) * n +
              ((t3 - 2 * t2 + t) * (b[i] - before[i])) / 2 +
              (-2 * t3 + 3 * t2) * b[i] +
              ((t3 - t2) * (after[i] - n)) / 2,
          ) as Point)
        : mix(a, b, t);
      const tangent = path.smooth
        ? (a.map(
            (n, i) =>
              (6 * t2 - 6 * t) * n +
              ((3 * t2 - 4 * t + 1) * (b[i] - before[i])) / 2 +
              (-6 * t2 + 6 * t) * b[i] +
              ((3 * t2 - 2 * t) * (after[i] - n)) / 2,
          ) as Point)
        : (b.map((n, i) => n - a[i]) as Point);
      const angle = Math.atan2(tangent[0], tangent[2]);
      if (Math.hypot(tangent[0], tangent[2]) > 1e-8)
        heading += Math.atan2(
          Math.sin(angle - heading),
          Math.cos(angle - heading),
        );
      const previous = samples.at(-1);
      if (previous) length += distance(previous.point, point);
      samples.push({ point, distance: length, heading });
    }
  }
  const compiled = { samples, length };
  cache.set(path, compiled);
  return compiled;
}

export function samplePath(path: MotionPath, progress: number) {
  const compiled = compilePath(path),
    samples = compiled.samples;
  const u = Math.max(0, Math.min(1, progress)),
    travelled = u * compiled.length;
  let low = 0,
    high = samples.length - 1;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (samples[middle].distance < travelled) low = middle;
    else high = middle;
  }
  const a = samples[low],
    b = samples[high];
  const t =
    b.distance === a.distance
      ? 0
      : (travelled - a.distance) / (b.distance - a.distance);
  // Begin at the preceding action's facing and turn into the route. Heading is
  // unwrapped before interpolation, preserving a full circle without a spin.
  const initialHeading = samples[0].heading;
  return {
    point: mix(a.point, b.point, t),
    heading:
      a.heading +
      (b.heading - a.heading) * t -
      initialHeading * (1 - ease(u / 0.08)),
    travelled,
    length: compiled.length,
  };
}
export function pathToWorld(point: Point, frame: PathFrame): Point {
  return turnPoint(
    point.map((n) => n * frame.scale) as Point,
    frame.heading,
  ).map((n, i) => n + frame.position[i]) as Point;
}
export function worldToPath(point: Point, frame: PathFrame): Point {
  return turnPoint(
    point.map((n, i) => (n - frame.position[i]) / frame.scale) as Point,
    -frame.heading,
  );
}

export function savePathCommands(
  scene: Scene,
  actorId: string,
  motion: Motion,
  clipId?: string,
): Command[] {
  const actor = scene.entities.find((e) => e.id === actorId);
  if (!actor) throw Error("This character is no longer in the scene.");
  if (!clipId)
    return [
      { type: "createMotion", motion },
      { type: "chain", id: actorId, motionId: motion.id },
    ];
  const clip = actor.clips.find((c) => c.id === clipId);
  if (!clip || clip.motionId !== motion.id)
    throw Error(
      "This action changed while the path editor was open. Open it again.",
    );
  const references = scene.entities
    .flatMap((e) => e.clips)
    .filter((c) => c.motionId === motion.id).length;
  const next = references > 1 ? { ...motion, id: crypto.randomUUID() } : motion;
  return [
    { type: references > 1 ? "createMotion" : "updateMotion", motion: next },
    {
      type: "update",
      id: actorId,
      changes: {
        clips: actor.clips.map((c) =>
          c.id === clipId
            ? { ...c, motionId: next.id, duration: next.duration }
            : c,
        ),
      },
    },
  ];
}
