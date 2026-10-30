import { useEffect, useState } from "react";
import type { Entity, Motion } from "../shared/scene";
import {
  clipPlaybackRate,
  clipTimingDescription,
  MIN_PLAYBACK_RATE,
  MAX_PLAYBACK_RATE,
} from "../shared/clipTiming";

type Clip = Entity["clips"][number];

/** Imported timing is intentionally separate from procedural action duration. */
export function ImportedClipTiming({
  clip,
  motion,
  index,
  onChange,
}: {
  clip: Clip;
  motion: Motion;
  index: number;
  onChange: (changes: Pick<Clip, "playbackRate" | "legacyFit">) => void;
}) {
  const rate = clipPlaybackRate(clip, motion.duration);
  const [draftRate, setDraftRate] = useState(String(rate));
  useEffect(() => setDraftRate(String(rate)), [rate, clip.id]);
  if (motion.path)
    return (
      <p className="muted small">
        Distance-paced imported gait. Route duration sets travel speed and gait
        cadence together; it does not fit the whole source take into the slot. A
        seamless walking/running cycle minimizes foot sliding.
      </p>
    );
  const legacy = clip.legacyFit || clip.playbackRate === undefined;
  return (
    <>
      <label className="clip-transition">
        Playback speed
        <input
          aria-label={`Action ${index + 1} playback speed`}
          title="Source seconds per timeline second. 1× is native speed."
          type="number"
          min={MIN_PLAYBACK_RATE}
          max={MAX_PLAYBACK_RATE}
          step="any"
          value={draftRate}
          onBlur={() => setDraftRate(String(rate))}
          onChange={(event) => {
            setDraftRate(event.target.value);
            const playbackRate = Number(event.target.value);
            if (
              Number.isFinite(playbackRate) &&
              playbackRate >= MIN_PLAYBACK_RATE &&
              playbackRate <= MAX_PLAYBACK_RATE
            )
              onChange({ playbackRate, legacyFit: undefined });
          }}
        />
        <span>×</span>
      </label>
      <p className="muted small">
        Source: {Number(motion.duration.toFixed(2))}s.{" "}
        {clipTimingDescription(clip, motion.duration)} Duration trims or holds;
        it never changes speed.
      </p>
      {legacy && (
        <p className="muted small" role="status">
          Legacy fit preserved at {Number(rate.toFixed(4))}×. This older clip
          was stretched to its duration. Its speed is now fixed explicitly.
        </p>
      )}
      {(legacy || rate !== 1) && (
        <button
          className="text-button"
          aria-label={`Use native speed for action ${index + 1}`}
          onClick={() => onChange({ playbackRate: 1, legacyFit: undefined })}
        >
          Use native 1×
        </button>
      )}
    </>
  );
}
