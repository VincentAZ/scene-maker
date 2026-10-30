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
  generation?: { meshy: boolean };
  mcpServers?: Record<
    string,
    {
      transport: string;
      command?: string;
      url?: string;
      env?: string[];
      headers?: string[];
    }
  >;
};
const mcpExample = `{
  "filesystem": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/assets"]
  },
  "remote-tools": {
    "transport": "http",
    "url": "https://example.com/mcp",
    "headers": { "Authorization": "Bearer …" }
  }
}`;
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
  const [mcpText, setMcpText] = useState("");
  const [mcpStatus, setMcpStatus] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [meshyKey, setMeshyKey] = useState("");
  const [meshyBusy, setMeshyBusy] = useState(false);
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
        <summary>MCP servers for the studio engineer</summary>
        <p className="muted small">
          Every coding task connects to these servers and can call their tools.
          Add or update servers as JSON keyed by name; saved entries keep their
          secrets on this computer.
        </p>
        {!!Object.keys(data.mcpServers || {}).length && (
          <ul className="mcp-list">
            {Object.entries(data.mcpServers || {}).map(([name, server]) => (
              <li key={name}>
                <strong>{name}</strong>{" "}
                <span className="small">
                  {server.transport} · {server.command || server.url}
                </span>
                <button
                  className="text-button"
                  disabled={mcpBusy}
                  onClick={async () => {
                    setMcpBusy(true);
                    try {
                      await save({ removeMcpServer: name });
                      setMcpStatus(`Removed ${name}`);
                    } catch (e) {
                      onError((e as Error).message);
                    } finally {
                      setMcpBusy(false);
                    }
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>
          Add or update servers
          <textarea
            value={mcpText}
            rows={8}
            spellCheck={false}
            onChange={(e) => {
              setMcpText(e.target.value);
              setMcpStatus("");
            }}
            placeholder={mcpExample}
          />
        </label>
        <div className="row">
          <button
            className="secondary"
            disabled={mcpBusy || !mcpText.trim()}
            onClick={async () => {
              setMcpBusy(true);
              try {
                const parsed = JSON.parse(mcpText) as unknown;
                if (
                  !parsed ||
                  typeof parsed !== "object" ||
                  Array.isArray(parsed)
                )
                  throw Error("Enter a JSON object keyed by server name.");
                await save({ mcpServers: parsed });
                setMcpText("");
                setMcpStatus(`Saved ${Object.keys(parsed).join(", ")}`);
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setMcpBusy(false);
              }
            }}
          >
            {mcpBusy ? "Saving…" : "Save servers"}
          </button>
          <span className="small" role="status">
            {mcpStatus}
          </span>
        </div>
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
          For Mixamo, use “Generate with AI · Rig with Mixamo” in the library:
          it prepares the file, opens mixamo.com and picks up your downloads.
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
      <details className="connection-details">
        <summary>3D generation</summary>
        <p className="integration-note">
          Meshy turns a description into a textured 3D model. Scene Maker then
          cleans it up in Blender and, for characters, prepares it for Mixamo
          rigging. Meshy bills per generation; review its current output and
          redistribution terms before publishing generated assets.
        </p>
        <label>
          Meshy API key{" "}
          {data.generation?.meshy && (
            <small className="muted">· saved, paste to replace</small>
          )}
          <input
            type="password"
            autoComplete="off"
            value={meshyKey}
            placeholder={data.generation?.meshy ? "Key saved" : "msy_…"}
            onChange={(e) => setMeshyKey(e.target.value)}
          />
        </label>
        <div className="row">
          <button
            className="secondary"
            disabled={meshyBusy || !meshyKey.trim()}
            onClick={async () => {
              setMeshyBusy(true);
              try {
                await save({ meshyKey: meshyKey.trim() });
                setMeshyKey("");
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setMeshyBusy(false);
              }
            }}
          >
            {meshyBusy ? "Saving…" : "Save Meshy key"}
          </button>
          {data.generation?.meshy && (
            <button
              className="text-button"
              disabled={meshyBusy}
              onClick={async () => {
                setMeshyBusy(true);
                try {
                  await save({ meshyKey: "" });
                } catch (e) {
                  onError((e as Error).message);
                } finally {
                  setMeshyBusy(false);
                }
              }}
            >
              Remove key
            </button>
          )}
        </div>
      </details>
    </div>
  );
}
