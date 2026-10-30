import { describe, expect, it, vi } from "vitest";
import {
  listProviderModels,
  lmStudioBaseUrl,
  testProviderConnection,
} from "../server/providerModels";
import { modelFor, type Config } from "../server/ai";
import { providerErrorMessage } from "../server/providerErrors";
import { studioModelChoices } from "../shared/modelChoices";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("LM Studio", () => {
  it("accepts the addresses people type and rejects anything else", () => {
    expect(lmStudioBaseUrl("http://127.0.0.1:1234")).toBe(
      "http://127.0.0.1:1234/v1",
    );
    expect(lmStudioBaseUrl(" localhost:1234/ ")).toBe(
      "http://localhost:1234/v1",
    );
    expect(lmStudioBaseUrl("http://192.168.1.5:1234/v1/")).toBe(
      "http://192.168.1.5:1234/v1",
    );
    for (const bad of [
      "",
      "ftp://host:1234",
      "http://u:p@host:1234",
      "http://h?x=1",
    ])
      expect(() => lmStudioBaseUrl(bad)).toThrow("server address");
  });
  it("lists downloaded chat models without sending credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: [
          { id: "qwen3-14b" },
          { id: "text-embedding-nomic-embed-text-v1.5" },
          { id: "gemma-3-12b" },
          { id: "gemma-3-12b" },
        ],
      }),
    );
    expect(
      await listProviderModels("lmstudio", "127.0.0.1:1234", request),
    ).toEqual([
      { id: "gemma-3-12b", name: "gemma-3-12b" },
      { id: "qwen3-14b", name: "qwen3-14b" },
    ]);
    expect(request.mock.calls[0][0]).toBe("http://127.0.0.1:1234/v1/models");
    expect(request.mock.calls[0][1]?.headers).toBeUndefined();
    expect(
      studioModelChoices("lmstudio", [{ id: "qwen3-14b", name: "qwen3-14b" }]),
    ).toEqual([]);
  });
  it("explains a stopped server, a foreign address and an empty library", async () => {
    await expect(
      listProviderModels(
        "lmstudio",
        "http://127.0.0.1:1234",
        vi.fn<typeof fetch>().mockRejectedValue(new TypeError("refused")),
      ),
    ).rejects.toThrow("lms server start");
    await expect(
      listProviderModels(
        "lmstudio",
        "http://127.0.0.1:1234",
        vi.fn<typeof fetch>().mockResolvedValue(json({ hello: "world" })),
      ),
    ).rejects.toThrow("did not answer like LM Studio");
    expect(
      await testProviderConnection(
        "lmstudio",
        "http://127.0.0.1:1234",
        vi.fn<typeof fetch>().mockResolvedValue(json({ data: [] })),
      ),
    ).toEqual({
      ok: false,
      error: expect.stringContaining("no chat models downloaded"),
    });
  });
  it("chats through the OpenAI-compatible endpoint at the saved address", () => {
    const config: Config = {
      providers: {
        lmstudio: { key: "localhost:4321", model: "qwen3-14b", method: "key" },
      },
      assistant: "lmstudio",
      blender: "blender",
    };
    const model = modelFor(config, "lmstudio");
    expect(typeof model === "object" && model.provider).toBe("lmstudio.chat");
    expect(typeof model === "object" && model.modelId).toBe("qwen3-14b");
  });
});
describe("LM Studio errors", () => {
  it("asks for a larger loaded context instead of a generic rejection", () => {
    const engine = JSON.stringify({
      error: {
        code: 400,
        message:
          "request (17230 tokens) exceeds the available context size (8192 tokens), try increasing it",
        type: "exceed_context_size_error",
      },
    });
    const message = providerErrorMessage({
      name: "AI_APICallError",
      statusCode: 400,
      responseBody: JSON.stringify({
        error: `Engine protocol predict request returned 400: ${engine}`,
      }),
    });
    expect(message).toContain("room for 8192 tokens");
    expect(message).toContain("needs 17230");
    expect(message).toContain("larger context length");
  });
});
