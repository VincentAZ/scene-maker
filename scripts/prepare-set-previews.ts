/** Build previews from the same editable layouts and geometry as the studio.
 * npx tsx scripts/prepare-set-previews.ts
 * Then render with scripts/render-set-previews.py through local Blender.
 */
import fs from "node:fs/promises";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { allAssets, applyCommands, starterScene } from "../shared/scene";
import { setLayouts } from "../shared/setLayouts";
import { prepareImportedAsset } from "../src/importedAsset";
import { createEnvironment, createProp, disposeObject } from "../src/world";
Object.assign(globalThis, {
  ProgressEvent: class {
    constructor(public type: string) {}
  },
  FileReader: class {
    result: ArrayBuffer | string | null = null;
    onloadend = () => {};
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((data) => {
        this.result = data;
        this.onloadend();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((data) => {
        this.result = `data:${blob.type};base64,${Buffer.from(data).toString("base64")}`;
        this.onloadend();
      });
    }
  },
});
const output = ".data/qa/set-previews";
await fs.mkdir(output, { recursive: true });
for (const layout of setLayouts) {
  const scene = applyCommands(starterScene(), [
    { type: "clear" },
    { type: "add", assetId: layout.id },
  ]);
  const root = new T.Group();
  root.add(createEnvironment(scene.environment));
  for (const entity of scene.entities) {
    const asset = allAssets(scene).find((a) => a.id === entity.assetId)!;
    let group: T.Group;
    if (asset.url) {
      const bytes = await fs.readFile("public" + asset.url);
      const gltf = await new GLTFLoader().parseAsync(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        "",
      );
      group = prepareImportedAsset(asset, gltf);
    } else
      group = createProp(asset.style, asset.color, asset.parts, asset.ladder);
    group.name = entity.name;
    group.position.fromArray(entity.position);
    group.rotation.y = entity.rotation;
    group.scale.setScalar(entity.scale);
    root.add(group);
  }
  const glb = await new GLTFExporter().parseAsync(root, { binary: true });
  await fs.writeFile(
    `${output}/${layout.id}.glb`,
    Buffer.from(glb as ArrayBuffer),
  );
  disposeObject(root);
  console.log(layout.name, scene.entities.length);
}
