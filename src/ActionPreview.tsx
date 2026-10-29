import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Plus } from "lucide-react";
import type { Scene, Motion } from "../shared/scene";
import { actionPreview } from "../shared/actionPreview";
import { motionDetails } from "../shared/motionLibrary";
import { Viewport, type ViewportHandle } from "./Viewport";
import { Modal } from "./Modal";
const ignore = () => {};
export function ActionPreview({
  scene,
  motion,
  actorId,
  onClose,
  onAdd,
}: {
  scene: Scene;
  motion: Motion;
  actorId?: string;
  onClose: () => void;
  onAdd?: () => void;
}) {
  const rehearsal = useMemo(
    () => actionPreview(scene, motion, actorId),
    [scene, motion, actorId],
  );
  const viewport = useRef<ViewportHandle>(null);
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [warning, setWarning] = useState("");
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void viewport
      .current!.waitForScene(rehearsal.scene, controller.signal)
      .then(() => {
        if (cancelled) return;
        viewport.current!.frame("default", rehearsal.actor.id);
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled) setError(error.message);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [rehearsal]);
  const details = motionDetails(motion);
  return (
    <Modal
      title={motion.name}
      wide
      onClose={onClose}
      error={error}
      onDismissError={() => setError("")}
    >
      <div className="action-preview-body">
        <p className="muted small">{details.description}</p>
        <div className="action-preview-stage">
          <Viewport
            ref={viewport}
            scene={rehearsal.scene}
            selected={null}
            onSelect={ignore}
            time={time}
            playing={playing}
            onTime={setTime}
            onMove={ignore}
            onError={setError}
            onInteractionWarning={setWarning}
            move={false}
            loopDuration={rehearsal.total}
          />
          {!ready && !error && (
            <span className="preview-loading" role="status">
              Preparing the rehearsal…
            </span>
          )}
        </div>
        <div className="action-preview-controls">
          <button
            className="secondary"
            aria-label={
              playing ? "Pause action preview" : "Play action preview"
            }
            disabled={!ready || !!error}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
          <button
            className="icon-button"
            aria-label="Restart action preview"
            onClick={() => {
              setPlaying(false);
              setTime(0);
            }}
          >
            <RotateCcw size={16} />
          </button>
          <input
            aria-label="Action preview time"
            type="range"
            min="0"
            max={rehearsal.total}
            step=".01"
            value={time}
            onChange={(event) => {
              setPlaying(false);
              setTime(Number(event.target.value));
            }}
          />
          <span>
            {time.toFixed(1)} / {rehearsal.total.toFixed(1)}s
          </span>
        </div>
        {warning && (
          <p className="small" role="status">
            {warning}
          </p>
        )}
        <p className="muted small">
          A separate rehearsal with{" "}
          {actorId ? rehearsal.actor.name : "a sample performer"}. Your scene
          stays as it is. Drag to orbit.
          {motion.kind === "place"
            ? " This preview picks up the cup before putting it down."
            : ""}
        </p>
        <div className="action-preview-footer">
          <button className="secondary" onClick={onClose}>
            Back to the library
          </button>
          <button
            className="primary"
            disabled={!onAdd || !ready || !!error}
            onClick={onAdd}
          >
            <Plus size={15} />
            {onAdd
              ? `Add to ${rehearsal.actor.name}`
              : "Choose a character to add this"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
