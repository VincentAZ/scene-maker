import fs from "node:fs";
import path from "node:path";
import { assets, motions, type Scene } from "../shared/scene";
import { libraryMotions, motionSource } from "../shared/motionLibrary";
import {
  emptyStudioLibrary,
  studioLibrarySchema,
  type StudioLibrary,
} from "../shared/studioLibrary";
import { dataDir, listProjects, readProject } from "./storage";

/** Read-only, private catalog of the newest available saved definitions. */
export function readStudioLibrary(): StudioLibrary {
  const library = emptyStudioLibrary();
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
    motionSource.id,
  ]);
  const motionIds = new Set(
    [...motions, ...libraryMotions].map((motion) => motion.id),
  );
  for (const project of projects) {
    for (const asset of project.customAssets) {
      if (assetIds.has(asset.id)) continue;
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
    [...library.assets, ...assets, motionSource].map((asset) => [
      asset.id,
      asset,
    ]),
  );
  for (const project of projects) {
    for (const motion of project.customMotions) {
      if (motionIds.has(motion.id)) continue;
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
