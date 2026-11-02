import * as T from "three";
import { allMotions, type Scene } from "../shared/scene";
import { capturedArrivalGaits } from "../shared/motionLibrary";
import {
  proposeCapturedArrivalSteps,
  type CapturedArrivalProposal,
} from "./capturedArrival";

/** Destination-owned navigation can choose another compatible walking cycle
 * from the same recorded finish. Explicit proposals retain their selected cut.
 * Candidates retain the ordinary source, schedule, reach and clearance checks.
 * Alternate cycles also need playback to accept the receiving body closure.
 * No change is made until one succeeds. */
export function* proposeAutomaticArrivalSteps(
  scene: Scene,
  objects: Map<string, T.Group>,
  actorId: string,
  clipId: string,
  environment?: T.Object3D | null,
): ReturnType<typeof proposeCapturedArrivalSteps> {
  const original = yield* proposeCapturedArrivalSteps(
    scene,
    objects,
    actorId,
    clipId,
    environment,
  );
  if ("scene" in original) return original;
  const clip = scene.entities
    .find((e) => e.id === actorId)
    ?.clips.find((c) => c.id === clipId);
  const motion = clip && allMotions(scene).find((m) => m.id === clip.motionId);
  if (
    !clip?.navigation ||
    clip.navigation.native ||
    motion?.kind !== "imported" ||
    !motion.path ||
    motion.sourceAssetId !== capturedArrivalGaits.sourceAssetId ||
    motion.animationName !== capturedArrivalGaits.animationName
  )
    return original;
  let best: Extract<CapturedArrivalProposal, { scene: Scene }> | undefined;
  for (const gaitRange of capturedArrivalGaits.ranges) {
    if (
      gaitRange.start === motion.path.sourceRange?.start &&
      gaitRange.end === motion.path.sourceRange?.end
    )
      continue;
    yield;
    const candidate = yield* proposeCapturedArrivalSteps(
      scene,
      objects,
      actorId,
      clipId,
      environment,
      { gaitRange },
    );
    if (
      "scene" in candidate &&
      (!best || candidate.match.score < best.match.score)
    )
      best = candidate;
  }
  return best ?? original;
}
