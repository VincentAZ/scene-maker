import { allMotions, type Entity, type Scene } from "./scene";

export function contactAction(scene: Scene, clip: Entity["clips"][number]) {
  const kind = allMotions(scene).find(
    (motion) => motion.id === clip.motionId,
  )?.kind;
  return (
    kind === "stand" ||
    (!!clip.targetId &&
      ["climb", "pick", "sip", "place", "sit"].includes(kind || ""))
  );
}

export function transitionAt(
  entity: Entity,
  scene: Scene,
  time: number,
  includeSettled = false,
) {
  let start = 0;
  for (const [index, clip] of entity.clips.entries()) {
    if (time < start + clip.duration) {
      const seconds = Math.min(0.25, clip.duration / 2);
      if (
        index > 0 &&
        clip.transition === "smooth" &&
        time >= start &&
        (includeSettled || time < start + seconds) &&
        !contactAction(scene, clip) &&
        !contactAction(scene, entity.clips[index - 1])
      ) {
        const progress = Math.min(1, (time - start) / seconds);
        return {
          boundary: start,
          weight: progress * progress * (3 - 2 * progress),
        };
      }
      return;
    }
    start += clip.duration;
  }
  const last = entity.clips.at(-1);
  if (last && entity.ending === "hold" && !contactAction(scene, last))
    return { boundary: start, weight: 0, hold: true as const };
}
