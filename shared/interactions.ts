import type { Scene, Motion } from "./scene";
export type TargetAction = {
  actorId: string;
  targetId: string;
  kind: "pick" | "sip" | "place";
  start: number;
  end: number;
};
export type HoldSession = {
  actorId: string;
  targetId: string;
  acquire: TargetAction;
  actions: TargetAction[];
  end: number;
  temporary: boolean;
};

// Derive ownership from the whole sequence, not from the previous rendered frame.
// Scrubbing, playback and export therefore produce the same prop state.
export function interactionSessions(
  scene: Scene,
  motions: Motion[],
): HoldSession[] {
  const sessions: HoldSession[] = [];
  for (const actor of scene.entities) {
    if (!actor.visible) continue;
    let start = 0,
      held: HoldSession | null = null;
    for (const clip of actor.clips) {
      const kind = motions.find((m) => m.id === clip.motionId)?.kind;
      const end = start + clip.duration;
      if (
        clip.targetId &&
        (kind === "pick" || kind === "sip" || kind === "place")
      ) {
        const action: TargetAction = {
          actorId: actor.id,
          targetId: clip.targetId,
          kind,
          start,
          end,
        };
        if (held && held.targetId !== clip.targetId)
          throw Error(
            `${actor.name} is already holding a prop. Add Put down before using another one.`,
          );
        if (kind === "place") {
          if (!held)
            throw Error(
              `${actor.name} needs to pick up this prop before putting it down.`,
            );
          held.actions.push(action);
          held.end = end;
          held = null;
        } else if (held) held.actions.push(action);
        else {
          const session: HoldSession = {
            actorId: actor.id,
            targetId: clip.targetId,
            acquire: action,
            actions: [action],
            end: kind === "sip" ? end : Infinity,
            temporary: kind === "sip",
          };
          sessions.push(session);
          if (kind === "pick") held = session;
        }
      }
      start = end;
    }
  }
  for (let i = 0; i < sessions.length; i++) {
    const a = sessions[i];
    for (const b of sessions.slice(i + 1))
      if (
        a.targetId === b.targetId &&
        a.actorId !== b.actorId &&
        a.acquire.start < b.end &&
        b.acquire.start < a.end
      )
        throw Error(
          "Two characters cannot hold the same prop at the same time. Put it down before the next character picks it up.",
        );
  }
  return sessions.sort((a, b) => a.acquire.start - b.acquire.start);
}
export function interactionPhase(session: HoldSession, time: number) {
  const action = session.actions.find((a) => time >= a.start && time < a.end);
  return {
    kind: action?.kind || "hold",
    u: action ? (time - action.start) / (action.end - action.start) : 1,
    acquiring: action === session.acquire,
  };
}
