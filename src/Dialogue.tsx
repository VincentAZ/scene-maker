import { useEffect, useRef } from "react";
import { LoaderCircle, MessageCircle, Play, Square } from "lucide-react";
import type { Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";

export type CastProgressState = {
  name: string;
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
}: {
  scene: Scene;
  onPreview: (time: number) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [scene.transcript.length]);
  return (
    <div className="conversation-transcript" aria-label="Cast dialogue">
      {scene.transcript.length ? (
        scene.transcript.map((line, index) => {
          const timing = dialogueTiming(scene, line);
          return (
            <div
              key={line.clipId ? `${line.characterId}:${line.clipId}` : index}
            >
              <div className="row spread">
                <strong>{line.name}</strong>
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
              </div>
              <p>{line.text}</p>
            </div>
          );
        })
      ) : (
        <div className="empty-state">
          <MessageCircle size={25} />
          <p>A good conversation can change the whole story.</p>
        </div>
      )}
      <div ref={end} className="transcript-end" />
    </div>
  );
}
