import type { Entity } from "./scene";

type ClipTiming = Pick<
  Entity["clips"][number],
  "duration" | "playbackRate" | "sourceStart"
>;

export const MIN_PLAYBACK_RATE = 0.001;
export const MAX_PLAYBACK_RATE = 300;

export const clipSourceStart = (clip: ClipTiming, sourceDuration: number) =>
  Math.max(0, Math.min(sourceDuration, clip.sourceStart ?? 0));

/**
 * Imported takes run at an explicit source-seconds / timeline-second rate.
 * Missing rates without a source start identify old scenes, whose full take
 * was fitted to duration. Source ranges are new and default to native speed.
 * Scene validation materializes that rate and marks it as legacyFit so edits
 * thereafter never silently change speed. Keep this fallback for raw callers.
 */
export function clipPlaybackRate(clip: ClipTiming, sourceDuration: number) {
  return (
    clip.playbackRate ??
    (clip.sourceStart !== undefined ? 1 : sourceDuration / clip.duration)
  );
}

/** Sample source time, trimming short clips and holding long ones (no loop). */
export function sourceSecondsAt(
  clip: ClipTiming,
  elapsed: number,
  sourceDuration: number,
) {
  const local = Math.max(0, Math.min(clip.duration, elapsed));
  return Math.min(
    sourceDuration,
    clipSourceStart(clip, sourceDuration) +
      local * clipPlaybackRate(clip, sourceDuration),
  );
}

/** Source timestamp used for final pose and accumulated travel/heading. */
export function clipSourceEnd(clip: ClipTiming, sourceDuration: number) {
  return sourceSecondsAt(clip, clip.duration, sourceDuration);
}

/** Local timeline time where source motion stops; the scheduled slot may hold. */
export function clipEffectiveEnd(clip: ClipTiming, sourceDuration: number) {
  const rate = clipPlaybackRate(clip, sourceDuration);
  return Math.min(
    clip.duration,
    rate > 0
      ? (sourceDuration - clipSourceStart(clip, sourceDuration)) / rate
      : 0,
  );
}

export function clipTimingDescription(
  clip: ClipTiming,
  sourceDuration: number,
) {
  const consumed = clipSourceEnd(clip, sourceDuration);
  const start = clipSourceStart(clip, sourceDuration);
  const prefix = start ? `Starts at ${Number(start.toFixed(2))}s. ` : "";
  const hold = clip.duration - clipEffectiveEnd(clip, sourceDuration);
  if (hold > 1e-6)
    return `${prefix}${start ? "Remaining source" : "Full take"}, then hold the final pose for ${Number(hold.toFixed(2))}s.`;
  if (consumed < sourceDuration - 1e-6)
    return `${prefix}Trimmed at ${Number(consumed.toFixed(2))}s of the ${Number(sourceDuration.toFixed(2))}s source take.`;
  return start
    ? `${prefix}Plays to the source end; no hold.`
    : "Full source take; no trim or hold.";
}

/** Active route travel excludes the saved terminal hold. */
export const routeActiveDuration = (
  clip: Pick<Entity["clips"][number], "duration" | "routeHold" | "routeActive">,
) => clip.routeActive ?? clip.duration - (clip.routeHold ?? 0);

/** A route stopped while being played keeps the pose it had at its stop time
 * for the rest of its clip. As the last clip (a held playback sequence) it
 * keeps that pose however far the timeline advances. */
export function routeStopTime(
  clips: Pick<
    Entity["clips"][number],
    "id" | "duration" | "routeStop" | "routeWait"
  >[],
  time: number,
) {
  let start = 0;
  const stopped = new Map<string, number>();
  for (const [index, clip] of clips.entries()) {
    const last = index === clips.length - 1;
    if (
      clip.routeWait &&
      time >= start &&
      (last || time < start + clip.duration)
    ) {
      const held = stopped.get(clip.routeWait);
      if (held !== undefined) return held;
    }
    if (clip.routeStop !== undefined)
      stopped.set(clip.id, start + clip.routeStop - 1e-7);
    if (
      clip.routeStop !== undefined &&
      time >= start + clip.routeStop &&
      (last || time < start + clip.duration)
    )
      return start + clip.routeStop - 1e-7;
    if (time < start + clip.duration) break;
    start += clip.duration;
  }
  return time;
}
