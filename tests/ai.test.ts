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
  it("includes follow-up history and binds opened projects to the revision used for planning", async () => {
    const current = starterScene(),
      target = { ...starterScene(), name: "Warehouse story", revision: 7 };
    const fake = model({
      response: "Ready",
      steps: [
        { type: "openProject", id: target.id },
        {
          type: "edit",
          commands: [
            {
              type: "update",
              id: target.entities[0].id,
              changes: { scale: 1.2 },
            },
          ],
        },
        { type: "save" },
      ],
    });
    let reads = 0;
    const result = await assistant(
      config,
      current,
      "Open Warehouse story and make her taller",
      undefined,
      () => fake,
      {
        history: [{ role: "user", text: "Mila is our lead" }],
        projects: [
          {
            id: target.id,
            name: target.name,
            revision: target.revision,
            environment: target.environment,
            updated: 1,
          },
        ],
        readProject: () => {
          reads++;
          return { ...target, revision: reads === 1 ? 7 : 8 };
        },
      },
    );
    expect(result.reads[target.id]).toBe(7);
    expect(reads).toBe(1);
    expect(JSON.stringify(fake.doGenerateCalls[0].prompt)).toContain(
      "Mila is our lead",
    );
    expect(JSON.stringify(fake.doGenerateCalls[0].prompt)).toContain(
      target.entities[0].id,
    );
  });
  it("creates and opens named projects through the labeled offline helper", async () => {
    const current = starterScene(),
      target = { ...starterScene(), name: "My story", revision: 3 };
    const offline = { ...config, assistant: null };
    const created = await assistant(
      offline,
      current,
      "Create a new scene called My next story",
    );
    expect(created.steps).toEqual([
      { type: "newProject", name: "My next story", template: "empty" },
      { type: "save" },
    ]);
    const opened = await assistant(
      offline,
      current,
      "Open My story",
      undefined,
      undefined,
      {
        projects: [
          {
            id: target.id,
            name: target.name,
            revision: 3,
            environment: target.environment,
            updated: 1,
          },
        ],
        readProject: () => target,
      },
    );
    expect(opened.steps).toEqual([{ type: "openProject", id: target.id }]);
    expect(opened.reads[target.id]).toBe(3);
    const seek = await assistant(offline, current, "Jump to 3.5 seconds");
    expect(seek.steps).toEqual([{ type: "playback", mode: "seek", time: 3.5 }]);
  });
  it("parses a real SDK structured response and validates commands before editing", async () => {
    const s = starterScene(),
      fake = model({
        response: "A new friend joins your scene.",
        steps: [
          {
            type: "edit",
            commands: [
              {
                type: "add",
                assetId: "ava",
                name: "Alex",
                position: [2, 0, 1],
              },
            ],
          },
          { type: "playback", mode: "play" },
        ],
      });
    const result = await assistant(
      config,
      s,
      "Add a barista",
      undefined,
      () => fake,
    );
    expect(result.mode).toBe("live");
    expect(result.steps[1]).toEqual({ type: "playback", mode: "play" });
    const edit = result.steps[0];
    if (edit.type !== "edit") throw Error("Expected an edit");
    expect(applyCommands(s, edit.commands).entities.at(-1)?.name).toBe("Alex");
    expect(fake.doGenerateCalls[0].responseFormat?.type).toBe("json");
  });
  it("rejects hallucinated object IDs before returning a successful assistant response", async () => {
    const fake = model({
      response: "Done.",
      steps: [{ type: "edit", commands: [{ type: "remove", id: "missing" }] }],
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
    expect(
      next.entities[0].clips.filter((c) => c.motionId === "talk"),
    ).toHaveLength(
      s.entities[0].clips.filter((c) => c.motionId === "talk").length + 2,
    );
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
