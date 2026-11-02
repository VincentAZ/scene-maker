import { expect, it, vi } from "vitest";
import { createPlaybackClock } from "../src/playbackClock";

function clock() {
  const c = createPlaybackClock(0, 0),
    onState = vi.fn(),
    onEnded = vi.fn();
  const frame = {
    now: 0,
    time: 0,
    seekVersion: 0,
    playing: true,
    blocked: false,
    duration: 100,
    onState,
    onEnded,
  };
  const tick = (
    now: number,
    changes: Partial<typeof frame> & {
      stopAtEnd?: boolean;
      advance?: (t: number, dt: number) => number;
    } = {},
  ) => {
    Object.assign(frame, changes, { now });
    const sample = c.sample(frame);
    if (sample.publish) frame.time = sample.time;
    return sample.time;
  };
  return { frame, tick, onState, onEnded };
}
it.each([1000 / 60, 1000 / 15, 200, 500])(
  "keeps native pace at a %s ms render cadence",
  (interval) => {
    const f = clock();
    f.tick(0);
    for (let t = interval; t < 6000; t += interval) f.tick(t);
    expect(f.tick(6000)).toBeCloseTo(6, 10);
  },
);
it("preserves loop remainder after irregular frames and multiple missed loops", () => {
  const f = clock();
  f.tick(0, { duration: 2.3 });
  for (const t of [16, 49, 270, 1001, 2310, 5290, 12345])
    expect(f.tick(t)).toBeCloseTo((t / 1000) % 2.3, 10);
});
it("does not accumulate paused, planning or drag time, and honors seeks to a previously published value", () => {
  const f = clock();
  f.tick(0);
  f.tick(200);
  f.tick(400);
  // An arbitrarily delayed React echo cannot rewind the evaluated frame.
  expect(f.tick(500, { playing: false, time: 0.2 })).toBe(0.4);
  expect(f.tick(5000)).toBe(0.4);
  expect(f.tick(6000, { playing: true })).toBe(0.4);
  expect(f.tick(6300)).toBeCloseTo(0.7);
  expect(f.tick(6500, { blocked: true })).toBeCloseTo(0.7);
  expect(f.tick(20000)).toBeCloseTo(0.7);
  expect(f.tick(21000, { blocked: false })).toBeCloseTo(0.7);
  expect(f.tick(21200)).toBeCloseTo(0.9);
  expect(f.tick(21300, { time: 0.2, seekVersion: 1 })).toBe(0.2);
  expect(f.tick(21500)).toBeCloseTo(0.4);
  expect(f.tick(22000, { playing: false, time: 0, seekVersion: 2 })).toBe(0);
  expect(f.tick(23000, { playing: true })).toBe(0);
  expect(f.tick(23200)).toBeCloseTo(0.2);
  expect(f.onState.mock.calls.map(([s]) => s)).toEqual([
    "play",
    "pause",
    "play",
    "pause",
    "play",
    "seek",
    "seek",
    "pause",
    "play",
  ]);
});
it("holds an exact ending once and allows an explicit replay", () => {
  const f = clock();
  f.tick(0, { duration: 1, stopAtEnd: true });
  expect(f.tick(2700)).toBe(1);
  expect(f.tick(3200)).toBe(1);
  expect(f.onEnded).toHaveBeenCalledTimes(1);
  expect(f.tick(3400, { seekVersion: 1, time: 0 })).toBe(0);
  expect(f.tick(4800)).toBe(1);
  expect(f.onEnded).toHaveBeenCalledTimes(2);
});
it("notifies the transport before advancing and keeps its deliberate audio holds", () => {
  const f = clock();
  let started = false;
  f.frame.onState = vi.fn(() => {
    started = true;
  });
  const advance = vi.fn((t: number, dt: number) => {
    expect(started).toBe(true);
    return dt < 1 ? t : t + 0.25;
  });
  f.tick(0, { advance });
  expect(f.tick(200)).toBe(0);
  expect(f.tick(2200)).toBe(0.25);
  expect(advance.mock.calls.at(-1)).toEqual([0, 2]);
});
