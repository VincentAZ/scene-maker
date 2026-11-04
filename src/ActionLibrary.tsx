import { useMemo, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Footprints,
  Play,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import type { Motion } from "../shared/scene";
import { Modal } from "./Modal";
import {
  actionCategories,
  actionGroups,
  actionSorts,
  actionSources,
  queryActions,
  type ActionSort,
  type ActionSource,
} from "./actionLibrary";

const HIDDEN_KEY = "scene-maker-hidden-actions";
function readHidden() {
  try {
    const value = JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]");
    return new Set<string>(Array.isArray(value) ? value : []);
  } catch {
    return new Set<string>();
  }
}
function writeHidden(hidden: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
  } catch {
    // Hiding is a per-browser convenience; without storage it lasts the session.
  }
}

/** The Actions library: recorded, stylized and the creator's own actions,
 * filtered by source, category, use and text, sorted several ways. Own
 * actions can be deleted; library ones can be hidden from this browser. */
export function ActionLibrary({
  motions,
  search,
  mine,
  deletable,
  usage,
  initialSource = "all",
  subtitle,
  onAdd,
  onPreview,
  onDelete,
  onImport,
}: {
  motions: Motion[];
  search: string;
  mine: ReadonlySet<string>;
  /** This scene's own actions, which can be deleted here. */
  deletable: ReadonlySet<string>;
  usage: ReadonlyMap<string, number>;
  initialSource?: ActionSource;
  subtitle: (motion: Motion) => string;
  onAdd: (motion: Motion) => void;
  onPreview: (motion: Motion) => void;
  onDelete: (ids: string[]) => void;
  onImport: () => void;
}) {
  const [source, setSource] = useState<ActionSource>(initialSource),
    [category, setCategory] = useState("All"),
    [sort, setSort] = useState<ActionSort>("grouped"),
    [usedOnly, setUsedOnly] = useState(false),
    [showHidden, setShowHidden] = useState(false),
    [hidden, setHidden] = useState(readHidden),
    [selecting, setSelecting] = useState(false),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [confirm, setConfirm] = useState<string[] | null>(null);
  const items = useMemo(
    () =>
      queryActions(motions, {
        search,
        source,
        category,
        sort,
        usedOnly,
        showHidden,
        hidden,
        mine,
        usage,
      }),
    [
      motions,
      search,
      source,
      category,
      sort,
      usedOnly,
      showHidden,
      hidden,
      mine,
      usage,
    ],
  );
  const hiddenCount = motions.filter((m) => hidden.has(m.id)).length;
  const chosen = [...selected].filter((id) =>
    items.some((item) => item.motion.id === id),
  );
  const chosenDeletable = chosen.filter((id) => deletable.has(id));
  const toggleHidden = (ids: string[], hide: boolean) => {
    const next = new Set(hidden);
    for (const id of ids) {
      if (hide) next.add(id);
      else next.delete(id);
    }
    setHidden(next);
    writeHidden(next);
  };
  const toggleSelected = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const affected = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (usage.get(id) ?? 0), 0);
  const name = (id: string) => motions.find((m) => m.id === id)?.name ?? id;
  return (
    <div className="action-library">
      <div className="action-sources" role="group" aria-label="Action source">
        {actionSources.map((option) => (
          <button
            key={option.id}
            className={source === option.id ? "active" : ""}
            aria-pressed={source === option.id}
            onClick={() => setSource(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="action-controls">
        <select
          aria-label="Action category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="All">All categories</option>
          {actionCategories.map((c) => (
            <option key={c}>{c}</option>
          ))}
          <option value="My actions">My actions</option>
        </select>
        <select
          aria-label="Sort actions"
          value={sort}
          onChange={(e) => setSort(e.target.value as ActionSort)}
        >
          {actionSorts.map((option) => (
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
          aria-label="Selected actions"
        >
          <span>{chosen.length} selected</span>
          <button
            className="text-button"
            onClick={() =>
              setSelected(new Set(items.map((item) => item.motion.id)))
            }
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
            disabled={!chosenDeletable.length}
            title="Only your own actions can be deleted"
            onClick={() => setConfirm(chosenDeletable)}
          >
            <Trash2 size={13} /> Delete
            {chosenDeletable.length ? ` ${chosenDeletable.length}` : ""}
          </button>
        </div>
      )}
      <div className="motion-library">
        {actionGroups(items, sort).map((group) => (
          <section
            key={group.title || "all"}
            aria-label={group.title || "Actions"}
          >
            {group.title && (
              <h3 className="action-group-title">
                {group.title}
                <span>{group.items.length}</span>
              </h3>
            )}
            {group.items.map(
              ({ motion: m, source: from, hidden: isHidden }) => (
                <div
                  className={`motion-card${isHidden ? " hidden-action" : ""}`}
                  key={m.id}
                  data-motion-id={m.id}
                >
                  <div className="motion-row">
                    {selecting && (
                      <label className="motion-select">
                        <input
                          type="checkbox"
                          aria-label={`Select ${m.name}`}
                          checked={selected.has(m.id)}
                          onChange={() => toggleSelected(m.id)}
                        />
                      </label>
                    )}
                    <button className="motion-add" onClick={() => onAdd(m)}>
                      <span className="motion-symbol">
                        <Footprints size={18} />
                      </span>
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {Number(m.duration.toFixed(1))}s · {subtitle(m)}
                          {usage.get(m.id)
                            ? ` · in scene ×${usage.get(m.id)}`
                            : ""}
                        </small>
                      </span>
                      <span className={`action-badge ${from}`}>
                        {from === "recorded"
                          ? "REC"
                          : from === "stylized"
                            ? "STYLIZED"
                            : "YOURS"}
                      </span>
                      <Plus size={15} />
                    </button>
                  </div>
                  <div className="motion-tools">
                    <button
                      className="motion-preview"
                      aria-label={`Preview ${m.name}`}
                      onClick={() => onPreview(m)}
                    >
                      <Play size={12} /> Preview
                    </button>
                    <button
                      className="motion-tool"
                      aria-label={`${isHidden ? "Unhide" : "Hide"} ${m.name}`}
                      title={
                        isHidden
                          ? "Show in the library"
                          : "Hide from the library"
                      }
                      onClick={() => toggleHidden([m.id], !isHidden)}
                    >
                      {isHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    {deletable.has(m.id) && (
                      <button
                        className="motion-tool danger"
                        aria-label={`Delete ${m.name}`}
                        title="Delete this action"
                        onClick={() => setConfirm([m.id])}
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
          </section>
        ))}
        {!items.length && (
          <p className="empty-state">
            No actions match. Try another source, category or search.
          </p>
        )}
      </div>
      <button className="create-asset" onClick={onImport}>
        <Upload size={16} />
        <span>
          Import an animation
          <small>FBX, GLB, BVH or VRM from Mixamo, mocap and more</small>
        </span>
        <Plus size={14} />
      </button>
      {confirm && (
        <Modal
          title={
            confirm.length === 1
              ? `Delete ${name(confirm[0])}?`
              : `Delete ${confirm.length} actions?`
          }
          onClose={() => setConfirm(null)}
        >
          <div className="confirm-body">
            <p>
              {confirm.length === 1
                ? "This action is removed from your library."
                : `${confirm.map(name).join(", ")} are removed from your library.`}{" "}
              {affected(confirm)
                ? `${affected(confirm)} clip${affected(confirm) > 1 ? "s" : ""} in this scene play${affected(confirm) > 1 ? "" : "s"} ${confirm.length > 1 ? "them" : "it"} and will be removed too.`
                : "No clip in this scene uses it."}
            </p>
            <p className="muted">Undo (Ctrl/Cmd+Z) brings it back.</p>
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
