import { describe, expect, it, vi } from "vitest";
import { listProviderModels } from "../server/providerModels";
const key = "fixture-key-not-a-credential";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
describe("provider model discovery", () => {
  it("explains recognizable keys used under the wrong provider without transmitting them", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      listProviderModels("openai", "sk-ant-fixture", request),
    ).rejects.toThrow("Choose the Anthropic tab");
    await expect(
      listProviderModels("anthropic", "sk-or-fixture", request),
    ).rejects.toThrow("Choose the OpenRouter tab");
    expect(request).not.toHaveBeenCalled();
  });
  it("returns actual OpenAI identifiers, filters non-chat models, and sends the key only in headers", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: [
          { id: "gpt-fixture", name: "Fixture" },
          { id: "gpt-fixture" },
          { id: "text-embedding-fixture" },
          { id: "gpt-fixture-audio" },
          { id: "o9-fixture" },
        ],
      }),
    );
    expect(await listProviderModels("openai", key, request)).toEqual([
      { id: "gpt-fixture", name: "gpt-fixture" },
      { id: "o9-fixture", name: "o9-fixture" },
    ]);
    expect(request.mock.calls[0][0]).toBe("https://api.openai.com/v1/models");
    expect(request.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: `Bearer ${key}` },
      redirect: "error",
    });
  });
  it("paginates Anthropic without trusting upstream URLs", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          data: [{ id: "claude-a", display_name: "Claude A" }],
          has_more: true,
          last_id: "a/b",
        }),
      )
      .mockResolvedValueOnce(
        json({ data: [{ id: "claude-b" }], has_more: false }),
      );
    expect(await listProviderModels("anthropic", key, request)).toHaveLength(2);
    expect(request.mock.calls[1][0]).toBe(
      "https://api.anthropic.com/v1/models?limit=1000&after_id=a%2Fb",
    );
    expect(request.mock.calls[0][1]?.headers).toEqual({
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    });
  });
  it("normalizes Gemini identifiers, filters by generation support, and paginates", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        json({
          models: [
            {
              name: "models/gemini-fixture",
              displayName: "Gemini fixture",
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
          nextPageToken: "next/page",
        }),
      )
      .mockResolvedValueOnce(
        json({
          models: [
            {
              name: "models/gemini-other",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
      );
    expect(await listProviderModels("google", key, request)).toEqual([
      { id: "gemini-fixture", name: "Gemini fixture" },
      { id: "gemini-other", name: "models/gemini-other" },
    ]);
    expect(request.mock.calls[1][0]).toContain("pageToken=next%2Fpage");
    expect(request.mock.calls[0][1]?.headers).toEqual({
      "x-goog-api-key": key,
    });
  });
  it.each([
    ["xai", "https://api.x.ai/v1/language-models"],
    ["kimi", "https://api.moonshot.ai/v1/models"],
  ] as const)("uses the %s model endpoint", async (provider, endpoint) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ data: [{ id: "chat-fixture" }] }));
    expect(await listProviderModels(provider, key, request)).toHaveLength(1);
    expect(request.mock.calls[0][0]).toBe(endpoint);
  });
  it("uses the authenticated OpenRouter catalogue and requires text/structured output", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        data: [
          {
            id: "a/chat",
            name: "Chat",
            architecture: { output_modalities: ["text"] },
            supported_parameters: ["structured_outputs"],
          },
          { id: "a/image", architecture: { output_modalities: ["image"] } },
          {
            id: "a/no-json",
            architecture: { output_modalities: ["text"] },
            supported_parameters: [],
          },
        ],
      }),
    );
    expect(await listProviderModels("openrouter", key, request)).toEqual([
      { id: "a/chat", name: "Chat" },
    ]);
    expect(request.mock.calls[0][0]).toBe(
      "https://openrouter.ai/api/v1/models/user",
    );
  });
  it.each([401, 403, 429, 500])(
    "sanitizes provider failures (%s)",
    async (status) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ error: `Secret: ${key}` }, status));
      await expect(
        listProviderModels("openai", key, request),
      ).rejects.not.toThrow(key);
      await expect(listProviderModels("openai", key, request)).rejects.toThrow(
        /provider|permissions/i,
      );
    },
  );
  it("sanitizes transport failures and rejects malformed/empty results", async () => {
    await expect(
      listProviderModels(
        "openai",
        key,
        vi.fn<typeof fetch>().mockRejectedValue(Error(key)),
      ),
    ).rejects.toThrow("Could not reach");
    for (const body of [{}, { data: [] }, { data: [null, { id: 3 }] }])
      await expect(
        listProviderModels(
          "openai",
          key,
          vi.fn<typeof fetch>().mockResolvedValue(json(body)),
        ),
      ).rejects.toThrow(/model/i);
  });
  it("rejects blank keys without contacting a provider and detects repeated pagination", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        json({ data: [], has_more: true, last_id: "again" }),
      );
    await expect(listProviderModels("anthropic", " ", request)).rejects.toThrow(
      "Paste an API key",
    );
    expect(request).not.toHaveBeenCalled();
    await expect(listProviderModels("anthropic", key, request)).rejects.toThrow(
      "incomplete",
    );
    expect(request).toHaveBeenCalledTimes(2);
  });
});
