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
  const climbs: {
    actorId: string;
    targetId: string;
    start: number;
    end: number;
  }[] = [];
  for (const actor of scene.entities) {
    if (!actor.visible) continue;
    let start = 0,
      held: HoldSession | null = null;
    for (const [index, clip] of actor.clips.entries()) {
      const kind = motions.find((m) => m.id === clip.motionId)?.kind;
      const end = start + clip.duration;
      if (clip.targetId && kind === "climb") {
        if (held)
          throw Error(
            `${actor.name} needs both hands to climb. Add Put down first.`,
          );
        climbs.push({
          actorId: actor.id,
          targetId: clip.targetId,
          start,
          end: index === actor.clips.length - 1 ? Infinity : end,
        });
      }
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
  const uses = [
    ...climbs,
    ...sessions.map((s) => ({
      actorId: s.actorId,
      targetId: s.targetId,
      start: s.acquire.start,
      end: s.end,
    })),
  ];
  for (const climb of climbs)
    for (const use of uses) {
      if (
        climb !== use &&
        climb.targetId === use.targetId &&
        climb.start < use.end &&
        use.start < climb.end
      )
        throw Error(
          "Use this ladder with one character at a time, and leave it in place while climbing.",
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
