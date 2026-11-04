import { expect, it } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { assistant, type Config } from "../server/ai";
import { normalizeAssistantSchema } from "../server/assistantSchema";
import { assetSchema, starterScene } from "../shared/scene";
import { assistantPlanSchema } from "../shared/studio";
import { providerErrorMessage } from "../server/providerErrors";

// Built-in characters are retired; the assistant adds the creator's import.
function importedScene() {
  const scene = starterScene();
  scene.customAssets.push(
    assetSchema.parse({
      id: "imported-ava",
      name: "Ava",
      category: "characters",
      style: "Imported",
      color: "#6b6b6b",
      url: "/uploads/ava.glb",
    }),
  );
  return scene;
}

it("sends a provider-compatible schema through the real OpenAI adapter", async () => {
  const plan = {
    response: "Added",
    steps: [
      {
        type: "edit",
        commands: [
          { type: "add", assetId: "imported-ava", position: [2, 0, 1] },
        ],
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
    importedScene(),
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
  [
    400,
    "invalid_json_schema",
    "secret-key user-private-prompt",
    "app compatibility error",
  ],
  [
    401,
    "invalid_api_key",
    "secret-key user-private-prompt",
    "rejected the API key",
  ],
  [403, "", "secret-key user-private-prompt", "permission"],
  [
    404,
    "model_not_found",
    "secret-key user-private-prompt",
    "model is unavailable",
  ],
  [429, "insufficient_quota", "secret-key user-private-prompt", "API credit"],
  [
    429,
    "rate_limit_exceeded",
    "secret-key user-private-prompt",
    "request limit",
  ],
  [503, "", "secret-key user-private-prompt", "temporarily unavailable"],
  // Anthropic reports exhausted credit as a plain 400 invalid_request_error.
  [
    400,
    "invalid_request_error",
    "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing secret-key user-private-prompt",
    "API credit",
  ],
  [
    429,
    "insufficient_quota",
    "You exceeded your current quota secret-key user-private-prompt",
    "API credit",
  ],
  [
    400,
    "invalid_request_error",
    "prompt is too long: 213456 tokens > 200000 maximum secret-key user-private-prompt",
    "too long for the selected model (213456 tokens, limit 200000)",
  ],
  [
    400,
    "context_length_exceeded",
    "This model's maximum context length is 128000 tokens secret-key user-private-prompt",
    "too long for the selected model",
  ],
  [
    400,
    "invalid_request_error",
    "messages.3: thinking blocks must precede tool_use secret-key user-private-prompt",
    "request format (invalid_request_error). This is an app compatibility error",
  ],
  [
    400,
    "invalid_request_error",
    "secret-key user-private-prompt",
    "rejected the request (invalid_request_error)",
  ],
])(
  "explains provider status %s / %s without leaking upstream data",
  (statusCode, code, upstream, expected) => {
    const message = providerErrorMessage({
      name: "AI_APICallError",
      statusCode,
      responseBody: JSON.stringify({ error: { code, message: upstream } }),
    });
    expect(message).toContain(expected);
    expect(message).not.toMatch(/secret-key|user-private-prompt/);
  },
);

it("quotes the provider's request id for unexplained rejections and finds wrapped API errors", async () => {
  const { contextOverflowError } = await import("../server/providerErrors");
  const wrapped = {
    name: "AI_RetryError",
    lastError: {
      name: "AI_APICallError",
      statusCode: 400,
      responseHeaders: { "request-id": "req_123abc", "x-secret": "hidden" },
      responseBody: JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "secret-key user-private-prompt",
        },
        request_id: "req_123abc",
      }),
    },
  };
  const message = providerErrorMessage(wrapped);
  expect(message).toContain("request req_123abc");
  expect(message).not.toMatch(/secret-key|user-private-prompt|hidden/);
  expect(contextOverflowError(wrapped)).toBe(false);
  expect(
    contextOverflowError({
      name: "AI_APICallError",
      statusCode: 400,
      responseBody: JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: "prompt is too long: 9 tokens > 8 maximum",
        },
      }),
    }),
  ).toBe(true);
});

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
            commands: [{ type: "add", assetId: "imported-ava", position }],
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
    importedScene(),
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
    assistant(config, importedScene(), "Add Ava", undefined, () =>
      provider("claude-fable-5-1"),
    ),
  ).rejects.toThrow();
});

it("reports an out-of-credit 400 during a connection test as a billing problem", async () => {
  const { connectionTestMessage } = await import("../server/providerErrors");
  const body = JSON.stringify({
    type: "error",
    error: {
      type: "invalid_request_error",
      message: "Your credit balance is too low to access the Anthropic API.",
    },
  });
  expect(connectionTestMessage(400, body)).toContain("API credit");
  expect(connectionTestMessage(400, "{}")).toContain("did not recognise");
});
