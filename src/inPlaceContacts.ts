import type * as T from "three";
import type { FootContact, FootSample } from "./routeContacts";

export type InPlaceSupportFrame = FootSample & {
  heights?: [number, number];
  backwardSpeeds: [number, number];
  contactFeet?: T.Vector3[];
};

/** Alternating grounded backward steps can establish in-place support even
 * when authored lateral sway prevents a stationary-ankle test from passing.
 * Retain every measured ankle/sole point; this does not freeze that sway or
 * infer missing root travel through airborne intervals. */
export function detectInPlaceContacts(
  frames: InPlaceSupportFrame[],
  legHeight: number,
  existing: FootContact[],
): FootContact[] {
  if (frames.length < 3 || !(legHeight > 0)) return existing;
  const windows: FootContact[] = [];
  let first = -1,
    side = -1;
  const finish = (last: number) => {
    if (first < 0 || frames[last].time - frames[first].time < 0.12) return;
    const samples = frames.slice(first, last + 1);
    const speeds = samples
      .map((frame) => frame.backwardSpeeds[side])
      .sort((a, b) => a - b);
    if (speeds[Math.floor(speeds.length / 2)] <= legHeight * 0.4) return;
    windows.push({
      side: side === 0 ? "left" : "right",
      start: samples[0].time,
      end: samples.at(-1)!.time,
      approachDuration: Math.min(
        0.2,
        (samples.at(-1)!.time - samples[0].time) * 0.5,
      ),
      samples: samples.map((frame) => ({
        time: frame.time,
        point: frame.feet[side].clone(),
        ...(frame.contactFeet ? { sole: frame.contactFeet[side].clone() } : {}),
      })),
    });
  };
  for (let i = 0; i <= frames.length; i++) {
    const frame = frames[i];
    const next = frame?.heights
      ? [0, 1].findIndex(
          (foot) =>
            frame.heights![foot] >= -legHeight * 0.08 &&
            frame.heights![foot] <= legHeight * 0.035 &&
            frame.heights![1 - foot] > legHeight * 0.12 &&
            frame.backwardSpeeds[foot] > legHeight * 0.2,
        )
      : -1;
    if (next === side) continue;
    finish(i - 1);
    first = next < 0 ? -1 : i;
    side = next;
  }
  const paired = new Set<FootContact>();
  for (let i = 1; i < windows.length; i++) {
    const a = windows[i - 1],
      b = windows[i];
    if (a.side !== b.side && b.start - a.end <= 1) {
      paired.add(a);
      paired.add(b);
    }
  }
  const added = windows.filter(
    (window) =>
      paired.has(window) &&
      !existing.some(
        (contact) =>
          contact.side === window.side &&
          contact.end >= window.start &&
          contact.start <= window.end,
      ),
  );
  return added.length
    ? [...existing, ...added].sort((a, b) => a.start - b.start)
    : existing;
}
