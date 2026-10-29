import * as T from "three";
import { allAssets, allMotions, type Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";

const ease = (t: number) => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const angle = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));
/** Evaluated from absolute scene time, including export and reverse scrubbing. */
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
  // Snapshot roots before turning any character; order of actors never affects the pose.
  const roots = new Map(
    cast.map((e) => [e.id, objects.get(e.id)?.position.clone()]),
  );
  for (const [index, actor] of cast.entries()) {
    const object = objects.get(actor.id),
      root = roots.get(actor.id);
    if (!object || !root) continue;
    if (time > last && actor.ending === "rest") continue;
    let start = 0,
      lastTravelEnd = first;
    const active = actor.clips.find((c) => {
      const found = time >= start && time < start + c.duration;
      start += c.duration;
      const kind = allMotions(scene).find((m) => m.id === c.motionId)?.kind;
      if (
        time >= start &&
        kind &&
        !["idle", "talk", "wave", "bow"].includes(kind)
      )
        lastTravelEnd = start;
      return found;
    });
    const motion = allMotions(scene).find((m) => m.id === active?.motionId);
    const conversational =
      !motion || ["idle", "talk", "wave", "bow"].includes(motion.kind);
    const walking = !!motion?.path;
    if (!conversational && !walking) continue;
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
    // Keep authored paths and seated lower bodies intact. Stationary actors turn toward their partner.
    if (conversational && !object.userData.seat)
      object.rotation.y +=
        angle(desired - object.rotation.y) *
        weight *
        ease((time - lastTravelEnd) / 0.65);
    const localLook = Math.max(
      -0.5,
      Math.min(0.5, angle(desired - object.rotation.y)),
    );
    const own = timed.find(
      (t) => t.line === speaking && t.line.characterId === actor.id,
    );
    const elapsed = own ? time - own.start : time - first;
    const rhythm = own
      ? Math.sin(elapsed * Math.PI * 4.5)
      : Math.sin(elapsed * 1.7 + index);
    const envelope = own
      ? ease(elapsed / 0.25) * ease((own.end - time) / 0.3)
      : 1;
    if (bones.head) {
      bones.head.rotateY(localLook * 0.65 * weight);
      bones.head.rotateX(
        (own ? rhythm * 0.035 : Math.sin(elapsed * 2.1 + index) * 0.045) *
          weight,
      );
    }
    if (bones.spine)
      bones.spine.rotateZ(Math.sin(elapsed * 1.1 + index) * 0.018 * weight);
    if (
      own &&
      ["talk", "idle", "walk", "run"].includes(motion?.kind || "idle")
    ) {
      const emphasis =
        (0.5 + 0.5 * Math.sin(elapsed * 3.1 + index)) * envelope * weight;
      bones.rightArm?.rotateX(-0.13 * emphasis);
      bones.rightForearm?.rotateX(-0.25 * emphasis);
      bones.leftForearm?.rotateX(-0.12 * emphasis);
    }
  }
}
