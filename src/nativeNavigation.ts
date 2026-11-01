import * as T from "three";
import {
  allMotions,
  validateScene,
  type Scene,
  type Motion,
  type Entity,
} from "../shared/scene";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import { compilePath, pathToWorld, worldToPath } from "../shared/path";
import { repairCapturedTrajectory } from "../shared/trajectoryRoute";
import { capturedRouteTravelScale } from "./routeContactWarp";
import type { Point } from "../shared/ladder";
import type { Footprint } from "../shared/navigation";
import { importedClip, motionSource, rigHeading, standingHeight } from "./rig";
import { measureNativeTravel } from "./nativeTravel";
import { inspectNativeLoop } from "./nativeLoop";
import { routeEntryHeading, routeSourceDuration } from "./locomotion";
import { routeContext, planPointRoute } from "./routePlanner";
import {
  inspectRouteClearanceSteps,
  movingObstacleIds,
} from "./routeClearance";
import { applyAnimatedEntityPose } from "./world";

/** Revalidate the untouched captured trajectory before considering a detour.
 * Keep its source descriptor even after routing so later obstacle edits can
 * restore the actual original performance, not an approximation of its path. */
export function* planNativeNavigationSteps(
  original: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clipId: string,
  environment?: T.Object3D | null,
): Generator<void, Scene, unknown> {
  const actor = original.entities.find((e) => e.id === actorId)!,
    clip = actor.clips.find((c) => c.id === clipId)!;
  const intent = clip.navigation!,
    authored = intent.native!;
  const motion = allMotions(original).find((m) => m.id === authored.motionId),
    group = objects.get(actorId);
  if (!group || motion?.kind !== "imported" || motion.path)
    throw Error("The original imported performance is unavailable.");
  const source =
    motion.sourceAssetId === actor.assetId
      ? group
      : motionSource(group, motion.sourceAssetId!);
  const take = importedClip(
    source?.userData.animations || [],
    motion.animationName || "",
  );
  if (!source || !take)
    throw Error("Wait for the original imported take to load.");
  const restored: Entity["clips"][number] = { ...clip, ...authored };
  restored.navigation = { ...intent };
  delete restored.navigation.clearance;
  delete restored.routeHold;
  if (authored.sourceStart === undefined) delete restored.sourceStart;
  if (authored.legacyFit === undefined) delete restored.legacyFit;
  const same = JSON.stringify(restored) === JSON.stringify(clip);
  const scene = same
    ? original
    : validateScene(
        retimeDialogueAfterChange(original, {
          ...original,
          entities: original.entities.map((e) =>
            e.id !== actorId
              ? e
              : {
                  ...e,
                  clips: e.clips.map((c) => (c.id === clipId ? restored : c)),
                },
          ),
        }),
      );
  const clear = yield* inspectRouteClearanceSteps(
    scene,
    objects,
    actorId,
    clipId,
    environment,
  );
  if (!clear.blocked) {
    // A cleared obstacle restores the authored take and releases its private
    // generated route. Repeated obstacle edits must not fill the motion library.
    if (
      clip.motionId !== authored.motionId &&
      !scene.entities.some((e) =>
        e.clips.some((c) => c.motionId === clip.motionId),
      )
    )
      return {
        ...scene,
        customMotions: scene.customMotions.filter(
          (m) => m.id !== clip.motionId,
        ),
      };
    return scene;
  }
  const measured = measureNativeTravel(source, group, take, restored);
  if (
    !measured?.profile ||
    measured.profile.mode !== "travel" ||
    measured.profile.distance < 0.15 ||
    Math.abs(measured.destination.y) >
      Math.max(1e-4, standingHeight(source) * measured.ratio * 0.02)
  )
    throw Error(
      "The blocked performance needs a continuation that preserves its captured movement; no level travelling gait is available.",
    );
  const { profile, ratio, playbackRate, holdDuration } = measured;
  const loop = inspectNativeLoop(source, take, profile);
  const preserveTrajectory =
    !loop.allowed ||
    profile.distance * ratio >
      Math.hypot(measured.destination.x, measured.destination.z) * 1.4;
  if (preserveTrajectory && !profile.nativeContacts?.length)
    throw Error(
      loop.allowed
        ? "The captured trajectory needs grounded movement evidence before adapting its steps."
        : loop.reason,
    );
  const point: Point = [measured.destination.x, 0, measured.destination.z],
    cycle = {
      duration: profile.duration,
      distance: profile.distance * ratio,
      entryHeading: routeEntryHeading(profile),
      samples: profile.frames.map((f) => ({
        time: f.time,
        distance: f.distance * ratio,
      })),
    };
  if (point.some((n) => Math.abs(n) > 50))
    throw Error("This imported movement exceeds the current route bounds.");
  const locomotion: Motion = {
    ...motion,
    path: {
      points: [[0, 0, 0], point],
      smooth: false,
      sourceRange: { start: measured.sourceStart, end: measured.sourceEnd },
    },
  };
  const context = routeContext(scene, objects, actorId, clipId, environment);
  const frame = context.frame;
  const origin = profile.frames[0].center;
  const captured: Point[] = profile.frames.map((f) => {
    const p = f.center
      .clone()
      .sub(origin)
      .applyAxisAngle(new T.Vector3(0, 1, 0), -profile.startHeading)
      .multiplyScalar(ratio);
    return pathToWorld([p.x, 0, p.z], frame);
  });
  captured[captured.length - 1] = pathToWorld(point, frame);
  const movingIds = movingObstacleIds(scene);
  movingIds.delete(actorId);
  const conflicts: Footprint[] = [];
  for (const c of clear.conflicts)
    if (c.moving || movingIds.has(c.footprint.id)) conflicts.push(c.footprint);
  // Start with the planner's anatomical shoulder envelope. The complete
  // native pose can be wider across than along travel; its circumscribed circle
  // must not turn a clear starting stance into an artificial obstruction.
  // Failed candidate geometry checks expand clearance below.
  let clearance = intent.clearance ?? 0;
  const currentMotion = allMotions(original).find(
    (m) => m.id === clip.motionId,
  );
  let id = currentMotion?.path
      ? currentMotion.id
      : `navigation-native-${actorId}-${clipId}`,
    suffix = 2;
  if (!currentMotion?.path) {
    const base = id;
    while (allMotions(original).some((m) => m.id === id))
      id = `${base}-${suffix++}`;
  }
  const conflictIds = new Set<string>();
  let repeated = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    yield;
    const planned = preserveTrajectory
      ? (() => {
          const radius =
            Math.max(context.radius, clearance * actor.scale) +
            0.04 * actor.scale;
          const obstacles = [
            ...context.footprints.filter((p) => !movingIds.has(p.id)),
            ...conflicts,
          ].map((p) => ({
            ...p,
            minX: p.minX - radius,
            maxX: p.maxX + radius,
            minZ: p.minZ - radius,
            maxZ: p.maxZ + radius,
          }));
          const repaired = repairCapturedTrajectory(
            captured,
            obstacles,
            actor.scale,
            profile.frames.map((f) => f.distance / profile.distance),
          );
          const path = {
            points: repaired.points.map((p) => worldToPath(p, frame)),
            smooth: repaired.smooth,
            sourceProgress: repaired.sourceProgress,
            sourceRange: {
              start: measured.sourceStart,
              end: measured.sourceEnd,
            },
            endHeading: profile.frames.at(-1)!.heading - profile.startHeading,
          };
          const strideScale =
            compilePath(path).length / (profile.distance * ratio);
          if (strideScale < 0.9 || strideScale > 1.1)
            throw Error(
              "The detour needs additional matched captured steps to retain this complete performance.",
            );
          return { ...motion, path: { ...path, strideScale } };
        })()
      : planPointRoute(
          scene,
          objects,
          actorId,
          point,
          intent.movement,
          clipId,
          environment,
          locomotion,
          cycle,
          clearance * actor.scale,
          { movingIds, conflicts, durationScale: 1 / playbackRate },
          // Arrival geometry follows captured travel, which can be sideways or
          // backwards relative to the body's desired final facing.
          profile.frames.at(-1)!.heading - profile.startHeading,
        );
    const distance =
      compilePath(planned.path!).length /
      ratio /
      (planned.path!.strideScale ?? 1);
    if (preserveTrajectory) {
      const adaptedScale = capturedRouteTravelScale(
        planned.path!,
        profile,
        ratio,
        standingHeight(source),
      );
      if (
        adaptedScale !== undefined &&
        (adaptedScale < 0.9 || adaptedScale > 1.1)
      )
        throw Error(
          "The contact-preserving detour needs additional matched captured steps to retain this complete performance.",
        );
    }
    // A native performance is not permission to trim away its ending just
    // because a shorter geometry route exists. Continuation matching must
    // retain the complete selected interval before accepting such a route.
    if (distance < profile.distance - 1e-6)
      throw Error(
        "The shorter detour needs a continuation that retains the full selected performance.",
      );
    const activeDuration = preserveTrajectory
      ? measured.activeDuration
      : routeSourceDuration(profile, distance) / playbackRate;
    const duration = activeDuration + holdDuration;
    if (!(duration >= 0.2 && duration <= 60))
      throw Error(
        "The detour cannot fit one action at the chosen source speed.",
      );
    let routed: Motion = { ...planned, id, name: motion.name, duration };
    const makeCandidate = () =>
      validateScene(
        retimeDialogueAfterChange(scene, {
          ...scene,
          customMotions: scene.customMotions.some((m) => m.id === id)
            ? scene.customMotions.map((m) => (m.id === id ? routed : m))
            : [...scene.customMotions, routed],
          entities: scene.entities.map((e) =>
            e.id !== actorId
              ? e
              : {
                  ...e,
                  clips: e.clips.map((c) => {
                    if (c.id !== clipId) return c;
                    const result = {
                      ...c,
                      motionId: id,
                      duration,
                      playbackRate,
                      routeHold: holdDuration || undefined,
                      navigation: { ...intent, clearance },
                    };
                    delete result.sourceStart;
                    delete result.legacyFit;
                    return result;
                  }),
                },
          ),
        }),
      );
    let candidate = makeCandidate();
    const candidateActor = candidate.entities.find((e) => e.id === actorId)!,
      index = candidateActor.clips.findIndex((c) => c.id === clipId),
      start = candidateActor.clips
        .slice(0, index)
        .reduce((n, c) => n + c.duration, 0);
    applyAnimatedEntityPose(
      group,
      candidateActor,
      candidate,
      start + activeDuration - 1e-7,
    );
    const actual = rigHeading(group);
    if (actual === undefined || group.userData.motionWarning)
      throw Error("The routed body's final facing is unavailable.");
    const delta = actual - (frame.heading + measured.endHeading),
      correction = Math.atan2(Math.sin(delta), Math.cos(delta));
    routed = {
      ...routed,
      path: {
        ...routed.path!,
        endHeading:
          (routed.path!.endHeading ?? measured.endHeading) - correction,
      },
    };
    candidate = makeCandidate();
    const check = yield* inspectRouteClearanceSteps(
      candidate,
      objects,
      actorId,
      clipId,
      environment,
    );
    if (!check.blocked) return candidate;
    let learned = false;
    for (const c of check.conflicts) {
      if (conflictIds.has(c.footprint.id)) repeated = true;
      conflictIds.add(c.footprint.id);
      if (
        (c.moving || movingIds.has(c.footprint.id)) &&
        !conflicts.some(
          (p) => JSON.stringify(p) === JSON.stringify(c.footprint),
        )
      ) {
        conflicts.push(c.footprint);
        learned = true;
      }
    }
    // A newly learned animated footprint is tried at the same width first;
    // otherwise, or once the same obstacle conflicts again, widen across the
    // facing first, then to the full swing extent.
    const widened = check.lateral > clearance ? check.lateral : check.radius;
    if (!learned && check.radius <= clearance)
      throw Error(`The imported body cannot clear ${check.blocked}.`);
    if (preserveTrajectory)
      clearance = Math.min(
        check.radius,
        Math.max(clearance, context.radius / actor.scale) +
          0.025 * 2 ** attempt,
      );
    else if (!learned || repeated) clearance = Math.max(clearance, widened);
  }
  throw Error(
    "No clear continuation of this imported performance is available.",
  );
}
