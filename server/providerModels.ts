import type { Provider } from "./ai";
import { connectionTestMessage } from "./providerErrors";

export type ProviderModel = { id: string; name: string };
export const modelEndpoints: Record<Provider, string> = {
  openai: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/models?limit=1000",
  google:
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
  xai: "https://api.x.ai/v1/language-models",
  kimi: "https://api.moonshot.ai/v1/models",
  openrouter: "https://openrouter.ai/api/v1/models/user",
};

function keyMismatch(provider: Provider, key: string) {
  if (key.startsWith("sk-ant-") && provider !== "anthropic")
    return "This looks like an Anthropic API key. Choose the Anthropic tab and enter it there, or replace it with a key from the selected provider.";
  if (key.startsWith("sk-or-") && provider !== "openrouter")
    return "This looks like an OpenRouter API key. Choose the OpenRouter tab and enter it there, or replace it with a key from the selected provider.";
}

// Catalogue reads only: no generation, test prompts, or credentials in URLs/logs.
export async function listProviderModels(
  provider: Provider,
  key: string,
  request: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  if (!key.trim()) throw Error("Paste an API key first.");
  const mismatch = keyMismatch(provider, key);
  if (mismatch) throw Error(mismatch);
  const headers = authHeaders(provider, key);
  const models = new Map<string, ProviderModel>();
  const seen = new Set<string>();
  let url = modelEndpoints[provider];
  const signal = AbortSignal.timeout(15000);
  while (url) {
    if (seen.has(url) || seen.size >= 20)
      throw Error("The provider returned an incomplete model list. Try again.");
    seen.add(url);
    let response: Response;
    try {
      response = await request(url, { headers, signal, redirect: "error" });
    } catch {
      throw Error(
        "Could not reach the provider. Check your connection and try loading models again.",
      );
    }
    if (!response.ok) {
      // Never relay upstream errors: they can echo authorization headers or keys.
      if (response.status === 401)
        throw Error(
          "The provider rejected this API key. Check the key and try again.",
        );
      if (response.status === 403)
        throw Error(
          "This key cannot list models. Check its permissions in your provider account.",
        );
      if (response.status === 429)
        throw Error(
          "The provider is limiting requests. Wait a moment and try again.",
        );
      throw Error("The provider could not load models. Try again shortly.");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw Error("The provider returned an unreadable model list. Try again.");
    }
    const entries = provider === "google" ? body?.models : body?.data;
    if (!Array.isArray(entries))
      throw Error("The provider returned an unexpected model list. Try again.");
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      const id =
        provider === "google" ? entry.name?.replace(/^models\//, "") : entry.id;
      if (typeof id !== "string" || !id || id.length > 200) continue;
      if (
        provider === "google" &&
        !entry.supportedGenerationMethods?.includes("generateContent")
      )
        continue;
      if (
        provider === "openrouter" &&
        (!entry.architecture?.output_modalities?.includes("text") ||
          !entry.supported_parameters?.includes("structured_outputs"))
      )
        continue;
      // OpenAI's catalogue has no capability field. Hide clearly non-chat families;
      // presence in the catalogue does not prove structured-output compatibility.
      if (
        provider === "openai" &&
        (!/^(gpt-|o\d|chatgpt-|ft:)/.test(id) ||
          /(?:audio|realtime|transcribe|tts|image|search|instruct|deep-research)/.test(
            id,
          ))
      )
        continue;
      const name = entry.display_name || entry.displayName || entry.name || id;
      models.set(id, { id, name: typeof name === "string" ? name : id });
    }
    const next = new URL(modelEndpoints[provider]);
    if (
      provider === "google" &&
      typeof body.nextPageToken === "string" &&
      body.nextPageToken
    ) {
      next.searchParams.set("pageToken", body.nextPageToken);
      url = next.toString();
    } else if (provider === "anthropic" && body.has_more) {
      if (typeof body.last_id !== "string" || !body.last_id)
        throw Error(
          "The provider returned an incomplete model list. Try again.",
        );
      next.searchParams.set("after_id", body.last_id);
      url = next.toString();
    } else url = "";
  }
  if (!models.size)
    throw Error(
      "No chat models were returned for this key. Check model access in your provider account.",
    );
  return [...models.values()].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

const authHeaders = (
  provider: Provider,
  key: string,
): Record<string, string> =>
  provider === "anthropic"
    ? { "x-api-key": key, "anthropic-version": "2023-06-01" }
    : provider === "google"
      ? { "x-goog-api-key": key }
      : { Authorization: `Bearer ${key}` };

/**
 * Models a ChatGPT plan can use, in the server's order. The plan catalogue has
 * its own shape: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
 */
export async function listChatGPTModels(
  accessToken: string,
  request: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  let response: Response;
  try {
    response = await request(modelEndpoints.openai, {
      headers: authHeaders("openai", accessToken),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw Error(
      "Could not reach ChatGPT. Check your connection and try loading models again.",
    );
  }
  if (!response.ok)
    throw Error(
      connectionTestMessage(
        response.status,
        await response.text().catch(() => ""),
      ),
    );
  const body = await response.json().catch(() => null);
  const entries = Array.isArray(body?.models) ? body.models : body?.data;
  if (!Array.isArray(entries))
    throw Error("ChatGPT returned an unexpected model list. Try again.");
  const models: ProviderModel[] = [];
  for (const entry of entries) {
    const id = entry?.slug ?? entry?.id;
    if (typeof id !== "string" || !id || id.length > 200) continue;
    if (entry.visibility !== undefined && entry.visibility !== "list") continue;
    if (models.some((model) => model.id === id)) continue;
    const name = entry.display_name || id;
    models.push({ id, name: typeof name === "string" ? name : id });
  }
  if (!models.length)
    throw Error("No models are available to this ChatGPT plan right now.");
  return models;
}

export type ConnectionTest =
  { ok: true; models?: number } | { ok: false; error: string };

/**
 * OpenRouter's model list answers even without a valid key, so its key
 * endpoint is the one that proves the credential.
 */
const checkEndpoints: Partial<Record<Provider, string>> = {
  openrouter: "https://openrouter.ai/api/v1/key",
};

/**
 * Check a credential with one cheap, read-only request (usually the model
 * list). Never generates, and never relays upstream bodies (they can echo
 * credentials).
 */
export async function testProviderConnection(
  provider: Provider,
  key: string,
  request: typeof fetch = fetch,
): Promise<ConnectionTest> {
  if (!key.trim()) return { ok: false, error: "Paste an API key first." };
  const mismatch = keyMismatch(provider, key.trim());
  if (mismatch) return { ok: false, error: mismatch };
  const endpoint = checkEndpoints[provider];
  let response: Response;
  try {
    response = await request(endpoint ?? modelEndpoints[provider], {
      headers: authHeaders(provider, key.trim()),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    return {
      ok: false,
      error:
        "Could not reach the provider. Check your internet connection and try again.",
    };
  }
  if (!response.ok)
    return {
      ok: false,
      error: connectionTestMessage(
        response.status,
        await response.text().catch(() => ""),
      ),
    };
  if (endpoint) return { ok: true };
  const body = await response.json().catch(() => null);
  const entries = body?.models ?? body?.data;
  return { ok: true, models: Array.isArray(entries) ? entries.length : 0 };
}
