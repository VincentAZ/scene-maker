import { describe, expect, it } from "vitest";
import { applyCommands, starterScene, validateScene } from "../shared/scene";
import { conversation, thinkingFor, type Config } from "../server/ai";
import { describeCharacterModel } from "../src/CharacterModelPicker";
import type { ConnectionsData } from "../src/Connections";

const config: Config = {
  assistant: "openai",
  providers: {
    openai: { key: "fixture", model: "gpt-6-luna", thinking: "low" },
    anthropic: { key: "fixture", model: "claude-sonnet-5-5", thinking: "high" },
  },
  blender: "blender",
};
const summary: ConnectionsData = {
  assistant: "openai",
  blender: "blender",
  providers: {
    openai: { connected: true, model: "gpt-6-luna", thinking: "low" },
    anthropic: {
      connected: true,
      model: "claude-sonnet-5-5",
      thinking: "high",
    },
    google: { connected: false, model: "", thinking: "default" },
    xai: { connected: false, model: "", thinking: "default" },
    kimi: { connected: false, model: "", thinking: "default" },
    openrouter: { connected: false, model: "", thinking: "default" },
  },
};

describe("per-character AI choices", () => {
  it("saves provider, model and thinking per character and validates them", () => {
    const base = starterScene();
    const s = applyCommands(base, [
      {
        type: "update",
        id: base.entities[0].id,
        changes: {
          provider: "anthropic",
          model: "claude-opus-5-5",
          thinking: "high",
        },
      },
    ]);
    expect(s.entities[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
      thinking: "high",
    });
    const roundTrip = validateScene(JSON.parse(JSON.stringify(s)));
    expect(roundTrip.entities[0].thinking).toBe("high");
    expect(() =>
      validateScene({
        ...s,
        entities: [
          { ...s.entities[0], thinking: "turbo" },
          ...s.entities.slice(1),
        ],
      }),
    ).toThrow();
    const cleared = applyCommands(s, [
      {
        type: "update",
        id: s.entities[0].id,
        changes: { provider: null, model: "", thinking: undefined },
      },
    ]);
    expect(cleared.entities[0].provider).toBeNull();
    expect(cleared.entities[0].thinking).toBeUndefined();
  });
  it("lets a character's thinking effort override the provider setting only when supported", () => {
    expect(thinkingFor(config, "openai", "gpt-6-luna")).toBe("low");
    expect(thinkingFor(config, "openai", "gpt-6-luna", "max")).toBe("max");
    expect(thinkingFor(config, "openai", "gpt-6-luna", "default")).toBe("low");
    expect(thinkingFor(config, "openai", "gpt-4o", "high")).toBeUndefined();
    expect(thinkingFor(config, "anthropic", "", "medium")).toBe("medium");
  });
  it("names the character whose AI connection is not ready before any paid request", async () => {
    const s = starterScene();
    s.entities[0].provider = "google";
    s.entities[0].model = "gemini-4-argon";
    await expect(conversation(config, s, 1)).rejects.toThrow(
      `${s.entities[0].name}’s AI is not ready`,
    );
    await expect(conversation(config, s, 1)).rejects.toThrow("google");
  });
  it("describes what each character will speak with and warns about gaps", () => {
    const base = { id: "x", name: "Mila" };
    expect(
      describeCharacterModel({ ...base, provider: null, model: "" }, summary),
    ).toMatchObject({ provider: "openai", model: "gpt-6-luna", warning: "" });
    expect(
      describeCharacterModel(
        { ...base, provider: "anthropic", model: "claude-opus-5-5" },
        summary,
      ),
    ).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-5-5",
      label: "Anthropic · Claude Opus 5.5",
      warning: "",
    });
    expect(
      describeCharacterModel(
        { ...base, provider: "google", model: "" },
        summary,
      ).warning,
    ).toContain("no saved API key");
    expect(
      describeCharacterModel(
        { ...base, provider: null, model: "" },
        { ...summary, assistant: null },
      ).warning,
    ).toContain("Conversations need an AI");
    expect(
      describeCharacterModel({ ...base, provider: null, model: "" }, null)
        .label,
    ).toContain("Loading");
  });
});
