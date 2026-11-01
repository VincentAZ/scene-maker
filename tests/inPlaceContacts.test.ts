import * as T from "three";
import { expect, it } from "vitest";
import {
  detectInPlaceContacts,
  type InPlaceSupportFrame,
} from "../src/inPlaceContacts";
import { detectFootContacts } from "../src/routeContacts";

function steps(scale = 1): InPlaceSupportFrame[] {
  return Array.from({ length: 121 }, (_, i) => {
    const time = i / 60;
    const side =
      time >= 0.2 && time <= 0.6 ? 0 : time >= 1 && time <= 1.5 ? 1 : -1;
    const heights = [0, 1].map((foot) =>
      side === foot ? 0 : side < 0 ? 0.05 * scale : 0.3 * scale,
    ) as [number, number];
    const feet = heights.map(
      (height, foot) =>
        new T.Vector3(
          (foot * 0.2 + 0.08 * time) * scale,
          height + 0.1 * scale,
          0,
        ),
    );
    return {
      time,
      feet,
      heights,
      backwardSpeeds: [1.1 * scale, 1.2 * scale],
      contactFeet: feet.map((foot) =>
        foot.clone().add(new T.Vector3(0, -0.1 * scale, 0.02 * scale)),
      ),
    };
  });
}

it.each([0.1, 1, 4])(
  "retains authored sway and sole points in alternating grounded steps at scale %s",
  (scale) => {
    const frames = steps(scale);
    const saved = frames.map((frame) =>
      frame.feet.map((foot) => foot.toArray()),
    );
    expect(detectFootContacts(frames, scale)).toEqual([]);
    const contacts = detectInPlaceContacts(frames, scale, []);
    expect(
      contacts.map(({ side, start, end }) => ({ side, start, end })),
    ).toEqual([
      { side: "left", start: 0.2, end: 0.6 },
      { side: "right", start: 1, end: 1.5 },
    ]);
    for (const contact of contacts) {
      const side = contact.side === "left" ? 0 : 1;
      expect(
        contact.samples.at(-1)!.point.x - contact.samples[0].point.x,
      ).toBeGreaterThan(0.03 * scale);
      for (const sample of contact.samples) {
        const original = frames.find((frame) => frame.time === sample.time)!;
        expect(sample.point.equals(original.feet[side])).toBe(true);
        expect(sample.sole!.equals(original.contactFeet![side])).toBe(true);
        expect(sample.point).not.toBe(original.feet[side]);
      }
    }
    expect(
      frames.map((frame) => frame.feet.map((foot) => foot.toArray())),
    ).toEqual(saved);
  },
);

it("requires actual ground, backward travel and alternating support", () => {
  const frames = steps();
  const variants = [
    frames.map(({ heights: _, ...frame }) => frame),
    frames.map((frame) => ({
      ...frame,
      heights: [0.3, 0.3] as [number, number],
    })),
    frames.map((frame) => ({
      ...frame,
      heights: [-0.3, -0.3] as [number, number],
    })),
    frames.map((frame) => ({ ...frame, heights: [0, 0] as [number, number] })),
    frames.map((frame) => ({
      ...frame,
      backwardSpeeds: [0, 0] as [number, number],
    })),
    frames.map((frame) => ({
      ...frame,
      backwardSpeeds: [-1, -1] as [number, number],
    })),
    frames.filter((frame) => frame.time < 0.8),
  ];
  for (const variant of variants)
    expect(detectInPlaceContacts(variant, 1, [])).toEqual([]);
});

it("does not replace an existing overlapping measured contact", () => {
  const frames = steps();
  const existing = {
    side: "left" as const,
    start: 0.3,
    end: 0.7,
    samples: [{ time: 0.3, point: new T.Vector3(0.1, 0.1, 0) }],
  };
  const contacts = detectInPlaceContacts(frames, 1, [existing]);
  expect(contacts.filter((contact) => contact.side === "left")).toEqual([
    existing,
  ]);
  expect(contacts.find((contact) => contact.side === "left")).toBe(existing);
  expect(contacts.some((contact) => contact.side === "right")).toBe(true);
  expect(detectInPlaceContacts(frames, 1, contacts)).toBe(contacts);
});
