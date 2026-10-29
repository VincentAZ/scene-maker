import { useState, useEffect, type ReactNode } from "react";
import {
  MessageCircle,
  PanelRightClose,
  Settings2,
  Volume2,
} from "lucide-react";
import {
  readConversationPreferences,
  saveConversationPreferences,
} from "./conversationPreferences";
import type { Entity } from "../shared/scene";
import {
  parseVoiceChoice,
  type VoiceOption,
  type VoiceProvider,
} from "../shared/voices";
import { PanelResize } from "./PanelResize";

export type VoiceGroup = {
  provider: VoiceProvider;
  label: string;
  voices: VoiceOption[];
};
export function ConversationAside({
  open,
  onToggle,
  children,
  voiceEnabled,
  onVoiceEnabled,
  groups,
  catalogErrors,
  catalogLoading,
  cast,
  choices,
  onChoice,
  onPreview,
  onMoreVoices,
  rate,
  onRate,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  voiceEnabled: boolean;
  onVoiceEnabled: (v: boolean) => void;
  groups: VoiceGroup[];
  catalogErrors: string[];
  catalogLoading: boolean;
  cast: Entity[];
  /** Effective choice per character, including automatic casting. */
  choices: Record<string, string>;
  onChoice: (characterId: string, choiceId: string) => void;
  onPreview: (characterId: string) => void;
  onMoreVoices: () => void;
  rate: number;
  onRate: (v: number) => void;
}) {
  const [width, setWidth] = useState(() => readConversationPreferences().width);
  useEffect(() => {
    saveConversationPreferences({ width });
  }, [width]);
  const total = groups.reduce((n, g) => n + g.voices.length, 0);
  const byId = new Map(
    groups.flatMap((g) => g.voices.map((v) => [v.id, v] as const)),
  );
  const describe = (id: string) => {
    const option = byId.get(id);
    if (option) return option.name;
    const parsed = parseVoiceChoice(id);
    return parsed ? parsed.voice : "none available";
  };
  return (
    <aside
      className={`conversation-aside ${open ? "expanded" : "collapsed"}`}
      style={{ width: open ? width : undefined }}
      aria-label="Cast conversation"
    >
      {open && (
        <PanelResize
          label="Resize conversation panel"
          controls="conversation-controls"
          width={width}
          onWidth={setWidth}
        />
      )}
      <button
        className="conversation-heading"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="conversation-controls"
        title={open ? "Collapse conversation" : "Open conversation"}
      >
        <MessageCircle size={18} />
        <span>{open ? "Direct the conversation" : "Conversation"}</span>
        {open && <PanelRightClose size={17} />}
      </button>
      <div
        id="conversation-controls"
        hidden={!open}
        className="conversation-controls"
      >
        <p className="conversation-intro">Give them something to talk about</p>
        <details className="conversation-voice">
          <summary>Voice &amp; pace {voiceEnabled ? "· on" : "· off"}</summary>
          <label className="inline-label">
            <input
              type="checkbox"
              checked={voiceEnabled}
              disabled={!total && !catalogLoading}
              onChange={(e) => onVoiceEnabled(e.target.checked)}
            />
            <Volume2 size={15} /> Voice playback
          </label>
          <p className="small muted">
            {catalogLoading && !total
              ? "Finding voices…"
              : total
                ? `${total} voices available: local engines run on this computer, cloud voices are billed by their provider. Lines are cached after the first play.`
                : "No voices yet. Install local Piper voices or add a cloud key under More voices."}
          </p>
          {catalogErrors.map((message) => (
            <p key={message} className="small danger" role="alert">
              {message}
            </p>
          ))}
          {voiceEnabled &&
            cast.map((actor) => {
              const choice = choices[actor.id] || "";
              const explicit = !!actor.voice;
              return (
                <div className="voice-choice-row" key={actor.id}>
                  <label>
                    {actor.name}’s voice
                    <select
                      aria-label={`${actor.name}’s voice`}
                      value={explicit ? actor.voice : ""}
                      onChange={(e) => onChoice(actor.id, e.target.value)}
                    >
                      <option value="">Automatic · {describe(choice)}</option>
                      {explicit && !byId.has(actor.voice!) && (
                        <option value={actor.voice}>
                          {describe(actor.voice!)} · not available now
                        </option>
                      )}
                      {groups.map((group) => (
                        <optgroup key={group.provider} label={group.label}>
                          {group.voices.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                              {v.gender ? ` · ${v.gender}` : ""}
                              {v.description ? ` · ${v.description}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Preview ${actor.name}’s voice`}
                    title="Hear a sample"
                    disabled={!choice}
                    onClick={() => onPreview(actor.id)}
                  >
                    <Volume2 size={14} />
                  </button>
                </div>
              );
            })}
          <label>
            Conversation pace <span>{rate.toFixed(2)}×</span>
            <input
              aria-label="Conversation pace"
              type="range"
              min="0.65"
              max="1.4"
              step="0.05"
              value={rate}
              onChange={(e) => onRate(Number(e.target.value))}
            />
          </label>
          <button type="button" className="text-button" onClick={onMoreVoices}>
            <Settings2 size={13} /> More voices: install local voices or add
            cloud keys
          </button>
        </details>
        {children}
      </div>
    </aside>
  );
}
