/** Run with npx tsx scripts/prepare-character-library.ts <download-directory>.
 * Sources and licensing: docs/CHARACTER_ASSETS.md. No remote fetch at app runtime.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { libraryEntries } from "../shared/characterLibrary";
import {
  configureImportedRig,
  applyHumanoidPose,
  humanoidWarning,
} from "../src/rig";

// Three's exporter uses the browser FileReader API even for untextured GLBs.
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

const input = process.argv[2];
if (!input)
  throw Error("Pass the directory containing the original .gltf files.");
const out = "public/library/quaternius";
await fs.mkdir(out, { recursive: true });
await fs.mkdir(path.join(input, "previews"), { recursive: true });
const rename: Record<string, string> = {
  Body: "hips",
  Hips: "pelvisHelper",
  Abdomen: "spine",
  Head: "head",
  "UpperArm.L": "leftArm",
  "LowerArm.L": "leftForearm",
  "Fist.L": "leftHand",
  "UpperArm.R": "rightArm",
  "LowerArm.R": "rightForearm",
  "Fist.R": "rightHand",
  "UpperLeg.L": "leftLeg",
  "LowerLeg.L": "leftShin",
  "UpperLeg.R": "rightLeg",
  "LowerLeg.R": "rightShin",
};
for (const entry of libraryEntries) {
  const json = JSON.parse(
    await fs.readFile(path.join(input, entry.source + ".gltf"), "utf8"),
  );
  for (const skin of json.skins)
    for (const joint of skin.joints) {
      const node = json.nodes[joint];
      node.name = rename[node.name] || node.name;
    }
  // The source glTF opens on a walking frame. Restore the actual bind pose from
  // inverse bind matrices before calibration. The studio supplies its actions;
  // source animation buffers are omitted from these compact model-only files.
  delete json.animations;
  const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
  gltf.scene.traverse((object) => {
    if (object instanceof T.Mesh)
      for (const material of [object.material].flat())
        if (
          material instanceof T.MeshStandardMaterial &&
          material.name === "Skin"
        )
          material.color.set(entry.skin);
  });
  gltf.scene.traverse((object) => {
    if (object instanceof T.SkinnedMesh) object.skeleton.pose();
  });
  gltf.scene.traverse((object) => {
    if (object instanceof T.Bone) {
      if (object.scale.toArray().some((scale) => Math.abs(scale - 1) > 0.0001))
        throw Error(`Unexpected bind scale on ${entry.source}: ${object.name}`);
      // Remove tiny source-export scale noise, then bind the unchanged geometry.
      object.scale.setScalar(1);
    }
  });
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((object) => {
    if (object instanceof T.SkinnedMesh) object.skeleton.calculateInverses();
  });
  const exporter = new GLTFExporter();
  await fs.writeFile(
    "public" + entry.url,
    Buffer.from(
      (await exporter.parseAsync(gltf.scene, { binary: true })) as ArrayBuffer,
    ),
  );
  // Render the same calibrated standing pose used in the viewport.
  const group = new T.Group();
  group.add(gltf.scene);
  configureImportedRig(group, gltf.scene, []);
  const warning = humanoidWarning(group, entry.name, false);
  if (warning) throw Error(warning);
  if (!applyHumanoidPose(group, {}, false))
    throw Error("Cannot calibrate " + entry.source);
  await fs.writeFile(
    path.join(input, "previews", entry.source + ".glb"),
    Buffer.from(
      (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer,
    ),
  );
  console.log(entry.source);
}
