import { z } from "zod";
import {
  allAssets,
  allMotions,
  applyCommands,
  assetSchema,
  assets,
  motionSchema,
  type Asset,
  type Command,
  type Motion,
  type Scene,
} from "./scene";
import { motionSources } from "./motionLibrary";

export type StudioLibrary = {
  version: 1;
  assets: Asset[];
  motions: Motion[];
};

/** A catalog is not a scene: it may contain more than 100 definitions. */
export const studioLibrarySchema = z
  .object({
    version: z.literal(1),
    assets: z.array(assetSchema),
    motions: z.array(motionSchema),
  })
  .superRefine((library, context) => {
    for (const key of ["assets", "motions"] as const) {
      const ids = library[key].map((entry) => entry.id);
      if (new Set(ids).size !== ids.length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Studio library IDs must be unique.",
        });
    }
    const sources = new Map(
      [...library.assets, ...assets, ...motionSources].map((asset) => [
        asset.id,
        asset,
      ]),
    );
    library.motions.forEach((motion, index) => {
      if (motion.kind !== "imported") return;
      const source = sources.get(motion.sourceAssetId!);
      if (source?.category !== "characters" || !source.url)
        context.addIssue({
          code: "custom",
          path: ["motions", index, "sourceAssetId"],
          message: "Imported actions need a source character with a model URL.",
        });
    });
  });

export function emptyStudioLibrary(): StudioLibrary {
  return { version: 1, assets: [], motions: [] };
}

function unionById<T extends { id: string }>(current: T[], catalog: T[]): T[] {
  const seen = new Set<string>();
  return [...current, ...catalog].filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
}

/** Project definitions win over a newer saved project's catalog version. */
export function studioLibraryAssets(
  scene: Scene,
  library: StudioLibrary,
): Asset[] {
  return unionById(allAssets(scene), library.assets);
}

export function studioLibraryMotions(
  scene: Scene,
  library: StudioLibrary,
): Motion[] {
  return unionById(allMotions(scene), library.motions);
}

/**
 * Register only the selected definitions and imported-action dependencies.
 * Never place a source rig, replace a project definition, or mutate the input.
 * Validate the whole batch before returning so capacity failures are atomic.
 */
export function studioLibraryCommands(
  scene: Scene,
  library: StudioLibrary,
  selection: { assetIds?: string[]; motionIds?: string[] },
): Command[] {
  const catalog = studioLibrarySchema.parse(library);
  const availableAssets = new Map(
    studioLibraryAssets(scene, catalog).map((asset) => [asset.id, asset]),
  );
  const availableMotions = new Map(
    studioLibraryMotions(scene, catalog).map((motion) => [motion.id, motion]),
  );
  const registeredAssets = new Set(allAssets(scene).map((asset) => asset.id));
  const registeredMotions = new Set(
    allMotions(scene).map((motion) => motion.id),
  );
  const commands: Command[] = [];
  const registerAsset = (id: string) => {
    const asset = availableAssets.get(id);
    if (!asset) throw Error(`Unknown studio library asset: ${id}`);
    if (motionSources.some((source) => id === source.id))
      throw Error("The bundled action source is not a placeable asset.");
    if (!registeredAssets.has(id)) {
      commands.push({ type: "createAsset", asset: structuredClone(asset) });
      registeredAssets.add(id);
    }
  };
  for (const id of selection.assetIds ?? []) registerAsset(id);
  for (const id of selection.motionIds ?? []) {
    const motion = availableMotions.get(id);
    if (!motion) throw Error(`Unknown studio library motion: ${id}`);
    if (motion.kind === "imported") {
      const source =
        motionSources.find((source) => motion.sourceAssetId === source.id) ??
        availableAssets.get(motion.sourceAssetId!);
      if (source?.category !== "characters" || !source.url)
        throw Error(
          "Imported actions need a source character with a model URL.",
        );
      if (!motionSources.some((entry) => source.id === entry.id))
        registerAsset(source.id);
    }
    if (!registeredMotions.has(id)) {
      commands.push({ type: "createMotion", motion: structuredClone(motion) });
      registeredMotions.add(id);
    }
  }
  if (commands.length > 100)
    throw Error(
      "Select fewer library items at once (maximum 100 registrations).",
    );
  applyCommands(scene, commands);
  return commands;
}
