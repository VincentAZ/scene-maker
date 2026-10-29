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
