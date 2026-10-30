// Errors specific to requests that use a ChatGPT plan ("Sign in with ChatGPT").
// https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery
const chatGPTPlanMessages: Record<string, string> = {
  subscription_sharing_usage_limit_exceeded:
    "Your ChatGPT plan’s usage limit for other apps was reached. Manage usage in ChatGPT settings → Usage, or connect an OpenAI API key.",
  subscription_sharing_user_not_eligible:
    "This ChatGPT account can’t use its plan in other apps. Connect an OpenAI API key instead.",
  subscription_sharing_usage_unavailable:
    "ChatGPT plan usage is temporarily unavailable. Please try again shortly.",
  subscription_sharing_user_unavailable:
    "ChatGPT plan usage is temporarily unavailable. Please try again shortly.",
  subscription_sharing_unsupported_capability:
    "This request uses a feature ChatGPT plan usage doesn’t support yet. Choose another model or connect an OpenAI API key for this feature.",
  subscription_sharing_route_not_supported:
    "ChatGPT plan usage doesn’t support this kind of request. Connect an OpenAI API key for this feature.",
  subscription_sharing_invalid_user:
    "ChatGPT did not accept this sign-in. If you disconnected Scene Maker in ChatGPT, sign in with ChatGPT again.",
  chatpass_v2_scope_not_authorized:
    "ChatGPT plan usage was not allowed for this sign-in. Sign in with ChatGPT again and allow it.",
  chatpass_v2_invalid_authorization_context:
    "ChatGPT plan usage was not allowed for this sign-in. Sign in with ChatGPT again and allow it.",
  stream_interrupted:
    "The connection to ChatGPT dropped before the reply finished. Please try again.",
};

/**
 * The outcome of a connection test (a model-list request) as a plain message.
 * Upstream bodies are only inspected for error codes, never relayed.
 */
export function connectionTestMessage(
  status: number,
  responseBody: string,
): string {
  if (
    status === 400 &&
    /API_KEY_INVALID|API key not valid|invalid.api.key|incorrect API key/i.test(
      responseBody,
    )
  )
    status = 401; // Google and xAI report a bad key as a 400.
  if (status === 403)
    return "The provider accepted the request but refused access. Check this key’s permissions and that the account is active.";
  if (status === 404 || status === 400)
    return "The provider did not recognise the request. Check that the key belongs to this provider.";
  return (
    providerErrorMessage({
      name: "AI_APICallError",
      statusCode: status,
      responseBody,
    }) || "The provider could not be reached. Try again shortly."
  );
}

// Classify provider failures without exposing their raw messages, request bodies,
// response headers, credentials, or user prompts to the browser or logs.
export function providerErrorMessage(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return;
  const e = error as {
    name?: string;
    statusCode?: number;
    responseBody?: string;
    data?: { error?: { code?: string; type?: string } };
  };
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return "The assistant request timed out or was stopped. Please try again.";
  if (
    e.name === "AI_NoObjectGeneratedError" ||
    e.name === "AI_TypeValidationError"
  )
    return "The model returned an incomplete or invalid scene plan. Please try again; no unvalidated changes were applied.";
  if (!e.name?.includes("API")) return;
  let detail = e.data?.error;
  try {
    detail = JSON.parse(e.responseBody || "{}").error || detail;
  } catch {
    /* use status instead */
  }
  const code = detail?.code || detail?.type;
  const plan = code ? chatGPTPlanMessages[code] : undefined;
  if (plan) return plan;
  if (code === "invalid_json_schema")
    return "The model rejected the studio’s response format (invalid_json_schema). This is an app compatibility error. Update the studio or choose another model in Connections.";
  if (
    [
      "insufficient_quota",
      "billing_hard_limit_reached",
      "credit_balance_too_low",
    ].includes(code || "")
  )
    return "Your provider account has no available API credit or has reached its spending limit. Check billing and limits in your provider account, then try again.";
  if (e.statusCode === 401)
    return "The provider rejected the API key. Replace it in Studio settings → Connections.";
  if (e.statusCode === 403)
    return "This key does not have permission to generate replies with the selected model. Check model access and key permissions in your provider account.";
  if (e.statusCode === 404)
    return "The selected model is unavailable to this account. Refresh models in Connections and choose an available model.";
  if (e.statusCode === 429)
    return "The provider’s request limit was reached. Wait a moment and try again, or check your account’s rate limits.";
  if (e.statusCode && e.statusCode >= 500)
    return "The AI provider is temporarily unavailable. Please try again shortly.";
  if (e.statusCode === 400 || e.statusCode === 422)
    return "The model rejected the studio’s request format. Try another model in Connections or report this app compatibility error.";
  return "Could not reach the AI provider. Check your internet connection and try again.";
}
