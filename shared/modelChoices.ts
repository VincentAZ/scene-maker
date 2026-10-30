import type { providers } from "./scene";
export type Provider = (typeof providers)[number];
export type ProviderModel = { id: string; name: string };
export type ModelChoice = ProviderModel & {
  title: string;
  description: string;
  recommended: boolean;
};

// Editorial shortlist, reviewed against official provider guides on 2026-10-29.
// Ordered fallbacks are intersected with the account catalogue. Never synthesize
// an identifier or promote an unknown/specialized model based on its version.
// Sources and maintenance policy: docs/MODEL_CHOICES.md.
const candidates: Record<
  Exclude<Provider, "openrouter" | "lmstudio">,
  string[][]
> = {
  openai: [
    ["gpt-6.1-sol", "gpt-6-sol", "gpt-5-mini", "gpt-4.1", "gpt-4o"],
    ["gpt-6-astra", "gpt-5.5", "gpt-5.4", "gpt-5.2", "gpt-5.1", "gpt-5"],
    ["gpt-6-luna", "gpt-5-nano", "gpt-4.1-mini", "gpt-4o-mini"],
  ],
  anthropic: [
    [
      "claude-sonnet-5-5",
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-sonnet-4-5-20250929",
      "claude-sonnet-4-20250514",
    ],
    [
      "claude-opus-5-5",
      "claude-opus-4-6",
      "claude-opus-4-5",
      "claude-opus-4-5-20251101",
      "claude-opus-4-1-20250805",
    ],
    ["claude-haiku-5-5", "claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  ],
  google: [
    ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"],
    ["gemini-4-argon", "gemini-2.5-pro"],
    ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash-lite"],
  ],
  xai: [["grok-4.7"], [], []],
  kimi: [["kimi-k3.1-pro", "kimi-k3", "kimi-k2.6"], [], []],
};
const profiles = [
  {
    title: "Everyday directing",
    description:
      "A balanced starting point for scene changes and character dialogue.",
  },
  {
    title: "Complex scenes",
    description:
      "For more involved directions and planning. May take longer to respond.",
  },
  {
    title: "Quick edits",
    description: "A lighter option for simple changes and short exchanges.",
  },
];

export function modelDisplayName(model: ProviderModel): string {
  if (model.id.startsWith("ft:")) return "Custom fine-tuned model";
  if (model.name !== model.id && !model.name.startsWith("models/"))
    return model.name;
  const base = model.id
    .replace(/^(openai|anthropic|google|x-ai|moonshotai)\//, "")
    .replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, "");
  return base
    .replace(/^gpt-/, "GPT ")
    .replace(/^claude-/, "Claude ")
    .replace(/^gemini-/, "Gemini ")
    .replace(/^grok-/, "Grok ")
    .replace(/^kimi-/, "Kimi ")
    .replace(/(\d)-(\d)(?=-|$)/g, "$1.$2")
    .replace(/-/g, " ")
    .replace(
      /\b(sol|astra|luna|sonnet|opus|haiku|flash|lite|pro|argon|mini|nano|k\d)\b/gi,
      (word) => word[0].toUpperCase() + word.slice(1),
    );
}

export function studioModelChoices(
  provider: Provider,
  models: ProviderModel[],
): ModelChoice[] {
  // Local models are whatever the person downloaded; there is no shortlist.
  if (provider === "lmstudio") return [];
  const available = new Map(models.map((model) => [model.id, model]));
  const lists =
    provider === "openrouter"
      ? profiles.map((_, index) => [
          ...candidates.anthropic[index].map(
            (id) => `anthropic/${id.replace(/(\d)-(\d)/g, "$1.$2")}`,
          ),
          ...candidates.openai[index].map((id) => `openai/${id}`),
          ...candidates.google[index].map((id) => `google/${id}`),
        ])
      : candidates[provider];
  const used = new Set<string>();
  const choices: ModelChoice[] = [];
  lists.forEach((ids, index) => {
    const id = ids.find(
      (candidate) => available.has(candidate) && !used.has(candidate),
    );
    if (!id) return;
    used.add(id);
    const model = available.get(id)!;
    choices.push({
      ...model,
      name: modelDisplayName(model),
      ...profiles[index],
      recommended: index === 0,
    });
  });
  // If only one supported profile exists, it is a useful starting point, not an
  // excuse to surface the entire provider catalogue or guess unknown capabilities.
  if (choices.length && !choices.some((choice) => choice.recommended))
    choices[0].recommended = true;
  return choices;
}

export function advancedModelGroup(id: string): string {
  if (id.startsWith("ft:")) return "Fine-tuned models";
  if (/-\d{4}-\d{2}-\d{2}$|-\d{8}$|ckpt/.test(id)) return "Version snapshots";
  return "Other models";
}
