import * as T from "three";
import type { FootContact } from "./routeContacts";

/** Confirmed running supports need a stationary ankle goal after reconstructing
 * root travel. Preserve sole movement relative to the ankle (authored foot roll)
 * and vertical motion; limit correction to the leg's available reach at runtime. */
export function flightFootContacts(
  contacts: FootContact[],
  supports: { foot: number; start: number; end: number }[],
  frames: { time: number; feet: T.Vector3[]; contactFeet: T.Vector3[] }[],
  trajectory: { center: T.Vector3 }[],
  legHeight: number,
  hasSoles: boolean,
) {
  const result = [...contacts];
  for (const support of supports) {
    const side = support.foot === 0 ? "left" : "right";
    let start = support.start,
      end = support.end;
    // Union overlapping evidence rather than apply competing goals to one foot.
    for (let index = 0; index < result.length; index++) {
      const contact = result[index];
      if (contact.side !== side || contact.end < start || contact.start > end)
        continue;
      start = Math.min(start, contact.start);
      end = Math.max(end, contact.end);
      result.splice(index--, 1);
    }
    const indices = frames.flatMap((frame, index) =>
      frame.time >= start && frame.time <= end ? [index] : [],
    );
    if (!indices.length) continue;
    const first = indices[0];
    const anchor = frames[first].feet[support.foot];
    const drift = indices.map((index) => {
      const delta = frames[index].feet[support.foot]
        .clone()
        .sub(anchor)
        .sub(trajectory[index].center.clone().sub(trajectory[first].center));
      return Math.hypot(delta.x, delta.z);
    });
    result.push({
      side,
      start,
      end,
      approachDuration: Math.min(0.15, end - start),
      releaseDuration: Math.min(0.35, end - start),
      maxCorrection: T.MathUtils.clamp(
        Math.max(...drift) + legHeight * 0.02,
        legHeight * 0.1,
        legHeight * 0.4,
      ),
      samples: indices.map((index) => {
        const frame = frames[index],
          ankle = frame.feet[support.foot];
        const point = new T.Vector3(anchor.x, ankle.y, anchor.z);
        return {
          time: frame.time,
          point,
          ...(hasSoles
            ? {
                sole: frame.contactFeet[support.foot]
                  .clone()
                  .sub(ankle)
                  .add(point),
              }
            : {}),
        };
      }),
    });
  }
  return result.sort((a, b) => a.start - b.start);
}
