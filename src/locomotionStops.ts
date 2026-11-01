import * as T from "three";

export type StopFrame = {
  time: number;
  distance: number;
  heading: number;
  feet: T.Vector3[];
  heights?: [number, number];
};
export type LocomotionStop = {
  /** First sustained stationary sample and last available stationary sample. */
  settled: number;
  end: number;
  /** Keep part of the actual standing performance after deceleration. */
  sourceEnd: number;
  entries: { time: number; distance: number; speed: number; support: number }[];
};

/** Evidence for a captured arrival, independent of names and provider metadata.
 * A short double-support phase, feet held above ground, an initial idle and a
 * pause without preceding travel are not stopping actions. Distances/heights
 * use the same source-local units as the measured trajectory. */
export function detectLocomotionStops(
  frames: StopFrame[],
  height: number,
): LocomotionStop[] {
  if (
    frames.length < 3 ||
    !(height > 0) ||
    !Number.isFinite(height) ||
    frames.some(
      (f, i) =>
        !Number.isFinite(f.time + f.distance) ||
        (i > 0 &&
          (f.time <= frames[i - 1].time ||
            f.distance < frames[i - 1].distance)) ||
        f.feet.length !== 2 ||
        f.feet.some((p) => !p.toArray().every(Number.isFinite)),
    )
  )
    return [];
  const samples = frames.map((frame, i) => {
    let low = i,
      high = i;
    while (low > 0 && frame.time - frames[low].time < 0.05) low--;
    while (high < frames.length - 1 && frames[high].time - frame.time < 0.05)
      high++;
    const before = frames[low],
      after = frames[high],
      dt = after.time - before.time;
    const speed = dt > 0 ? (after.distance - before.distance) / dt : Infinity;
    const footSpeeds = frame.feet.map((_, side) =>
      dt > 0 ? after.feet[side].distanceTo(before.feet[side]) / dt : Infinity,
    );
    const support =
      frame.heights?.reduce(
        (mask, y, side) =>
          y >= -height * 0.08 &&
          y <= height * 0.035 &&
          footSpeeds[side] <= height * 0.08
            ? mask | (1 << side)
            : mask,
        0,
      ) ?? 0;
    return {
      speed,
      support,
      stopped: speed >= 0 && speed <= height * 0.12 && support === 3,
    };
  });
  const result: LocomotionStop[] = [];
  let start = -1;
  const finish = (last: number) => {
    if (start < 0) return;
    const first = start;
    start = -1;
    if (frames[last].time - frames[first].time < 0.4) return;
    const settled = frames[first].time;
    const endIndex = frames.findIndex(
      (f, i) =>
        i >= first && f.time >= Math.min(settled + 0.6, frames[last].time),
    );
    const sourceEnd = frames[endIndex].time;
    const entries: LocomotionStop["entries"] = [];
    for (let i = first - 1; i >= 0; i--) {
      const elapsed = settled - frames[i].time;
      if (elapsed > 2) break;
      if (
        elapsed < 0.35 ||
        samples[i].speed < height * 0.18 ||
        !samples[i].support
      )
        continue;
      const distance = frames[endIndex].distance - frames[i].distance;
      if (distance < height * 0.12) continue;
      entries.push({
        time: frames[i].time,
        distance,
        speed: samples[i].speed,
        support: samples[i].support,
      });
    }
    // No entry means this is an idle or an unresolved support observation,
    // not evidence that a travelling body can enter the stationary segment.
    if (entries.length)
      result.push({
        settled,
        end: frames[last].time,
        sourceEnd,
        entries: entries.reverse(),
      });
  };
  for (let i = 0; i < frames.length; i++) {
    if (samples[i].stopped) {
      if (start < 0) start = i;
    } else finish(i - 1);
  }
  finish(frames.length - 1);
  return result;
}
