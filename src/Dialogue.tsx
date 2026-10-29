import { useEffect, useRef, useState } from "react";
import {
  LoaderCircle,
  MessageCircle,
  Play,
  Square,
  Pencil,
  Trash2,
} from "lucide-react";
import { allMotions, type Scene } from "../shared/scene";
import {
  dialogueAt,
  dialogueTiming,
  pathableClip,
} from "../shared/conversation";

export type CastProgressState = {
  name: string;
  characterId?: string;
  completed: number;
  total: number;
  stopping?: boolean;
};
export function CastProgress({
  progress,
  onStop,
}: {
  progress: CastProgressState;
  onStop: () => void;
}) {
  return (
    <div className="cast-progress">
      <LoaderCircle className="spin" size={17} />
      <span role="status">
        <strong>
          {progress.stopping
            ? "Stopping the conversation…"
            : progress.name
              ? `${progress.name} is finding their words…`
              : "Getting your cast ready…"}
        </strong>
        <small>
          {progress.completed} of {progress.total} turns complete
        </small>
      </span>
      <button
        className="text-button"
        onClick={onStop}
        disabled={progress.stopping}
        aria-label="Stop conversation"
      >
        <Square size={13} />
        Stop
      </button>
    </div>
  );
}
export function DialogueCaptions({
  scene,
  time,
}: {
  scene: Scene;
  time: number;
}) {
  const lines = dialogueAt(scene, time);
  if (!lines.length) return null;
  return (
    <div className="dialogue-captions" aria-label="Scene dialogue">
      {lines.map((line) => (
        <div key={`${line.characterId}:${line.clipId}`}>
          <strong>{line.name}</strong>
          <p>{line.text}</p>
        </div>
      ))}
    </div>
  );
}
export function DialogueTranscript({
  scene,
  onPreview,
  onPath,
  onRevise,
  disabled = false,
}: {
  scene: Scene;
  onPreview: (time: number) => void;
  onPath?: (characterId: string, clipId: string) => void;
  onRevise?: (index: number, text?: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scene.transcript.length]);
  return (
    <div className="conversation-transcript" aria-label="Cast dialogue">
      {scene.transcript.length ? (
        scene.transcript.map((line, index) => {
          const timing = dialogueTiming(scene, line);
          const ids = line.clipIds || (line.clipId ? [line.clipId] : []);
          const actions =
            scene.entities
              .find((e) => e.id === line.characterId)
              ?.clips.filter((c) => ids.includes(c.id)) || [];
          const pathable = pathableClip(scene, line);
          return (
            <div
              key={line.clipId ? `${line.characterId}:${line.clipId}` : index}
            >
              <div className="row spread">
                <strong>
                  {index + 1}. {line.name}
                </strong>
                <div className="dialogue-line-controls">
                  {timing && (
                    <button
                      className="text-button"
                      onClick={() => onPreview(timing.start)}
                      aria-label={`Preview ${line.name} at ${timing.start.toFixed(1)} seconds`}
                    >
                      <Play size={12} />
                      {timing.start.toFixed(1)}s
                    </button>
                  )}
                  {onRevise && (
                    <>
                      <button
                        className="icon-button"
                        disabled={disabled}
                        aria-label={`Edit line ${index + 1}`}
                        onClick={() => {
                          setEditing(index);
                          setText(line.text);
                          setError("");
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="icon-button"
                        disabled={disabled}
                        aria-label={`Remove line ${index + 1}, keep actions`}
                        title="Remove words; keep actions"
                        onClick={() => {
                          try {
                            onRevise(index);
                            setEditing(null);
                            setError("");
                          } catch (error) {
                            setError((error as Error).message);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editing === index ? (
                <form
                  className="dialogue-line-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    try {
                      onRevise?.(index, text);
                      setEditing(null);
                      setError("");
                    } catch (error) {
                      setError((error as Error).message);
                    }
                  }}
                >
                  <label>
                    Revise their words
                    <textarea
                      aria-label={`Line ${index + 1} words`}
                      rows={3}
                      maxLength={1800}
                      value={text}
                      onChange={(event) => setText(event.target.value)}
                      disabled={disabled}
                      required
                    />
                  </label>
                  <p className="small muted">
                    This keeps the action timing. Adjust durations in Details if
                    the line needs more time.
                  </p>
                  <div className="row">
                    <button
                      type="submit"
                      className="secondary"
                      disabled={disabled || !text.trim()}
                    >
                      Save words
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setEditing(null);
                        setError("");
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p>{line.text}</p>
              )}
              {actions.length > 0 && (
                <div className="dialogue-performance-summary">
                  {actions
                    .map((c) => {
                      const name =
                        allMotions(scene).find((m) => m.id === c.motionId)
                          ?.name || "Action";
                      const target = scene.entities.find(
                        (e) => e.id === c.targetId,
                      );
                      return name + (target ? ` · ${target.name}` : "");
                    })
                    .join(" → ")}
                </div>
              )}
              {onPath && pathable && (
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => onPath(line.characterId, pathable)}
                >
                  Draw a path for this line
                </button>
              )}
            </div>
          );
        })
      ) : (
        <div className="empty-state">
          <MessageCircle size={25} />
          <p>A good conversation can change the whole story.</p>
        </div>
      )}
      {error && (
        <p className="dialogue-error" role="alert">
          {error}
        </p>
      )}
      <div ref={end} className="transcript-end" />
    </div>
  );
}
