import { useState } from "react";
import type { Entity } from "../shared/scene";
export function ManualDialogue({
  cast,
  disabled,
  onSpeak,
}: {
  cast: Entity[];
  disabled: boolean;
  onSpeak: (id: string, text: string) => void;
}) {
  const [actor, setActor] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const id = cast.some((e) => e.id === actor) ? actor : cast[0]?.id;
  return (
    <details className="manual-dialogue">
      <summary>Write a line yourself</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onSpeak(id, text);
            setText("");
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label>
          Character
          <select
            value={id || ""}
            disabled={disabled}
            onChange={(e) => setActor(e.target.value)}
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
            maxLength={600}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            placeholder="What do they say next?"
          />
        </label>
        <button className="primary" disabled={disabled || !id || !text.trim()}>
          Say it in the scene
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
