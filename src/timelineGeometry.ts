import type { Entity } from "../shared/scene";
import {
  clipPlaybackRate,
  clipSourceEnd,
  clipSourceStart,
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  routeActiveDuration,
} from "../shared/clipTiming";

type Clip = Entity["clips"][number];

/** Ordinary edge drags land on tenths of a second; Shift snaps to markers. */
export const DRAG_STEP = 0.1;
/** How close, in pixels, an edge must come to a marker before Shift snaps. */
export const SNAP_PIXELS = 8;
/** Pointer travel before a press on a handle counts as a drag, not a click. */
export const DRAG_THRESHOLD = 4;
export const MIN_CLIP_SECONDS = 0.2;
export const MAX_CLIP_SECONDS = 60;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** Timeline seconds covered by a pointer movement across a track that is
 * `trackWidth` pixels wide and shows `total` seconds. */
export const pixelsToSeconds = (
  pixels: number,
  total: number,
  trackWidth: number,
) => (trackWidth > 0 ? (pixels * total) / trackWidth : 0);

export const secondsToPixels = (
  seconds: number,
  total: number,
  trackWidth: number,
) => (total > 0 ? (seconds * trackWidth) / total : 0);

export const roundToStep = (seconds: number, step = DRAG_STEP) =>
  Number((Math.round(seconds / step) * step).toFixed(4));

/** The lengths a clip may be dragged or typed to. A stopped route cannot end
 * before its stop, and a route keeping a saved terminal hold must still travel
 * for a moment. */
export function durationBounds(clip: Pick<Clip, "routeStop" | "routeHold">) {
  const hold =
    clip.routeStop === undefined && clip.routeHold !== undefined
      ? clip.routeHold + MIN_CLIP_SECONDS
      : 0;
  return {
    min: Math.max(MIN_CLIP_SECONDS, clip.routeStop ?? 0, hold),
    max: MAX_CLIP_SECONDS,
  };
}

/** Where each clip of a sequence begins, in timeline seconds. */
export function clipStarts(clips: Pick<Clip, "duration">[]) {
  const starts: number[] = [];
  let start = 0;
  for (const clip of clips) {
    starts.push(start);
    start += clip.duration;
  }
  return starts;
}

export type SnapMarker = { time: number; label: string };

/** Moments worth landing on exactly: where other characters' actions change,
 * the playhead, and the ruler marks. */
export function snapMarkers(options: {
  cast: { id: string; name: string; clips: Pick<Clip, "duration">[] }[];
  entityId: string;
  total: number;
  playhead: number;
}): SnapMarker[] {
  const markers: SnapMarker[] = [];
  for (const other of options.cast) {
    if (other.id === options.entityId) continue;
    let time = 0;
    for (const clip of other.clips) {
      time += clip.duration;
      markers.push({ time, label: other.name });
    }
  }
  markers.push({ time: options.playhead, label: "the playhead" });
  // The ruler prints whole seconds, so land on the number the creator reads.
  for (let i = 0; i <= 6; i++) {
    const time = Math.round((options.total * i) / 6);
    markers.push({ time, label: `the ${time}s mark` });
  }
  return markers;
}

/** The action to select once the one at `removedIndex` is gone: whichever
 * took its place, else the new last one. */
export function clipAfterRemoval<T>(remaining: T[], removedIndex: number) {
  return remaining[Math.min(removedIndex, remaining.length - 1)];
}

/** How much faster (above 1) or slower a route travels once its clip lasts
 * `duration` seconds; the terminal hold, if any, keeps its length. */
export function travelSpeedFactor(
  clip: Pick<Clip, "duration" | "routeHold" | "routeActive">,
  duration: number,
) {
  const active = duration - (clip.routeHold ?? 0);
  return active > 0 ? routeActiveDuration(clip) / active : 1;
}

/** The moment a recorded take runs out of frames and the clip starts holding
 * its last pose; snapping a hold here starts it exactly where the recording
 * ends. */
export function sourceEndMarker(
  clip: Clip,
  start: number,
  sourceDuration: number,
): SnapMarker {
  const rate = clipPlaybackRate(clip, sourceDuration);
  const remaining = sourceDuration - clipSourceStart(clip, sourceDuration);
  return {
    time: start + (rate > 0 ? remaining / rate : 0),
    label: "the end of the recording",
  };
}

/** The nearest marker within `tolerance` seconds, if any. */
export function snapToMarkers(
  time: number,
  markers: SnapMarker[],
  tolerance: number,
): { time: number; label?: string } {
  let best: SnapMarker | undefined;
  for (const marker of markers) {
    const distance = Math.abs(marker.time - time);
    if (
      distance <= tolerance &&
      (!best || distance < Math.abs(best.time - time))
    )
      best = marker;
  }
  return best ? { time: best.time, label: best.label } : { time };
}

/** A pointer that comes back to where it pressed changes nothing, even on an
 * action whose length is off the grid. */
const stays = (deltaSeconds: number) => Math.abs(deltaSeconds) < DRAG_STEP / 2;

/** A right-edge drag: the clip's new length after moving its end by
 * `deltaSeconds`, on the tenth-of-a-second grid or, with Shift, snapped to a
 * marker. The label names the marker only when the snap survives clamping. */
export function dragEnd(options: {
  clip: Clip;
  start: number;
  deltaSeconds: number;
  shift: boolean;
  markers: SnapMarker[];
  tolerance: number;
}): { duration: number; snapped?: string } {
  const { clip, start } = options;
  const raw = clip.duration + options.deltaSeconds;
  const snap = options.shift
    ? snapToMarkers(start + raw, options.markers, options.tolerance)
    : undefined;
  const wanted =
    snap?.label !== undefined
      ? Number((snap.time - start).toFixed(4))
      : stays(options.deltaSeconds)
        ? clip.duration
        : roundToStep(raw);
  const bounds = durationBounds(clip);
  const duration = clamp(wanted, bounds.min, bounds.max);
  return duration === wanted && snap?.label
    ? { duration, snapped: snap.label }
    : { duration };
}

/** A left-edge drag on a standalone take trims into the recording: the clip
 * starts `shift` seconds later in the take and lasts that much less, so the
 * frame at its right edge stays where it was. Dragging left restores trimmed
 * frames down to the recording's first frame. With Shift, a marker inside the
 * clip (the playhead) names the frame the clip should now begin on. */
export function trimStart(options: {
  clip: Clip;
  start: number;
  sourceDuration: number;
  deltaSeconds: number;
  shift: boolean;
  markers: SnapMarker[];
  tolerance: number;
}): { duration: number; sourceStart: number; shift: number; snapped?: string } {
  const { clip, start, sourceDuration } = options;
  const rate = clipPlaybackRate(clip, sourceDuration);
  const sourceStart = clipSourceStart(clip, sourceDuration);
  // Restoring frames may not make the clip longer than any clip can be.
  const earliest = Math.max(
    rate > 0 ? -sourceStart / rate : 0,
    clip.duration - MAX_CLIP_SECONDS,
  );
  // Keep a playable moment of both the clip and the recording.
  const remaining = rate > 0 ? (sourceDuration - sourceStart) / rate : 0;
  const latest = Math.max(
    earliest,
    Math.min(clip.duration, remaining) - MIN_CLIP_SECONDS,
  );
  const snap = options.shift
    ? snapToMarkers(
        start + options.deltaSeconds,
        options.markers,
        options.tolerance,
      )
    : undefined;
  const wanted =
    snap?.label !== undefined
      ? Number((snap.time - start).toFixed(4))
      : stays(options.deltaSeconds)
        ? 0
        : clip.duration - roundToStep(clip.duration - options.deltaSeconds);
  const shift = clamp(wanted, earliest, latest);
  return {
    duration: Number((clip.duration - shift).toFixed(4)),
    sourceStart: Number((sourceStart + shift * rate).toFixed(4)),
    shift,
    ...(shift === wanted && snap?.label ? { snapped: snap.label } : {}),
  };
}

/** The speed that plays the clip's current stretch of recording in exactly
 * `duration` seconds. */
export function stretchRate(
  clip: Clip,
  sourceDuration: number,
  duration: number,
) {
  const span =
    clipSourceEnd(clip, sourceDuration) - clipSourceStart(clip, sourceDuration);
  return clamp(span / duration, MIN_PLAYBACK_RATE, MAX_PLAYBACK_RATE);
}

/** "3.4 s", or two decimals when the value is off the tenth grid. */
export function formatSeconds(seconds: number) {
  const tenths = Math.round(seconds * 10) / 10;
  return `${Math.abs(tenths - seconds) < 1e-6 ? tenths.toFixed(1) : seconds.toFixed(2)} s`;
}

export const formatRate = (rate: number) => `${Number(rate.toFixed(2))}×`;
