import { z } from "zod";
import {
  type Scene,
  type DialogueLine,
  type Motion,
  sceneSchema,
  applyCommands,
  validateScene,
  allMotions,
  allAssets,
} from "./scene";
import { interactionSessions } from "./interactions";

export const performanceActionSchema = z.object({
  motionId: z.string().min(1),
  targetId: z.string().optional(),
  duration: z.number().min(0.2).max(60).optional(),
});
export type PerformanceAction = z.infer<typeof performanceActionSchema>;
export const speechSchema = z.object({
  dialogue: z.string().trim().min(1).max(1800),
  action: z.enum(["idle", "wave", "talk", "bow", "sip"]).optional(),
  performance: z.array(performanceActionSchema).min(1).max(4).optional(),
});
export type Speech = z.infer<typeof speechSchema>;
export const conversationEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("thinking"),
    characterId: z.string(),
    name: z.string(),
    turn: z.number().int().positive(),
    total: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("turn"),
    scene: sceneSchema,
    completed: z.number().int().positive(),
    total: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("complete"),
    completed: z.number().int().min(0),
    total: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
    completed: z.number().int().min(0),
    cancelled: z.boolean(),
  }),
]);
export type ConversationEvent = z.infer<typeof conversationEventSchema>;
const trackEnd = (clips: Scene["entities"][number]["clips"]) =>
  clips.reduce((sum, clip) => sum + clip.duration, 0);

export function appendSpeech(
  scene: Scene,
  characterId: string,
  input: Speech,
  options: { deferInteractionTiming?: boolean } = {},
): Scene {
  const speech = speechSchema.parse(input);
  const actor = scene.entities.find((e) => e.id === characterId);
  if (
    !actor ||
    !actor.visible ||
    allAssets(scene).find((a) => a.id === actor.assetId)?.category !==
      "characters"
  )
    throw Error("Choose a visible character to speak this line.");
  if (scene.transcript.length >= 300)
    throw Error(
      "This scene has reached its dialogue limit. Start a new scene to continue.",
    );
  const end = Math.max(0, ...scene.entities.map((e) => trackEnd(e.clips)));
  const gap = end - trackEnd(actor.clips);
  const waits = gap > 0.000001 ? Math.ceil(gap / 60) : 0;
  const length = Math.min(
    30,
    Math.max(3, speech.dialogue.split(/\s+/).length / 2.5 + 1),
  );
  const held = (
    speech.performance ? [] : interactionSessions(scene, allMotions(scene))
  ).filter((session) => session.end === Infinity);
  const cup = scene.entities.find(
    (e) =>
      e.visible &&
      e.assetId === "cup" &&
      !held.some(
        (session) =>
          (session.targetId === e.id && session.actorId !== actor.id) ||
          (session.actorId === actor.id && session.targetId !== e.id),
      ),
  );
  const performance = speech.performance || [
    {
      motionId:
        speech.action === "sip" && !cup ? "talk" : speech.action || "talk",
      duration: length,
      ...(speech.action === "sip" && cup ? { targetId: cup.id } : {}),
    },
  ];
  const actions = performance.map((action) => {
    const motion = allMotions(scene).find((m) => m.id === action.motionId);
    if (!motion) throw Error("Choose an action from this scene’s library.");
    const targeted = ["pick", "sip", "place", "climb", "sit"].includes(
      motion.role ?? "",
    );
    const target = scene.entities.find((e) => e.id === action.targetId);
    if (
      targeted &&
      (!target ||
        !target.visible ||
        allAssets(scene).find((a) => a.id === target.assetId)?.category !==
          "props")
    )
      throw Error(`Choose a visible prop for ${motion.name}.`);
    if (!targeted && action.targetId)
      throw Error(`${motion.name} does not take a prop target.`);
    return { ...action, duration: action.duration ?? motion.duration };
  });
  // Keep selected action timing. Add a speaking hold if the words need more time.
  const remaining =
    length - actions.reduce((sum, action) => sum + action.duration, 0);
  if (remaining > 0.000001)
    actions.push({ motionId: "talk", duration: Math.max(0.2, remaining) });
  if (actor.clips.length + waits + actions.length > 100)
    throw Error(
      `${actor.name}’s sequence is full. Shorten it before adding this turn.`,
    );
  const commands: Parameters<typeof applyCommands>[1] = [
    ...Array.from({ length: waits }, () => ({
      type: "chain",
      id: actor.id,
      motionId: "idle",
      transition: "smooth",
      duration: Math.max(0.2, gap / waits),
    })),
    ...actions.map((action) => ({
      type: "chain",
      id: actor.id,
      ...action,
      transition: "smooth",
    })),
  ];
  const next = applyCommands(scene, commands, options);
  const updated = next.entities.find((e) => e.id === actor.id)!;
  const clipIds = updated.clips.slice(-actions.length).map((c) => c.id);
  next.transcript.push({
    characterId: actor.id,
    name: actor.name,
    text: speech.dialogue,
    clipId: clipIds[0],
    ...(clipIds.length > 1 ? { clipIds } : {}),
  });
  return validateScene(next, options);
}

export function reviseDialogue(
  scene: Scene,
  index: number,
  text?: string,
  options: { deferInteractionTiming?: boolean } = {},
) {
  if (!Number.isInteger(index) || !scene.transcript[index])
    throw Error("That dialogue line no longer exists.");
  const next = structuredClone(scene);
  if (text === undefined) next.transcript.splice(index, 1);
  else next.transcript[index].text = speechSchema.shape.dialogue.parse(text);
  return validateScene(next, options);
}

export function dialogueTiming(scene: Scene, line: DialogueLine) {
  const ids = line.clipIds || (line.clipId ? [line.clipId] : []);
  if (!ids.length) return null;
  const actor = scene.entities.find((e) => e.id === line.characterId);
  if (!actor) return null;
  let start = 0,
    first = Infinity,
    last = 0;
  for (const clip of actor.clips) {
    if (ids.includes(clip.id)) {
      first = Math.min(first, start);
      last = start + clip.duration;
    }
    start += clip.duration;
  }
  return Number.isFinite(first) ? { start: first, end: last } : null;
}
export function dialogueAt(scene: Scene, time: number) {
  return scene.transcript.filter((line) => {
    const timing = dialogueTiming(scene, line);
    return (
      timing &&
      time >= timing.start &&
      time < timing.end &&
      scene.entities.some((e) => e.id === line.characterId && e.visible)
    );
  });
}
const srtTime = (seconds: number) => {
  const milliseconds = Math.round(seconds * 1000);
  const pad = (n: number, count = 2) => String(n).padStart(count, "0");
  return `${pad(Math.floor(milliseconds / 3600000))}:${pad(Math.floor(milliseconds / 60000) % 60)}:${pad(Math.floor(milliseconds / 1000) % 60)},${pad(milliseconds % 1000, 3)}`;
};
export function dialogueSubtitles(scene: Scene): string {
  return scene.transcript
    .flatMap((line) => {
      const timing = dialogueTiming(scene, line);
      return timing ? [{ line, ...timing }] : [];
    })
    .sort((a, b) => a.start - b.start)
    .map(
      ({ line, start, end }, index) =>
        `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${line.name}: ${line.text.replace(/\r?\n+/g, " ")}\n`,
    )
    .join("\n");
}

/** A speaking route has the line's duration; changing it cannot overlap the next speaker. */
// Action kinds that can be replaced by a drawn route without losing contact
// choreography.
const routableKinds = ["talk", "idle", "wave", "bow", "walk", "run"];
const routableMotion = (motion: Motion | undefined) =>
  !!motion &&
  (routableKinds.includes(motion.role ?? "") ||
    (motion.kind === "imported" && !!motion.path));
const lineClipIds = (line: DialogueLine) =>
  line.clipIds || (line.clipId ? [line.clipId] : []);
/** The first action of a line that a drawn path can replace, if any. */
export function pathableClip(scene: Scene, line: DialogueLine): string | null {
  const actor = scene.entities.find((e) => e.id === line.characterId);
  if (!actor) return null;
  const motions = allMotions(scene);
  for (const id of lineClipIds(line)) {
    const clip = actor.clips.find((c) => c.id === id);
    const motion = clip && motions.find((m) => m.id === clip.motionId);
    if (clip && !clip.targetId && routableMotion(motion)) return clip.id;
  }
  return null;
}
export function setDialoguePath(
  scene: Scene,
  characterId: string,
  clipId: string,
  motion: Motion,
): Scene {
  const actor = scene.entities.find((e) => e.id === characterId);
  const line = scene.transcript.find(
    (l) => l.characterId === characterId && lineClipIds(l).includes(clipId),
  );
  if (!actor || !line || !actor.clips.some((c) => c.id === clipId))
    throw Error("This dialogue line no longer has a timed action.");
  // A line may span several actions: route the requested one when it can
  // travel, otherwise the line's first action that can.
  const requested = actor.clips.find((c) => c.id === clipId)!;
  const requestedMotion = allMotions(scene).find(
    (m) => m.id === requested.motionId,
  );
  const routed =
    !requested.targetId && routableMotion(requestedMotion)
      ? clipId
      : pathableClip(scene, line);
  if (!routed)
    throw Error(
      "Keep this interaction in place. Add a separate spoken line for walking.",
    );
  const clip = actor.clips.find((c) => c.id === routed)!;
  const old = allMotions(scene).find((m) => m.id === clip.motionId)!;
  if (!motion.path || !["walk", "run", "imported"].includes(motion.kind))
    throw Error("Draw a locomotion path for this line.");
  const reusable =
    scene.customMotions.some((m) => m.id === old.id) &&
    scene.entities.flatMap((e) => e.clips).filter((c) => c.motionId === old.id)
      .length === 1;
  const route = {
    ...motion,
    id: reusable ? old.id : crypto.randomUUID(),
    duration: clip.duration,
  };
  return applyCommands(scene, [
    { type: reusable ? "updateMotion" : "createMotion", motion: route },
    {
      type: "update",
      id: characterId,
      changes: {
        clips: actor.clips.map((c) =>
          c.id === routed
            ? { ...c, motionId: route.id, navigation: undefined }
            : c,
        ),
      },
    },
  ]);
}
