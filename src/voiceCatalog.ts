import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import {
  automaticVoices,
  parseVoiceChoice,
  providerLabels,
  type VoiceOption,
  type VoiceProvider,
} from "../shared/voices";
import type { SynthesisRequest, SynthesisResult } from "./audioTransport";

export type ServerVoices = {
  openai: VoiceOption[];
  elevenlabs: VoiceOption[];
  piper: VoiceOption[];
  piperEngine: boolean;
  errors: string[];
};
const empty: ServerVoices = {
  openai: [],
  elevenlabs: [],
  piper: [],
  piperEngine: false,
  errors: [],
};
let cache: { revision: number; promise: Promise<ServerVoices> } | null = null;
export function loadServerVoices(revision: number, refresh = false) {
  if (!cache || cache.revision !== revision || refresh) {
    const promise = api<ServerVoices>("/api/speech/voices");
    const entry = { revision, promise };
    cache = entry;
    promise.catch(() => {
      if (cache === entry) cache = null;
    });
  }
  return cache.promise;
}

/** The browser's speech-synthesis voices, refreshed when the engine reports changes. */
export function useBrowserVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => synth.removeEventListener("voiceschanged", update);
  }, []);
  return voices;
}

export function browserVoiceOptions(
  voices: SpeechSynthesisVoice[],
): VoiceOption[] {
  return voices.map((v) => ({
    id: `browser:${v.voiceURI}`,
    provider: "browser" as const,
    voice: v.voiceURI,
    name: v.name,
    lang: v.lang,
    gender:
      /female|woman|zira|samantha|victoria|karen|moira|tessa|fiona|susan|hazel|aria|jenny|emma|libby|sonia|ava|allison|joanna|salli|kimberly|kendra|ivy/i.test(
        v.name,
      )
        ? "female"
        : /male|man\b|david|mark|daniel|alex|fred|george|ryan|guy|brian|matthew|joey|justin|thomas|oliver|arthur/i.test(
              v.name,
            )
          ? "male"
          : undefined,
    description: v.localService ? "On this computer" : "Online voice",
    local: v.localService,
  }));
}

/** Every voice the studio can use right now, grouped for a selector. */
export function useVoiceCatalog(
  revision: number,
  browserVoices: SpeechSynthesisVoice[],
) {
  const [server, setServer] = useState<ServerVoices>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    loadServerVoices(revision, tick > 0).then(
      (next) => {
        if (!active) return;
        setServer(next);
        setError("");
        setLoading(false);
      },
      (e: Error) => {
        if (!active) return;
        setError(e.message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
    };
  }, [revision, tick]);
  const options = useMemo(() => {
    const browser = browserVoiceOptions(browserVoices);
    const groups: {
      provider: VoiceProvider;
      label: string;
      voices: VoiceOption[];
    }[] = [
      {
        provider: "piper" as const,
        label: providerLabels.piper,
        voices: server.piper,
      },
      {
        provider: "browser" as const,
        label: providerLabels.browser,
        voices: browser,
      },
      {
        provider: "openai" as const,
        label: providerLabels.openai,
        voices: server.openai,
      },
      {
        provider: "elevenlabs" as const,
        label: providerLabels.elevenlabs,
        voices: server.elevenlabs,
      },
    ].filter((g) => g.voices.length);
    const all = groups.flatMap((g) => g.voices);
    return { groups, all, byId: new Map(all.map((v) => [v.id, v])) };
  }, [server, browserVoices]);
  return {
    groups: options.groups,
    all: options.all,
    byId: options.byId,
    piperEngine: server.piperEngine,
    errors: [...server.errors, ...(error ? [error] : [])],
    loading,
    reload: () => setTick((t) => t + 1),
  };
}

/**
 * The pool automatic casting draws from: the best local voices first, then
 * cloud voices with a key, then whatever the browser offers in English.
 */
export function automaticPool(all: VoiceOption[]): VoiceOption[] {
  const piper = all.filter(
    (v) => v.provider === "piper" && /^en/i.test(v.lang),
  );
  if (piper.length >= 2) return piper;
  const openai = all.filter((v) => v.provider === "openai");
  if (openai.length) return [...piper, ...openai];
  const eleven = all.filter((v) => v.provider === "elevenlabs");
  if (eleven.length) return [...piper, ...eleven];
  const english = all.filter(
    (v) => v.provider === "browser" && /^en(?:-|_|$)/i.test(v.lang),
  );
  return english.length ? english : all.filter((v) => v.provider === "browser");
}

/** Resolve explicit, legacy and automatic choices into one map for playback. */
export function effectiveVoiceChoices(
  cast: { id: string; voice?: string }[],
  legacy: Record<string, string>,
  all: VoiceOption[],
): Record<string, string> {
  const pool = automaticPool(all);
  const known = new Set(all.map((v) => v.id));
  const automatic = automaticVoices(
    cast.map((e) => e.id),
    pool,
  );
  const result: Record<string, string> = {};
  for (const e of cast) {
    // Browser voices load asynchronously, so an explicit browser choice is
    // kept even before the engine lists it; anything else must exist now.
    const explicit =
      e.voice && (known.has(e.voice) || e.voice.startsWith("browser:"))
        ? e.voice
        : "";
    const old = legacy[e.id] ? `browser:${legacy[e.id]}` : "";
    result[e.id] =
      explicit ||
      (old && known.has(old) ? old : "") ||
      automatic[e.id]?.id ||
      "";
  }
  return result;
}

const sample = (name: string) =>
  `Hi, I’m ${name}. This is how I sound in your scene.`;
let preview: { stop: () => void } | null = null;
/** Plays a short sample in the chosen voice; a new preview stops the previous one. */
export async function previewVoice(
  choiceId: string,
  speaker: string,
  rate: number,
  synthesize: (request: SynthesisRequest) => Promise<SynthesisResult> = (
    request,
  ) =>
    api<SynthesisResult>("/api/speech", {
      method: "POST",
      body: JSON.stringify(request),
    }),
) {
  preview?.stop();
  preview = null;
  const choice = parseVoiceChoice(choiceId);
  if (!choice) return;
  const text = sample(speaker);
  if (choice.provider === "browser") {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice =
      synth.getVoices().find((v) => v.voiceURI === choice.voice) || null;
    utterance.rate = rate;
    synth.cancel();
    synth.speak(utterance);
    preview = { stop: () => synth.cancel() };
    return;
  }
  const result = await synthesize({
    provider: choice.provider,
    voice: choice.voice,
    ...(choice.speaker === undefined ? {} : { speaker: choice.speaker }),
    text,
  });
  const audio = new Audio(result.url);
  audio.playbackRate = rate;
  preview = {
    stop: () => {
      audio.pause();
      audio.src = "";
    },
  };
  await audio.play();
}
