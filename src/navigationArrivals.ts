import * as T from "three";
import {
  allMotions,
  validateScene,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";
import { retimeDialogueAfterChange } from "../shared/dialogueSchedule";
import { proposeCapturedArrivalSteps } from "./capturedArrival";
import type { PreparedRoutes } from "./automaticRoutes";
import { pathToWorld } from "../shared/path";
import {
  routeContext,
  objectRouteGoals,
  assertObjectArrivalAvailable,
} from "./routePlanner";
import { applyAnimatedEntityPose } from "./world";
import { reachableGrip } from "./interactions";
import { inspectRouteClearanceSteps } from "./routeClearance";

const requestKey = (actorId: string, clipId: string) =>
  JSON.stringify([actorId, clipId]);

/** Reuse a persisted arrival only after checking its actual endpoint and
 * complete animated geometry against the new scene. No source-phase search is
 * needed merely because another speaker/gesture was appended. */
export function* reusableArrivalRequests(
  scene: Scene,
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
): Generator<void, Set<string>, unknown> {
  const retained = new Set<string>();
  for (const actor of scene.entities.filter((e) => e.visible)) {
    for (const clip of actor.clips) {
      const intent = clip.navigation;
      if (!intent?.arrival) continue;
      try {
        const context = routeContext(
          scene,
          objects,
          actor.id,
          clip.id,
          environment,
        );
        const before = context.frame;
        const goals = intent.targetId
          ? objectRouteGoals(
              scene,
              objects,
              actor.id,
              intent.targetId,
              context,
              (intent.clearance ?? 0) * actor.scale,
            )
          : undefined;
        const stopIndex = actor.clips.findIndex(
          (c) => c.id === intent.arrival!.clipId,
        );
        const terminal = {
          ...scene,
          entities: scene.entities.map((e) =>
            e.id === actor.id
              ? { ...e, clips: e.clips.slice(0, stopIndex + 1) }
              : e,
          ),
        };
        const after = routeContext(
          terminal,
          objects,
          actor.id,
          undefined,
          environment,
        ).frame;
        const goal = intent.point
          ? pathToWorld(intent.point, before)
          : goals!.candidates.find(
              (p) =>
                Math.hypot(p[0] - after.position[0], p[2] - after.position[2]) <
                1e-5,
            );
        if (!goal) continue;
        const heading = intent.point
          ? before.heading +
            (intent.endHeading ?? Math.atan2(intent.point[0], intent.point[2]))
          : Math.atan2(
              goals!.destination.x - goal[0],
              goals!.destination.z - goal[2],
            );
        if (
          Math.hypot(after.position[0] - goal[0], after.position[2] - goal[2]) >
            1e-5 ||
          Math.abs(
            Math.atan2(
              Math.sin(after.heading - heading),
              Math.cos(after.heading - heading),
            ),
          ) > 1e-5
        )
          continue;
        if (intent.targetId) {
          const ending = terminal.entities.find((e) => e.id === actor.id)!,
            time = ending.clips.reduce((n, c) => n + c.duration, 0);
          assertObjectArrivalAvailable(scene, intent.targetId, time, actor.id);
          if (goals!.smallProp) {
            const rig = objects.get(actor.id)!;
            applyAnimatedEntityPose(
              rig,
              { ...ending, ending: "hold" },
              scene,
              time,
            );
            rig.updateWorldMatrix(true, true);
            if (!reachableGrip(rig, ending, goals!.destination)) continue;
          }
        }
        let clear = true;
        for (const id of [clip.id, intent.arrival.clipId]) {
          const check = yield* inspectRouteClearanceSteps(
            scene,
            objects,
            actor.id,
            id,
            environment,
          );
          if (check.blocked) {
            clear = false;
            break;
          }
        }
        if (clear) retained.add(requestKey(actor.id, clip.id));
      } catch {
        /* Changed geometry/source requires full regeneration. */
      }
    }
  }
  return retained;
}

type CapturedRoute = {
  actorId: string;
  clip: Entity["clips"][number];
  stop: Entity["clips"][number];
  motions: Motion[];
  end: number;
};

/** Reconstruct the full destination request before ordinary replanning. The
 * saved source route carries its original distance/clock; the shortened prefix
 * must never be treated as the whole destination request. */
export function expandArrivalRequests(
  original: Scene,
  retained = new Set<string>(),
) {
  const pairs: CapturedRoute[] = [];
  for (const actor of original.entities) {
    if (!actor.visible) continue;
    let start = 0;
    for (const [index, clip] of actor.clips.entries()) {
      const arrival = clip.navigation?.arrival;
      if (arrival && !retained.has(requestKey(actor.id, clip.id))) {
        const stop = actor.clips[index + 1];
        pairs.push({
          actorId: actor.id,
          clip,
          stop,
          motions: [clip.motionId, stop.motionId, arrival.motionId].map((id) =>
            allMotions(original).find((m) => m.id === id)!,
          ),
          end: start + clip.duration + stop.duration,
        });
      }
      start += clip.duration;
    }
  }
  if (!pairs.length) return { scene: original, pairs };
  const scene = structuredClone(original);
  const generated = new Set<string>();
  for (const pair of pairs) {
    const actor = scene.entities.find((e) => e.id === pair.actorId)!;
    const index = actor.clips.findIndex((c) => c.id === pair.clip.id);
    const clip = actor.clips[index],
      arrival = clip.navigation!.arrival!;
    generated.add(clip.motionId);
    generated.add(pair.stop.motionId);
    actor.clips.splice(index, 2, {
      ...clip,
      motionId: arrival.motionId,
      duration: arrival.duration,
      navigation: { ...clip.navigation!, arrival: undefined },
    });
    for (const line of scene.transcript) {
      if (
        line.characterId !== pair.actorId ||
        !line.clipIds?.includes(pair.stop.id)
      )
        continue;
      line.clipIds = line.clipIds.filter((id) => id !== pair.stop.id);
      if (line.clipId === pair.stop.id) line.clipId = line.clipIds[0];
    }
  }
  const used = new Set(
    scene.entities.flatMap((e) =>
      e.clips.flatMap((c) => [
        c.motionId,
        ...(c.navigation?.arrival ? [c.navigation.arrival.motionId] : []),
      ]),
    ),
  );
  scene.customMotions = scene.customMotions.filter(
    (m) => !generated.has(m.id) || used.has(m.id),
  );
  return {
    scene: validateScene(retimeDialogueAfterChange(original, scene)),
    pairs,
  };
}

function restoreArrival(scene: Scene, pair: CapturedRoute) {
  const next = structuredClone(scene);
  const actor = next.entities.find((e) => e.id === pair.actorId)!;
  const index = actor.clips.findIndex((c) => c.id === pair.clip.id);
  actor.clips.splice(
    index,
    1,
    structuredClone(pair.clip),
    structuredClone(pair.stop),
  );
  for (const motion of pair.motions) {
    const at = next.customMotions.findIndex((m) => m.id === motion.id);
    if (at >= 0) next.customMotions[at] = structuredClone(motion);
    else next.customMotions.push(structuredClone(motion));
  }
  for (const line of next.transcript) {
    if (line.characterId !== pair.actorId) continue;
    const ids = line.clipIds ?? (line.clipId ? [line.clipId] : []);
    if (ids.includes(pair.clip.id))
      line.clipIds = ids.flatMap((id) =>
        id === pair.clip.id ? [id, pair.stop.id] : [id],
      );
  }
  return validateScene(retimeDialogueAfterChange(scene, next));
}

/** Adopt a measured stop after checking the complete approach and stopping take.
 * A point's captured stance may clear geometry that blocks the ordinary gait's
 * endpoint. Object destinations are independently resolved from current loaded
 * geometry; a moved target never inherits a stale route endpoint.
 * Existing pairs must remain a pair: failed regeneration keeps their editable
 * data and reports the prefix as blocked instead of silently dropping the stop. */
export function* installArrivalRoutes(
  prepared: PreparedRoutes,
  pairs: CapturedRoute[],
  objects: Map<string, T.Group>,
  environment?: T.Object3D | null,
): Generator<
  void,
  { scene: Scene; issues: PreparedRoutes["issues"] },
  unknown
> {
  let scene = prepared.scene;
  const issues = [...prepared.issues];
  const requests = scene.entities
    .filter((actor) => actor.visible)
    .flatMap((actor) =>
      actor.clips
        .filter(
          (clip) =>
            clip.navigation &&
            !clip.navigation.arrival &&
            !clip.navigation.native &&
            !clip.routeHold &&
            (clip === actor.clips.at(-1) ||
              pairs.some(
                (p) => p.actorId === actor.id && p.clip.id === clip.id,
              )),
        )
        .map((clip) => ({ actorId: actor.id, clipId: clip.id })),
    );
  for (const request of requests) {
    const actor = scene.entities.find((e) => e.id === request.actorId)!;
    const clip = actor.clips.find((c) => c.id === request.clipId)!;
    const pair = pairs.find(
      (p) => p.actorId === actor.id && p.clip.id === clip.id,
    );
    const preceding = new Set(
      actor.clips.slice(0, actor.clips.indexOf(clip)).map((c) => c.id),
    );
    const earlierBlocked = issues.some(
      (i) => i.actorId === actor.id && preceding.has(i.clipId),
    );
    if (earlierBlocked) {
      if (pair) scene = restoreArrival(scene, pair);
      continue;
    }
    const clearIssue = () => {
      for (let i = issues.length - 1; i >= 0; i--)
        if (issues[i].actorId === actor.id && issues[i].clipId === clip.id)
          issues.splice(i, 1);
    };
    const proposal = yield* proposeCapturedArrivalSteps(
      scene,
      objects,
      actor.id,
      clip.id,
      environment,
    );
    if ("reason" in proposal) {
      if (pair) {
        scene = restoreArrival(scene, pair);
        clearIssue();
        issues.push({
          actorId: actor.id,
          clipId: clip.id,
          message: `${actor.name} stopped before a blocked arrival: ${proposal.reason}`,
        });
      }
      continue;
    }
    const nextActor = proposal.scene.entities.find((e) => e.id === actor.id)!;
    const prefix = nextActor.clips.find((c) => c.id === clip.id)!;
    prefix.navigation = {
      ...clip.navigation!,
      ...(clip.navigation!.targetId
        ? {
            clearance: Math.max(
              clip.navigation!.clearance ?? 0,
              proposal.clearance,
            ),
          }
        : {}),
      arrival: {
        clipId: proposal.arrivalClipId,
        motionId: clip.motionId,
        duration: clip.duration,
      },
    };
    scene = validateScene(proposal.scene);
    clearIssue();
  }
  return { scene, issues };
}
