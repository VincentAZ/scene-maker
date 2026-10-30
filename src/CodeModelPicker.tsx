import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Code2,
  LoaderCircle,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { providers } from "../shared/scene";
import type { CodingModelSelection } from "../shared/coding";
import {
  modelDisplayName,
  studioModelChoices,
  type Provider,
} from "../shared/modelChoices";
import { providerNames } from "./Connections";
import { useCatalog, useConnections } from "./connectionsStore";

/** Saves only a task-owned selection; never writes to the assistant's connections. */
export function CodeModelPicker({
  value,
  revision,
  disabled = false,
  onChange,
  onBusyChange,
  onConnections,
}: {
  value: CodingModelSelection | null;
  revision: number;
  disabled?: boolean;
  onChange: (selection: CodingModelSelection) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onConnections: () => void;
}) {
  const { data, error: connectionError, reload } = useConnections(revision);
  const [open, setOpen] = useState(false);
  const [browsing, setBrowsing] = useState<Provider | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const shown = browsing ?? value?.provider ?? null;
  const catalog = useCatalog(shown, revision, open);
  const connected = shown && data?.providers[shown]?.connected;
  const locked = disabled || saving;

  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !savingRef.current)
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, shown]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function choose(provider: Provider, model: string) {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    onBusyChange(true);
    try {
      await onChange({ provider, model });
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  const models = catalog.provider === shown ? catalog.models : [];
  const chosen = value?.provider === shown ? value.model : "";
  const suggestions = shown ? studioModelChoices(shown, models) : [];
  const preferred = new Set(suggestions.map((model) => model.id));
  const ordered = [
    ...(chosen && !models.some((model) => model.id === chosen)
      ? [{ id: chosen, name: chosen }]
      : []),
    ...models,
  ].sort(
    (a, b) =>
      Number(b.id === chosen) - Number(a.id === chosen) ||
      Number(preferred.has(b.id)) - Number(preferred.has(a.id)) ||
      a.id.localeCompare(b.id),
  );
  const needle = search.trim();
  const matches = ordered.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(needle.toLowerCase()),
  );
  const exactId =
    /^[\w./:-]{3,200}$/.test(needle) &&
    !ordered.some((item) => item.id === needle)
      ? needle
      : "";
  const defaultModel = shown ? data?.providers[shown]?.model : "";
  const label = value
    ? `${providerNames[value.provider]} · ${modelDisplayName({ id: value.model, name: value.model })}`
    : "Choose task model";

  return (
    <div
      className="code-model-picker"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !saving) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="assistant-model-trigger"
        aria-label={`Task model: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={locked}
        title={
          disabled
            ? "Wait for this task to finish or stop it before changing its model"
            : "Change this task’s provider or model"
        }
        onClick={() => {
          setBrowsing(null);
          setSearch("");
          setError("");
          setOpen(!open);
        }}
      >
        {saving ? (
          <LoaderCircle size={14} className="spin" />
        ) : (
          <Code2 size={14} />
        )}
        <span>{label}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="assistant-model-popover"
          role="dialog"
          aria-label="Choose task provider and model"
        >
          <div className="assistant-model-heading">
            <strong>Task model</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh available models"
              disabled={locked || catalog.loading}
              onClick={() => {
                reload();
                catalog.refresh();
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <p className="assistant-model-hint">
            Only this task uses this choice. Other tasks and the assistant stay
            unchanged.
          </p>
          <div
            className="quick-provider-list"
            role="group"
            aria-label="Task providers"
          >
            {providers.map((provider) => (
              <button
                type="button"
                key={provider}
                aria-pressed={shown === provider}
                disabled={locked || !data?.providers[provider]?.connected}
                title={
                  data?.providers[provider]?.connected
                    ? `Browse ${providerNames[provider]} models`
                    : "Connect this provider in Connections first"
                }
                onClick={() => {
                  setBrowsing(provider);
                  setSearch("");
                  setError("");
                }}
              >
                {providerNames[provider]}
                {shown === provider && <Check size={12} />}
              </button>
            ))}
          </div>
          {shown && connected && (
            <>
              <input
                ref={searchInput}
                type="search"
                aria-label="Search task models"
                placeholder={`Search ${providerNames[shown]} models or paste an exact ID…`}
                value={search}
                disabled={locked}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && exactId) {
                    e.preventDefault();
                    void choose(shown, exactId);
                  }
                }}
              />
              <div
                className="quick-model-list"
                role="group"
                aria-label={`${providerNames[shown]} models`}
                aria-busy={catalog.loading}
              >
                {!needle &&
                  defaultModel &&
                  !ordered.some((item) => item.id === defaultModel) && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => void choose(shown, defaultModel)}
                    >
                      <span>
                        <strong>Use saved provider model</strong>
                        <code>{defaultModel}</code>
                      </span>
                    </button>
                  )}
                {matches.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={item.id === chosen}
                    disabled={locked}
                    onClick={() => void choose(shown, item.id)}
                  >
                    <span>
                      <strong>{modelDisplayName(item)}</strong>
                      <code>{item.id}</code>
                    </span>
                    {item.id === chosen && <Check size={15} />}
                  </button>
                ))}
                {exactId && (
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => void choose(shown, exactId)}
                  >
                    <span>
                      <strong>Use this exact identifier</strong>
                      <code>{exactId}</code>
                    </span>
                  </button>
                )}
                {catalog.loading && (
                  <p role="status">Loading available models…</p>
                )}
                {!catalog.loading && !matches.length && !exactId && (
                  <p role="status">No models match your search.</p>
                )}
              </div>
            </>
          )}
          {(error || connectionError || catalog.error) && (
            <p className="quick-model-error" role="alert">
              {error || connectionError || catalog.error}
            </p>
          )}
          {saving && <p role="status">Saving task model…</p>}
          <div className="assistant-model-footer">
            <button
              type="button"
              className="text-button"
              disabled={locked}
              onClick={() => {
                close();
                onConnections();
              }}
            >
              <Settings2 size={13} /> Manage connections
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
