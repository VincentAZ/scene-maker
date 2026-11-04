import { describe, it, expect, vi } from "vitest";
import {
  starterScene,
  applyCommands,
  assetSchema,
  type Scene,
} from "../shared/scene";
import {
  validatePlan,
  type AssistantReply,
  type AssistantPlan,
} from "../shared/studio";
import {
  runStudioPlan,
  StudioPlanError,
  type StudioPorts,
} from "../src/studioRunner";
import { ProjectSaveQueue } from "../src/projectSave";
import { characterDraft } from "../shared/characterDesign";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function studio(initial = starterScene()) {
  let current = initial;
  const stored = new Map<string, Scene>();
  const events: string[] = [];
  const ports: StudioPorts = {
    getScene: () => current,
    save: async () => {
      current = { ...current, revision: current.revision + 1 };
      stored.set(current.id, structuredClone(current));
      events.push("saved:" + current.name);
    },
    load: (scene) => {
      current = scene;
      events.push("loaded:" + scene.name);
    },
    read: async (id) => structuredClone(stored.get(id)!),
    edit: (commands) => {
      current = applyCommands(current, commands);
      events.push("edited");
    },
    perform: async (step) => {
      events.push(step.type + ":" + current.name);
    },
  };
  return { ports, stored, events };
}
function reply(
  plan: AssistantPlan,
  scene: Scene,
  read = (_id: string): Scene => {
    throw Error("missing");
  },
): AssistantReply {
  const checked = validatePlan(plan, scene, read);
  return { ...checked.plan, reads: checked.reads, mode: "live" };
}
describe("ordered assistant workflows", () => {
  it("waits for asynchronous navigation edits before saving or executing the next step", async () => {
    const s = studio(),
      ready = deferred<void>(),
      edit = s.ports.edit;
    s.ports.edit = async (commands) => {
      s.events.push("preparing navigation");
      await ready.promise;
      await edit(commands);
    };
    const initial = s.ports.getScene();
    const plan = reply(
      {
        response: "Ready",
        steps: [
          {
            type: "edit",
            commands: [
              { type: "chain", id: initial.entities[0].id, motionId: "walk" },
            ],
          },
          { type: "save" },
          { type: "export", format: "package" },
        ],
      },
      initial,
    );
    const running = runStudioPlan(plan, s.ports);
    await Promise.resolve();
    expect(s.events).toEqual(["preparing navigation"]);
    ready.resolve();
    await running;
    expect(s.events).toEqual([
      "preparing navigation",
      "edited",
      `saved:${initial.name}`,
      `export:${initial.name}`,
    ]);
  });

  it("does not execute later actions when asynchronous navigation cannot resolve the destination", async () => {
    const s = studio(),
      initial = s.ports.getScene();
    s.ports.edit = async () => {
      throw Error("The destination is blocked.");
    };
    const plan = reply(
      {
        response: "Ready",
        steps: [
          {
            type: "edit",
            commands: [
              { type: "chain", id: initial.entities[0].id, motionId: "walk" },
            ],
          },
          { type: "save" },
          { type: "export", format: "package" },
        ],
      },
      initial,
    );
    await expect(runStudioPlan(plan, s.ports)).rejects.toThrow(
      "destination is blocked",
    );
    expect(s.events).toEqual([]);
  });

  it("saves the previous project, directs an imported character in a copy, then exports it", async () => {
    const original = starterScene();
    original.customAssets.push(
      assetSchema.parse({
        id: "imported-dancer",
        name: "Dancer",
        category: "characters",
        style: "Imported",
        color: "#6b6b6b",
        url: "/uploads/dancer.glb",
      }),
    );
    const s = studio(original);
    const initial = s.ports.getScene();
    const plan = reply(
      {
        response: "Ready",
        steps: [
          { type: "copyProject", name: "Moonwalk" },
          {
            type: "edit",
            commands: [
              { type: "add", id: "dancer", assetId: "imported-dancer" },
              { type: "chain", id: "dancer", motionId: "walk" },
            ],
          },
          { type: "save" },
          { type: "export", format: "package" },
        ],
      },
      initial,
    );
    await runStudioPlan(plan, s.ports);
    expect(s.events).toEqual([
      "saved:" + initial.name,
      "loaded:Moonwalk",
      "edited",
      "saved:Moonwalk",
      "export:Moonwalk",
    ]);
    expect(s.stored.get(initial.id)?.entities).toHaveLength(5);
    const dancer = s.ports.getScene().entities.find((e) => e.id === "dancer");
    expect(dancer?.clips[0].motionId).toBe("walk");
    expect(s.ports.getScene().id).not.toBe(initial.id);
  });
  it("starts every new project on a blank studio stage, even from the retired café template", async () => {
    for (const template of ["empty", "cafe"] as const) {
      const s = studio();
      await runStudioPlan(
        reply(
          {
            response: "Ready",
            steps: [{ type: "newProject", name: "Fresh", template }],
          },
          s.ports.getScene(),
        ),
        s.ports,
      );
      expect(s.ports.getScene()).toMatchObject({
        name: "Fresh",
        environment: "studio",
        entities: [],
        customAssets: [],
        mission: "",
      });
    }
  });
  it("rejects retired built-ins, shape-built assets and code-built sets before any effects", () => {
    const scene = starterScene();
    for (const command of [
      { type: "add", id: "dancer", assetId: "mila" },
      { type: "add", assetId: "furniture-chair" },
      {
        type: "createAsset",
        asset: characterDraft("quaternius-casual-female", "Cleo"),
      },
      { type: "scene", changes: { environment: "park" } },
    ])
      expect(
        () =>
          reply(
            {
              response: "Ready",
              steps: [
                { type: "newProject", name: "Moonwalk", template: "empty" },
                { type: "edit", commands: [command] },
                { type: "save" },
              ],
            } as AssistantPlan,
            scene,
          ),
        JSON.stringify(command),
      ).toThrow("retired");
  });
  it("does not switch or export when the old project cannot be saved", async () => {
    const s = studio();
    const initial = s.ports.getScene();
    s.ports.save = async () => {
      throw Error("Revision conflict");
    };
    const plan = reply(
      {
        response: "Done",
        steps: [
          { type: "copyProject", name: "Copy" },
          { type: "export", format: "project" },
        ],
      },
      initial,
    );
    await expect(runStudioPlan(plan, s.ports)).rejects.toMatchObject({
      message: "Revision conflict",
      completed: [],
    });
    expect(s.ports.getScene()).toBe(initial);
    expect(s.events).toEqual([]);
  });
  it("rejects a project changed after planning, preserving the active project", async () => {
    const s = studio(),
      target = { ...starterScene(), revision: 4 };
    const initial = s.ports.getScene();
    const plan = reply(
      { response: "Opened", steps: [{ type: "openProject", id: target.id }] },
      initial,
      () => target,
    );
    s.stored.set(target.id, { ...target, revision: 5 });
    await expect(runStudioPlan(plan, s.ports)).rejects.toThrow("changed while");
    expect(s.ports.getScene().id).toBe(initial.id);
  });
  it("can reopen the active project and return to a project saved earlier in the plan", async () => {
    const s = studio(),
      initial = s.ports.getScene();
    const plan = reply(
      {
        response: "Done",
        steps: [
          { type: "openProject", id: initial.id },
          {
            type: "edit",
            commands: [
              { type: "scene", changes: { name: "Revised original" } },
            ],
          },
          { type: "copyProject", name: "Copy" },
          { type: "openProject", id: initial.id },
        ],
      },
      initial,
    );
    await runStudioPlan(plan, s.ports);
    expect(s.ports.getScene().id).toBe(initial.id);
    expect(s.ports.getScene().name).toBe("Revised original");
    expect(s.stored.size).toBe(2);
  });
  it("reports completed work and stops remaining steps after a failed operation", async () => {
    const s = studio();
    s.ports.perform = async () => {
      throw Error("Blender unavailable");
    };
    const plan = reply(
      {
        response: "Exported",
        steps: [
          {
            type: "edit",
            commands: [{ type: "scene", changes: { lighting: "moonlight" } }],
          },
          { type: "export", format: "blender" },
          { type: "newProject", name: "Next", template: "empty" },
        ],
      },
      s.ports.getScene(),
    );
    const error = await runStudioPlan(plan, s.ports).catch(
      (e) => e as StudioPlanError,
    );
    expect(error).toMatchObject({
      message: "Blender unavailable",
      completed: ["Updated the scene"],
    });
    expect(s.ports.getScene().lighting).toBe("moonlight");
    expect(s.events).toEqual(["edited"]);
  });
  it("validates later steps before any effects and isolates undo from subsequent edits", () => {
    const scene = starterScene();
    expect(() =>
      reply(
        {
          response: "Done",
          steps: [
            { type: "newProject", name: "New", template: "empty" },
            { type: "select", id: scene.entities[0].id },
          ],
        },
        scene,
      ),
    ).toThrow("no longer exists");
    expect(() =>
      reply(
        {
          response: "Done",
          steps: [{ type: "history", direction: "undo" }, { type: "save" }],
        },
        scene,
      ),
    ).toThrow("separate request");
  });
});
describe("save completion before project switching", () => {
  it("coalesces concurrent callers and persists edits made during an in-flight save", async () => {
    let current = starterScene();
    const first = deferred<Scene>();
    const write = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (s: Scene) => ({
        ...s,
        revision: s.revision + 1,
      }));
    const queue = new ProjectSaveQueue(
      () => current,
      (s) => {
        current = s;
      },
      write,
    );
    const pending = queue.flush();
    expect(queue.flush()).toBe(pending);
    const snapshot = structuredClone(current);
    current = { ...current, name: "Edited while saving" };
    first.resolve({ ...snapshot, revision: 1 });
    await pending;
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toMatchObject({
      name: "Edited while saving",
      revision: 1,
    });
    expect(current).toMatchObject({ name: "Edited while saving", revision: 2 });
  });
  it("retains the local draft after failure and allows a later retry", async () => {
    let current = starterScene();
    const original = structuredClone(current);
    const write = vi
      .fn()
      .mockRejectedValueOnce(Error("Offline"))
      .mockImplementation(async (s: Scene) => ({
        ...s,
        revision: s.revision + 1,
      }));
    const queue = new ProjectSaveQueue(
      () => current,
      (s) => {
        current = s;
      },
      write,
    );
    await expect(queue.flush()).rejects.toThrow("Offline");
    expect(current).toEqual(original);
    await queue.flush();
    expect(current.revision).toBe(1);
  });
  it("does not apply a response for another project or a non-advancing revision", async () => {
    let current = starterScene();
    const accept = vi.fn();
    const queue = new ProjectSaveQueue(
      () => current,
      accept,
      async () => current,
    );
    await expect(queue.flush()).rejects.toThrow("invalid save acknowledgement");
    expect(accept).not.toHaveBeenCalled();
  });
});
