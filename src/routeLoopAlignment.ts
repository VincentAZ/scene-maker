type HeadingFrame = { time: number; heading: number };
const ease = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** Close the route frame during an authored terminal turn. Only remove a
 * fraction of existing turn motion: never invent a turn in a stationary pose
 * or distribute an accumulated offset through the preceding straight walk. */
export function alignLoopHeading(
  body: HeadingFrame[],
  trajectory: HeadingFrame[],
) {
  if (body.length < 3 || body.length !== trajectory.length) return;
  const last = body.length - 1;
  const mismatch =
    body[last].heading -
    body[0].heading -
    (trajectory[last].heading - trajectory[0].heading);
  const correction = Math.atan2(Math.sin(mismatch), Math.cos(mismatch));
  if (Math.abs(correction) < 0.025) return;
  const sign = Math.sign(correction),
    end = body[last].time;
  const window = Math.min(4, (end - body[0].time) * 0.4);
  for (
    let start = last - 2;
    start >= 0 && end - body[start].time <= window;
    start--
  ) {
    if (
      (body[last].heading - body[start].heading) * sign <
      Math.abs(correction) / 0.9
    )
      continue;
    const taper = Math.min(0.25, (end - body[start].time) * 0.2);
    const steps: number[] = [];
    let available = 0;
    for (let i = start + 1; i <= last; i++) {
      const time = (body[i].time + body[i - 1].time) / 2;
      const authored = (body[i].heading - body[i - 1].heading) * sign;
      const aligned =
        authored - (trajectory[i].heading - trajectory[i - 1].heading) * sign;
      // The trajectory may already remove some of the source turn. Count
      // only turn that remains, so the added correction cannot reverse it.
      const turn = Math.max(0, Math.min(authored, aligned));
      const weight =
        ease((time - body[start].time) / taper) * ease((end - time) / taper);
      steps.push(turn * weight);
      available += turn * weight;
    }
    if (available < Math.abs(correction) / 0.9) continue;
    let offset = 0;
    const headings = trajectory.map((frame, i) => {
      if (i <= start) return frame.heading;
      offset += (steps[i - start - 1] * correction) / available;
      return frame.heading + offset;
    });
    return { headings, start: body[start].time, correction };
  }
}
