import { useEffect, useRef, useState } from "react";
import type { Scene } from "../shared/scene";
import { SpeechTransport } from "./speechTransport";

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
  const transport = useRef<SpeechTransport | null>(null);
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    transport.current = new SpeechTransport(
      synth,
      (text) => new SpeechSynthesisUtterance(text),
      (text) => current.current.onError(text),
    );
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
