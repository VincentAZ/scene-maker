import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { libraryEntries } from "../shared/characterLibrary";
import {
  characterDraft,
  supportsGlasses,
  supportsHair,
} from "../shared/characterDesign";
import { assetSchema, type Asset } from "../shared/scene";
import { api } from "./api";
import { Modal } from "./Modal";

export function CharacterCreator({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (asset: Asset) => void;
}) {
  const [draft, setDraft] = useState(() =>
      characterDraft(libraryEntries[0].id),
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const entry = libraryEntries.find(
    (look) => look.id === draft.design!.baseId,
  )!;
  const close = () => {
    controller.current?.abort();
    onClose();
  };
  const design = draft.design!;
  const changeDesign = (changes: Partial<typeof design>) =>
    setDraft((current) => ({
      ...current,
      design: { ...current.design!, ...changes },
    }));
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    try {
      const result = await api<Asset>("/api/characters", {
        method: "POST",
        signal: request.signal,
        body: JSON.stringify({ ...draft, name: draft.name.trim() }),
      });
      if (!request.signal.aborted) onCreate(assetSchema.parse(result));
    } catch (error) {
      if (!request.signal.aborted) setError((error as Error).message);
    } finally {
      if (!request.signal.aborted) setBusy(false);
      if (controller.current === request) controller.current = null;
    }
  }
  return (
    <Modal
      title="A character of your own"
      onClose={close}
      error={error}
      onDismissError={() => setError("")}
      wide
    >
      <form className="character-maker" onSubmit={create}>
        <div className="character-maker-look">
          <span className="eyebrow">YOUR STARTING LOOK</span>
          <img
            src={entry.thumbnail}
            alt={`${entry.name}, ${entry.style} starting look`}
          />
          <strong>{entry.style}</strong>
          <p>Your colors and details will appear on the finished character.</p>
        </div>
        <fieldset disabled={busy} className="character-maker-fields">
          <label>
            Character name
            <input
              required
              maxLength={100}
              value={draft.name}
              onChange={(e) =>
                setDraft((current) => ({ ...current, name: e.target.value }))
              }
              autoFocus
            />
          </label>
          <label>
            Start with a look
            <select
              value={design.baseId}
              onChange={(e) => {
                const next = characterDraft(e.target.value, draft.name);
                setDraft({
                  ...next,
                  id: draft.id,
                  color: draft.color,
                  design: {
                    ...design,
                    baseId: e.target.value,
                    glasses: supportsGlasses(e.target.value) && design.glasses,
                  },
                });
              }}
            >
              {libraryEntries.map((look) => (
                <option key={look.id} value={look.id}>
                  {look.style} · {look.name}
                </option>
              ))}
            </select>
          </label>
          <div className="character-palette">
            <label>
              Outfit
              <input
                type="color"
                value={draft.color}
                onInput={(e) => {
                  const color = e.currentTarget.value;
                  setDraft((current) => ({ ...current, color }));
                }}
              />
            </label>
            <label>
              Skin
              <input
                type="color"
                value={draft.skin}
                onInput={(e) => {
                  const skin = e.currentTarget.value;
                  setDraft((current) => ({ ...current, skin }));
                }}
              />
            </label>
            <label>
              {supportsHair(design.baseId) ? "Hair" : "No hair"}
              <input
                type="color"
                disabled={!supportsHair(design.baseId)}
                value={design.hairColor}
                onInput={(e) =>
                  changeDesign({ hairColor: e.currentTarget.value })
                }
              />
            </label>
            <label>
              Accent
              <input
                type="color"
                value={design.accentColor}
                onInput={(e) =>
                  changeDesign({ accentColor: e.currentTarget.value })
                }
              />
            </label>
          </div>
          <div className="character-wearables">
            <label>
              <input
                type="checkbox"
                checked={design.glasses}
                disabled={!supportsGlasses(design.baseId)}
                onChange={(e) => changeDesign({ glasses: e.target.checked })}
              />
              <span>
                Round glasses
                <small>
                  {supportsGlasses(design.baseId)
                    ? "A little extra personality"
                    : "This look has a closed helmet"}
                </small>
              </span>
            </label>
            <label>
              <input
                type="checkbox"
                checked={design.backpack}
                onChange={(e) => changeDesign({ backpack: e.target.checked })}
              />
              <span>
                Backpack<small>Ready for their next adventure</small>
              </span>
            </label>
          </div>
        </fieldset>
        <footer className="character-maker-footer">
          <span role="status">
            {busy
              ? "Making your character and its preview…"
              : "Ready to move, act, and join your cast."}
          </span>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={busy || !draft.name.trim()}
            type="submit"
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {busy ? "Creating…" : "Create character"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
