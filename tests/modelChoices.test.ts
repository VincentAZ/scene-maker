import { describe, expect, it } from "vitest";
import {
  advancedModelGroup,
  modelDisplayName,
  studioModelChoices,
} from "../shared/modelChoices";
const models = (...ids: string[]) => ids.map((id) => ({ id, name: id }));
describe("studio model suggestions", () => {
  it("turns an account catalogue into three task choices without fine-tunes or dated duplicates", () => {
    const list = models(
      "ft:gpt-3.5-turbo:private:checkpoint",
      "gpt-3.5-turbo",
      "gpt-4.1-2025-04-14",
      "gpt-4.1",
      "gpt-5-mini",
      "gpt-5-nano",
      "gpt-5",
      "gpt-5-2025-08-07",
    );
    const result = studioModelChoices("openai", list);
    expect(result.map((choice) => choice.id)).toEqual([
      "gpt-5-mini",
      "gpt-5",
      "gpt-5-nano",
    ]);
    expect(result.map((choice) => choice.title)).toEqual([
      "Everyday directing",
      "Complex scenes",
      "Quick edits",
    ]);
    expect(result.filter((choice) => choice.recommended)).toHaveLength(1);
    expect(result[0].name).toBe("GPT 5 Mini");
    expect(list).toHaveLength(8);
  });
  it("only suggests identifiers actually returned, including older supported fallbacks", () => {
    expect(
      studioModelChoices("openai", models("gpt-4.1", "gpt-4.1-mini")).map(
        (choice) => choice.id,
      ),
    ).toEqual(["gpt-4.1", "gpt-4.1-mini"]);
    expect(
      studioModelChoices(
        "openai",
        models(
          "ft:private",
          "gpt-99-unknown",
          "gpt-5-pro",
          "gpt-4.1-2025-04-14",
        ),
      ),
    ).toEqual([]);
  });
  it("prefers reviewed current aliases when the account returns them", () => {
    expect(
      studioModelChoices(
        "openai",
        models("gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna", "gpt-5-mini"),
      ).map((choice) => choice.id),
    ).toEqual(["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"]);
  });
  it("collapses Anthropic aliases/snapshots to one choice per role", () => {
    const result = studioModelChoices(
      "anthropic",
      models(
        "claude-sonnet-4-5-20250929",
        "claude-sonnet-4-5",
        "claude-opus-4-6",
        "claude-haiku-4-5-20251001",
      ),
    );
    expect(result.map((choice) => choice.id)).toEqual([
      "claude-sonnet-4-5",
      "claude-opus-4-6",
      "claude-haiku-4-5-20251001",
    ]);
    expect(result[0].name).toBe("Claude Sonnet 4.5");
  });
  it("keeps unsupported and specialized Gemini variants out of studio suggestions", () => {
    expect(
      studioModelChoices(
        "google",
        models(
          "gemini-3.8-flash",
          "gemini-4-argon",
          "gemini-3.5-flash-lite",
          "gemini-3.8-flash-tts",
          "gemini-3.1-pro-preview",
        ),
      ).map((choice) => choice.id),
    ).toEqual(["gemini-3.8-flash", "gemini-4-argon", "gemini-3.5-flash-lite"]);
  });
  it("does not invent extra roles for providers with one curated choice", () => {
    expect(studioModelChoices("xai", models("grok-4.7"))).toHaveLength(1);
    expect(
      studioModelChoices(
        "kimi",
        models("kimi-k3.1-pro", "kimi-k3.1-pro-highspeed", "kimi-k2.5"),
      ),
    ).toHaveLength(1);
  });
  it("uses only real OpenRouter identifiers when resolving cross-provider choices", () => {
    expect(
      studioModelChoices(
        "openrouter",
        models(
          "anthropic/claude-sonnet-4.5",
          "openai/gpt-5",
          "google/gemini-3.5-flash-lite",
          "unreviewed/some-model",
        ),
      ).map((choice) => choice.id),
    ).toEqual([
      "anthropic/claude-sonnet-4.5",
      "openai/gpt-5",
      "google/gemini-3.5-flash-lite",
    ]);
  });
  it("keeps raw custom identifiers out of the normal display and groups advanced entries", () => {
    expect(
      modelDisplayName({
        id: "ft:gpt-3.5-turbo:private",
        name: "ft:gpt-3.5-turbo:private",
      }),
    ).toBe("Custom fine-tuned model");
    expect(modelDisplayName({ id: "gpt-6-astra", name: "gpt-6-astra" })).toBe(
      "GPT 6 Astra",
    );
    expect(advancedModelGroup("ft:model:checkpoint")).toBe("Fine-tuned models");
    expect(advancedModelGroup("gpt-4.1-2025-04-14")).toBe("Version snapshots");
    expect(advancedModelGroup("gpt-4.1")).toBe("Other models");
  });
});
