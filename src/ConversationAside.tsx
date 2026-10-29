import { useState, type ReactNode } from "react";
import { MessageCircle, PanelRightClose, Volume2 } from "lucide-react";
import type { Entity } from "../shared/scene";

export function ConversationAside({open, onToggle, children, voiceEnabled, onVoiceEnabled, voices, cast, choices, onChoices, rate, onRate}: {
  open: boolean; onToggle: () => void; children: ReactNode;
  voiceEnabled: boolean; onVoiceEnabled: (v: boolean) => void;
  voices: SpeechSynthesisVoice[]; cast: Entity[]; choices: Record<string, string>;
  onChoices: (v: Record<string, string>) => void; rate: number; onRate: (v: number) => void;
}) {
  const [width, setWidth] = useState(350);
  return <aside className={`conversation-aside ${open ? "expanded" : "collapsed"}`} style={{width: open ? width : undefined}} aria-label="Cast conversation">
    {open && <div className="conversation-resize" role="separator" tabIndex={0} aria-label="Resize conversation panel" aria-orientation="vertical" aria-valuemin={290} aria-valuemax={540} aria-valuenow={width}
      onKeyDown={e => { if (["ArrowLeft", "ArrowRight"].includes(e.key)) { e.preventDefault(); setWidth(w => Math.max(290, Math.min(540, w + (e.key === "ArrowLeft" ? 20 : -20)))); } }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setWidth(Math.max(290, Math.min(540, e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX))); }}
      onPointerUp={e => e.currentTarget.releasePointerCapture(e.pointerId)} />}
    <button className="conversation-heading" onClick={onToggle} aria-expanded={open} aria-controls="conversation-controls" title={open ? "Collapse conversation" : "Open conversation"}>
      <MessageCircle size={18}/><span>{open ? "Direct the conversation" : "Conversation"}</span>{open && <PanelRightClose size={17}/>}
    </button>
    <div id="conversation-controls" hidden={!open} className="conversation-controls">
      <p className="conversation-intro">Give them something to talk about</p>
      <div className="conversation-voice">
        <label className="inline-label"><input type="checkbox" checked={voiceEnabled} disabled={!voices.length} onChange={e => onVoiceEnabled(e.target.checked)}/><Volume2 size={15}/> Voice playback</label>
        {!voices.length && <small>No voices are available in this browser. Bubbles and animation still play.</small>}
        {voiceEnabled && cast.map((actor, i) => <label key={actor.id}>{actor.name}’s voice<select value={choices[actor.id] || ""} onChange={e => onChoices({...choices, [actor.id]:e.target.value})}>
          <option value="">Automatic · {voices[i % voices.length]?.name}</option>
          {voices.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} · {v.lang}{v.localService ? "" : " · online"}</option>)}
        </select></label>)}
        <label>Conversation pace <span>{rate.toFixed(2)}×</span><input aria-label="Conversation pace" type="range" min="0.65" max="1.4" step="0.05" value={rate} onChange={e => onRate(Number(e.target.value))}/></label>
      </div>
      {children}
    </div>
  </aside>;
}
