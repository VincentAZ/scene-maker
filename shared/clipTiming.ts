import type { Entity } from "./scene";

type ClipTiming = Pick<Entity["clips"][number], "duration" | "playbackRate">;

export const MIN_PLAYBACK_RATE = 0.001;
export const MAX_PLAYBACK_RATE = 300;

/**
 * Imported takes run at an explicit source-seconds / timeline-second rate.
 * Missing rates identify old scenes, whose full take was fitted to duration.
 * Scene validation materializes that rate and marks it as legacyFit so edits
 * thereafter never silently change speed. Keep this fallback for raw callers.
 */
export function clipPlaybackRate(clip: ClipTiming, sourceDuration: number) {
  return clip.playbackRate ?? sourceDuration / clip.duration;
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
    local * clipPlaybackRate(clip, sourceDuration),
  );
}

/** Source timestamp used for final pose and accumulated travel/heading. */
export function clipSourceEnd(clip: ClipTiming, sourceDuration: number) {
  return sourceSecondsAt(clip, clip.duration, sourceDuration);
}

/** Local timeline time where source motion stops; the scheduled slot may hold. */
export function clipEffectiveEnd(clip: ClipTiming, sourceDuration: number) {
  return Math.min(
    clip.duration,
    sourceDuration / clipPlaybackRate(clip, sourceDuration),
  );
}

export function clipTimingDescription(
  clip: ClipTiming,
  sourceDuration: number,
) {
  const consumed = clipSourceEnd(clip, sourceDuration);
  const hold = clip.duration - clipEffectiveEnd(clip, sourceDuration);
  if (hold > 1e-6)
    return `Full take, then hold the final pose for ${Number(hold.toFixed(2))}s.`;
  if (consumed < sourceDuration - 1e-6)
    return `Trimmed at ${Number(consumed.toFixed(2))}s of the ${Number(sourceDuration.toFixed(2))}s source take.`;
  return "Full source take; no trim or hold.";
}
