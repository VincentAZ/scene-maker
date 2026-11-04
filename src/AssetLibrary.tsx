import { useMemo, useState, type PointerEvent } from "react";
import { Check, Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import type { Asset } from "../shared/scene";
import { AssetArt } from "./AssetArt";
import { Modal } from "./Modal";
import { assetSorts, queryAssets, type AssetSort } from "./assetLibrary";
import { useHiddenItems } from "./hiddenItems";

/** Characters, props or sets: sorted several ways, filtered to what the scene
 * uses, hidden per browser, and the creator's own imports deleted from their
 * library (projects that already use one keep it). */
export function AssetLibrary({
  assets,
  noun,
  mine,
  usage,
  dependents,
  subtitle,
  onAdd,
  onDragStart,
  onDelete,
}: {
  assets: Asset[];
  /** Plural, lower case: "characters", "props" or "sets". */
  noun: string;
  mine: ReadonlySet<string>;
  usage: ReadonlyMap<string, number>;
  /** What else goes with these assets in this scene. */
  dependents: (ids: string[]) => { actors: number; actions: number };
  subtitle: (asset: Asset) => string;
  onAdd: (asset: Asset) => void;
  onDragStart: (asset: Asset, event: PointerEvent) => void;
  onDelete: (ids: string[]) => void;
}) {
  const [sort, setSort] = useState<AssetSort>("collection"),
    [usedOnly, setUsedOnly] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [confirm, setConfirm] = useState<string[] | null>(null),
    [hidden, toggleHidden] = useHiddenItems("scene-maker-hidden-assets");
  const items = useMemo(
    () =>
      queryAssets(assets, { sort, usedOnly, showHidden, hidden, mine, usage }),
    [assets, sort, usedOnly, showHidden, hidden, mine, usage],
  );
  const hiddenCount = assets.filter((a) => hidden.has(a.id)).length;
  const chosen = items.filter((a) => selected.has(a.id)).map((a) => a.id);
  const chosenMine = chosen.filter((id) => mine.has(id));
  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const name = (id: string) => assets.find((a) => a.id === id)?.name ?? id;
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  const consequence = (ids: string[]) => {
    const { actors, actions } = dependents(ids);
    const parts = [
      actors && `${plural(actors, "object")} placed in this scene`,
      actions && `${plural(actions, "action")} recorded on it`,
    ].filter(Boolean);
    return parts.length
      ? `${parts.join(" and ")} will be removed too.`
      : "Nothing in this scene uses it.";
  };
  return (
    <div className="asset-library">
      <div className="action-controls asset-controls">
        <select
          aria-label={`Sort ${noun}`}
          value={sort}
          onChange={(e) => setSort(e.target.value as AssetSort)}
        >
          {assetSorts.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="action-toggles">
        <label>
          <input
            type="checkbox"
            checked={usedOnly}
            onChange={(e) => setUsedOnly(e.target.checked)}
          />
          In this scene
        </label>
        {hiddenCount > 0 && (
          <label>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden ({hiddenCount})
          </label>
        )}
        <button
          className="text-button"
          aria-pressed={selecting}
          onClick={() => {
            setSelecting(!selecting);
            setSelected(new Set());
          }}
        >
          {selecting ? "Done" : "Select"}
        </button>
      </div>
      {selecting && (
        <div
          className="action-bulk"
          role="toolbar"
          aria-label={`Selected ${noun}`}
        >
          <span>{chosen.length} selected</span>
          <button
            className="text-button"
            onClick={() => setSelected(new Set(items.map((a) => a.id)))}
          >
            All
          </button>
          <button
            disabled={!chosen.length}
            onClick={() => {
              toggleHidden(chosen, !chosen.every((id) => hidden.has(id)));
              setSelected(new Set());
            }}
          >
            <EyeOff size={13} />
            {chosen.length && chosen.every((id) => hidden.has(id))
              ? "Unhide"
              : "Hide"}
          </button>
          <button
            className="danger-button"
            disabled={!chosenMine.length}
            title="Only your own imports can be deleted"
            onClick={() => setConfirm(chosenMine)}
          >
            <Trash2 size={13} /> Delete
            {chosenMine.length ? ` ${chosenMine.length}` : ""}
          </button>
        </div>
      )}
      <div className="asset-grid">
        {items.map((a) => (
          <div
            className={`asset-tile${hidden.has(a.id) ? " hidden-action" : ""}${selected.has(a.id) ? " selected" : ""}`}
            key={a.id}
          >
            <button
              className="asset-card"
              data-asset-id={a.id}
              aria-pressed={selecting ? selected.has(a.id) : undefined}
              title={
                selecting
                  ? `Select ${a.name}`
                  : `Drag ${a.name} into the scene, or click to add`
              }
              onPointerDown={(event) => {
                if (!selecting) onDragStart(a, event);
              }}
              onDragStart={(event) => event.preventDefault()}
              onClick={() => (selecting ? toggleSelected(a.id) : onAdd(a))}
            >
              <div className={`asset-art ${a.category}`}>
                <AssetArt asset={a} />
                <span className="add-badge">
                  {selecting ? (
                    selected.has(a.id) && <Check size={13} />
                  ) : (
                    <Plus size={13} />
                  )}
                </span>
                {mine.has(a.id) && (
                  <span className="imported-badge">YOURS</span>
                )}
              </div>
              <strong>{a.name}</strong>
              <span>
                {subtitle(a)}
                {usage.get(a.id) ? ` · in scene ×${usage.get(a.id)}` : ""}
              </span>
            </button>
            {!selecting && (
              <div className="asset-tools">
                <button
                  aria-label={`${hidden.has(a.id) ? "Unhide" : "Hide"} ${a.name}`}
                  title={
                    hidden.has(a.id)
                      ? "Show in the library"
                      : "Hide from the library"
                  }
                  onClick={() => toggleHidden([a.id], !hidden.has(a.id))}
                >
                  {hidden.has(a.id) ? <Eye size={12} /> : <EyeOff size={12} />}
                </button>
                {mine.has(a.id) && (
                  <button
                    className="danger"
                    aria-label={`Delete ${a.name}`}
                    title="Delete from your library"
                    onClick={() => setConfirm([a.id])}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {!items.length && (
          <div className="empty-state">
            {assets.length
              ? "Nothing matches. Try another search, or show hidden ones."
              : `No ${noun} yet. Import your own with “Import your own asset” below.`}
          </div>
        )}
      </div>
      {confirm && (
        <Modal
          title={
            confirm.length === 1
              ? `Delete ${name(confirm[0])}?`
              : `Delete ${confirm.length} ${noun}?`
          }
          onClose={() => setConfirm(null)}
        >
          <div className="confirm-body">
            <p>
              {confirm.length === 1
                ? "It is removed from your library."
                : `${confirm.map(name).join(", ")} are removed from your library.`}{" "}
              {consequence(confirm)}
            </p>
            <p className="muted">
              Other projects that already use it keep it. Undo (Ctrl/Cmd+Z)
              restores this scene.
            </p>
            <div className="row confirm-actions">
              <button className="secondary" onClick={() => setConfirm(null)}>
                Keep
              </button>
              <button
                className="danger-button"
                autoFocus
                onClick={() => {
                  onDelete(confirm);
                  setConfirm(null);
                  setSelected(new Set());
                }}
              >
                <Check size={15} /> Delete
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
