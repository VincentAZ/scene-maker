import { beforeAll, afterAll, describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { request as httpRequest, type Server } from "node:http";
import { starterScene } from "../shared/scene";
let server: Server, base: string, dir: string;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-test-"));
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
const req = (url: string, body?: unknown, method = "POST") =>
  fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", "X-Scene-Maker": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
describe("local service boundaries", () => {
  it("persists project revisions and rejects conflicting writes", async () => {
    const s = starterScene();
    let res = await req("/api/projects/" + s.id, s, "PUT");
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved.revision).toBe(1);
    res = await req("/api/projects/" + s.id, s, "PUT");
    expect(res.status).toBe(409);
    const loaded = await (await fetch(base + "/api/projects/" + s.id)).json();
    expect(loaded.name).toBe(s.name);
    expect(loaded.revision).toBe(1);
    const next = await req(
      "/api/projects/" + s.id,
      { ...saved, name: "Edited story" },
      "PUT",
    );
    expect((await next.json()).revision).toBe(2);
  });
  it("blocks cross-origin and unauthenticated mutation requests", async () => {
    expect(
      (
        await fetch(base + "/api/connections", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(base + "/api/projects", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    const status = await new Promise<number | undefined>((resolve) => {
      const request = httpRequest(
        base + "/api/projects",
        { headers: { Host: "evil.example" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      request.end();
    });
    expect(status).toBe(403);
  });
  it("redacts saved credentials and stores them with private permissions", async () => {
    const key = "test-secret-never-return-this";
    expect(
      (
        await req(
          "/api/connections",
          { provider: "openai", key, model: "test-model" },
          "PUT",
        )
      ).status,
    ).toBe(200);
    const response = await (await fetch(base + "/api/connections")).text();
    expect(response).not.toContain(key);
    expect(JSON.parse(response).providers.openai).toEqual({
      connected: true,
      model: "test-model",
    });
    expect(fs.statSync(path.join(dir, "connections.json")).mode & 0o777).toBe(
      0o600,
    );
  });
  it("validates imports before saving and rejects malformed assets", async () => {
    const s = starterScene();
    const bad = await req(
      "/api/projects/" + s.id,
      { ...s, entities: [{ invalid: true }] },
      "PUT",
    );
    expect(bad.status).toBe(400);
    expect(fs.existsSync(path.join(dir, "projects", s.id + ".json"))).toBe(
      false,
    );
    const form = new FormData();
    form.append("file", new Blob(["not a model"]), "broken.glb");
    expect(
      (
        await fetch(base + "/api/import", {
          method: "POST",
          headers: { "X-Scene-Maker": "1" },
          body: form,
        })
      ).status,
    ).toBe(400);
    expect(fs.readdirSync(path.join(dir, "uploads"))).toHaveLength(0);
  });
  it("round-trips offline assistant changes and reports missing conversation connections", async () => {
    const s = starterScene();
    const res = await req("/api/assistant", {
      scene: s,
      prompt: "Mila jump then wave",
    });
    const body = await res.json();
    expect(body.mode).toBe("offline");
    expect(body.commands).toHaveLength(2);
    const conversation = await req("/api/conversation", {
      scene: s,
      rounds: 1,
    });
    expect(conversation.status).toBe(400);
    expect((await conversation.json()).error).toContain(
      "Connect an AI provider",
    );
  });
});
