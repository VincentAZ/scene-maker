import { useEffect, useRef, useState } from "react";
import type { Scene } from "../shared/scene";
import { dialogueAt, dialogueTiming } from "../shared/conversation";

/** A single transport for speech and animation. Voice completion gates the next turn. */
export function useConversationVoice(scene: Scene, playing: boolean, enabled: boolean, choices: Record<string,string>, rate: number, onError: (message:string)=>void) {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const current = useRef({scene, enabled, choices, rate, onError});
  current.current = {scene, enabled, choices, rate, onError};
  const active = useRef<{key:string; done:boolean; started:number; utterance:SpeechSynthesisUtterance} | null>(null);
  const stop = () => { active.current = null; window.speechSynthesis?.cancel(); };
  useEffect(() => {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const update = () => setVoices(synth.getVoices());
    update(); synth.addEventListener("voiceschanged", update);
    return () => { synth.removeEventListener("voiceschanged", update); stop(); };
  }, []);
  useEffect(() => { stop(); }, [scene.id, enabled, choices, rate]);
  useEffect(() => {
    if (!playing) window.speechSynthesis?.pause();
    else window.speechSynthesis?.resume();
  }, [playing]);
  // Called on a seek or pause by the viewport, before the next animation frame.
  const playbackState = (state: "seek" | "pause" | "play") => {
    if (state === "seek") stop();
    if (state === "pause") window.speechSynthesis?.pause();
    if (state === "play") window.speechSynthesis?.resume();
  };
  const advance = (time:number, delta:number) => {
    const {scene, enabled, choices, rate, onError} = current.current;
    const line = dialogueAt(scene, time)[0];
    if (!enabled || !line || !window.speechSynthesis) return time + delta * rate;
    const timing = dialogueTiming(scene, line)!;
    const key = `${scene.id}:${line.characterId}:${line.clipId}:${line.text}`;
    if (active.current?.key !== key) {
      stop();
      const available = window.speechSynthesis.getVoices();
      if (!available.length) return time + delta * rate;
      const utterance = new SpeechSynthesisUtterance(line.text);
      const ids = [...new Set(scene.transcript.map(l => l.characterId))];
      utterance.voice = available.find(v => v.voiceURI === choices[line.characterId]) || available[ids.indexOf(line.characterId) % available.length];
      utterance.rate = rate;
      const record = {key, done:false, started:performance.now(), utterance};
      active.current = record;
      utterance.onend = () => { if (active.current === record) record.done = true; };
      utterance.onerror = e => {
        if (active.current !== record) return;
        record.done = true;
        if (e.error !== "canceled" && e.error !== "interrupted") onError(`Voice playback could not continue (${e.error}). You can turn voice off and keep playing.`);
      };
      window.speechSynthesis.speak(utterance);
    }
    const a = active.current!;
    if (!a.done && performance.now() - a.started > 90000) {
      stop(); onError("The voice stopped responding. Turn voice off to continue.");
      return time + delta * rate;
    }
    return a.done ? Math.max(time + delta * rate, timing.end) : Math.min(time + delta * rate, timing.end - 0.001);
  };
  return {voices, advance, stop, playbackState};
}
