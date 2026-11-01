type FlightFrame = {
  time: number;
  heights: [number, number];
  speeds: [number, number];
  distance: number;
};
type Support = { foot: number; start: number; end: number; speed: number };
const ease = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** Reconstruct missing root travel between alternating running supports.
 * Grounded pauses and two-foot jumps provide no such evidence. Only sections
 * bridged by a sustained airborne gap receive the inferred pace. */
export function reconstructFlightTravel(
  frames: FlightFrame[],
  legHeight: number,
  loop: boolean,
) {
  if (frames.length < 4 || !(legHeight > 0)) return;
  const duration = frames.at(-1)!.time - frames[0].time;
  if (!(duration > 0)) return;
  let windows: Support[] = [];
  const observations = new Map<Support, number[]>();
  let start = -1,
    foot = -1;
  const finish = (end: number) => {
    if (start < 0) return;
    const speeds = frames
      .slice(start, end + 1)
      .map((frame) => frame.speeds[foot])
      .filter((speed) => speed > legHeight * 0.2)
      .sort((a, b) => a - b);
    if (!speeds.length) return;
    const speed = speeds[Math.floor(speeds.length / 2)];
    const window = {
      foot,
      start: frames[start].time,
      end: frames[end].time,
      speed,
    };
    windows.push(window);
    observations.set(window, speeds);
  };
  for (let i = 0; i < frames.length; i++) {
    const h = frames[i].heights;
    const side =
      h[0] <= legHeight * 0.035 && h[1] > legHeight * 0.12
        ? 0
        : h[1] <= legHeight * 0.035 && h[0] > legHeight * 0.12
          ? 1
          : -1;
    // A stationary single-foot balance is not evidence of forward running.
    const movingSide =
      side !== -1 && frames[i].speeds[side] > legHeight * 0.2 ? side : -1;
    if (movingSide !== foot) {
      finish(i - 1);
      start = movingSide < 0 ? -1 : i;
      foot = movingSide;
    }
  }
  finish(frames.length - 1);
  if (windows.length < 2) return;
  const first = windows[0],
    last = windows.at(-1)!;
  if (
    loop &&
    first.foot === last.foot &&
    first.start === frames[0].time &&
    last.end === frames.at(-1)!.time
  ) {
    windows.shift();
    windows.pop();
    const speeds = [
      ...observations.get(first)!,
      ...observations.get(last)!,
    ].sort((a, b) => a - b);
    const joined = {
      foot: first.foot,
      start: last.start,
      end: first.end + duration,
      speed: speeds[Math.floor(speeds.length / 2)],
    };
    windows.push(joined);
    observations.set(joined, speeds);
  }
  windows = windows.filter(
    (window) =>
      window.end - window.start >= 0.05 &&
      observations.get(window)!.length >= 3 &&
      window.speed > legHeight * 0.4,
  );
  if (windows.length < 2) return;
  const segments: { a: Support; b: Support; next: Support }[] = [];
  const used = new Set<Support>();
  for (let i = 0; i < windows.length; i++) {
    const a = windows[i];
    const next = windows[i + 1] ?? (loop ? windows[0] : undefined);
    let b = next;
    if (!windows[i + 1] && loop)
      b = {
        ...windows[0],
        start: windows[0].start + duration,
        end: windows[0].end + duration,
      };
    if (!b || a.foot === b.foot || b.start - a.end > 1) continue;
    let flight = 0;
    let groundedPause = false;
    for (let j = 1; j < frames.length; j++) {
      for (const shift of loop ? [0, duration] : [0]) {
        const time = frames[j].time + shift;
        if (time > a.end && time < b.start) {
          const low = Math.min(...frames[j].heights);
          if (low > legHeight * 0.12)
            flight += frames[j].time - frames[j - 1].time;
          // Do not smooth travel across a stop or a double-foot support.
          if (
            Math.max(...frames[j].heights) <= legHeight * 0.035 ||
            (low <= legHeight * 0.035 &&
              Math.max(...frames[j].speeds) <= legHeight * 0.2)
          )
            groundedPause = true;
        }
      }
    }
    if (flight >= 0.04 && !groundedPause) {
      segments.push({ a, b, next: next! });
      used.add(a);
      used.add(next!);
    }
  }
  if (!segments.length) return;
  // A left/right stride asymmetry is not evidence that the body should surge
  // on every step. Filter support pace across verified flight links only.
  // Time-weighted neighbours retain a longer-term linear acceleration; breaks
  // in running evidence (including grounded pauses) remain separate.
  const neighbours = new Map<
    Support,
    {
      previous?: { support: Support; time: number };
      next?: { support: Support; time: number };
    }
  >();
  for (const { a, b, next } of segments) {
    const before = neighbours.get(a) ?? {},
      after = neighbours.get(next) ?? {};
    before.next = { support: next, time: (b.start + b.end) / 2 };
    after.previous = {
      support: a,
      time: (a.start + a.end) / 2 - (b.start - next.start),
    };
    neighbours.set(a, before);
    neighbours.set(next, after);
  }
  const paces = new Map(
    windows.map((window) => {
      const { previous, next } = neighbours.get(window) ?? {};
      if (!previous || !next) return [window, window.speed];
      const time = (window.start + window.end) / 2;
      const fraction = (time - previous.time) / (next.time - previous.time);
      const adjacent =
        previous.support.speed +
        (next.support.speed - previous.support.speed) * fraction;
      return [window, (window.speed + adjacent) / 2];
    }),
  );
  const distances = [0];
  for (let i = 1; i < frames.length; i++) {
    const dt = frames[i].time - frames[i - 1].time;
    const time = (frames[i].time + frames[i - 1].time) / 2;
    const original = (frames[i].distance - frames[i - 1].distance) / dt;
    let weight = 0,
      inferred = original;
    for (const { a, b, next } of segments) {
      const ac = (a.start + a.end) / 2,
        bc = (b.start + b.end) / 2;
      for (const shift of loop ? [-duration, 0, duration] : [0]) {
        const t = time + shift;
        if (t < a.start || t > b.end) continue;
        const w = Math.min(
          ease((t - a.start) / (ac - a.start)),
          ease((b.end - t) / (b.end - bc)),
        );
        if (w > weight) {
          weight = w;
          const first = paces.get(a)!,
            last = paces.get(next)!;
          inferred = first + (last - first) * ease((t - ac) / (bc - ac));
        }
      }
    }
    distances.push(
      distances.at(-1)! + (original + (inferred - original) * weight) * dt,
    );
  }
  const supports = windows
    .filter((window) => used.has(window))
    .flatMap((window) =>
      window.end > frames.at(-1)!.time
        ? [
            { ...window, end: frames.at(-1)!.time },
            { ...window, start: frames[0].time, end: window.end - duration },
          ]
        : [window],
    );
  return { distances, supports };
}
