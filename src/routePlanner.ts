import * as T from "three";
import {
  allAssets,
  allMotions,
  motionSchema,
  uid,
  type Scene,
  type Entity,
  type Motion,
} from "../shared/scene";
import { interactionSessions } from "../shared/interactions";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import { inside, type Footprint } from "../shared/navigation";
import { routeWithApproaches } from "../shared/routeApproach";
import {
  compilePath,
  samplePath,
  retainedHeadingWindows,
  pathToWorld,
  worldToPath,
  type MotionPath,
  type PathFrame,
  type RetainedPrefix,
} from "../shared/path";
import type { Point } from "../shared/ladder";
import { applyAnimatedEntityPose } from "./world";
import { entityPose } from "../shared/animation";
import { reachableGrip } from "./interactions";
import { obstacleMesh, snapshotCollider } from "./collision";
import {
  routeLocomotionFields,
  routePace,
  type RouteGaitCycle,
} from "./routeLocomotion";

export type RouteContext = {
  frame: PathFrame;
  footprints: Footprint[];
  time: number;
  radius: number;
};
export type RoutePrediction = {
  movingIds: Set<string>;
  conflicts: Footprint[];
  durationScale?: number;
  /** The caller verifies actual animated body clearance before retaining it. */
  existingPath?: MotionPath;
  /** Keep the travelled guide points and continue from their end: a replan
   * during playback must not move the body at the current time. */
  resume?: RetainedPrefix;
};
/** A start within clearance of furniture may step out of that clearance; a
 * start inside the furniture itself must be moved by the creator first. */
function startMayExit(
  start: Point,
  raw: Footprint[],
  expanded: Footprint[],
): boolean {
  const touching = raw.find((box) => inside(start, box));
  if (touching)
    throw Error(
      `Move the character clear of ${touching.name} before planning a route.`,
    );
  return expanded.some((box) => inside(start, box));
}
/** Plan the remainder from the retained prefix's end and express it in the
 * clip's own frame. The prefix is kept verbatim so the played curve is exact. */
function resumedRoute(
  frame: PathFrame,
  resume: RetainedPrefix,
  plan: (origin: PathFrame) => MotionPath,
): MotionPath {
  const origin: PathFrame = {
    position: pathToWorld(resume.origin, frame),
    heading: frame.heading + resume.heading,
    scale: frame.scale,
  };
  const remainder = plan(origin);
  const points = [
    ...resume.points,
    ...remainder.points
      .slice(1)
      .map((point) => worldToPath(pathToWorld(point, origin), frame)),
  ];
  const endHeading =
    remainder.endHeading === undefined
      ? undefined
      : Math.atan2(
          Math.sin(remainder.endHeading + resume.heading),
          Math.cos(remainder.endHeading + resume.heading),
        );
  const continued: MotionPath = {
    points,
    smooth: true,
    ...(endHeading === undefined ? {} : { endHeading }),
  };
  return {
    ...continued,
    ...retainedHeadingWindows(
      resume.path,
      resume.travelled,
      compilePath(continued).length,
    ),
  };
}
function prefixOf(actor: Entity, beforeClipId?: string) {
  const index = beforeClipId
    ? actor.clips.findIndex((c) => c.id === beforeClipId)
    : actor.clips.length;
  if (index < 0) throw Error("This action is no longer in the sequence.");
  // The next action begins from the accumulated endpoint, not a held limb pose.
  return {
    ...actor,
    ending: "rest" as const,
    clips: actor.clips.slice(0, index),
  };
}
export function routeContext(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  beforeClipId?: string,
  environment?: T.Object3D | null,
): RouteContext {
  const actor = scene.entities.find((e) => e.id === actorId),
    rig = objects.get(actorId);
  if (
    !actor ||
    !rig ||
    !actor.visible ||
    allAssets(scene).find((a) => a.id === actor.assetId)?.category !==
      "characters"
  )
    throw Error("Choose a loaded character to plan a route.");
  const prefix = prefixOf(actor, beforeClipId),
    time = prefix.clips.reduce((sum, clip) => sum + clip.duration, 0);
  for (const entity of scene.entities) {
    const object = objects.get(entity.id);
    if (!object) throw Error("Wait for the scene objects to finish loading.");
    applyAnimatedEntityPose(
      object,
      entity.id === actorId ? prefix : entity,
      scene,
      time,
    );
    object.updateMatrixWorld(true);
  }
  // The route starts on the action's own floor: a recorded body bobs a few
  // millimetres around it, which must not turn the floor into an obstacle.
  const frame: PathFrame = {
    position: [
      rig.position.x,
      entityPose(prefix, scene, time).root[1],
      rig.position.z,
    ],
    heading: rig.rotation.y,
    scale: actor.scale,
  };
  const footprints = scene.entities
    .filter((e) => e.id !== actorId && e.visible)
    .flatMap((entity) => {
      const object = objects.get(entity.id)!;
      const box = new T.Box3().setFromObject(object, true);
      if (
        box.isEmpty() ||
        box.max.y <= frame.position[1] + 1e-4 * actor.scale ||
        box.min.y > frame.position[1] + 1.9 * actor.scale
      )
        return [];
      return [
        {
          id: entity.id,
          name: entity.name,
          minX: box.min.x,
          maxX: box.max.x,
          minZ: box.min.z,
          maxZ: box.max.z,
        },
      ];
    });
  if (environment) {
    for (const [index, box] of snapshotCollider(
      environment,
      obstacleMesh,
    ).boxes.entries()) {
      if (
        box.max.y <= frame.position[1] + 1e-4 * actor.scale ||
        box.min.y > frame.position[1] + 1.9 * actor.scale
      )
        continue;
      footprints.push({
        id: `environment-${index}`,
        name: "the backdrop",
        minX: box.min.x,
        maxX: box.max.x,
        minZ: box.min.z,
        maxZ: box.max.z,
      });
    }
  }
  const bones = rig.userData.bones as Record<string, T.Bone> | undefined;
  const shoulderWidth =
    bones?.leftArm && bones.rightArm
      ? bones.leftArm
          .getWorldPosition(new T.Vector3())
          .distanceTo(bones.rightArm.getWorldPosition(new T.Vector3()))
      : 0.5 * actor.scale;
  return {
    frame,
    footprints,
    time,
    radius: Math.max(0.14 * actor.scale, shoulderWidth * 0.56),
  };
}
/** Resolve stopping positions from the current loaded target geometry. Shared
 * by ordinary walking and captured arrivals; never infer a moved object's goal
 * from a previously saved route endpoint. The caller restores sampled poses. */
export function objectRouteGoals(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  targetId: string,
  context: RouteContext,
  bodyRadius = 0,
) {
  const target = scene.entities.find((e) => e.id === targetId),
    actor = scene.entities.find((e) => e.id === actorId);
  if (!actor || !target || actorId === targetId || !target.visible)
    throw Error("Choose another visible object as the destination.");
  if (target.clips.length)
    throw Error(
      `Finish staging ${target.name} as a still destination before planning a route.`,
    );
  const { frame, radius } = context;
  const rig = objects.get(actorId)!,
    prop = objects.get(targetId)!;
  if (!rig || !prop)
    throw Error("Wait for the scene objects to finish loading.");
  applyAnimatedEntityPose(prop, target, scene, context.time);
  prop.updateWorldMatrix(true, true);
  const asset = allAssets(scene).find((a) => a.id === target.assetId)!;
  const box = new T.Box3().setFromObject(prop, true),
    size = box.getSize(new T.Vector3());
  if (box.isEmpty()) throw Error("This destination has no visible geometry.");
  const smallProp =
    asset.category === "props" &&
    Math.max(size.x, size.z) < 0.7 * actor.scale &&
    size.y < 0.8 * actor.scale;
  const grip = new T.Vector3(
    ...(asset.grip ||
      ((asset.style === "cup" ? [0.13, 0.08, 0] : [0, 0.1, 0]) as Point)),
  );
  const destination = smallProp
    ? prop.localToWorld(grip)
    : box.getCenter(new T.Vector3());
  const clearance = Math.max(radius, bodyRadius) + 0.04 * actor.scale;
  const candidates: Point[] = [];
  const halfX = size.x / 2,
    halfZ = size.z / 2;
  for (let i = 0; i < 32; i++) {
    const angle = (i * Math.PI) / 16,
      dx = Math.sin(angle),
      dz = Math.cos(angle);
    // Stand just outside the clearance-expanded footprint along this ray;
    // adding the clearance along the ray itself leaves diagonal stopping
    // places inside that expanded box.
    const near =
      Math.min(
        Math.abs(dx) < 1e-8 ? Infinity : (halfX + clearance) / Math.abs(dx),
        Math.abs(dz) < 1e-8 ? Infinity : (halfZ + clearance) / Math.abs(dz),
      ) +
      0.06 * actor.scale;
    for (const distance of smallProp
      ? [0.22, 0.28, 0.34, 0.38, 0.5, 0.65, 0.8].map((n) => n * actor.scale)
      : [near]) {
      const point: Point = [
        destination.x + dx * distance,
        frame.position[1],
        destination.z + dz * distance,
      ];
      if (smallProp) {
        const neutral = {
          ...actor,
          position: point,
          rotation: Math.atan2(
            destination.x - point[0],
            destination.z - point[2],
          ),
          clips: [],
        };
        applyAnimatedEntityPose(rig, neutral, scene, 0);
        rig.updateMatrixWorld(true);
        if (!reachableGrip(rig, neutral, destination)) continue;
      }
      candidates.push(point);
    }
  }
  if (!candidates.length)
    throw Error(
      `${actor.name} cannot reach ${target.name} from this floor height. Lower the prop or resize the staging.`,
    );
  return { candidates, destination, smallProp };
}

export function assertObjectArrivalAvailable(
  scene: Scene,
  targetId: string,
  time: number,
  arrivingActorId?: string,
) {
  if (
    interactionSessions(scene, allMotions(scene)).some(
      (session) =>
        session.targetId === targetId &&
        session.acquire.start <= time &&
        session.end > time &&
        // Acquisition begins after this actor has reached the prop. A pickup
        // by somebody else, or an already-held prop, still blocks arrival.
        !(
          session.actorId === arrivingActorId &&
          Math.abs(session.acquire.start - time) <=
            Number.EPSILON * 32 * Math.max(1, Math.abs(time))
        ),
    )
  ) {
    const target = scene.entities.find((e) => e.id === targetId)!;
    throw Error(`Put down ${target.name} before this character arrives.`);
  }
}

export function planObjectRoute(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  targetId: string,
  kind: "walk" | "run",
  beforeClipId?: string,
  environment?: T.Object3D | null,
  locomotion?: Motion,
  measuredCycle?: RouteGaitCycle,
  bodyRadius = 0,
  prediction?: RoutePrediction,
): Motion {
  const context = routeContext(
    scene,
    objects,
    actorId,
    beforeClipId,
    environment,
  );
  const { frame, footprints, time, radius } = context;
  const { candidates, destination } = objectRouteGoals(
    scene,
    objects,
    actorId,
    targetId,
    context,
    bodyRadius,
  );
  const actor = scene.entities.find((e) => e.id === actorId)!,
    target = scene.entities.find((e) => e.id === targetId)!;
  const clearance = Math.max(radius, bodyRadius) + 0.04 * actor.scale;
  const planningFootprints = prediction
    ? [
        ...footprints.filter((p) => !prediction.movingIds.has(p.id)),
        ...prediction.conflicts,
      ]
    : footprints;
  const obstacles = planningFootprints.map((p) => ({
    ...p,
    minX: p.minX - clearance,
    maxX: p.maxX + clearance,
    minZ: p.minZ - clearance,
    maxZ: p.maxZ + clearance,
  }));
  const pace =
    (locomotion
      ? routePace(locomotion, frame.scale, measuredCycle)
      : kind === "run"
        ? 2.6
        : 1.1) / (prediction?.durationScale ?? 1);
  const lead = Math.max(
    0.2 * actor.scale,
    Math.min(0.8 * actor.scale, pace * 0.4),
  );
  const existing = prediction?.existingPath;
  const existingEnd = existing && pathToWorld(existing.points.at(-1)!, frame);
  const desiredHeading =
    existingEnd &&
    Math.atan2(destination.x - existingEnd[0], destination.z - existingEnd[2]) -
      frame.heading;
  const stillArrives =
    existing &&
    existingEnd &&
    desiredHeading !== undefined &&
    existing.endHeading !== undefined &&
    Math.abs(
      Math.atan2(
        Math.sin(existing.endHeading - desiredHeading),
        Math.cos(existing.endHeading - desiredHeading),
      ),
    ) < 1e-6 &&
    candidates.some(
      (goal) =>
        Math.hypot(...goal.map((n, i) => n - existingEnd[i])) <
        1e-6 * actor.scale,
    );
  const path = stillArrives
    ? existing
    : prediction?.resume
      ? resumedRoute(frame, prediction.resume, (origin) =>
          routeWithApproaches(
            origin,
            candidates,
            obstacles,
            destination.toArray(),
            targetId,
            lead,
            false,
            0,
            startMayExit(origin.position, planningFootprints, obstacles),
          ),
        )
      : routeWithApproaches(
          frame,
          candidates,
          obstacles,
          destination.toArray(),
          targetId,
          lead,
          locomotion?.path?.backward,
          measuredCycle?.entryHeading,
          startMayExit(frame.position, planningFootprints, obstacles),
        );
  if (path.points.length > 32)
    throw Error(
      "This route has too many turns. Open a simpler passage and try again.",
    );
  if (Math.hypot(path.points.at(-1)![0], path.points.at(-1)![2]) < 0.05)
    throw Error(
      `${actor.name} is already beside ${target.name}. Add the next action directly.`,
    );
  const length = compilePath(path).length * frame.scale;
  const naturalDuration =
    length /
    (locomotion
      ? routePace(locomotion, frame.scale, measuredCycle, length)
      : kind === "run"
        ? 2.6
        : 1.1);
  // Rounding an imported route's duration silently changes its native cadence.
  const selectedDuration = naturalDuration * (prediction?.durationScale ?? 1);
  const duration =
    locomotion?.kind === "imported" || prediction?.durationScale !== undefined
      ? selectedDuration
      : Math.max(0.5, Math.round(naturalDuration * 10) / 10);
  if (duration < 0.2)
    throw Error(
      "This destination is too close for a route at the original gait's pace. Add the next action directly or choose a farther destination.",
    );
  if (duration > 60)
    throw Error(
      "This destination is too far for one action. Add an intermediate stop.",
    );
  // Replacing a route also moves its following pickup and dependent dialogue.
  // Test ownership on that proposed schedule, not the old pickup timestamp.
  const arrivalScene = beforeClipId
    ? retimeDialogueAfterChange(scene, {
        ...scene,
        entities: scene.entities.map((entity) =>
          entity.id !== actorId
            ? entity
            : {
                ...entity,
                clips: entity.clips.map((clip) =>
                  clip.id === beforeClipId ? { ...clip, duration } : clip,
                ),
              },
        ),
      })
    : scene;
  assertObjectArrivalAvailable(
    arrivalScene,
    targetId,
    time + duration,
    actorId,
  );
  const parsed = motionSchema.safeParse({
    id: "route-" + uid(),
    name: `${kind === "run" ? "Run" : "Walk"} to ${target.name}`.slice(0, 100),
    ...(locomotion ? routeLocomotionFields(locomotion) : { kind }),
    duration,
    distance: 0,
    poses: [],
    path: {
      ...path,
      ...(locomotion?.path?.sourceRange
        ? { sourceRange: { ...locomotion.path.sourceRange } }
        : {}),
      ...(locomotion?.path?.strideScale !== undefined
        ? { strideScale: locomotion.path.strideScale }
        : {}),
    },
  });
  if (!parsed.success)
    throw Error(
      "This route needs tighter turns or a longer distance than one action can handle. Move a prop or add an intermediate stop.",
    );
  return parsed.data;
}

/** Coordinate goals use the same loaded footprints and interpolated approach
 * planner as object goals. Coordinates remain relative to the clip's start,
 * so preceding travel, facing and placed scale are applied exactly once. */
export function planPointRoute(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  point: Point,
  kind: "walk" | "run",
  beforeClipId?: string,
  environment?: T.Object3D | null,
  locomotion?: Motion,
  measuredCycle?: RouteGaitCycle,
  bodyRadius = 0,
  prediction?: RoutePrediction,
  endHeading?: number,
): Motion {
  const { frame, footprints, radius } = routeContext(
    scene,
    objects,
    actorId,
    beforeClipId,
    environment,
  );
  const goal = pathToWorld(point, frame);
  const heading =
    endHeading ??
    Math.atan2(point[0], point[2]) - (locomotion?.path?.backward ? Math.PI : 0);
  const direction = frame.heading + heading;
  const facing: Point = [
    goal[0] + Math.sin(direction),
    goal[1],
    goal[2] + Math.cos(direction),
  ];
  const clearance = Math.max(radius, bodyRadius) + 0.04 * frame.scale;
  const planning = prediction
    ? [
        ...footprints.filter((p) => !prediction.movingIds.has(p.id)),
        ...prediction.conflicts,
      ]
    : footprints;
  const obstacles = planning.map((p) => ({
    ...p,
    minX: p.minX - clearance,
    maxX: p.maxX + clearance,
    minZ: p.minZ - clearance,
    maxZ: p.maxZ + clearance,
  }));
  const pace =
    (locomotion
      ? routePace(locomotion, frame.scale, measuredCycle)
      : kind === "run"
        ? 2.6
        : 1.1) / (prediction?.durationScale ?? 1);
  const lead = Math.max(
    0.2 * frame.scale,
    Math.min(0.8 * frame.scale, pace * 0.4),
  );
  const existing = prediction?.existingPath;
  const last = existing?.points.at(-1);
  const stillArrives =
    existing &&
    last &&
    Math.hypot(...last.map((n, i) => n - point[i])) < 1e-6 &&
    Math.abs(
      Math.atan2(
        Math.sin(samplePath(existing, 1).heading - heading),
        Math.cos(samplePath(existing, 1).heading - heading),
      ),
    ) < 1e-6;
  const path = stillArrives
    ? existing
    : prediction?.resume
      ? resumedRoute(frame, prediction.resume, (origin) =>
          routeWithApproaches(
            origin,
            [goal],
            obstacles,
            facing,
            "",
            lead,
            false,
            0,
            startMayExit(origin.position, planning, obstacles),
          ),
        )
      : routeWithApproaches(
          frame,
          [goal],
          obstacles,
          facing,
          "",
          lead,
          locomotion?.path?.backward,
          measuredCycle?.entryHeading,
          startMayExit(frame.position, planning, obstacles),
        );
  const length = compilePath(path).length * frame.scale;
  const seconds =
    (length /
      (locomotion
        ? routePace(locomotion, frame.scale, measuredCycle, length)
        : kind === "run"
          ? 2.6
          : 1.1)) *
    (prediction?.durationScale ?? 1);
  if (!(seconds >= 0.2 && seconds <= 60))
    throw Error(
      "This destination cannot fit one action at the selected pace. Choose another point or add an intermediate stop.",
    );
  const parsed = motionSchema.safeParse({
    id: "route-" + uid(),
    name: `${kind === "run" ? "Run" : "Walk"} to point`,
    ...(locomotion ? routeLocomotionFields(locomotion) : { kind }),
    duration: seconds,
    distance: 0,
    poses: [],
    path: {
      ...path,
      ...(locomotion?.path?.sourceRange
        ? { sourceRange: { ...locomotion.path.sourceRange } }
        : {}),
      ...(locomotion?.path?.strideScale !== undefined
        ? { strideScale: locomotion.path.strideScale }
        : {}),
    },
  });
  if (!parsed.success)
    throw Error(
      "This route needs more space or fewer turns. Adjust the staging or add an intermediate stop.",
    );
  return parsed.data;
}
