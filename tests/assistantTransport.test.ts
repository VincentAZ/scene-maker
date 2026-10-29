import { expect, it } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { assistant, type Config } from "../server/ai";
import { normalizeAssistantSchema } from "../server/assistantSchema";
import { starterScene } from "../shared/scene";
import { assistantPlanSchema } from "../shared/studio";
import { providerErrorMessage } from "../server/providerErrors";

it("sends a provider-compatible schema through the real OpenAI adapter", async () => {
  const plan = {
    response: "Added",
    steps: [
      {
        type: "edit",
        commands: [{ type: "add", assetId: "ava", position: [2, 0, 1] }],
      },
    ],
  };
  let request: any;
  const provider = createOpenAI({
    apiKey: "fixture",
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          id: "resp_fixture",
          object: "response",
          created_at: 1,
          status: "completed",
          model: "fixture",
          output: [
            {
              id: "msg_fixture",
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify(plan),
                  annotations: [],
                },
              ],
            },
          ],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const config: Config = {
    assistant: "openai",
    providers: {
      openai: { key: "fixture", model: "gpt-6-luna", thinking: "high" },
    },
    blender: "blender",
  };
  const reply = await assistant(
    config,
    starterScene(),
    "Add Ava",
    undefined,
    () => provider("gpt-6-luna"),
  );
  expect(reply.mode).toBe("live");
  expect(reply.steps).toEqual(plan.steps);
  expect(request.store).toBe(false);
  expect(request.reasoning.effort).toBe("high");
  expect(request.text.format.strict).toBe(false);
  let triples = 0;
  function check(value: any) {
    if (!value || typeof value !== "object") return;
    expect(Array.isArray(value.items)).toBe(false);
    if (value.type === "array" && value.minItems === 3 && value.maxItems === 3)
      triples++;
    Object.values(value).forEach(check);
  }
  check(request.text.format.schema);
  expect(triples).toBeGreaterThan(0);
  expect(assistantPlanSchema.safeParse(plan).success).toBe(true);
  plan.steps[0].commands[0].position = [2, 0];
  expect(assistantPlanSchema.safeParse(plan).success).toBe(false);
});

it("refuses to silently weaken mixed tuples", () => {
  expect(() =>
    normalizeAssistantSchema({
      items: [{ type: "number" }, { type: "string" }],
    }),
  ).toThrow("mixed tuple");
});

it.each([
  [400, "invalid_json_schema", "app compatibility error"],
  [401, "invalid_api_key", "rejected the API key"],
  [403, "", "permission"],
  [404, "model_not_found", "model is unavailable"],
  [429, "insufficient_quota", "API credit"],
  [429, "rate_limit_exceeded", "request limit"],
  [503, "", "temporarily unavailable"],
])(
  "explains provider status %s / %s without leaking upstream data",
  (statusCode, code, expected) => {
    const message = providerErrorMessage({
      name: "AI_APICallError",
      statusCode,
      responseBody: JSON.stringify({
        error: { code, message: "secret-key user-private-prompt" },
      }),
    });
    expect(message).toContain(expected);
    expect(message).not.toMatch(/secret-key|user-private-prompt/);
  },
);

it("uses a small Claude envelope, sends thinking effort and validates the decoded plan", async () => {
  const { createAnthropic } = await import("@ai-sdk/anthropic");
  let request: any;
  let position: number[] = [2, 0, 1];
  const provider = createAnthropic({
    apiKey: "fixture",
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      const plan = {
        response: "Added Ava.",
        steps: [
          {
            type: "edit",
            commands: [{ type: "add", assetId: "ava", position }],
          },
        ],
      };
      return new Response(
        JSON.stringify({
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: "claude-fable-5-1",
          content: [
            {
              type: "text",
              text: JSON.stringify({ plan: JSON.stringify(plan) }),
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const config: Config = {
    assistant: "anthropic",
    providers: {
      anthropic: {
        key: "fixture",
        model: "claude-fable-5-1",
        thinking: "high",
      },
    },
    blender: "blender",
  };
  const reply = await assistant(
    config,
    starterScene(),
    "Add Ava",
    undefined,
    () => provider("claude-fable-5-1"),
  );
  expect(reply.steps[0].type).toBe("edit");
  const wire = request.output_config.format.schema;
  expect(Object.keys(wire.properties)).toEqual(["plan"]);
  expect(wire.required).toEqual(["plan"]);
  expect(wire.properties.plan.type).toBe("string");
  expect(request.output_config.effort).toBe("high");
  expect(request.thinking.type).toBe("adaptive");
  position = [2, 0];
  await expect(
    assistant(config, starterScene(), "Add Ava", undefined, () =>
      provider("claude-fable-5-1"),
    ),
  ).rejects.toThrow();
});
