import * as T from "three";
import {
  allMotions,
  validateScene,
  type Scene,
  type Motion,
} from "../shared/scene";
import {
  compilePath,
  pathToWorld,
  worldToPath,
  samplePath,
  type MotionPath,
} from "../shared/path";
import { routeWithApproaches } from "../shared/routeApproach";
import type { Point } from "../shared/ladder";
import type { Footprint } from "../shared/navigation";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import {
  matchCapturedArrivalSteps,
  type ArrivalMatch,
} from "./arrivalMatching";
import {
  locomotionProfile,
  locomotionScale,
  routeSourceDuration,
  routeEntryHeading,
  routeLocomotionProfile,
} from "./locomotion";
import {
  importedClip,
  motionSource,
  nativeRootMotion,
  transferredRootMotion,
  rigHeading,
} from "./rig";
import {
  routeContext,
  objectRouteGoals,
  assertObjectArrivalAvailable,
} from "./routePlanner";
import { reachableGrip } from "./interactions";
import { applyAnimatedEntityPose } from "./world";
import { routeLoopPoseAllowed } from "./routeLoopPose";
import {
  inspectRouteClearanceSteps,
  movingObstacleIds,
} from "./routeClearance";
import { finishNavigationWork, runNavigationWork } from "./navigationWork";

export type CapturedArrivalAttempt = {
  sourceStart: number;
  sourceEnd: number;
  score: number;
  pass: number;
  clearance: number;
  destination: Point;
  reason?: string;
};
export type CapturedArrivalProposal =
  | {
      reason: string;
      candidateCount?: number;
      attempts?: CapturedArrivalAttempt[];
    }
  | {
      scene: Scene;
      match: ArrivalMatch;
      prefixClipId: string;
      arrivalClipId: string;
      playbackRate: number;
      destination: Point;
      endHeading: number;
      clearanceChecked: boolean;
      clearance: number;
      candidateCount: number;
      attempts: CapturedArrivalAttempt[];
    };

/** A reviewable proposal, not an automatic scene mutation. Reserve the actual
 * captured displacement/facing before matching the approaching gait phase.
 * Both the approach and the untouched stopping take must clear scene geometry.
 * Navigation ownership stays with the caller: installArrivalRoutes retains the
 * full destination request and source clock when adopting the split clips. */
export function* proposeCapturedArrivalSteps(
  original: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clipId: string,
  environment?: T.Object3D | null,
  options: {
    scheduledEnd?: number;
    gaitRange?: { start: number; end: number };
  } = {},
): Generator<void, CapturedArrivalProposal, unknown> {
  const actor = original.entities.find((e) => e.id === actorId),
    group = objects.get(actorId),
    clip = actor?.clips.find((c) => c.id === clipId),
    motion = clip && allMotions(original).find((m) => m.id === clip.motionId);
  if (!actor || !group || !clip || motion?.kind !== "imported" || !motion.path)
    return { reason: "Choose a loaded imported locomotion route." };
  const clipIndex = actor.clips.indexOf(clip);
  const start = actor.clips
    .slice(0, clipIndex)
    .reduce((sum, c) => sum + c.duration, 0);
  const scheduledEnd = options.scheduledEnd;
  const source =
    motion.sourceAssetId === actor.assetId
      ? group
      : motionSource(group, motion.sourceAssetId!);
  const take =
    source &&
    importedClip(source.userData.animations || [], motion.animationName || "");
  if (!source || !take)
    return { reason: "The original stopping take is unavailable." };
  const saved = new Map<
    T.Object3D,
    {
      position: T.Vector3;
      rotation: T.Quaternion;
      scale: T.Vector3;
      weights?: number[];
    }
  >();
  for (const root of new Set([...objects.values(), source]))
    root.traverse((node) => {
      if (!saved.has(node))
        saved.set(node, {
          position: node.position.clone(),
          rotation: node.quaternion.clone(),
          scale: node.scale.clone(),
          weights:
            node instanceof T.Mesh
              ? node.morphTargetInfluences?.slice()
              : undefined,
        });
    });
  try {
    const gaitRange = options.gaitRange ?? motion.path.sourceRange,
      profile = locomotionProfile(source, take, gaitRange),
      originalProfile = options.gaitRange
        ? locomotionProfile(source, take, motion.path.sourceRange)
        : profile,
      arrivalProfile = gaitRange ? locomotionProfile(source, take) : profile,
      ratio = source === group ? 1 : locomotionScale(source, group);
    if (
      !profile ||
      !originalProfile ||
      !arrivalProfile?.stops?.length ||
      !(ratio > 0)
    )
      return {
        reason: "This take has no measured travelling-to-standing segment.",
      };
    const originalPath = compilePath(motion.path),
      requestedDestination = [
        ...(clip.navigation?.point ?? motion.path.points.at(-1)!),
      ] as Point,
      requestedEndHeading = clip.navigation?.point
        ? (clip.navigation.endHeading ??
          Math.atan2(requestedDestination[0], requestedDestination[2]))
        : (motion.path.endHeading ?? originalPath.samples.at(-1)!.heading),
      rate =
        routeSourceDuration(
          originalProfile,
          originalPath.length / ratio / (motion.path.strideScale ?? 1),
        ) / clip.duration;
    const context = routeContext(
      original,
      objects,
      actorId,
      clipId,
      environment,
    );
    const targetId = clip.navigation?.targetId;
    const moving = movingObstacleIds(original);
    let clearance =
      Math.max(
        context.radius,
        (clip.navigation?.clearance ?? 0) * actor.scale,
      ) +
      0.04 * actor.scale;
    const collisionEnabled = original.animationCollisions !== false;
    const conflicts: Footprint[] = [];
    const attempts: CapturedArrivalAttempt[] = [];
    let candidateCount = 0;
    let lastReason =
      "No captured stop matches a clear approach to this destination and facing.";
    for (let pass = 1; pass <= 8; pass++) {
      let nextClearance = clearance,
        changed = false;
      const obstacles = (
        collisionEnabled
          ? [
              ...context.footprints.filter((p) => !moving.has(p.id)),
              ...conflicts,
            ]
          : []
      ).map((p) => ({
        ...p,
        minX: p.minX - clearance,
        maxX: p.maxX + clearance,
        minZ: p.minZ - clearance,
        maxZ: p.maxZ + clearance,
      }));
      const objectGoals = targetId
        ? objectRouteGoals(
            original,
            objects,
            actorId,
            targetId,
            context,
            clearance - 0.04 * actor.scale,
          )
        : undefined;
      const destinations = objectGoals
        ? objectGoals.candidates
            .map((goal) => ({
              destination: worldToPath(goal, context.frame),
              endHeading:
                Math.atan2(
                  objectGoals.destination.x - goal[0],
                  objectGoals.destination.z - goal[2],
                ) - context.frame.heading,
            }))
            .sort((a, b) => {
              // Keep a still-valid resolved endpoint first, otherwise prefer a
              // nearby side. Every candidate comes from current target geometry.
              const prior = (p: Point) =>
                Math.hypot(...p.map((n, i) => n - requestedDestination[i])) <
                1e-6;
              return (
                Number(prior(b.destination)) - Number(prior(a.destination)) ||
                Math.hypot(...a.destination) - Math.hypot(...b.destination)
              );
            })
        : [
            {
              destination: requestedDestination,
              endHeading: requestedEndHeading,
            },
          ];
      for (const { destination, endHeading } of destinations) {
        yield;
        const plans = new Map<string, MotionPath>();
        const result = yield* matchCapturedArrivalSteps(
          source,
          take,
          profile,
          originalPath.length / ratio / (motion.path.strideScale ?? 1),
          (start, end) => {
            const root = nativeRootMotion(source, take, end, start);
            if (!root) return undefined;
            if (
              source !== group &&
              !transferredRootMotion(source, group, take, end, start)
            )
              return undefined;
            const heading = endHeading - root.heading;
            const delta = root.delta
              .clone()
              .multiplyScalar(ratio)
              .applyAxisAngle(
                new T.Vector3(0, 1, 0),
                heading - root.startHeading,
              );
            const point: Point = [
              destination[0] - delta.x,
              0,
              destination[2] - delta.z,
            ];
            const goal = pathToWorld(point, context.frame),
              worldHeading = context.frame.heading + heading;
            const facing: Point = [
              goal[0] + Math.sin(worldHeading),
              goal[1],
              goal[2] + Math.cos(worldHeading),
            ];
            try {
              const path = routeWithApproaches(
                context.frame,
                [goal],
                obstacles,
                facing,
                targetId ?? "",
                0.2 * actor.scale,
                false,
                routeEntryHeading(profile),
              );
              if (gaitRange) path.sourceRange = { ...gaitRange };
              if (motion.path!.strideScale !== undefined)
                path.strideScale = motion.path!.strideScale;
              plans.set(`${start}:${end}`, path);
              return (
                compilePath(path).length /
                ratio /
                (motion.path!.strideScale ?? 1)
              );
            } catch {
              return undefined;
            }
          },
          arrivalProfile,
        );
        candidateCount += result.matches.length;
        if (!result.matches.length) continue;
        // Pose quality is a hard gate. Try every compatible source entry in score
        // order; obstruction never permits a less compatible pose or a faster take.
        for (const match of result.matches) {
          yield;
          const attempt: CapturedArrivalAttempt = {
            sourceStart: match.sourceStart,
            sourceEnd: match.sourceEnd,
            score: match.score,
            pass,
            clearance: clearance / actor.scale,
            destination,
          };
          attempts.push(attempt);
          try {
            const path = plans.get(`${match.sourceStart}:${match.sourceEnd}`)!;
            const next = structuredClone(original),
              nextActor = next.entities.find((e) => e.id === actorId)!;
            const unique = (base: string, used: Set<string>) => {
              let id = base,
                suffix = 2;
              while (used.has(id)) id = `${base}-${suffix++}`;
              used.add(id);
              return id;
            };
            const motionIds = new Set(allMotions(next).map((m) => m.id));
            const prefixMotionId = unique(
                `arrival-approach-${clipId}`,
                motionIds,
              ),
              stopMotionId = unique(`arrival-take-${clipId}`, motionIds),
              arrivalClipId = unique(
                `arrival-${clipId}`,
                new Set(next.entities.flatMap((e) => e.clips.map((c) => c.id))),
              );
            const prefixDuration = match.prefixSourceDuration / rate,
              stopDuration = (match.sourceEnd - match.sourceStart) / rate;
            if (
              scheduledEnd !== undefined &&
              Math.abs(start + prefixDuration + stopDuration - scheduledEnd) >
                1e-6
            )
              throw Error(
                "This arrival does not fit the explicitly fixed ending time.",
              );
            const prefix: Motion = {
              ...motion,
              id: prefixMotionId,
              duration: prefixDuration,
              path,
            };
            const { path: _path, ...standalone } = motion;
            next.customMotions.push(prefix, {
              ...standalone,
              id: stopMotionId,
              duration: take.duration,
            });
            // These are a proposal's ordinary clips. Do not leave a stale navigation
            // goal on the shortened prefix: it would route that prefix to the full goal.
            nextActor.clips[clipIndex] = {
              ...clip,
              motionId: prefixMotionId,
              duration: prefixDuration,
              navigation: undefined,
            };
            nextActor.clips.splice(clipIndex + 1, 0, {
              id: arrivalClipId,
              motionId: stopMotionId,
              duration: stopDuration,
              sourceStart: match.sourceStart,
              playbackRate: rate,
              transition: "smooth",
            });
            for (const line of next.transcript) {
              if (line.characterId !== actorId) continue;
              const ids = line.clipIds ?? (line.clipId ? [line.clipId] : []);
              if (ids.includes(clipId))
                line.clipIds = ids.flatMap((id) =>
                  id === clipId ? [id, arrivalClipId] : [id],
                );
            }
            let scene = validateScene(
              retimeDialogueAfterChange(original, next, [
                { actorId, clipId, endClipId: arrivalClipId },
              ]),
            );
            // The prefix's path heading is a travel frame. Its captured body
            // can face sideways/backward, or finish a corrected loop. Align
            // that evaluated body with the standalone tail's normalized entry
            // frame so inheriting actual facing does not turn the reserved tail
            // displacement away from its planned destination.
            applyAnimatedEntityPose(
              group,
              scene.entities.find((e) => e.id === actorId)!,
              scene,
              start + prefixDuration - 1e-7,
            );
            // Use playback's combined travel ratio for its cache identity.
            // Dividing by ratio and stride separately can differ by an ulp.
            const receivingDistance =
              compilePath(path).length / (ratio * (path.strideScale ?? 1));
            if (
              options.gaitRange &&
              match.prefixSourceDuration > profile.duration + 1e-6 &&
              routeLoopPoseAllowed(
                group,
                scene.entities.find((e) => e.id === actorId)!,
                scene,
                routeLocomotionProfile(profile, receivingDistance),
                start,
                prefixDuration,
                routeSourceDuration(profile, receivingDistance),
              ) !== true
            )
              throw Error(
                "This walking cycle does not close safely on the receiving character.",
              );
            const actualHeading = rigHeading(group);
            if (actualHeading === undefined || group.userData.motionWarning)
              throw Error(
                "The captured approach's final body facing is unavailable.",
              );
            const desiredHeading =
              context.frame.heading +
              (path.endHeading ?? samplePath(path, 1).heading);
            const correction = Math.atan2(
              Math.sin(actualHeading - desiredHeading),
              Math.cos(actualHeading - desiredHeading),
            );
            if (Math.abs(correction) > 1e-9)
              scene = validateScene({
                ...scene,
                customMotions: scene.customMotions.map((m) =>
                  m.id !== prefixMotionId
                    ? m
                    : {
                        ...m,
                        path: {
                          ...path,
                          endHeading:
                            (path.endHeading ?? samplePath(path, 1).heading) -
                            correction,
                        },
                      },
                ),
              });
            if (targetId) {
              const end = start + prefixDuration + stopDuration;
              assertObjectArrivalAvailable(scene, targetId, end, actorId);
              if (objectGoals?.smallProp) {
                // Test reach from the captured stance, not only a neutral pose.
                const resolvedActor = scene.entities.find(
                  (e) => e.id === actorId,
                )!;
                applyAnimatedEntityPose(
                  group,
                  {
                    ...resolvedActor,
                    clips: resolvedActor.clips.slice(0, clipIndex + 2),
                    ending: "hold",
                  },
                  scene,
                  end,
                );
                group.updateWorldMatrix(true, true);
                if (
                  !reachableGrip(group, resolvedActor, objectGoals.destination)
                )
                  throw Error(
                    "The captured stopping stance cannot reach this object.",
                  );
              }
            }
            // Check the actual final stance first. Most impossible object
            // approaches can then be rejected before scanning the entire walk.
            for (const id of collisionEnabled ? [arrivalClipId, clipId] : []) {
              const check = yield* inspectRouteClearanceSteps(
                scene,
                objects,
                actorId,
                id,
                environment,
                {
                  stopAtFirstConflict: true,
                  rejectionTimes: [
                    start +
                      prefixDuration +
                      (id === arrivalClipId ? stopDuration : 0),
                  ],
                },
              );
              if (check.blocked) {
                nextClearance = Math.max(
                  nextClearance,
                  (check.radius + 0.04) * actor.scale,
                );
                for (const conflict of check.conflicts) {
                  if (
                    conflict.moving &&
                    !conflicts.some(
                      (p) =>
                        JSON.stringify(p) ===
                        JSON.stringify(conflict.footprint),
                    )
                  ) {
                    conflicts.push(conflict.footprint);
                    changed = true;
                  }
                }
                throw Error(`The captured arrival overlaps ${check.blocked}.`);
              }
            }
            return {
              scene,
              match,
              prefixClipId: clipId,
              arrivalClipId,
              playbackRate: rate,
              destination,
              endHeading,
              clearanceChecked: collisionEnabled,
              clearance: Math.max(0, clearance / actor.scale - 0.04),
              candidateCount,
              attempts,
            };
          } catch (error) {
            attempt.reason =
              error instanceof Error ? error.message : String(error);
            lastReason = attempt.reason;
          }
        }
      }
      // Try a wider approach (or a detour around a measured moving conflict)
      // only after all compatible entries at this clearance have been rejected.
      // Re-match against the new path length; never reuse a stale gait phase.
      if (!changed && nextClearance <= clearance + 1e-6) break;
      clearance = nextClearance;
    }
    return {
      reason: attempts.length
        ? `None of the ${attempts.length} compatible captured arrivals clears the scene and schedule. ${lastReason}`
        : lastReason,
      candidateCount,
      attempts,
    };
  } catch (error) {
    return { reason: error instanceof Error ? error.message : String(error) };
  } finally {
    for (const [node, state] of saved) {
      node.position.copy(state.position);
      node.quaternion.copy(state.rotation);
      node.scale.copy(state.scale);
      if (state.weights && node instanceof T.Mesh)
        node.morphTargetInfluences!.splice(
          0,
          state.weights.length,
          ...state.weights,
        );
    }
    for (const root of new Set([...objects.values(), source]))
      root.updateWorldMatrix(true, true);
  }
}

export function proposeCapturedArrival(
  ...args: Parameters<typeof proposeCapturedArrivalSteps>
) {
  return finishNavigationWork(proposeCapturedArrivalSteps(...args));
}

export function proposeCapturedArrivalAsync(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clipId: string,
  environment?: T.Object3D | null,
  options?: {
    signal?: AbortSignal;
    onYield?: () => void;
    scheduledEnd?: number;
  },
): Promise<CapturedArrivalProposal> {
  return runNavigationWork(
    proposeCapturedArrivalSteps(
      scene,
      objects,
      actorId,
      clipId,
      environment,
      options,
    ),
    options,
  );
}
