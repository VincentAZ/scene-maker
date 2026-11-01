/** Smooth an upper bound on penetration. Each dilated neighbourhood includes
 * the current sample before averaging, so smoothing cannot lower support below
 * that sample. Constant contact heights stay constant; zero flight regions
 * beyond twice the radius remain untouched. */
export function groundSupportEnvelope(
  penetration: number[],
  radius: number,
  loop = false,
) {
  if (penetration.length < 2)
    return penetration.map((value) => Math.max(0, value));
  const values = penetration.map((value) => Math.max(0, value));
  if (loop) values[0] = Math.max(values[0], values.pop()!);
  const size = values.length;
  radius = Math.max(1, Math.min(size, Math.ceil(radius)));
  const at = (index: number) =>
    loop
      ? ((index % size) + size) % size
      : Math.max(0, Math.min(size - 1, index));
  const dilated = values.map((_, index) => {
    let maximum = 0;
    for (let offset = -radius; offset <= radius; offset++)
      maximum = Math.max(maximum, values[at(index + offset)]);
    return maximum;
  });
  const result = values.map((_, index) => {
    let sum = 0,
      weight = 0;
    for (let offset = -radius; offset <= radius; offset++) {
      const w = 1 + Math.cos((Math.PI * offset) / (radius + 1));
      sum += dilated[at(index + offset)] * w;
      weight += w;
    }
    return sum / weight;
  });
  if (loop) result.push(result[0]);
  return result;
}

/** Shape-preserving interpolation with a shared endpoint tangent. Linear
 * envelope samples are position-continuous but can kick the supported body
 * vertically at each repeated cycle; a periodic tangent removes that kick.
 * Harmonic tangents keep each interval inside its sampled nonnegative bounds. */
export function sampleLoopGroundSupport(
  frames: { time: number; loopGroundLift?: number }[],
  index: number,
  u: number,
) {
  const last = frames.length - 1;
  if (last < 2) return frames[0]?.loopGroundLift ?? 0;
  const value = (i: number) => Math.max(0, frames[i].loopGroundLift ?? 0);
  const slope = (i: number) =>
    (value(i + 1) - value(i)) / (frames[i + 1].time - frames[i].time);
  const tangent = (i: number) => {
    const before = i === 0 || i === last ? last - 1 : i - 1;
    const after = i === last ? 0 : i;
    const a = slope(before),
      b = slope(after);
    if (a * b <= 0) return 0;
    const da = frames[before + 1].time - frames[before].time,
      db = frames[after + 1].time - frames[after].time,
      wa = 2 * db + da,
      wb = db + 2 * da;
    return (wa + wb) / (wa / a + wb / b);
  };
  const t = Math.max(0, Math.min(1, u)),
    t2 = t * t,
    t3 = t2 * t;
  const dt = frames[index + 1].time - frames[index].time;
  return (
    (2 * t3 - 3 * t2 + 1) * value(index) +
    (t3 - 2 * t2 + t) * dt * tangent(index) +
    (-2 * t3 + 3 * t2) * value(index + 1) +
    (t3 - t2) * dt * tangent(index + 1)
  );
}
