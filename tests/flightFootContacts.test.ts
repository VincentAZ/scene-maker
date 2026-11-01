import * as T from "three";
import { expect, it } from "vitest";
import { flightFootContacts } from "../src/flightFootContacts";
import { scheduleRouteContacts } from "../src/routeContactSchedule";
import {
  routeSourceBoundaries,
  type LocomotionProfile,
} from "../src/locomotion";

it("pins the running ankle while preserving source sole roll and vertical motion", () => {
  const frames = Array.from({ length: 5 }, (_, i) => ({
    time: i / 10,
    feet: [new T.Vector3(i * 0.05, i * 0.01, i * 0.08), new T.Vector3(1, 0, 0)],
    contactFeet: [
      new T.Vector3(i * 0.05, i * 0.01 - 0.04, i * 0.08 + i * 0.02),
      new T.Vector3(1, -0.04, 0),
    ],
  }));
  const trajectory = frames.map(() => ({ center: new T.Vector3() }));
  const [contact] = flightFootContacts(
    [],
    [{ foot: 0, start: 0, end: 0.4 }],
    frames,
    trajectory,
    1,
    true,
  );
  expect(contact.maxCorrection).toBeGreaterThan(0.3);
  expect(contact.releaseDuration).toBe(0.35);
  expect(contact.approachDuration).toBe(0.15);
  contact.samples.forEach((sample, i) => {
    expect(sample.point.toArray()).toEqual([0, i * 0.01, 0]);
    expect(
      sample
        .sole!.clone()
        .sub(sample.point)
        .distanceTo(frames[i].contactFeet[0].clone().sub(frames[i].feet[0])),
    ).toBeLessThan(1e-10);
  });
  // An animation-only rig retains the same ankle schedule without claiming soles.
  expect(
    flightFootContacts(
      [],
      [{ foot: 0, start: 0, end: 0.4 }],
      frames,
      trajectory,
      1,
      false,
    )[0].samples.every((s) => s.sole === undefined),
  ).toBe(true);
});

it("keeps preparation and release separate across short gaps and loop seams", () => {
  const contact = (start: number, end: number) => ({
    side: "left" as const,
    start,
    end,
    approachDuration: 0.15,
    releaseDuration: 0.2,
    samples: [start, end].map((time) => ({ time, point: new T.Vector3() })),
  });
  const schedule = scheduleRouteContacts(
    [contact(0.05, 0.2), contact(0.35, 0.5)],
    1,
    ["left"],
  );
  expect(schedule[0].approachStart).toBeCloseTo(-0.1, 8);
  expect(schedule[1].approachStart).toBeGreaterThan(0.2);
  expect(schedule[1].approachStart).toBeLessThan(0.35);
  expect(schedule[0].releaseEnd).toBeLessThanOrEqual(schedule[1].approachStart);
  expect(schedule[1].releaseEnd).toBeLessThanOrEqual(
    schedule[0].approachStart + 1,
  );
  const [joined] = scheduleRouteContacts(
    [contact(0, 0.1), contact(0.9, 1)],
    1,
    ["left"],
  );
  expect(joined.approachStart).toBeCloseTo(0.75, 8);
  const profile: LocomotionProfile = {
    duration: 1,
    distance: 1,
    startHeading: 0,
    mode: "travel",
    warning: "",
    frames: [0, 1].map((time) => ({
      time,
      distance: time,
      center: new T.Vector3(),
      heading: 0,
    })),
    contacts: [contact(0.05, 0.2)],
    contactLoopSides: ["left"],
  };
  const boundaries = routeSourceBoundaries(profile, [], 2, 2);
  expect(boundaries.some((time) => Math.abs(time - 0.9) < 1e-8)).toBe(true);
  expect(boundaries.some((time) => Math.abs(time - 1.9) < 1e-8)).toBe(true);
});

it("releases a short running support in its own cadence and combines seam fragments", () => {
  const contact = (start: number, end: number) => ({
    side: "left" as const,
    start,
    end,
    releaseDuration: end - start,
    samples: [
      { time: start, point: new T.Vector3() },
      { time: end, point: new T.Vector3() },
    ],
  });
  const [short] = scheduleRouteContacts([contact(0.2, 0.32)], 1, ["left"]);
  expect(short.releaseEnd).toBeCloseTo(0.44, 8);
  const [joined] = scheduleRouteContacts(
    [contact(0, 0.02), contact(0.92, 1)],
    1,
    ["left"],
  );
  expect(joined.contact.releaseDuration).toBeCloseTo(0.1, 8);
  expect(joined.releaseEnd).toBeCloseTo(1.12, 8);
});

it("carries bounded running correction across joined cyclic contacts", () => {
  const contact = (start: number, end: number, maxCorrection: number) => ({
    side: "left" as const,
    start,
    end,
    maxCorrection,
    samples: [
      { time: start, point: new T.Vector3() },
      { time: end, point: new T.Vector3() },
    ],
  });
  const [joined] = scheduleRouteContacts(
    [contact(0, 0.2, 0.15), contact(0.8, 1, 0.3)],
    1,
    ["left"],
  );
  expect(joined.contact.maxCorrection).toBe(0.3);
  expect(joined.contact.start).toBe(0.8);
  expect(joined.contact.end).toBe(1.2);
});
