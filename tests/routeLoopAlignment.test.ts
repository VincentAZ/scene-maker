import { describe, expect, it } from "vitest";
import * as T from "three";
import { alignLoopHeading } from "../src/routeLoopAlignment";
import {
  routeLocomotionProfile,
  sampleRouteLocomotion,
  type LocomotionProfile,
} from "../src/locomotion";

describe("route loop alignment", () => {
  it.each([1, -1])(
    "closes a frame mismatch within an authored terminal turn (sign=%s)",
    (sign) => {
      const body = Array.from({ length: 601 }, (_, i) => {
        const time = i / 60;
        return {
          time,
          heading:
            sign *
            (time <= 6
              ? (time * 3.5) / 6
              : 3.5 + ((time - 6) * (2 * Math.PI - 3.5)) / 4),
        };
      });
      const trajectory = body.map(({ time }) => ({
        time,
        heading: sign * Math.min(time / 6, 1) * 4.5,
      }));
      const before = JSON.stringify([body, trajectory]);
      const aligned = alignLoopHeading(body, trajectory)!;
      expect(aligned).toBeDefined();
      expect(aligned.start).toBeGreaterThanOrEqual(6);
      expect(aligned.start).toBeLessThan(8);
      const endBody = body.at(-1)!.heading,
        endFrame = aligned.headings.at(-1)!;
      expect(
        Math.atan2(Math.sin(endBody - endFrame), Math.cos(endBody - endFrame)),
      ).toBeCloseTo(0, 10);
      for (let i = 0; i < body.length; i++) {
        if (body[i].time <= aligned.start)
          expect(aligned.headings[i]).toBe(trajectory[i].heading);
        if (i && body[i - 1].time >= aligned.start) {
          const authored = (body[i].heading - body[i - 1].heading) * sign;
          const offset = (aligned.headings[i] - aligned.headings[i - 1]) * sign;
          expect(offset).toBeGreaterThanOrEqual(-1e-12);
          expect(offset).toBeLessThanOrEqual(authored * 0.9 + 1e-12);
        }
      }
      expect(JSON.stringify([body, trajectory])).toBe(before);
    },
  );

  it("does not invent a pivot when the source has no suitable terminal turn", () => {
    const stationary = Array.from({ length: 121 }, (_, i) => ({
      time: i / 60,
      heading: 0,
    }));
    const frame = stationary.map(({ time }) => ({ time, heading: time * 0.8 }));
    expect(alignLoopHeading(stationary, frame)).toBeUndefined();
    expect(alignLoopHeading(stationary, stationary)).toBeUndefined();
  });

  it("does not remove turn already consumed by the trajectory frame", () => {
    const body = Array.from({ length: 601 }, (_, i) => ({
      time: i / 60,
      heading: Math.max(0, i / 60 - 6),
    }));
    // The terminal turn is large enough in source space, but not after the
    // existing trajectory rotation. Closing it would reverse the route pose.
    const trajectory = body.map(({ time, heading }) => ({
      time,
      heading: heading * 0.75,
    }));
    expect(alignLoopHeading(body, trajectory)).toBeUndefined();
  });

  it("selects loop alignment only for repeats without changing source cadence or travel", () => {
    const profile: LocomotionProfile = {
      distance: 2,
      duration: 2,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [0, 1, 2].map((time) => ({
        time,
        distance: time,
        center: new T.Vector3(0, 1, time),
        heading: 0,
      })),
    };
    const loop = {
      ...profile,
      frames: profile.frames.map((frame) => ({
        ...frame,
        heading: frame.time * 0.2,
      })),
    };
    expect(
      routeLocomotionProfile({ ...profile, loopProfile: loop }, 1),
    ).not.toBe(loop);
    expect(
      routeLocomotionProfile({ ...profile, loopProfile: loop }, 2),
    ).not.toBe(loop);
    expect(routeLocomotionProfile({ ...profile, loopProfile: loop }, 2.1)).toBe(
      loop,
    );
    for (const progress of [0.2, 0.6, 0.9, 0.2]) {
      const original = sampleRouteLocomotion(profile, 5, progress);
      const repeated = sampleRouteLocomotion(
        { ...profile, loopProfile: loop },
        5,
        progress,
      );
      expect(repeated.time).toBe(original.time);
      expect(repeated.travelled).toBe(original.travelled);
      expect(repeated.center.toArray()).toEqual(original.center.toArray());
    }
  });
});
