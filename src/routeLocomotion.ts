import {
  allMotions,
  resolveMotionSource,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";
import { motionSource } from "../shared/motionLibrary";

export type RouteMovement = "walk" | "run";
/** Distance in actor-local units, before the placed entity scale is applied. */
export type RouteGaitCycle = {
  distance: number;
  duration: number;
  warning?: string;
};

/** Names suggest useful defaults, never prove that an uploaded clip loops. */
export function namedRouteMovement(motion: Motion): RouteMovement | undefined {
  if (motion.kind === "walk" || motion.kind === "run") return motion.kind;
  const name = `${motion.animationName || ""} ${motion.name}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z]+/g, " ")
    .toLowerCase();
  if (/\b(run|running|jog|jogging|sprint|sprinting)\b/.test(name)) return "run";
  if (/\b(walk|walking)\b/.test(name)) return "walk";
  return undefined;
}

export function routeMovement(motion: Motion): RouteMovement {
  return namedRouteMovement(motion) || "walk";
}

const sourceKey = (motion: Motion) =>
  motion.kind === "imported"
    ? JSON.stringify([motion.sourceAssetId, motion.animationName])
    : motion.kind;

/** Keep the two legacy studio gaits, bundled locomotion, and original uploaded
 * clips. Unnamed uploads remain selectable: a filename cannot tell us whether
 * Take001 is a gait. Route copies are deduplicated by their original source. */
export function routeLocomotions(
  scene: Scene,
  actor: Entity,
  current?: Motion,
): Motion[] {
  const motions = allMotions(scene);
  const studio = motions.filter((motion) =>
    ["walk", "run"].includes(motion.id),
  );
  const imported = motions.filter((motion) => {
    if (motion.kind !== "imported" || motion.path) return false;
    const source = resolveMotionSource(scene, motion.sourceAssetId);
    return (
      !!motion.animationName &&
      source?.category === "characters" &&
      !!source.url &&
      (source.id !== motionSource.id || !!namedRouteMovement(motion))
    );
  });
  // A route remains editable even if its original action was renamed/removed,
  // or its source is temporarily unavailable. Playback reports missing sources.
  if (current?.kind === "imported") imported.push(current);
  imported.sort(
    (a, b) =>
      Number(b.sourceAssetId === actor.assetId) -
      Number(a.sourceAssetId === actor.assetId),
  );
  const seen = new Set<string>();
  return [...studio, ...imported].filter((motion) => {
    const key = sourceKey(motion);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchingRouteLocomotion(
  motions: Motion[],
  motion: Motion,
): Motion | undefined {
  return motions.find(
    (candidate) => sourceKey(candidate) === sourceKey(motion),
  );
}

/** Prefer the actor's established/native gait; otherwise use the authored
 * library loop, not a procedural replacement of an imported performance. */
export function defaultRouteLocomotion(
  scene: Scene,
  actor: Entity,
  movement: RouteMovement = "walk",
): Motion {
  const available = routeLocomotions(scene, actor);
  const matching = available.filter(
    (motion) =>
      motion.kind === "imported" && namedRouteMovement(motion) === movement,
  );
  const library = allMotions(scene);
  for (const clip of [...actor.clips].reverse()) {
    const motion = library.find((candidate) => candidate.id === clip.motionId);
    if (motion?.kind !== "imported" || namedRouteMovement(motion) !== movement)
      continue;
    const previous = matchingRouteLocomotion(matching, motion);
    if (previous) return previous;
  }
  return (
    matching.find((motion) => motion.sourceAssetId === actor.assetId) ||
    matching.find((motion) => motion.id === `authored-${movement}`) ||
    available.find((motion) => motion.id === movement)!
  );
}

/** Imported routes are ordinary imported actions with path data. Do not copy
 * source duration, ID, authored travel or keyframes over the route metadata. */
export function routeLocomotionFields(
  motion: Motion,
): Pick<Motion, "kind" | "sourceAssetId" | "animationName"> {
  if (motion.kind === "walk" || motion.kind === "run")
    return { kind: motion.kind };
  if (
    motion.kind !== "imported" ||
    !motion.sourceAssetId ||
    !motion.animationName
  )
    throw Error("Choose a walking, running, or imported locomotion action.");
  return {
    kind: "imported",
    sourceAssetId: motion.sourceAssetId,
    animationName: motion.animationName,
  };
}

/** Distance and cycleDistance must use the same (actor-local) units. Sampling
 * depends only on distance, so changing route duration cannot stretch a stride,
 * and seeking/export gives exactly the same original clip pose as playback. */
export function routeCycleTime(
  distance: number,
  cycleDistance: number,
  nativeDuration: number,
): number {
  if (
    !Number.isFinite(distance) ||
    !Number.isFinite(cycleDistance) ||
    cycleDistance <= 0 ||
    !Number.isFinite(nativeDuration) ||
    nativeDuration <= 0
  )
    throw Error(
      "A route gait needs a finite distance and a positive cycle size.",
    );
  const fraction = ((distance % cycleDistance) + cycleDistance) % cycleDistance;
  return (fraction / cycleDistance) * nativeDuration;
}

/** Imported natural pace must come from the full original clip and target rig.
 * Only the explicit studio procedural gaits have a fixed authored pace. */
export function routePace(
  motion: Motion,
  actorScale = 1,
  measuredCycle?: RouteGaitCycle,
): number {
  if (motion.kind === "imported" && !measuredCycle)
    throw Error("Measure this imported gait before using natural pace.");
  if (
    measuredCycle &&
    (!Number.isFinite(measuredCycle.distance) ||
      measuredCycle.distance <= 0 ||
      !Number.isFinite(measuredCycle.duration) ||
      measuredCycle.duration <= 0)
  )
    throw Error(
      "A route gait needs a positive measured distance and duration for its pace.",
    );
  const speed = measuredCycle
    ? measuredCycle.distance / measuredCycle.duration
    : routeMovement(motion) === "run"
      ? 2.6
      : 1.1;
  if (
    !Number.isFinite(speed) ||
    speed <= 0 ||
    !Number.isFinite(actorScale) ||
    actorScale <= 0
  )
    throw Error("A route gait needs a positive pace and character scale.");
  return speed * actorScale;
}
