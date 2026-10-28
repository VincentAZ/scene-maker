import { describe, it, expect } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { assistant, conversation, modelFor, type Config } from "../server/ai";
import { starterScene, applyCommands } from "../shared/scene";
const config: Config = {
  assistant: "openai",
  providers: { openai: { key: "test", model: "test" } },
  blender: "blender",
};
function model(output: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(output) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}
describe("live AI contract with deterministic model responses", () => {
  it("parses a real SDK structured response and validates commands before editing", async () => {
    const s = starterScene(),
      fake = model({
        response: "A new friend joins your scene.",
        commands: [
          { type: "add", assetId: "ava", name: "Alex", position: [2, 0, 1] },
        ],
        activity: "play",
      });
    const result = await assistant(
      config,
      s,
      "Add a barista",
      undefined,
      () => fake,
    );
    expect(result.mode).toBe("live");
    expect(result.activity).toBe("play");
    expect(applyCommands(s, result.commands).entities.at(-1)?.name).toBe(
      "Alex",
    );
    expect(fake.doGenerateCalls[0].responseFormat?.type).toBe("json");
  });
  it("rejects hallucinated object IDs before returning a successful assistant response", async () => {
    const fake = model({
      response: "Done.",
      commands: [{ type: "remove", id: "missing" }],
      activity: "none",
    });
    await expect(
      assistant(config, starterScene(), "remove one", undefined, () => fake),
    ).rejects.toThrow("no longer exists");
  });
  it("routes each character separately and passes prior dialogue to the next speaker", async () => {
    const s = starterScene();
    s.entities[0].provider = "anthropic";
    s.entities[0].model = "character-a";
    s.entities[1].provider = "kimi";
    s.entities[1].model = "character-b";
    const requested: string[] = [];
    const fake = model({
      dialogue: "Do you have time for one more coffee?",
      action: "talk",
    });
    const next = await conversation(config, s, 2, (_c, p, m) => {
      requested.push(`${p}:${m}`);
      return fake;
    });
    expect(next.transcript.map((t) => t.name)).toEqual([
      "Mila",
      "Leo",
      "Mila",
      "Leo",
    ]);
    expect(fake.doGenerateCalls).toHaveLength(4);
    expect(JSON.stringify(fake.doGenerateCalls[1].prompt)).toContain(
      "Do you have time",
    );
    expect(requested).toContain("anthropic:character-a");
    expect(requested).toContain("kimi:character-b");
    expect(next.entities[0].clips.length).toBe(s.entities[0].clips.length + 2);
    expect(s.transcript).toHaveLength(0);
  });
  it("supports all requested provider adapters and rejects missing credentials", () => {
    for (const provider of [
      "openai",
      "anthropic",
      "google",
      "xai",
      "kimi",
      "openrouter",
    ] as const) {
      expect(
        modelFor(
          {
            ...config,
            providers: {
              [provider]: { key: "test", model: "configured-model" },
            },
          },
          provider,
        ).modelId,
      ).toBe("configured-model");
    }
    expect(() => modelFor(config, "anthropic")).toThrow("Complete");
  });
});
