import { describe, it, expect, vi } from "vitest";
import * as T from "three";
import {
  applyCommands,
  starterScene,
  allAssets,
  type Scene,
  boneNames,
} from "../shared/scene";
import {
  appendSpeech,
  dialogueTiming,
  setDialoguePath,
} from "../shared/conversation";
import { SpeechTransport } from "../src/speechTransport";
import { applyAnimatedEntityPose, createCharacter } from "../src/world";
import { applyConversationPerformance } from "../src/conversationPerformance";

function fixture() {
  let s = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: "mila", id: "a", position: [-1, 0, 0] },
    { type: "add", assetId: "leo", id: "b", position: [1, 0, 0] },
  ]);
  s = appendSpeech(s, "a", {
    dialogue: "Here is a riddle for you. What gets wetter as it dries?",
    action: "talk",
  });
  return appendSpeech(s, "b", {
    dialogue: "A towel! Here is another one.",
    action: "talk",
  });
}
function voiceFixture() {
  const utterances: SpeechSynthesisUtterance[] = [];
  const synth = {
    getVoices: () => [
      { voiceURI: "english", lang: "en-US" } as SpeechSynthesisVoice,
    ],
    speak: (u: SpeechSynthesisUtterance) => utterances.push(u),
    cancel: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
  };
  const report = vi.fn();
  const transport = new SpeechTransport(
    synth,
    (text) => ({ text }) as SpeechSynthesisUtterance,
    report,
  );
  const options = { enabled: true, choices: {}, rate: 1 };
  return { transport, options, synth, utterances, report };
}
describe("the scene conversation transport", () => {
  it("waits for audio start, follows its cadence, eases to the endpoint and then starts the next voice", () => {
    const s = fixture(),
      { transport, options, utterances } = voiceFixture();
    expect(transport.advance(s, 0, 0.05, options)).toBe(0);
    utterances[0].onstart!({} as SpeechSynthesisEvent);
    let t = 0;
    for (let i = 0; i < 30; i++) t = transport.advance(s, t, 0.05, options);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(dialogueTiming(s, s.transcript[0])!.end);
    utterances[0].onend!({} as SpeechSynthesisEvent);
    const before = t;
    t = transport.advance(s, t, 0.016, options);
    expect(t - before).toBeLessThan(1); // does not skip straight to the next animation
    for (let i = 0; i < 60; i++) t = transport.advance(s, t, 0.05, options);
    expect(utterances).toHaveLength(2);
    expect(utterances[1].text).toBe(s.transcript[1].text);
  });
  it("holds both clocks on pause and resumes; a seek cancels and resumes near the requested word", () => {
    const s = fixture(),
      { transport, options, utterances, synth } = voiceFixture();
    transport.advance(s, 0, 0.1, options);
    utterances[0].onstart!({} as SpeechSynthesisEvent);
    let t = transport.advance(s, 0, 0.2, options);
    transport.pause();
    expect(transport.advance(s, t, 20, options)).toBe(t);
    transport.resume();
    expect(transport.advance(s, t, 0.1, options)).toBeGreaterThan(t);
    transport.stop();
    t = dialogueTiming(s, s.transcript[0])!.end * 0.6;
    transport.advance(s, t, 0.1, options);
    expect(utterances[1].text.length).toBeLessThan(utterances[0].text.length);
    expect(synth.cancel).toHaveBeenCalled();
  });
  it("finishes a line whose voice never reports its end instead of freezing near the last word", () => {
    const s = fixture(),
      { transport, options, utterances, report } = voiceFixture();
    transport.advance(s, 0, 0.05, options);
    utterances[0].onstart!({} as SpeechSynthesisEvent);
    const end = dialogueTiming(s, s.transcript[0])!.end;
    let t = 0,
      reached = Infinity;
    for (let i = 0; i < 400 && utterances.length < 2; i++) {
      t = transport.advance(s, t, 0.05, options);
      if (t >= end && reached === Infinity) reached = i * 0.05;
    }
    // Roughly the spoken length plus the grace, nowhere near the 120 s guard.
    expect(reached).toBeGreaterThan(3);
    expect(reached).toBeLessThan(12);
    expect(utterances).toHaveLength(2);
    expect(report).not.toHaveBeenCalled();
  });
  it("times out once and continues silently, without restarting a broken voice each frame", () => {
    const s = fixture(),
      { transport, options, utterances, report } = voiceFixture();
    let t = 0;
    for (let i = 0; i < 65; i++) t = transport.advance(s, t, 0.1, options);
    expect(t).toBeGreaterThan(0);
    expect(utterances).toHaveLength(1);
    expect(report).toHaveBeenCalledTimes(1);
  });
  it("does not let callbacks from cancelled speech affect the next line", () => {
    const s = fixture(),
      { transport, options, utterances, report } = voiceFixture();
    transport.advance(s, 0, 0.1, options);
    const old = utterances[0];
    transport.stop();
    const time = dialogueTiming(s, s.transcript[1])!.start;
    transport.advance(s, time, 0.1, options);
    old.onerror!({ error: "synthesis-failed" } as SpeechSynthesisErrorEvent);
    old.onend!({} as SpeechSynthesisEvent);
    expect(report).not.toHaveBeenCalled();
    expect(transport.advance(s, time, 0.1, options)).toBe(time);
  });
});
describe("speech-linked motion", () => {
  const route = {
    id: "route",
    name: "A thoughtful walk",
    kind: "walk" as const,
    duration: 30,
    distance: 0,
    poses: [],
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 1],
      ] as [number, number, number][],
      smooth: true,
    },
  };
  it("keeps turn timing and reuses an edited route without leaking library entries", () => {
    const s = fixture(),
      line = s.transcript[0],
      before = JSON.stringify(s);
    const changed = setDialoguePath(s, "a", line.clipId!, route);
    expect(changed.entities[0].clips[0].duration).toBe(
      s.entities[0].clips[0].duration,
    );
    expect(dialogueTiming(changed, changed.transcript[1])).toEqual(
      dialogueTiming(s, s.transcript[1]),
    );
    const edited = setDialoguePath(changed, "a", line.clipId!, {
      ...route,
      path: {
        ...route.path,
        points: [
          [0, 0, 0],
          [1, 0, 1],
        ],
      },
    });
    expect(edited.customMotions).toHaveLength(1);
    expect(JSON.stringify(s)).toBe(before);
  });
  it("samples listening and speaking reproducibly without moving the roots or corrupting a path", () => {
    let s = fixture();
    s = setDialoguePath(s, "a", s.transcript[0].clipId!, route);
    const objects = new Map(
      s.entities.map((e) => [
        e.id,
        createCharacter(
          allAssets(s).find((a) => a.id === e.assetId)!,
          e.color,
        ),
      ]),
    );
    const sample = (scene: Scene, t: number) => {
      for (const e of scene.entities)
        applyAnimatedEntityPose(objects.get(e.id)!, e, scene, t);
      const before = objects.get("a")!.position.clone();
      const heading = objects.get("a")!.rotation.y;
      applyConversationPerformance(scene, t, objects);
      expect(objects.get("a")!.position.distanceTo(before)).toBe(0);
      if (t < dialogueTiming(scene, scene.transcript[0])!.end)
        expect(objects.get("a")!.rotation.y).toBe(heading);
      return [...objects.values()].flatMap((o) => {
        o.updateMatrixWorld(true);
        return boneNames.flatMap(
          (n) => o.userData.bones[n].matrixWorld.elements,
        );
      });
    };
    const forward = sample(s, 2);
    sample(s, 8);
    expect(sample(s, 2)).toEqual(forward);
    expect(forward.every(Number.isFinite)).toBe(true);
    expect(sample(s, 3)).not.toEqual(forward);
  });
});

it("preserves the actual shipped rigs and matches the baked conversation at sampled frames", async () => {
  const fs = await import("node:fs/promises");
  const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
  const { prepareImportedAsset } = await import("../src/importedAsset");
  const { bakeAnimation } = await import("../src/bakeAnimation");
  const { exportSnapshot } = await import("../src/exportSnapshot");
  let scene = applyCommands(starterScene(), [{ type: "clear" }]);
  const assets = ["Dara", "Tess"].map((name) =>
    allAssets(scene).find((a) => a.name === name)!,
  );
  scene = applyCommands(
    scene,
    assets.map((a, i) => ({
      type: "add",
      assetId: a.id,
      id: String(i),
      position: [i * 2 - 1, 0, 0],
    })),
  );
  scene = appendSpeech(scene, "0", {
    dialogue: "A little time to talk.",
    action: "talk",
  });
  scene = appendSpeech(scene, "1", {
    dialogue: "Yes, I am listening.",
    action: "talk",
  });
  const objects = new Map<string, T.Group>();
  for (const [i, a] of assets.entries()) {
    const bytes = await fs.readFile(
      new URL("../public" + a.url, import.meta.url),
    );
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    objects.set(String(i), prepareImportedAsset(a, gltf));
  }
  const sample = (t: number) => {
    for (const e of scene.entities)
      applyAnimatedEntityPose(objects.get(e.id)!, e, scene, t);
    applyConversationPerformance(scene, t, objects);
    for (const o of objects.values()) o.updateMatrixWorld(true);
  };
  const total = dialogueTiming(scene, scene.transcript[1])!.end;
  const animation = bakeAnimation(objects.values(), total, sample);
  const root = new T.Group();
  for (const o of objects.values()) root.add(o);
  sample(0);
  const copy = exportSnapshot(root),
    mixer = new T.AnimationMixer(copy),
    action = mixer.clipAction(animation).setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  for (const time of [1, 2, 4, 5, 2]) {
    sample(time);
    action.reset().play();
    mixer.setTime(time);
    copy.updateMatrixWorld(true);
    for (const object of objects.values())
      for (const name of boneNames) {
        const bone = object.userData.bones[name] as T.Bone;
        const other = copy.getObjectByProperty("uuid", bone.uuid)!;
        expect(
          other
            .getWorldPosition(new T.Vector3())
            .distanceTo(bone.getWorldPosition(new T.Vector3())),
        ).toBeLessThan(0.00001);
      }
  }
});
