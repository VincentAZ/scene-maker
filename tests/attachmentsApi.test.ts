import { afterAll, beforeAll, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { Attachment } from "../shared/attachments";
// The studio service reads its data directory on import, so set it first.
let server: Server, base: string, data: string;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);
beforeAll(async () => {
  data = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-attach-"));
  process.env.SCENE_MAKER_DATA = data;
  process.env.NODE_ENV = "test";
  const { app } = await import("../server/index");
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(data, { recursive: true, force: true });
});
const form = () => {
  const f = new FormData();
  f.append(
    "files",
    new Blob([new Uint8Array(PNG)], { type: "image/png" }),
    "a.png",
  );
  return f;
};
it("uploads Code panel attachments only with the studio header and a local origin", async () => {
  const url = base + "/api/coding/attachments";
  expect((await fetch(url, { method: "POST", body: form() })).status).toBe(403);
  const foreign = await fetch(url, {
    method: "POST",
    body: form(),
    headers: { "X-Scene-Maker": "1", Origin: "http://evil.example" },
  });
  expect(foreign.status).toBe(403);
  const ok = await fetch(url, {
    method: "POST",
    body: form(),
    headers: { "X-Scene-Maker": "1" },
  });
  expect(ok.status).toBe(200);
  const [attachment] = (await ok.json()).attachments as Attachment[];
  expect(attachment).toMatchObject({ name: "a.png", kind: "image" });
  expect(
    fs.existsSync(path.join(data, "coding-uploads", attachment.id, "a.png")),
  ).toBe(true);
});
it("rejects assistant images whose content does not match their type", async () => {
  const response = await fetch(base + "/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Scene-Maker": "1" },
    body: JSON.stringify({
      scene: (await import("../shared/scene")).starterScene(),
      prompt: "Use this",
      images: [
        {
          name: "x.webp",
          mediaType: "image/webp",
          data: PNG.toString("base64"),
        },
      ],
    }),
  });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("not a PNG");
});
