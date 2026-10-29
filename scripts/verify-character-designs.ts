/** Real Blender + studio-loader regression. Pass the Blender executable path.
 * Creates temporary test characters and removes only that temporary directory.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { libraryEntries } from "../shared/characterLibrary";
import {
  characterDraft,
  supportsGlasses,
  supportsHair,
} from "../shared/characterDesign";
import { applyCommands, starterScene } from "../shared/scene";
import { prepareImportedAsset } from "../src/importedAsset";
import { humanoidWarning } from "../src/rig";
import { applyAnimatedEntityPose, disposeObject } from "../src/world";

const blender = process.argv[2];
if (!blender) throw Error("Pass the Blender executable path.");
const directory = await fs.mkdtemp(
  path.join(os.tmpdir(), "scene-maker-designs-"),
);
process.env.SCENE_MAKER_DATA = directory;
const { generateCharacter } = await import("../server/characters");
try {
  for (const look of libraryEntries) {
    const draft = characterDraft(look.id, "Test " + look.name);
    draft.design!.glasses = supportsGlasses(look.id);
    draft.design!.backpack = true;
    const asset = await generateCharacter(draft, blender);
    const bytes = await fs.readFile(path.join(directory, asset.url!));
    const gltf = await new GLTFLoader().parseAsync(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "",
    );
    const group = prepareImportedAsset(asset, gltf);
    assert.equal(humanoidWarning(group, look.name, false), "");
    const colors = new Set<string>();
    group.traverse((object) => {
      if (object instanceof T.Mesh)
        for (const material of [object.material].flat())
          if (material instanceof T.MeshStandardMaterial)
            colors.add("#" + material.color.getHexString());
    });
    for (const color of [
      draft.color,
      draft.skin,
      draft.design!.accentColor,
      ...(supportsHair(look.id) ? [draft.design!.hairColor] : []),
    ])
      assert(
        colors.has(color),
        `${look.name}: missing requested color ${color}`,
      );
    const scene = applyCommands(starterScene(), [
      { type: "clear" },
      { type: "createAsset", asset },
      { type: "add", assetId: asset.id, id: "actor" },
      { type: "chain", id: "actor", motionId: "wave" },
      { type: "chain", id: "actor", motionId: "bow" },
    ]);
    const wearables: T.SkinnedMesh[] = [];
    group.traverse((object) => {
      if (
        object instanceof T.SkinnedMesh &&
        object.name.startsWith("wearable_")
      )
        wearables.push(object);
    });
    assert.equal(wearables.length, draft.design!.glasses ? 8 : 3);
    const sample = (time: number) => {
      applyAnimatedEntityPose(group, scene.entities[0], scene, time);
      group.updateMatrixWorld(true);
      return wearables.flatMap((mesh) => {
        mesh.skeleton.update();
        const bone = group.userData.bones[
          mesh.name.includes("glasses") ? "head" : "spine"
        ] as T.Bone;
        const inverse = bone.matrixWorld.clone().invert();
        return Array.from(
          { length: mesh.geometry.attributes.position.count },
          (_, index) =>
            mesh
              .getVertexPosition(index, new T.Vector3())
              .applyMatrix4(mesh.matrixWorld)
              .applyMatrix4(inverse),
        );
      });
    };
    const start = sample(0);
    let error = 0;
    for (const time of [0.8, 2.8, 4, 0]) {
      const points = sample(time);
      points.forEach((point, i) => {
        error = Math.max(error, point.distanceTo(start[i]));
      });
    }
    assert(error < 0.0001, `${look.name}: attachment error ${error}`);
    const png = await fs.readFile(path.join(directory, asset.thumbnail!));
    assert.equal(png.readUInt32BE(16), 320);
    assert.equal(png.readUInt32BE(20), 320);
    disposeObject(group);
    console.log(
      JSON.stringify({
        look: look.name,
        wearableMeshes: wearables.length,
        attachmentErrorMeters: error,
      }),
    );
  }
  console.log(
    "All 32 generated looks load, animate, retain wearables, and render previews.",
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
