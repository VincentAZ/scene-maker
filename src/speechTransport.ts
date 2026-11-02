import type { Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";

export type VoiceOptions = {
  enabled: boolean;
  choices: Record<string, string>;
  rate: number;
};
type ActiveSpeech = {
  key: string;
  utterance: SpeechSynthesisUtterance;
  started: boolean;
  done: boolean;
  failed: boolean;
  age: number;
  spoken: number;
  offset: number;
  progress: number;
  word: number;
  wordTime: number;
  start: number;
  end: number;
  textLength: number;
};
/** Owns one utterance. The audio clock advances the scene, including walking paths. */
export class SpeechTransport {
  private active: ActiveSpeech | null = null;
  private paused = false;
  constructor(
    private synth: Pick<
      SpeechSynthesis,
      "getVoices" | "speak" | "cancel" | "pause" | "resume"
    >,
    private makeUtterance: (text: string) => SpeechSynthesisUtterance,
    private report: (message: string) => void,
  ) {}
  stop() {
    this.active = null;
    this.synth.cancel();
  }
  pause() {
    this.paused = true;
    this.synth.pause();
  }
  resume() {
    this.paused = false;
    this.synth.resume();
  }
  advance(scene: Scene, time: number, delta: number, options: VoiceOptions) {
    const line = dialogueAt(scene, time)[0];
    if (!options.enabled || !line) {
      if (this.active) this.stop();
      return time + delta * (line ? options.rate : 1);
    }
    const timing = dialogueTiming(scene, line)!;
    const key = JSON.stringify([
      scene.id,
      line.characterId,
      line.clipId,
      line.text,
      options.choices[line.characterId],
      options.rate,
    ]);
    if (this.active?.key !== key) {
      this.stop();
      const voices = this.synth.getVoices();
      if (!voices.length) return time + delta * options.rate;
      // This request starts now; the preceding render gap is not its age.
      delta = 0;
      const fraction = Math.max(
        0,
        (time - timing.start) / (timing.end - timing.start),
      );
      let offset = Math.floor(line.text.length * fraction);
      // A seek resumes at a whole word near the playhead, never midway through a word.
      while (offset > 0 && !/\s/.test(line.text[offset - 1])) offset--;
      const utterance = this.makeUtterance(line.text.slice(offset));
      const ids = [...new Set(scene.transcript.map((l) => l.characterId))];
      const preferred = voices.filter((v) => /^en(?:-|$)/i.test(v.lang));
      const defaults = preferred.length ? preferred : voices;
      utterance.voice =
        voices.find((v) => v.voiceURI === options.choices[line.characterId]) ||
        defaults[ids.indexOf(line.characterId) % defaults.length];
      utterance.rate = options.rate;
      const record: ActiveSpeech = {
        key,
        utterance,
        started: false,
        done: false,
        failed: false,
        age: 0,
        spoken: 0,
        offset,
        progress: fraction,
        word: offset,
        wordTime: 0,
        start: timing.start,
        end: timing.end,
        textLength: line.text.length,
      };
      this.active = record;
      utterance.onstart = () => {
        if (this.active === record) record.started = true;
      };
      utterance.onboundary = (e) => {
        if (this.active !== record) return;
        record.word = Math.min(line.text.length, offset + e.charIndex);
        record.wordTime = record.spoken;
      };
      utterance.onend = () => {
        if (this.active === record) record.done = true;
      };
      utterance.onerror = (e) => {
        if (this.active !== record) return;
        record.failed = true;
        if (e.error !== "canceled" && e.error !== "interrupted")
          this.report(
            `Voice playback failed (${e.error}). This line will continue silently.`,
          );
      };
      this.synth.speak(utterance);
      if (!this.paused) this.synth.resume();
    }
    const a = this.active!;
    if (this.paused) return time;
    a.age += delta;
    if (!a.failed && !a.done && ((!a.started && a.age > 5) || a.age > 120)) {
      a.failed = true;
      this.synth.cancel();
      this.report(
        "The browser voice did not respond. This line will continue silently; try another voice.",
      );
    }
    if (a.failed) return time + delta * options.rate;
    if (!a.started && !a.done) return time;
    a.spoken += delta;
    const span = a.end - a.start;
    // Estimate between boundary events, adapting to the voice's measured character rate.
    const measured =
      a.word > a.offset && a.wordTime > 0.2
        ? (a.word - a.offset) / a.wordTime
        : 13 * options.rate;
    const spokenChars = a.word + (a.spoken - a.wordTime) * measured;
    const predicted = spokenChars / a.textLength;
    // Some voices never report the end of an utterance (long remote voices,
    // a dropped speech service). Once the line should have finished, with a
    // grace of 1.5 s or a quarter of its length, finish it silently rather
    // than freezing the scene near the last word.
    if (!a.done) {
      const overrun = (spokenChars - a.textLength) / measured;
      if (overrun > Math.max(1.5, (0.25 * a.textLength) / measured)) {
        a.done = true;
        this.synth.cancel();
      }
    }
    const target = a.done ? 1 : Math.min(0.985, predicted);
    const step = Math.max(0, target - a.progress);
    // Smooth corrections over ~.2s instead of jumping bodies between word boundaries.
    a.progress = Math.min(1, a.progress + step * Math.min(1, delta * 12));
    if (a.done && 1 - a.progress < 0.002) return a.end;
    return Math.max(time, a.start + span * a.progress);
  }
}
