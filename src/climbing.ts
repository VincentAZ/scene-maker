import * as T from "three";
import type { Scene } from "../shared/scene";
import type { LadderSample } from "../shared/ladder";
import { configureRigContacts, solveLimb, type RigContacts } from "./ik";

export function applyClimbContacts(
  scene: Scene,
  objects: Map<string, T.Group>,
  occupiedActors = new Set<string>(),
) {
  const warnings: { actorId: string; targetId: string; message: string }[] = [];
  for (const actor of scene.entities) {
    const rig = objects.get(actor.id),
      sample = rig?.userData.climb as LadderSample | undefined;
    if (!rig || !sample || !actor.visible) continue;
    const warn = (message: string) =>
      warnings.push({
        actorId: actor.id,
        targetId: sample.plan.targetId,
        message,
      });
    if (sample.plan.warning) {
      warn(sample.plan.warning);
      continue;
    }
    if (occupiedActors.has(actor.id)) {
      warn(
        `${actor.name} needs both hands to climb. Return the held prop first.`,
      );
      continue;
    }
    if (sample.progress < 0.18) continue;
    const contacts =
      (rig.userData.contacts as RigContacts | undefined) ||
      configureRigContacts(rig);
    const bones = rig.userData.bones as Record<string, T.Bone>;
    if (!contacts?.leftHand || !contacts.leftFoot || !contacts.rightFoot) {
      warn(
        `${actor.name} needs a recognizable arm and leg rig for this climb.`,
      );
      continue;
    }
    const heading = rig.getWorldQuaternion(new T.Quaternion());
    let error = 0;
    for (const side of ["left", "right"] as const) {
      for (const hand of [true, false]) {
        const key = (side +
          (hand ? "Hand" : "Foot")) as keyof LadderSample["contacts"];
        const upper = bones[side + (hand ? "Arm" : "Leg")],
          lower = bones[side + (hand ? "Forearm" : "Shin")];
        const endpoint = hand
          ? side === "right"
            ? contacts.hand
            : contacts.leftHand
          : contacts[`${side}Foot`]!;
        const rest = lower.localToWorld(endpoint.clone());
        const target = rest.lerp(
          new T.Vector3(...sample.contacts[key]),
          sample.grip,
        );
        // Elbows point out; knees turn out a little, as a climber's do.
        const pole = new T.Vector3(
          (side === "left" ? 1 : -1) * (hand ? 1 : 0.3),
          hand ? -0.15 : 0,
          hand ? -0.3 : 1,
        ).applyQuaternion(heading);
        error = Math.max(
          error,
          solveLimb(upper, lower, endpoint, target, pole).error,
        );
      }
    }
    if (error > 0.025 * actor.scale)
      warn(
        `The rungs of ${sample.plan.ladder.name} are beyond ${actor.name}'s reach. Adjust the ladder size or choose a character with a compatible body.`,
      );
  }
  return warnings;
}
