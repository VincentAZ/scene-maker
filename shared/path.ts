import { motionSchema, type Motion, type Scene, type Command } from "./scene";

// Only built-in, non-travelling gestures are safe between relative route clips.
// No target, seating state, imported root motion, or custom keyframe is needed.
export const pointActionMotions = [
  { id: "idle", name: "Wait", duration: 2 },
  { id: "wave", name: "Wave", duration: 2 },
  { id: "bow", name: "Bow", duration: 2 },
  { id: "talk", name: "Talk gesture", duration: 3 },
  { id: "jump", name: "Jump in place", duration: 1 },
] as const;
export type PointAction = {
  /** Index in path.points: 1 is the first numbered point (not the start). */
  pointIndex: number;
  motionId: (typeof pointActionMotions)[number]["id"];
  duration: number;
};
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
  const tangent = a.heading + (b.heading - a.heading) * t;
  const arrivalTurn =
    path.endHeading === undefined
      ? 0
      : Math.atan2(
          Math.sin(path.endHeading - samples.at(-1)!.heading),
          Math.cos(path.endHeading - samples.at(-1)!.heading),
        );
  return {
    point: mix(a.point, b.point, t),
    heading:
      tangent +
      arrivalTurn * ease((u - 0.85) / 0.15) -
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

/** Materialize stops as ordinary clips: preview, GLB bake and engine export all
 * evaluate the same sequence, without a second waypoint-actions schema.
 * Smooth curves are tessellated from compilePath's own arc-length table. */
export function pathActionClips(motion: Motion, actions: PointAction[]) {
  const parsed = motionSchema.parse(motion);
  if (!parsed.path) throw Error("Point actions need a locomotion route.");
  const path = parsed.path;
  const byPoint = new Map<number, PointAction>();
  for (const action of actions) {
    if (
      !Number.isInteger(action.pointIndex) ||
      action.pointIndex < 1 ||
      action.pointIndex >= path.points.length ||
      byPoint.has(action.pointIndex) ||
      !pointActionMotions.some((m) => m.id === action.motionId) ||
      !Number.isFinite(action.duration) ||
      action.duration < 0.2 ||
      action.duration > 60
    )
      throw Error(
        "Choose one in-place action per numbered point, lasting 0.2–60 seconds.",
      );
    byPoint.set(action.pointIndex, action);
  }
  const compiled = compilePath(path);
  type Vertex = { point: Point; heading: number };
  const vertices = compiled.samples.map((sample): Vertex => ({
    point: sample.point,
    heading: samplePath(path, sample.distance / compiled.length).heading,
  }));
  // Remove redundant vertices, but keep every authored point exactly. The
  // existing schema requires neighbouring coordinates at least 5 cm apart.
  const simplify = (span: Vertex[]) => {
    const spaced = [span[0]];
    for (const vertex of span.slice(1, -1))
      if (distance(spaced.at(-1)!.point, vertex.point) >= 0.05)
        spaced.push(vertex);
    const end = span.at(-1)!;
    while (
      spaced.length > 1 &&
      distance(spaced.at(-1)!.point, end.point) < 0.05
    )
      spaced.pop();
    spaced.push(end);
    const reduce = (items: Vertex[]): Vertex[] => {
      const a = items[0].point,
        b = items.at(-1)!.point;
      const delta = b.map((n, i) => n - a[i]);
      const squared = delta.reduce((sum, n) => sum + n * n, 0);
      let furthest = 0.005,
        index = -1;
      for (let i = 1; i < items.length - 1; i++) {
        const point = items[i].point;
        const t = squared
          ? Math.max(
              0,
              Math.min(
                1,
                delta.reduce(
                  (sum, n, axis) => sum + n * (point[axis] - a[axis]),
                  0,
                ) / squared,
              ),
            )
          : 0;
        const error = distance(point, mix(a, b, t));
        if (error > furthest) {
          furthest = error;
          index = i;
        }
      }
      return index < 0
        ? [items[0], items.at(-1)!]
        : [
            ...reduce(items.slice(0, index + 1)).slice(0, -1),
            ...reduce(items.slice(index)),
          ];
    };
    const reduced = reduce(spaced);
    // Simplification can bring non-neighbouring points of a loop together.
    return reduced.some(
      (v, i) => i && distance(v.point, reduced[i - 1].point) < 0.05,
    )
      ? spaced
      : reduced;
  };
  type Part = { motion: Motion; length: number; action?: PointAction };
  const parts: Part[] = [];
  let heading = 0;
  let pending: Vertex[] = [vertices[0]];
  const emit = () => {
    if (pending.length < 2) return;
    const origin = pending[0].point;
    const local = pending.map((v) =>
      turnPoint(v.point.map((n, i) => n - origin[i]) as Point, -heading),
    );
    const next: Motion = {
      ...parsed,
      id: crypto.randomUUID(),
      name: `${parsed.name.slice(0, 75)} · route ${parts.filter((p) => !p.action).length + 1}`,
      path: {
        points: local,
        smooth: false,
        endHeading: pending.at(-1)!.heading - heading,
      },
    };
    const length = compilePath(next.path!).length;
    heading += samplePath(next.path!, 1).heading;
    parts.push({ motion: next, length });
    pending = [pending.at(-1)!];
  };
  for (let pointIndex = 1; pointIndex < path.points.length; pointIndex++) {
    // compilePath has 40 subdivisions per authored span, with shared endpoints.
    const span = simplify(
      vertices.slice((pointIndex - 1) * 40, pointIndex * 40 + 1),
    );
    for (let index = 1; index < span.length; index++) {
      const a = span[index - 1],
        b = span[index];
      // A long straight edge may have lost all of its intermediate samples.
      // Keep it small enough to fit the local-coordinate schema after turning.
      const divisions = Math.max(1, Math.ceil(distance(a.point, b.point) / 25));
      for (let step = 1; step <= divisions; step++) {
        const t = step / divisions;
        const vertex = {
          point: mix(a.point, b.point, t),
          heading: a.heading + (b.heading - a.heading) * t,
        };
        const local = turnPoint(
          vertex.point.map((n, i) => n - pending[0].point[i]) as Point,
          -heading,
        );
        if (pending.length >= 32 || local.some((n) => Math.abs(n) > 49.999999))
          emit();
        pending.push(vertex);
      }
    }
    const action = byPoint.get(pointIndex);
    if (action) {
      emit();
      parts.push({
        motion: {
          id: action.motionId,
          name: pointActionMotions.find((m) => m.id === action.motionId)!.name,
          kind: action.motionId,
          duration: action.duration,
          distance: 0,
          poses: [],
        },
        length: 0,
        action,
      });
    }
  }
  emit();
  const moving = parts.filter((part) => !part.action);
  if (parsed.duration + 1e-8 < moving.length * 0.2)
    throw Error(
      `Increase movement duration to at least ${(moving.length * 0.2).toFixed(1)} seconds for these stops.`,
    );
  // Preserve total movement time while respecting the minimum clip duration.
  let remainingTime = parsed.duration;
  let remaining = [...moving];
  while (remaining.length) {
    const length = remaining.reduce((sum, part) => sum + part.length, 0);
    const short = remaining.filter(
      (part) => (remainingTime * part.length) / length < 0.2,
    );
    if (!short.length) {
      for (const part of remaining)
        part.motion.duration = (remainingTime * part.length) / length;
      break;
    }
    for (const part of short) {
      part.motion.duration = 0.2;
      remainingTime -= 0.2;
    }
    remaining = remaining.filter((part) => !short.includes(part));
  }
  for (const part of moving) part.motion = motionSchema.parse(part.motion);
  return parts;
}

export function savePathCommands(
  scene: Scene,
  actorId: string,
  motion: Motion,
  clipId?: string,
  pointActions?: PointAction[],
): Command[] {
  const actor = scene.entities.find((e) => e.id === actorId);
  if (!actor) throw Error("This character is no longer in the scene.");
  if (pointActions?.length) {
    const clipIndex = clipId
      ? actor.clips.findIndex((c) => c.id === clipId)
      : actor.clips.length;
    const previous = clipId ? actor.clips[clipIndex] : undefined;
    if (clipId && (!previous || previous.motionId !== motion.id))
      throw Error(
        "This action changed while the path editor was open. Open it again.",
      );
    if (
      clipId &&
      scene.transcript.some(
        (line) =>
          line.characterId === actorId &&
          (line.clipIds || (line.clipId ? [line.clipId] : [])).includes(clipId),
      )
    )
      throw Error(
        "Point actions are not supported on dialogue routes. Edit the line's performance instead.",
      );
    const parts = pathActionClips(motion, pointActions);
    const moving = parts.filter((part) => !part.action);
    if (actor.clips.length - (previous ? 1 : 0) + parts.length > 100)
      throw Error(
        "This route and its point actions would exceed 100 sequence clips. Remove actions or points first.",
      );
    const references = scene.entities
      .flatMap((e) => e.clips)
      .filter((c) => c.motionId === motion.id).length;
    const replaceMotion = !!previous && references === 1;
    if (
      scene.customMotions.length + moving.length - (replaceMotion ? 1 : 0) >
      100
    )
      throw Error(
        "This route would exceed 100 custom actions. Remove unused actions or use fewer stops.",
      );
    moving[0].motion.id =
      replaceMotion || !previous ? motion.id : crypto.randomUUID();
    const commands: Command[] = moving.map((part, index) => ({
      type: index === 0 && replaceMotion ? "updateMotion" : "createMotion",
      motion: part.motion,
    }));
    const clips = parts.map((part, index) => ({
      id: index === 0 && previous ? previous.id : crypto.randomUUID(),
      motionId: part.motion.id,
      duration: part.motion.duration,
      // Each new route fragment keeps the imported gait's explicit timing,
      // never a legacy fit derived from its share of the travel duration.
      ...(part.motion.kind === "imported"
        ? { playbackRate: previous?.playbackRate ?? 1 }
        : {}),
      transition: index === 0 ? previous?.transition : ("cut" as const),
    }));
    commands.push({
      type: "update",
      id: actorId,
      changes: {
        clips: [
          ...actor.clips.slice(0, clipIndex),
          ...clips,
          ...actor.clips.slice(clipIndex + (previous ? 1 : 0)),
        ],
      },
    });
    return commands;
  }
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
