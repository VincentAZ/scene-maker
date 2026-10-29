import { z } from "zod";
import { interactionSessions } from "./interactions";
import { ladderProfile } from "./ladder";
import { libraryAssetURLs, libraryCharacters } from "./characterLibrary";
export const providers = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "kimi",
  "openrouter",
] as const;
export const vec3 = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
export const boneNames = [
  "hips",
  "spine",
  "head",
  "leftArm",
  "leftForearm",
  "rightArm",
  "rightForearm",
  "leftLeg",
  "leftShin",
  "rightLeg",
  "rightShin",
] as const;
export const poseSchema = z.object({
  at: z.number().min(0).max(1),
  root: vec3,
  rotations: z.partialRecord(z.enum(boneNames), vec3),
});
export const motionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1).max(100),
    duration: z.number().min(0.2).max(60),
    kind: z.enum([
      "idle",
      "walk",
      "run",
      "jump",
      "wave",
      "sit",
      "dance",
      "crawl",
      "climb",
      "sip",
      "pick",
      "place",
      "talk",
      "bow",
      "custom",
      "imported",
    ]),
    distance: z.number().min(-20).max(20).default(0),
    poses: z.array(poseSchema).max(100).default([]),
    sourceAssetId: z.string().optional(),
    animationName: z.string().optional(),
    path: z
      .object({
        points: z.array(vec3).min(2).max(32),
        smooth: z.boolean().default(true),
      })
      .optional(),
  })
  .superRefine((motion, context) => {
    if (motion.path) {
      const points = motion.path.points;
      if (
        !["walk", "run"].includes(motion.kind) ||
        !points.length ||
        points[0].some((n) => Math.abs(n) > 1e-6) ||
        points.some(
          (p, i) =>
            Math.abs(p[1]) > 1e-6 ||
            p.some((n) => Math.abs(n) > 50) ||
            (i > 0 &&
              Math.hypot(...p.map((n, axis) => n - points[i - 1][axis])) <
                0.05),
        )
      )
        context.addIssue({
          code: "custom",
          message:
            "Walking and running paths must start at zero, stay level, and have distinct points within 50 meters.",
          path: ["path"],
        });
    }
    if (motion.kind === "custom") {
      const times = motion.poses.map((pose) => pose.at);
      if (
        times.length < 2 ||
        !times.includes(0) ||
        !times.includes(1) ||
        new Set(times).size !== times.length
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Custom actions need distinct keyframes including the start and end.",
          path: ["poses"],
        });
      }
    }
    if (
      motion.kind === "imported" &&
      (!motion.sourceAssetId || !motion.animationName)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Imported actions need their source character and animation name.",
      });
    }
  });
export type Motion = z.infer<typeof motionSchema>;
export const shapeSchema = z.object({
  shape: z.enum(["sphere", "box", "cylinder", "cone", "torus"]),
  position: vec3,
  scale: z.tuple([
    z.number().min(0.01).max(100),
    z.number().min(0.01).max(100),
    z.number().min(0.01).max(100),
  ]),
  rotation: vec3,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  bone: z.enum(boneNames).optional(),
});
export const assetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  category: z.enum(["characters", "props", "environments"]),
  style: z.string().max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  skin: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#bf8866"),
  body: z.enum(["feminine", "masculine", "mannequin"]).default("masculine"),
  url: z
    .string()
    .refine(
      (url) =>
        /^\/uploads\/[a-zA-Z0-9_.-]+\.glb$/.test(url) ||
        libraryAssetURLs.has(url),
      "Choose an uploaded file or an existing library character.",
    )
    .optional(),
  description: z.string().max(1000).default(""),
  parts: z.array(shapeSchema).max(256).optional(),
  grip: vec3.optional(),
  mouth: vec3.optional(),
  ladder: z
    .object({
      height: z.number().min(0.5).max(20),
      width: z.number().min(0.3).max(3),
      firstRung: z.number().min(0.05).max(1),
      spacing: z.number().min(0.1).max(0.8),
      rungs: z.number().int().min(3).max(32),
    })
    .refine(
      (p) => p.firstRung + (p.rungs - 1) * p.spacing < p.height,
      "Ladder rungs must fit below its top.",
    )
    .optional(),
});
export type Asset = z.infer<typeof assetSchema>;
export const clipSchema = z.object({
  id: z.string(),
  motionId: z.string(),
  duration: z.number().min(0.2).max(60),
  targetId: z.string().optional(),
  transition: z.enum(["smooth", "cut"]).optional(),
});
export const entitySchema = z.object({
  id: z.string().min(1),
  assetId: z.string(),
  name: z.string().min(1).max(100),
  position: vec3,
  rotation: z.number().finite(),
  scale: z.number().min(0.1).max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  visible: z.boolean(),
  personality: z.string().max(4000),
  provider: z.enum(providers).nullable(),
  model: z.string().max(200),
  clips: z.array(clipSchema).max(100),
  ending: z.enum(["hold", "rest"]).optional(),
});
export type Entity = z.infer<typeof entitySchema>;
export const dialogueLineSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  text: z.string().max(8000),
  clipId: z.string().optional(),
});
export type DialogueLine = z.infer<typeof dialogueLineSchema>;
export const sceneSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9-]+$/),
  revision: z.number().int().min(0),
  name: z.string().min(1).max(100),
  environment: z.enum([
    "cafe",
    "warehouse",
    "studio",
    "park",
    "office",
    "street",
  ]),
  lighting: z.enum(["golden", "daylight", "moonlight"]),
  mission: z.string().max(4000),
  entities: z.array(entitySchema).max(100),
  customAssets: z.array(assetSchema).max(100),
  customMotions: z.array(motionSchema).max(100),
  transcript: z.array(dialogueLineSchema).max(300),
});
export type Scene = z.infer<typeof sceneSchema>;
export const commandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("add"),
    assetId: z.string(),
    id: z.string().min(1).optional(),
    name: z.string().optional(),
    position: vec3.optional(),
  }),
  z.object({
    type: z.literal("update"),
    id: z.string(),
    changes: entitySchema.omit({ id: true, assetId: true }).partial(),
  }),
  z.object({ type: z.literal("remove"), id: z.string() }),
  z.object({
    type: z.literal("chain"),
    id: z.string(),
    motionId: z.string(),
    duration: z.number().min(0.2).max(60).optional(),
    targetId: z.string().optional(),
    transition: z.enum(["smooth", "cut"]).optional(),
  }),
  z.object({
    type: z.literal("removeClip"),
    id: z.string(),
    clipId: z.string(),
  }),
  z.object({
    type: z.literal("reorderClip"),
    id: z.string(),
    clipId: z.string(),
    direction: z.enum(["earlier", "later"]),
  }),
  z.object({
    type: z.literal("scene"),
    changes: sceneSchema
      .pick({ name: true, environment: true, lighting: true, mission: true })
      .partial(),
  }),
  z.object({ type: z.literal("createAsset"), asset: assetSchema }),
  z.object({ type: z.literal("createMotion"), motion: motionSchema }),
  z.object({ type: z.literal("updateMotion"), motion: motionSchema }),
  z.object({ type: z.literal("clear") }),
]);
export type Command = z.infer<typeof commandSchema>;
export const uid = () => crypto.randomUUID();
export const characters: Asset[] = [
  ["mila", "Mila", "Creative", "#b7c49c", "#b87954", "feminine"],
  ["leo", "Leo", "Everyday", "#e3b174", "#aa7454", "masculine"],
  ["ava", "Ava", "Barista", "#6f8a7b", "#dbac86", "feminine"],
  ["kai", "Kai", "Filmmaker", "#577a90", "#9f6749", "masculine"],
  ["nora", "Nora", "Doctor", "#e4e6df", "#714b37", "feminine"],
  ["owen", "Owen", "Chef", "#f0e9d6", "#d8a280", "masculine"],
  ["iris", "Iris", "Astronaut", "#d8e4e5", "#9a6447", "feminine"],
  ["jack", "Jack", "Builder", "#d5a142", "#c38f66", "masculine"],
  ["june", "June", "Scientist", "#b4cfce", "#d3a383", "feminine"],
  ["eli", "Eli", "Firefighter", "#ac694b", "#784b36", "masculine"],
  ["maya", "Maya", "Artist", "#9d82a3", "#935b40", "feminine"],
  ["noah", "Noah", "Explorer", "#899b73", "#d9b191", "masculine"],
  ["mannequin", "Mannequin", "Mannequin", "#d6d0c4", "#d6d0c4", "mannequin"],
  [
    "mannequin-dark",
    "Graphite",
    "Mannequin",
    "#575b60",
    "#575b60",
    "mannequin",
  ],
].map(([id, name, style, color, skin, body]) => ({
  id,
  name,
  style,
  color,
  skin,
  body: body as Asset["body"],
  category: "characters",
  description: `An original, fully rigged ${style.toLowerCase()} character.`,
}));
export const props: Asset[] = [
  ["cup", "Coffee cup", "#d18a5e"],
  ["table", "Round table", "#b78b62"],
  ["chair", "Bistro chair", "#6d8875"],
  ["plant", "Monstera", "#65846a"],
  ["sofa", "Lounge sofa", "#c28f6c"],
  ["lamp", "Floor lamp", "#dab775"],
  ["crate", "Wooden crate", "#ac8961"],
  ["ladder", "Ladder", "#9a7956"],
  ["book", "Notebook", "#77978f"],
  ["camera", "Camera", "#4e5759"],
  ["bench", "Park bench", "#8e7354"],
  ["desk", "Work desk", "#a5896c"],
].map(([id, name, color]) => ({
  id,
  name,
  color,
  style: id,
  skin: "#bf8866",
  body: "mannequin",
  category: "props",
  description: "Ready to place in your scene.",
}));
export const environments: Asset[] = [
  "cafe",
  "warehouse",
  "studio",
  "park",
  "office",
  "street",
].map((id) => ({
  id,
  name: (
    {
      cafe: "Corner café",
      warehouse: "The warehouse",
      studio: "Infinite studio",
      park: "Quiet garden",
      office: "Creative office",
      street: "City corner",
    } as Record<string, string>
  )[id],
  style: id,
  color: "#b7c49c",
  skin: "#bf8866",
  body: "mannequin",
  category: "environments",
  description: "A complete set, ready for your story.",
}));
export const assets = [
  ...characters,
  ...libraryCharacters,
  ...props,
  ...environments,
];
export const motions: Motion[] = [
  ["idle", "Breathe", 3, 0],
  ["walk", "Walk", 4, 2],
  ["run", "Run", 2, 3],
  ["jump", "Jump", 1.5, 0],
  ["wave", "Wave hello", 2, 0],
  ["sit", "Sit down", 2, 0],
  ["dance", "Little dance", 4, 0],
  ["crawl", "Crawl", 4, 1.6],
  ["climb", "Climb a ladder", 6, 1],
  ["pick", "Pick up", 2, 0],
  ["place", "Put down", 2, 0],
  ["sip", "Take a sip", 3, 0],
  ["talk", "Talk", 4, 0],
  ["bow", "Take a bow", 2, 0],
].map(([id, name, duration, distance]) => ({
  id: String(id),
  name: String(name),
  duration: Number(duration),
  distance: Number(distance),
  kind: id as Motion["kind"],
  poses: [],
}));
export const allAssets = (s: Scene) => [...assets, ...s.customAssets];
export const allMotions = (s: Scene) => [...motions, ...s.customMotions];
export function applyCommands(scene: Scene, input: unknown): Scene {
  const commands = z.array(commandSchema).max(100).parse(input);
  const s = structuredClone(scene);
  const find = (id: string) => {
    const e = s.entities.find((e) => e.id === id);
    if (!e) throw Error("That scene object no longer exists.");
    return e;
  };
  for (const cmd of commands) {
    if (cmd.type === "add") {
      const a = allAssets(s).find((a) => a.id === cmd.assetId);
      if (!a) throw Error("Asset not found.");
      if (a.category === "environments") {
        s.environment = a.style as Scene["environment"];
        continue;
      }
      s.entities.push({
        id: cmd.id || uid(),
        assetId: a.id,
        name: cmd.name || a.name,
        position: cmd.position || [
          (s.entities.length % 4) - 1.5,
          0,
          Math.floor(s.entities.length / 4) % 3,
        ],
        rotation: 0,
        scale: 1,
        color: a.color,
        visible: true,
        personality: "You are curious, warm, and natural. Stay in character.",
        provider: null,
        model: "",
        clips: [],
        ending: "hold",
      });
    }
    if (cmd.type === "update") Object.assign(find(cmd.id), cmd.changes);
    if (cmd.type === "remove") {
      find(cmd.id);
      s.entities = s.entities.filter((e) => e.id !== cmd.id);
      s.entities.forEach((e) =>
        e.clips.forEach((c) => {
          if (c.targetId === cmd.id) delete c.targetId;
        }),
      );
    }
    if (cmd.type === "chain") {
      const e = find(cmd.id);
      if (
        allAssets(s).find((a) => a.id === e.assetId)?.category !== "characters"
      )
        throw Error("Choose a character to add an action.");
      const m = allMotions(s).find((m) => m.id === cmd.motionId);
      if (!m) throw Error("Motion not found.");
      if (cmd.targetId) find(cmd.targetId);
      e.clips.push({
        id: uid(),
        motionId: m.id,
        duration: cmd.duration || m.duration,
        targetId: cmd.targetId,
        transition: cmd.transition || "smooth",
      });
    }
    if (cmd.type === "removeClip") {
      const e = find(cmd.id);
      e.clips = e.clips.filter((c) => c.id !== cmd.clipId);
    }
    if (cmd.type === "reorderClip") {
      const e = find(cmd.id),
        i = e.clips.findIndex((c) => c.id === cmd.clipId),
        j = i + (cmd.direction === "earlier" ? -1 : 1);
      if (i >= 0 && j >= 0 && j < e.clips.length)
        [e.clips[i], e.clips[j]] = [e.clips[j], e.clips[i]];
    }
    if (cmd.type === "scene") Object.assign(s, cmd.changes);
    if (cmd.type === "createAsset") {
      if (allAssets(s).some((a) => a.id === cmd.asset.id))
        throw Error("Choose a unique asset ID.");
      s.customAssets.push(cmd.asset);
    }
    if (cmd.type === "createMotion") {
      if (allMotions(s).some((m) => m.id === cmd.motion.id))
        throw Error("Choose a unique motion ID.");
      s.customMotions.push(cmd.motion);
    }
    if (cmd.type === "updateMotion") {
      const index = s.customMotions.findIndex((m) => m.id === cmd.motion.id);
      if (index < 0) throw Error("Only your own actions can be edited.");
      s.customMotions[index] = cmd.motion;
    }
    if (cmd.type === "clear") {
      s.entities = [];
      s.transcript = [];
    }
  }
  // Keep dialogue as editable history if its character/action is removed.
  for (const line of s.transcript)
    if (
      line.clipId &&
      !s.entities
        .find((e) => e.id === line.characterId)
        ?.clips.some((c) => c.id === line.clipId)
    )
      delete line.clipId;
  return validateScene(s);
}
export function validateScene(input: unknown): Scene {
  const s = sceneSchema.parse(input);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(s.entities.map((e) => e.id)) ||
    !unique(allAssets(s).map((a) => a.id)) ||
    !unique(allMotions(s).map((m) => m.id))
  )
    throw Error("Duplicate IDs in scene.");
  for (const e of s.entities) {
    if (!allAssets(s).some((a) => a.id === e.assetId))
      throw Error("Unknown asset in scene.");
    if (!unique(e.clips.map((c) => c.id))) throw Error("Duplicate clip IDs.");
    for (const c of e.clips) {
      if (!allMotions(s).some((m) => m.id === c.motionId))
        throw Error("Unknown action in scene.");
      const motion = allMotions(s).find((m) => m.id === c.motionId)!;
      if (motion.kind === "imported") {
        const source = allAssets(s).find((a) => a.id === motion.sourceAssetId);
        if (!source)
          throw Error(
            "The original asset for this imported action is missing.",
          );
        if (
          motion.sourceAssetId !== e.assetId &&
          (source.category !== "characters" ||
            allAssets(s).find((a) => a.id === e.assetId)?.category !==
              "characters")
        )
          throw Error(
            "Shared imported actions need a source character and a receiving character.",
          );
      }
      if (c.targetId && !s.entities.some((t) => t.id === c.targetId))
        throw Error("Missing action target.");
      if (
        c.targetId &&
        allMotions(s).find((m) => m.id === c.motionId)!.kind === "climb"
      ) {
        if (
          allAssets(s).find((a) => a.id === e.assetId)!.category !==
          "characters"
        )
          throw Error("Choose a character to climb the ladder.");
        const target = s.entities.find((t) => t.id === c.targetId)!;
        const asset = allAssets(s).find((a) => a.id === target.assetId)!;
        if (asset.category !== "props" || !ladderProfile(asset))
          throw Error("Choose a ladder with known rungs for this climb.");
      }
      if (
        c.targetId &&
        ["pick", "sip", "place"].includes(
          allMotions(s).find((m) => m.id === c.motionId)!.kind,
        )
      ) {
        const target = s.entities.find((t) => t.id === c.targetId)!;
        if (
          allAssets(s).find((a) => a.id === target.assetId)?.category !==
          "props"
        )
          throw Error("Choose a prop for this interaction.");
      }
    }
  }
  const linked = s.transcript.filter((line) => line.clipId);
  if (!unique(linked.map((line) => `${line.characterId}:${line.clipId}`)))
    throw Error("An action can have only one dialogue line.");
  for (const line of linked)
    if (
      !s.entities
        .find((e) => e.id === line.characterId)
        ?.clips.some((c) => c.id === line.clipId)
    )
      throw Error("Missing dialogue action.");
  interactionSessions(s, allMotions(s));
  return s;
}
export const duration = (s: Scene) =>
  Math.max(
    12,
    ...s.entities.map((e) => e.clips.reduce((t, c) => t + c.duration, 0)),
  );
export function starterScene(): Scene {
  let s: Scene = {
    version: 1,
    id: uid(),
    revision: 0,
    name: "A chance encounter",
    environment: "cafe",
    lighting: "golden",
    mission:
      "Two strangers meet at a neighborhood café. One has a story to tell; the other has a train to catch. Find a reason for them to stay.",
    entities: [],
    customAssets: [],
    customMotions: [],
    transcript: [],
  };
  s = applyCommands(s, [
    { type: "add", assetId: "mila", position: [-1.2, 0, 0.4] },
    { type: "add", assetId: "leo", position: [0.75, 0, -0.25] },
    { type: "add", assetId: "table", position: [0, 0, -0.35] },
    { type: "add", assetId: "cup", position: [0.2, 1.01, -0.35] },
    { type: "add", assetId: "plant", position: [-3, 0, -1.8] },
  ]);
  s.entities[0].rotation = 0.4;
  s.entities[1].rotation = -0.6;
  return applyCommands(s, [
    { type: "chain", id: s.entities[0].id, motionId: "wave" },
    { type: "chain", id: s.entities[0].id, motionId: "talk" },
    { type: "chain", id: s.entities[1].id, motionId: "talk" },
    {
      type: "chain",
      id: s.entities[1].id,
      motionId: "sip",
      targetId: s.entities[3].id,
    },
  ]);
}
