import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  LoaderCircle,
  RefreshCw,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { providers, type Entity } from "../shared/scene";
import {
  modelDisplayName,
  studioModelChoices,
  type Provider,
  type ProviderModel,
} from "../shared/modelChoices";
import {
  thinkingChoices,
  thinkingLabels,
  type ThinkingLevel,
} from "../shared/thinking";
import { providerNames, type ConnectionsData } from "./Connections";
import { useCatalog, useConnections } from "./connectionsStore";

export type CharacterMind = Pick<
  Entity,
  "id" | "name" | "provider" | "model" | "thinking"
>;

/** What a character will actually speak with, and anything that stops it. */
export function describeCharacterModel(
  entity: CharacterMind,
  data: ConnectionsData | null,
) {
  const provider: Provider | null =
    entity.provider ?? (data?.assistant as Provider | null) ?? null;
  const saved = provider ? data?.providers[provider] : undefined;
  const model = entity.model || saved?.model || "";
  const display = model ? modelDisplayName({ id: model, name: model }) : "";
  let label: string,
    warning = "";
  if (!data) label = "Loading AI connections…";
  else if (entity.provider) {
    label = `${providerNames[entity.provider]} · ${display || "no model chosen"}`;
    if (!saved?.connected)
      warning = `${providerNames[entity.provider]} has no saved API key, so ${entity.name} cannot speak. Connect it or choose another model.`;
    else if (!model)
      warning = `Choose a ${providerNames[entity.provider]} model for ${entity.name}.`;
  } else if (provider) {
    label = `Studio assistant · ${providerNames[provider]} · ${display || "no model"}`;
    if (!saved?.connected || !model)
      warning = `The studio assistant is not fully set up, so ${entity.name} cannot speak yet.`;
  } else {
    label = "Studio assistant · Offline helper";
    warning = `Conversations need an AI. Choose a provider for ${entity.name} or connect the studio assistant.`;
  }
  return { provider, model, label, warning };
}

export function CharacterModelPicker({
  entity,
  revision,
  disabled = false,
  compact = false,
  manageable = true,
  onChange,
  onConnections,
}: {
  entity: CharacterMind;
  revision: number;
  disabled?: boolean;
  compact?: boolean;
  manageable?: boolean;
  onChange: (changes: Partial<Entity>) => void;
  onConnections: () => void;
}) {
  const { data, error: connectionError, reload } = useConnections(revision);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [browsing, setBrowsing] = useState<Provider | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const current = describeCharacterModel(entity, data);
  const shown = browsing ?? current.provider;
  const catalog = useCatalog(shown, revision, open);
  const connected = (p: Provider) => !!data?.providers[p]?.connected;

  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (!open) {
      setBrowsing(null);
      setSearch("");
    }
  }, [open, entity.id]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const assign = (changes: Partial<Entity>, complete = true) => {
    if (disabled) return;
    onChange(changes);
    if (complete) close();
  };
  const models = catalog.provider === shown ? catalog.models : [];
  const chosenId = entity.provider === shown ? entity.model : "";
  const providerDefault = shown ? data?.providers[shown]?.model || "" : "";
  const suggestions = shown ? studioModelChoices(shown, models) : [];
  const pinned = new Set(suggestions.map((item) => item.id));
  const known = new Set(models.map((item) => item.id));
  const ordered = [
    ...(chosenId && !known.has(chosenId)
      ? [{ id: chosenId, name: chosenId }]
      : []),
    ...models,
  ].sort(
    (a, b) =>
      Number(b.id === chosenId) - Number(a.id === chosenId) ||
      Number(pinned.has(b.id)) - Number(pinned.has(a.id)) ||
      a.id.localeCompare(b.id),
  );
  const needle = search.trim().toLowerCase();
  const matches = needle
    ? ordered.filter((item) =>
        `${item.name} ${item.id}`.toLowerCase().includes(needle),
      )
    : ordered;
  const exactId =
    needle &&
    !known.has(search.trim()) &&
    /^[\w./:-]{3,200}$/.test(search.trim())
      ? search.trim()
      : "";
  const effectiveProvider = current.provider;
  const effectiveModel = current.model;
  const levels = thinkingChoices(effectiveProvider, effectiveModel);
  const providerThinking =
    (effectiveProvider && data?.providers[effectiveProvider]?.thinking) ||
    "default";

  return (
    <div
      ref={root}
      className={`character-model-menu ${compact ? "compact" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`character-model-trigger ${current.warning ? "warning" : ""}`}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`${entity.name}’s AI model: ${current.label}`}
        title={current.warning || `Change which AI speaks for ${entity.name}`}
        disabled={disabled && !open}
        onClick={() => setOpen((v) => !v)}
      >
        {current.warning ? (
          <TriangleAlert size={14} aria-hidden="true" />
        ) : (
          <Brain size={14} aria-hidden="true" />
        )}
        <span>{current.label}</span>
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {open && (
        <div
          className="assistant-model-popover character-model-popover"
          role="group"
          aria-label={`Choose ${entity.name}’s AI`}
        >
          <div className="assistant-model-heading">
            <strong>{entity.name}’s mind</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Refresh available models"
              disabled={catalog.loading}
              onClick={() => {
                reload();
                catalog.refresh();
              }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <p className="assistant-model-hint">
            Choices apply immediately and save with the scene. Each turn is
            billed by the chosen provider.
          </p>
          {current.warning && (
            <p className="model-warning" role="alert">
              <TriangleAlert size={14} aria-hidden="true" />
              <span>{current.warning}</span>
            </p>
          )}
          {connectionError && (
            <p className="quick-model-error" role="alert">
              {connectionError}
            </p>
          )}
          <div
            className="quick-provider-list"
            role="group"
            aria-label="Provider"
          >
            <button
              type="button"
              aria-pressed={entity.provider === null}
              disabled={disabled}
              title="Follow the studio assistant, whatever it is set to"
              onClick={() => {
                setBrowsing(null);
                assign({ provider: null, model: "", thinking: undefined });
              }}
            >
              Studio assistant
              {entity.provider === null && <Check size={12} />}
            </button>
            {providers.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={entity.provider === p}
                disabled={disabled || !connected(p)}
                title={
                  connected(p)
                    ? `Speak with ${providerNames[p]}`
                    : `${providerNames[p]} has no saved API key`
                }
                onClick={() => {
                  setBrowsing(p);
                  setSearch("");
                  if (entity.provider !== p)
                    assign(
                      { provider: p, model: "", thinking: undefined },
                      false,
                    );
                }}
              >
                {providerNames[p]}
                {entity.provider === p && <Check size={12} />}
              </button>
            ))}
          </div>
          {shown && connected(shown) && (
            <>
              <input
                ref={searchInput}
                type="search"
                aria-label={`Search ${providerNames[shown]} models`}
                placeholder={`Search ${providerNames[shown]} models or paste an exact ID…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && exactId) {
                    e.preventDefault();
                    assign({ provider: shown, model: exactId });
                  }
                }}
              />
              <div
                className="quick-model-list"
                role="group"
                aria-label={`${providerNames[shown]} models`}
                aria-busy={catalog.loading}
              >
                {!needle && (
                  <button
                    type="button"
                    aria-pressed={entity.provider === shown && !entity.model}
                    disabled={disabled}
                    onClick={() => assign({ provider: shown, model: "" })}
                  >
                    <span>
                      <strong>Provider default</strong>
                      <code>
                        {providerDefault || "no default model saved yet"}
                      </code>
                    </span>
                    {entity.provider === shown && !entity.model && (
                      <Check size={15} />
                    )}
                  </button>
                )}
                {matches.map((item) => {
                  const selected =
                    entity.provider === shown && item.id === chosenId;
                  const suggestion = suggestions.find((s) => s.id === item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={selected}
                      disabled={disabled}
                      onClick={() =>
                        assign({ provider: shown, model: item.id })
                      }
                    >
                      <span>
                        <strong>
                          {modelDisplayName(item)}
                          {suggestion && (
                            <em className="model-suggestion-tag">
                              {" "}
                              · {suggestion.title}
                            </em>
                          )}
                          {!known.has(item.id) && (
                            <em className="model-suggestion-tag">
                              {" "}
                              · saved ID
                            </em>
                          )}
                        </strong>
                        <code>{item.id}</code>
                      </span>
                      {selected && <Check size={15} />}
                    </button>
                  );
                })}
                {exactId && (
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => assign({ provider: shown, model: exactId })}
                  >
                    <span>
                      <strong>Use this exact identifier</strong>
                      <code>{exactId}</code>
                    </span>
                  </button>
                )}
                {catalog.loading && (
                  <p role="status">
                    <LoaderCircle size={13} className="spin" /> Loading{" "}
                    {providerNames[shown]} models…
                  </p>
                )}
                {!catalog.loading && !matches.length && !exactId && (
                  <p role="status">No models match your search.</p>
                )}
                {catalog.error && (
                  <p className="quick-model-error" role="alert">
                    {catalog.error}
                  </p>
                )}
              </div>
            </>
          )}
          {effectiveProvider && (
            <label className="thinking-control">
              Thinking effort for {entity.name}
              <select
                aria-label={`${entity.name}’s thinking effort`}
                value={entity.thinking ?? ""}
                disabled={disabled || levels.length === 1}
                onChange={(e) =>
                  assign(
                    {
                      thinking: (e.target.value || undefined) as
                        ThinkingLevel | undefined,
                    },
                    false,
                  )
                }
              >
                <option value="">
                  Same as provider · {thinkingLabels[providerThinking]}
                </option>
                {levels
                  .filter((level) => level !== "default")
                  .map((level) => (
                    <option key={level} value={level}>
                      {thinkingLabels[level]}
                    </option>
                  ))}
              </select>
              <small>
                {levels.length === 1
                  ? "This model uses its default thinking settings."
                  : "Higher effort can take longer and use more tokens."}
              </small>
            </label>
          )}
          {manageable && (
            <div className="assistant-model-footer">
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setOpen(false);
                  onConnections();
                }}
              >
                <Settings2 size={13} /> Manage connections
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
