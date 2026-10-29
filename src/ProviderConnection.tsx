import { ThinkingControl } from "./ThinkingControl";
import { thinkingChoices, type ThinkingLevel } from "../shared/thinking";
import { useEffect, useRef, useState } from "react";
import { Check, ArrowRight } from "lucide-react";
import { api } from "./api";
import { ModelPicker } from "./ModelPicker";
import { modelDisplayName } from "../shared/modelChoices";
import type { ConnectionsData, ProviderModel, Provider } from "./Connections";

export function ProviderConnection({
  provider,
  name,
  active,
  data,
  onSave,
  onCatalog,
  onDone,
}: {
  provider: Provider;
  name: string;
  active: boolean;
  data: ConnectionsData;
  onSave: (body: object) => Promise<void>;
  onCatalog: (provider: Provider, models: ProviderModel[]) => void;
  onDone: () => void;
}) {
  const saved = data.providers[provider];
  const [key, setKey] = useState("");
  const [model, setModel] = useState(saved?.model || "");
  const [thinking, setThinking] = useState<ThinkingLevel>(
    saved?.thinking || "default",
  );
  useEffect(() => {
    setThinking(saved?.thinking || "default");
  }, [saved?.thinking]);
  const [models, setModels] = useState<ProviderModel[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const dirty =
    !!key ||
    model !== (saved?.model || "") ||
    thinking !== (saved?.thinking || "default");
  const listed = !!models?.some((m) => m.id === model);
  const inUse = data.assistant === provider;
  const canSave = listed && !loading && !saving;
  const savedName = modelDisplayName(
    models?.find((item) => item.id === saved?.model) || {
      id: saved?.model || "",
      name: saved?.model || "",
    },
  );

  async function loadModels() {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    setModels(null);
    try {
      const result = await api<{ models: ProviderModel[] }>(
        "/api/connections/models",
        {
          method: "POST",
          body: JSON.stringify({
            provider,
            ...(key.trim() ? { key: key.trim() } : {}),
          }),
        },
      );
      if (id !== requestId.current) return;
      setModels(result.models);
      // Character defaults must keep using the saved credential until Save succeeds.
      if (!key) onCatalog(provider, result.models);
    } catch (e) {
      if (id === requestId.current) setError((e as Error).message);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (active && saved?.connected && !models && !loading && !error && !key)
      void loadModels();
  }, [active, saved?.connected]);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );

  async function save(useForAssistant: boolean) {
    setSaving(true);
    setError("");
    try {
      await onSave({
        provider,
        ...(key.trim() ? { key: key.trim() } : {}),
        model,
        thinking: thinkingChoices(provider, model).includes(thinking)
          ? thinking
          : "default",
        ...(useForAssistant ? { assistant: provider } : {}),
      });
      setKey("");
      onCatalog(provider, models || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section hidden={!active} aria-label={`${name} connection`}>
      <div
        className={`connection-status ${dirty || error || (models && model && !listed) ? "pending" : ""}`}
        role="status"
      >
        <strong>
          {error || (models && model && !listed)
            ? "Connection needs attention"
            : dirty
              ? "Unsaved changes"
              : saved?.connected
                ? "API key saved on this computer"
                : `Connect ${name}`}
        </strong>
        <p>
          {dirty
            ? "Your changes will apply when you save below."
            : saved?.connected
              ? `Saved model: ${savedName || "none selected"}. ${inUse ? "Selected for the studio assistant." : "Not selected for the studio assistant."}`
              : "Paste your key, load the model list, then choose a model."}
        </p>
      </div>
      <label htmlFor={`${provider}-key`}>
        1. API key{" "}
        <span>
          {saved?.connected ? "Saved · no need to paste again" : "Required"}
        </span>
      </label>
      <input
        id={`${provider}-key`}
        type="password"
        autoComplete="new-password"
        value={key}
        disabled={saving}
        placeholder={
          saved?.connected
            ? "Key saved — paste here only to replace it"
            : `Paste your ${name} API key`
        }
        onChange={(e) => {
          requestId.current++;
          setKey(e.target.value);
          setModels(null);
          setLoading(false);
          setError("");
        }}
      />
      <div className="row connection-model-actions">
        <button
          className="secondary"
          onClick={() => void loadModels()}
          disabled={loading || saving || (!key.trim() && !saved?.connected)}
        >
          {loading
            ? "Loading models…"
            : models
              ? "Refresh models"
              : "Load models"}
        </button>
        <span className="small">
          {models
            ? `Connected to ${name}. Choose your assistant below.`
            : "Uses your key to read the provider’s model list."}
        </span>
      </div>
      {error && (
        <p className="connection-error" role="alert">
          {error}
        </p>
      )}
      {models ? (
        <ModelPicker
          provider={provider}
          models={models}
          value={model}
          disabled={loading || saving}
          onChange={setModel}
        />
      ) : (
        <p className="model-picker-empty">
          {loading
            ? "Finding available models…"
            : "Connect your key to see assistant suggestions."}
        </p>
      )}
      <ThinkingControl
        provider={provider}
        model={model}
        value={thinking}
        disabled={saving || loading}
        onChange={setThinking}
      />
      {models && model && !listed && (
        <p className="connection-error" role="alert">
          “{model}” was not returned by {name}. Choose one of the assistant
          options above.
        </p>
      )}
      <p className="small connection-help">
        Loading models does not generate a reply. Model compatibility and
        available credit are checked when you send a message.
      </p>
      <div className="row connection-save-actions">
        <button
          className="primary"
          disabled={!canSave || (!dirty && inUse)}
          onClick={() => void save(true)}
        >
          {saving ? (
            "Saving…"
          ) : !dirty && inUse && !error && listed ? (
            <>
              <Check size={15} /> Saved · in use
            </>
          ) : (
            "3. Save & use in studio"
          )}
        </button>
        {(!inUse || dirty) && (
          <button
            className="text-button"
            disabled={!canSave || !dirty}
            onClick={() => void save(false)}
          >
            Save connection only
          </button>
        )}
        {saved?.connected && (
          <button
            className="text-button"
            disabled={saving || loading}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await onSave({ provider, key: "", model: "" });
                requestId.current++;
                setKey("");
                setModel("");
                setModels(null);
                onCatalog(provider, []);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      {!dirty && inUse && saved?.connected && !error && listed && (
        <div className="connection-next">
          <p>
            <strong>
              {name} · {savedName}
            </strong>{" "}
            is saved as your studio assistant.
          </p>
          <button className="secondary" onClick={onDone}>
            Return to studio <ArrowRight size={15} />
          </button>
          <p className="small">
            Then type what you want to create in the assistant panel.
          </p>
        </div>
      )}
    </section>
  );
}
