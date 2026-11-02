import {
  clipEffectiveEnd,
  clipPlaybackRate,
  clipSourceEnd,
  clipSourceStart,
  routeActiveDuration,
} from "../shared/clipTiming";
import { planNativeNavigationSteps } from "./nativeNavigation";
import * as T from "three";
import { finishNavigationWork, runNavigationWork } from "./navigationWork";
import {
  allMotions,
  duration,
  validateScene,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";
import { standingPerformance } from "./standingPerformance";
import { groundedPhases, routeStopCandidates } from "./routeStops";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import {
  compilePath,
  retainedPathPrefix,
  pathToWorld,
  worldToPath,
  type RetainedPrefix,
} from "../shared/path";
import {
  locomotionProfile,
  locomotionScale,
  routeEntryHeading,
  routeLocomotionProfile,
  routeSourceDuration,
  sampleRouteLocomotion,
} from "./locomotion";
import { importedClip, motionSource } from "./rig";
import { planObjectRoute, planPointRoute, routeContext } from "./routePlanner";
import {
  expandArrivalRequests,
  installArrivalRoutes,
  reusableArrivalRequests,
} from "./navigationArrivals";
import {
  inspectRouteClearanceSteps,
  movingObstacleIds,
} from "./routeClearance";
import type { Footprint } from "../shared/navigation";
import {
  gaitTravelTime,
  routePace,
  type RouteGaitCycle,
} from "./routeLocomotion";

export type NavigationIssue = {
  actorId: string;
  clipId: string;
  message: string;
};
export type PreparedRoutes = {
  scene: Scene;
  playbackScene: Scene;
  issues: NavigationIssue[];
};

type Clip = Entity["clips"][number];

/** Standing-performance clips that fill a wait of the given length: one take
 * per clip at native speed, blended at every seam, the last one trimmed to
 * what remains (or holding its final pose for under a fifth of a second). */
export function standingHoldClips(
  idle: Motion,
  baseId: string,
  seconds: number,
): Clip[] {
  return chunkedDurations(seconds, idle.duration).map((duration, index) => ({
    id: `${baseId}:wait:${index + 1}`,
    motionId: idle.id,
    duration,
    playbackRate: 1,
    stationary: true,
    transition: "smooth",
  }));
}

/** Clip durations covering a wait: whole takes (at most a minute each) and a
 * remainder, never a clip shorter than the schema allows. */
function chunkedDurations(seconds: number, take: number): number[] {
  const whole = Math.max(0.2, Math.min(60, take));
  const durations: number[] = [];
  let remaining = Math.max(0.2, seconds);
  while (remaining > 1e-9) {
    let duration = Math.min(whole, remaining);
    const tail = remaining - duration;
    if (tail > 0 && tail < 0.2)
      duration = duration + tail <= 60 ? remaining : remaining - 0.2;
    durations.push(duration);
    remaining -= duration;
  }
  return durations;
}

/** A stopped route cut at its stop, keeping the distance-time mapping it was
 * played with so nothing before the stop changes. */
function stoppedPrefix(clip: Clip, route = true): Clip {
  return {
    ...clip,
    duration: clip.routeStop!,
    ...(route ? { routeActive: routeActiveDuration(clip) } : {}),
    routeHold: undefined,
  };
}

/** Whether a stopped route can hand over to a standing performance: it needs
 * a clip of its own before the stop and a stop within its travelling time. */
function canStandAfter(clip: Clip) {
  return (
    clip.routeStop !== undefined &&
    clip.routeStop >= 0.2 &&
    clip.routeStop <= routeActiveDuration(clip) + 1e-9
  );
}

/** The loaded source rig and take behind an imported motion on this actor. */
function importedTake(
  actor: Entity,
  motion: Motion,
  group: T.Group | undefined,
) {
  if (motion.kind !== "imported" || !group) return;
  const source =
    motion.sourceAssetId === actor.assetId
      ? group
      : motionSource(group, motion.sourceAssetId!);
  const take =
    source &&
    importedClip(source.userData.animations || [], motion.animationName || "");
  return source && take ? { source, take } : undefined;
}

/** The measured gait behind an imported route on this actor: its source rig,
 * take, locomotion profile and the scale from source travel to the actor's. */
function routeGait(actor: Entity, motion: Motion, group: T.Group | undefined) {
  const loaded = motion.path && importedTake(actor, motion, group);
  if (!loaded || !motion.path || !group) return;
  const { source, take } = loaded;
  const measured = locomotionProfile(source, take, motion.path.sourceRange);
  if (!measured || measured.distance < 0.15) return;
  const ratio =
    (source === group ? 1 : locomotionScale(source, group)) *
    (motion.path.strideScale ?? 1);
  return { source, take, measured, ratio };
}

/** How a stopped clip is taken apart once its passage opens: the prefix that
 * was played, the clips a frozen wait needs when no standing performance is
 * available, and the continuation that carries the destination on. */
type StopSplit = {
  prefix: (standing: boolean) => Clip;
  frozen: () => Clip[];
  continuation?: Clip;
};

/** A route stopped before an obstacle. Standing, it is cut at the stop; else
 * the prefix keeps its active duration (and so its distance-time mapping) and
 * holds its stopped pose until the passage opened, or until its own scheduled
 * end when that comes later. */
function routeStopSplit(
  clip: Clip,
  resumeAt: number,
  clipStart: number,
): StopSplit {
  const active = routeActiveDuration(clip);
  const total = Math.max(resumeAt, clipStart + active) - clipStart;
  const chunks = chunkedDurations(total, 60);
  // Keep a stop very near the minute boundary inside its prefix. A remaining
  // fraction shorter than the minimum clip slot waits that extra fraction.
  const prefixDuration = Math.max(clip.routeStop!, chunks[0]);
  return {
    continuation: {
      ...clip,
      id: `${clip.id}:continue`,
      routeStop: undefined,
      routeActive: undefined,
      transition: "smooth",
    },
    prefix: (standing) => {
      if (standing) return { ...stoppedPrefix(clip), navigation: undefined };
      const hold = prefixDuration - active;
      return {
        ...clip,
        duration: prefixDuration,
        routeActive: active,
        routeHold: hold > 1e-9 ? hold : undefined,
        navigation: undefined,
      };
    },
    frozen: () =>
      total <= prefixDuration
        ? []
        : chunkedDurations(total - prefixDuration, 60).map(
            (duration, index) => ({
              id: `${clip.id}:wait:${index + 1}`,
              motionId: clip.motionId,
              duration,
              routeWait: clip.id,
              transition: "cut" as const,
            }),
          ),
  };
}

/** An authored travelling performance stopped under native navigation. The
 * take is cut at the stop; the rest of the take continues as the same native
 * intent from the source second it had reached, so it is measured and routed
 * from the waiting body like any native performance. A frozen wait holds the
 * reached source frame (a stop at the very start of a clip of that take), in
 * clips of up to a minute. */
function nativeStopSplit(
  actor: Entity,
  clip: Clip,
  motion: Motion,
  group: T.Group | undefined,
  waited: number,
  resumeAt: number,
  clipStart: number,
): StopSplit {
  const intent = clip.navigation!,
    authored = intent.native!;
  const loaded = importedTake(actor, motion, group);
  if (!loaded) throw Error("Wait for the original imported take to load.");
  const takeDuration = loaded.take.duration;
  const played = Math.max(0.2, clip.routeStop!);
  let consumed: number;
  if (!motion.path) consumed = played * clipPlaybackRate(clip, takeDuration);
  else {
    const gait = routeGait(actor, motion, group);
    if (!gait)
      throw Error(
        "The original gait is unavailable or has no measurable stride.",
      );
    const sourceDistance = compilePath(motion.path).length / gait.ratio;
    const profile = routeLocomotionProfile(gait.measured, sourceDistance);
    consumed =
      (played / routeActiveDuration(clip)) *
      routeSourceDuration(profile, sourceDistance);
  }
  const authoredStart = Math.max(
    0,
    Math.min(takeDuration, authored.sourceStart ?? 0),
  );
  const covered = Math.min(
    authored.duration * authored.playbackRate,
    takeDuration - authoredStart,
  );
  consumed = Math.max(0, Math.min(consumed, covered));
  // The rest of the scheduled clip, including any hold of the take's final
  // pose the creator scheduled after it.
  const remaining = authored.duration - consumed / authored.playbackRate;
  const resumeStart = authoredStart + consumed;
  const { clearance: _clearance, ...rest } = intent;
  void _clearance;
  const native = {
    motionId: authored.motionId,
    duration: remaining,
    sourceStart: resumeStart,
    playbackRate: authored.playbackRate,
  };
  const route = motion.path
    ? routeStopSplit(clip, resumeAt, clipStart)
    : undefined;
  return {
    continuation:
      remaining >= 0.2
        ? {
            id: `${clip.id}:continue`,
            motionId: authored.motionId,
            duration: remaining,
            sourceStart: resumeStart,
            playbackRate: authored.playbackRate,
            transition: "smooth",
            navigation: { ...rest, native },
          }
        : undefined,
    prefix: (standing) =>
      route
        ? route.prefix(standing)
        : {
            ...clip,
            duration: played,
            routeStop: undefined,
            navigation: undefined,
          },
    frozen: () =>
      route
        ? route.frozen()
        : chunkedDurations(waited, 60).map((duration, index) => ({
            id: `${clip.id}:wait:${index + 1}`,
            motionId: clip.motionId,
            duration,
            sourceStart: resumeStart,
            playbackRate: clipPlaybackRate(clip, takeDuration),
            routeStop: 1e-6,
            transition: "cut" as const,
          })),
  };
}

/** The standing performance a stopped route's body waits with: the calmest
 * standing loop its gait's own source provides, found by measurement. */
function stoppedHold(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clip: Clip,
): Motion | undefined {
  const actor = scene.entities.find((e) => e.id === actorId);
  const motion = allMotions(scene).find((m) => m.id === clip.motionId);
  if (!actor || !motion) return;
  const loaded = motion.path
    ? routeGait(actor, motion, objects.get(actorId))
    : clip.navigation?.native
      ? importedTake(actor, motion, objects.get(actorId))
      : undefined;
  return (
    loaded &&
    standingPerformance(scene, loaded.source, motion, objects.get(actorId))
      ?.motion
  );
}

/** The held playback scene, with every stopped route that has a standing
 * performance waiting in it. */
function heldPlayback(
  scene: Scene,
  issues: NavigationIssue[],
  at: number | undefined,
  objects: Map<string, T.Group>,
) {
  const holds = new Map<string, Motion>();
  for (const issue of issues) {
    const clip = scene.entities
      .find((e) => e.id === issue.actorId)
      ?.clips.find((c) => c.id === issue.clipId);
    if (!clip || holds.has(clip.id)) continue;
    const idle = stoppedHold(scene, objects, issue.actorId, clip);
    if (idle) holds.set(clip.id, idle);
  }
  return holdBlockedRoutes(scene, issues, at, holds);
}

/** Where a route being played stops before an obstacle: at its next moment on
 * both feet when the body and its waiting performance stay clear there, else
 * right now in whatever pose it has. Motion already played is never
 * rewound. */
function* naturalStop(
  scene: Scene,
  objects: Map<string, T.Group>,
  environment: T.Object3D | null | undefined,
  actorId: string,
  clip: Clip,
  at: number,
): Generator<
  void,
  { routeStop: number; hold?: Motion; note: string },
  unknown
> {
  const actor = scene.entities.find((e) => e.id === actorId)!;
  const motion = allMotions(scene).find((m) => m.id === clip.motionId)!;
  const index = actor.clips.findIndex((c) => c.id === clip.id);
  const clipStart = actor.clips
    .slice(0, index)
    .reduce((sum, c) => sum + c.duration, 0);
  const immediate = at - clipStart;
  const group = objects.get(actorId);
  const gait = motion.path ? routeGait(actor, motion, group) : undefined;
  // An authored travelling performance under native navigation stops on
  // its own clock: its grounded moments map through the clip's rate.
  const native =
    !motion.path && clip.navigation?.native
      ? importedTake(actor, motion, group)
      : undefined;
  const loaded = gait ?? native;
  const active = native
    ? clipEffectiveEnd(clip, native.take.duration)
    : routeActiveDuration(clip);
  const hold =
    loaded && standingPerformance(scene, loaded.source, motion, group)?.motion;
  const frozen = hold
    ? ""
    : " No measured standing performance is available, so the body holds its stopped pose.";
  const candidates = gait
    ? routeStopCandidates(
        gait.source,
        gait.take,
        gait.measured,
        compilePath(motion.path!).length / gait.ratio,
        active,
      )
    : native
      ? groundedPhases(native.source, native.take, {
          start: clipSourceStart(clip, native.take.duration),
          end: clipSourceEnd(clip, native.take.duration),
        }).map((phase) => phase / clipPlaybackRate(clip, native.take.duration))
      : [];
  const next = candidates.find(
    (time) => time > immediate + 1e-6 && time < active - 1e-6,
  );
  if (next === undefined)
    return {
      routeStop: immediate,
      note:
        (loaded
          ? " No further moment on both feet remains before its end."
          : "") + frozen,
    };
  const issue = { actorId, clipId: clip.id, message: "" };
  const trial = {
    ...scene,
    entities: scene.entities.map((e) =>
      e.id !== actorId
        ? e
        : {
            ...e,
            clips: e.clips.map((c) =>
              c.id !== clip.id ? c : { ...c, routeStop: next },
            ),
          },
    ),
  };
  const held = holdBlockedRoutes(
    trial,
    [issue],
    at,
    hold ? new Map([[clip.id, hold]]) : undefined,
  );
  const heldActor = held.entities.find((e) => e.id === actorId)!;
  // The walk on to the stop, then the wait there (one standing take with the
  // remaining scene held after it, for a wait of unknown length).
  const checks: Scene[] = [held];
  if (heldActor.clips.length > index + 1)
    checks.push({
      ...held,
      entities: held.entities.map((e) =>
        e.id !== actorId ? e : { ...e, clips: e.clips.slice(0, index + 2) },
      ),
    });
  for (const [step, check] of checks.entries()) {
    const target = check.entities.find((e) => e.id === actorId)!.clips[
      index + step
    ];
    let conflict: string | undefined;
    try {
      const measured = yield* inspectRouteClearanceSteps(
        check,
        objects,
        actorId,
        target.id,
        environment,
      );
      conflict = measured.conflicts.find((c) => c.time >= at - 1e-6)?.footprint
        .name;
    } catch (error) {
      conflict = error instanceof Error ? error.message : String(error);
    }
    if (conflict !== undefined)
      return {
        routeStop: immediate,
        note: ` Its next moment on both feet would already touch ${conflict}, so it stops at once.${frozen}`,
      };
  }
  return {
    routeStop: next,
    hold,
    note: hold
      ? ` It walks on to its next moment on both feet and waits standing (${hold.name}).`
      : ` It walks on to its next moment on both feet.${frozen}`,
  };
}

/** The original clips remain editable/recoverable when a route is blocked.
 * Evaluation holds the preceding complete pose and does not execute actions
 * beyond the unreachable destination (including prop interactions). */
export function holdBlockedRoutes(
  scene: Scene,
  issues: NavigationIssue[],
  /** Timeline time of the block. A route that was already being played holds
   * where its body is now instead of being removed back to its start. */
  at?: number,
  /** Standing performances, by stopped clip ID, that a waiting body plays in
   * place of holding its stopped pose. */
  holds?: Map<string, Motion>,
): Scene {
  if (!issues.length) return scene;
  const sceneEnd = duration(scene);
  return {
    ...scene,
    entities: scene.entities.map((entity) => {
      const stop = entity.clips.findIndex((clip) =>
        issues.some(
          (issue) => issue.actorId === entity.id && issue.clipId === clip.id,
        ),
      );
      if (stop < 0) return entity;
      const start = entity.clips
        .slice(0, stop)
        .reduce((sum, clip) => sum + clip.duration, 0);
      const clip = entity.clips[stop];
      const motion = allMotions(scene).find((m) => m.id === clip.motionId);
      const played =
        clip.routeStop !== undefined ||
        (at !== undefined &&
          at > start + 1e-6 &&
          at < start + clip.duration &&
          !!(motion?.path || clip.navigation?.native));
      const stopped = { ...clip, routeStop: clip.routeStop ?? at! - start };
      const idle = holds?.get(clip.id);
      return {
        ...entity,
        ending: "hold",
        clips: !played
          ? entity.clips.slice(0, stop)
          : idle && canStandAfter(stopped)
            ? [
                ...entity.clips.slice(0, stop),
                stoppedPrefix(stopped, !!motion?.path),
                ...standingHoldClips(
                  idle,
                  clip.id,
                  Math.max(idle.duration, sceneEnd - start - stopped.routeStop),
                ),
              ]
            : [...entity.clips.slice(0, stop), stopped],
      };
    }),
  };
}

export function hasAutomaticRoutes(scene: Scene) {
  return (
    scene.animationCollisions !== false &&
    scene.entities.some(
      (entity) =>
        entity.visible && entity.clips.some((clip) => !!clip.navigation),
    )
  );
}

/** Rebuild saved object-destination routes against the currently loaded scene.
 * Generated motion IDs are stable and private to a clip. Existing source gait,
 * explicit pace, subsequent actions and transcript clip references survive.
 * Candidate routes are checked against the animated timeline. Conflicts add
 * local detour constraints, then timing and body clearance are checked again. */
function* planAutomaticPass(
  original: Scene,
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
  at?: number,
): Generator<void, PreparedRoutes, unknown> {
  if (!hasAutomaticRoutes(original))
    return { scene: original, playbackScene: original, issues: [] };
  let scene = original;
  const issues: NavigationIssue[] = [];
  // Process each character in sequence so the next route starts at its newly
  // planned predecessor's endpoint. Never reuse another character's motion ID.
  for (const originalActor of original.entities) {
    if (!originalActor.visible) continue;
    for (const originalClip of originalActor.clips) {
      if (!originalClip.navigation || originalClip.navigation.arrival) continue;
      let actor = scene.entities.find((e) => e.id === originalActor.id)!;
      let clip = actor.clips.find((c) => c.id === originalClip.id)!;
      let intent = clip.navigation!;
      const motion = allMotions(scene).find((m) => m.id === clip.motionId);
      const group = objects.get(actor.id);
      // A route stopped before an obstacle keeps its travelled prefix as a
      // plain clip that holds until the passage opens; the destination intent
      // continues on a new clip planned from the stopped pose at that time.
      let stopped = scene;
      let stoppedClipId: string | undefined;
      try {
        if (clip.routeStop !== undefined) {
          const index = actor.clips.indexOf(clip);
          const clipStart = actor.clips
            .slice(0, index)
            .reduce((sum, c) => sum + c.duration, 0);
          const stopAt = clipStart + clip.routeStop;
          if (at !== undefined && at < stopAt - 1e-6) {
            // The passage question is being settled before the body reaches
            // its scheduled stop: the route is simply planned on from where
            // it is, as any route being played. A remaining block schedules a
            // fresh stop no earlier than now.
            scene = {
              ...scene,
              entities: scene.entities.map((e) =>
                e.id !== actor.id
                  ? e
                  : {
                      ...e,
                      clips: e.clips.map((c) =>
                        c.id !== clip.id ? c : { ...c, routeStop: undefined },
                      ),
                    },
              ),
            };
            stopped = scene;
            actor = scene.entities.find((e) => e.id === originalActor.id)!;
            clip = actor.clips.find((c) => c.id === originalClip.id)!;
          }
        }
        if (clip.routeStop !== undefined) {
          const index = actor.clips.indexOf(clip);
          const clipStart = actor.clips
            .slice(0, index)
            .reduce((sum, c) => sum + c.duration, 0);
          const stopAt = clipStart + clip.routeStop;
          const waited = Math.max(0, (at ?? stopAt) - stopAt);
          const originalFrame = intent.point
            ? routeContext(scene, objects, actor.id, clip.id, environment).frame
            : undefined;
          const destination =
            originalFrame && intent.point
              ? pathToWorld(intent.point, originalFrame)
              : undefined;
          const destinationHeading =
            originalFrame && intent.point
              ? originalFrame.heading +
                (intent.endHeading ??
                  Math.atan2(intent.point[0], intent.point[2]) -
                    (motion?.path?.backward ? Math.PI : 0))
              : undefined;
          const split = intent.native
            ? nativeStopSplit(
                actor,
                clip,
                motion!,
                group,
                waited,
                at ?? stopAt,
                clipStart,
              )
            : routeStopSplit(clip, at ?? stopAt, clipStart);
          const idle = stoppedHold(scene, objects, actor.id, clip);
          const standing = !!idle && canStandAfter(clip);
          const waits = standing
            ? standingHoldClips(idle, clip.id, waited)
            : split.frozen();
          const replaced = [split.prefix(standing), ...waits];
          if (split.continuation) replaced.push(split.continuation);
          scene = validateScene(
            retimeDialogueAfterChange(scene, {
              ...scene,
              entities: scene.entities.map((e) =>
                e.id !== actor.id
                  ? e
                  : {
                      ...e,
                      clips: [
                        ...e.clips.slice(0, index),
                        ...replaced,
                        ...e.clips.slice(index + 1),
                      ],
                    },
              ),
            }),
          );
          stoppedClipId = clip.id;
          actor = scene.entities.find((e) => e.id === originalActor.id)!;
          if (!split.continuation) continue;
          clip = actor.clips.find((c) => c.id === split.continuation!.id)!;
          if (destination && destinationHeading !== undefined) {
            // Coordinate goals belong to the stopped clip's starting frame.
            // The continuation starts elsewhere, often facing another way;
            // preserve the world destination instead of repeating that vector.
            const { frame } = routeContext(
              scene,
              objects,
              actor.id,
              clip.id,
              environment,
            );
            const point = worldToPath(destination, frame);
            point[1] = 0; // Navigation destinations remain on the current floor.
            const heading = destinationHeading - frame.heading;
            intent = {
              ...intent,
              point,
              endHeading: Math.atan2(Math.sin(heading), Math.cos(heading)),
            };
            scene = validateScene({
              ...scene,
              entities: scene.entities.map((e) =>
                e.id !== actor.id
                  ? e
                  : {
                      ...e,
                      clips: e.clips.map((c) =>
                        c.id !== clip.id ? c : { ...c, navigation: intent },
                      ),
                    },
              ),
            });
            actor = scene.entities.find((e) => e.id === originalActor.id)!;
            clip = actor.clips.find((c) => c.id === split.continuation!.id)!;
          }
        }
        if (intent.native) {
          scene = yield* planNativeNavigationSteps(
            scene,
            objects,
            actor.id,
            clip.id,
            environment,
          );
          continue;
        }
        if (!group || !motion?.path)
          throw Error("The route or its character is unavailable.");
        let cycle: RouteGaitCycle | undefined;
        if (motion.kind === "imported") {
          const source =
            motion.sourceAssetId === actor.assetId
              ? group
              : motionSource(group, motion.sourceAssetId!);
          const take = importedClip(
            source?.userData.animations || [],
            motion.animationName || "",
          );
          const profile =
            source &&
            take &&
            locomotionProfile(source, take, motion.path.sourceRange);
          if (!source || !take || !profile || profile.distance < 0.15)
            throw Error(
              "The original gait is unavailable or has no measurable stride.",
            );
          const ratio =
            (source === group ? 1 : locomotionScale(source, group)) *
            (motion.path.strideScale ?? 1);
          cycle = {
            duration: profile.duration,
            entryHeading: routeEntryHeading(profile),
            distance: profile.distance * ratio,
            samples: profile.frames.map((frame) => ({
              time: frame.time,
              distance: frame.distance * ratio,
            })),
          };
        }
        const shared =
          scene.entities
            .flatMap((e) => e.clips)
            .filter((c) => c.motionId === motion.id).length > 1;
        const id = shared ? `navigation-${actor.id}-${clip.id}` : motion.id;
        const before = compilePath(motion.path).length;
        // An edit while this route is being played keeps the guide points
        // already travelled; only the remainder is replanned, from the pose
        // the body has at the current time. Captured continuations carry
        // their own source mapping and are replanned whole.
        const clipStart = actor.clips
          .slice(
            0,
            actor.clips.findIndex((c) => c.id === clip.id),
          )
          .reduce((sum, c) => sum + c.duration, 0);
        const active = routeActiveDuration(clip);
        let resume: RetainedPrefix | undefined;
        if (
          at !== undefined &&
          at > clipStart + 1e-6 &&
          at < clipStart + active &&
          !motion.path.sourceProgress &&
          !motion.path.backward &&
          before > 0
        ) {
          const fraction = (at - clipStart) / active;
          let travelled = fraction * before;
          if (motion.kind === "imported") {
            const source =
              motion.sourceAssetId === actor.assetId
                ? group
                : motionSource(group, motion.sourceAssetId!)!;
            const measured = locomotionProfile(
              source,
              importedClip(
                source.userData.animations || [],
                motion.animationName || "",
              )!,
              motion.path.sourceRange,
            )!;
            const travelRatio = cycle!.distance / measured.distance;
            travelled =
              sampleRouteLocomotion(measured, before / travelRatio, fraction)
                .travelled * travelRatio;
          }
          resume = retainedPathPrefix(motion.path, travelled / before);
        }
        const beforeSeconds =
          (before * actor.scale) /
          routePace(motion, actor.scale, cycle, before * actor.scale);
        const durationScale = routeActiveDuration(clip) / beforeSeconds;
        // The saved route is rechecked at the width it was planned with. A
        // fresh plan starts narrow again and widens only by what the sweep
        // measures now, so an obstacle that has gone does not keep inflating
        // later routes.
        let clearance = intent.clearance || 0;
        let resolved = false;
        const movingIds = movingObstacleIds(scene);
        movingIds.delete(actor.id);
        const conflicts: Footprint[] = [];
        const conflictIds = new Set<string>();
        let repeated = false;
        for (let attempt = 0; attempt < 8; attempt++) {
          const args = [scene, objects, actor.id] as const;
          const options = [
            intent.movement,
            clip.id,
            environment,
            motion,
            cycle,
            clearance * actor.scale,
            {
              movingIds,
              conflicts,
              durationScale,
              ...(attempt === 0 ? { existingPath: motion.path } : {}),
              ...(resume ? { resume } : {}),
            },
          ] as const;
          // Both destination forms use the same temporal clearance/retry loop.
          const planned = intent.point
            ? planPointRoute(
                ...args,
                intent.point,
                ...options,
                intent.endHeading,
              )
            : planObjectRoute(...args, intent.targetId!, ...options);
          if (
            attempt === 0 &&
            clearance > 0 &&
            JSON.stringify(planned.path) !== JSON.stringify(motion.path)
          ) {
            // The saved route no longer applies: plan afresh from narrow.
            clearance = 0;
            continue;
          }
          const after = compilePath(planned.path!).length;
          const seconds = cycle
            ? gaitTravelTime(cycle, after) / gaitTravelTime(cycle, before)
            : after / before;
          const nextDuration =
            routeActiveDuration(clip) * seconds + (clip.routeHold ?? 0);
          if (!(
            nextDuration >= 0.2 &&
            nextDuration <= 60 &&
            Number.isFinite(nextDuration)
          ))
            throw Error(
              "The detour cannot fit one action at the chosen pace. Add an intermediate destination.",
            );
          // A retained path keeps the width it was planned with on record;
          // a new path records what this plan actually needed.
          const recorded =
            JSON.stringify(planned.path) === JSON.stringify(motion.path)
              ? intent.clearance
              : clearance || undefined;
          const nextMotion = {
            ...planned,
            id,
            name: motion.name,
            duration: nextDuration,
          };
          const customMotions = scene.customMotions.some((m) => m.id === id)
            ? scene.customMotions.map((m) => (m.id === id ? nextMotion : m))
            : [...scene.customMotions, nextMotion];
          const candidate = validateScene(
            retimeDialogueAfterChange(scene, {
              ...scene,
              customMotions,
              entities: scene.entities.map((e) =>
                e.id !== actor.id
                  ? e
                  : {
                      ...e,
                      clips: e.clips.map((c) =>
                        c.id !== clip.id
                          ? c
                          : {
                              ...c,
                              motionId: id,
                              duration: nextDuration,
                              navigation: {
                                ...intent,
                                clearance: recorded,
                              },
                            },
                      ),
                    },
              ),
            }),
          );
          const measured = yield* inspectRouteClearanceSteps(
            candidate,
            objects,
            actor.id,
            clip.id,
            environment,
          );
          if (!measured.blocked) {
            if (
              JSON.stringify(planned.path) !== JSON.stringify(motion.path) ||
              Math.abs(nextDuration - clip.duration) >= 1e-6 ||
              recorded !== intent.clearance
            )
              scene = candidate;
            resolved = true;
            break;
          }
          // The first candidate may be the saved path. A new static obstruction
          // needs a fresh plan even when the known body radius has not changed.
          let changed = attempt === 0;
          let learned = false;
          for (const conflict of measured.conflicts) {
            if (conflictIds.has(conflict.footprint.id)) repeated = true;
            conflictIds.add(conflict.footprint.id);
            // A later pickup may remove this prop from the initial static map,
            // although the approach-only inspection sees it as stationary.
            // Reinsert its measured footprint whenever planning excluded it.
            if (
              (conflict.moving || movingIds.has(conflict.footprint.id)) &&
              !conflicts.some(
                (p) => JSON.stringify(p) === JSON.stringify(conflict.footprint),
              )
            ) {
              conflicts.push(conflict.footprint);
              learned = true;
            }
          }
          // A newly learned animated footprint is tried at the same width
          // first. Otherwise, or once the same obstacle conflicts again, widen
          // in two steps: the body's width across its facing lets it pass
          // beside furniture; the full swing extent is kept for what still
          // conflicts.
          const widened =
            measured.lateral > clearance ? measured.lateral : measured.radius;
          if (learned) changed = true;
          if ((!learned || repeated) && widened > clearance) {
            clearance = widened;
            changed = true;
          }
          if (!changed || attempt === 7)
            throw Error(
              `The animated body cannot clear ${measured.blocked}. Open a wider passage or choose another destination.`,
            );
        }
        if (!resolved)
          throw Error("No route with enough body clearance is available.");
      } catch (error) {
        // A continuation that is still blocked leaves the stopped route as it
        // was; the hold and intent are already recorded on that clip.
        if (stoppedClipId) scene = stopped;
        const blocked = stoppedClipId ?? clip.id;
        let message = `${actor.name} stopped before a blocked route: ${error instanceof Error ? error.message : String(error)}`;
        // A route blocked while it is being played stops in the saved
        // sequence, at its next moment on both feet when that is still clear
        // or else where the body is now, so later planning passes and
        // timeline advancement cannot move it on or back to its start.
        if (
          !stoppedClipId &&
          at !== undefined &&
          (motion?.path || (intent.native && motion?.kind === "imported"))
        ) {
          const index = actor.clips.findIndex((c) => c.id === clip.id);
          const clipStart = actor.clips
            .slice(0, index)
            .reduce((sum, c) => sum + c.duration, 0);
          if (at > clipStart + 1e-6 && at < clipStart + clip.duration) {
            const stop = yield* naturalStop(
              scene,
              objects,
              environment,
              actor.id,
              clip,
              at,
            );
            message += stop.note;
            scene = {
              ...scene,
              entities: scene.entities.map((e) =>
                e.id !== actor.id
                  ? e
                  : {
                      ...e,
                      clips: e.clips.map((c) =>
                        c.id !== clip.id
                          ? c
                          : { ...c, routeStop: stop.routeStop },
                      ),
                    },
              ),
            };
          }
        }
        issues.push({ actorId: actor.id, clipId: blocked, message });
        // Later destinations depend on this one; keep their saved intent but do
        // not plan them from a position the character cannot reach.
        break;
      }
    }
  }
  return {
    scene,
    playbackScene: heldPlayback(scene, issues, at, objects),
    issues,
  };
}

/** Recheck coupled AI schedules after later actors have changed their routes.
 * Final unresolved conflicts propagate through the held playback scene so an
 * earlier safe route cannot drive through an actor that now remains stopped. */
function* prepareBaseRouteSteps(
  original: Scene,
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
  at?: number,
): Generator<void, PreparedRoutes, unknown> {
  let result = yield* planAutomaticPass(original, objects, environment, at);
  const controlled = original.entities.filter(
    (e) => e.visible && e.clips.some((c) => c.navigation),
  );
  if (original.animationCollisions === false || controlled.length < 2)
    return result;
  const audit = function* (scene: Scene) {
    const issues: NavigationIssue[] = [];
    for (const actor of scene.entities.filter((e) => e.visible)) {
      for (const clip of actor.clips.filter((c) => c.navigation)) {
        try {
          const check = yield* inspectRouteClearanceSteps(
            scene,
            objects,
            actor.id,
            clip.id,
            environment,
          );
          if (!check.blocked) continue;
          throw Error(`The final schedule overlaps ${check.blocked}.`);
        } catch (error) {
          issues.push({
            actorId: actor.id,
            clipId: clip.id,
            message: `${actor.name} stopped before a blocked route: ${error instanceof Error ? error.message : String(error)}`,
          });
          break;
        }
      }
    }
    return issues;
  };
  for (let pass = 0; pass < 3; pass++) {
    const conflicts = yield* audit(result.playbackScene);
    if (!conflicts.length) return result;
    if (pass < 2 && !result.issues.length) {
      result = yield* planAutomaticPass(result.scene, objects, environment, at);
      continue;
    }
    const issues = [...result.issues, ...conflicts];
    let playbackScene = heldPlayback(result.scene, issues, at, objects);
    for (;;) {
      const blocked = yield* audit(playbackScene);
      if (!blocked.length) break;
      // Every audit removes at least one remaining automatic clip. Saved data
      // is untouched, and this terminates even when several actors must hold.
      issues.push(...blocked);
      playbackScene = heldPlayback(result.scene, issues, at, objects);
    }
    return { scene: result.scene, playbackScene, issues };
  }
  return result;
}

function* prepareAutomaticRouteSteps(
  original: Scene,
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
  /** Timeline time of the edit being planned for; routes being played keep
   * their travelled prefix. Omit to plan every route from its start. */
  at?: number,
): Generator<void, PreparedRoutes, unknown> {
  if (!hasAutomaticRoutes(original))
    return { scene: original, playbackScene: original, issues: [] };
  const retained = yield* reusableArrivalRequests(
    original,
    objects,
    environment,
  );
  const expanded = expandArrivalRequests(original, retained);
  const base = yield* prepareBaseRouteSteps(
    expanded.scene,
    objects,
    environment,
    at,
  );
  const installed = yield* installArrivalRoutes(
    base,
    expanded.pairs,
    objects,
    environment,
  );
  const issues = installed.issues;
  let playbackScene = heldPlayback(installed.scene, issues, at, objects);
  // The captured tail changes the final pose and clock. Recheck all controlled
  // actors against that final schedule, including each complete arrival pair.
  if (
    (installed.scene !== original || issues.length > 0) &&
    installed.scene.entities.filter(
      (e) => e.visible && e.clips.some((c) => c.navigation),
    ).length > 1 &&
    installed.scene.entities.some((e) =>
      e.clips.some((c) => c.navigation?.arrival),
    )
  ) {
    for (;;) {
      const found: NavigationIssue[] = [];
      for (const actor of playbackScene.entities.filter((e) => e.visible)) {
        for (const clip of actor.clips.filter((c) => c.navigation)) {
          try {
            for (const id of [
              clip.id,
              ...(clip.navigation!.arrival
                ? [clip.navigation!.arrival.clipId]
                : []),
            ]) {
              const check = yield* inspectRouteClearanceSteps(
                playbackScene,
                objects,
                actor.id,
                id,
                environment,
              );
              if (check.blocked)
                throw Error(
                  `The final arrival schedule overlaps ${check.blocked}.`,
                );
            }
          } catch (error) {
            found.push({
              actorId: actor.id,
              clipId: clip.id,
              message: `${actor.name} stopped before a blocked arrival: ${error instanceof Error ? error.message : String(error)}`,
            });
            break;
          }
        }
      }
      if (!found.length) break;
      issues.push(...found);
      playbackScene = heldPlayback(installed.scene, issues, at, objects);
    }
  }
  return { scene: installed.scene, playbackScene, issues };
}

export function prepareAutomaticRoutes(
  ...args: Parameters<typeof prepareAutomaticRouteSteps>
): PreparedRoutes {
  return finishNavigationWork(prepareAutomaticRouteSteps(...args));
}
export function prepareAutomaticRoutesAsync(
  scene: Scene,
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
  options?: { signal?: AbortSignal; onYield?: () => void; at?: number },
): Promise<PreparedRoutes> {
  return runNavigationWork(
    prepareAutomaticRouteSteps(scene, objects, environment, options?.at),
    options,
  );
}
