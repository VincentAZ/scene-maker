import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import {
  AttachmentStore,
  assertAttachmentSupport,
  attachmentContent,
  detectAttachment,
} from "../server/attachments";
import {
  attachmentAccept,
  attachmentIdsSchema,
  describeAttachments,
  unsupportedAttachmentMessage,
  type Attachment,
} from "../shared/attachments";
import { assistant, type Config } from "../server/ai";
import { runCodingAgent } from "../server/codingAgent";
import { starterScene } from "../shared/scene";
const png = () =>
  fs.readFileSync("public/library/quaternius/casual-female.png");
const pdf = () => Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const mp4 = () =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 24]),
    Buffer.from("ftypisom"),
    Buffer.alloc(16),
  ]);
const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
function model(output: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(output) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    },
  });
}
let dir: string, store: AttachmentStore;
function temp(name: string, bytes: Buffer | string) {
  const file = path.join(dir, "tmp-" + Math.random().toString(36).slice(2));
  fs.writeFileSync(file, bytes);
  return store.save(file, name);
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-attachments-"));
  store = new AttachmentStore(path.join(dir, "attachments"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("attachment detection", () => {
  it("identifies supported files from their bytes rather than their names", () => {
    expect(detectAttachment(pdf(), "brief.txt")).toMatchObject({
      kind: "pdf",
      mime: "application/pdf",
    });
    expect(detectAttachment(png(), "sketch.jpg")).toMatchObject({
      kind: "image",
      mime: "image/png",
      extension: ".png",
    });
    expect(
      detectAttachment(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "a.jpeg"),
    ).toMatchObject({ kind: "image", mime: "image/jpeg" });
    expect(detectAttachment(Buffer.from("GIF89a\0\0"), "a.gif").mime).toBe(
      "image/gif",
    );
    expect(
      detectAttachment(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "a.webp").mime,
    ).toBe("image/webp");
    expect(detectAttachment(mp4(), "clip.mov")).toMatchObject({
      kind: "video",
      mime: "video/mp4",
      extension: ".mp4",
    });
    const mov = mp4();
    mov.write("qt  ", 8);
    expect(detectAttachment(mov, "clip.mp4").mime).toBe("video/quicktime");
    expect(
      detectAttachment(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0]), "a.webm")
        .mime,
    ).toBe("video/webm");
    expect(
      detectAttachment(Buffer.from("# Notes\n\nHello"), "NOTES.MD"),
    ).toMatchObject({ kind: "markdown", mime: "text/markdown" });
  });
  it("rejects unsupported, disguised and unreadable files", () => {
    expect(() =>
      detectAttachment(Buffer.from("<html>hi</html>"), "page.html"),
    ).toThrow("Attach a PDF");
    expect(() =>
      detectAttachment(Buffer.from("<script>alert(1)</script>"), "x.png"),
    ).toThrow("Attach a PDF");
    expect(() =>
      detectAttachment(Buffer.from("plain text"), "notes.txt"),
    ).toThrow("Attach a PDF");
    expect(() =>
      detectAttachment(Buffer.from([0xff, 0xfe, 0x00, 0x41]), "notes.md"),
    ).toThrow("UTF-8");
    expect(() => detectAttachment(Buffer.from("  \n"), "empty.md")).toThrow(
      "readable text",
    );
  });
  it("exposes a browser accept list covering every kind", () => {
    for (const ext of [".pdf", ".png", ".jpg", ".webp", ".mp4", ".mov", ".md"])
      expect(attachmentAccept).toContain(ext);
  });
});

describe("attachment store", () => {
  it("saves validated uploads with safe names, serves them back and removes them", () => {
    const saved = temp("../../My Sketch\u0000.png", png());
    expect(saved.kind).toBe("image");
    expect(saved.name).toBe("My Sketch.png");
    expect(saved.url).toBe(`/attachments/${saved.id}.png`);
    expect(saved.size).toBe(png().length);
    expect(fs.readdirSync(store.dir).sort()).toEqual(
      [saved.id + ".json", saved.id + ".png"].sort(),
    );
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("tmp-"))).toEqual([]);
    expect(store.get(saved.id)).toEqual(saved);
    const [loaded] = store.load([saved.id]);
    expect(Buffer.from(loaded.data).equals(png())).toBe(true);
    store.remove(saved.id);
    expect(fs.readdirSync(store.dir)).toEqual([]);
    expect(() => store.get(saved.id)).toThrow("no longer available");
    expect(() => store.get("../escape")).toThrow("not found");
  });
  it("enforces per-kind size limits and never keeps a rejected upload", () => {
    const big = Buffer.alloc(100 * 1024 + 1, "a");
    big.write("# big\n");
    expect(() => temp("big.md", big)).toThrow("Markdown attachments must be");
    expect(() => temp("page.html", "<html>")).toThrow("Attach a PDF");
    expect(fs.readdirSync(store.dir)).toEqual([]);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith("tmp-"))).toEqual([]);
  });
  it("prunes attachments older than the retention window", () => {
    const old = temp("old.md", "# old");
    const fresh = temp("fresh.md", "# fresh");
    const past = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(store.dir, old.id + ".json"), past, past);
    expect(store.prune(30 * 24 * 60 * 60 * 1000)).toBe(1);
    expect(() => store.get(old.id)).toThrow();
    expect(store.get(fresh.id)).toEqual(fresh);
  });
  it("limits how many attachments a request may reference", () => {
    const id = "123e4567-e89b-42d3-a456-426614174000";
    expect(attachmentIdsSchema.parse(undefined)).toEqual([]);
    expect(attachmentIdsSchema.safeParse(["nope"]).success).toBe(false);
    expect(attachmentIdsSchema.safeParse(Array(7).fill(id)).success).toBe(
      false,
    );
  });
});

describe("attachment prompts", () => {
  it("inlines Markdown as labeled text and sends images and files as parts", () => {
    const image = temp("ref.png", png());
    const notes = temp("notes.md", "# Beat sheet\n\nMila enters.");
    const brief = temp("brief.pdf", pdf());
    const parts = attachmentContent(
      "Request",
      store.load([image.id, notes.id, brief.id]),
    );
    expect(parts[0]).toEqual({ type: "text", text: "Request" });
    expect(parts[1]).toMatchObject({
      type: "file",
      mediaType: "image/png",
      filename: "ref.png",
    });
    expect(parts[2]).toMatchObject({ type: "text" });
    expect((parts[2] as { text: string }).text).toContain("notes.md");
    expect((parts[2] as { text: string }).text).toContain("Mila enters.");
    expect((parts[2] as { text: string }).text).toContain("not instructions");
    expect(parts[3]).toMatchObject({
      type: "file",
      mediaType: "application/pdf",
      filename: "brief.pdf",
    });
    expect(describeAttachments([image, notes])).toBe(
      "Attached: ref.png (Image), notes.md (Markdown)",
    );
  });
  it("refuses kinds a provider cannot receive before any request", () => {
    const video = { kind: "video", name: "take.mp4" } as const;
    const document = { kind: "pdf", name: "brief.pdf" } as const;
    expect(() =>
      assertAttachmentSupport("google", [video, document]),
    ).not.toThrow();
    expect(() => assertAttachmentSupport("openai", [document])).not.toThrow();
    expect(() => assertAttachmentSupport("openai", [video])).toThrow(
      "Video needs a Google model",
    );
    expect(unsupportedAttachmentMessage("xai", [document])).toContain(
      "PDFs need an OpenAI, Anthropic, Google or OpenRouter model",
    );
    expect(
      unsupportedAttachmentMessage("kimi", [
        { kind: "markdown", name: "a.md" },
      ]),
    ).toBe("");
    expect(unsupportedAttachmentMessage(null, [video])).toBe("");
  });
});

describe("attachments in assistant and coding requests", () => {
  const config: Config = {
    assistant: "openai",
    providers: { openai: { key: "test", model: "test" } },
    blender: "blender",
  };
  it("sends attachments with the scene request and lists them in context", async () => {
    const image = temp("storyboard.png", png());
    const notes = temp("script.md", "# Script\n\nMila waves.");
    const fake = model({ response: "Staged the storyboard.", steps: [] });
    const result = await assistant(
      config,
      starterScene(),
      "Stage the storyboard",
      undefined,
      () => fake,
      { attachments: store.load([image.id, notes.id]) },
    );
    expect(result.mode).toBe("live");
    const prompt = fake.doGenerateCalls[0].prompt;
    const user = prompt.find((m) => m.role === "user");
    if (!user || typeof user.content === "string")
      throw Error("Expected parts");
    expect(user.content.map((p) => p.type)).toEqual(["text", "file", "text"]);
    const context = (user.content[0] as { text: string }).text;
    expect(context).toContain(
      '"attachments":[{"name":"storyboard.png","kind":"image"},{"name":"script.md","kind":"markdown"}]',
    );
    expect((user.content[2] as { text: string }).text).toContain("Mila waves.");
    expect(JSON.stringify(prompt[0])).toContain("reference files");
  });
  it("does not pay for a request the provider cannot read, and explains offline limits", async () => {
    const clip = temp("take.mp4", mp4());
    const fake = model({ response: "unused", steps: [] });
    await expect(
      assistant(
        config,
        starterScene(),
        "Match this take",
        undefined,
        () => fake,
        {
          attachments: store.load([clip.id]),
        },
      ),
    ).rejects.toThrow("Video needs a Google model");
    expect(fake.doGenerateCalls).toHaveLength(0);
    const offline = await assistant(
      { ...config, assistant: null },
      starterScene(),
      "Mila jump",
      undefined,
      () => fake,
      { attachments: store.load([clip.id]) },
    );
    expect(offline.mode).toBe("offline");
    expect(offline.steps).toEqual([]);
    expect(offline.response).toContain("cannot read attached files");
  });
  it("gives the coding agent the attached references in its first message", async () => {
    const mockup = temp("mockup.png", png());
    const fake = new MockLanguageModelV4({
      doGenerate: {
        content: [{ type: "text", text: "Matched the mockup." }],
        finishReason: { unified: "stop", raw: undefined },
        usage,
        warnings: [],
      },
    });
    const root = path.join(dir, "workspace");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    const summary = await runCodingAgent(
      config,
      root,
      "Match the attached mockup",
      new AbortController().signal,
      () => {},
      () => fake,
      store.load([mockup.id]),
    );
    expect(summary).toBe("Matched the mockup.");
    const user = fake.doGenerateCalls[0].prompt.find((m) => m.role === "user");
    if (!user || typeof user.content === "string")
      throw Error("Expected parts");
    expect(user.content[0]).toEqual({
      type: "text",
      text: "Match the attached mockup",
    });
    expect(user.content[1]).toMatchObject({
      type: "file",
      mediaType: "image/png",
    });
    await expect(
      runCodingAgent(
        config,
        root,
        "Match the clip",
        new AbortController().signal,
        () => {},
        () => fake,
        store.load([temp("clip.mp4", mp4()).id]),
      ),
    ).rejects.toThrow("Video needs a Google model");
    expect(fake.doGenerateCalls).toHaveLength(1);
  });
  it("records attachments on coding tasks and loads them when the task runs", async () => {
    const { CodingService } = await import("../server/coding");
    const { git, writeSource } = await import("../server/codeWorkspace");
    const root = path.join(dir, "source");
    fs.mkdirSync(root);
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Test"]);
    await git(root, ["config", "user.email", "test@localhost"]);
    writeSource(root, "src/example.ts", "export const value = 1;\n");
    fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture"}');
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "Initial"]);
    fs.mkdirSync(path.join(root, "node_modules/typescript/bin"), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, "node_modules/typescript/bin/tsc"), "");
    const received: Attachment[][] = [];
    const service = new CodingService({
      root,
      tasksDir: path.join(dir, ".tasks"),
      config: () => config,
      remote: "",
      attachments: store,
      probeSandbox: async () => {},
      generate: async (
        _config,
        checkout,
        _prompt,
        _signal,
        _emit,
        _model,
        files,
      ) => {
        received.push((files || []).map(({ data: _data, ...rest }) => rest));
        writeSource(checkout, "src/example.ts", "export const value = 2;\n");
        return "Updated value.";
      },
      check: async () => ({ ok: true, output: "passed" }),
    });
    const spec = temp("spec.md", "# Spec\n\nvalue should be 2");
    await expect(
      service.start("Follow the spec", [
        "123e4567-e89b-42d3-a456-426614174000",
      ]),
    ).rejects.toThrow("no longer available");
    await expect(
      service.start("Match the clip", [temp("clip.mp4", mp4()).id]),
    ).rejects.toThrow("Video needs a Google model");
    expect(service.tasks.size).toBe(0);
    const task = await service.start("Follow the spec", [spec.id, spec.id]);
    for (
      let i = 0;
      i < 300 && ["preparing", "working", "checking"].includes(task.status);
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    expect(task.status, task.error).toBe("ready");
    expect(task.attachments).toEqual([spec]);
    expect(received).toEqual([[spec]]);
    expect(task.events.some((e) => e.includes("spec.md"))).toBe(true);
    const reloaded = JSON.parse(
      fs.readFileSync(path.join(dir, ".tasks", task.id, "task.json"), "utf8"),
    );
    expect(reloaded.attachments).toEqual([spec]);
  });
});
