import { expect, it } from "vitest";
import { thinkingChoices, effectiveThinking } from "../shared/thinking";
import { thinkingFor, type Config } from "../server/ai";
it("limits thinking options to supported models", () => {
  expect(thinkingChoices("anthropic", "claude-fable-5-1")).toContain("xhigh");
  expect(thinkingChoices("openai", "gpt-6-luna")).toContain("max");
  expect(thinkingChoices("openai", "gpt-4o")).toEqual(["default"]);
  expect(effectiveThinking("openai", "gpt-4o", "high")).toBeUndefined();
  expect(
    effectiveThinking("anthropic", "claude-fable-5-1", "default"),
  ).toBeUndefined();
});
it("uses the selected provider preference without leaking it into unsupported character models", () => {
  const config: Config = {
    assistant: "anthropic",
    providers: {
      anthropic: {
        key: "fixture",
        model: "claude-fable-5-1",
        thinking: "high",
      },
      openai: { key: "fixture", model: "gpt-6-luna", thinking: "low" },
    },
    blender: "blender",
  };
  expect(thinkingFor(config, "anthropic")).toBe("high");
  expect(thinkingFor(config, "openai")).toBe("low");
  expect(thinkingFor(config, "openai", "gpt-4o")).toBeUndefined();
});
