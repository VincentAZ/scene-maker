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
    providers: { openai: { key: "fixture", model: "fixture" } },
    blender: "blender",
  };
  const reply = await assistant(
    config,
    starterScene(),
    "Add Ava",
    undefined,
    () => provider("fixture"),
  );
  expect(reply.mode).toBe("live");
  expect(reply.steps).toEqual(plan.steps);
  expect(request.store).toBe(false);
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
