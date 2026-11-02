export type PlaybackState = "seek" | "pause" | "play";
type Frame = {
  now: number;
  time: number;
  seekVersion: number;
  playing: boolean;
  blocked: boolean;
  duration: number;
  stopAtEnd?: boolean;
  advance?: (time: number, delta: number) => number;
  onState?: (state: PlaybackState) => void;
  onEnded?: () => void;
};

/** Scene time follows elapsed wall time, independently of render cadence.
 * An audio transport may explicitly hold/retime it. Published React values are
 * acknowledgements, not seeks; pausing must not rewind to a delayed echo. */
export function createPlaybackClock(
  time: number,
  now: number,
  seekVersion = 0,
) {
  let elapsed = time,
    previous = now,
    wasPlaying = false,
    wasAdvancing = false,
    lastSent = -Infinity,
    ended = false;
  return {
    sample(frame: Frame) {
      const seek = frame.seekVersion !== seekVersion;
      if (seek) {
        elapsed = frame.time;
        seekVersion = frame.seekVersion;
        ended = false;
        frame.onState?.("seek");
      }
      const changed = frame.playing !== wasPlaying;
      const advancing = frame.playing && !frame.blocked;
      if (advancing !== wasAdvancing)
        frame.onState?.(advancing ? "play" : "pause");
      if (advancing) {
        // Neither a pause/drag nor a seek contributes time to the next take.
        const delta =
          wasAdvancing && !seek
            ? Math.max(0, (frame.now - previous) / 1000)
            : 0;
        elapsed = frame.advance?.(elapsed, delta) ?? elapsed + delta;
        const total = Math.max(0, frame.duration);
        if (frame.stopAtEnd && elapsed >= total) {
          elapsed = total;
          if (!ended) {
            ended = true;
            frame.onEnded?.();
          }
        } else {
          ended = false;
          if (total > 0 && elapsed > total) elapsed %= total;
        }
      }
      previous = frame.now;
      const publish =
        seek ||
        changed ||
        (advancing && frame.now - lastSent > 40) ||
        (wasAdvancing && !advancing);
      if (publish) {
        lastSent = frame.now;
      }
      wasPlaying = frame.playing;
      wasAdvancing = advancing;
      return { time: elapsed, publish, seekVersion };
    },
  };
}
