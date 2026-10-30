import crypto from "node:crypto";
import type { ChatGPTSession } from "./ai";

// Provider sign-in flows. Every flow runs server-side: the PKCE verifier,
// state, nonce and resulting credentials never reach the browser.

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** RFC 7636 PKCE pair with the S256 method. */
export function createPkce() {
  const verifier = base64url(crypto.randomBytes(48));
  return { verifier, challenge: pkceChallenge(verifier) };
}
export function pkceChallenge(verifier: string) {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}
export const randomToken = () => base64url(crypto.randomBytes(32));

export type SignInStatus =
  | { status: "pending" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/**
 * Pending sign-in attempts keyed by OAuth `state`. A state is accepted once
 * and only before it expires; the browser polls a separate attempt ID.
 */
export class PendingSignIns<T> {
  private byState = new Map<
    string,
    { attempt: string; expiresAt: number; data: T }
  >();
  private attempts = new Map<
    string,
    { expiresAt: number; result: SignInStatus }
  >();
  constructor(
    private ttlMs = 10 * 60_000,
    private now: () => number = Date.now,
  ) {}
  create(data: T) {
    this.purge();
    const state = randomToken();
    const attempt = crypto.randomUUID();
    const expiresAt = this.now() + this.ttlMs;
    this.byState.set(state, { attempt, expiresAt, data });
    this.attempts.set(attempt, { expiresAt, result: { status: "pending" } });
    return { state, attempt };
  }
  /** Validate and use up a callback state. Throws when unknown, reused or expired. */
  consume(state: unknown): { attempt: string; data: T } {
    const entry =
      typeof state === "string" ? this.byState.get(state) : undefined;
    if (!entry)
      throw Error(
        "This sign-in link is not valid or was already used. Start the sign-in again from Studio settings → Connections.",
      );
    this.byState.delete(state as string);
    if (this.now() > entry.expiresAt) {
      this.finish(entry.attempt, {
        status: "error",
        message: "The sign-in took too long and expired. Please try again.",
      });
      throw Error("This sign-in attempt expired. Please start it again.");
    }
    return { attempt: entry.attempt, data: entry.data };
  }
  finish(attempt: string, result: SignInStatus) {
    const entry = this.attempts.get(attempt);
    if (entry) entry.result = result;
  }
  status(attempt: string): SignInStatus | undefined {
    const entry = this.attempts.get(attempt);
    if (!entry) return;
    if (entry.result.status === "pending" && this.now() > entry.expiresAt)
      return {
        status: "error",
        message: "The sign-in took too long and expired. Please try again.",
      };
    return entry.result;
  }
  cancel(attempt: string) {
    for (const [state, entry] of this.byState)
      if (entry.attempt === attempt) this.byState.delete(state);
    this.attempts.delete(attempt);
  }
  private purge() {
    // Keep finished attempts briefly so the browser can read their result.
    const now = this.now();
    for (const [state, entry] of this.byState)
      if (now > entry.expiresAt) this.byState.delete(state);
    for (const [id, entry] of this.attempts)
      if (now > entry.expiresAt + this.ttlMs) this.attempts.delete(id);
  }
}

async function post(
  request: typeof fetch,
  url: string,
  body: URLSearchParams | object,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let response: Response;
  try {
    response = await request(url, {
      method: "POST",
      headers: {
        "Content-Type":
          body instanceof URLSearchParams
            ? "application/x-www-form-urlencoded"
            : "application/json",
        Accept: "application/json",
      },
      body: body instanceof URLSearchParams ? body : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw Object.assign(
      Error(
        "Could not reach the sign-in service. Check your internet connection and try again.",
      ),
      { network: true },
    );
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await response.json()) as Record<string, unknown>;
  } catch {
    /* status is enough */
  }
  return { status: response.status, json };
}

// ---------------------------------------------------------------- OpenRouter
// https://openrouter.ai/docs/use-cases/oauth-pkce

export function openRouterAuthUrl(options: {
  callbackUrl: string;
  challenge: string;
  state: string;
}) {
  const url = new URL("https://openrouter.ai/auth");
  url.searchParams.set("callback_url", options.callbackUrl);
  url.searchParams.set("code_challenge", options.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", options.state);
  url.searchParams.set("key_label", "Scene Maker");
  return url.toString();
}

/** Exchange an authorization code for the user's OpenRouter API key. */
export async function exchangeOpenRouterCode(
  code: string,
  verifier: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const { status, json } = await post(
    request,
    "https://openrouter.ai/api/v1/auth/keys",
    { code, code_verifier: verifier, code_challenge_method: "S256" },
  );
  if (status === 403)
    throw Error(
      "OpenRouter did not accept this sign-in (the code was invalid or expired). Please sign in again.",
    );
  if (status < 200 || status >= 300)
    throw Error("OpenRouter could not finish the sign-in. Please try again.");
  const key = json?.key;
  if (typeof key !== "string" || !key.trim() || key.length > 1000)
    throw Error(
      "OpenRouter returned an unexpected response. Please try again.",
    );
  return key.trim();
}

// ---------------------------------------------------- Sign in with ChatGPT
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in

export const chatGPTIssuer = "https://auth.openai.com";
const chatGPTAuthorize = `${chatGPTIssuer}/api/accounts/authorize`;
const chatGPTToken = `${chatGPTIssuer}/api/accounts/oauth/token`;
const chatGPTRevoke = `${chatGPTIssuer}/api/accounts/oauth/revoke`;
const chatGPTJwks = `${chatGPTIssuer}/.well-known/jwks.json`;
export const chatGPTResource = "https://api.openai.com/v1";
export const chatGPTPlanScope = "chatgpt.tokens.use.direct";
const chatGPTScopes = `openid profile email offline_access resource.invoke ${chatGPTPlanScope}`;
/** First sign-in on a host registers a new OAuth client for that account. */
const dynamicClient = "dynamic_agent_client";

export function newChatGPTHostId() {
  return `urn:uuid:${crypto.randomUUID()}`;
}

export function chatGPTAuthUrl(options: {
  redirectUri: string;
  hostId: string;
  clientId?: string;
  idTokenHint?: string;
  challenge: string;
  state: string;
  nonce: string;
}) {
  const url = new URL(chatGPTAuthorize);
  const params = url.searchParams;
  params.set("client_id", options.clientId || dynamicClient);
  if (!options.clientId) params.set("agent_name_hint", "Scene Maker");
  params.set("ext_agent_host_id", options.hostId);
  if (options.clientId && options.idTokenHint)
    params.set("id_token_hint", options.idTokenHint);
  params.set("response_type", "code");
  params.set("redirect_uri", options.redirectUri);
  params.set("scope", chatGPTScopes);
  params.set("resource", chatGPTResource);
  params.set("state", options.state);
  params.set("nonce", options.nonce);
  params.set("code_challenge", options.challenge);
  params.set("code_challenge_method", "S256");
  return url.toString();
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
};
const refreshEnded = new Set([
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
]);

function tokenError(json: Record<string, unknown> | null) {
  const error = json?.error;
  return typeof error === "string"
    ? error
    : typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
}

function readTokens(status: number, json: Record<string, unknown> | null) {
  if (status !== 200 || typeof json?.access_token !== "string")
    throw Object.assign(
      Error(
        refreshEnded.has(tokenError(json))
          ? "Your ChatGPT sign-in has ended. Sign in with ChatGPT again in Studio settings → Connections."
          : tokenError(json) === "invalid_client"
            ? "ChatGPT did not recognise this app’s registration. Sign in again and choose “Use a different ChatGPT account”."
            : status >= 500
              ? "ChatGPT sign-in is temporarily unavailable. Please try again shortly."
              : "ChatGPT could not finish the sign-in. Please try again.",
      ),
      {
        ended: refreshEnded.has(tokenError(json)),
        temporary: status >= 500,
      },
    );
  return json as unknown as TokenResponse;
}

function decodeJwt(token: string) {
  const parts = token.split(".");
  if (parts.length !== 3) throw Error("Malformed token.");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  return { header, payload, parts };
}

/** Verify an OpenAI ID token's signature (JWKS, RS256), issuer, audience, expiry and nonce. */
export async function validateChatGPTIdToken(
  idToken: string,
  expected: { clientId: string; nonce: string },
  request: typeof fetch = fetch,
  now = Date.now(),
) {
  const invalid = () =>
    Error(
      "ChatGPT returned a sign-in that could not be verified. Please try again.",
    );
  let decoded;
  try {
    decoded = decodeJwt(idToken);
  } catch {
    throw invalid();
  }
  const { header, payload, parts } = decoded;
  if (header.alg !== "RS256") throw invalid();
  let keys: (crypto.JsonWebKey & { kid?: string })[];
  try {
    const response = await request(chatGPTJwks, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    keys = ((await response.json()) as { keys: typeof keys }).keys;
  } catch {
    throw Error(
      "Could not reach ChatGPT to verify the sign-in. Check your connection and try again.",
    );
  }
  const jwk = keys?.find((key) => key.kid === header.kid);
  if (!jwk) throw invalid();
  const signed = crypto.verify(
    "RSA-SHA256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey({ key: jwk, format: "jwk" }),
    Buffer.from(parts[2], "base64url"),
  );
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (
    !signed ||
    payload.iss !== chatGPTIssuer ||
    !audience.includes(expected.clientId) ||
    typeof payload.exp !== "number" ||
    payload.exp * 1000 < now - 60_000 ||
    payload.nonce !== expected.nonce ||
    typeof payload.sub !== "string" ||
    !payload.sub
  )
    throw invalid();
  return {
    account: payload.sub as string,
    email: typeof payload.email === "string" ? payload.email : undefined,
  };
}

/** Exchange the callback code, verify the ID token, and build the stored session. */
export async function exchangeChatGPTCode(
  options: {
    code: string;
    verifier: string;
    redirectUri: string;
    clientId: string;
    nonce: string;
  },
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ accessToken: string; session: ChatGPTSession }> {
  const { status, json } = await post(
    request,
    chatGPTToken,
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: options.clientId,
      code: options.code,
      code_verifier: options.verifier,
      redirect_uri: options.redirectUri,
      resource: chatGPTResource,
    }),
  );
  const tokens = readTokens(status, json);
  if (!tokens.id_token || !tokens.refresh_token)
    throw Error("ChatGPT did not return a complete sign-in. Please try again.");
  const identity = await validateChatGPTIdToken(
    tokens.id_token,
    { clientId: options.clientId, nonce: options.nonce },
    request,
    now,
  );
  const scopes = (tokens.scope || "").split(/\s+/).filter(Boolean);
  return {
    accessToken: tokens.access_token,
    session: {
      clientId: options.clientId,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token,
      expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
      scopes,
      account: identity.account,
      email: identity.email,
      planUsage: scopes.includes(chatGPTPlanScope),
    },
  };
}

/** Rotate the refresh token. Throws with `ended` when the person must sign in again. */
export async function refreshChatGPTSession(
  session: ChatGPTSession,
  request: typeof fetch = fetch,
  now = Date.now(),
): Promise<{ accessToken: string; session: ChatGPTSession }> {
  const { status, json } = await post(
    request,
    chatGPTToken,
    new URLSearchParams({
      grant_type: "refresh_token",
      client_id: session.clientId,
      refresh_token: session.refreshToken,
      resource: chatGPTResource,
    }),
  );
  const tokens = readTokens(status, json);
  const scopes = tokens.scope
    ? tokens.scope.split(/\s+/).filter(Boolean)
    : session.scopes;
  return {
    accessToken: tokens.access_token,
    session: {
      ...session,
      refreshToken: tokens.refresh_token || session.refreshToken,
      idToken: tokens.id_token || session.idToken,
      expiresAt: now + (tokens.expires_in ?? 3600) * 1000,
      scopes,
      planUsage: scopes.includes(chatGPTPlanScope),
    },
  };
}

/** Revoke the refresh token. Resolves false when revocation was not confirmed. */
export async function revokeChatGPTSession(
  session: ChatGPTSession,
  request: typeof fetch = fetch,
) {
  try {
    const { status } = await post(
      request,
      chatGPTRevoke,
      new URLSearchParams({
        token: session.refreshToken,
        token_type_hint: "refresh_token",
        client_id: session.clientId,
      }),
    );
    return status === 200;
  } catch {
    return false;
  }
}
