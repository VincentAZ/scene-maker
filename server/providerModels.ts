import type { Provider } from "./ai";
import { connectionTestMessage } from "./providerErrors";

export type ProviderModel = { id: string; name: string };
export const modelEndpoints: Record<Exclude<Provider, "lmstudio">, string> = {
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

/**
 * LM Studio's OpenAI-compatible base URL from the address the person typed:
 * "127.0.0.1:1234", "http://localhost:1234" and ".../v1" all work.
 * https://lmstudio.ai/docs/developer/openai-compat
 */
export function lmStudioBaseUrl(address: string) {
  const raw = address.trim();
  let url: URL | undefined;
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    // Reported below.
  }
  if (
    !raw ||
    !url ||
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error(
      "Enter LM Studio’s server address, such as http://127.0.0.1:1234.",
    );
  const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${url.origin}${path}/v1`;
}

/** Models LM Studio has downloaded; it loads one on first use. */
async function listLMStudioModels(
  address: string,
  request: typeof fetch,
): Promise<ProviderModel[]> {
  const base = lmStudioBaseUrl(address);
  let response: Response;
  try {
    response = await request(`${base}/models`, {
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
  } catch {
    throw Error(
      `Could not reach LM Studio at ${new URL(base).host}. Open LM Studio and start its server (Developer → Start server, or run “lms server start”), then try again.`,
    );
  }
  if (!response.ok)
    throw Error(
      response.status === 401 || response.status === 403
        ? "LM Studio refused the request. Turn off authentication for its server, then try again."
        : "LM Studio could not list its models. Check that its server is running, then try again.",
    );
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body?.data))
    throw Error(
      "This address did not answer like LM Studio. Check the server address and port.",
    );
  const models: ProviderModel[] = [];
  for (const entry of body.data) {
    const id = entry?.id;
    if (typeof id !== "string" || !id || id.length > 200) continue;
    // Embedding models share the list but cannot chat.
    if (entry.type === "embeddings" || /embed/i.test(id)) continue;
    if (!models.some((model) => model.id === id)) models.push({ id, name: id });
  }
  if (!models.length)
    throw Error(
      "LM Studio has no chat models downloaded yet. Download one in LM Studio, then load models again.",
    );
  return models.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
}

// Catalogue reads only: no generation, test prompts, or credentials in URLs/logs.
export async function listProviderModels(
  provider: Provider,
  key: string,
  request: typeof fetch = fetch,
): Promise<ProviderModel[]> {
  if (provider === "lmstudio") return listLMStudioModels(key, request);
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
  if (provider === "lmstudio")
    try {
      return {
        ok: true,
        models: (await listLMStudioModels(key, request)).length,
      };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
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
