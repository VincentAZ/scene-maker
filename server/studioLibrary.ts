import fs from "node:fs";
import path from "node:path";
import { assets, type Scene } from "../shared/scene";
import {
  libraryMotions,
  capturedMotions,
  motionSources,
} from "../shared/motionLibrary";
import {
  emptyStudioLibrary,
  studioLibrarySchema,
  type StudioLibrary,
} from "../shared/studioLibrary";
import { dataDir, listProjects, readProject } from "./storage";

const removedFile = () => path.join(dataDir, "library-removed.json");
/** Imports the creator removed from their library. Projects that still use
 * one keep it; the library just stops offering it. */
export function readRemovedFromLibrary(): Set<string> {
  try {
    const ids = JSON.parse(fs.readFileSync(removedFile(), "utf8"));
    return new Set(Array.isArray(ids) ? ids.map(String) : []);
  } catch {
    return new Set();
  }
}
export function removeFromLibrary(ids: string[]) {
  const removed = readRemovedFromLibrary();
  for (const id of ids) removed.add(id);
  fs.writeFileSync(removedFile(), JSON.stringify([...removed], null, 2));
}

/** Read-only, private catalog of the newest available saved definitions. */
export function readStudioLibrary(): StudioLibrary {
  const library = emptyStudioLibrary();
  const removed = readRemovedFromLibrary();
  const projects: Scene[] = [];
  for (const project of listProjects()) {
    try {
      projects.push(readProject(project.id));
    } catch (error) {
      // A project may be removed or replaced between listing and reading it.
      console.warn(
        `Skipping library project ${project.id}: ${(error as Error).message}`,
      );
    }
  }
  const assetIds = new Set([
    ...assets.map((asset) => asset.id),
    ...motionSources.map((source) => source.id),
  ]);
  const motionIds = new Set(
    [...libraryMotions, ...capturedMotions].map((motion) => motion.id),
  );
  for (const project of projects) {
    for (const asset of project.customAssets) {
      if (assetIds.has(asset.id) || removed.has(asset.id)) continue;
      if (asset.url?.startsWith("/uploads/")) {
        try {
          if (
            !fs
              .statSync(path.join(dataDir, "uploads", path.basename(asset.url)))
              .isFile()
          )
            continue;
        } catch {
          // Do not advertise stale upload definitions to fresh projects.
          continue;
        }
      }
      library.assets.push(asset);
      assetIds.add(asset.id);
    }
  }
  const sources = new Map(
    [...library.assets, ...assets, ...motionSources].map((asset) => [
      asset.id,
      asset,
    ]),
  );
  for (const project of projects) {
    for (const motion of project.customMotions) {
      if (motionIds.has(motion.id) || removed.has(motion.id)) continue;
      if (motion.kind === "imported") {
        const source = sources.get(motion.sourceAssetId!);
        if (source?.category !== "characters" || !source.url) continue;
      }
      library.motions.push(motion);
      motionIds.add(motion.id);
    }
  }
  return studioLibrarySchema.parse(library);
}
