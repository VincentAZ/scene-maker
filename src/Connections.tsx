import type { ThinkingLevel } from "../shared/thinking";
import { useState, useEffect } from "react";
import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import { providers, allAssets, type Scene, type Entity } from "../shared/scene";
import { api } from "./api";
import { ProviderConnection } from "./ProviderConnection";
import { CharacterModelPicker } from "./CharacterModelPicker";
import { primeCatalog } from "./connectionsStore";
import { VoicesSettings } from "./VoicesSettings";
export type Provider = (typeof providers)[number];
export type ProviderModel = { id: string; name: string };
export type ConnectionsData = {
  assistant: Provider | null;
  blender: string;
  providers: Record<
    string,
    { connected: boolean; model: string; thinking?: ThinkingLevel }
  >;
  speech?: {
    openai: boolean;
    elevenlabs: boolean;
    piper: { engine: boolean; voices: number };
  };
};
export const providerNames: Record<Provider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "Grok · xAI",
  kimi: "Kimi · Moonshot",
  openrouter: "OpenRouter",
};
export function Connections({
  scene,
  revision,
  onEntity,
  onBack,
  onDone,
  onChanged,
  onError,
}: {
  scene: Scene;
  revision: number;
  onEntity: (id: string, changes: Partial<Entity>) => void;
  onBack: () => void;
  onDone: () => void;
  onChanged: () => void;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<ConnectionsData | null>(null);
  const [provider, setProvider] = useState<Provider>("openai");
  const [blender, setBlender] = useState("blender");
  const [pathStatus, setPathStatus] = useState("");
  const [pathBusy, setPathBusy] = useState(false);
  const [engine, setEngine] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState("");
  const [assistantBusy, setAssistantBusy] = useState(false);
  async function load() {
    try {
      const d = await api<ConnectionsData>("/api/connections");
      setData(d);
      setBlender(d.blender);
      setProvider(d.assistant || "openai");
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function save(body: object) {
    setData(
      await api<ConnectionsData>("/api/connections", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
    onChanged();
  }
  if (!data)
    return (
      <div className="connections">
        <p role="status">{loadError || "Loading saved connections…"}</p>
        {loadError && (
          <button className="secondary" onClick={() => void load()}>
            Try again
          </button>
        )}
      </div>
    );
  return (
    <div className="connections">
      <div className="row connection-navigation">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={15} /> Studio settings
        </button>
        <button className="text-button" onClick={onDone}>
          Back to studio
        </button>
      </div>
      <p className="muted">
        Choose the AI behind your studio assistant. Saved keys stay on this
        computer and are never returned to the browser.
      </p>
      <div className="provider-tabs" role="group" aria-label="AI providers">
        {providers.map((p) => (
          <button
            key={p}
            className={provider === p ? "active" : ""}
            aria-pressed={provider === p}
            onClick={() => setProvider(p)}
          >
            {providerNames[p]}
            {data.providers[p]?.connected && (
              <Check size={12} aria-label="Key saved" />
            )}
          </button>
        ))}
      </div>
      {providers.map((p) => (
        <ProviderConnection
          key={p}
          provider={p}
          name={providerNames[p]}
          active={p === provider}
          data={data}
          onSave={save}
          onDone={onDone}
          onCatalog={(id, models) => primeCatalog(id, models, revision)}
        />
      ))}
      <details className="connection-details">
        <summary>Assistant & character preferences</summary>
        <label>
          Studio assistant
          <select
            value={data.assistant || ""}
            disabled={assistantBusy}
            onChange={async (e) => {
              setAssistantBusy(true);
              try {
                await save({ assistant: e.target.value || null });
              } catch (err) {
                onError((err as Error).message);
              } finally {
                setAssistantBusy(false);
              }
            }}
          >
            <option value="">Offline command helper</option>
            {providers.map((p) => (
              <option
                key={p}
                value={p}
                disabled={
                  !data.providers[p]?.connected || !data.providers[p]?.model
                }
              >
                {providerNames[p]} ·{" "}
                {data.providers[p]?.model || "setup needed"}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          Assistant choice saves immediately. Characters use this assistant
          unless you choose a different provider below. Character choices are
          saved with your scene.
        </p>
        {scene.entities
          .filter(
            (e) =>
              allAssets(scene).find((a) => a.id === e.assetId)?.category ===
              "characters",
          )
          .map((e) => (
            <div className="mind-row" key={e.id}>
              <strong>{e.name}</strong>
              <CharacterModelPicker
                entity={e}
                revision={revision}
                manageable={false}
                onChange={(changes) => onEntity(e.id, changes)}
                onConnections={() => undefined}
              />
            </div>
          ))}
        <p className="muted small">
          The same choices are available in each character’s Details panel and
          in the conversation panel.
        </p>
      </details>
      <details className="connection-details">
        <summary>Voices</summary>
        <VoicesSettings
          data={data}
          onSave={save}
          onChanged={onChanged}
          onError={onError}
        />
      </details>
      <details className="connection-details">
        <summary>Production tools</summary>
        <label>
          Blender executable
          <input
            value={blender}
            onChange={(e) => {
              setBlender(e.target.value);
              setPathStatus("Unsaved path");
              setEngine(null);
            }}
            placeholder="blender or full executable path"
          />
        </label>
        <div className="row">
          <button
            className="secondary"
            disabled={pathBusy || !blender.trim() || blender === data.blender}
            onClick={async () => {
              setPathBusy(true);
              try {
                await save({ blender: blender.trim() });
                setBlender(blender.trim());
                setPathStatus("Path saved");
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setPathBusy(false);
              }
            }}
          >
            {pathBusy ? "Saving…" : "Save path"}
          </button>
          <button
            className="text-button"
            disabled={pathBusy || blender !== data.blender}
            onClick={async () => {
              try {
                const r = await api<{ blender: boolean }>("/api/engines");
                setEngine(r.blender);
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            Check saved path
          </button>
          <span className="small" role="status">
            {engine === null
              ? pathStatus
              : engine
                ? "Blender is ready"
                : "Blender not found"}
          </span>
        </div>
        <p className="integration-note">
          Unreal Engine opens the project included in a production package.
          Unpack it and open SceneMaker.uproject; setup runs on first launch.
          For Mixamo, download your character as FBX and choose “Import asset”
          in the library. Blender converts it for the studio.
        </p>
        <a
          className="text-link"
          href="https://www.mixamo.com/"
          target="_blank"
          rel="noreferrer"
        >
          Open Mixamo <ExternalLink size={13} />
        </a>
      </details>
    </div>
  );
}
