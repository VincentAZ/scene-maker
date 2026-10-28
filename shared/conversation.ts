import { z } from "zod";
import {
  type Scene,
  type DialogueLine,
  sceneSchema,
  applyCommands,
  validateScene,
  allMotions,
} from "./scene";
import { interactionSessions } from "./interactions";

export const speechSchema = z.object({
  dialogue: z.string().trim().min(1).max(1800),
  action: z.enum(["idle", "wave", "talk", "bow", "sip"]),
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
): Scene {
  const speech = speechSchema.parse(input);
  const actor = scene.entities.find((e) => e.id === characterId);
  if (!actor) throw Error("The speaking character is no longer in this scene.");
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
  const held = interactionSessions(scene, allMotions(scene)).filter(
    (session) => session.end === Infinity,
  );
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
  const commands: Parameters<typeof applyCommands>[1] = [
    ...Array.from({ length: waits }, () => ({
      type: "chain",
      id: actor.id,
      motionId: "idle",
      duration: Math.max(0.2, gap / waits),
    })),
    {
      type: "chain",
      id: actor.id,
      motionId: speech.action === "sip" && !cup ? "talk" : speech.action,
      duration: length,
      ...(speech.action === "sip" && cup ? { targetId: cup.id } : {}),
    },
  ];
  const next = applyCommands(scene, commands);
  const updated = next.entities.find((e) => e.id === actor.id)!;
  next.transcript.push({
    characterId: actor.id,
    name: actor.name,
    text: speech.dialogue,
    clipId: updated.clips.at(-1)!.id,
  });
  return validateScene(next);
}

export function dialogueTiming(scene: Scene, line: DialogueLine) {
  if (!line.clipId) return null;
  const actor = scene.entities.find((e) => e.id === line.characterId);
  if (!actor) return null;
  let start = 0;
  for (const clip of actor.clips) {
    if (clip.id === line.clipId) return { start, end: start + clip.duration };
    start += clip.duration;
  }
  return null;
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
