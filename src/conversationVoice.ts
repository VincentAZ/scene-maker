import { useEffect, useRef, useState } from "react";
import type { Scene } from "../shared/scene";
import { SpeechTransport } from "./speechTransport";
import { AudioLineTransport, type SynthesisResult } from "./audioTransport";
import { VoiceTransport } from "./voiceTransport";
import { api } from "./api";
import { routeRecordingAudio } from "./recordingAudio";

export function useConversationVoice(
  scene: Scene,
  playing: boolean,
  enabled: boolean,
  choices: Record<string, string>,
  rate: number,
  onError: (message: string) => void,
) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const current = useRef({ scene, enabled, choices, rate, onError });
  current.current = { scene, enabled, choices, rate, onError };
  const transport = useRef<VoiceTransport | null>(null);
  useEffect(() => {
    const synth = window.speechSynthesis;
    const report = (text: string) => current.current.onError(text);
    const speech = synth
      ? new SpeechTransport(
          synth,
          (text) => new SpeechSynthesisUtterance(text),
          report,
        )
      : null;
    const audio = new AudioLineTransport(
      (request) =>
        api<SynthesisResult>("/api/speech", {
          method: "POST",
          body: JSON.stringify(request),
        }),
      (url) => routeRecordingAudio(new Audio(url)),
      report,
    );
    // Without browser speech synthesis, synthesized voices still work and
    // browser-voice lines simply keep scene time.
    transport.current = new VoiceTransport(
      speech ??
        ({
          stop() {},
          pause() {},
          resume() {},
          advance: (
            _scene: Scene,
            time: number,
            delta: number,
            options: { rate: number },
          ) => time + delta * options.rate,
        } as unknown as SpeechTransport),
      audio,
    );
    if (!synth) return () => transport.current?.stop();
    const update = () => setVoices(synth.getVoices());
    update();
    synth.addEventListener("voiceschanged", update);
    return () => {
      synth.removeEventListener("voiceschanged", update);
      transport.current?.stop();
      transport.current = null;
    };
  }, []);
  useEffect(() => {
    transport.current?.stop();
  }, [scene.id, enabled, choices, rate]);
  useEffect(() => {
    if (playing) transport.current?.resume();
    else transport.current?.pause();
  }, [playing]);
  const playbackState = (state: "seek" | "pause" | "play") => {
    if (state === "seek") transport.current?.stop();
    if (state === "pause") transport.current?.pause();
    if (state === "play") transport.current?.resume();
  };
  const advance = (time: number, delta: number) => {
    const { scene, enabled, choices, rate } = current.current;
    return (
      transport.current?.advance(scene, time, delta, {
        enabled,
        choices,
        rate,
      }) ?? time + delta * rate
    );
  };
  return {
    voices,
    advance,
    stop: () => transport.current?.stop(),
    playbackState,
  };
}
