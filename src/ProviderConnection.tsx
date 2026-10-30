import { ThinkingControl } from "./ThinkingControl";
import { thinkingChoices, type ThinkingLevel } from "../shared/thinking";
import { useEffect, useRef, useState } from "react";
import { Check, ArrowRight, ExternalLink, LogIn } from "lucide-react";
import { api } from "./api";
import { ModelPicker } from "./ModelPicker";
import { modelDisplayName } from "../shared/modelChoices";
import { providerAccess, chatGPTUsageUrl } from "../shared/providerAccess";
import type { ConnectionsData, ProviderModel, Provider } from "./Connections";

type SignInStatus =
  { status: "pending" } | { status: "done" | "error"; message: string };
type TestResult = {
  ok: boolean;
  models?: number;
  error?: string;
  verifiedAt?: string;
};

/** "just now", "5 min ago", "3 h ago", or a date. */
function since(iso?: string) {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function ProviderConnection({
  provider,
  name,
  active,
  data,
  onSave,
  onRefresh,
  onCatalog,
  onDone,
}: {
  provider: Provider;
  name: string;
  active: boolean;
  data: ConnectionsData;
  onSave: (body: object) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCatalog: (provider: Provider, models: ProviderModel[]) => void;
  onDone: () => void;
}) {
  const saved = data.providers[provider];
  const access = providerAccess[provider];
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
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const requestId = useRef(0);
  const poll = useRef<number | undefined>(undefined);
  const dirty =
    !!key ||
    model !== (saved?.model || "") ||
    thinking !== (saved?.thinking || "default");
  const listed = !!models?.some((m) => m.id === model);
  const inUse = data.assistant === provider;
  const canSave = listed && !loading && !saving;
  const busy = saving || loading || testing || !!signingIn;
  const signedIn =
    saved?.method === "openrouter" || saved?.method === "chatgpt";
  const planBlocked = saved?.method === "chatgpt" && saved.planUsage === false;
  const savedName = modelDisplayName(
    models?.find((item) => item.id === saved?.model) || {
      id: saved?.model || "",
      name: saved?.model || "",
    },
  );
  const via =
    saved?.method === "chatgpt"
      ? `Signed in with ChatGPT${saved.account ? ` as ${saved.account}` : ""}`
      : saved?.method === "openrouter"
        ? "Signed in with OpenRouter"
        : "Connected with an API key";

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
  }, [active, saved?.connected, saved?.method]);
  useEffect(
    () => () => {
      requestId.current++;
      window.clearInterval(poll.current);
    },
    [],
  );

  async function testConnection() {
    setTesting(true);
    setTest(null);
    setError("");
    try {
      const draft = key.trim();
      const result = await api<TestResult>("/api/connections/test", {
        method: "POST",
        body: JSON.stringify({ provider, ...(draft ? { key: draft } : {}) }),
      });
      setTest(result);
      if (result.ok && !draft) await onRefresh();
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  function resetDraft() {
    requestId.current++;
    setKey("");
    setModels(null);
    setTest(null);
    setError("");
  }

  async function signIn(fresh = false) {
    setError("");
    setNotice("");
    setTest(null);
    // Open the window during the click so it is not blocked, then point it
    // at the provider once the studio has prepared the sign-in.
    const popup = window.open("about:blank", "_blank");
    try {
      const { url, attempt } = await api<{ url: string; attempt: string }>(
        "/api/connections/signin",
        { method: "POST", body: JSON.stringify({ provider, fresh }) },
      );
      setSigningIn(attempt);
      if (popup) {
        popup.opener = null;
        popup.location.href = url;
      } else window.open(url, "_blank", "noopener");
      window.clearInterval(poll.current);
      poll.current = window.setInterval(async () => {
        let result: SignInStatus;
        try {
          result = await api<SignInStatus>(
            `/api/connections/signin/${encodeURIComponent(attempt)}`,
          );
        } catch (e) {
          result = { status: "error", message: (e as Error).message };
        }
        if (result.status === "pending") return;
        window.clearInterval(poll.current);
        setSigningIn(null);
        if (result.status === "error") setError(result.message);
        else {
          setNotice(result.message);
          resetDraft();
          await onRefresh().catch(() => undefined);
        }
      }, 1500);
    } catch (e) {
      popup?.close();
      setError((e as Error).message);
    }
  }

  async function cancelSignIn() {
    window.clearInterval(poll.current);
    const attempt = signingIn;
    setSigningIn(null);
    if (attempt)
      await api(`/api/connections/signin/${encodeURIComponent(attempt)}`, {
        method: "DELETE",
      }).catch(() => undefined);
  }

  async function disconnect() {
    setSaving(true);
    setError("");
    setNotice("");
    const method = saved?.method;
    try {
      const result = await api<{ revoked?: boolean }>(
        "/api/connections/disconnect",
        { method: "POST", body: JSON.stringify({ provider }) },
      );
      resetDraft();
      setModel("");
      onCatalog(provider, []);
      await onRefresh();
      setNotice(
        method === "openrouter"
          ? "Disconnected. The key OpenRouter created for Scene Maker stays in your OpenRouter account until you delete it there."
          : method === "chatgpt" && result.revoked === false
            ? "Disconnected here, but ChatGPT did not confirm the sign-out. You can remove Scene Maker in your ChatGPT settings."
            : `Disconnected from ${name}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
      setTest(null);
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
        className={`connection-status ${dirty || error || planBlocked || (models && model && !listed) ? "pending" : ""}`}
        role="status"
      >
        <strong>
          {error || planBlocked || (models && model && !listed)
            ? "Connection needs attention"
            : dirty
              ? "Unsaved changes"
              : saved?.connected
                ? via
                : `Connect ${name}`}
        </strong>
        <p>
          {planBlocked
            ? "You signed in with ChatGPT but did not allow Scene Maker to use your plan. Continue with ChatGPT again and allow it, or paste an API key."
            : dirty
              ? "Your changes will apply when you save below."
              : saved?.connected
                ? `Saved model: ${savedName || "none selected"}. ${inUse ? "Selected for the studio assistant." : "Not selected for the studio assistant."}`
                : access.signIn
                  ? "Sign in below, or paste an API key, then choose a model."
                  : "Paste your key, load the model list, then choose a model."}
        </p>
        {saved?.connected && !dirty && (
          <p className="small connection-verified">
            {saved.verifiedAt
              ? `Last verified ${since(saved.verifiedAt)}.`
              : "Not verified yet. Use Test connection to check it."}
            {saved.method === "chatgpt" && (
              <>
                {" "}
                Using your ChatGPT plan.{" "}
                <a
                  className="text-link"
                  href={chatGPTUsageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Manage usage <ExternalLink size={11} />
                </a>
              </>
            )}
          </p>
        )}
      </div>
      {access.signIn && (
        <div className="connection-signin">
          <div className="row">
            <button
              className={saved?.connected ? "secondary" : "primary"}
              disabled={busy}
              onClick={() => void signIn()}
            >
              <LogIn size={15} />
              {access.signIn === "chatgpt"
                ? "Continue with ChatGPT"
                : "Sign in with OpenRouter"}
            </button>
            {signingIn && (
              <>
                <span className="small" role="status">
                  Waiting for you to finish in the browser window…
                </span>
                <button
                  className="text-button"
                  onClick={() => void cancelSignIn()}
                >
                  Cancel
                </button>
              </>
            )}
            {!signingIn && saved?.method === "chatgpt" && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void signIn(true)}
              >
                Use a different ChatGPT account
              </button>
            )}
          </div>
          <p className="small connection-help">
            {access.signIn === "chatgpt"
              ? "Use your ChatGPT Go, Plus or Pro plan instead of API credit. Some features, such as OpenAI voices, still need an API key."
              : "Authorize Scene Maker on OpenRouter to create a key for your account. It reaches Claude, GPT, Gemini and other models with your OpenRouter credit."}
            {saved?.connected && saved.method === "key"
              ? " Signing in replaces the saved API key."
              : ""}
          </p>
          <p className="connection-or">
            <span>or connect with an API key</span>
          </p>
        </div>
      )}
      {access.subscriptionNote && (
        <p className="integration-note">
          {access.subscriptionNote.text}{" "}
          <a
            className="text-link"
            href={access.subscriptionNote.url}
            target="_blank"
            rel="noreferrer"
          >
            {access.subscriptionNote.link} <ExternalLink size={11} />
          </a>
        </p>
      )}
      <div className="connection-key-label">
        <label htmlFor={`${provider}-key`}>
          1. API key{" "}
          <span>
            {saved?.connected && saved.method === "key"
              ? "Saved · no need to paste again"
              : signedIn
                ? "Optional · signed in"
                : "Required"}
          </span>
        </label>
        <a
          className="text-link"
          href={access.keyUrl}
          target="_blank"
          rel="noreferrer"
        >
          Get an API key <ExternalLink size={11} />
        </a>
      </div>
      <input
        id={`${provider}-key`}
        type="password"
        autoComplete="new-password"
        value={key}
        disabled={saving || !!signingIn}
        placeholder={
          signedIn
            ? "Signed in — paste an API key only to switch to it"
            : saved?.connected
              ? "Key saved — paste here only to replace it"
              : `Paste your ${name} API key`
        }
        onChange={(e) => {
          requestId.current++;
          setKey(e.target.value);
          setModels(null);
          setLoading(false);
          setError("");
          setTest(null);
        }}
      />
      <div className="row connection-model-actions">
        <button
          className="secondary"
          onClick={() => void loadModels()}
          disabled={busy || (!key.trim() && !saved?.connected)}
        >
          {loading
            ? "Loading models…"
            : models
              ? "Refresh models"
              : "Load models"}
        </button>
        <button
          className="text-button"
          onClick={() => void testConnection()}
          disabled={busy || (!key.trim() && !saved?.connected)}
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
        <span className="small">
          {models
            ? `Connected to ${name}. Choose your assistant below.`
            : "Uses your key to read the provider’s model list."}
        </span>
      </div>
      {test && (
        <p
          className={test.ok ? "connection-success" : "connection-error"}
          role={test.ok ? "status" : "alert"}
        >
          {test.ok
            ? `${key.trim() ? "This key works" : "Connection works"}: ${
                test.models === undefined
                  ? `${name} accepted it.`
                  : `${name} returned ${test.models} model${test.models === 1 ? "" : "s"}.`
              }${key.trim() ? " Save below to keep it." : ""}`
            : test.error}
        </p>
      )}
      {notice && !error && (
        <p className="connection-success" role="status">
          {notice}
        </p>
      )}
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
        Loading models and testing the connection do not generate a reply. Model
        compatibility and available credit are checked when you send a message.
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
        {(saved?.connected || saved?.method === "chatgpt") && (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            {signedIn ? "Sign out" : "Disconnect"}
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
