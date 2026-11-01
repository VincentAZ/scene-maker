import { contactPoint, type FootContact } from "./routeContacts";

export type ScheduledContact = {
  contact: FootContact;
  approachStart: number;
  releaseEnd: number;
  continuous: boolean;
};

/** Keep every recorded stance point while matching the interpolated contact
 * velocity through a joined seam. Component-wise monotone tangents retain the
 * measured bounds; ordinary, unjoined source contacts are unchanged. */
function smoothContact(contact: FootContact, periodic = false): FootContact {
  const samples = contact.samples,
    last = samples.length - 1;
  if (last < 1) return contact;
  const slope = (i: number) =>
    samples[i + 1].point
      .clone()
      .sub(samples[i].point)
      .divideScalar(samples[i + 1].time - samples[i].time);
  return {
    ...contact,
    samples: samples.map((sample, i) => {
      if (!periodic && (i === 0 || i === last))
        return { ...sample, velocity: slope(i === 0 ? 0 : last - 1) };
      const before = i === 0 || i === last ? last - 1 : i - 1,
        after = i === last ? 0 : i;
      const a = slope(before),
        b = slope(after),
        da = samples[before + 1].time - samples[before].time,
        db = samples[after + 1].time - samples[after].time,
        wa = 2 * db + da,
        wb = db + 2 * da;
      const velocity = sample.point.clone().set(0, 0, 0);
      for (const axis of ["x", "y", "z"] as const)
        if (a[axis] * b[axis] > 0)
          velocity[axis] = (wa + wb) / (wa / a[axis] + wb / b[axis]);
      return { ...sample, velocity };
    }),
  };
}

/** Join stance evidence across a verified pose seam. Source coordinates reset
 * each cycle, so carry only its displacement through the joined contact. */
export function scheduleRouteContacts(
  contacts: FootContact[],
  duration: number,
  loopSides: FootContact["side"][] = [],
): ScheduledContact[] {
  if (!(duration > 0)) return [];
  const result: ScheduledContact[] = [];
  for (const side of ["left", "right"] as const) {
    const intervals = contacts
      .filter((contact) => contact.side === side)
      .sort((a, b) => a.start - b.start);
    if (!intervals.length) continue;
    const first = intervals[0],
      last = intervals.at(-1)!;
    const seamless = loopSides.includes(side);
    const joins =
      seamless && first.start <= 1e-6 && last.end >= duration - 1e-6;
    if (joins && first === last) {
      result.push({
        contact: smoothContact(first, true),
        approachStart: first.start,
        releaseEnd: Infinity,
        continuous: true,
      });
      continue;
    }
    if (joins) {
      const offset = contactPoint(last, duration).sub(contactPoint(first, 0));
      intervals.pop();
      intervals.shift();
      intervals.push(
        smoothContact({
          side,
          start: last.start,
          end: duration + first.end,
          approachDuration:
            Math.max(first.approachDuration ?? 0, last.approachDuration ?? 0) ||
            undefined,
          maxCorrection:
            Math.max(first.maxCorrection ?? 0, last.maxCorrection ?? 0) ||
            undefined,
          releaseDuration:
            first.releaseDuration !== undefined ||
            last.releaseDuration !== undefined
              ? (first.releaseDuration ?? first.end - first.start) +
                (last.releaseDuration ?? last.end - last.start)
              : undefined,
          samples: [
            ...last.samples,
            ...first.samples
              .filter((sample) => sample.time > 0)
              .map((sample) => ({
                time: duration + sample.time,
                point: sample.point.clone().add(offset),
              })),
          ],
        }),
      );
    }
    const approachStarts = intervals.map((contact, index) => {
      const approach = Math.max(0, contact.approachDuration ?? 0);
      const previous =
        intervals[index - 1] ?? (seamless ? intervals.at(-1) : undefined);
      if (!previous) return Math.max(0, contact.start - approach);
      const end = previous.end - (index === 0 ? duration : 0);
      const gap = Math.max(0, contact.start - end);
      const release = Math.max(
        0,
        Math.min(0.35, previous.releaseDuration ?? 0.35),
      );
      // Share a short swing interval rather than consuming all of the prior
      // release and dropping its correction abruptly at takeoff.
      const scale =
        approach + release > 0 ? Math.min(1, gap / (approach + release)) : 1;
      return contact.start - approach * scale;
    });
    for (const [index, contact] of intervals.entries()) {
      const next =
        approachStarts[index + 1] ??
        (seamless ? approachStarts[0] + duration : duration);
      result.push({
        contact,
        approachStart: approachStarts[index],
        releaseEnd: Math.min(
          contact.end + Math.min(0.35, contact.releaseDuration ?? 0.35),
          next,
        ),
        continuous: false,
      });
    }
  }
  return result;
}

export function scheduledContactPoint(
  scheduled: ScheduledContact,
  time: number,
  duration: number,
) {
  if (!scheduled.continuous) return contactPoint(scheduled.contact, time);
  const cycles = Math.floor(time / duration);
  return contactPoint(
    scheduled.contact,
    time - cycles * duration,
  ).addScaledVector(
    contactPoint(scheduled.contact, duration).sub(
      contactPoint(scheduled.contact, 0),
    ),
    cycles,
  );
}
