import express from "express";
import { z } from "zod";
import type { Config } from "./ai";
import { providers } from "../shared/scene";
import { chatGPTAccessToken } from "./chatgptTransport";
import {
  PendingSignIns,
  chatGPTAuthUrl,
  createPkce,
  exchangeChatGPTCode,
  exchangeOpenRouterCode,
  newChatGPTHostId,
  openRouterAuthUrl,
  randomToken,
  revokeChatGPTSession,
} from "./providerAuth";
import { testProviderConnection } from "./providerModels";

type Pending =
  | { provider: "openrouter"; verifier: string }
  | {
      provider: "openai";
      verifier: string;
      nonce: string;
      redirectUri: string;
      hostId: string;
      clientId?: string;
    };

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

/** The small page the provider redirects back to; the studio polls for the result. */
function resultPage(res: express.Response, ok: boolean, message: string) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  );
  res.status(ok ? 200 : 400).type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scene Maker sign-in</title>
<style>body{font:15px/1.6 system-ui,sans-serif;background:#f6f8f1;color:#3f4d36;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;box-sizing:border-box}
main{max-width:420px;background:#fff;border:1px solid #dfe7d4;border-radius:10px;padding:24px}h1{font-size:18px;margin:0 0 8px}p{margin:0}</style></head>
<body><main><h1>${ok ? "You’re connected" : "Sign-in did not finish"}</h1><p>${escape(message)}</p>
<p style="margin-top:12px;color:#7d8b70">You can close this window and return to Scene Maker.</p></main>
${ok ? "<script>setTimeout(()=>window.close(),1500)</script>" : ""}</body></html>`);
}

/**
 * Connection tests, disconnects and provider sign-ins (OpenRouter OAuth PKCE
 * and Sign in with ChatGPT). Mounted at /api/connections.
 */
export function providerAuthRouter(options: {
  config: () => Config;
  save: (config: Config) => void;
  pending?: PendingSignIns<Pending>;
}) {
  const { config, save } = options;
  const pending = options.pending ?? new PendingSignIns<Pending>();
  const router = express.Router();
  const now = () => new Date().toISOString();

  router.post("/test", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = z
      .object({
        provider: z.enum(providers),
        key: z.string().trim().min(1).max(1000).optional(),
      })
      .parse(req.body);
    if (body.key) {
      // A draft key: check it without saving anything.
      res.json(await testProviderConnection(body.provider, body.key));
      return;
    }
    const saved = config().providers[body.provider];
    if (!saved?.key && saved?.method !== "chatgpt") {
      res.json({ ok: false, error: "Connect this provider first." });
      return;
    }
    let key = saved.key;
    if (saved.method === "chatgpt") {
      try {
        key = await chatGPTAccessToken(config());
      } catch (error) {
        res.json({ ok: false, error: (error as Error).message });
        return;
      }
    }
    const result = await testProviderConnection(body.provider, key);
    if (!result.ok) {
      res.json(result);
      return;
    }
    const verifiedAt = now();
    const c = config();
    const entry = c.providers[body.provider];
    if (entry && entry.method === saved.method) {
      entry.verifiedAt = verifiedAt;
      save(c);
    }
    res.json({ ...result, verifiedAt });
  });

  router.post("/disconnect", async (req, res) => {
    const { provider } = z
      .object({ provider: z.enum(providers) })
      .parse(req.body);
    const session = config().providers[provider]?.chatgpt;
    const revoked = session?.refreshToken
      ? await revokeChatGPTSession(session)
      : undefined;
    const c = config();
    c.providers[provider] = { key: "", model: "", thinking: "default" };
    if (c.assistant === provider) c.assistant = null;
    save(c);
    res.json({ ok: true, revoked });
  });

  router.post("/signin", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const body = z
      .object({
        provider: z.enum(["openrouter", "openai"]),
        /** Register a new ChatGPT client (a different account). */
        fresh: z.boolean().optional(),
      })
      .parse(req.body);
    const port = req.socket.localPort;
    const { verifier, challenge } = createPkce();
    if (body.provider === "openrouter") {
      const { state, attempt } = pending.create({
        provider: "openrouter",
        verifier,
      });
      res.json({
        attempt,
        url: openRouterAuthUrl({
          // OpenRouter documents localhost callbacks on any port.
          callbackUrl: `http://localhost:${port}/api/connections/callback/openrouter`,
          challenge,
          state,
        }),
      });
      return;
    }
    const c = config();
    let registration = c.registrations?.chatgpt;
    if (!registration) {
      // A stable, opaque ID for this computer, chosen before the first sign-in.
      registration = { hostId: newChatGPTHostId() };
      c.registrations = { ...c.registrations, chatgpt: registration };
      save(c);
    }
    const clientId = body.fresh ? undefined : registration.clientId;
    const saved = c.providers.openai?.chatgpt;
    // OpenAI requires a 127.0.0.1 loopback redirect, not localhost.
    const redirectUri = `http://127.0.0.1:${port}/api/connections/callback/chatgpt`;
    const nonce = randomToken();
    const { state, attempt } = pending.create({
      provider: "openai",
      verifier,
      nonce,
      redirectUri,
      hostId: registration.hostId,
      clientId,
    });
    res.json({
      attempt,
      url: chatGPTAuthUrl({
        redirectUri,
        hostId: registration.hostId,
        clientId,
        idTokenHint:
          clientId && saved?.clientId === clientId ? saved.idToken : undefined,
        challenge,
        state,
        nonce,
      }),
    });
  });

  router.get("/signin/:attempt", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const status = pending.status(String(req.params.attempt));
    if (!status) {
      res.status(404).json({ error: "This sign-in attempt is not active." });
      return;
    }
    res.json(status);
  });
  router.delete("/signin/:attempt", (req, res) => {
    pending.cancel(String(req.params.attempt));
    res.json({ ok: true });
  });

  router.get("/callback/openrouter", async (req, res) => {
    const { code, state } = req.query;
    if (typeof state !== "string" || typeof code !== "string" || !code) {
      resultPage(res, false, "OpenRouter sign-in was cancelled.");
      return;
    }
    let attempt = "";
    try {
      const consumed = pending.consume(state);
      attempt = consumed.attempt;
      if (consumed.data.provider !== "openrouter")
        throw Error("This sign-in link is not valid.");
      const key = await exchangeOpenRouterCode(code, consumed.data.verifier);
      const c = config();
      const prev = c.providers.openrouter;
      c.providers.openrouter = {
        key,
        model: prev?.model || "",
        thinking: prev?.thinking || "default",
        method: "openrouter",
        connectedAt: now(),
        verifiedAt: now(),
      };
      save(c);
      const message =
        "Scene Maker can now use your OpenRouter account. Choose a model in Connections.";
      pending.finish(attempt, { status: "done", message });
      resultPage(res, true, message);
    } catch (error) {
      const message = (error as Error).message;
      if (attempt) pending.finish(attempt, { status: "error", message });
      resultPage(res, false, message);
    }
  });

  router.get("/callback/chatgpt", async (req, res) => {
    const { code, state, error } = req.query;
    const issuedClient = req.query.client_id;
    let attempt = "";
    try {
      const consumed = pending.consume(state);
      attempt = consumed.attempt;
      const data = consumed.data;
      if (data.provider !== "openai")
        throw Error("This sign-in link is not valid.");
      if (error)
        throw Error(
          error === "access_denied"
            ? "ChatGPT sign-in was cancelled."
            : "ChatGPT did not complete the sign-in. Please try again.",
        );
      if (typeof code !== "string" || !code)
        throw Error("ChatGPT did not return a sign-in code. Please try again.");
      if (
        issuedClient !== undefined &&
        (typeof issuedClient !== "string" ||
          (data.clientId && issuedClient !== data.clientId))
      )
        throw Error(
          "ChatGPT returned a different app registration. Please try again.",
        );
      const clientId = data.clientId || issuedClient;
      if (typeof clientId !== "string" || !clientId)
        throw Error(
          "ChatGPT did not finish registering Scene Maker. Please try again.",
        );
      const { accessToken, session } = await exchangeChatGPTCode({
        code,
        verifier: data.verifier,
        redirectUri: data.redirectUri,
        clientId,
        nonce: data.nonce,
      });
      const c = config();
      const prev = c.providers.openai;
      c.registrations = {
        ...c.registrations,
        chatgpt: { hostId: data.hostId, clientId },
      };
      c.providers.openai = {
        key: session.planUsage ? accessToken : "",
        model: prev?.model || "",
        thinking: prev?.thinking || "default",
        method: "chatgpt",
        connectedAt: now(),
        verifiedAt: now(),
        chatgpt: session,
      };
      if (c.assistant === "openai" && !session.planUsage) c.assistant = null;
      save(c);
      const message = session.planUsage
        ? `Signed in to ChatGPT${session.email ? ` as ${session.email}` : ""}. Eligible studio requests now use your ChatGPT plan.`
        : "Signed in to ChatGPT, but using your ChatGPT plan was not allowed. Sign in again and allow it, or use an OpenAI API key.";
      pending.finish(attempt, { status: "done", message });
      resultPage(res, true, message);
    } catch (failure) {
      const message = (failure as Error).message;
      if (attempt) pending.finish(attempt, { status: "error", message });
      resultPage(res, false, message);
    }
  });
  return router;
}

export type { Pending as PendingSignIn };
