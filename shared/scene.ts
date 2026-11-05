import { z } from "zod";
import { rigMappingSchema } from "./rigMapping";
import { interactionSessions } from "./interactions";
import { seatProfile, validateSeating } from "./seating";
import { ladderProfile } from "./ladder";
import { libraryAssetURLs, libraryCharacters } from "./characterLibrary";
import { characterDesignSchema, supportsGlasses } from "./characterDesign";
import { furnitureAssets, furnitureURLs } from "./furnitureLibrary";
import {
  libraryMotions,
  motionSource,
  capturedMotions,
  capturedRoleAliases,
  capturedRouteGaits,
  motionSources,
  seatedRecording,
} from "./motionLibrary";
import { setAssets, setLayout } from "./setLayouts";
import { contentAssets, contentURL } from "./contentLibrary";
import {
  FLOOR_TOP,
  freeSpot,
  keepOnSetFloor,
  setSchema,
  spawnPosition,
  standsOnFloor,
  type FloorBlocked,
} from "./sets";
import { thinkingLevels } from "./thinking";
import {
  MIN_PLAYBACK_RATE,
  MAX_PLAYBACK_RATE,
  routeActiveDuration,
} from "./clipTiming";
export const providers = [
  "openai",
  "anthropic",
  "google",
  "xai",
  "kimi",
  "openrouter",
  "lmstudio",
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
/** Purposes a recorded action can serve. Earlier studio versions computed
 * these bodies with formulas (kinds of the same names); scenes saved then are
 * migrated to recordings on load (`migrateLegacyMotions`). */
export const actionRoles = [
  "idle",
  "walk",
  "run",
  "jump",
  "wave",
  "sit",
  "stand",
  "dance",
  "crawl",
  "climb",
  "sip",
  "pick",
  "place",
  "talk",
  "bow",
] as const;
export type ActionRole = (typeof actionRoles)[number];
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
      "stand",
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
    // What a recorded action is for, so seats, ladders, props, dialogue and
    // routes can use it. Bodies always come from the recording.
    role: z.enum(actionRoles).optional(),
    sourceAssetId: z.string().optional(),
    animationName: z.string().optional(),
    path: z
      .object({
        points: z.array(vec3).min(2).max(32),
        smooth: z.boolean().default(true),
        // Procedural backpedalling. Imported gaits retain their captured
        // body-to-travel orientation instead of reversing source animation.
        backward: z.boolean().optional(),
        // Small spatial stride adaptation retains the full source clock when
        // detouring a one-off performance. Body proportions remain unchanged.
        strideScale: z.number().finite().min(0.9).max(1.1).optional(),
        // Captured travel fraction at each retained trajectory waypoint.
        // This belongs to the repaired geometry, not to the reusable gait.
        sourceProgress: z
          .array(z.number().finite().min(0).max(1))
          .min(2)
          .max(32)
          .optional(),
        // Selected original take interval, independent of route duration.
        sourceRange: z
          .object({
            start: z.number().finite().min(0),
            end: z.number().finite().positive(),
          })
          .refine(
            (range) => range.end > range.start,
            "Source range must end after it starts.",
          )
          .optional(),
        endHeading: z.number().finite().min(-100).max(100).optional(),
        // A route replanned while it was being played keeps the facing it
        // had already shown: its entry turn fades over the original length
        // (path units), and the arrival turn it had begun continues from
        // where the replan happened. Absent, both windows are shares of the
        // route's own length.
        entryWindow: z.number().finite().min(0).max(100).optional(),
        arrival: z
          .array(
            z.object({
              // Path distance where this turn begins and the distance it
              // eases over; the turn itself and the facing offset it starts
              // from. The last segment turns to the route's end heading.
              start: z.number().finite().min(0).max(100),
              window: z.number().finite().positive().max(100),
              turn: z.number().finite().min(-100).max(100).optional(),
              base: z.number().finite().min(-100).max(100).optional(),
            }),
          )
          .max(32)
          .optional(),
      })
      .optional(),
  })
  .superRefine((motion, context) => {
    if (motion.path) {
      const progress = motion.path.sourceProgress;
      if (
        progress &&
        (motion.kind !== "imported" ||
          motion.path.strideScale === undefined ||
          progress.length !== motion.path.points.length ||
          progress[0] !== 0 ||
          progress.at(-1) !== 1 ||
          progress.some((p, i) => i > 0 && p <= progress[i - 1]))
      )
        context.addIssue({
          code: "custom",
          path: ["path", "sourceProgress"],
          message:
            "Captured trajectory progress needs an adapted imported gait and increasing fractions from zero to one for every waypoint.",
        });
      if (motion.path.sourceRange && motion.kind !== "imported")
        context.addIssue({
          code: "custom",
          message: "Source ranges require an imported gait.",
          path: ["path", "sourceRange"],
        });
      if (motion.path.strideScale !== undefined && motion.kind !== "imported")
        context.addIssue({
          code: "custom",
          message: "Captured step length requires an imported gait.",
          path: ["path", "strideScale"],
        });
      if (motion.path.backward && motion.kind === "imported")
        context.addIssue({
          code: "custom",
          message: "Choose a captured backward gait for an imported route.",
          path: ["path", "backward"],
        });
      const points = motion.path.points;
      if (
        !["walk", "run", "imported"].includes(motion.kind) ||
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
            "Locomotion paths must start at zero, stay level, and have distinct points within 50 meters.",
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
/** Where a prop can be sat on: the centre of its sitting surface in model
 * metres, and the surface's extent. */
const seatSchema = z.object({
  position: vec3,
  width: z.number().min(0.2).max(10),
  depth: z.number().min(0.2).max(5),
});
export const assetSchema = z
  .object({
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
        (url): boolean =>
          /^\/uploads\/[a-zA-Z0-9_.-]+\.glb$/.test(url) ||
          motionSources.some((source) => url === source.url) ||
          libraryAssetURLs.has(url) ||
          furnitureURLs.has(url) ||
          (contentURL.test(url) && !url.includes("..")),
        "Choose an uploaded file or an existing library asset.",
      )
      .optional(),
    description: z.string().max(1000).default(""),
    rigMapping: rigMappingSchema.optional(),
    // An animation-only import (BVH, skinless FBX/GLB): a skeleton holding
    // recorded takes for Actions, not a placeable character.
    motionOnly: z.boolean().optional(),
    thumbnail: z
      .string()
      .regex(/^\/(uploads|content)\/[a-zA-Z0-9_./-]+\.(png|jpg|webp)$/)
      .refine((url) => !url.includes(".."))
      .optional(),
    /** An environment map under /content/: a photographic 360° set on its
     * own, or the image-based light of a 3D set when `url` is present too. */
    hdri: z
      .string()
      .regex(/^\/content\/[a-zA-Z0-9_./-]+\.(hdr|exr|jpg)$/)
      .refine((url) => !url.includes(".."))
      .optional(),
    /** How a real 3D set (an environment with a model `url`) is staged. */
    set: setSchema.optional(),
    /** How a photographic set is shown: the visible panorama, projected onto
     * the floor from the photographer's height (m) within a dome radius (m),
     * turned by a yaw in degrees. */
    backdrop: z
      .object({
        image: z
          .string()
          .regex(/^\/content\/[a-zA-Z0-9_./-]+\.jpg$/)
          .refine((url) => !url.includes("..")),
        height: z.number().min(0.3).max(10),
        radius: z.number().min(3).max(90),
        rotation: z.number().min(-360).max(360),
      })
      .optional(),
    design: characterDesignSchema.optional(),
    parts: z.array(shapeSchema).max(256).optional(),
    seat: seatSchema.optional(),
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
  })
  .superRefine((asset, context) => {
    if (
      asset.design &&
      (asset.category !== "characters" || asset.parts?.length)
    )
      context.addIssue({
        code: "custom",
        message:
          "Character designs use a starting look, without replacement body parts.",
      });
    if (asset.design?.glasses && !supportsGlasses(asset.design.baseId))
      context.addIssue({
        code: "custom",
        message:
          "This helmet covers the face. Choose another look for glasses.",
      });
    if (asset.set && (asset.category !== "environments" || !asset.url))
      context.addIssue({
        code: "custom",
        message: "A 3D set needs its model file.",
      });
  });
export type Asset = z.infer<typeof assetSchema>;
const playbackRateSchema = z
  .number()
  .finite()
  .min(MIN_PLAYBACK_RATE)
  .max(MAX_PLAYBACK_RATE);
export const clipSchema = z.object({
  id: z.string(),
  motionId: z.string(),
  // Scheduled seconds, independent of imported source playback speed.
  duration: z.number().min(0.2).max(60),
  playbackRate: playbackRateSchema.optional(),
  sourceStart: z.number().finite().min(0).optional(),
  // A standing wait retains sway within the take without accumulating its
  // small root displacement/facing into subsequent repeats or the next route.
  stationary: z.literal(true).optional(),
  // A routed imported take may retain an explicitly scheduled terminal hold.
  routeHold: z.number().finite().positive().max(60).optional(),
  // A route blocked while it was being played holds the pose it had this many
  // seconds into the clip. Planning records it when the block happens and
  // continues the destination on a following clip once a passage opens.
  routeStop: z.number().finite().positive().optional(),
  // A further frozen wait holds an earlier stopped route's evaluated pose.
  // Its duration advances the schedule without repeating that route's travel.
  routeWait: z.string().min(1).optional(),
  // The travelling time a stopped route was scheduled with before it was cut
  // at its stop; its distance-time mapping keeps using this, so the played
  // motion before the stop stays exactly as it was.
  routeActive: z.number().finite().positive().max(60).optional(),
  // Persist the visible migration notice until the user explicitly picks a rate.
  legacyFit: z.boolean().optional(),
  targetId: z.string().optional(),
  transition: z.enum(["smooth", "cut"]).optional(),
  // AI destination intent survives route regeneration and project reloads.
  navigation: z
    .object({
      targetId: z.string().min(1).optional(),
      // Preserve the authored standalone take. Geometry and travel are measured
      // only after its source and receiving character are loaded.
      native: z
        .object({
          motionId: z.string().min(1),
          duration: z.number().min(0.2).max(60),
          sourceStart: z.number().finite().min(0).optional(),
          playbackRate: playbackRateSchema,
          legacyFit: z.boolean().optional(),
        })
        .optional(),
      // Actor-local destination relative to this clip's starting frame.
      point: vec3
        .refine(
          (p) => Math.abs(p[1]) < 1e-6 && p.every((n) => Math.abs(n) <= 50),
          "Navigation destinations must stay level and within 50 meters.",
        )
        .optional(),
      endHeading: z.number().finite().min(-100).max(100).optional(),
      movement: z.enum(["walk", "run"]),
      // Measured body envelope in actor-local units, retained for stable replans.
      clearance: z.number().finite().min(0).max(100).optional(),
      // The original full route remains the source of destination/pace when a
      // captured arrival replaces its last segment with a separate source take.
      arrival: z
        .object({
          clipId: z.string().min(1),
          motionId: z.string().min(1),
          duration: z.number().min(0.2).max(60),
        })
        .optional(),
    })
    .refine(
      (intent) =>
        [intent.targetId, intent.point, intent.native].filter(Boolean)
          .length === 1 && !(intent.native && intent.arrival),
      "Choose exactly one object, point, or original imported performance.",
    )
    .optional(),
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
  // Per-character thinking effort; absent means the provider's saved setting.
  thinking: z.enum(thinkingLevels).optional(),
  // Voice for spoken playback ("provider:voice[#speaker]"); absent = automatic.
  voice: z.string().max(200).optional(),
  clips: z.array(clipSchema).max(100),
  ending: z.enum(["hold", "rest"]).optional(),
  setDressing: z.boolean().optional(),
});
export type Entity = z.infer<typeof entitySchema>;
export const dialogueLineSchema = z.object({
  characterId: z.string(),
  name: z.string(),
  text: z.string().max(8000),
  clipId: z.string().optional(),
  clipIds: z.array(z.string()).min(1).max(5).optional(),
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
    "room",
  ]),
  // Absent in legacy scenes; imported environments use the studio lighting/base.
  environmentAssetId: z.string().min(1).nullable().optional(),
  animationCollisions: z.boolean().default(true),
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
    playbackRate: playbackRateSchema.optional(),
    sourceStart: z.number().finite().min(0).optional(),
    targetId: z.string().optional(),
    transition: z.enum(["smooth", "cut"]).optional(),
  }),
  z.object({
    type: z.literal("removeClip"),
    id: z.string(),
    clipId: z.string(),
  }),
  // Change how long one action lasts; the actions after it follow. A
  // standalone imported take may also start later in its recording or play at
  // another speed. Values outside what the action allows are clamped.
  z.object({
    type: z.literal("retimeClip"),
    id: z.string(),
    clipId: z.string(),
    duration: z.number().finite().optional(),
    sourceStart: z.number().finite().min(0).optional(),
    playbackRate: z.number().finite().positive().optional(),
  }),
  // Delete one of the creator's own actions (imports, routes) and every clip
  // that plays it. Library recordings cannot be deleted.
  z.object({
    type: z.literal("deleteMotion"),
    motionId: z.string(),
  }),
  z.object({
    type: z.literal("deleteAsset"),
    assetId: z.string(),
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
      .pick({
        name: true,
        environment: true,
        environmentAssetId: true,
        animationCollisions: true,
        lighting: true,
        mission: true,
      })
      .partial(),
  }),
  z.object({ type: z.literal("createAsset"), asset: assetSchema }),
  // A measured sitting surface for one of the creator's own props.
  z.object({
    type: z.literal("setSeat"),
    assetId: z.string(),
    seat: seatSchema,
  }),
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
  "room",
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
      room: "Empty room",
    } as Record<string, string>
  )[id],
  style: id,
  color: "#b7c49c",
  skin: "#bf8866",
  body: "mannequin",
  category: "environments",
  description: "A complete set, ready for your story.",
}));
const legacyAssets = [
  ...characters,
  ...libraryCharacters,
  ...props,
  ...furnitureAssets,
  ...environments,
  ...setAssets,
];
export const assets = [...legacyAssets, ...contentAssets];
export const allAssets = (s: Scene) => [...assets, ...s.customAssets];
/** The staging of the scene's 3D set, when it has one. */
export const environmentSet = (s: Scene) =>
  allAssets(s).find((a) => a.id === s.environmentAssetId)?.set;
/** The only built-in still offered is the plain studio stage. The cartoon
 * characters, low-poly props and furniture, and code-built or furnished sets
 * are retired: a project that uses one still renders it, but the library,
 * new projects and the assistant no longer add them. */
export const retiredAssetIds: ReadonlySet<string> = new Set(
  legacyAssets.filter((a) => a.id !== "studio").map((a) => a.id),
);
export const offeredAssets = (s: Scene) =>
  allAssets(s).filter((a) => !retiredAssetIds.has(a.id));
export const allMotions = (s: Scene) => [
  ...capturedMotions,
  ...s.customMotions,
];
export const resolveMotionSource = (s: Scene, id: string | undefined) =>
  motionSources.find((source) => source.id === id) ??
  allAssets(s).find((a) => a.id === id);
export function applyCommands(
  scene: Scene,
  input: unknown,
  options: {
    deferInteractionTiming?: boolean;
    /** The loaded 3D set's furniture, so new cast members appear clear of it. */
    floorBlocked?: FloorBlocked;
  } = {},
): Scene {
  const commands = z.array(commandSchema).max(100).parse(input);
  const s = structuredClone(scene);
  // Freeze legacy fit speed before applying duration edits to a raw old scene.
  materializeImportedClipTiming(s);
  const find = (id: string) => {
    const e = s.entities.find((e) => e.id === id);
    if (!e) throw Error("That scene object no longer exists.");
    return e;
  };
  const detachTargets = (ids: Set<string>) => {
    for (const entity of s.entities) {
      let removedSeat = false;
      for (const clip of entity.clips) {
        const motion = allMotions(s).find((m) => m.id === clip.motionId);
        const kind = motion?.role;
        if (clip.targetId && ids.has(clip.targetId)) {
          if (kind === "sit") clip.motionId = "idle";
          // A seated take plays on without its seat; the Stand up that
          // followed has nothing to rise from either way.
          if (kind === "sit" || seatedRecording(motion)) removedSeat = true;
          delete clip.targetId;
        }
        if (kind === "stand" && removedSeat) {
          clip.motionId = "idle";
          removedSeat = false;
        }
      }
    }
  };
  const clearDressing = () => {
    const ids = new Set(
      s.entities
        .filter((entity) => entity.setDressing)
        .map((entity) => entity.id),
    );
    s.entities = s.entities.filter((entity) => !ids.has(entity.id));
    detachTargets(ids);
  };
  // The furniture the caller knows belongs to the set loaded now; once a
  // command changes the set, nothing is known about the new one's.
  let floorBlocked = options.floorBlocked;
  // A 3D set replaces the stage: cast members left off its floor plan (at
  // their studio spots, inside its walls or its furniture) step onto free
  // floor near its spawn point, facing its heading. Its furniture is known
  // only from the plan until the model loads, so a set without a walkable
  // outline can still leave someone in a piece of furniture.
  const stepOntoSet = () => {
    floorBlocked = undefined;
    const set = environmentSet(s);
    if (!set) return;
    const stays = (entity: Entity) =>
      allAssets(s).find((asset) => asset.id === entity.assetId)?.category !==
        "characters" ||
      Math.abs(entity.position[1]) > FLOOR_TOP ||
      standsOnFloor(set, entity.position[0], entity.position[2]);
    const taken = s.entities.filter(stays).map((entity) => entity.position);
    for (const entity of s.entities.filter((entity) => !stays(entity))) {
      entity.position = freeSpot(set, taken);
      entity.rotation = set.heading;
      taken.push(entity.position);
    }
  };
  for (const cmd of commands) {
    if (cmd.type === "add") {
      const a = allAssets(s).find((a) => a.id === cmd.assetId);
      if (!a) throw Error("Asset not found.");
      if (a.category === "environments") {
        clearDressing();
        s.environment =
          a.url || a.hdri ? "studio" : (a.style as Scene["environment"]);
        if (a.url || a.hdri) s.environmentAssetId = a.id;
        else delete s.environmentAssetId;
        stepOntoSet();
        const layout = setLayout(a.id);
        if (layout) {
          for (const placed of layout.props) {
            const source = allAssets(s).find(
              (asset) => asset.id === placed.assetId,
            );
            if (!source || source.category !== "props")
              throw Error("A prop for this set is missing.");
            s.entities.push({
              id: uid(),
              assetId: source.id,
              name: source.name,
              position: [...placed.position],
              rotation: placed.rotation,
              scale: placed.scale,
              color: source.color,
              visible: true,
              personality: "",
              provider: null,
              model: "",
              clips: [],
              setDressing: true,
            });
          }
        }
        continue;
      }
      // In a 3D set the cast appears at its spawn point, facing its heading,
      // and a chosen spot is kept on the set's open floor.
      const set = environmentSet(s);
      s.entities.push({
        id: cmd.id || uid(),
        assetId: a.id,
        name: cmd.name || a.name,
        position: cmd.position
          ? keepOnSetFloor(set, cmd.position)
          : spawnPosition(set, s.entities, floorBlocked),
        rotation: set?.heading ?? 0,
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
    if (cmd.type === "update") {
      const entity = find(cmd.id);
      if (cmd.changes.clips)
        cmd.changes.clips = cmd.changes.clips.map((clip) => {
          const motion = allMotions(s).find((m) => m.id === clip.motionId);
          if (motion?.kind !== "imported") {
            // Route edits may keep the clip/motion IDs while switching gait.
            // Neither carried nor explicitly spread imported timing belongs on
            // the resulting procedural action.
            delete clip.playbackRate;
            delete clip.legacyFit;
            delete clip.sourceStart;
            delete clip.stationary;
            return clip;
          }
          const previous = entity.clips.find(
            (old) => old.id === clip.id && old.motionId === clip.motionId,
          );
          if (motion.path) {
            delete clip.sourceStart;
            delete clip.stationary;
          } else {
            clip.sourceStart ??= previous?.sourceStart;
            clip.stationary ??= previous?.stationary;
          }
          // Old callers may send only id/motionId/duration. Preserve a rate
          // already materialized on the matching imported clip, never refit it.
          return clip.playbackRate === undefined
            ? {
                ...clip,
                playbackRate: previous?.playbackRate ?? 1,
                legacyFit: previous?.legacyFit,
              }
            : clip;
        });
      Object.assign(entity, cmd.changes);
    }
    if (cmd.type === "remove") {
      find(cmd.id);
      s.entities = s.entities.filter((e) => e.id !== cmd.id);
      detachTargets(new Set([cmd.id]));
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
        ...(m.kind === "imported"
          ? { playbackRate: cmd.playbackRate ?? 1 }
          : cmd.playbackRate !== undefined
            ? { playbackRate: cmd.playbackRate }
            : {}),
        targetId: cmd.targetId,
        sourceStart: cmd.sourceStart,
        transition: cmd.transition || "smooth",
      });
    }
    if (cmd.type === "removeClip") {
      const e = find(cmd.id);
      e.clips = e.clips.filter(
        (c) => c.id !== cmd.clipId && c.routeWait !== cmd.clipId,
      );
    }
    if (cmd.type === "retimeClip") {
      const e = find(cmd.id);
      const clip = e.clips.find((c) => c.id === cmd.clipId);
      if (!clip) throw Error("That action is no longer in the sequence.");
      if (clip.routeWait)
        throw Error(
          "This action waits in a stopped pose. Its length follows the route it waits for.",
        );
      const motion = allMotions(s).find((m) => m.id === clip.motionId);
      if (cmd.duration !== undefined) {
        // A route keeping a saved terminal hold must still travel for a moment.
        const hold =
          clip.routeStop === undefined && clip.routeHold !== undefined
            ? clip.routeHold + 0.2
            : 0;
        const seconds = Math.min(
          60,
          Math.max(0.2, clip.routeStop ?? 0, hold, cmd.duration),
        );
        // A stopped route keeps the travelling time it was cut from; whatever
        // the slot has beyond it holds the stopped pose.
        if (clip.routeStop !== undefined && motion?.path) {
          const active = routeActiveDuration(clip);
          clip.routeActive = active;
          if (seconds > active) clip.routeHold = seconds - active;
          else delete clip.routeHold;
        }
        clip.duration = seconds;
      }
      if (motion?.kind === "imported" && !motion.path) {
        // Leave at least a moment of the recording to play.
        if (cmd.sourceStart !== undefined)
          clip.sourceStart = Math.min(
            cmd.sourceStart,
            Math.max(0, motion.duration - 0.001),
          );
        if (cmd.playbackRate !== undefined) {
          clip.playbackRate = Math.min(
            MAX_PLAYBACK_RATE,
            Math.max(MIN_PLAYBACK_RATE, cmd.playbackRate),
          );
          delete clip.legacyFit;
        }
      }
    }
    const dropMotion = (motion: Motion) => {
      s.customMotions = s.customMotions.filter((m) => m !== motion);
      for (const e of s.entities) {
        const removed = new Set(
          e.clips
            .filter(
              (c) =>
                c.motionId === motion.id ||
                c.navigation?.native?.motionId === motion.id ||
                c.navigation?.arrival?.motionId === motion.id,
            )
            .map((c) => c.id),
        );
        e.clips = e.clips.filter(
          (c) =>
            !removed.has(c.id) && !(c.routeWait && removed.has(c.routeWait)),
        );
      }
    };
    if (cmd.type === "deleteMotion") {
      const motion = s.customMotions.find((m) => m.id === cmd.motionId);
      if (!motion) throw Error("Only your own actions can be deleted.");
      dropMotion(motion);
      // An animation-only source goes with its last action.
      const source = s.customAssets.find((a) => a.id === motion.sourceAssetId);
      if (
        source?.motionOnly &&
        !s.entities.some((e) => e.assetId === source.id) &&
        !s.customMotions.some((m) => m.sourceAssetId === source.id)
      )
        s.customAssets = s.customAssets.filter((a) => a !== source);
    }
    if (cmd.type === "deleteAsset") {
      const asset = s.customAssets.find((a) => a.id === cmd.assetId);
      if (!asset) throw Error("Only your own imports can be deleted.");
      // Its actors and the actions recorded on its skeleton go with it.
      for (const motion of s.customMotions.filter(
        (m) => m.sourceAssetId === asset.id,
      ))
        dropMotion(motion);
      const actors = new Set(
        s.entities.filter((e) => e.assetId === asset.id).map((e) => e.id),
      );
      s.entities = s.entities.filter((e) => !actors.has(e.id));
      detachTargets(actors);
      s.customAssets = s.customAssets.filter((a) => a !== asset);
    }
    if (cmd.type === "reorderClip") {
      const e = find(cmd.id),
        i = e.clips.findIndex((c) => c.id === cmd.clipId);
      const step = cmd.direction === "earlier" ? -1 : 1;
      let j = i + step;
      const anchor = (clip: (typeof e.clips)[number]) =>
        clip.routeWait ?? clip.id;
      // A route and the clips holding its stopped pose move together. Moving
      // a wait ahead of its source would otherwise leave a dangling reference.
      while (
        i >= 0 &&
        j >= 0 &&
        j < e.clips.length &&
        anchor(e.clips[i]) === anchor(e.clips[j])
      )
        j += step;
      if (i >= 0 && j >= 0 && j < e.clips.length) {
        // Clips of one dialogue line stay contiguous so its caption span
        // cannot overlap another line: within a line the two clips swap,
        // across a boundary the whole line moves past the neighbouring block.
        const group = (clip: (typeof e.clips)[number]) => {
          const id = anchor(clip);
          const line = s.transcript.findIndex(
            (l) =>
              l.characterId === e.id &&
              (l.clipIds ?? (l.clipId ? [l.clipId] : [])).includes(id),
          );
          return line >= 0 ? `line:${line}` : `clip:${id}`;
        };
        const groups = e.clips.map(group);
        if (groups[i] === groups[j])
          [e.clips[i], e.clips[j]] = [e.clips[j], e.clips[i]];
        else {
          let start = i,
            end = i;
          while (start > 0 && groups[start - 1] === groups[i]) start--;
          while (end + 1 < groups.length && groups[end + 1] === groups[i])
            end++;
          const block = e.clips.splice(start, end - start + 1);
          if (cmd.direction === "earlier") {
            let at = start - 1;
            while (at > 0 && groups[at - 1] === groups[start - 1]) at--;
            e.clips.splice(at, 0, ...block);
          } else {
            let at = end + 1;
            while (at + 1 < groups.length && groups[at + 1] === groups[end + 1])
              at++;
            e.clips.splice(at - block.length + 1, 0, ...block);
          }
        }
      }
    }
    if (cmd.type === "scene") {
      const changes = cmd.changes;
      if (
        (changes.environment &&
          (changes.environment !== s.environment || s.environmentAssetId)) ||
        (changes.environmentAssetId !== undefined &&
          changes.environmentAssetId !== s.environmentAssetId)
      )
        clearDressing();
      // An explicit built-in selection clears an imported set, even when the
      // underlying built-in style was already studio.
      if (changes.environment && changes.environmentAssetId === undefined)
        delete s.environmentAssetId;
      Object.assign(s, changes);
      if (changes.environmentAssetId) s.environment = "studio";
      if (changes.environment || changes.environmentAssetId !== undefined)
        stepOntoSet();
    }
    if (cmd.type === "setSeat") {
      const asset = s.customAssets.find((a) => a.id === cmd.assetId);
      if (asset?.category !== "props")
        throw Error("Only your own props can be given a sitting surface.");
      asset.seat = cmd.seat;
    }
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
      if (
        s.customMotions[index].kind === "imported" &&
        cmd.motion.kind !== "imported"
      )
        for (const entity of s.entities)
          for (const clip of entity.clips)
            if (clip.motionId === cmd.motion.id) {
              delete clip.playbackRate;
              delete clip.legacyFit;
              delete clip.sourceStart;
              delete clip.stationary;
            }
      if (cmd.motion.path)
        for (const entity of s.entities)
          for (const clip of entity.clips)
            if (clip.motionId === cmd.motion.id) {
              delete clip.sourceStart;
              delete clip.stationary;
            }
      s.customMotions[index] = cmd.motion;
    }
    if (cmd.type === "clear") {
      s.entities = [];
      s.transcript = [];
    }
  }
  // Keep dialogue as editable history if its character/action is removed.
  for (const line of s.transcript) {
    const actor = s.entities.find((e) => e.id === line.characterId);
    if (line.clipIds) {
      const remaining = line.clipIds.filter((id) =>
        actor?.clips.some((c) => c.id === id),
      );
      if (remaining.length) {
        line.clipIds = remaining;
        line.clipId = remaining[0];
      } else {
        delete line.clipIds;
        delete line.clipId;
      }
    } else if (line.clipId && !actor?.clips.some((c) => c.id === line.clipId))
      delete line.clipId;
  }
  // Explicit edits release an automatic approach/stop pair. Preserve ordinary
  // scene edits and appended actions, but never regenerate over changed clips.
  for (const actor of s.entities) {
    const before = scene.entities.find((e) => e.id === actor.id);
    for (const clip of actor.clips) {
      const old = before?.clips.find((c) => c.id === clip.id);
      if (old?.navigation?.native && clip.navigation?.native) {
        const selected = allMotions(s).find((m) => m.id === clip.motionId);
        if (selected?.kind === "imported" && !selected.path) {
          clip.navigation.native = {
            motionId: clip.motionId,
            duration: clip.duration,
            playbackRate:
              clip.playbackRate ??
              (clip.sourceStart === undefined
                ? selected.duration / clip.duration
                : 1),
            ...(clip.sourceStart !== undefined
              ? { sourceStart: clip.sourceStart }
              : {}),
            ...(clip.legacyFit ? { legacyFit: true } : {}),
          };
        } else {
          const { navigation: _oldIntent, ...oldPerformance } = old;
          const { navigation: _intent, ...performance } = clip;
          if (
            JSON.stringify(oldPerformance) !== JSON.stringify(performance) ||
            JSON.stringify(
              allMotions(scene).find((m) => m.id === old.motionId),
            ) !== JSON.stringify(selected)
          )
            delete clip.navigation;
        }
      }
      const arrival = old?.navigation?.arrival;
      if (!arrival || !clip.navigation?.arrival) continue;
      const oldStop = before!.clips.find((c) => c.id === arrival.clipId);
      const stop = actor.clips[actor.clips.indexOf(clip) + 1];
      const performance = (c: Entity["clips"][number]) => {
        const { navigation: _navigation, ...pose } = c;
        return pose;
      };
      const changed =
        JSON.stringify(performance(old!)) !==
          JSON.stringify(performance(clip)) ||
        JSON.stringify(oldStop) !== JSON.stringify(stop) ||
        [old!.motionId, oldStop?.motionId, arrival.motionId].some(
          (id) =>
            JSON.stringify(allMotions(scene).find((m) => m.id === id)) !==
            JSON.stringify(allMotions(s).find((m) => m.id === id)),
        );
      if (changed) delete clip.navigation;
    }
  }
  return validateScene(s, options);
}
/** Scenes saved before every action was recorded referenced studio actions
 * whose bodies were computed by formulas. Their ids now name recordings with
 * the same role; this rewrites everything else that depended on formulas:
 * - clips of those actions play the recording at its own speed;
 * - formula Walk/Run clips that travelled a set distance become straight
 *   routes on the recorded walking/running stride;
 * - formula-gait routes use the recorded stride (backward ones the recorded
 *   backward walk);
 * - assistant-made keyframe actions are replaced by recorded standing. */
/** The retired stylized clips and the recording each one now plays. */
const stylizedAliases: Record<string, string> = {
  "authored-idle": "idle",
  "authored-walk": "walk",
  "authored-run": "run",
  "authored-jump": "jump",
  "authored-roll": "jump",
  "authored-walk-carry": "walk",
  "authored-run-carry": "run",
  "authored-sit-down": "sit",
  // Stand up requires a targeted Sit down; the stylized one was a pose.
  "authored-stand-up": "captured-139-16",
  "authored-pick-up": "pick",
  "authored-victory": "captured-80-43",
  "authored-defeat": "captured-80-45",
  "authored-death": "captured-139-09",
  "authored-recieve-hit": "captured-139-09",
  "authored-punch": "captured-143-23",
  "authored-sword-slash": "captured-143-23",
  "authored-shoot-one-handed": "idle",
};
function migrateLegacyMotions(scene: Scene) {
  const legacy = new Set<string>(actionRoles);
  const replaced = new Map<string, string>();
  const travel = new Map<string, number>();
  // Props travel along routes without a body; only characters get a gait.
  const performed = new Set(
    scene.entities
      .filter(
        (e) =>
          allAssets(scene).find((a) => a.id === e.assetId)?.category ===
          "characters",
      )
      .flatMap((e) => e.clips.map((c) => c.motionId)),
  );
  const stride = (kind: string, backward?: boolean) =>
    backward
      ? capturedMotions.find((m) => m.animationName === "143_39")!
      : capturedRouteGaits[kind === "run" ? 1 : 0];
  scene.customMotions = scene.customMotions.flatMap((motion) => {
    // Copies of the retired stylized clips: routes take a recorded stride,
    // everything else the closest recording.
    if (
      motion.kind === "imported" &&
      motion.sourceAssetId === motionSource.id
    ) {
      if (!motion.path) {
        const stylized = libraryMotions.find(
          (m) => m.animationName === motion.animationName,
        );
        replaced.set(motion.id, stylizedAliases[stylized?.id ?? ""] ?? "idle");
        return [];
      }
      const gait = stride(
        /run/i.test(motion.animationName ?? "") ? "run" : "walk",
      );
      return [
        {
          ...motion,
          sourceAssetId: gait.sourceAssetId,
          animationName: gait.animationName,
          path: {
            ...motion.path,
            ...(gait.path?.sourceRange
              ? { sourceRange: { ...gait.path.sourceRange } }
              : { sourceRange: undefined }),
          },
        },
      ];
    }
    if (motion.kind === "imported") return [motion];
    if (motion.path && !performed.has(motion.id)) return [motion];
    if (motion.kind === "custom" || !motion.path) {
      replaced.set(
        motion.id,
        motion.kind === "custom" ? "idle" : (motion.kind as string),
      );
      if (motion.distance) travel.set(motion.id, motion.distance);
      return [];
    }
    const gait = stride(motion.kind, motion.path.backward);
    const { backward: _backward, ...path } = motion.path;
    return [
      {
        ...motion,
        kind: "imported" as const,
        role: undefined,
        distance: 0,
        poses: [],
        sourceAssetId: gait.sourceAssetId,
        animationName: gait.animationName,
        path: {
          ...path,
          ...(gait.path?.sourceRange
            ? { sourceRange: { ...gait.path.sourceRange } }
            : {}),
        },
      },
    ];
  });
  for (const entity of scene.entities)
    for (const clip of entity.clips) {
      const own = travel.get(clip.motionId);
      clip.motionId =
        replaced.get(clip.motionId) ??
        capturedRoleAliases[clip.motionId] ??
        stylizedAliases[clip.motionId] ??
        clip.motionId;
      if (!legacy.has(clip.motionId) || clip.playbackRate !== undefined)
        continue;
      // Formula clips had no playback rate: the recording keeps its speed.
      clip.playbackRate = 1;
      if (clip.motionId !== "walk" && clip.motionId !== "run") continue;
      const distance = own ?? (clip.motionId === "run" ? 3 : 2),
        gait = stride(clip.motionId, distance < 0);
      const base = `recorded-route-${entity.id}-${clip.id}`;
      let id = base,
        suffix = 2;
      while (scene.customMotions.some((m) => m.id === id))
        id = `${base}-${suffix++}`;
      scene.customMotions.push({
        ...gait,
        id,
        name: clip.motionId === "run" ? "Run" : "Walk",
        duration: clip.duration,
        path: {
          points: [
            [0, 0, 0],
            [0, 0, distance],
          ],
          smooth: false,
          ...(gait.path?.sourceRange
            ? { sourceRange: { ...gait.path.sourceRange } }
            : {}),
        },
      });
      clip.motionId = id;
    }
}
/** Preserve old fitted takes as a fixed, visible speed, never a dynamic stretch. */
function materializeImportedClipTiming(scene: Scene) {
  const motionMap = new Map(
    allMotions(scene).map((motion) => [motion.id, motion]),
  );
  for (const entity of scene.entities)
    for (const clip of entity.clips) {
      const motion = motionMap.get(clip.motionId);
      if (motion?.kind !== "imported") continue;
      if (motion.path) {
        // Routes were introduced with distance-driven gait playback. Their
        // duration schedules travel; it has never represented a source fit.
        clip.playbackRate ??= 1;
        delete clip.legacyFit;
      } else if (clip.playbackRate === undefined) {
        // Source ranges did not exist in legacy fitted scenes. A newly defined
        // range without a rate uses native speed, never an implicit range fit.
        clip.playbackRate =
          clip.sourceStart !== undefined ? 1 : motion.duration / clip.duration;
        if (clip.sourceStart === undefined) clip.legacyFit = true;
        else delete clip.legacyFit;
      }
    }
}

export function validateScene(
  input: unknown,
  options: { deferInteractionTiming?: boolean } = {},
): Scene {
  const s = sceneSchema.parse(input);
  migrateLegacyMotions(s);
  materializeImportedClipTiming(s);
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (
    !unique(s.entities.map((e) => e.id)) ||
    !unique([
      ...allAssets(s).map((a) => a.id),
      ...motionSources.map((source) => source.id),
    ]) ||
    !unique(allMotions(s).map((m) => m.id))
  )
    throw Error("Duplicate IDs in scene.");
  if (s.environmentAssetId) {
    // An imported model, or a photographic library set.
    const environment = [...s.customAssets, ...contentAssets].find(
      (asset) => asset.id === s.environmentAssetId,
    );
    if (
      !environment ||
      environment.category !== "environments" ||
      !(environment.url || environment.hdri)
    )
      throw Error(
        "The imported environment must reference a custom environment asset with a model URL, or a photographic library set.",
      );
    if (s.environment !== "studio")
      throw Error("Imported environments use the studio base.");
  }
  for (const e of s.entities) {
    if (!allAssets(s).some((a) => a.id === e.assetId))
      throw Error("Unknown asset in scene.");
    if (!unique(e.clips.map((c) => c.id))) throw Error("Duplicate clip IDs.");
    for (const c of e.clips) {
      if (!allMotions(s).some((m) => m.id === c.motionId))
        throw Error("Unknown action in scene.");
      const motion = allMotions(s).find((m) => m.id === c.motionId)!;
      if (
        c.stationary &&
        (motion.kind !== "imported" || motion.path || c.navigation)
      )
        throw Error(
          "A stationary wait requires a standalone imported performance without navigation.",
        );
      if (c.routeWait !== undefined) {
        const index = e.clips.indexOf(c);
        const stopped = e.clips
          .slice(0, index)
          .find((p) => p.id === c.routeWait);
        if (
          !stopped ||
          stopped.routeStop === undefined ||
          stopped.motionId !== c.motionId ||
          c.navigation ||
          c.routeStop !== undefined
        )
          throw Error(
            "A frozen wait must reference an earlier stopped clip of the same action.",
          );
      }
      // Imported routes schedule holds explicitly; a studio route only holds
      // after stopping before an obstacle, which planning schedules itself.
      if (
        c.routeHold !== undefined &&
        (!motion.path ||
          (motion.kind !== "imported" && c.routeStop === undefined) ||
          c.routeHold >= c.duration)
      )
        throw Error(
          "A route hold requires an imported route and positive travelling time.",
        );
      // An authored imported performance can stop part-way too (and a wait
      // holds a frame that way); its travelling time is its own source clock,
      // so only a route records one.
      if (
        (c.routeStop !== undefined || c.routeActive !== undefined) &&
        ((!motion.path && motion.kind !== "imported") ||
          c.routeStop === undefined ||
          c.routeStop > c.duration + 1e-9 ||
          (c.routeActive !== undefined &&
            (!motion.path || c.routeActive < c.routeStop - 1e-9)))
      )
        throw Error(
          "A stopped route needs a stop within its duration and its original travelling time.",
        );
      if (c.navigation?.native) {
        const original = allMotions(s).find(
          (m) => m.id === c.navigation!.native!.motionId,
        );
        if (
          motion.kind !== "imported" ||
          original?.kind !== "imported" ||
          original.path ||
          original.sourceAssetId !== motion.sourceAssetId ||
          original.animationName !== motion.animationName
        )
          throw Error(
            "Native navigation must retain the original imported source performance.",
          );
      }
      if (c.navigation?.arrival) {
        const pair = c.navigation.arrival;
        const stop = e.clips[e.clips.indexOf(c) + 1];
        const full = allMotions(s).find((m) => m.id === pair.motionId);
        const tail = allMotions(s).find((m) => m.id === stop?.motionId);
        if (
          motion.kind !== "imported" ||
          !motion.path ||
          full?.kind !== "imported" ||
          !full.path ||
          pair.motionId === c.motionId ||
          stop?.id !== pair.clipId ||
          stop.navigation ||
          stop.sourceStart === undefined ||
          tail?.kind !== "imported" ||
          tail.path ||
          ![full, tail].every(
            (m) =>
              m.sourceAssetId === motion.sourceAssetId &&
              m.animationName === motion.animationName,
          )
        )
          throw Error(
            "A captured arrival needs its original route and adjacent stopping take.",
          );
      }
      if (
        c.sourceStart !== undefined &&
        (motion.kind !== "imported" ||
          !!motion.path ||
          c.sourceStart >= motion.duration)
      )
        throw Error(
          "Choose a source start before the end of an imported action. For a distance-paced route, select its source range on the path.",
        );
      if (
        motion.kind !== "imported" &&
        (c.playbackRate !== undefined || c.legacyFit)
      )
        throw Error("Playback speed is available only for imported actions.");
      if (motion.kind === "imported") {
        const source = resolveMotionSource(s, motion.sourceAssetId);
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
      if (c.targetId && (motion.role === "sit" || seatedRecording(motion))) {
        const target = s.entities.find((t) => t.id === c.targetId)!;
        const targetAsset = allAssets(s).find((a) => a.id === target.assetId)!;
        if (
          allAssets(s).find((a) => a.id === e.assetId)?.category !==
            "characters" ||
          targetAsset.category !== "props" ||
          !seatProfile(targetAsset)
        )
          throw Error(
            "Choose a character and a seat with a known sitting surface.",
          );
        if (target.clips.length)
          throw Error("Keep the seat still during a seated performance.");
      }
      if (
        c.targetId &&
        allMotions(s).find((m) => m.id === c.motionId)!.role === "climb"
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
          allMotions(s).find((m) => m.id === c.motionId)!.role ?? "",
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
  const linked = s.transcript.flatMap((line) =>
    (line.clipIds || (line.clipId ? [line.clipId] : [])).map((id) => ({
      characterId: line.characterId,
      clipId: id,
    })),
  );
  if (
    s.transcript.some(
      (line) =>
        line.clipIds && (!line.clipId || !line.clipIds.includes(line.clipId)),
    )
  )
    throw Error("The dialogue’s first action must belong to its performance.");
  if (!unique(linked.map((line) => `${line.characterId}:${line.clipId}`)))
    throw Error("An action can have only one dialogue line.");
  for (const line of linked)
    if (
      !s.entities
        .find((e) => e.id === line.characterId)
        ?.clips.some((c) => c.id === line.clipId)
    )
      throw Error("Missing dialogue action.");
  validateSeating(s, allMotions(s), options.deferInteractionTiming);
  if (!options.deferInteractionTiming) interactionSessions(s, allMotions(s));
  return s;
}
export const duration = (s: Scene) =>
  Math.max(
    12,
    ...s.entities.map((e) => e.clips.reduce((t, c) => t + c.duration, 0)),
  );
/** A new creator project: the plain studio stage, no cast. */
export function blankScene(): Scene {
  return {
    version: 1,
    id: uid(),
    revision: 0,
    name: "Untitled scene",
    environment: "studio",
    animationCollisions: true,
    lighting: "daylight",
    mission: "",
    entities: [],
    customAssets: [],
    customMotions: [],
    transcript: [],
  };
}
/** The retired cartoon café scene, kept as a fixture for tests. */
export function starterScene(): Scene {
  let s: Scene = {
    version: 1,
    id: uid(),
    revision: 0,
    name: "A chance encounter",
    environment: "cafe",
    animationCollisions: true,
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
