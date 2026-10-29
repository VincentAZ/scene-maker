import { describe, expect, it, vi } from "vitest";
import { applyCommands, starterScene } from "../shared/scene";
import { appendSpeech, dialogueTiming } from "../shared/conversation";
import { SpeechTransport } from "../src/speechTransport";
import { AudioLineTransport, type AudioLike } from "../src/audioTransport";
import { VoiceTransport } from "../src/voiceTransport";
import {
  automaticPool,
  effectiveVoiceChoices,
  browserVoiceOptions,
} from "../src/voiceCatalog";
import { openaiVoices } from "../shared/voices";

function fixture() {
  let s = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "a", position: [-1, 0, 0] },
    { type: "add", assetId: "leo", id: "b", position: [1, 0, 0] },
  ]);
  s = appendSpeech(s, "a", {
    dialogue: "Here is a riddle for you. What gets wetter as it dries?",
    action: "talk",
  });
  return appendSpeech(s, "b", {
    dialogue: "A towel! Here is another one.",
    action: "talk",
  });
}
class FakeAudio implements AudioLike {
  static created: FakeAudio[] = [];
  src: string;
  currentTime = 0;
  duration = NaN;
  playbackRate = 1;
  preservesPitch?: boolean;
  paused = true;
  listeners = new Map<string, Set<() => void>>();
  constructor(url: string) {
    this.src = url;
    FakeAudio.created.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  addEventListener(type: string, fn: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: () => void) {
    this.listeners.get(type)?.delete(fn);
  }
  emit(type: string) {
    for (const fn of this.listeners.get(type) || []) fn();
  }
  ready(duration: number) {
    this.duration = duration;
    this.emit("loadedmetadata");
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0));
function speechFixture() {
  const utterances: SpeechSynthesisUtterance[] = [];
  const synth = {
    getVoices: () => [
      {
        voiceURI: "english",
        lang: "en-US",
        name: "English",
      } as SpeechSynthesisVoice,
    ],
    speak: (u: SpeechSynthesisUtterance) => utterances.push(u),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const report = vi.fn();
  const speech = new SpeechTransport(
    synth,
    (text) => ({ text }) as SpeechSynthesisUtterance,
    report,
  );
  return { speech, synth, utterances, report };
}

describe("synthesized voice playback", () => {
  it("holds the clock while audio loads, then follows the audio clock and ends the line", async () => {
    FakeAudio.created = [];
    const synthesize = vi.fn(async () => ({ url: "/speech/abc.mp3" }));
    const report = vi.fn();
    const audio = new AudioLineTransport(
      synthesize,
      (url) => new FakeAudio(url),
      report,
    );
    const { speech } = speechFixture();
    const transport = new VoiceTransport(speech, audio);
    const s = fixture();
    const options = {
      enabled: true,
      choices: { a: "openai:nova", b: "browser:english" },
      rate: 1,
    };
    expect(transport.advance(s, 0, 0.1, options)).toBe(0); // loading
    expect(synthesize).toHaveBeenCalledWith({
      provider: "openai",
      voice: "nova",
      text: s.transcript[0].text,
    });
    await flush();
    const clip = FakeAudio.created[0];
    clip.ready(4);
    expect(transport.advance(s, 0, 0.1, options)).toBe(0);
    clip.currentTime = 2;
    const end = dialogueTiming(s, s.transcript[0])!.end;
    const mid = transport.advance(s, 0, 0.1, options);
    expect(mid).toBeCloseTo(end / 2, 1);
    clip.currentTime = 4;
    clip.emit("ended");
    expect(transport.advance(s, mid, 0.1, options)).toBe(end);
    expect(report).not.toHaveBeenCalled();
    // The second line uses a browser voice: speech synthesis takes over.
    const { speech: speech2, utterances } = speechFixture();
    const transport2 = new VoiceTransport(speech2, audio);
    transport2.advance(s, end + 0.01, 0.05, options);
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe(s.transcript[1].text);
    // Prefetch warmed the cache for the line after the current one.
    expect(synthesize.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
  it("maps ElevenLabs character timings to progress and keeps the pace control", async () => {
    FakeAudio.created = [];
    const synthesize = vi.fn(async () => ({
      url: "/speech/el.mp3",
      alignment: {
        chars: ["a", "b", "c", "d"],
        starts: [0, 1, 2, 3],
        ends: [1, 2, 3, 4],
      },
    }));
    const audio = new AudioLineTransport(
      synthesize,
      (url) => new FakeAudio(url),
      vi.fn(),
    );
    const s = fixture();
    const line = s.transcript[0];
    const timing = dialogueTiming(s, line)!;
    const choice = { provider: "elevenlabs" as const, voice: "v1" };
    audio.advance(s, line, timing, choice, 0, 0.1, 1.2);
    await flush();
    const clip = FakeAudio.created[0];
    expect(clip.playbackRate).toBe(1.2);
    clip.ready(4);
    clip.currentTime = 2.5; // three characters started
    const t = audio.advance(s, line, timing, choice, 0, 0.1, 1.2);
    expect(t).toBeCloseTo(timing.start + (timing.end - timing.start) * 0.75, 2);
  });
  it("falls back to the browser voice for a line whose audio fails, and only that line", async () => {
    FakeAudio.created = [];
    const synthesize = vi.fn(async () => {
      throw Error("no key");
    });
    const report = vi.fn();
    const audio = new AudioLineTransport(
      synthesize,
      (url) => new FakeAudio(url),
      report,
    );
    const { speech, utterances } = speechFixture();
    const transport = new VoiceTransport(speech, audio);
    const s = fixture();
    const options = {
      enabled: true,
      choices: { a: "piper:en_US-amy-medium", b: "openai:onyx" },
      rate: 1,
    };
    transport.advance(s, 0, 0.1, options);
    await flush();
    const t = transport.advance(s, 0, 0.1, options);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("browser voice");
    expect(t).toBe(0); // the browser transport is now waiting for its utterance to start
    expect(utterances).toHaveLength(1);
    expect(utterances[0].text).toBe(s.transcript[0].text);
  });
  it("times out a load that never completes", async () => {
    const synthesize = vi.fn(() => new Promise<never>(() => {}));
    const report = vi.fn();
    const audio = new AudioLineTransport(
      synthesize,
      (url) => new FakeAudio(url),
      report,
    );
    const s = fixture();
    const line = s.transcript[0];
    const timing = dialogueTiming(s, line)!;
    const choice = { provider: "openai" as const, voice: "nova" };
    let t = 0;
    for (let i = 0; i < 230; i++)
      t = audio.advance(s, line, timing, choice, t, 0.1, 1);
    expect(report).toHaveBeenCalledTimes(1);
    expect(t).toBeGreaterThan(0);
  });
  it("resolves explicit, legacy and automatic voice choices with variety", () => {
    const browser = browserVoiceOptions([
      {
        voiceURI: "Google US English",
        name: "Google US English",
        lang: "en-US",
        localService: false,
      } as SpeechSynthesisVoice,
      {
        voiceURI: "Daniel",
        name: "Daniel",
        lang: "en-GB",
        localService: true,
      } as SpeechSynthesisVoice,
    ]);
    const all = [...openaiVoices, ...browser];
    expect(automaticPool(all).every((v) => v.provider === "openai")).toBe(true);
    const choices = effectiveVoiceChoices(
      [
        { id: "a", voice: "openai:onyx" },
        { id: "b" },
        { id: "c" },
        { id: "d", voice: "stale:thing" },
      ],
      { c: "Daniel" },
      all,
    );
    expect(choices.a).toBe("openai:onyx");
    expect(choices.c).toBe("browser:Daniel");
    expect(choices.b).toMatch(/^openai:/);
    expect(choices.d).toMatch(/^openai:/);
    expect(choices.b).not.toBe(choices.d);
    expect(automaticPool(browser).map((v) => v.id)).toEqual([
      "browser:Google US English",
      "browser:Daniel",
    ]);
  });
});
