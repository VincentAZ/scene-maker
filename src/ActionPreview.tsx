import { usePlayhead } from "./usePlayhead";
import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, RotateCcw, Plus } from "lucide-react";
import { resolveMotionSource, type Scene, type Motion } from "../shared/scene";
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
  const [seatScale, setSeatScale] = useState<number>();
  const [view, setView] = useState<"character" | "original">("character");
  const source =
    motion.kind === "imported" && !motion.path
      ? resolveMotionSource(scene, motion.sourceAssetId)
      : undefined;
  const recipient = scene.entities.find(
    (entity) => entity.id === actorId,
  )?.name;
  const rehearsal = useMemo(
    () => actionPreview(scene, motion, actorId, seatScale, view),
    [scene, motion, actorId, seatScale, view],
  );
  const viewport = useRef<ViewportHandle>(null);
  const {
    time,
    seekVersion,
    seek: setTime,
    publish: publishTime,
  } = usePlayhead();
  const [playing, setPlaying] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [warning, setWarning] = useState("");
  useEffect(() => {
    setReady(false);
    setWarning("");
    setError("");
    let cancelled = false;
    const controller = new AbortController();
    void viewport
      .current!.waitForScene(rehearsal.scene, controller.signal)
      .then(() => {
        if (cancelled) return;
        if (["sit", "stand"].includes(motion.kind) && seatScale === undefined) {
          const body = viewport.current!.seatingBody(rehearsal.actor.id);
          if (body) {
            setSeatScale(
              Math.max(
                0.2,
                Math.min(10, (body.lowerLength / 0.38) * rehearsal.actor.scale),
              ),
            );
            return;
          }
        }
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
  }, [rehearsal, motion.kind, seatScale]);
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
        {source?.url && (
          <div role="group" aria-label="Compare animation performance">
            {(["character", "original"] as const).map((option) => (
              <button
                key={option}
                className="secondary"
                aria-pressed={view === option}
                onClick={() => {
                  setPlaying(false);
                  setView(option);
                }}
              >
                {option === "original"
                  ? "Original performance"
                  : `On ${recipient || "sample character"}`}
              </button>
            ))}
            <p className="muted small">
              {view === "original"
                ? `Original take on ${source.name}, at 1×. No transfer to another character.`
                : `Same take on ${recipient || "the sample character"}, at 1×.`}
            </p>
          </div>
        )}
        <div className="action-preview-stage">
          <Viewport
            ref={viewport}
            scene={rehearsal.scene}
            selected={null}
            onSelect={ignore}
            time={time}
            playing={playing}
            onTime={publishTime}
            seekVersion={seekVersion}
            onMove={ignore}
            onError={setError}
            onInteractionWarning={setWarning}
            move={false}
            loopDuration={rehearsal.total}
            followActorId={rehearsal.actor.id}
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
        {warning && ready && (
          <p className="small" role="status">
            {warning}
          </p>
        )}
        <p className="muted small">
          A separate rehearsal with{" "}
          {view === "original" || actorId
            ? rehearsal.actor.name
            : "a sample performer"}
          . Your scene stays as it is. Drag to orbit.
          {["sit", "stand"].includes(motion.kind)
            ? " The rehearsal bench is sized for this performer. Choose the scene’s seat in Details after adding Sit down."
            : ""}
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
              ? `Add to ${recipient || rehearsal.actor.name}`
              : "Choose a character to add this"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
