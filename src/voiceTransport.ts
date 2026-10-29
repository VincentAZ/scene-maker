import type { Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";
import { parseVoiceChoice } from "../shared/voices";
import type { SpeechTransport } from "./speechTransport";
import { audioLineKey, type AudioLineTransport } from "./audioTransport";

export type VoiceOptions = {
  enabled: boolean;
  /** Effective choice per character id ("provider:voice[#speaker]" or a browser voiceURI). */
  choices: Record<string, string>;
  rate: number;
};

/**
 * Routes each spoken line to the right engine: browser speech synthesis or
 * synthesized audio (OpenAI, ElevenLabs, Piper). A synthesized line that fails
 * falls back to the browser voice for that line only.
 */
export class VoiceTransport {
  private mode: "none" | "speech" | "audio" = "none";
  constructor(
    private speech: SpeechTransport,
    private audio: AudioLineTransport,
  ) {}
  stop() {
    this.speech.stop();
    this.audio.stop();
    this.mode = "none";
  }
  pause() {
    this.speech.pause();
    this.audio.pause();
  }
  resume() {
    this.speech.resume();
    this.audio.resume();
  }
  private browserChoices(choices: Record<string, string>) {
    return Object.fromEntries(
      Object.entries(choices).map(([id, value]) => {
        const choice = parseVoiceChoice(value);
        return [id, choice?.provider === "browser" ? choice.voice : ""];
      }),
    );
  }
  advance(scene: Scene, time: number, delta: number, options: VoiceOptions) {
    const line = options.enabled ? dialogueAt(scene, time)[0] : undefined;
    const choice = line
      ? parseVoiceChoice(options.choices[line.characterId])
      : null;
    const timing = line ? dialogueTiming(scene, line) : null;
    const synthesized =
      line &&
      choice &&
      timing &&
      choice.provider !== "browser" &&
      !this.audio.hasFailed(audioLineKey(scene, line, choice));
    if (synthesized) {
      if (this.mode === "speech") this.speech.stop();
      this.mode = "audio";
      this.prefetch(scene, timing.end, options);
      return this.audio.advance(
        scene,
        line,
        timing,
        choice,
        time,
        delta,
        options.rate,
      );
    }
    if (this.mode === "audio") this.audio.stop();
    this.mode = options.enabled && line ? "speech" : "none";
    return this.speech.advance(scene, time, delta, {
      enabled: options.enabled,
      choices: this.browserChoices(options.choices),
      rate: options.rate,
    });
  }
  /** Warm the cache for the next synthesized lines so they start on time. */
  prefetch(scene: Scene, after: number, options: VoiceOptions, count = 2) {
    const upcoming = scene.transcript
      .map((line) => ({ line, timing: dialogueTiming(scene, line) }))
      .filter((item) => item.timing && item.timing.start >= after - 0.001)
      .sort((a, b) => a.timing!.start - b.timing!.start)
      .slice(0, count);
    const requests = [];
    for (const { line } of upcoming) {
      const choice = parseVoiceChoice(options.choices[line.characterId]);
      if (!choice || choice.provider === "browser") continue;
      requests.push({
        provider: choice.provider,
        voice: choice.voice,
        ...(choice.speaker === undefined ? {} : { speaker: choice.speaker }),
        text: line.text,
      });
    }
    if (requests.length) this.audio.prefetch(requests);
  }
}
