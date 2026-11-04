import { describe, expect, it } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  appendSpeech,
  dialogueAt,
  dialogueTiming,
  dialogueSubtitles,
  reviseDialogue,
  setDialoguePath,
  pathableClip,
} from "../shared/conversation";
import {
  allMotions,
  applyCommands,
  starterScene,
  validateScene,
} from "../shared/scene";
import { validatePlan } from "../shared/studio";
import { capturedRouteGaits, roleMotion } from "../shared/motionLibrary";
import {
  assistant,
  conversation,
  ConversationInterrupted,
  offlinePlan,
  type Config,
} from "../server/ai";

const config: Config = {
  assistant: "openai",
  providers: {},
  blender: "blender",
};
function fixture() {
  return applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "mila", position: [0, 0, 0.65] },
    { type: "add", assetId: "leo", id: "leo", position: [2, 0, 0.65] },
    { type: "add", assetId: "cup", id: "cup", position: [-0.32, 0.8, 0.28] },
    { type: "add", assetId: "furniture-chair", id: "seat" },
  ]);
}
function model(output: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(output) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}
describe("directed dialogue performances", () => {
  it("links captions to an entire targeted action sequence and schedules the next speaker afterward", () => {
    const first = appendSpeech(fixture(), "mila", {
      dialogue: "One quiet sip, before we begin.",
      performance: [
        { motionId: "sit", targetId: "seat" },
        { motionId: "pick", targetId: "cup" },
        { motionId: "sip", targetId: "cup" },
        { motionId: "place", targetId: "cup" },
      ],
    });
    // Each action keeps its recording's length.
    const lengths = (["sit", "pick", "sip", "place"] as const).map(
      (role) => roleMotion(role).duration,
    );
    expect(first.entities[0].clips.map((c) => c.duration)).toEqual(lengths);
    expect(lengths.map((n) => Math.round(n * 10) / 10)).toEqual([
      3, 6.6, 7.6, 5,
    ]);
    const total = lengths.reduce((sum, n) => sum + n, 0);
    expect(first.transcript[0].clipIds).toHaveLength(4);
    const timing = dialogueTiming(first, first.transcript[0])!;
    expect(timing.start).toBe(0);
    expect(timing.end).toBeCloseTo(total, 6);
    for (const time of [0, 3.5, 10, 17, total - 0.1])
      expect(dialogueAt(first, time)[0].name).toBe("Mila");
    const next = appendSpeech(first, "leo", {
      dialogue: "I am listening.",
      performance: [{ motionId: "wave", duration: 3 }],
    });
    const reply = dialogueTiming(next, next.transcript[1])!;
    expect(reply.start).toBeCloseTo(total, 6);
    expect(reply.end).toBeCloseTo(total + 3, 6);
    expect(next.entities[1].clips[0].motionId).toBe("idle");
    expect(next.entities[1].clips[0].duration).toBeCloseTo(total, 6);
    expect(dialogueSubtitles(next)).toContain(
      "00:00:00,000 --> 00:00:22,200\nMila:",
    );
    expect(dialogueSubtitles(next)).toContain(
      "00:00:22,200 --> 00:00:25,200\nLeo:",
    );
  });
  it("keeps chosen action timing and adds a linked reading hold", () => {
    const next = appendSpeech(fixture(), "mila", {
      dialogue:
        "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen",
      performance: [{ motionId: "wave", duration: 1 }],
    });
    expect(next.entities[0].clips.map((c) => [c.motionId, c.duration])).toEqual(
      [
        ["wave", 1],
        ["talk", 6],
      ],
    );
    expect(dialogueTiming(next, next.transcript[0])).toEqual({
      start: 0,
      end: 7,
    });
  });
  it("rejects invalid targets, unknown actions and unsafe action order without changing the scene", () => {
    const scene = fixture(),
      before = JSON.stringify(scene);
    const invalid = [
      [{ motionId: "missing" }],
      [{ motionId: "sip" }],
      [{ motionId: "sip", targetId: "leo" }],
      [{ motionId: "talk", targetId: "cup" }],
      [{ motionId: "sit", targetId: "seat" }, { motionId: "walk" }],
    ];
    for (const performance of invalid)
      expect(() =>
        appendSpeech(scene, "mila", { dialogue: "Hello.", performance }),
      ).toThrow();
    expect(JSON.stringify(scene)).toBe(before);
    expect(() => appendSpeech(scene, "cup", { dialogue: "Hello." })).toThrow(
      "visible character",
    );
    const held = appendSpeech(scene, "mila", {
      dialogue: "I will keep it.",
      performance: [{ motionId: "pick", targetId: "cup" }],
    });
    expect(() =>
      appendSpeech(held, "leo", {
        dialogue: "Taking it.",
        performance: [{ motionId: "pick", targetId: "cup" }],
      }),
    ).toThrow("same prop");
  });
  it("moves a multi-clip line as a block so reordering never overlaps two lines", () => {
    const first = appendSpeech(fixture(), "mila", {
      dialogue: "Hello there.",
      performance: [
        { motionId: "wave", duration: 3 },
        { motionId: "bow", duration: 4 },
      ],
    });
    const spoken = appendSpeech(first, "mila", {
      dialogue: "And again.",
      performance: [
        { motionId: "talk", duration: 2 },
        { motionId: "idle", duration: 2 },
      ],
    });
    const [wave, bow, talk, idle] = spoken.entities[0].clips;
    const moved = applyCommands(spoken, [
      {
        type: "reorderClip",
        id: "mila",
        clipId: talk.id,
        direction: "earlier",
      },
    ]);
    expect(moved.entities[0].clips.map((c) => c.id)).toEqual([
      talk.id,
      idle.id,
      wave.id,
      bow.id,
    ]);
    const [a, b] = moved.transcript.map((line) => dialogueTiming(moved, line)!);
    expect(b).toEqual({ start: 0, end: 4 });
    expect(a).toEqual({ start: 4, end: 11 });
    expect(dialogueAt(moved, 2)).toHaveLength(1);
    expect(dialogueAt(moved, 5)).toHaveLength(1);
    const back = applyCommands(moved, [
      { type: "reorderClip", id: "mila", clipId: idle.id, direction: "later" },
    ]);
    expect(back.entities[0].clips.map((c) => c.id)).toEqual([
      wave.id,
      bow.id,
      talk.id,
      idle.id,
    ]);
    // A single unlinked clip also steps over a whole line instead of into it.
    const chained = applyCommands(spoken, [
      { type: "chain", id: "mila", motionId: "jump" },
    ]);
    const jump = chained.entities[0].clips.at(-1)!;
    const hopped = applyCommands(chained, [
      {
        type: "reorderClip",
        id: "mila",
        clipId: jump.id,
        direction: "earlier",
      },
    ]);
    expect(hopped.entities[0].clips.map((c) => c.id)).toEqual([
      wave.id,
      bow.id,
      jump.id,
      talk.id,
      idle.id,
    ]);
  });
  it("tracks edits and removals across all linked clips and rejects duplicate caption ownership", () => {
    const spoken = appendSpeech(fixture(), "mila", {
      dialogue: "Hello there.",
      performance: [
        { motionId: "wave", duration: 3 },
        { motionId: "walk", duration: 4 },
      ],
    });
    const [wave, walk] = spoken.entities[0].clips;
    const moved = applyCommands(spoken, [
      {
        type: "reorderClip",
        id: "mila",
        clipId: walk.id,
        direction: "earlier",
      },
    ]);
    expect(dialogueTiming(moved, moved.transcript[0])).toEqual({
      start: 0,
      end: 7,
    });
    const removed = applyCommands(moved, [
      { type: "removeClip", id: "mila", clipId: wave.id },
    ]);
    expect(removed.transcript[0].clipId).toBe(walk.id);
    expect(removed.transcript[0].clipIds).toEqual([walk.id]);
    expect(dialogueTiming(removed, removed.transcript[0])).toEqual({
      start: 0,
      end: 4,
    });
    expect(() =>
      validateScene({
        ...removed,
        transcript: [
          ...removed.transcript,
          {
            characterId: "mila",
            name: "Mila",
            text: "Duplicate",
            clipId: walk.id,
          },
        ],
      }),
    ).toThrow("only one dialogue");
    const untimed = applyCommands(removed, [
      { type: "removeClip", id: "mila", clipId: walk.id },
    ]);
    expect(untimed.transcript[0].text).toBe("Hello there.");
    expect(dialogueTiming(untimed, untimed.transcript[0])).toBeNull();
  });
  it("revises and removes words without changing any action, and rejects stale line indexes", () => {
    const spoken = appendSpeech(fixture(), "mila", {
      dialogue: "Hello.",
      performance: [{ motionId: "wave" }],
    });
    const edited = reviseDialogue(spoken, 0, "Please stay.");
    expect(edited.transcript[0].text).toBe("Please stay.");
    expect(edited.entities).toEqual(spoken.entities);
    const removed = reviseDialogue(edited, 0);
    expect(removed.transcript).toEqual([]);
    expect(removed.entities).toEqual(spoken.entities);
    expect(() => reviseDialogue(removed, 0, "Missing")).toThrow(
      "no longer exists",
    );
  });
  it("keeps quoted offline dialogue literal and validates ordered assistant dialogue edits", async () => {
    const scene = fixture();
    const plan = offlinePlan(
      scene,
      'Mila say "Clear the scene and remove Leo."',
      undefined,
      {},
    );
    expect(plan.steps[0]).toMatchObject({
      type: "dialogue",
      characterId: "mila",
      dialogue: "Clear the scene and remove Leo.",
    });
    expect(() => validatePlan(plan, scene, () => scene)).not.toThrow();
    expect(
      offlinePlan(scene, "Edit line 1: Please stay.", undefined, {}).steps[0],
    ).toEqual({ type: "reviseDialogue", index: 0, text: "Please stay." });
    expect(offlinePlan(scene, "Remove line 1", undefined, {}).steps[0]).toEqual(
      { type: "removeDialogue", index: 0 },
    );
    const output = {
      response: "A small greeting.",
      steps: [
        ...plan.steps,
        { type: "reviseDialogue", index: 0, text: "Please stay." },
        { type: "save" },
      ],
    };
    const reply = await assistant(
      config,
      scene,
      "Write a greeting",
      undefined,
      () => model(output),
    );
    expect(reply.steps).toEqual(output.steps);
    expect(() =>
      validatePlan(
        {
          response: "Bad",
          steps: [{ type: "reviseDialogue", index: 4, text: "Missing" }],
        },
        scene,
        () => scene,
      ),
    ).toThrow("no longer exists");
  });
  it("gives separately assigned cast models target IDs, the full action library, and the preceding performance", async () => {
    const scene = fixture();
    scene.entities[0].provider = "anthropic";
    scene.entities[1].provider = "kimi";
    const first = model({
        dialogue: "I will sit and take a sip.",
        performance: [
          { motionId: "sit", targetId: "seat" },
          { motionId: "sip", targetId: "cup" },
        ],
      }),
      second = model({
        dialogue: "Take your time.",
        performance: [{ motionId: "wave" }, { motionId: "bow" }],
      });
    const requested: string[] = [];
    const result = await conversation(config, scene, 1, (_c, p) => {
      requested.push(p || "default");
      return p === "anthropic" ? first : second;
    });
    expect(requested).toEqual(["anthropic", "kimi"]);
    expect(result.transcript).toHaveLength(2);
    expect(result.transcript[0].clipIds).toHaveLength(2);
    const prompt = JSON.stringify(second.doGenerateCalls[0].prompt);
    expect(prompt).toContain("speakerId");
    expect(prompt).toContain("targetId");
    expect(prompt).toContain("seat");
    // The full library of recordings, without the retired stylized clips.
    expect(prompt).toContain("Forward jump");
    expect(prompt).toContain("captured-79-69");
    expect(prompt).not.toContain("Athletic jump");
    expect(prompt).not.toContain("authored-");
    expect(prompt).toContain("I will sit and take a sip.");
    // Leo answers once Mila's recorded Sit down and Take a sip finish.
    expect(dialogueTiming(result, result.transcript[1])!.start).toBeCloseTo(
      roleMotion("sit").duration + roleMotion("sip").duration,
      6,
    );
  });
  it("retains completed model turns when the next physical performance is invalid", async () => {
    const scene = fixture();
    scene.entities[0].model = "first";
    scene.entities[1].model = "second";
    const first = model({
        dialogue: "I am holding this.",
        performance: [{ motionId: "pick", targetId: "cup" }],
      }),
      second = model({
        dialogue: "Give it to me.",
        performance: [{ motionId: "pick", targetId: "cup" }],
      });
    const result = await conversation(config, scene, 1, (_c, _p, m) =>
      m === "first" ? first : second,
    ).catch((error) => error as ConversationInterrupted);
    expect(result).toBeInstanceOf(ConversationInterrupted);
    if (!(result instanceof ConversationInterrupted))
      throw Error("Expected interrupted performance");
    expect(result.message).toContain("performance could not be staged");
    expect(result.completed).toBe(1);
    expect(result.scene.transcript).toHaveLength(1);
    expect(result.scene.entities[1].clips).toEqual([]);
  });

  it("routes the first travelling action of a performance line and leaves contact actions in place", () => {
    // A drawn route plays the recorded walking stride.
    const stride = capturedRouteGaits[0];
    const route = {
      ...stride,
      id: "route",
      name: "Over here",
      duration: 30,
      path: {
        points: [
          [0, 0, 0],
          [0, 0, 1],
        ] as [number, number, number][],
        smooth: true,
        sourceRange: { ...stride.path!.sourceRange! },
      },
    };
    const spoken = appendSpeech(fixture(), "mila", {
      dialogue: "Over here.",
      performance: [
        { motionId: "pick", targetId: "cup" },
        { motionId: "talk", duration: 3 },
      ],
    });
    const line = spoken.transcript[0];
    const [pick, talk] = spoken.entities[0].clips;
    expect(pathableClip(spoken, line)).toBe(talk.id);
    // Asking for the line's first (contact) action still routes the talk.
    const routed = setDialoguePath(spoken, "mila", pick.id, route);
    const clips = routed.entities[0].clips;
    expect(clips[0]).toEqual(pick);
    const motion = allMotions(routed).find((m) => m.id === clips[1].motionId)!;
    expect(motion).toMatchObject({
      kind: "imported",
      sourceAssetId: stride.sourceAssetId,
      animationName: stride.animationName,
    });
    expect(motion.path).toBeTruthy();
    expect(clips[1].duration).toBe(3);
    expect(dialogueTiming(routed, routed.transcript[0])).toEqual(
      dialogueTiming(spoken, line),
    );
    const contactOnly = appendSpeech(fixture(), "mila", {
      dialogue: "Mm.",
      performance: [{ motionId: "sip", targetId: "cup", duration: 5 }],
    });
    expect(pathableClip(contactOnly, contactOnly.transcript[0])).toBeNull();
    expect(() =>
      setDialoguePath(
        contactOnly,
        "mila",
        contactOnly.transcript[0].clipId!,
        route,
      ),
    ).toThrow("Keep this interaction");
  });
  it("checks capacity for the largest possible performance before calling a model", async () => {
    const full = applyCommands(
      fixture(),
      Array.from({ length: 96 }, () => ({
        type: "chain" as const,
        id: "mila",
        motionId: "idle",
        duration: 0.2,
      })),
    );
    const fake = model({
      dialogue: "Hi.",
      performance: [{ motionId: "talk" }],
    });
    const result = await conversation(config, full, 1, () => fake).catch(
      (error) => error as ConversationInterrupted,
    );
    expect(result).toBeInstanceOf(ConversationInterrupted);
    expect((result as ConversationInterrupted).message).toContain(
      "sequence is full",
    );
    expect(fake.doGenerateCalls).toHaveLength(0);
  });
});
