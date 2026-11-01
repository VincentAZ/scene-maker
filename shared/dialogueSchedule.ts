import type { DialogueLine, Scene } from "./scene";
import { dialogueTiming } from "./conversation";

type Boundary = { actorId: string; clipId: string; endClipId?: string };
type Event = Boundary & { end: number; line?: DialogueLine };
const ids = (line: DialogueLine) =>
  line.clipIds ?? (line.clipId ? [line.clipId] : []);
const key = (actorId: string, clipId: string) =>
  JSON.stringify([actorId, clipId]);
const epsilon = 1e-6;

/** Retain the established dialogue dependencies when navigation changes time.
 * A line follows the latest preceding performance(s), keeping its authored gap.
 * Only adjacent, unspoken idle padding can shrink/grow; captured takes, speech,
 * interactions, and explicit playback rates are never stretched. Works on saved
 * scenes too: dependencies come from linked performances, not provider names or
 * newly introduced metadata. The caller validates and checks the final geometry.
 */
export function retimeDialogueAfterChange(
  before: Scene,
  changed: Scene,
  endOverrides: Boundary[] = [],
): Scene {
  if (!before.transcript.length) return changed;
  const spoken = new Set(
    before.transcript.flatMap((line) =>
      ids(line).map((id) => key(line.characterId, id)),
    ),
  );
  const events: Event[] = [];
  for (const line of before.transcript) {
    const timing = dialogueTiming(before, line);
    if (timing && ids(line)[0])
      events.push({
        actorId: line.characterId,
        clipId: ids(line)[0],
        end: timing.end,
        line,
      });
  }
  // Unspoken travel/actions can also be the barrier before a speaker begins.
  for (const actor of before.entities) {
    let time = 0;
    const tails = new Set(
      actor.clips.flatMap((c) =>
        c.navigation?.arrival ? [c.navigation.arrival.clipId] : [],
      ),
    );
    for (const clip of actor.clips) {
      time += clip.duration;
      if (
        spoken.has(key(actor.id, clip.id)) ||
        tails.has(clip.id) ||
        clip.motionId === "idle"
      )
        continue;
      const tail =
        clip.navigation?.arrival &&
        actor.clips.find((c) => c.id === clip.navigation!.arrival!.clipId);
      events.push({
        actorId: actor.id,
        clipId: clip.id,
        end: time + (tail ? tail.duration : 0),
      });
    }
  }
  const lines = before.transcript
    .flatMap((line) => {
      const timing = dialogueTiming(before, line);
      return timing ? [{ line, ...timing }] : [];
    })
    .sort((a, b) => a.start - b.start);
  let result = changed;
  const endAt = (event: Event) => {
    const actor = result.entities.find((e) => e.id === event.actorId);
    if (!actor) return undefined;
    if (event.line) {
      const line = result.transcript.find(
        (l) => l.characterId === event.actorId && ids(l).includes(event.clipId),
      );
      return line ? dialogueTiming(result, line)?.end : undefined;
    }
    const clip = actor.clips.find((c) => c.id === event.clipId);
    const endId =
      endOverrides.find(
        (o) => o.actorId === event.actorId && o.clipId === event.clipId,
      )?.endClipId ??
      clip?.navigation?.arrival?.clipId ??
      clip?.id;
    let end = 0;
    for (const c of actor.clips) {
      end += c.duration;
      if (c.id === endId) return end;
    }
    return undefined;
  };
  for (const { line: oldLine, start } of lines) {
    const line = result.transcript.find(
      (l) =>
        l.characterId === oldLine.characterId &&
        ids(l).includes(ids(oldLine)[0]),
    );
    if (!line) continue;
    const predecessors = events.filter(
      (e) => e.line !== oldLine && e.end <= start + epsilon,
    );
    const latest = Math.max(-Infinity, ...predecessors.map((e) => e.end));
    const dependencies = predecessors.filter(
      (e) => Math.abs(e.end - latest) <= epsilon,
    );
    if (!dependencies.length) continue;
    const resolved = predecessors.map((event) => ({
      event,
      end: endAt(event),
    }));
    if (resolved.some(({ end }) => end === undefined))
      throw Error("A preceding dialogue action disappeared while replanning.");
    // An earlier parallel performance may now finish after the old latest
    // barrier. Preserve existing overlaps, but never create a new one with a
    // performance that originally finished before this line.
    const desired = Math.max(
      ...resolved.map(({ end }) => end!),
      Math.max(
        ...resolved
          .filter(({ event }) => dependencies.includes(event))
          .map(({ end }) => end!),
      ) + Math.max(0, start - latest),
    );
    const actor = result.entities.find((e) => e.id === line.characterId)!;
    const first = actor.clips.findIndex((c) => ids(line).includes(c.id));
    if (first < 0) continue;
    const linked = new Set(
      result.transcript.filter((l) => l.characterId === actor.id).flatMap(ids),
    );
    let waitStart = first;
    while (waitStart > 0) {
      const c = actor.clips[waitStart - 1];
      if (
        c.motionId !== "idle" ||
        linked.has(c.id) ||
        c.targetId ||
        c.navigation
      )
        break;
      waitStart--;
    }
    const base = actor.clips
      .slice(0, waitStart)
      .reduce((sum, c) => sum + c.duration, 0);
    const padding = actor.clips.slice(waitStart, first);
    const current = padding.reduce((sum, c) => sum + c.duration, 0);
    const needed = Math.max(0, desired - base);
    if (Math.abs(needed - current) <= epsilon) continue;
    const count = needed > epsilon ? Math.ceil(needed / 60) : 0;
    if (actor.clips.length - padding.length + count > 100)
      throw Error(
        `${actor.name}’s sequence has no room to wait for the replanned dialogue.`,
      );
    const used = new Set(
      result.entities.flatMap((e) => e.clips.map((c) => c.id)),
    );
    const waits = Array.from({ length: count }, (_, i) => {
      let id = padding[i]?.id ?? `dialogue-wait-${ids(line)[0]}-${i + 1}`;
      if (!padding[i]) {
        const baseId = id;
        let suffix = 2;
        while (used.has(id)) id = `${baseId}-${suffix++}`;
      }
      used.add(id);
      return {
        ...padding[i],
        id,
        motionId: "idle",
        duration: Math.max(0.2, needed / count),
        transition: padding[i]?.transition ?? ("smooth" as const),
      };
    });
    if (result === changed) result = structuredClone(changed);
    result.entities
      .find((e) => e.id === actor.id)!
      .clips.splice(waitStart, padding.length, ...waits);
  }
  return result;
}
