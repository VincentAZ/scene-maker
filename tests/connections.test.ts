import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { listProviderModels } from "../server/providerModels";
vi.mock("../server/providerModels", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/providerModels")>()),
  listProviderModels: vi.fn(),
}));
let server: Server, base: string, dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-connections-test-"));
  process.env.SCENE_MAKER_DATA = dir;
  process.env.NODE_ENV = "test";
  const { app } = await import("../server/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(dir, { recursive: true, force: true });
});
const req = (url: string, body: unknown, method = "PUT") =>
  fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", "X-Scene-Maker": "1" },
    body: JSON.stringify(body),
  });
const settings = async () => (await fetch(base + "/api/connections")).json();
describe("connection setup and persistence", () => {
  it("rejects selecting an incomplete provider", async () => {
    expect(
      (await req("/api/connections", { assistant: "openai" })).status,
    ).toBe(400);
    expect((await settings()).assistant).toBeNull();
  });
  it("discovers models using a draft key without saving it", async () => {
    vi.mocked(listProviderModels).mockResolvedValue([
      { id: "gpt-fixture", name: "Fixture" },
    ]);
    const res = await req(
      "/api/connections/models",
      { provider: "openai", key: " temporary-fixture " },
      "POST",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(listProviderModels).toHaveBeenLastCalledWith(
      "openai",
      "temporary-fixture",
    );
    expect((await settings()).providers.openai.connected).toBe(false);
  });
  it("saves key, model and assistant together, then reuses the saved key privately", async () => {
    expect(
      (
        await req("/api/connections", {
          provider: "openai",
          key: " saved-fixture ",
          model: "gpt-fixture",
          assistant: "openai",
        })
      ).status,
    ).toBe(200);
    const saved = await settings();
    expect(saved.assistant).toBe("openai");
    expect(saved.providers.openai).toEqual({
      connected: true,
      model: "gpt-fixture",
      thinking: "default",
      method: "key",
      connectedAt: expect.any(String),
    });
    expect(JSON.stringify(saved)).not.toContain("saved-fixture");
    await req("/api/connections/models", { provider: "openai" }, "POST");
    expect(listProviderModels).toHaveBeenLastCalledWith(
      "openai",
      "saved-fixture",
    );
    expect(fs.statSync(path.join(dir, "connections.json")).mode & 0o777).toBe(
      0o600,
    );
  });
  it("preserves the saved connection on a failed discovery and on a Blender-only save", async () => {
    vi.mocked(listProviderModels).mockRejectedValue(
      Error("The provider rejected this API key."),
    );
    expect(
      (
        await req(
          "/api/connections/models",
          { provider: "openai", key: "bad-fixture" },
          "POST",
        )
      ).status,
    ).toBe(400);
    await req("/api/connections", { blender: "/example/blender" });
    expect(await settings()).toMatchObject({
      assistant: "openai",
      blender: "/example/blender",
      providers: { openai: { connected: true, model: "gpt-fixture" } },
    });
  });
  it("switches provider and model immediately while retaining each provider's saved key and model", async () => {
    await req("/api/connections", {
      provider: "anthropic",
      key: "anthropic-fixture",
      model: "claude-fixture",
    });
    await req("/api/connections", { assistant: "anthropic" });
    expect(await settings()).toMatchObject({
      assistant: "anthropic",
      providers: {
        openai: { connected: true, model: "gpt-fixture" },
        anthropic: { connected: true, model: "claude-fixture" },
      },
    });
    await req("/api/connections", {
      assistant: "openai",
      provider: "openai",
      model: "gpt-fixture-quick",
    });
    expect(await settings()).toMatchObject({
      assistant: "openai",
      providers: {
        openai: { connected: true, model: "gpt-fixture-quick" },
        anthropic: { connected: true, model: "claude-fixture" },
      },
    });
    const before = await settings();
    expect(
      (await req("/api/connections", { assistant: "google" })).status,
    ).toBe(400);
    expect(await settings()).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("anthropic-fixture");
    vi.mocked(listProviderModels).mockResolvedValue([]);
    await req("/api/connections/models", { provider: "anthropic" }, "POST");
    expect(listProviderModels).toHaveBeenLastCalledWith(
      "anthropic",
      "anthropic-fixture",
    );
    await req("/api/connections/models", { provider: "openai" }, "POST");
    expect(listProviderModels).toHaveBeenLastCalledWith(
      "openai",
      "saved-fixture",
    );
  });
  it("preserves keys when changing only the model and clears the active assistant on disconnect", async () => {
    await req("/api/connections", {
      provider: "openai",
      model: "gpt-fixture-two",
    });
    expect((await settings()).providers.openai).toEqual({
      connected: true,
      model: "gpt-fixture-two",
      thinking: "default",
      method: "key",
      connectedAt: expect.any(String),
    });
    await req("/api/connections", { provider: "openai", key: "", model: "" });
    expect(await settings()).toMatchObject({
      assistant: null,
      providers: { openai: { connected: false, model: "" } },
    });
  });
  it("requires the local request header for credential-based discovery", async () => {
    expect(
      (
        await fetch(base + "/api/connections/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "openai" }),
        })
      ).status,
    ).toBe(403);
  });
});

it("persists thinking independently for each provider and rejects unsupported levels", async () => {
  expect(
    (
      await req("/api/connections", {
        provider: "anthropic",
        model: "claude-fable-5-1",
        thinking: "high",
      })
    ).status,
  ).toBe(200);
  expect((await settings()).providers.anthropic.thinking).toBe("high");
  await req("/api/connections", {
    provider: "openai",
    model: "gpt-6-luna",
    thinking: "low",
  });
  expect((await settings()).providers.anthropic.thinking).toBe("high");
  expect((await settings()).providers.openai.thinking).toBe("low");
  expect(
    (
      await req("/api/connections", {
        provider: "openai",
        thinking: "impossible",
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await req("/api/connections", {
        provider: "openai",
        model: "gpt-4o",
        thinking: "high",
      })
    ).status,
  ).toBe(400);
  await req("/api/connections", { provider: "openai", model: "gpt-4o" });
  expect((await settings()).providers.openai.thinking).toBe("default");
});
