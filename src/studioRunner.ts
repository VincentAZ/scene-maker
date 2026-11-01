import { type Scene, validateScene } from "../shared/scene";
import {
  type AssistantReply,
  type StudioStep,
  newProject,
  copyProject,
} from "../shared/studio";
export type StudioPorts = {
  getScene: () => Scene;
  save: () => Promise<void>;
  load: (scene: Scene) => void;
  read: (id: string) => Promise<Scene>;
  edit: (
    commands: Extract<StudioStep, { type: "edit" }>["commands"],
  ) => void | Promise<void>;
  perform: (
    step: Exclude<
      StudioStep,
      { type: "edit" | "newProject" | "copyProject" | "openProject" | "save" }
    >,
  ) => Promise<void>;
  checkpoint?: (step: StudioStep) => void;
};
export class StudioPlanError extends Error {
  constructor(
    message: string,
    readonly completed: string[],
  ) {
    super(message);
  }
}
export function describeStep(step: StudioStep): string {
  switch (step.type) {
    case "dialogue":
      return "Added dialogue and actions";
    case "reviseDialogue":
      return "Revised the dialogue";
    case "removeDialogue":
      return "Removed the dialogue; actions kept";
    case "edit":
      return "Updated the scene";
    case "newProject":
      return `Created “${step.name}”`;
    case "copyProject":
      return `Copied to “${step.name}”`;
    case "openProject":
      return "Opened the project";
    case "save":
      return "Saved the project";
    case "conversation":
      return "Directed the cast";
    case "export":
      if (step.format === "unreal") return "Exported Unreal project";
      return `Exported ${step.format}`;
    case "history":
      return step.direction === "undo"
        ? "Undid the last edit"
        : "Redid the last edit";
    case "camera":
      return "Adjusted the camera";
    case "select":
      return "Selected the scene object";
    case "playback":
      return "Updated playback";
    case "show":
      return "Opened the studio tool";
    case "library":
      return "Updated the library";
    case "previewAction":
      return "Opened the action preview";
    case "pathEditor":
      return "Opened the path editor";
    case "walkTo":
      return "Added a planned route";
  }
}
export async function runStudioPlan(reply: AssistantReply, ports: StudioPorts) {
  const completed: string[] = [];
  const savedRevisions = new Map<string, number>();
  try {
    for (const step of reply.steps) {
      if (
        step.type === "newProject" ||
        step.type === "copyProject" ||
        step.type === "openProject"
      ) {
        await ports.save();
        const saved = ports.getScene();
        savedRevisions.set(saved.id, saved.revision);
        if (step.type === "openProject") {
          if (step.id === saved.id) {
            completed.push(describeStep(step));
            ports.checkpoint?.(step);
            continue;
          }
          const project = validateScene(await ports.read(step.id));
          const expected = savedRevisions.get(step.id) ?? reply.reads[step.id];
          if (expected === undefined || project.revision !== expected)
            throw Error(
              "That saved project changed while the assistant was planning. Please ask again.",
            );
          ports.load(project);
        } else
          ports.load(
            step.type === "newProject"
              ? newProject(step.name, step.template)
              : copyProject(ports.getScene(), step.name),
          );
      } else if (step.type === "edit") await ports.edit(step.commands);
      else if (step.type === "save") await ports.save();
      else await ports.perform(step);
      completed.push(describeStep(step));
      ports.checkpoint?.(step);
    }
    return completed;
  } catch (error) {
    throw new StudioPlanError((error as Error).message, completed);
  }
}
