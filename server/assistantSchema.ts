import { jsonSchema } from "ai";
import { z } from "zod";
import { assistantPlanSchema, type AssistantPlan } from "../shared/studio";

// The domain schema uses fixed XYZ tuples. Providers expect a single array-item
// schema, not draft-7 tuple-form `items: [schema, schema, schema]`.
export function normalizeAssistantSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeAssistantSchema);
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      normalizeAssistantSchema(child),
    ]),
  );
  if (Array.isArray(result.items)) {
    const items = result.items;
    if (
      !items.length ||
      !items.every((item) => JSON.stringify(item) === JSON.stringify(items[0]))
    )
      throw Error("The assistant schema contains an unsupported mixed tuple.");
    result.items = items[0];
    result.minItems = items.length;
    result.maxItems = items.length;
    delete result.additionalItems;
  }
  return result;
}
export const assistantOutputSchema = jsonSchema<AssistantPlan>(
  normalizeAssistantSchema(
    z.toJSONSchema(assistantPlanSchema, { target: "draft-7", io: "input" }),
  ) as Parameters<typeof jsonSchema>[0],
  {
    validate: async (value) => {
      const result = await assistantPlanSchema.safeParseAsync(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  },
);
