/** Preserve the CC0 pack's authored motions in one separate source rig.
 * npx tsx scripts/prepare-motion-library.ts <original-gltf-directory>
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import catalogue from "../shared/motion-catalogue.json";
import { configureImportedRig, transferWarning } from "../src/rig";
import { createCharacter } from "../src/world";
import { characters } from "../shared/scene";
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
if (!input) throw Error("Pass the original character source directory.");
const file = path.join(input, "Casual_Male.gltf"),
  bytes = await fs.readFile(file);
const json = JSON.parse(bytes.toString());
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
for (const skin of json.skins)
  for (const joint of skin.joints)
    json.nodes[joint].name =
      rename[json.nodes[joint].name] || json.nodes[joint].name;
const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
gltf.scene.traverse((o) => {
  if (o instanceof T.SkinnedMesh) o.skeleton.pose();
});
gltf.scene.traverse((o) => {
  if (o instanceof T.Bone) {
    if (o.scale.toArray().some((n) => Math.abs(n - 1) > 0.0001))
      throw Error("Unexpected source scale");
    o.scale.setScalar(1);
  }
});
gltf.scene.updateMatrixWorld(true);
gltf.scene.traverse((o) => {
  if (o instanceof T.SkinnedMesh) o.skeleton.calculateInverses();
});
const output = "public/library/actions";
await fs.mkdir(output, { recursive: true });
const animations = catalogue.map(([name]) => {
  const clip = gltf.animations.find((c) => c.name === name);
  if (!clip) throw Error("Missing " + name);
  return clip;
});
const result = await new GLTFExporter().parseAsync(gltf.scene, {
  binary: true,
  animations,
});
const loaded = await new GLTFLoader().parseAsync(result as ArrayBuffer, "");
const group = new T.Group();
group.add(loaded.scene);
configureImportedRig(group, loaded.scene, loaded.animations);
for (const clip of loaded.animations) {
  const issue = transferWarning(group, createCharacter(characters[0]), clip);
  if (issue) throw Error(clip.name + ": " + issue);
}
await fs.writeFile(
  output + "/quaternius-actions.glb",
  Buffer.from(result as ArrayBuffer),
);
await fs.copyFile(
  "public/library/quaternius/LICENSE.txt",
  output + "/LICENSE.txt",
);
const durations = Object.fromEntries(
  loaded.animations.map((clip) => [clip.name, clip.duration]),
);
await fs.writeFile(
  "shared/motion-durations.json",
  JSON.stringify(durations, null, 2) + "\n",
);
await fs.writeFile(
  "docs/motion-source.json",
  JSON.stringify(
    {
      source: "Casual_Male.gltf",
      sourceSha256: createHash("sha256").update(bytes).digest("hex"),
      url: "https://drive.google.com/file/d/1rrj82IYNaSWj5ySxR6fW9oojyHFiW7_r/view",
      glbSha256: createHash("sha256")
        .update(Buffer.from(result as ArrayBuffer))
        .digest("hex"),
      animations: durations,
    },
    null,
    2,
  ) + "\n",
);
console.log("Prepared", loaded.animations.length, "authored actions");
