import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { providers } from "../shared/scene";
import {
  modelDisplayName,
  studioModelChoices,
  type Provider,
  type ProviderModel,
} from "../shared/modelChoices";
import { providerNames, type ConnectionsData } from "./Connections";
import { api } from "./api";

export function AssistantModelMenu({
  disabled,
  revision,
  onBusyChange,
  onConnections,
}: {
  disabled: boolean;
  revision: number;
  onBusyChange: (busy: boolean) => void;
  onConnections: () => void;
}) {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [catalog, setCatalog] = useState<{
    provider: Provider;
    models: ProviderModel[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const catalogs = useRef(new Map<Provider, ProviderModel[]>());
  const provider = data?.assistant ?? null;
  const model = provider ? data?.providers[provider]?.model || "" : "";

  useEffect(() => {
    catalogs.current.clear();
    setCatalog(null);
    const controller = new AbortController();
    api<ConnectionsData>("/api/connections", { signal: controller.signal })
      .then((next) => {
        setData(next);
        setError("");
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [revision, refresh]);

  useEffect(() => {
    if (!open || !provider) {
      setLoading(false);
      return;
    }
    const cached = catalogs.current.get(provider);
    if (cached) {
      setCatalog({ provider, models: cached });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setCatalog(null);
    setError("");
    api<{ models: ProviderModel[] }>("/api/connections/models", {
      method: "POST",
      body: JSON.stringify({ provider }),
      signal: controller.signal,
    })
      .then(({ models }) => {
        if (!controller.signal.aborted) {
          catalogs.current.set(provider, models);
          setCatalog({ provider, models });
        }
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, provider, revision, refresh]);

  useEffect(() => {
    if (!open) return;
    searchInput.current?.focus();
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node) && !savingRef.current)
        setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  async function choose(nextProvider: Provider | null, nextModel?: string) {
    if (savingRef.current || disabled) return;
    savingRef.current = true;
    setSaving(true);
    onBusyChange(true);
    setError("");
    try {
      const next = await api<ConnectionsData>("/api/connections", {
        method: "PUT",
        body: JSON.stringify({
          assistant: nextProvider,
          ...(nextProvider && nextModel
            ? { provider: nextProvider, model: nextModel }
            : {}),
        }),
      });
      setData(next);
      setOpen(false);
      requestAnimationFrame(() => trigger.current?.focus());
    } catch (e) {
      setError((e as Error).message);
      requestAnimationFrame(() => searchInput.current?.focus());
    } finally {
      savingRef.current = false;
      setSaving(false);
      onBusyChange(false);
    }
  }
  const models = catalog?.provider === provider ? catalog.models : [];
  const current = models.find((item) => item.id === model) || {
    id: model,
    name: model,
  };
  const suggestions = provider ? studioModelChoices(provider, models) : [];
  const preferred = new Set([model, ...suggestions.map((item) => item.id)]);
  const ordered = [
    ...(model && !models.some((item) => item.id === model) ? [current] : []),
    ...models,
  ].sort(
    (a, b) =>
      Number(b.id === model) - Number(a.id === model) ||
      Number(preferred.has(b.id)) - Number(preferred.has(a.id)) ||
      a.id.localeCompare(b.id),
  );
  const matches = ordered.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      className="assistant-model-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open && !saving) {
          event.stopPropagation();
          close();
        }
      }}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !savingRef.current
        )
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="assistant-model-trigger"
        aria-label={`Assistant model: ${provider ? `${providerNames[provider]} · ${model}` : data ? "Offline helper" : "Loading"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || saving}
        title={
          disabled
            ? "Wait for the current request to finish before switching models"
            : "Change assistant provider or model"
        }
        onClick={() => {
          setSearch("");
          setOpen(!open);
        }}
      >
        {saving ? (
          <LoaderCircle size={15} className="spin" />
        ) : (
          <Sparkles size={15} />
        )}
        <span>
          {provider ? (
            <>
              <span className="assistant-provider-name">
                {providerNames[provider]} ·{" "}
              </span>
              {modelDisplayName(current)}
            </>
          ) : data ? (
            "Offline helper"
          ) : error ? (
            "AI connection unavailable"
          ) : (
            "Loading AI…"
          )}
        </span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div
          className="assistant-model-popover"
          role="dialog"
          aria-label="Choose assistant provider and model"
        >
          <div className="assistant-model-heading">
            <strong>Assistant model</strong>
            <button
              className="icon-button"
              aria-label="Refresh available models"
              disabled={loading || saving}
              onClick={() => setRefresh((v) => v + 1)}
            >
              <RefreshCw size={14} />
            </button>
          </div>
          <p className="assistant-model-hint">
            Choose to switch immediately. Your chat stays here.
          </p>
          <div
            className="quick-provider-list"
            role="group"
            aria-label="Saved AI providers"
          >
            {providers
              .filter(
                (p) => data?.providers[p]?.connected && data.providers[p].model,
              )
              .map((p) => (
                <button
                  key={p}
                  aria-pressed={provider === p}
                  disabled={saving || disabled}
                  title={`Use ${providerNames[p]} · ${data!.providers[p].model}`}
                  onClick={() => void choose(p)}
                >
                  {providerNames[p]}
                  {provider === p && <Check size={12} />}
                </button>
              ))}
          </div>
          {provider && (
            <>
              <input
                ref={searchInput}
                type="search"
                aria-label="Search models"
                placeholder={`Search ${providerNames[provider]} models or IDs…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div
                className="quick-model-list"
                role="group"
                aria-label={`${providerNames[provider]} models`}
                aria-busy={loading}
              >
                {matches.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={item.id === model}
                    disabled={saving || disabled}
                    onClick={() => void choose(provider, item.id)}
                  >
                    <span>
                      <strong>{modelDisplayName(item)}</strong>
                      <code>{item.id}</code>
                    </span>
                    {item.id === model && <Check size={15} />}
                  </button>
                ))}
                {loading && <p role="status">Loading available models…</p>}
                {!loading && !matches.length && !error && (
                  <p role="status">No models match your search.</p>
                )}
              </div>
            </>
          )}
          {error && (
            <p className="quick-model-error" role="alert">
              {error}
            </p>
          )}
          {saving && <p role="status">Switching assistant…</p>}
          <div className="assistant-model-footer">
            <button
              className="text-button"
              disabled={saving || disabled}
              onClick={() => {
                close();
                onConnections();
              }}
            >
              <Settings2 size={13} /> Manage connections
            </button>
            <button
              className="text-button"
              aria-pressed={data?.assistant === null}
              disabled={saving || disabled || !data}
              onClick={() => void choose(null)}
            >
              Offline helper
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
