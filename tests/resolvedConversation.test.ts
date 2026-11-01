import { expect, it, vi } from "vitest";
import { appendSpeech, dialogueTiming } from "../shared/conversation";
import { applyCommands, starterScene, type Scene } from "../shared/scene";
import {
  runResolvedConversation,
  type ResolvedConversationPorts,
} from "../src/resolvedConversation";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function stream(scene: Scene, total = 1) {
  return new Response(
    [
      { type: "turn", scene, completed: 1, total },
      { type: "complete", completed: 1, total },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
    { headers: { "Content-Type": "application/x-ndjson" } },
  );
}
function fixture() {
  let current = starterScene();
  for (const actor of current.entities) actor.clips = [];
  const requested: Scene[] = [],
    controller = new AbortController();
  const ports: ResolvedConversationPorts = {
    getScene: () => current,
    request: async (scene) => {
      requested.push(structuredClone(scene));
      const actor = scene.entities[(requested.length - 1) % 2];
      return stream(
        appendSpeech(scene, actor.id, {
          dialogue: "A short line.",
          performance: [
            { motionId: requested.length === 1 ? "walk" : "talk", duration: 4 },
          ],
        }),
      );
    },
    accept: (next) => {
      current = next;
    },
    prepare: async () => {},
    save: async () => {
      current = { ...current, revision: current.revision + 1 };
    },
    thinking: () => {},
    ready: () => {},
  };
  return {
    ports,
    requested,
    controller,
    setScene: (next: Scene) => {
      current = next;
    },
  };
}

it("waits for resolved movement and persistence before asking another speaker", async () => {
  const f = fixture(),
    preparing = deferred(),
    release = deferred(),
    saving = deferred(),
    saved = deferred();
  f.ports.prepare = async (next) => {
    if (next.transcript.length !== 1) return;
    expect(next.entities[0].clips[0].navigation).toBeDefined();
    preparing.resolve();
    await release.promise;
    const resolved = structuredClone(next);
    resolved.entities[0].clips[0].duration = 6;
    f.setScene(resolved);
  };
  f.ports.save = async () => {
    if (f.ports.getScene().transcript.length === 1) {
      saving.resolve();
      await saved.promise;
    }
  };
  const run = runResolvedConversation(2, f.ports, f.controller.signal);
  await preparing.promise;
  expect(f.requested).toHaveLength(1);
  release.resolve();
  await saving.promise;
  expect(f.requested).toHaveLength(1);
  saved.resolve();
  await run;
  expect(f.requested).toHaveLength(2);
  expect(f.requested[1].entities[0].clips[0].duration).toBe(6);
  const final = f.ports.getScene();
  expect(dialogueTiming(final, final.transcript[1])!.start).toBe(6);
});

it("keeps the accepted turn but requests no later speaker when navigation is blocked", async () => {
  const f = fixture();
  f.ports.prepare = async (next) => {
    if (next.transcript.length) throw Error("Blocked route");
  };
  await expect(
    runResolvedConversation(2, f.ports, f.controller.signal),
  ).rejects.toThrow("Blocked route");
  expect(f.requested).toHaveLength(1);
  expect(f.ports.getScene().transcript).toHaveLength(1);
  expect(f.ports.getScene().entities[0].clips[0].navigation).toBeDefined();
});

it("cancels while navigation is pending without issuing another model request", async () => {
  const f = fixture(),
    preparing = deferred();
  f.ports.prepare = async (next, signal) => {
    if (!next.transcript.length) return;
    preparing.resolve();
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  };
  const run = runResolvedConversation(2, f.ports, f.controller.signal);
  const outcome = run.catch((e) => e);
  await preparing.promise;
  f.controller.abort("Stopped by creator");
  expect(await outcome).toBe("Stopped by creator");
  expect(f.requested).toHaveLength(1);
  expect(f.ports.getScene().transcript).toHaveLength(1);
});

it("does not overwrite edits made while a model is responding", async () => {
  const f = fixture(),
    request = f.ports.request;
  f.ports.request = async (scene, signal) => {
    const response = await request(scene, signal);
    f.setScene({ ...scene, name: "Creator edit" });
    return response;
  };
  await expect(
    runResolvedConversation(2, f.ports, f.controller.signal),
  ).rejects.toThrow("scene changed");
  expect(f.ports.getScene().name).toBe("Creator edit");
  expect(f.ports.getScene().transcript).toEqual([]);
});

it("checks batch capacity and rejects an old multi-turn response", async () => {
  const f = fixture(),
    request = vi.spyOn(f.ports, "request");
  f.setScene({
    ...f.ports.getScene(),
    transcript: Array.from({ length: 299 }, () => ({
      characterId: "old",
      name: "Old",
      text: "Earlier",
    })),
  });
  await expect(
    runResolvedConversation(2, f.ports, f.controller.signal),
  ).rejects.toThrow("dialogue limit");
  expect(request).not.toHaveBeenCalled();
  f.setScene(starterScene());
  f.ports.request = async (scene) =>
    stream(appendSpeech(scene, scene.entities[0].id, { dialogue: "Hello" }), 2);
  await expect(
    runResolvedConversation(2, f.ports, f.controller.signal),
  ).rejects.toThrow("more than the requested turn");
  expect(f.ports.getScene().transcript).toEqual([]);
});

it("passes an actual geometry detour to the next turn and schedules its caption after arrival", async () => {
  const { prepareAutomaticRoutes } = await import("../src/automaticRoutes");
  const { createCharacter, createProp } = await import("../src/world");
  const { characters } = await import("../shared/scene");
  const f = fixture();
  f.setScene(
    applyCommands(starterScene(), [
      { type: "clear" },
      { type: "add", id: "a", assetId: "mila", position: [-3, 0, 0] },
      { type: "update", id: "a", changes: { rotation: Math.PI / 2 } },
      { type: "add", id: "b", assetId: "leo", position: [4, 0, -4] },
      { type: "add", id: "crate", assetId: "crate", position: [0, 0, 0] },
      { type: "scene", changes: { environment: "studio" } },
      {
        type: "createMotion",
        motion: {
          id: "route",
          name: "Across the scene",
          kind: "walk",
          duration: 4,
          distance: 0,
          poses: [],
          path: {
            points: [
              [0, 0, 0],
              [0, 0, 6],
            ],
            smooth: false,
          },
        },
      },
    ]),
  );
  const objects = new Map([
    ["a", createCharacter(characters[0])],
    ["b", createCharacter(characters[1])],
    ["crate", createProp("crate", "#aa8844")],
  ]);
  f.ports.request = async (scene) => {
    f.requested.push(structuredClone(scene));
    return stream(
      appendSpeech(scene, f.requested.length === 1 ? "a" : "b", {
        dialogue: "Walk over here.",
        performance: [
          {
            motionId: f.requested.length === 1 ? "route" : "talk",
            duration: 4,
          },
        ],
      }),
    );
  };
  f.ports.prepare = async (scene) => {
    const result = prepareAutomaticRoutes(scene, objects);
    expect(result.issues).toEqual([]);
    f.setScene(result.scene);
  };
  await runResolvedConversation(2, f.ports, f.controller.signal);
  expect(f.requested[1].entities[0].clips[0].duration).toBeGreaterThan(4);
  expect(
    f.requested[1].customMotions.find((m) => m.id === "route")!.path!.points
      .length,
  ).toBeGreaterThan(2);
  const final = f.ports.getScene(),
    first = dialogueTiming(final, final.transcript[0])!,
    second = dialogueTiming(final, final.transcript[1])!;
  expect(second.start).toBeGreaterThanOrEqual(first.end);
});
