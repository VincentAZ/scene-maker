import { expect, it } from "vitest";
import { createPlaybackTransport } from "../src/playbackTransport";

function transport() {
  const applied: boolean[] = [];
  const t = createPlaybackTransport((playing) => applied.push(playing));
  return { t, applied };
}

it("resumes once a plan that interrupted playback settles", () => {
  const { t, applied } = transport();
  t.setPlaying(true);
  t.pauseForPlanning();
  expect(t.playing).toBe(false);
  expect(t.resumePending).toBe(true);
  t.planningSettled();
  expect(t.playing).toBe(true);
  expect(t.resumePending).toBe(false);
  // Settling again (a later unrelated plan) does nothing more.
  t.planningSettled();
  expect(applied).toEqual([true, false, true]);
});

it("never starts playback that was not running when planning began", () => {
  const { t, applied } = transport();
  t.pauseForPlanning();
  t.planningSettled();
  expect(t.playing).toBe(false);
  expect(applied).toEqual([false]);
});

it("drops the queued resume on an explicit pause, stop or rewind during planning", () => {
  for (const explicit of [
    (t: ReturnType<typeof createPlaybackTransport>) => t.setPlaying(false),
    (t: ReturnType<typeof createPlaybackTransport>) =>
      t.setPlaying((current) => !current && false),
  ]) {
    const { t } = transport();
    t.setPlaying(true);
    t.pauseForPlanning();
    explicit(t);
    t.planningSettled();
    expect(t.playing).toBe(false);
    expect(t.resumePending).toBe(false);
  }
});

it("honours a Play request made while planning exactly once", () => {
  const { t, applied } = transport();
  t.setPlaying(true);
  t.pauseForPlanning();
  // The creator presses Play again while the plan is still running.
  t.setPlaying(true);
  expect(t.resumePending).toBe(false);
  // The viewport pauses that playback again because the job is unfinished.
  t.pauseForPlanning();
  expect(t.resumePending).toBe(true);
  t.planningSettled();
  expect(t.playing).toBe(true);
  t.planningSettled();
  expect(applied).toEqual([true, false, true, false, true]);
});

it("leaves playback to a running cast conversation and to a project switch", () => {
  const { t } = transport();
  t.setPlaying(true);
  t.pauseForPlanning();
  t.planningSettled(true);
  expect(t.playing).toBe(false);
  expect(t.resumePending).toBe(true);
  // The conversation ends or another project loads: nothing restarts.
  t.cancelResume();
  t.planningSettled();
  expect(t.playing).toBe(false);
  const { t: switched } = transport();
  switched.setPlaying(true);
  switched.pauseForPlanning();
  switched.setPlaying(false); // loadScene stops the transport explicitly
  switched.planningSettled();
  expect(switched.playing).toBe(false);
});
