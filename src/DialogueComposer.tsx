import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { allAssets, allMotions, type Scene } from "../shared/scene";
import { type PerformanceAction, type Speech } from "../shared/conversation";
import { seatProfile } from "../shared/seating";
import { ladderProfile } from "../shared/ladder";
import { seatedRecording } from "../shared/motionLibrary";

export function DialogueComposer({
  scene,
  disabled,
  onAdd,
}: {
  scene: Scene;
  disabled: boolean;
  onAdd: (characterId: string, speech: Speech) => void;
}) {
  const cast = scene.entities.filter(
    (e) =>
      e.visible &&
      allAssets(scene).find((a) => a.id === e.assetId)?.category ===
        "characters",
  );
  const [characterId, setCharacterId] = useState("");
  const [dialogue, setDialogue] = useState("");
  const [performance, setPerformance] = useState<PerformanceAction[]>([
    { motionId: "talk" },
  ]);
  const [error, setError] = useState("");
  const selected = cast.some((e) => e.id === characterId)
    ? characterId
    : cast[0]?.id || "";
  const motions = allMotions(scene);
  const update = (index: number, next: PerformanceAction) =>
    setPerformance((items) =>
      items.map((item, i) => (i === index ? next : item)),
    );
  // Works without an AI connection: the line and its actions are appended to
  // the speaker's sequence the same way a generated turn is.
  return (
    <details className="manual-dialogue dialogue-composer">
      <summary>Write a line yourself</summary>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onAdd(selected, { dialogue, performance });
            setDialogue("");
            setPerformance([{ motionId: "talk" }]);
            setError("");
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <fieldset disabled={disabled || !cast.length}>
          <legend className="visually-hidden">Words and actions</legend>
          <label>
            Speaker
            <select
              value={selected}
              onChange={(event) => setCharacterId(event.target.value)}
            >
              {cast.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Their words
            <textarea
              rows={3}
              maxLength={1800}
              required
              value={dialogue}
              onChange={(event) => setDialogue(event.target.value)}
              placeholder="What do they say?"
            />
          </label>
          <div className="dialogue-performance">
            {performance.map((action, index) => {
              const motion = motions.find((m) => m.id === action.motionId);
              // A take performed seated may name its seat; left open, it
              // keeps the seat the speaker already sits on.
              const seatable = seatedRecording(motion);
              const targeted =
                motion &&
                (["pick", "sip", "place", "sit", "climb"].includes(
                  motion.role ?? "",
                ) ||
                  seatable);
              const props = scene.entities.filter((e) => {
                const asset = allAssets(scene).find((a) => a.id === e.assetId);
                return (
                  e.visible &&
                  asset?.category === "props" &&
                  ((motion?.role !== "sit" && !seatable) ||
                    seatProfile(asset)) &&
                  (motion?.role !== "climb" || ladderProfile(asset))
                );
              });
              return (
                <div className="dialogue-action" key={index}>
                  <label>
                    Action {index + 1}
                    <select
                      value={action.motionId}
                      onChange={(event) =>
                        update(index, { motionId: event.target.value })
                      }
                    >
                      {motions.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Seconds
                    <input
                      aria-label={`Line action ${index + 1} seconds`}
                      type="number"
                      min={0.2}
                      max={60}
                      step="any"
                      required
                      value={action.duration ?? motion?.duration ?? 4}
                      onChange={(event) =>
                        update(index, {
                          ...action,
                          duration: Number(event.target.value),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove line action ${index + 1}`}
                    disabled={performance.length === 1}
                    onClick={() =>
                      setPerformance((items) =>
                        items.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                  {targeted && (
                    <label className="dialogue-target">
                      Use prop
                      <select
                        aria-label={`Line action ${index + 1} prop`}
                        required={!seatable}
                        value={action.targetId || ""}
                        onChange={(event) =>
                          update(index, {
                            ...action,
                            targetId: event.target.value || undefined,
                          })
                        }
                      >
                        <option value="">
                          Choose a{" "}
                          {motion?.role === "sit" || seatable
                            ? "seat"
                            : motion?.role === "climb"
                              ? "ladder"
                              : "prop"}
                          …
                        </option>
                        {props.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={performance.length >= 4}
            onClick={() =>
              setPerformance((items) => [...items, { motionId: "talk" }])
            }
          >
            <Plus size={14} /> Add another action
          </button>
          <p className="small muted">
            Actions run in order after the current sequence. Captions cover this
            turn; extra Talk time is added when the words need it. Stage props
            within reach.
          </p>
          {error && (
            <p className="dialogue-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            className="primary"
            disabled={!selected || !dialogue.trim()}
          >
            Add line and actions
          </button>
        </fieldset>
      </form>
    </details>
  );
}
