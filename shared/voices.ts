// Voice choices shared by the server (synthesis, catalogues) and the client
// (selectors, playback). A character's voice is stored as "provider:voice" or
// "provider:voice#speaker"; a bare value is a legacy browser voiceURI.
export const voiceProviders = [
  "browser",
  "piper",
  "openai",
  "elevenlabs",
] as const;
export type VoiceProvider = (typeof voiceProviders)[number];
export type VoiceGender = "female" | "male" | "neutral";
export type VoiceOption = {
  /** Full choice string, e.g. "openai:nova" or "piper:en_GB-vctk-medium#12". */
  id: string;
  provider: VoiceProvider;
  voice: string;
  speaker?: number;
  name: string;
  lang: string;
  gender?: VoiceGender;
  description?: string;
  /** Runs on this computer (browser engine or Piper). */
  local: boolean;
  preview?: string;
};
export type VoiceChoice = {
  provider: VoiceProvider;
  voice: string;
  speaker?: number;
};
export const providerLabels: Record<VoiceProvider, string> = {
  browser: "Browser voices · local",
  piper: "Piper · local",
  openai: "OpenAI · cloud",
  elevenlabs: "ElevenLabs · cloud",
};

export function parseVoiceChoice(
  value: string | undefined | null,
): VoiceChoice | null {
  if (!value) return null;
  const match = /^(browser|piper|openai|elevenlabs):([^#]+)(?:#(\d+))?$/.exec(
    value,
  );
  if (!match) return { provider: "browser", voice: value };
  const speaker = match[3] === undefined ? undefined : Number(match[3]);
  return {
    provider: match[1] as VoiceProvider,
    voice: match[2],
    ...(speaker === undefined ? {} : { speaker }),
  };
}
export function voiceChoiceId(choice: VoiceChoice): string {
  return `${choice.provider}:${choice.voice}${choice.speaker === undefined ? "" : `#${choice.speaker}`}`;
}

// OpenAI's built-in voices (gpt-4o-mini-tts). Character notes are the
// provider's own descriptions; gender is only used to vary automatic casting.
export const openaiVoices: VoiceOption[] = (
  [
    ["alloy", "Alloy", "neutral", "Balanced and clear"],
    ["ash", "Ash", "male", "Warm and steady"],
    ["ballad", "Ballad", "male", "Expressive, British"],
    ["coral", "Coral", "female", "Bright and friendly"],
    ["echo", "Echo", "male", "Calm and measured"],
    ["fable", "Fable", "neutral", "Storyteller, British"],
    ["onyx", "Onyx", "male", "Deep and authoritative"],
    ["nova", "Nova", "female", "Energetic and upbeat"],
    ["sage", "Sage", "female", "Soft and thoughtful"],
    ["shimmer", "Shimmer", "female", "Clear and gentle"],
    ["verse", "Verse", "male", "Expressive and dynamic"],
    ["marin", "Marin", "female", "Natural, newest voice"],
    ["cedar", "Cedar", "male", "Natural, newest voice"],
  ] as const
).map(([voice, name, gender, description]) => ({
  id: `openai:${voice}`,
  provider: "openai" as const,
  voice,
  name,
  lang: "multilingual",
  gender,
  description,
  local: false,
}));

/**
 * Picks a distinct voice for each cast member without a choice, alternating
 * gender where the pool allows, so a conversation never sounds like one voice
 * talking to itself. Deterministic for a given pool and cast order.
 */
export function automaticVoices(
  castIds: string[],
  pool: VoiceOption[],
): Record<string, VoiceOption | undefined> {
  const result: Record<string, VoiceOption | undefined> = {};
  if (!pool.length) return result;
  const byGender: Record<string, VoiceOption[]> = {
    female: [],
    male: [],
    other: [],
  };
  for (const option of pool)
    byGender[
      option.gender === "female" || option.gender === "male"
        ? option.gender
        : "other"
    ].push(option);
  const order = ["female", "male", "other"].filter((g) => byGender[g].length);
  const cursors: Record<string, number> = { female: 0, male: 0, other: 0 };
  castIds.forEach((id, index) => {
    const bucket = order[index % order.length];
    const list = byGender[bucket];
    result[id] = list[cursors[bucket] % list.length];
    cursors[bucket]++;
  });
  return result;
}
