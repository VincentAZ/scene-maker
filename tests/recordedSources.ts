import fs from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  capturedMotionSources,
  capturedMotions,
  capturedRouteGaits,
} from "../shared/motionLibrary";
import { prepareImportedAsset } from "../src/importedAsset";
import { setMotionSources } from "../src/rig";

/** Every studio action is a recording, so a test character needs the
 * recorded source skeletons the app would load for it: those of the role
 * actions (Walk, Sit down, Take a sip…), the route strides and the backward
 * walk that legacy routes migrate to. */
const ids = new Set([
  ...capturedMotions.filter((m) => m.role).map((m) => m.sourceAssetId!),
  ...capturedRouteGaits.map((m) => m.sourceAssetId!),
  capturedMotions.find((m) => m.animationName === "143_39")!.sourceAssetId!,
]);
let loaded: Promise<Map<string, T.Group>> | undefined;
export function recordedSources() {
  loaded ??= (async () => {
    const sources = new Map<string, T.Group>();
    for (const id of ids) {
      const asset = capturedMotionSources.find((a) => a.id === id)!;
      const bytes = await fs.readFile("public" + asset.url);
      const gltf = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
      sources.set(id, prepareImportedAsset(asset, gltf));
    }
    return sources;
  })();
  return loaded;
}
/** Attach the recorded sources to a character and return it. */
export function withRecordedSources(
  group: T.Group,
  sources: Map<string, T.Group>,
) {
  setMotionSources(group, sources);
  return group;
}
