import JSZip from "jszip";
import { dialogueSubtitles } from "../shared/conversation";
import { allMotions, type Scene } from "../shared/scene";
import { motionSource } from "../shared/motionLibrary";
import {
  libraryCharacters,
  libraryAssetURLs,
} from "../shared/characterLibrary";
import { furnitureAssets, furnitureURLs } from "../shared/furnitureLibrary";

const adapters = {
  "blender_import.py": "blender_import.py",
  "unreal_import.py": "unreal_import.py",
  "unreal/SceneMaker.uproject": "SceneMaker.uproject",
  "unreal/DefaultEngine.ini": "Config/DefaultEngine.ini",
  "unreal/scene_maker_startup.py": "Content/Python/scene_maker_startup.py",
};
const digest = async (data: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export async function productionPackage(
  scene: Scene,
  glb: ArrayBuffer,
  read: typeof fetch = fetch,
) {
  const zip = new JSZip(),
    json = JSON.stringify(scene, null, 2);
  zip.file("scene.json", json);
  zip.file("scene.glb", glb);
  const subtitles = dialogueSubtitles(scene);
  if (subtitles) zip.file("dialogue.srt", subtitles);
  const motionIds = new Set(
    scene.entities.flatMap((entity) =>
      entity.clips.map((clip) => clip.motionId),
    ),
  );
  const used = new Set([
    ...scene.entities.map((entity) => entity.assetId),
    ...allMotions(scene)
      .filter(
        (motion) =>
          motionIds.has(motion.id) ||
          scene.customMotions.some((custom) => custom.id === motion.id),
      )
      .map((motion) => motion.sourceAssetId),
    ...scene.customAssets.map((asset) => asset.design?.baseId),
  ]);
  const libraryAssets = libraryCharacters.filter((asset) => used.has(asset.id));
  const furniture = furnitureAssets.filter((asset) => used.has(asset.id));
  const files = [
    ...(used.has(motionSource.id)
      ? [
          {
            url: motionSource.url!,
            destination: "assets/actions/quaternius-actions.glb",
            error: "The action library could not be loaded.",
          },
          {
            url: "/library/actions/LICENSE.txt",
            destination: "assets/actions/LICENSE.txt",
            error: "The action library license could not be loaded.",
          },
        ]
      : []),
    ...furniture.map((asset) => ({
      url: asset.url!,
      destination: "assets/furniture/" + asset.url!.split("/").pop(),
      error: `Cannot package ${asset.name}. The library file is missing.`,
    })),
    ...(furniture.length ||
    scene.customAssets.some(
      (asset) => asset.url && furnitureURLs.has(asset.url),
    )
      ? [
          {
            url: "/library/furniture/LICENSE.txt",
            destination: "assets/furniture/LICENSE.txt",
            error: "The furniture library license could not be loaded.",
          },
        ]
      : []),
    ...libraryAssets.map((asset) => ({
      url: asset.url!,
      destination: "assets/quaternius/" + asset.url!.split("/").pop(),
      error: `Cannot package ${asset.name}. The library file is missing.`,
    })),
    ...(libraryAssets.length ||
    scene.customAssets.some(
      (asset) => asset.url && libraryAssetURLs.has(asset.url),
    )
      ? [
          {
            url: "/library/quaternius/LICENSE.txt",
            destination: "assets/quaternius/LICENSE.txt",
            error: "The character library license could not be loaded.",
          },
        ]
      : []),
    ...scene.customAssets
      .filter((asset) => asset.url)
      .map((asset) => ({
        url: asset.url!,
        destination: "assets/" + asset.url!.split("/").pop(),
        error: `Cannot package ${asset.name}. Reimport the missing asset.`,
      })),
    ...scene.customAssets
      .filter((asset) => asset.thumbnail)
      .map((asset) => ({
        url: asset.thumbnail!,
        destination: "assets/" + asset.thumbnail!.split("/").pop(),
        error: `Cannot package the preview for ${asset.name}. Try again when the file is available.`,
      })),
    ...Object.entries(adapters).map(([name, destination]) => ({
      url: "/engine/" + name,
      destination,
      error: "The production adapter could not be loaded. Try exporting again.",
    })),
  ];
  const results = await Promise.all(
    files.map(async (file) => {
      const response = await read(file.url);
      if (!response.ok) throw Error(file.error);
      return {
        destination: file.destination,
        content: await response.arrayBuffer(),
      };
    }),
  );
  for (const file of results) zip.file(file.destination, file.content);
  zip.file(
    "unreal-manifest.json",
    JSON.stringify(
      {
        version: 1,
        projectId: scene.id,
        sha256: {
          "scene.json": await digest(new TextEncoder().encode(json).buffer),
          "scene.glb": await digest(glb),
        },
      },
      null,
      2,
    ),
  );
  zip.file(
    "README.txt",
    `Scene Maker — ${scene.name}

Unpack this entire ZIP into a new folder.

Unreal Engine
Open SceneMaker.uproject with Unreal Engine 5.6 or later. Scene setup runs on first launch and saves a new level. Later launches reopen that level without replacing your edits. If Unreal asks you to choose an engine installation, select your installed 5.6-or-later editor.

The project enables its Python, Editor Scripting Utilities, Interchange, and Sequencer Scripting plugins. Scene setup uses the included trusted adapter. No sign-in, external service, or source-code build is required by this package.

Import results are recorded under Saved/SceneMaker/import-report.json. A saved level is not proof of animation playback parity: check its animation and imported sequences in Unreal. This adapter has not yet been validated in a running Unreal Editor in the development environment.

Blender
Open scene.glb, or run:
blender --background --python blender_import.py -- scene.glb scene.blend

Keep editing in Scene Maker
Open this ZIP from your projects to restore the editable scene and original assets. Imported source files are included under assets/. scene.glb contains the baked production animation at 24 frames per second.
`,
  );
  return zip.generateAsync({ type: "arraybuffer" });
}
