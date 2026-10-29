/** Sample a catalogue-only scene for comparison with an independently imported Blender export.
 * npx tsx scripts/sample-motion-library.ts scene.json expected.json
 */
import fs from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  allAssets,
  boneNames,
  validateScene,
  type Asset,
} from "../shared/scene";
import {
  prepareImportedAsset,
  requiredMotionSources,
} from "../src/importedAsset";
import {
  applyAnimatedEntityPose,
  createCharacter,
  disposeObject,
} from "../src/world";
import { setMotionSources } from "../src/rig";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw Error("Pass scene.json and expected.json paths.");
const scene = validateScene(JSON.parse(await fs.readFile(input, "utf8")));
async function load(asset: Asset) {
  if (!asset.url) return createCharacter(asset);
  if (!asset.url.startsWith("/library/"))
    throw Error("This verifier expects bundled assets.");
  const bytes = await fs.readFile("public" + asset.url);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return prepareImportedAsset(asset, gltf);
}
const times = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 6, 8, 10];
const actors = [];
for (const entity of scene.entities) {
  const asset = allAssets(scene).find((a) => a.id === entity.assetId)!;
  if (asset.category !== "characters") continue;
  const group = await load(asset);
  const sources = new Map<string, T.Group>();
  for (const source of requiredMotionSources(scene, entity))
    sources.set(source.id, await load(source));
  setMotionSources(group, sources);
  const samples = times.map((time) => {
    applyAnimatedEntityPose(group, entity, scene, time);
    group.updateMatrixWorld(true);
    if (group.userData.motionWarning) throw Error(group.userData.motionWarning);
    return {
      time,
      bones: Object.fromEntries(
        boneNames.map((name) => {
          const bone = group.userData.bones[name] as T.Bone;
          const p = bone.getWorldPosition(new T.Vector3());
          return [bone.name, [p.x, -p.z, p.y]];
        }),
      ),
    };
  });
  actors.push({ id: entity.id, name: entity.name, samples });
  disposeObject(group);
  for (const source of sources.values()) disposeObject(source);
}
await fs.writeFile(
  output,
  JSON.stringify({ sceneId: scene.id, actors }, null, 2),
);
console.log(`Sampled ${actors.length} actors at ${times.length} times.`);
