import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { SceneRecorder } from "./sceneRecorder";

export type RecordingStatus = "idle" | "recording" | "saving";

const clock = (seconds: number) => {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Camera-style record control: a red dot when idle; a blinking REC pill with
 * the recorded length while capturing (steady while the take waits for the
 * scene to move); a progress pill while the MP4 is saved.
 */
export function RecordButton({
  status,
  recorder,
  disabled,
  onStart,
  onStop,
  label = "Record scene as MP4",
}: {
  status: RecordingStatus;
  recorder: SceneRecorder | null;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
  label?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== "recording") return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [status]);
  if (status === "saving")
    return (
      <button className="record-button saving" disabled title="Saving MP4…">
        <LoaderCircle size={13} className="spin" />
        <span>Saving MP4…</span>
      </button>
    );
  if (status === "recording") {
    const state = recorder?.state ?? "waiting";
    const live = state === "recording";
    return (
      <button
        className={`record-button recording${live ? "" : " held"}`}
        aria-label="Stop recording and save the MP4"
        title={
          live
            ? "Recording. Click to stop and save the MP4."
            : "Waiting for the scene to play. Click to stop and save."
        }
        onClick={onStop}
      >
        <span className="record-dot" aria-hidden="true" />
        <span className="record-text">
          REC {clock(recorder?.seconds ?? 0)}
          {!live && <em>{state === "waiting" ? " · ready" : " · waiting"}</em>}
        </span>
        <span className="record-stop" aria-hidden="true" />
      </button>
    );
  }
  return (
    <button
      className="record-button idle"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onStart}
    >
      <span className="record-dot" aria-hidden="true" />
    </button>
  );
}
