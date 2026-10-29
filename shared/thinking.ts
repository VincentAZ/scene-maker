export const thinkingLevels = [
  "default",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];
export const thinkingLabels: Record<ThinkingLevel, string> = {
  default: "Model default",
  low: "Low · faster",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Maximum · slower",
};
export function thinkingChoices(
  provider: string | null,
  model: string,
): readonly ThinkingLevel[] {
  if (provider === "openai" && /^gpt-(6|5\.[2-9])/.test(model))
    return thinkingLevels;
  if (provider === "openai" && /^(gpt-5|o[134])/.test(model))
    return thinkingLevels.slice(0, 4);
  if (
    provider === "anthropic" &&
    /claude-(fable-5|opus-(4-[678]|5)|sonnet-5|haiku-5)/.test(model)
  )
    return thinkingLevels;
  if (
    provider === "anthropic" &&
    /claude-(opus-4|sonnet-4|haiku-4-5|3-7-sonnet)/.test(model)
  )
    return thinkingLevels.slice(0, 4);
  return ["default"];
}
export function effectiveThinking(
  provider: string | null,
  model: string,
  requested: ThinkingLevel = "default",
) {
  return requested !== "default" &&
    thinkingChoices(provider, model).includes(requested)
    ? requested
    : undefined;
}
