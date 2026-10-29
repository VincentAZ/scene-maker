import { z } from "zod";
import {
  commandSchema,
  applyCommands,
  starterScene,
  validateScene,
  uid,
  duration,
  type Scene,
  allAssets,
  allMotions,
} from "./scene";
export const studioStepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("edit"),
    commands: z.array(commandSchema).min(1).max(100),
  }),
  z.object({
    type: z.literal("newProject"),
    name: z.string().min(1).max(100),
    template: z.enum(["empty", "cafe"]),
  }),
  z.object({
    type: z.literal("copyProject"),
    name: z.string().min(1).max(100),
  }),
  z.object({
    type: z.literal("openProject"),
    id: z.string().regex(/^[a-zA-Z0-9-]+$/),
  }),
  z.object({ type: z.literal("save") }),
  z.object({ type: z.literal("select"), id: z.string().nullable() }),
  z.object({
    type: z.literal("pathEditor"),
    actorId: z.string(),
    clipId: z.string().optional(),
  }),
  z.object({
    type: z.literal("playback"),
    mode: z.enum(["play", "pause", "rewind", "seek"]),
    time: z.number().min(0).max(6000).optional(),
  }),
  z.object({
    type: z.literal("camera"),
    view: z.enum(["default", "front", "side", "top"]),
    focusId: z.string().optional(),
  }),
  z.object({
    type: z.literal("conversation"),
    rounds: z.number().int().min(1).max(5),
  }),
  z.object({
    type: z.literal("export"),
    format: z.enum([
      "package",
      "project",
      "blender",
      "unreal",
      "dialogue",
      "subtitles",
      "image",
    ]),
  }),
  z.object({
    type: z.literal("show"),
    panel: z.enum([
      "projects",
      "settings",
      "importProject",
      "importAsset",
      "createCharacter",
      "details",
      "assistant",
    ]),
    category: z.enum(["characters", "props"]).optional(),
  }),
  z.object({
    type: z.literal("library"),
    category: z.enum(["characters", "props", "environments", "motions"]),
    search: z.string().max(100),
  }),
  z.object({ type: z.literal("history"), direction: z.enum(["undo", "redo"]) }),
]);
export const assistantPlanSchema = z.object({
  response: z.string().max(8000),
  steps: z.array(studioStepSchema).max(30),
});
export type StudioStep = z.infer<typeof studioStepSchema>;
export type AssistantPlan = z.infer<typeof assistantPlanSchema>;
export type ProjectSummary = {
  id: string;
  name: string;
  revision: number;
  environment: string;
  updated: number;
};
export type AssistantReply = AssistantPlan & {
  mode: "live" | "offline";
  reads: Record<string, number>;
};
export const conversationHistorySchema = z
  .array(
    z.object({
      role: z.enum(["user", "assistant"]),
      text: z.string().max(8000),
    }),
  )
  .max(20);
export function newProject(name: string, template: "empty" | "cafe"): Scene {
  const s = starterScene();
  s.name = name;
  if (template === "empty") {
    s.entities = [];
    s.environment = "studio";
    s.mission = "";
  }
  return s;
}
export function copyProject(scene: Scene, name: string): Scene {
  return validateScene({
    ...structuredClone(scene),
    id: uid(),
    revision: 0,
    name,
  });
}
// Preview all structural changes before executing any step. Project reads carry
// revisions so an edit planned against another saved project cannot silently drift.
export function validatePlan(
  input: unknown,
  scene: Scene,
  readProject: (id: string) => Scene,
): { plan: AssistantPlan; reads: Record<string, number> } {
  const plan = assistantPlanSchema.parse(input),
    reads: Record<string, number> = {};
  let current = structuredClone(scene);
  const visited = new Map<string, Scene>();
  for (const step of plan.steps) {
    if (["newProject", "copyProject", "openProject"].includes(step.type))
      visited.set(current.id, structuredClone(current));
    if (step.type === "edit") current = applyCommands(current, step.commands);
    if (step.type === "pathEditor") {
      const actor = current.entities.find((e) => e.id === step.actorId);
      if (
        !actor ||
        allAssets(current).find((a) => a.id === actor.assetId)?.category !==
          "characters" ||
        (step.clipId &&
          !actor.clips.some(
            (c) =>
              c.id === step.clipId &&
              allMotions(current).find((m) => m.id === c.motionId)?.path,
          ))
      )
        throw Error("The path's character or action no longer exists.");
    }
    if (step.type === "newProject")
      current = newProject(step.name, step.template);
    if (step.type === "copyProject") current = copyProject(current, step.name);
    if (step.type === "openProject") {
      const known = visited.get(step.id);
      current = validateScene(known || readProject(step.id));
      if (!known) reads[step.id] = current.revision;
    }
    if (
      (step.type === "select" && step.id) ||
      (step.type === "camera" && step.focusId)
    ) {
      const id = step.type === "select" ? step.id : step.focusId;
      if (!current.entities.some((e) => e.id === id))
        throw Error("The selected object no longer exists.");
    }
    if (
      step.type === "playback" &&
      step.mode === "seek" &&
      (step.time === undefined || step.time > duration(current))
    )
      throw Error("Choose a time within this scene’s sequence.");
  }
  // Undo changes the state used to validate later edits. Keep history operations
  // isolated, rather than claiming that subsequent edits were validated correctly.
  if (plan.steps.some((s) => s.type === "history") && plan.steps.length !== 1)
    throw Error("Undo or redo must be a separate request.");
  if (plan.steps.slice(0, -1).some((s) => s.type === "pathEditor"))
    throw Error(
      "Open the path editor as the final step so the creator can finish drawing.",
    );
  return { plan, reads };
}
