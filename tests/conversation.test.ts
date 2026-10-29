import { afterAll, beforeAll, describe, it, expect } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { MockLanguageModelV4 } from "ai/test";
import {
  conversation,
  ConversationInterrupted,
  type Config,
  type modelFor,
} from "../server/ai";
import { conversationRoute } from "../server/conversationRoute";
import {
  appendSpeech,
  dialogueTiming,
  dialogueAt,
  dialogueSubtitles,
  type ConversationEvent,
} from "../shared/conversation";
import {
  starterScene,
  applyCommands,
  validateScene,
  type Scene,
} from "../shared/scene";
import {
  readConversationStream,
  mergeConversationTurn,
} from "../src/conversationStream";

const config: Config = {
  assistant: "openai",
  providers: { openai: { key: "test", model: "test" } },
  blender: "blender",
};
const generated = (dialogue = "There is always time for one more story.") => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify({ dialogue, action: "talk" }),
    },
  ],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 10, text: 10, reasoning: 0 },
  },
  warnings: [],
});
const fake = () => new MockLanguageModelV4({ doGenerate: generated() });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("dialogue staged in the scene", () => {
  it("uses the speaker's held cup and avoids a sip when their hand holds another prop", () => {
    const s = starterScene(),
      actor = s.entities[0];
    actor.clips = [];
    s.entities[1].clips = [];
    const ownCup = applyCommands(s, [
      { type: "add", assetId: "cup", id: "second-cup" },
      { type: "chain", id: actor.id, motionId: "pick", targetId: "second-cup" },
    ]);
    const sipping = appendSpeech(ownCup, actor.id, {
      dialogue: "A little coffee.",
      action: "sip",
    });
    expect(sipping.entities[0].clips.at(-1)?.targetId).toBe("second-cup");
    const busy = applyCommands(s, [
      {
        type: "chain",
        id: actor.id,
        motionId: "pick",
        targetId: s.entities.find((e) => e.assetId === "plant")!.id,
      },
    ]);
    const talking = appendSpeech(busy, actor.id, {
      dialogue: "My hands are full.",
      action: "sip",
    });
    expect(talking.entities[0].clips.at(-1)?.motionId).toBe("talk");
  });
  it("keeps a speaker from taking a cup another character is holding", () => {
    const s = starterScene(),
      cup = s.entities.find((e) => e.assetId === "cup")!;
    s.entities[1].clips = [];
    const held = applyCommands(s, [
      {
        type: "chain",
        id: s.entities[0].id,
        motionId: "pick",
        targetId: cup.id,
      },
    ]);
    const next = appendSpeech(held, s.entities[1].id, {
      dialogue: "I'll wait until you finish.",
      action: "sip",
    });
    expect(next.entities[1].clips.at(-1)?.motionId).toBe("talk");
    expect(next.entities[1].clips.at(-1)?.targetId).toBeUndefined();
  });
  it("schedules non-overlapping turns after existing actions and previews the correct speaker", () => {
    const original = starterScene();
    const first = appendSpeech(original, original.entities[0].id, {
      dialogue: "Please stay.",
      action: "wave",
    });
    const next = appendSpeech(first, original.entities[1].id, {
      dialogue: "For one more story.",
      action: "talk",
    });
    const a = dialogueTiming(next, next.transcript[0])!,
      b = dialogueTiming(next, next.transcript[1])!;
    expect(a.start).toBe(7);
    expect(b.start).toBeGreaterThanOrEqual(a.end);
    expect(dialogueAt(next, a.start).map((line) => line.name)).toEqual([
      "Mila",
    ]);
    expect(dialogueAt(next, b.start).map((line) => line.name)).toEqual(["Leo"]);
    expect(dialogueAt(next, b.end)).toEqual([]);
    expect(original.transcript).toEqual([]);
    next.entities[1].visible = false;
    expect(dialogueAt(next, b.start)).toEqual([]);
  });
  it("moves dialogue timing with its action and retains text after that action is removed", () => {
    const s = starterScene(),
      id = s.entities[0].id;
    const spoken = appendSpeech(s, id, {
      dialogue: "Hello there.",
      action: "talk",
    });
    const clipId = spoken.transcript[0].clipId!;
    const moved = applyCommands(spoken, [
      { type: "reorderClip", id, clipId, direction: "earlier" },
    ]);
    expect(dialogueTiming(moved, moved.transcript[0])!.start).toBe(6);
    const removed = applyCommands(moved, [{ type: "removeClip", id, clipId }]);
    expect(removed.transcript[0].text).toBe("Hello there.");
    expect(dialogueTiming(removed, removed.transcript[0])).toBeNull();
    expect(() =>
      validateScene({ ...removed, transcript: spoken.transcript }),
    ).toThrow("Missing dialogue action");
  });
  it("exports timed SRT and preserves legacy untimed transcripts", () => {
    const s = starterScene();
    s.transcript.push({
      characterId: s.entities[0].id,
      name: "Mila",
      text: "Older dialogue",
    });
    const next = appendSpeech(s, s.entities[0].id, {
      dialogue: "Please stay.",
      action: "talk",
    });
    expect(dialogueSubtitles(next)).toBe(
      "1\n00:00:07,000 --> 00:00:10,000\nMila: Please stay.\n",
    );
    expect(validateScene(s).transcript[0].text).toBe("Older dialogue");
  });
  it("merges streamed turns with advancing save revisions but never overwrites intervening edits", () => {
    const expected = starterScene();
    const incoming = appendSpeech(expected, expected.entities[0].id, {
      dialogue: "Hello.",
      action: "talk",
    });
    expect(
      mergeConversationTurn({ ...expected, revision: 4 }, expected, incoming)
        .revision,
    ).toBe(4);
    expect(() =>
      mergeConversationTurn(
        { ...expected, name: "My newer edit" },
        expected,
        incoming,
      ),
    ).toThrow("scene changed");
  });
});

describe("recoverable model turns", () => {
  it("keeps completed turns after a provider failure and resumes with the next speaker", async () => {
    const s = starterScene();
    s.entities[0].model = "first";
    s.entities[1].model = "second";
    const good = fake(),
      bad = new MockLanguageModelV4({
        doGenerate: async () => {
          throw Error("provider secret diagnostic");
        },
      });
    const events: ConversationEvent[] = [];
    const interrupted = await conversation(
      config,
      s,
      2,
      (_c, _p, m) => (m === "first" ? good : bad),
      {
        onEvent: (e) => {
          events.push(e);
        },
      },
    ).catch((e) => e as ConversationInterrupted);
    expect(interrupted).toBeInstanceOf(ConversationInterrupted);
    if (!(interrupted instanceof ConversationInterrupted))
      throw Error("Expected interruption");
    expect(interrupted.completed).toBe(1);
    expect(interrupted.scene.transcript.map((t) => t.name)).toEqual(["Mila"]);
    expect(interrupted.message).not.toContain("secret diagnostic");
    expect(events.map((e) => e.type)).toEqual(["thinking", "turn", "thinking"]);
    const resumed = await conversation(config, interrupted.scene, 1, () =>
      fake(),
    );
    expect(resumed.transcript.map((t) => t.name)).toEqual([
      "Mila",
      "Leo",
      "Mila",
    ]);
  });
  it("cancels an in-flight provider request and makes no later calls", async () => {
    const started = deferred<void>(),
      controller = new AbortController();
    const pending = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        started.resolve();
        return new Promise((_resolve, reject) =>
          abortSignal!.addEventListener(
            "abort",
            () => reject(abortSignal!.reason),
            { once: true },
          ),
        );
      },
    });
    const run = conversation(config, starterScene(), 2, () => pending, {
      signal: controller.signal,
    });
    const outcome = run.catch((e) => e as ConversationInterrupted);
    await started.promise;
    controller.abort();
    expect(await outcome).toMatchObject({ cancelled: true, completed: 0 });
    expect(pending.doGenerateCalls).toHaveLength(1);
  });
  it("validates every character connection and dialogue capacity before paid calls", async () => {
    const s = starterScene(),
      first = fake();
    s.entities[1].model = "missing";
    await expect(
      conversation(config, s, 1, (_c, _p, m) => {
        if (m === "missing") throw Error("Missing connection");
        return first;
      }),
    ).rejects.toThrow("Missing connection");
    expect(first.doGenerateCalls).toHaveLength(0);
    s.transcript = Array.from({ length: 299 }, () => ({
      characterId: s.entities[0].id,
      name: "Mila",
      text: "Earlier",
    }));
    await expect(conversation(config, s, 1, () => first)).rejects.toThrow(
      "dialogue limit",
    );
    expect(first.doGenerateCalls).toHaveLength(0);
  });
});

let server: Server,
  base: string,
  resolveModel: typeof modelFor = () => fake();
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.post(
    "/conversation",
    conversationRoute(
      () => config,
      (c, s, r, _model, options) =>
        conversation(c, s, r, resolveModel, options),
    ),
  );
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: error.message });
    },
  );
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/conversation`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
const request = (scene: Scene, signal?: AbortSignal) =>
  fetch(base, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    },
    body: JSON.stringify({ scene, rounds: 1 }),
    signal,
  });

describe("HTTP conversation stream", () => {
  it("streams complete performance links for captions and sequential speakers", async () => {
    const scene = starterScene();
    const output = generated("Hello, and welcome to our story.");
    output.content[0].text = JSON.stringify({
      dialogue: "Hello, and welcome to our story.",
      performance: [
        { motionId: "wave", duration: 2 },
        { motionId: "bow", duration: 2 },
      ],
    });
    resolveModel = () => new MockLanguageModelV4({ doGenerate: output });
    let latest = scene;
    await readConversationStream(await request(scene), (event) => {
      if (event.type === "turn") latest = validateScene(event.scene);
    });
    expect(latest.transcript.map((line) => line.clipIds?.length)).toEqual([
      2, 2,
    ]);
    expect(dialogueTiming(latest, latest.transcript[0])).toEqual({
      start: 7,
      end: 11,
    });
    expect(dialogueTiming(latest, latest.transcript[1])).toEqual({
      start: 11,
      end: 15,
    });
    expect(dialogueSubtitles(latest)).toContain(
      "00:00:11,000 --> 00:00:15,000",
    );
  });
  it("delivers the first turn while the next provider is still pending", async () => {
    const s = starterScene();
    s.entities[1].model = "wait";
    const release = deferred<ReturnType<typeof generated>>(),
      firstTurn = deferred<void>();
    const slow = new MockLanguageModelV4({ doGenerate: () => release.promise });
    resolveModel = (_c, _p, m) => (m === "wait" ? slow : fake());
    const events: ConversationEvent[] = [];
    const response = await request(s);
    const read = readConversationStream(response, (e) => {
      events.push(e);
      if (e.type === "turn" && e.completed === 1) firstTurn.resolve();
    });
    await firstTurn.promise;
    expect(events.some((e) => e.type === "complete")).toBe(false);
    release.resolve(generated("I will stay."));
    await read;
    expect(events.map((e) => e.type)).toEqual([
      "thinking",
      "turn",
      "thinking",
      "turn",
      "complete",
    ]);
    const turns = events.filter((e) => e.type === "turn");
    expect(turns[1].scene.transcript.map((t) => t.name)).toEqual([
      "Mila",
      "Leo",
    ]);
  });
  it("retains the first delivered turn when a later provider fails", async () => {
    const s = starterScene();
    s.entities[1].model = "fail";
    resolveModel = (_c, _p, m) =>
      m === "fail"
        ? new MockLanguageModelV4({
            doGenerate: async () => {
              throw Error("failed");
            },
          })
        : fake();
    let received = s;
    await expect(
      readConversationStream(await request(s), (e) => {
        if (e.type === "turn") received = e.scene;
      }),
    ).rejects.toThrow("Leo could not finish");
    expect(received.transcript.map((t) => t.name)).toEqual(["Mila"]);
  });
  it("cancels server generation when the browser closes its stream", async () => {
    const entered = deferred<void>(),
      aborted = deferred<void>();
    const waiting = new MockLanguageModelV4({
      doGenerate: async ({ abortSignal }) => {
        entered.resolve();
        return new Promise((_resolve, reject) =>
          abortSignal!.addEventListener(
            "abort",
            () => {
              aborted.resolve();
              reject(abortSignal!.reason);
            },
            { once: true },
          ),
        );
      },
    });
    resolveModel = () => waiting;
    const controller = new AbortController();
    const response = await request(starterScene(), controller.signal);
    await entered.promise;
    controller.abort();
    await response.body?.cancel().catch(() => {});
    await aborted.promise;
    expect(waiting.doGenerateCalls).toHaveLength(1);
  });
  it("rejects a truncated stream after keeping every completed turn already delivered", async () => {
    const s = starterScene(),
      updated = appendSpeech(s, s.entities[0].id, {
        dialogue: "Héllo 🌿",
        action: "talk",
      });
    const encoded = new TextEncoder().encode(
      JSON.stringify({ type: "turn", scene: updated, completed: 1, total: 2 }) +
        "\n",
    );
    let seen: Scene | undefined;
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < encoded.length; i += 7)
            controller.enqueue(encoded.slice(i, i + 7));
          controller.close();
        },
      }),
      { headers: { "Content-Type": "application/x-ndjson" } },
    );
    await expect(
      readConversationStream(response, (e) => {
        if (e.type === "turn") seen = e.scene;
      }),
    ).rejects.toThrow("ended early");
    expect(seen?.transcript[0].text).toBe("Héllo 🌿");
  });
  it("rejects an incorrect completion receipt", async () => {
    const response = new Response(
      JSON.stringify({ type: "complete", completed: 0, total: 2 }) + "\n",
      { headers: { "Content-Type": "application/x-ndjson" } },
    );
    await expect(readConversationStream(response, () => {})).rejects.toThrow(
      "before every turn arrived",
    );
  });
});
