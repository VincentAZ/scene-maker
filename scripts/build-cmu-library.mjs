// Build the recorded action library from CMU takes already converted by
// prepare-cmu-motion.mjs (one directory per subject holding <subject>.asf,
// <trial>.amc, <trial>.glb and <trial>-mapping.json).
//
//   node scripts/build-cmu-library.mjs <source-directory> [key ...]
//
// With keys, only those entries are rebuilt; the rest of the catalogue is
// kept as it is.
//
// Entries with "source": "100STYLE" are BVH takes from the 100STYLE dataset
// (Mason, Starke and Komura, CC BY 4.0, https://zenodo.org/records/8127870),
// read from <source-directory>/100STYLE/<style>_<take>.bvh. They are
// converted here: the captured joint rotations and root path are kept as
// recorded (centimetres become metres), and a capsule skeleton is added for
// display, like the CMU converter's.
//
// Every take listed in scripts/cmu-library.json is copied to
// public/library/actions/cmu/. An entry with an `excerpt` keeps only the
// original samples inside [start, end] seconds, shifted to start at 0: no
// resampling, filtering or looping. The catalogue entry records the source
// take, the excerpt and SHA-256 hashes of the source files and the output.
import fs from "node:fs";
import crypto from "node:crypto";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { BVHLoader } from "three/addons/loaders/BVHLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// GLTFExporter reads its binary chunks through FileReader, absent in Node.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const [source, ...only] = process.argv.slice(2);
if (!source)
  throw Error(
    "Usage: node scripts/build-cmu-library.mjs <source-directory> [key ...]",
  );
const spec = JSON.parse(fs.readFileSync("scripts/cmu-library.json", "utf8"));
const output = "public/library/actions/cmu";
const cataloguePath = "shared/captured-motion-catalogue.json";
const catalogue = JSON.parse(fs.readFileSync(cataloguePath, "utf8"));
const sha = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function excerpt(clip, name, start, end) {
  const tracks = clip.tracks.map((track) => {
    const size = track.getValueSize(),
      times = [],
      values = [];
    track.times.forEach((time, index) => {
      if (time < start - 1e-6 || time > end + 1e-6) return;
      times.push(time - start);
      values.push(...track.values.slice(index * size, (index + 1) * size));
    });
    if (times.length < 2)
      throw Error(`${name}: excerpt keeps fewer than two keys`);
    return new track.constructor(track.name, times, values);
  });
  return new T.AnimationClip(name, -1, tracks);
}

/** The converter's mapping addresses joints by child-index paths in its own
 * file. A re-exported excerpt may order nodes differently, so resolve each
 * role to its joint name and find that joint's path in the written file. */
async function mappingIn(glb, original, mapping) {
  const written = (
    await new GLTFLoader().parseAsync(
      glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.length),
      "",
    )
  ).scene;
  const at = (root, path) => path.reduce((node, i) => node?.children[i], root);
  const pathTo = (root, name) => {
    const path = [];
    for (let node = root.getObjectByName(name); node && node !== root; node = node.parent)
      path.unshift(node.parent.children.indexOf(node));
    return path;
  };
  return Object.fromEntries(
    Object.entries(mapping).map(([role, path]) => {
      const name = at(original, path)?.name;
      if (!name || !written.getObjectByName(name))
        throw Error(`Joint for ${role} is missing in the written file`);
      return [role, pathTo(written, name)];
    }),
  );
}
/** 100STYLE joint names for each studio role. */
const styleRoles = {
  hips: "Hips",
  spine: "Chest",
  chest: "Chest2",
  upperChest: "Chest4",
  neck: "Neck",
  head: "Head",
  leftShoulder: "LeftCollar",
  rightShoulder: "RightCollar",
  leftArm: "LeftShoulder",
  rightArm: "RightShoulder",
  leftForearm: "LeftElbow",
  rightForearm: "RightElbow",
  leftHand: "LeftWrist",
  rightHand: "RightWrist",
  leftLeg: "LeftHip",
  rightLeg: "RightHip",
  leftShin: "LeftKnee",
  rightShin: "RightKnee",
  leftFoot: "LeftAnkle",
  rightFoot: "RightAnkle",
  leftToeBase: "LeftToe",
  rightToeBase: "RightToe",
};

/** A 100STYLE BVH take as the same shape the CMU converter writes: a group
 * holding the captured skeleton, a capsule mesh skinned to it and one clip
 * with the root path and every joint's recorded rotation. */
function bvhTake(text, key) {
  const { skeleton, clip } = new BVHLoader().parse(text);
  const bones = skeleton.bones,
    root = bones[0];
  for (const bone of bones)
    if (bone.name === "ENDSITE") bone.name = `${bone.parent.name}_End`;
  for (const bone of bones) bone.position.multiplyScalar(0.01);
  const group = new T.Group();
  group.name = "STYLE_" + key;
  group.add(root);
  group.updateMatrixWorld(true);
  const parts = [];
  for (const bone of bones)
    for (const child of bone.children) {
      if (!child.isBone) continue;
      const length = child.position.length();
      if (length < 0.01) continue;
      const radius = /Ankle|Toe|Wrist/.test(bone.name) ? 0.018 : 0.027;
      const geo = new T.CapsuleGeometry(
        radius,
        Math.max(0.001, length - 2 * radius),
        4,
        8,
      );
      geo.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          child.position.clone().normalize(),
        ),
      );
      geo.translate(...child.position.clone().multiplyScalar(0.5).toArray());
      geo.applyMatrix4(bone.matrixWorld);
      const n = geo.attributes.position.count,
        indices = new Uint16Array(n * 4),
        weights = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        indices[i * 4] = bones.indexOf(bone);
        weights[i * 4] = 1;
      }
      geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(indices, 4));
      geo.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
      parts.push(geo);
    }
  const mesh = new T.SkinnedMesh(
    mergeGeometries(parts),
    new T.MeshStandardMaterial({ color: 0xd6b44c, roughness: 0.8 }),
  );
  mesh.name = "CapturedSkeleton";
  group.add(mesh);
  mesh.bind(new T.Skeleton(bones));
  // BVHLoader keys every joint's position; only the root translates.
  const tracks = clip.tracks.flatMap((track) => {
    if (track.name.endsWith(".quaternion"))
      return track.name.startsWith("ENDSITE") ? [] : [track];
    if (track.name !== root.name + ".position") return [];
    track.values = track.values.map((v) => v * 0.01);
    return [track];
  });
  const mapping = {};
  for (const [role, name] of Object.entries(styleRoles)) {
    const path = [];
    for (let node = group.getObjectByName(name); node !== group; node = node.parent)
      path.unshift(node.parent.children.indexOf(node));
    mapping[role] = [0, ...path];
  }
  return {
    scene: (() => {
      const scene = new T.Group();
      scene.add(group);
      return scene;
    })(),
    clip: new T.AnimationClip(key, -1, tracks),
    mapping,
  };
}

async function styleEntry(entry) {
  const key = entry.key,
    file = `${source}/100STYLE/${entry.file.split("/").pop()}`;
  const take = bvhTake(fs.readFileSync(file, "utf8"), key);
  const frequency = Math.round(
    (take.clip.tracks[0].times.length - 1) / take.clip.tracks[0].times.at(-1),
  );
  const clip = entry.excerpt ? excerpt(take.clip, key, ...entry.excerpt) : take.clip;
  const glb = Buffer.from(
    await new GLTFExporter().parseAsync(take.scene, {
      binary: true,
      animations: [clip],
    }),
  );
  fs.writeFileSync(`${output}/${key}.glb`, glb);
  return {
    trial: key,
    source: "100STYLE",
    sourceFile: "100STYLE/" + entry.file,
    licence: "CC BY 4.0",
    ...(entry.excerpt
      ? { excerpt: { start: entry.excerpt[0], end: entry.excerpt[1] } }
      : {}),
    frames: clip.tracks[0].times.length,
    frequency,
    duration: clip.duration,
    tracks: clip.tracks.length,
    bones: take.scene.getObjectsByProperty("type", "Bone").length,
    bytes: glb.length,
    sha256: {
      [entry.file.split("/").pop()]: sha(file),
      [`${key}.glb`]: crypto.createHash("sha256").update(glb).digest("hex"),
    },
    name: entry.name,
    description: entry.description,
    category: entry.category,
    ...(entry.travels ? { travels: true } : {}),
    rigMapping: await mappingIn(glb, take.scene, take.mapping),
    sourceURLs: ["https://zenodo.org/records/8127870/files/100STYLE.zip"],
    excludedUncapturedChannels: [],
  };
}

for (const entry of spec) {
  if (only.length && !only.includes(entry.key ?? entry.trial)) continue;
  if (entry.source === "100STYLE") {
    const record = await styleEntry(entry);
    const index = catalogue.findIndex((item) => item.trial === record.trial);
    if (index >= 0) catalogue[index] = record;
    else catalogue.push(record);
    console.log(record.trial, record.duration.toFixed(2), "s", (record.bytes / 1024) | 0, "KB");
    continue;
  }
  const subject = entry.trial.split("_")[0],
    key = entry.key ?? entry.trial,
    dir = `${source}/${subject}`;
  const bytes = fs.readFileSync(`${dir}/${entry.trial}.glb`);
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    "",
  );
  const take = gltf.animations[0];
  const frequency = Math.round(
    (take.tracks[0].times.length - 1) / take.tracks[0].times.at(-1),
  );
  const clip = entry.excerpt
    ? excerpt(take, key, ...entry.excerpt)
    : Object.assign(take.clone(), { name: key });
  const glb =
    entry.excerpt || key !== entry.trial
      ? Buffer.from(
          await new GLTFExporter().parseAsync(gltf.scene, {
            binary: true,
            animations: [clip],
          }),
        )
      : bytes;
  fs.writeFileSync(`${output}/${key}.glb`, glb);
  const record = {
    trial: key,
    ...(key !== entry.trial ? { sourceTrial: entry.trial } : {}),
    ...(entry.excerpt
      ? { excerpt: { start: entry.excerpt[0], end: entry.excerpt[1] } }
      : {}),
    frames: clip.tracks[0].times.length,
    frequency,
    duration: clip.duration,
    tracks: clip.tracks.length,
    bones: gltf.scene.getObjectsByProperty("type", "Bone").length || undefined,
    bytes: glb.length,
    sha256: {
      [`${subject}.asf`]: sha(`${dir}/${subject}.asf`),
      [`${entry.trial}.amc`]: sha(`${dir}/${entry.trial}.amc`),
      [`${key}.glb`]: crypto.createHash("sha256").update(glb).digest("hex"),
    },
    name: entry.name,
    description: entry.description,
    category: entry.category,
    ...(entry.role ? { role: entry.role } : {}),
    // Seat lowering/rising as fractions of the take, measured from its hips.
    ...(entry.timing ? { timing: entry.timing } : {}),
    ...(entry.travels ? { travels: true } : {}),
    rigMapping: await mappingIn(
      glb,
      gltf.scene,
      JSON.parse(fs.readFileSync(`${dir}/${entry.trial}-mapping.json`, "utf8")),
    ),
    sourceURLs: [
      `https://mocap.cs.cmu.edu/subjects/${subject}/${subject}.asf`,
      `https://mocap.cs.cmu.edu/subjects/${subject}/${entry.trial}.amc`,
    ],
    excludedUncapturedChannels: ["lfingers", "rfingers", "lthumb", "rthumb"],
  };
  if (!record.bones) delete record.bones;
  const index = catalogue.findIndex((item) => item.trial === key);
  if (index >= 0) catalogue[index] = { ...catalogue[index], ...record };
  else catalogue.push(record);
  console.log(
    key,
    record.duration.toFixed(2),
    "s",
    (glb.length / 1024) | 0,
    "KB",
  );
}
fs.writeFileSync(cataloguePath, JSON.stringify(catalogue, null, 1) + "\n");
