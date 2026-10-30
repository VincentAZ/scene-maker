import { describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import {
  PendingSignIns,
  chatGPTAuthUrl,
  createPkce,
  exchangeChatGPTCode,
  exchangeOpenRouterCode,
  openRouterAuthUrl,
  pkceChallenge,
  refreshChatGPTSession,
} from "../server/providerAuth";
import { testProviderConnection } from "../server/providerModels";
import {
  chatGPTAccessToken,
  collectResponseStream,
  planRequestBody,
  useChatGPTCredentialStore,
} from "../server/chatgptTransport";
import { providerErrorMessage } from "../server/providerErrors";
import { modelFor, type Config } from "../server/ai";
import { generateText } from "ai";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("PKCE", () => {
  it("derives the S256 challenge from the RFC 7636 test vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
  it("creates fresh, URL-safe verifiers of a valid length", () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).not.toBe(b.verifier);
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.challenge).toBe(pkceChallenge(a.verifier));
    expect(a.challenge).not.toMatch(/[+/=]/);
  });
});

describe("pending sign-in state", () => {
  it("accepts a state once and rejects unknown, reused and expired states", () => {
    let now = 1_000;
    const pending = new PendingSignIns<{ verifier: string }>(60_000, () => now);
    const { state, attempt } = pending.create({ verifier: "v1" });
    expect(pending.status(attempt)).toEqual({ status: "pending" });
    expect(() => pending.consume("wrong-state")).toThrow(/not valid/);
    expect(() => pending.consume(undefined)).toThrow(/not valid/);
    expect(pending.consume(state)).toEqual({
      attempt,
      data: { verifier: "v1" },
    });
    expect(() => pending.consume(state)).toThrow(/already used/);

    const late = pending.create({ verifier: "v2" });
    now += 60_001;
    expect(() => pending.consume(late.state)).toThrow(/expired/);
    expect(pending.status(late.attempt)).toMatchObject({ status: "error" });
    // An expired state stays unusable even when retried.
    expect(() => pending.consume(late.state)).toThrow(/not valid/);
  });
  it("reports results and forgets cancelled attempts", () => {
    const pending = new PendingSignIns<object>();
    const one = pending.create({});
    pending.finish(one.attempt, { status: "done", message: "ok" });
    expect(pending.status(one.attempt)).toEqual({
      status: "done",
      message: "ok",
    });
    const two = pending.create({});
    pending.cancel(two.attempt);
    expect(pending.status(two.attempt)).toBeUndefined();
    expect(() => pending.consume(two.state)).toThrow();
  });
});

describe("OpenRouter OAuth PKCE", () => {
  it("builds the authorization URL with S256, state and the local callback", () => {
    const url = new URL(
      openRouterAuthUrl({
        callbackUrl:
          "http://localhost:4311/api/connections/callback/openrouter",
        challenge: "challenge",
        state: "state",
      }),
    );
    expect(url.origin + url.pathname).toBe("https://openrouter.ai/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      callback_url: "http://localhost:4311/api/connections/callback/openrouter",
      code_challenge: "challenge",
      code_challenge_method: "S256",
      state: "state",
    });
  });
  it("exchanges the code and verifier for a user key", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ key: "sk-or-v1-fixture" }),
    );
    await expect(
      exchangeOpenRouterCode("the-code", "the-verifier", request),
    ).resolves.toBe("sk-or-v1-fixture");
    const [url, init] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/auth/keys");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      code: "the-code",
      code_verifier: "the-verifier",
      code_challenge_method: "S256",
    });
  });
  it("explains rejected or malformed exchanges without echoing the body", async () => {
    await expect(
      exchangeOpenRouterCode("c", "v", async () =>
        jsonResponse({ error: "secret-detail" }, 403),
      ),
    ).rejects.toThrow(/invalid or expired/);
    await expect(
      exchangeOpenRouterCode("c", "v", async () => jsonResponse({})),
    ).rejects.toThrow(/unexpected response/);
    await expect(
      exchangeOpenRouterCode("c", "v", async () => {
        throw Error("offline");
      }),
    ).rejects.toThrow(/internet connection/);
  });
});

describe("Sign in with ChatGPT", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const sign = (payload: object) => {
    const head = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = crypto
      .sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey)
      .toString("base64url");
    return `${head}.${body}.${signature}`;
  };
  const now = Date.UTC(2026, 9, 29);
  const idToken = (overrides: object = {}) =>
    sign({
      iss: "https://auth.openai.com",
      aud: "oaiapp_fixture",
      sub: "user-fixture",
      email: "person@example.com",
      nonce: "nonce-fixture",
      exp: now / 1000 + 3600,
      ...overrides,
    });
  const server =
    (token: object, status = 200) =>
    async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/.well-known/jwks.json"))
        return jsonResponse({ keys: [jwk] });
      server.last = new URLSearchParams(String(init?.body));
      return jsonResponse(token, status);
    };
  server.last = new URLSearchParams();
  const exchange = (token: object, nonce = "nonce-fixture") =>
    exchangeChatGPTCode(
      {
        code: "code-fixture",
        verifier: "verifier-fixture",
        redirectUri: "http://127.0.0.1:4311/api/connections/callback/chatgpt",
        clientId: "oaiapp_fixture",
        nonce,
      },
      server(token) as typeof fetch,
      now,
    );
  const tokens = (overrides: object = {}) => ({
    access_token: "access-fixture",
    refresh_token: "refresh-fixture",
    id_token: idToken(),
    expires_in: 3600,
    scope:
      "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    ...overrides,
  });

  it("builds a first-registration authorization request on 127.0.0.1", () => {
    const url = new URL(
      chatGPTAuthUrl({
        redirectUri: "http://127.0.0.1:4311/api/connections/callback/chatgpt",
        hostId: "urn:uuid:host",
        challenge: "challenge",
        state: "state",
        nonce: "nonce",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://auth.openai.com/api/accounts/authorize",
    );
    const params = Object.fromEntries(url.searchParams);
    expect(params).toMatchObject({
      client_id: "dynamic_agent_client",
      agent_name_hint: "Scene Maker",
      ext_agent_host_id: "urn:uuid:host",
      response_type: "code",
      resource: "https://api.openai.com/v1",
      code_challenge_method: "S256",
    });
    expect(params.scope.split(" ")).toContain("chatgpt.tokens.use.direct");
    expect(params.redirect_uri).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });
  it("exchanges the code, verifies the ID token and records plan usage", async () => {
    const { accessToken, session } = await exchange(tokens());
    expect(accessToken).toBe("access-fixture");
    expect(session).toMatchObject({
      clientId: "oaiapp_fixture",
      refreshToken: "refresh-fixture",
      account: "user-fixture",
      email: "person@example.com",
      planUsage: true,
      expiresAt: now + 3600_000,
    });
    expect(Object.fromEntries(server.last)).toEqual({
      grant_type: "authorization_code",
      client_id: "oaiapp_fixture",
      code: "code-fixture",
      code_verifier: "verifier-fixture",
      redirect_uri: "http://127.0.0.1:4311/api/connections/callback/chatgpt",
      resource: "https://api.openai.com/v1",
    });
  });
  it("keeps the sign-in but disables plan usage when consent was declined", async () => {
    const { session } = await exchange(
      tokens({ scope: "openid profile email offline_access" }),
    );
    expect(session.planUsage).toBe(false);
  });
  it("rejects ID tokens with a wrong nonce, audience, issuer or signature", async () => {
    await expect(exchange(tokens(), "other-nonce")).rejects.toThrow(
      /could not be verified/,
    );
    await expect(
      exchange(tokens({ id_token: idToken({ aud: "oaiapp_other" }) })),
    ).rejects.toThrow(/could not be verified/);
    await expect(
      exchange(tokens({ id_token: idToken({ iss: "https://evil.example" }) })),
    ).rejects.toThrow(/could not be verified/);
    const forged = idToken().split(".");
    forged[1] = Buffer.from(
      JSON.stringify({ sub: "attacker", nonce: "nonce-fixture" }),
    ).toString("base64url");
    await expect(
      exchange(tokens({ id_token: forged.join(".") })),
    ).rejects.toThrow(/could not be verified/);
  });
  it("rotates refresh tokens and flags an ended session", async () => {
    const { session } = await exchange(tokens());
    const refreshed = await refreshChatGPTSession(
      session,
      server(
        tokens({ access_token: "access-2", refresh_token: "refresh-2" }),
      ) as typeof fetch,
      now,
    );
    expect(refreshed.accessToken).toBe("access-2");
    expect(refreshed.session.refreshToken).toBe("refresh-2");
    expect(server.last.get("grant_type")).toBe("refresh_token");
    expect(server.last.get("client_id")).toBe("oaiapp_fixture");
    await expect(
      refreshChatGPTSession(
        session,
        server({ error: "refresh_token_reused" }, 400) as typeof fetch,
      ),
    ).rejects.toMatchObject({ ended: true });
  });
});

describe("ChatGPT plan transport", () => {
  it("forces unstored streaming requests without unsupported fields", () => {
    expect(
      planRequestBody({
        model: "gpt-fixture",
        temperature: 0.2,
        max_output_tokens: 100,
        previous_response_id: "r1",
        input: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hi" },
        ],
      }),
    ).toEqual({
      model: "gpt-fixture",
      store: false,
      stream: true,
      input: [
        { role: "developer", content: "Be brief." },
        { role: "user", content: "Hi" },
      ],
    });
  });
  const stream = (...events: object[]) =>
    new Response(
      events
        .map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`)
        .join(""),
    );
  it("turns a completed event stream into a regular response body", async () => {
    const response = await collectResponseStream(
      stream(
        { type: "response.created", response: { id: "r1" } },
        { type: "response.output_text.delta", delta: "Hi" },
        { type: "response.completed", response: { id: "r1", output: [] } },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "r1", output: [] });
  });
  it("maps plan usage failures to HTTP errors the studio explains", async () => {
    const response = await collectResponseStream(
      stream({
        type: "response.failed",
        response: {
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "limit",
          },
        },
      }),
    );
    expect(response.status).toBe(429);
    const responseBody = await response.text();
    expect(
      providerErrorMessage({
        name: "AI_APICallError",
        statusCode: 429,
        responseBody,
      }),
    ).toMatch(/usage limit/);
    expect((await collectResponseStream(stream())).status).toBe(502);
  });
});

describe("test connection", () => {
  it("reports success with the number of models", async () => {
    const request = vi.fn(async () =>
      jsonResponse({ data: [{ id: "a" }, { id: "b" }] }),
    );
    await expect(
      testProviderConnection("openai", " sk-fixture ", request),
    ).resolves.toEqual({ ok: true, models: 2 });
    const [url, init] = request.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-fixture" });
  });
  it("checks OpenRouter keys against its key endpoint", async () => {
    const request = vi.fn(async () => jsonResponse({ data: { label: "x" } }));
    await expect(
      testProviderConnection("openrouter", "sk-or-v1-fixture", request),
    ).resolves.toEqual({ ok: true });
    expect(String((request.mock.calls[0] as unknown[])[0])).toBe(
      "https://openrouter.ai/api/v1/key",
    );
  });
  it("maps failures to the studio's provider messages without echoing bodies", async () => {
    const failing = (status: number, body: object) => async () =>
      jsonResponse(body, status);
    const rejected = await testProviderConnection(
      "anthropic",
      "sk-ant-fixture",
      failing(401, { error: { message: "key sk-ant-fixture invalid" } }),
    );
    expect(rejected).toEqual({
      ok: false,
      error: providerErrorMessage({ name: "AI_APICallError", statusCode: 401 }),
    });
    expect(JSON.stringify(rejected)).not.toContain("sk-ant-fixture");
    expect(
      await testProviderConnection(
        "google",
        "fixture",
        failing(400, {
          error: {
            message: "API key not valid",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rejected the API key/),
    });
    expect(
      await testProviderConnection(
        "xai",
        "fixture",
        failing(400, {
          code: "invalid-argument",
          error: "Incorrect API key provided.",
        }),
      ),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/rejected the API key/),
    });
    expect(
      await testProviderConnection(
        "openai",
        "fixture",
        failing(429, { error: { code: "insufficient_quota" } }),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/credit/) });
    expect(
      await testProviderConnection("xai", "fixture", failing(503, {})),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/temporarily/) });
    expect(
      await testProviderConnection("kimi", "fixture", async () => {
        throw Error("offline");
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/internet/) });
    expect(
      await testProviderConnection(
        "openai",
        "sk-or-v1-fixture",
        failing(200, {}),
      ),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/OpenRouter/) });
  });
});

describe("ChatGPT plan models", () => {
  const planConfig = (planUsage: boolean): Config => ({
    assistant: null,
    blender: "blender",
    providers: {
      openai: {
        key: planUsage ? "plan-access" : "",
        model: "gpt-plan",
        method: "chatgpt",
        chatgpt: {
          clientId: "oaiapp_fixture",
          refreshToken: "refresh",
          idToken: "id",
          expiresAt: Date.now() + 3600_000,
          scopes: planUsage ? ["chatgpt.tokens.use.direct"] : [],
          account: "acct",
          planUsage,
        },
      },
    },
  });
  it("sends unstored streaming Responses requests and returns the completed reply", async () => {
    const sent: { url: string; body: Record<string, unknown>; auth: string }[] =
      [];
    const completed = {
      id: "resp_1",
      object: "response",
      created_at: 1,
      model: "gpt-plan",
      status: "completed",
      output: [
        {
          type: "message",
          id: "msg_1",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Hello!", annotations: [] }],
        },
      ],
      usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
    };
    const event = (body: object) => `data: ${JSON.stringify(body)}\n\n`;
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input, init) => {
        sent.push({
          url: String(input),
          body: JSON.parse(String(init?.body)),
          auth: new Headers(init?.headers).get("authorization") || "",
        });
        return new Response(
          event({
            type: "response.created",
            response: { ...completed, status: "in_progress", output: [] },
          }) + event({ type: "response.completed", response: completed }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      });
    try {
      const { text } = await generateText({
        model: modelFor(planConfig(true), "openai"),
        system: "Be brief.",
        prompt: "Hi",
        temperature: 0.3,
        maxOutputTokens: 50,
        maxRetries: 0,
      });
      expect(text).toBe("Hello!");
    } finally {
      spy.mockRestore();
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.openai.com/v1/responses");
    expect(sent[0].auth).toBe("Bearer plan-access");
    expect(sent[0].body).toMatchObject({
      model: "gpt-plan",
      store: false,
      stream: true,
    });
    expect(sent[0].body).not.toHaveProperty("temperature");
    expect(sent[0].body).not.toHaveProperty("max_output_tokens");
    expect(JSON.stringify(sent[0].body.input)).not.toContain('"system"');
  });
  it("refreshes an expiring token once for concurrent requests and saves the rotation", async () => {
    let stored = planConfig(true);
    stored.providers.openai!.chatgpt!.expiresAt = Date.now() - 1;
    useChatGPTCredentialStore({
      read: () => structuredClone(stored),
      write: (next) => (stored = structuredClone(next)),
    });
    const request = vi.fn(async () =>
      jsonResponse({
        access_token: "fresh-access",
        refresh_token: "rotated-refresh",
        expires_in: 3600,
      }),
    );
    try {
      const tokens = await Promise.all([
        chatGPTAccessToken(stored, request),
        chatGPTAccessToken(stored, request),
      ]);
      expect(tokens).toEqual(["fresh-access", "fresh-access"]);
      expect(request).toHaveBeenCalledTimes(1);
      expect(stored.providers.openai).toMatchObject({
        key: "fresh-access",
        chatgpt: { refreshToken: "rotated-refresh" },
      });
      // A confirmed revocation stops using the session.
      stored.providers.openai!.chatgpt!.expiresAt = Date.now() - 1;
      stored.assistant = "openai";
      await expect(
        chatGPTAccessToken(stored, async () =>
          jsonResponse({ error: "invalid_grant" }, 400),
        ),
      ).rejects.toThrow(/sign-in has ended/);
      expect(stored.providers.openai?.key).toBe("");
      expect(stored.assistant).toBeNull();
    } finally {
      useChatGPTCredentialStore(null);
    }
  });
  it("refuses to use a sign-in without plan consent", () => {
    expect(() => modelFor(planConfig(false), "openai")).toThrow(
      /plan usage was not allowed/,
    );
  });
});
