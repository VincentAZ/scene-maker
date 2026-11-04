import * as T from "three";
import { allAssets, allMotions, type Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";
import { humanoidJointOrientation, rotateHumanoidJoint } from "./rig";

const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const angle = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
const yaw = (q: T.Quaternion) => {
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(forward.x, forward.z);
};
const clamp = (n: number, limit: number) =>
  Math.max(-limit, Math.min(limit, n));
/** Attention toward the speaker, evaluated from absolute scene time, including
 * export and reverse scrubbing. */
export function applyConversationPerformance(
  scene: Scene,
  time: number,
  objects: Map<string, T.Group>,
) {
  const timed = scene.transcript.flatMap((line) => {
    const t = dialogueTiming(scene, line);
    return t ? [{ line, ...t }] : [];
  });
  if (!timed.length) return;
  const first = Math.min(...timed.map((t) => t.start)),
    last = Math.max(...timed.map((t) => t.end));
  if (time < first) return;
  const weight = ease((time - first) / 0.65);
  const speaking = dialogueAt(scene, time)[0];
  const cast = scene.entities.filter(
    (e) =>
      e.visible &&
      allAssets(scene).find((a) => a.id === e.assetId)?.category ===
        "characters",
  );
  // Snapshot roots so actor order never affects attention.
  const roots = new Map(
    cast.map((e) => [
      e.id,
      objects.get(e.id)?.getWorldPosition(new T.Vector3()),
    ]),
  );
  const motions = allMotions(scene);
  for (const [index, actor] of cast.entries()) {
    const object = objects.get(actor.id),
      root = roots.get(actor.id);
    if (!object || !root) continue;
    if (time > last && actor.ending === "rest") continue;
    let start = 0;
    const active = actor.clips.find((c) => {
      const found = time >= start && time < start + c.duration;
      start += c.duration;
      return found;
    });
    const effective =
      active ||
      (actor.ending === "hold" && time >= start
        ? actor.clips.at(-1)
        : undefined);
    const motion = motions.find((m) => m.id === effective?.motionId);
    // Every action is a recording, which owns its entire performance,
    // including routes and the final held frame. Only an actor with no action
    // turns its head and torso toward the speaker; no motion is synthesised.
    if (motion) continue;
    const bones = object.userData.bones as Record<string, T.Bone> | undefined;
    if (!bones) continue;
    const others = cast
      .filter((e) => e.id !== actor.id)
      .map((e) => roots.get(e.id))
      .filter((p): p is T.Vector3 => !!p);
    if (!others.length) continue;
    const target =
      speaking && speaking.characterId !== actor.id
        ? roots.get(speaking.characterId)
        : others
            .reduce((p, v) => p.add(v), new T.Vector3())
            .divideScalar(others.length);
    if (!target) continue;
    const direction = target.clone().sub(root),
      desired = Math.atan2(direction.x, direction.z);
    // Attention cannot turn planted feet. Full-body turns require an authored
    // stepping motion; bounded upper-body attention keeps the lower body intact.
    const heading = yaw(object.getWorldQuaternion(new T.Quaternion()));
    const localLook = clamp(angle(desired - heading), 0.85);
    const aim = (name: "spine" | "head", offset: number) => {
      const orientation = humanoidJointOrientation(object, name);
      if (orientation)
        rotateHumanoidJoint(
          object,
          name,
          new T.Quaternion().setFromAxisAngle(
            new T.Vector3(0, 1, 0),
            angle(heading + offset - yaw(orientation)) * weight,
          ),
          "world",
        );
    };
    aim("spine", clamp(localLook, 0.2));
    aim("head", localLook);
  }
}
