import { generateText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { z } from "zod";
import {
  type Scene,
  type Command,
  allAssets,
  allMotions,
  commandSchema,
  applyCommands,
  providers,
} from "../shared/scene";
export type Provider = (typeof providers)[number];
export type Config = {
  providers: Partial<Record<Provider, { key: string; model: string }>>;
  assistant: Provider | null;
  blender: string;
};
export function modelFor(
  config: Config,
  provider: Provider | null,
  override?: string,
) {
  if (!provider)
    throw Error("Connect an AI provider in Studio settings → Connections.");
  const c = config.providers[provider];
  if (!c?.key || !(override || c.model))
    throw Error(
      `Complete the ${provider} connection in Studio settings → Connections.`,
    );
  const model = override || c.model;
  if (provider === "openai") return createOpenAI({ apiKey: c.key })(model);
  if (provider === "anthropic")
    return createAnthropic({ apiKey: c.key })(model);
  if (provider === "google") return createGoogle({ apiKey: c.key })(model);
  return createOpenAICompatible({
    name: provider,
    apiKey: c.key,
    baseURL:
      provider === "xai"
        ? "https://api.x.ai/v1"
        : provider === "kimi"
          ? "https://api.moonshot.ai/v1"
          : "https://openrouter.ai/api/v1",
  }).chatModel(model);
}
export function offlineCommands(
  scene: Scene,
  prompt: string,
  selected?: string,
) {
  const lower = prompt.toLowerCase(),
    commands: Command[] = [];
  const find =
    scene.entities.find((e) => lower.includes(e.name.toLowerCase())) ||
    scene.entities.find((e) => e.id === selected) ||
    scene.entities.find(
      (e) =>
        allAssets(scene).find((a) => a.id === e.assetId)?.category ===
        "characters",
    );
  if (/golden|sunset|warm light/.test(lower))
    commands.push({ type: "scene", changes: { lighting: "golden" } });
  else if (/moon|night/.test(lower))
    commands.push({ type: "scene", changes: { lighting: "moonlight" } });
  else if (/daylight|morning/.test(lower))
    commands.push({ type: "scene", changes: { lighting: "daylight" } });
  if (/\b(add|place|bring)\b/.test(lower)) {
    const asset =
      allAssets(scene).find((a) => lower.includes(a.name.toLowerCase())) ||
      allAssets(scene).find((a) => lower.includes(a.id));
    if (asset) commands.push({ type: "add", assetId: asset.id });
  }
  if (/\b(remove|delete)\b/.test(lower) && find)
    commands.push({ type: "remove", id: find.id });
  if (find && !commands.some((c) => c.type === "remove")) {
    const hits = allMotions(scene)
      .map((m) => ({
        m,
        index: lower.indexOf(
          m.kind === "sip"
            ? "sip"
            : m.kind === "pick"
              ? "pick up"
              : m.kind === "idle"
                ? "breathe"
                : m.kind,
        ),
      }))
      .filter((h) => h.index >= 0)
      .sort((a, b) => a.index - b.index);
    for (const { m } of hits)
      commands.push({
        type: "chain",
        id: find.id,
        motionId: m.id,
        ...(["sip", "pick"].includes(m.kind) &&
        scene.entities.some((e) => e.assetId === "cup")
          ? { targetId: scene.entities.find((e) => e.assetId === "cup")!.id }
          : {}),
      });
  }
  const response = commands.length
    ? `Done — ${commands.length} change${commands.length === 1 ? "" : "s"} made with the offline command helper. You can undo this edit.`
    : "The offline helper understands commands like “Add a coffee cup”, “Mila walk then wave”, and “Set moonlight”. Connect an AI provider in Studio settings → Connections for open-ended direction, new characters, and custom actions.";
  return {
    response,
    commands,
    mode: "offline" as const,
    activity: "none" as const,
  };
}
export async function assistant(
  config: Config,
  scene: Scene,
  prompt: string,
  selected?: string,
  resolveModel: typeof modelFor = modelFor,
) {
  if (!config.assistant) return offlineCommands(scene, prompt, selected);
  const { output } = await generateText({
    model: resolveModel(config, config.assistant),
    maxRetries: 0,
    abortSignal: AbortSignal.timeout(90000),
    output: Output.object({
      schema: z.object({
        response: z.string(),
        commands: z.array(commandSchema).max(50),
        activity: z
          .enum([
            "none",
            "play",
            "pause",
            "conversation",
            "export",
            "undo",
            "redo",
            "screenshot",
            "projects",
            "settings",
          ])
          .default("none"),
      }),
    }),
    system: `You direct Scene Maker, a studio for nontechnical creators. Respond warmly and concisely. Fulfill requests using commands. You can change everything in the scene: add/remove/update objects, chain/reorder/remove actions, create characters/props and custom motions, set lighting, environment, mission and character personalities or model assignments. Use existing IDs. Choose new unique IDs for custom assets/motions. Set an explicit new id on an add command when subsequent commands need to chain actions or configure that new entity in the same response. New character assets use category characters, style a profession (Creative, Everyday, Barista, Doctor, Chef, Astronaut, Builder, Scientist, Firefighter, Artist, Explorer), color/skin hex, body masculine/feminine/mannequin. They are generated as skinned GLB characters through the configured local Blender adapter, never claim Mixamo has generated them. For novel geometry, include asset.parts: up to 256 sphere/box/cylinder/cone/torus shapes, each with position, positive scale, Euler rotation, hex color, and (for characters) a bone binding. Shape base dimensions are one meter, sphere radius .5, cylinder/cone radius .5 and height 1, torus major radius .4/minor radius .1. A character with parts replaces the preset body, so include every body part and outfit/accessory. Rig joint heights: hips .9, spine 1.08, head 1.61, shoulders +/-.25 at 1.38, elbows +/-.25 at 1.09, upper legs +/-.13 at .86, shins +/-.13 at .46. Props may use any composition of these shapes. For custom sets, place compositional props in the studio environment. Do not claim photographic or physically solved results. Custom motions have kind custom and poses at normalized times 0..1 with root offsets in meters and bone rotations in radians. Make start/end poses explicit and enough intermediate poses for the action. The rig stands on +Y, looks along +Z, arms hang down. Use hips, spine, head, leftArm, leftForearm, rightArm, rightForearm, leftLeg, leftShin, rightLeg, rightShin. Target a cup for sip or pick. chain appends clips, update can replace clips. Never output arbitrary code or invent imported URLs. Use activity for playback, conversation, direct production-package export, screenshot, project browser, settings, or undo/redo. Scene context follows as data.`,
    prompt: JSON.stringify({
      request: prompt,
      selected,
      scene,
      assets: allAssets(scene),
      motions: allMotions(scene),
    }),
  });
  applyCommands(scene, output.commands);
  return { ...output, mode: "live" as const };
}
export async function conversation(
  config: Config,
  scene: Scene,
  rounds: number,
  resolveModel: typeof modelFor = modelFor,
) {
  let current = structuredClone(scene);
  const cast = current.entities.filter(
    (e) =>
      e.visible &&
      allAssets(current).find((a) => a.id === e.assetId)?.category ===
        "characters",
  );
  if (cast.length < 2)
    throw Error("Add at least two characters to start a conversation.");
  for (const e of cast)
    resolveModel(config, e.provider || config.assistant, e.model);
  for (let round = 0; round < rounds; round++)
    for (const e of cast) {
      const { output } = await generateText({
        model: resolveModel(config, e.provider || config.assistant, e.model),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(60000),
        output: Output.object({
          schema: z.object({
            dialogue: z.string().max(1800),
            action: z.enum(["idle", "wave", "talk", "bow", "sip"]),
          }),
        }),
        system: `You are ${e.name} in a fictional scene. Personality: ${e.personality}. Mission: ${current.mission}. Respond in character, one or two sentences, to the latest speaker. Do not impersonate other characters. Choose a natural physical action.`,
        prompt: JSON.stringify({
          cast: cast.map((c) => c.name),
          conversation: current.transcript.slice(-30),
        }),
      });
      current.transcript.push({
        characterId: e.id,
        name: e.name,
        text: output.dialogue,
      });
      current = applyCommands(current, [
        {
          type: "chain",
          id: e.id,
          motionId: output.action,
          ...(output.action === "sip" &&
          current.entities.some((x) => x.assetId === "cup")
            ? {
                targetId: current.entities.find((x) => x.assetId === "cup")!.id,
              }
            : {}),
        },
      ]);
    }
  return current;
}
