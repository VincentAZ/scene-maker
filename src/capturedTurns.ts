import * as T from "three";

export type TurnFrame = {
  time: number;
  heading: number;
  center: T.Vector3;
  feet: T.Vector3[];
  /** Actual sole height relative to the source's bind floor. */
  heights?: [number, number];
};
export type CapturedTurn = {
  sourceStart: number;
  sourceEnd: number;
  /** Settled source intervals available for entry/exit pose matching. */
  entry: { start: number; end: number };
  exit: { start: number; end: number };
  heading: number;
  /** Captured hip displacement in the entry-facing frame; never discard it. */
  displacement: [number, number, number];
  travel: number;
  supportFraction: number;
  /** Longest consecutive interval without a measured supporting foot. */
  unsupportedDuration: number;
  steppedSides: ("left" | "right")[];
};

/** Find actual standing-to-standing stepping turns, not names, torso twists,
 * ground-level spinning, or the virtual travel of an in-place walking cycle.
 * This is source evidence only: entry matching, receiver contacts and scene
 * clearance still have to be checked before scheduling a candidate. */
export function detectCapturedTurns(
  frames: TurnFrame[],
  height: number,
): CapturedTurn[] {
  if (
    frames.length < 3 ||
    !(height > 0) ||
    !Number.isFinite(height) ||
    frames.some(
      (frame, i) =>
        !Number.isFinite(frame.time + frame.heading) ||
        (i > 0 && frame.time <= frames[i - 1].time) ||
        !frame.center.toArray().every(Number.isFinite) ||
        frame.feet.length !== 2 ||
        frame.feet.some((p) => !p.toArray().every(Number.isFinite)) ||
        frame.heights?.length !== 2 ||
        !frame.heights.every(Number.isFinite),
    )
  )
    return [];
  const headings: number[] = [];
  for (const frame of frames) {
    const previous = headings.at(-1);
    headings.push(
      previous === undefined
        ? frame.heading
        : previous +
            Math.atan2(
              Math.sin(frame.heading - previous),
              Math.cos(frame.heading - previous),
            ),
    );
  }
  const samples = frames.map((frame, i) => {
    let low = i,
      high = i;
    while (low > 0 && frame.time - frames[low].time < 0.05) low--;
    while (high < frames.length - 1 && frames[high].time - frame.time < 0.05)
      high++;
    const a = frames[low],
      b = frames[high],
      dt = b.time - a.time;
    const speed =
      Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z) / dt;
    const support = frame.heights!.reduce(
      (mask, y, side) =>
        y >= -height * 0.08 &&
        y <= height * 0.035 &&
        a.feet[side].distanceTo(b.feet[side]) / dt <= height * 0.08
          ? mask | (1 << side)
          : mask,
      0,
    );
    return {
      support,
      settled:
        support === 3 &&
        speed <= height * 0.12 &&
        Math.abs(headings[high] - headings[low]) / dt <= 0.2,
    };
  });
  const rests: { first: number; last: number }[] = [];
  let first = -1;
  for (let i = 0; i <= frames.length; i++) {
    if (i < frames.length && samples[i].settled) {
      if (first < 0) first = i;
    } else if (first >= 0) {
      if (frames[i - 1].time - frames[first].time >= 0.2)
        rests.push({ first, last: i - 1 });
      first = -1;
    }
  }
  const result: CapturedTurn[] = [];
  for (let r = 0; r < rests.length - 1; r++) {
    const entry = rests[r];
    // Include preparation and settling at the native clock, not a time fit.
    let start = entry.last;
    while (
      start > entry.first &&
      frames[entry.last].time - frames[start].time < 0.15
    )
      start--;
    for (const exit of rests.slice(r + 1)) {
      let end = exit.first;
      while (
        end < exit.last &&
        frames[end].time - frames[exit.first].time < 0.25
      )
        end++;
      const duration = frames[end].time - frames[start].time;
      if (duration > 6) break;
      const heading = headings[end] - headings[start];
      if (
        duration < 0.4 ||
        Math.abs(heading) < Math.PI / 12 ||
        Math.abs(heading) > Math.PI + 0.1
      )
        continue;
      let travel = 0,
        reach = 0,
        supportTime = 0,
        gap = 0,
        maxGap = 0,
        reverse = 0;
      for (let i = start + 1; i <= end; i++) {
        const a = frames[i - 1],
          b = frames[i],
          dt = b.time - a.time;
        travel += Math.hypot(b.center.x - a.center.x, b.center.z - a.center.z);
        reach = Math.max(
          reach,
          Math.hypot(
            b.center.x - frames[start].center.x,
            b.center.z - frames[start].center.z,
          ),
        );
        if (samples[i - 1].support && samples[i].support) {
          supportTime += dt;
          gap = 0;
        } else {
          gap += dt;
          maxGap = Math.max(maxGap, gap);
        }
        reverse += Math.max(
          0,
          -(headings[i] - headings[i - 1]) * Math.sign(heading),
        );
      }
      if (
        travel > height ||
        reach > height * 0.5 ||
        supportTime / duration < 0.85 ||
        maxGap > 0.12 ||
        reverse > 0.15
      )
        continue;
      const steppedSides = (["left", "right"] as const).filter((_, side) => {
        const base = frames[start].heights![side];
        // A foot must leave its supported start, lift, and return to support
        // at a new location. A stationary foot under a twisting torso is not a step.
        return (
          frames[end].feet[side].distanceTo(frames[start].feet[side]) >=
            height * 0.04 &&
          frames
            .slice(start + 1, end)
            .some(
              (f, offset) =>
                !(samples[start + 1 + offset].support & (1 << side)) &&
                f.heights![side] - base >= height * 0.025,
            )
        );
      });
      if (!steppedSides.length) continue;
      const displacement = frames[end].center
        .clone()
        .sub(frames[start].center)
        .applyAxisAngle(new T.Vector3(0, 1, 0), -headings[start])
        .toArray();
      result.push({
        sourceStart: frames[start].time,
        sourceEnd: frames[end].time,
        entry: {
          start: frames[entry.first].time,
          end: frames[entry.last].time,
        },
        exit: { start: frames[exit.first].time, end: frames[exit.last].time },
        heading,
        displacement,
        travel,
        supportFraction: supportTime / duration,
        unsupportedDuration: maxGap,
        steppedSides,
      });
    }
  }
  return result;
}
