import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";

// End-to-end sign-in, test and disconnect routes against a local studio
// service, with every provider endpoint mocked.
let server: Server, base: string, dir: string;
const realFetch = globalThis.fetch;
type Handler = (url: URL, init?: RequestInit) => Promise<Response> | Response;
let upstream: Handler = () => {
  throw Error("unexpected upstream request");
};
const upstreamCalls: { url: URL; init?: RequestInit }[] = [];
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-signin-test-"));
  process.env.SCENE_MAKER_DATA = dir;
  process.env.NODE_ENV = "test";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      return realFetch(input, init);
    upstreamCalls.push({ url, init });
    return upstream(url, init);
  });
  const { app } = await import("../server/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const post = (url: string, body: unknown) =>
  realFetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scene-Maker": "1" },
    body: JSON.stringify(body),
  });
const settings = async () =>
  (await realFetch(base + "/api/connections")).json();
const rawConnections = () =>
  fs.readFileSync(path.join(dir, "connections.json"), "utf8");

describe("Sign in with OpenRouter", () => {
  it("runs the PKCE flow end to end and never returns the key", async () => {
    const start = await post("/api/connections/signin", {
      provider: "openrouter",
    });
    expect(start.status).toBe(200);
    expect(start.headers.get("cache-control")).toBe("no-store");
    const { url, attempt } = await start.json();
    const auth = new URL(url);
    const params = Object.fromEntries(auth.searchParams);
    expect(auth.origin).toBe("https://openrouter.ai");
    expect(params.code_challenge_method).toBe("S256");
    expect(params.callback_url).toBe(
      `http://localhost:${new URL(base).port}/api/connections/callback/openrouter`,
    );
    // The verifier stays on the server; the browser only sees its challenge.
    expect(JSON.stringify({ url, attempt })).not.toMatch(/verifier/);

    // A forged state is refused before any exchange happens.
    const forged = await realFetch(
      `${params.callback_url}?code=abc&state=forged`,
    );
    expect(forged.status).toBe(400);
    expect(upstreamCalls).toHaveLength(0);

    upstream = async (target, init) => {
      expect(target.href).toBe("https://openrouter.ai/api/v1/auth/keys");
      const body = JSON.parse(String(init?.body));
      expect(
        crypto
          .createHash("sha256")
          .update(body.code_verifier)
          .digest("base64url"),
      ).toBe(params.code_challenge);
      expect(body.code).toBe("auth-code");
      return json({ key: "sk-or-v1-signin-fixture" });
    };
    const callback = await realFetch(
      `${params.callback_url}?code=auth-code&state=${params.state}`,
    );
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain("You’re connected");
    expect(
      await (
        await realFetch(`${base}/api/connections/signin/${attempt}`)
      ).json(),
    ).toMatchObject({ status: "done" });

    const saved = await settings();
    expect(saved.providers.openrouter).toMatchObject({
      connected: true,
      method: "openrouter",
    });
    expect(saved.providers.openrouter.verifiedAt).toBeTruthy();
    expect(JSON.stringify(saved)).not.toContain("sk-or-v1-signin-fixture");
    expect(rawConnections()).toContain("sk-or-v1-signin-fixture");

    // The state is single-use.
    const replay = await realFetch(
      `${params.callback_url}?code=auth-code&state=${params.state}`,
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toContain("already used");
  });
  it("reports a failed exchange to the waiting studio", async () => {
    const { url, attempt } = await (
      await post("/api/connections/signin", { provider: "openrouter" })
    ).json();
    const params = new URL(url).searchParams;
    upstream = async () => json({ error: "nope" }, 403);
    const callback = await realFetch(
      `${params.get("callback_url")}?code=bad&state=${params.get("state")}`,
    );
    expect(callback.status).toBe(400);
    expect(
      await (
        await realFetch(`${base}/api/connections/signin/${attempt}`)
      ).json(),
    ).toMatchObject({ status: "error", message: /invalid or expired/ });
  });
});

describe("connection tests and disconnect", () => {
  it("tests the saved credential, records the time and maps failures", async () => {
    upstream = async (target, init) => {
      expect(target.href).toBe("https://openrouter.ai/api/v1/key");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer sk-or-v1-signin-fixture",
      );
      return json({ data: { label: "Scene Maker" } });
    };
    const ok = await (
      await post("/api/connections/test", { provider: "openrouter" })
    ).json();
    expect(ok).toMatchObject({ ok: true });
    expect((await settings()).providers.openrouter.verifiedAt).toBe(
      ok.verifiedAt,
    );

    upstream = async () => json({ error: { message: "bad sk-draft" } }, 401);
    const failed = await (
      await post("/api/connections/test", {
        provider: "openai",
        key: "sk-draft",
      })
    ).json();
    expect(failed).toEqual({
      ok: false,
      error:
        "The provider rejected the API key. Replace it in Studio settings → Connections.",
    });
    // Draft keys are only tested, never saved.
    expect((await settings()).providers.openai.connected).toBe(false);
    expect(rawConnections()).not.toContain("sk-draft");
  });
  it("disconnects and forgets the credential", async () => {
    const response = await post("/api/connections/disconnect", {
      provider: "openrouter",
    });
    expect(response.status).toBe(200);
    expect((await settings()).providers.openrouter).toEqual({
      connected: false,
      model: "",
      thinking: "default",
    });
    expect(rawConnections()).not.toContain("sk-or-v1-signin-fixture");
  });
});

describe("Sign in with ChatGPT", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1" };
  const sign = (payload: object) => {
    const head = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "k1" }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${head}.${body}.${crypto
      .sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey)
      .toString("base64url")}`;
  };
  it("registers, verifies and stores a plan session without exposing tokens", async () => {
    const { url, attempt } = await (
      await post("/api/connections/signin", { provider: "openai" })
    ).json();
    const params = Object.fromEntries(new URL(url).searchParams);
    expect(params.client_id).toBe("dynamic_agent_client");
    expect(params.ext_agent_host_id).toMatch(/^urn:uuid:/);
    expect(params.redirect_uri).toBe(
      `http://127.0.0.1:${new URL(base).port}/api/connections/callback/chatgpt`,
    );
    upstream = async (target, init) => {
      if (target.pathname.endsWith("/jwks.json")) return json({ keys: [jwk] });
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("client_id")).toBe("oaiapp_fixture");
      expect(form.get("redirect_uri")).toBe(params.redirect_uri);
      return json({
        access_token: "chatgpt-access-fixture",
        refresh_token: "chatgpt-refresh-fixture",
        id_token: sign({
          iss: "https://auth.openai.com",
          aud: "oaiapp_fixture",
          sub: "account-fixture",
          email: "person@example.com",
          nonce: params.nonce,
          exp: Date.now() / 1000 + 3600,
        }),
        expires_in: 3600,
        scope: "openid email offline_access chatgpt.tokens.use.direct",
      });
    };
    const callback = await realFetch(
      `${params.redirect_uri}?code=c1&state=${params.state}&client_id=oaiapp_fixture`,
    );
    expect(callback.status).toBe(200);
    expect(
      await (
        await realFetch(`${base}/api/connections/signin/${attempt}`)
      ).json(),
    ).toMatchObject({ status: "done", message: /person@example.com/ });
    const saved = await settings();
    expect(saved.providers.openai).toMatchObject({
      connected: true,
      method: "chatgpt",
      account: "person@example.com",
      planUsage: true,
    });
    const visible = JSON.stringify(saved);
    for (const secret of [
      "chatgpt-access-fixture",
      "chatgpt-refresh-fixture",
      "account-fixture",
      "oaiapp_fixture",
    ])
      expect(visible).not.toContain(secret);
    // ChatGPT plans do not cover OpenAI voices.
    expect(saved.speech.openai).toBe(false);

    // Signing in again reuses the issued client and rejects a different one.
    const again = await (
      await post("/api/connections/signin", { provider: "openai" })
    ).json();
    const second = Object.fromEntries(new URL(again.url).searchParams);
    expect(second.client_id).toBe("oaiapp_fixture");
    expect(second.ext_agent_host_id).toBe(params.ext_agent_host_id);
    const mismatch = await realFetch(
      `${second.redirect_uri}?code=c2&state=${second.state}&client_id=oaiapp_other`,
    );
    expect(mismatch.status).toBe(400);
  });
  it("lists plan models with the session token", async () => {
    upstream = async (target, init) => {
      expect(target.href).toBe("https://api.openai.com/v1/models");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer chatgpt-access-fixture",
      );
      return json({
        models: [
          { slug: "gpt-plan-b", display_name: "Plan B", visibility: "list" },
          { slug: "gpt-hidden", display_name: "Hidden", visibility: "hide" },
          { slug: "gpt-plan-a", display_name: "Plan A", visibility: "list" },
        ],
      });
    };
    expect(
      await (
        await post("/api/connections/models", { provider: "openai" })
      ).json(),
    ).toEqual({
      models: [
        { id: "gpt-plan-b", name: "Plan B" },
        { id: "gpt-plan-a", name: "Plan A" },
      ],
    });
  });
  it("revokes the session on sign-out", async () => {
    upstream = async (target, init) => {
      expect(target.href).toBe(
        "https://auth.openai.com/api/accounts/oauth/revoke",
      );
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("token")).toBe("chatgpt-refresh-fixture");
      expect(form.get("token_type_hint")).toBe("refresh_token");
      return new Response("", { status: 200 });
    };
    expect(
      await (
        await post("/api/connections/disconnect", { provider: "openai" })
      ).json(),
    ).toEqual({ ok: true, revoked: true });
    expect((await settings()).providers.openai.connected).toBe(false);
    expect(rawConnections()).not.toContain("chatgpt-refresh-fixture");
  });
});
