import type { DialogueLine, Scene } from "../shared/scene";
import { voiceChoiceId, type VoiceChoice } from "../shared/voices";

/** The subset of HTMLAudioElement the transport relies on (fakeable in tests). */
export type AudioLike = {
  src: string;
  currentTime: number;
  duration: number;
  playbackRate: number;
  preservesPitch?: boolean;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};
export type SynthesisRequest = {
  provider: "openai" | "elevenlabs" | "piper";
  voice: string;
  speaker?: number;
  text: string;
};
export type SynthesisResult = {
  url: string;
  alignment?: { chars: string[]; starts: number[]; ends: number[] };
};
type Active = {
  key: string;
  start: number;
  end: number;
  status: "loading" | "playing" | "done" | "failed";
  age: number;
  progress: number;
  fraction: number;
  audio?: AudioLike;
  alignment?: SynthesisResult["alignment"];
  listeners: [string, () => void][];
};
const LOAD_TIMEOUT = 20;

export function audioLineKey(
  scene: Scene,
  line: DialogueLine,
  choice: VoiceChoice,
) {
  return JSON.stringify([
    scene.id,
    line.characterId,
    line.clipId,
    line.text,
    voiceChoiceId(choice),
  ]);
}

/**
 * Plays one spoken line from synthesized audio (cloud or local engine) and
 * advances the scene clock from the audio clock, like SpeechTransport does for
 * browser voices. A line that cannot be fetched or played is remembered as
 * failed so the caller can fall back to a browser voice for it.
 */
export class AudioLineTransport {
  private active: Active | null = null;
  private paused = false;
  private failed = new Set<string>();
  private prefetched = new Set<string>();
  private rate = 1;
  constructor(
    private synthesize: (request: SynthesisRequest) => Promise<SynthesisResult>,
    private createAudio: (url: string) => AudioLike,
    private report: (message: string) => void,
  ) {}
  hasFailed(key: string) {
    return this.failed.has(key);
  }
  stop() {
    const a = this.active;
    this.active = null;
    if (a?.audio) {
      for (const [type, fn] of a.listeners)
        a.audio.removeEventListener(type, fn);
      try {
        a.audio.pause();
        a.audio.src = "";
      } catch {}
    }
  }
  pause() {
    this.paused = true;
    if (this.active?.audio && this.active.status === "playing")
      this.active.audio.pause();
  }
  resume() {
    this.paused = false;
    if (this.active?.audio && this.active.status === "playing")
      this.active.audio
        .play()
        .catch(() =>
          this.fail(
            this.active!,
            "The browser blocked audio playback. Click play again.",
          ),
        );
  }
  prefetch(requests: SynthesisRequest[]) {
    for (const request of requests) {
      const id = JSON.stringify(request);
      if (this.prefetched.has(id)) continue;
      this.prefetched.add(id);
      this.synthesize(request).catch(() => this.prefetched.delete(id));
    }
  }
  private fail(record: Active, message: string) {
    if (this.active !== record || record.status === "failed") return;
    record.status = "failed";
    this.failed.add(record.key);
    if (record.audio) {
      try {
        record.audio.pause();
      } catch {}
    }
    this.report(message);
  }
  advance(
    scene: Scene,
    line: DialogueLine,
    timing: { start: number; end: number },
    choice: VoiceChoice,
    time: number,
    delta: number,
    rate: number,
  ): number {
    if (choice.provider === "browser") return time + delta * rate;
    const key = audioLineKey(scene, line, choice);
    this.rate = rate;
    if (this.active?.key !== key) {
      this.stop();
      // This request starts now; the preceding render gap is not its age.
      delta = 0;
      const fraction = Math.max(
        0,
        Math.min(1, (time - timing.start) / (timing.end - timing.start || 1)),
      );
      const record: Active = {
        key,
        start: timing.start,
        end: timing.end,
        status: "loading",
        age: 0,
        progress: fraction,
        fraction,
        listeners: [],
      };
      this.active = record;
      this.synthesize({
        provider: choice.provider,
        voice: choice.voice,
        ...(choice.speaker === undefined ? {} : { speaker: choice.speaker }),
        text: line.text,
      }).then(
        (result) => {
          if (this.active !== record) return;
          const audio = this.createAudio(result.url);
          record.audio = audio;
          record.alignment = result.alignment;
          audio.preservesPitch = true;
          audio.playbackRate = this.rate;
          const on = (type: string, fn: () => void) => {
            record.listeners.push([type, fn]);
            audio.addEventListener(type, fn);
          };
          on("loadedmetadata", () => {
            if (record.fraction > 0 && Number.isFinite(audio.duration))
              audio.currentTime = record.fraction * audio.duration;
          });
          on("ended", () => {
            if (this.active === record) record.status = "done";
          });
          on("error", () =>
            this.fail(
              record,
              `${line.name}’s voice file could not be played. The line continues with a browser voice.`,
            ),
          );
          if (this.paused) {
            record.status = "playing";
            return;
          }
          audio.play().then(
            () => {
              if (this.active === record && record.status === "loading")
                record.status = "playing";
            },
            () =>
              this.fail(
                record,
                "The browser blocked audio playback. Click play again to hear voices.",
              ),
          );
        },
        (error: Error) =>
          this.fail(
            record,
            `${line.name}’s voice could not be generated (${error.message}). The line continues with a browser voice.`,
          ),
      );
    }
    const a = this.active!;
    if (this.paused) return time;
    if (a.status === "failed") return time + delta * rate;
    if (a.status === "done") return a.end;
    if (a.audio) a.audio.playbackRate = rate;
    if (a.status === "loading") {
      a.age += delta;
      if (a.age > LOAD_TIMEOUT)
        this.fail(
          a,
          `${line.name}’s voice took too long to load. The line continues with a browser voice.`,
        );
      return time;
    }
    const span = a.end - a.start;
    const audio = a.audio!;
    const duration =
      Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : 0;
    let progress = a.progress;
    if (a.alignment && a.alignment.starts.length) {
      const { starts } = a.alignment;
      let index = 0;
      while (index < starts.length && starts[index] <= audio.currentTime)
        index++;
      progress = index / starts.length;
    } else if (duration) progress = audio.currentTime / duration;
    a.progress = Math.max(a.progress, Math.min(0.995, progress));
    return Math.max(time, a.start + span * a.progress);
  }
}
