import { useState, useEffect } from "react";
import { ArrowLeft, Check, ExternalLink } from "lucide-react";
import { providers, allAssets, type Scene, type Entity } from "../shared/scene";
import { api } from "./api";
export type ConnectionsData = {
  assistant: (typeof providers)[number] | null;
  blender: string;
  providers: Record<string, { connected: boolean; model: string }>;
};
const providerNames: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  xai: "Grok · xAI",
  kimi: "Kimi · Moonshot",
  openrouter: "OpenRouter",
};
export function Connections({
  scene,
  onEntity,
  onBack,
  onError,
}: {
  scene: Scene;
  onEntity: (id: string, changes: Partial<Entity>) => void;
  onBack: () => void;
  onError: (s: string) => void;
}) {
  const [data, setData] = useState<ConnectionsData | null>(null),
    [provider, setProvider] = useState<(typeof providers)[number]>("openai"),
    [key, setKey] = useState(""),
    [model, setModel] = useState(""),
    [blender, setBlender] = useState("blender"),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [engine, setEngine] = useState<boolean | null>(null);
  const load = () =>
    api<ConnectionsData>("/api/connections")
      .then((d) => {
        setData(d);
        setModel(d.providers[provider]?.model || "");
        setBlender(d.blender);
      })
      .catch((e) => onError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    setKey("");
    setModel(data?.providers[provider]?.model || "");
    setSaved(false);
  }, [provider]);
  async function save() {
    setBusy(true);
    try {
      await api("/api/connections", {
        method: "PUT",
        body: JSON.stringify({
          provider,
          ...(key ? { key } : {}),
          model,
          blender,
        }),
      });
      await load();
      setKey("");
      setSaved(true);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="connections">
      <button className="text-button" onClick={onBack}>
        <ArrowLeft size={15} /> Studio settings
      </button>
      <p className="muted">
        Connect your creative tools. Saved keys stay on this computer and are
        never returned to the browser.
      </p>
      <div className="provider-tabs">
        {providers.map((p) => (
          <button
            key={p}
            className={provider === p ? "active" : ""}
            onClick={() => setProvider(p)}
          >
            {providerNames[p]}
            {data?.providers[p]?.connected && <Check size={12} />}
          </button>
        ))}
      </div>
      <label>
        API key{" "}
        <span>
          {data?.providers[provider]?.connected
            ? "Saved · leave blank to keep"
            : "Not connected"}
        </span>
        <input
          autoComplete="off"
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste a key from your provider"
        />
      </label>
      <label>
        Model identifier
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="Use a model available in your account"
        />
      </label>
      <div className="row">
        <button className="primary" disabled={busy} onClick={save}>
          {saved ? (
            <>
              <Check size={15} /> Connection saved
            </>
          ) : busy ? (
            "Saving…"
          ) : (
            "Save connection"
          )}
        </button>
        {data?.providers[provider]?.connected && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("/api/connections", {
                  method: "PUT",
                  body: JSON.stringify({ provider, key: "" }),
                });
                await load();
              } catch (e) {
                onError((e as Error).message);
              }
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      <label>
        Studio assistant
        <select
          value={data?.assistant || ""}
          onChange={async (e) => {
            try {
              await api("/api/connections", {
                method: "PUT",
                body: JSON.stringify({ assistant: e.target.value || null }),
              });
              await load();
            } catch (err) {
              onError((err as Error).message);
            }
          }}
        >
          <option value="">Offline command helper</option>
          {providers.map((p) => (
            <option key={p} value={p} disabled={!data?.providers[p]?.connected}>
              {providerNames[p]}
            </option>
          ))}
        </select>
      </label>
      <h3>Character minds</h3>
      <p className="muted small">
        Use different providers for different points of view. A blank model uses
        that provider’s saved model.
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
            <select
              aria-label={`${e.name} provider`}
              value={e.provider || ""}
              onChange={(event) =>
                onEntity(e.id, {
                  provider: (event.target.value as Entity["provider"]) || null,
                })
              }
            >
              <option value="">Studio default</option>
              {providers.map((p) => (
                <option key={p} value={p}>
                  {providerNames[p]}
                </option>
              ))}
            </select>
            <input
              aria-label={`${e.name} model`}
              placeholder="Default model"
              value={e.model}
              onChange={(event) =>
                onEntity(e.id, { model: event.target.value })
              }
            />
          </div>
        ))}
      <h3>Production tools</h3>
      <label>
        Blender executable
        <input
          value={blender}
          onChange={(e) => setBlender(e.target.value)}
          placeholder="blender or full executable path"
        />
      </label>
      <div className="row">
        <button className="secondary" onClick={save}>
          Save path
        </button>
        <button
          className="text-button"
          onClick={async () => {
            try {
              const r = await api<{ blender: boolean }>("/api/engines");
              setEngine(r.blender);
            } catch (e) {
              onError((e as Error).message);
            }
          }}
        >
          Check connection
        </button>
        {engine !== null && (
          <span className="small">
            {engine ? "Blender is ready" : "Blender not found"}
          </span>
        )}
      </div>
      <p className="integration-note">
        Unreal Engine uses the animated scene package and included import
        script. For Mixamo, download your character as FBX and choose “Import
        asset” in the library. Blender converts it for the studio.
      </p>
      <a
        className="text-link"
        href="https://www.mixamo.com/"
        target="_blank"
        rel="noreferrer"
      >
        Open Mixamo <ExternalLink size={13} />
      </a>
    </div>
  );
}
