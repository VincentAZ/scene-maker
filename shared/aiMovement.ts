import { allAssets, allMotions, validateScene, type Scene } from "./scene";
import { samplePath, type MotionPath } from "./path";

/** Persist navigation intent at AI authoring boundaries. Ordinary manual edits
 * do not acquire it. Existing clips retain their IDs, timing and source gait;
 * generated straight routes are private so shared library motions stay intact. */
export function withAutomaticMovement(previous: Scene, incoming: Scene): Scene {
  let next: Scene | undefined;
  const oldMotions = allMotions(previous),
    motions = allMotions(incoming);
  for (const actor of incoming.entities) {
    if (
      allAssets(incoming).find((a) => a.id === actor.assetId)?.category !==
      "characters"
    )
      continue;
    const oldActor = previous.entities.find((e) => e.id === actor.id);
    for (const clip of actor.clips) {
      const oldClip = oldActor?.clips.find((c) => c.id === clip.id);
      const motion = motions.find((m) => m.id === clip.motionId);
      const oldMotion =
        oldClip && oldMotions.find((m) => m.id === oldClip.motionId);
      if (
        clip.navigation &&
        (!clip.navigation.native || !!motion?.path) &&
        (!oldClip ||
          JSON.stringify(clip.navigation) !==
            JSON.stringify(oldClip.navigation) ||
          JSON.stringify(oldMotion?.path) === JSON.stringify(motion?.path))
      )
        continue;
      const trajectory = (m: typeof motion) =>
        JSON.stringify(
          m && [m.kind, m.path, m.distance, m.sourceAssetId, m.animationName],
        );
      if (
        !motion ||
        (oldClip?.motionId === clip.motionId &&
          trajectory(oldMotion) === trajectory(motion) &&
          oldClip.duration === clip.duration &&
          oldClip.playbackRate === clip.playbackRate &&
          oldClip.sourceStart === clip.sourceStart)
      )
        continue;
      const direct =
        (motion.kind === "walk" || motion.kind === "run") &&
        Math.abs(motion.distance) >= 0.05;
      if (motion.kind === "imported" && !motion.path) {
        next ??= structuredClone(incoming);
        const changed = next.entities
          .find((e) => e.id === actor.id)!
          .clips.find((c) => c.id === clip.id)!;
        changed.navigation = {
          movement: "walk",
          native: {
            motionId: motion.id,
            duration: clip.duration,
            playbackRate:
              clip.playbackRate ??
              (clip.sourceStart === undefined
                ? motion.duration / clip.duration
                : 1),
            ...(clip.sourceStart !== undefined
              ? { sourceStart: clip.sourceStart }
              : {}),
            ...(clip.legacyFit ? { legacyFit: true } : {}),
          },
        };
        continue;
      }
      if (!motion.path && !direct) continue;
      const path: MotionPath = motion.path ?? {
        points: [
          [0, 0, 0],
          [0, 0, motion.distance],
        ],
        smooth: false,
        ...(motion.distance < 0 ? { backward: true } : {}),
      };
      next ??= structuredClone(incoming);
      const changed = next.entities
        .find((e) => e.id === actor.id)!
        .clips.find((c) => c.id === clip.id)!;
      if (!motion.path) {
        const base = `navigation-${actor.id}-${clip.id}`;
        let id = base,
          suffix = 2;
        while (allMotions(next).some((m) => m.id === id))
          id = `${base}-${suffix++}`;
        next.customMotions.push({
          ...motion,
          id,
          path,
          distance: 0,
          duration: clip.duration,
        });
        changed.motionId = id;
      }
      const heading = samplePath(path, 1).heading;
      changed.navigation = {
        point: [...path.points.at(-1)!],
        endHeading: heading,
        movement: motion.kind === "run" ? "run" : "walk",
      };
    }
  }
  return next ? validateScene(next) : incoming;
}
