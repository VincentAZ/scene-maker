const key = "scene-maker-conversation-v1";
export function readConversationPreferences(): {
  rate: number;
  choices: Record<string, string>;
  width: number;
} {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return {
      rate:
        typeof value.rate === "number"
          ? Math.min(1.4, Math.max(0.65, value.rate))
          : 1,
      width:
        typeof value.width === "number"
          ? Math.min(540, Math.max(290, value.width))
          : 350,
      choices:
        value.choices &&
        typeof value.choices === "object" &&
        !Array.isArray(value.choices)
          ? (Object.fromEntries(
              Object.entries(value.choices).filter(
                ([k, v]) =>
                  k.length < 200 && typeof v === "string" && v.length < 500,
              ),
            ) as Record<string, string>)
          : {},
    };
  } catch {
    return { rate: 1, width: 350, choices: {} };
  }
}
export function saveConversationPreferences(
  changes: Partial<ReturnType<typeof readConversationPreferences>>,
) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...readConversationPreferences(), ...changes }),
    );
  } catch {
    /* Playback also works without local storage. */
  }
}
