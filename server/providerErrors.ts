// Classify provider failures without exposing their raw messages, request bodies,
// response headers, credentials, or user prompts to the browser or logs. Only the
// provider's error type/code, a request id and token counts may be quoted.
type ProviderError = {
  name?: string;
  statusCode?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  data?: { error?: { code?: string; type?: string; message?: string } };
  cause?: unknown;
  lastError?: unknown;
  errors?: unknown[];
};
type Detail = {
  statusCode?: number;
  code?: string;
  message: string;
  requestId?: string;
};

/** The provider's own error, searched through wrapped and retried errors. */
function apiError(error: unknown, depth = 0): ProviderError | undefined {
  if (!error || typeof error !== "object" || depth > 5) return;
  const e = error as ProviderError;
  if (e.name?.includes("API")) return e;
  for (const inner of [e.lastError, e.errors?.[e.errors.length - 1], e.cause])
    if (inner && inner !== error) {
      const found = apiError(inner, depth + 1);
      if (found) return found;
    }
}
function detailOf(e: ProviderError): Detail {
  let detail = e.data?.error;
  let requestId: string | undefined;
  try {
    const body = JSON.parse(e.responseBody || "{}");
    detail = body.error || detail;
    if (typeof body.request_id === "string") requestId = body.request_id;
  } catch {
    /* use status instead */
  }
  const headers = e.responseHeaders || {};
  for (const [key, value] of Object.entries(headers))
    if (/^(x-)?request-id$/i.test(key) && value) requestId ||= value;
  return {
    statusCode: e.statusCode,
    code: detail?.code || detail?.type,
    message: typeof detail?.message === "string" ? detail.message : "",
    requestId: requestId && /^[\w.-]{1,80}$/.test(requestId) ? requestId : undefined,
  };
}

const BILLING_CODES = [
  "insufficient_quota",
  "billing_hard_limit_reached",
  "credit_balance_too_low",
];
const BILLING_MESSAGE =
  /credit balance|billing|purchase credits|insufficient[_ ](quota|credits?|funds|balance)|spending limit|exceeded your current quota/i;
const CONTEXT_CODES = ["context_length_exceeded", "prompt_too_long"];
const CONTEXT_MESSAGE =
  /prompt is too long|exceeds? (the )?(model'?s? )?(maximum )?context|context[_ ]length|context window|maximum context|too many (input )?tokens|input length and `?max_tokens`? exceed/i;
const COMPATIBILITY_MESSAGE =
  /thinking|redacted_thinking|tool_use|tool_result|json_schema|schema|unexpected field|unknown parameter|not supported/i;

/** True for a provider 4xx saying the conversation no longer fits the model's context. */
export function contextOverflowError(error: unknown): boolean {
  const e = apiError(error);
  if (!e) return false;
  const d = detailOf(e);
  return (
    CONTEXT_CODES.includes(d.code || "") ||
    ([400, 413, 422].includes(d.statusCode || 0) && CONTEXT_MESSAGE.test(d.message))
  );
}

export function providerErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const outer = error as { name?: string };
  if (outer.name === "TimeoutError" || outer.name === "AbortError")
    return "The assistant request timed out or was stopped. Please try again.";
  if (
    outer.name === "AI_NoObjectGeneratedError" ||
    outer.name === "AI_TypeValidationError"
  )
    return "The model returned an incomplete or invalid scene plan. Please try again; no unvalidated changes were applied.";
  const e = apiError(error);
  if (!e) return;
  const { statusCode, code, message, requestId } = detailOf(e);
  if (code === "invalid_json_schema")
    return "The model rejected the studio’s response format (invalid_json_schema). This is an app compatibility error. Update the studio or choose another model in Connections.";
  if (BILLING_CODES.includes(code || "") || BILLING_MESSAGE.test(message))
    return "Your provider account has no available API credit or has reached its spending limit. Check billing and limits in your provider account, then try again.";
  if (contextOverflowError(error)) {
    const counts = message.match(/(\d[\d,]*) tokens? > (\d[\d,]*)/);
    const detail = counts ? ` (${counts[1]} tokens, limit ${counts[2]})` : "";
    return `The conversation is too long for the selected model${detail}. Start a new task or conversation, or choose a model with a larger context in Connections.`;
  }
  if (statusCode === 401)
    return "The provider rejected the API key. Replace it in Studio settings → Connections.";
  if (statusCode === 403)
    return "This key does not have permission to generate replies with the selected model. Check model access and key permissions in your provider account.";
  if (statusCode === 404)
    return "The selected model is unavailable to this account. Refresh models in Connections and choose an available model.";
  if (statusCode === 429)
    return "The provider’s request limit was reached. Wait a moment and try again, or check your account’s rate limits.";
  if (statusCode && statusCode >= 500)
    return "The AI provider is temporarily unavailable. Please try again shortly.";
  if (statusCode === 400 || statusCode === 422) {
    const ref = [code, requestId && `request ${requestId}`].filter(Boolean).join(", ");
    if (COMPATIBILITY_MESSAGE.test(message))
      return `The model rejected the studio’s request format${ref ? ` (${ref})` : ""}. This is an app compatibility error. Update the studio or choose another model in Connections.`;
    return `The provider rejected the request${ref ? ` (${ref})` : ""}. Try again or choose another model in Connections; if it keeps happening, report it with this reference.`;
  }
  return "Could not reach the AI provider. Check your internet connection and try again.";
}
