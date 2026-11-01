import * as T from "three";
import { finishNavigationWork } from "./navigationWork";
import {
  allAssets,
  allMotions,
  duration,
  type Entity,
  type Scene,
} from "../shared/scene";
import type { Footprint } from "../shared/navigation";
import { interactionSessions } from "../shared/interactions";
import { applyAnimatedEntityPose } from "./world";
import { rigHeading } from "./rig";
import {
  snapshotCollider,
  firstInterpolatedOverlap,
  combineColliders,
  type Collider,
  type CollisionObstacle,
} from "./collision";
import { sceneObstacles } from "./assetManipulation";
import { applyConversationPerformance } from "./conversationPerformance";
import { applyInteractions } from "./interactions";

/** Pose animation, conversation turns and carried props can all move geometry. */
export function movingObstacleIds(scene: Scene) {
  const ids = new Set(
    scene.entities.filter((e) => e.clips.length).map((e) => e.id),
  );
  for (const session of interactionSessions(scene, allMotions(scene)))
    ids.add(session.targetId);
  if (scene.transcript.length) {
    const cast = new Set(
      allAssets(scene)
        .filter((a) => a.category === "characters")
        .map((a) => a.id),
    );
    for (const entity of scene.entities)
      if (cast.has(entity.assetId)) ids.add(entity.id);
  }
  return ids;
}
export type RouteConflict = {
  footprint: Footprint;
  time: number;
  moving: boolean;
};

/** Evaluate mesh clearance on the absolute timeline, including carried objects.
 * Between samples, relative AABB sweeps catch fast translational crossings.
 * 60 Hz skin/morph/rotation bounds remain a sampled approximation, not physics. */
export function* inspectRouteClearanceSteps(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clipId: string,
  environment?: T.Object3D | null,
  options: {
    stopAtFirstConflict?: boolean;
    /** Absolute times to reject obvious collisions before the full scan. These
     * isolated poses are never swept together or used to accept a route. */
    rejectionTimes?: number[];
  } = {},
) {
  const actor = scene.entities.find((e) => e.id === actorId)!,
    group = objects.get(actorId)!,
    index = actor.clips.findIndex((c) => c.id === clipId),
    clip = actor.clips[index],
    start = actor.clips.slice(0, index).reduce((s, c) => s + c.duration, 0),
    end = start + clip.duration;
  // A following cut must not replace the route's terminal gait pose in the scan.
  const moving: Entity = {
    ...actor,
    clips: actor.clips.slice(0, index + 1),
    ending: "hold" as const,
  };
  const evaluation = {
    ...scene,
    entities: scene.entities.map((e) => (e.id === actorId ? moving : e)),
  };
  const sessions = interactionSessions(evaluation, allMotions(evaluation));
  const dynamicIds = movingObstacleIds(evaluation);
  dynamicIds.delete(actorId);
  const pose = (time: number) => {
    moving.ending = time > end ? actor.ending : "hold";
    for (const entity of evaluation.entities)
      applyAnimatedEntityPose(
        objects.get(entity.id)!,
        entity,
        evaluation,
        time,
      );
    applyConversationPerformance(evaluation, time, objects);
    applyInteractions(evaluation, time, objects, sessions);
  };
  pose(start);
  const all = sceneObstacles(evaluation, objects, actorId, environment).filter(
    (o) => o.id !== "ground",
  );
  // With no possible obstacle there is no temporal collision question. In
  // particular, importing a long stationary performance need not resample
  // thousands of full skin poses just to preserve its untouched playback.
  if (!all.length)
    return {
      blocked: null,
      conflicts: [] as RouteConflict[],
      radius: 0,
      lateral: 0,
    };
  const fixed = all.filter((o) => !dynamicIds.has(o.id));
  const animated = all.filter((o) => dynamicIds.has(o.id));
  let radius = 0;
  let lateral = 0;
  let previousBody: Collider | undefined;
  let previousObstacles = new Map<string, CollisionObstacle>();
  let previousTime = start;
  const conflicts = new Map<string, RouteConflict>();
  const times = [start];
  // Validate the destination after arrival too: another actor may reach it
  // during the terminal hold/rest, which is part of playback and export.
  const horizon =
    index === actor.clips.length - 1 && dynamicIds.size
      ? Math.max(end, duration(scene))
      : end;
  // An absolute clock makes predictions stable when detour duration changes.
  for (let tick = Math.floor(start * 60) + 1; tick / 60 < horizon; tick++)
    times.push(tick / 60);
  times.push(end, horizon);
  if (horizon > end && actor.ending === "rest") times.push(end + 1e-5);
  times.sort((a, b) => a - b);
  const probes = options.stopAtFirstConflict
    ? [...new Set(options.rejectionTimes ?? [])].filter(
        (time) => Number.isFinite(time) && time >= start && time <= horizon,
      )
    : [];
  const samples = [
    ...probes.map((time) => ({ time, probe: true })),
    ...times.map((time) => ({ time, probe: false })),
  ];
  let wasProbe = false;
  for (const { time, probe } of samples) {
    if (probe || wasProbe) {
      previousBody = undefined;
      previousObstacles.clear();
      previousTime = time;
    }
    wasProbe = probe;
    pose(time);
    const carried = new Set(
      sessions
        .filter(
          (session) =>
            session.actorId === actorId &&
            time >= session.acquire.start &&
            time < session.end,
        )
        .map((session) => session.targetId),
    );
    const collider = combineColliders([
        snapshotCollider(group),
        ...[...carried].map((id) => snapshotCollider(objects.get(id)!)),
      ]),
      bounds = collider.bounds;
    if (bounds.isEmpty())
      throw Error("The character has no visible collision geometry.");
    // Imported root tracks can leave the container far from the posed body
    // after source-origin compensation. Measure width around anatomy, not that
    // container offset; every candidate still receives full geometry checks.
    const hips = group.userData.bones?.hips as T.Object3D | undefined;
    const center = (hips ?? group).getWorldPosition(new T.Vector3());
    const x = Math.max(
      Math.abs(bounds.min.x - center.x),
      Math.abs(bounds.max.x - center.x),
    );
    const z = Math.max(
      Math.abs(bounds.min.z - center.z),
      Math.abs(bounds.max.z - center.z),
    );
    radius = Math.max(radius, Math.hypot(x, z));
    // Passing beside an obstacle only needs the body's width across its
    // facing; stride and arm swing extend mostly along it. Without a facing,
    // the full extent is the only safe width.
    const heading = rigHeading(group);
    if (heading === undefined) lateral = Math.max(lateral, Math.hypot(x, z));
    else {
      const rightX = Math.cos(heading),
        rightZ = -Math.sin(heading);
      for (const box of collider.boxes)
        for (const cornerX of [box.min.x, box.max.x])
          for (const cornerZ of [box.min.z, box.max.z])
            lateral = Math.max(
              lateral,
              Math.abs(
                (cornerX - center.x) * rightX + (cornerZ - center.z) * rightZ,
              ),
            );
    }
    const obstacles = [
      ...fixed,
      ...animated.map((o) => ({
        ...o,
        collider: snapshotCollider(objects.get(o.id)!),
      })),
    ];
    for (const obstacle of obstacles) {
      if (carried.has(obstacle.id)) continue;
      if (conflicts.has(obstacle.id)) continue;
      const before =
        previousObstacles.get(obstacle.id)?.collider || obstacle.collider;
      const fraction = firstInterpolatedOverlap(
        previousBody || collider,
        collider,
        before,
        obstacle.collider,
      );
      if (fraction === null) continue;
      const bounds = new T.Box3(
        before.bounds.min.clone().lerp(obstacle.collider.bounds.min, fraction),
        before.bounds.max.clone().lerp(obstacle.collider.bounds.max, fraction),
      );
      const quantum = 0.05 * actor.scale;
      const down = (n: number) => Math.floor(n / quantum) * quantum;
      const up = (n: number) => Math.ceil(n / quantum) * quantum;
      conflicts.set(obstacle.id, {
        time: previousTime + (time - previousTime) * fraction,
        moving: dynamicIds.has(obstacle.id),
        footprint: {
          id: obstacle.id,
          name: obstacle.name,
          minX: down(bounds.min.x),
          maxX: up(bounds.max.x),
          minZ: down(bounds.min.z),
          maxZ: up(bounds.max.z),
        },
      });
    }
    previousBody = collider;
    previousObstacles = new Map(obstacles.map((o) => [o.id, o]));
    previousTime = time;
    yield;
    // Candidate rejection does not need the remaining radius/conflict survey.
    // Ordinary route planning still collects the complete envelope by default.
    if (options.stopAtFirstConflict && conflicts.size) break;
  }
  return {
    blocked: conflicts.values().next().value?.footprint.name || null,
    conflicts: [...conflicts.values()],
    // Round outward to avoid tiny sampling differences causing saved-path drift.
    radius: Math.ceil((radius / actor.scale) * 20) / 20,
    /** Half-width across the facing; never above radius. */
    lateral: Math.min(
      Math.ceil((lateral / actor.scale) * 20) / 20,
      Math.ceil((radius / actor.scale) * 20) / 20,
    ),
  };
}

export function inspectRouteClearance(
  ...args: Parameters<typeof inspectRouteClearanceSteps>
) {
  return finishNavigationWork(inspectRouteClearanceSteps(...args));
}
