import type { Config } from "./ai";
import { refreshChatGPTSession } from "./providerAuth";

// Requests that use a person's ChatGPT plan ("Sign in with ChatGPT") go to the
// public Responses API with an OAuth access token, under the constraints in
// https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations:
// store=false, stream=true, no system-role items and no sampling/limit fields.

type Store = { read: () => Config; write: (config: Config) => void };
let store: Store | null = null;
/** Where refreshed tokens are read from and saved (the connections file). */
export function useChatGPTCredentialStore(next: Store | null) {
  store = next;
}

let refreshing: Promise<string> | null = null;
const refreshMargin = 2 * 60_000;

/**
 * A current access token for the saved ChatGPT session, refreshing it (once,
 * even with concurrent callers) when it is about to expire.
 */
export async function chatGPTAccessToken(
  fallback: Config,
  request: typeof fetch = fetch,
): Promise<string> {
  const current = (store?.read() ?? fallback).providers.openai;
  const session = current?.method === "chatgpt" ? current.chatgpt : undefined;
  if (!session?.refreshToken)
    throw Error(
      "Your ChatGPT sign-in has ended. Sign in with ChatGPT again in Studio settings → Connections.",
    );
  if (!session.planUsage)
    throw Error(
      "ChatGPT plan usage was not allowed during sign-in. Sign in with ChatGPT again and allow it, or use an OpenAI API key.",
    );
  if (current?.key && session.expiresAt - refreshMargin > Date.now())
    return current.key;
  refreshing ??= (async () => {
    try {
      const refreshed = await refreshChatGPTSession(session, request);
      const config = store?.read() ?? fallback;
      const entry = config.providers.openai;
      if (entry?.method === "chatgpt") {
        entry.key = refreshed.session.planUsage ? refreshed.accessToken : "";
        entry.chatgpt = refreshed.session;
        store?.write(config);
      }
      return refreshed.accessToken;
    } catch (error) {
      if ((error as { ended?: boolean }).ended) {
        // Confirmed revoked or expired: stop using these tokens.
        const config = store?.read() ?? fallback;
        const entry = config.providers.openai;
        if (entry?.method === "chatgpt" && entry.chatgpt) {
          entry.key = "";
          entry.chatgpt = { ...entry.chatgpt, refreshToken: "" };
          if (config.assistant === "openai") config.assistant = null;
          store?.write(config);
        }
      }
      throw error;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const omitted = [
  "background",
  "conversation",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "moderation",
  "multi_agent",
  "prompt",
  "prompt_cache_retention",
  "previous_response_id",
  "safety_identifier",
  "temperature",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
];

/** Rewrite a Responses API body into the shape ChatGPT plan usage accepts. */
export function planRequestBody(body: Record<string, unknown>) {
  const next: Record<string, unknown> = { ...body, store: false, stream: true };
  for (const field of omitted) delete next[field];
  if (Array.isArray(next.input))
    next.input = next.input.map((item) =>
      item && typeof item === "object" && item.role === "system"
        ? { ...item, role: "developer" }
        : item,
    );
  return next;
}

const failureStatus: Record<string, number> = {
  subscription_sharing_usage_limit_exceeded: 429,
  subscription_sharing_usage_unavailable: 503,
  subscription_sharing_user_unavailable: 503,
  subscription_sharing_user_not_eligible: 403,
  subscription_sharing_route_not_supported: 403,
  subscription_sharing_unsupported_capability: 400,
  subscription_sharing_invalid_user: 401,
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Read a Responses event stream to its terminal event and answer with the
 * equivalent non-streaming body, so non-streaming SDK calls work unchanged.
 */
export async function collectResponseStream(response: Response) {
  const text = await response.text();
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let event: {
      type?: string;
      response?: { error?: { code?: string; message?: string } };
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    )
      return json(event.response, 200);
    if (event.type === "response.failed" || event.type === "error") {
      const error = event.response?.error ||
        event.error || { code: event.code, message: event.message };
      const code = error?.code || "server_error";
      return json(
        { error: { code, message: error?.message || "The request failed." } },
        failureStatus[code] ?? 500,
      );
    }
  }
  return json(
    {
      error: {
        code: "stream_interrupted",
        message: "The response ended before it completed.",
      },
    },
    502,
  );
}

/** A fetch for the OpenAI provider that authenticates with the ChatGPT session. */
export function chatGPTFetch(
  config: Config,
  request: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let body = init?.body;
    let collect = false;
    if (
      /\/v1\/responses$/.test(new URL(url).pathname) &&
      typeof body === "string"
    ) {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      collect = parsed.stream !== true;
      body = JSON.stringify(planRequestBody(parsed));
    }
    const headers = new Headers(init?.headers);
    headers.set(
      "Authorization",
      `Bearer ${await chatGPTAccessToken(config, request)}`,
    );
    if (collect) headers.set("Accept", "text/event-stream");
    const response = await request(input, { ...init, headers, body });
    if (!collect || !response.ok) return response;
    return collectResponseStream(response);
  };
}
