// Build the recorded action library from CMU takes already converted by
// prepare-cmu-motion.mjs (one directory per subject holding <subject>.asf,
// <trial>.amc, <trial>.glb and <trial>-mapping.json).
//
//   node scripts/build-cmu-library.mjs <source-directory>
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

// GLTFExporter reads its binary chunks through FileReader, absent in Node.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend?.();
    });
  }
};
const source = process.argv[2];
if (!source)
  throw Error("Usage: node scripts/build-cmu-library.mjs <source-directory>");
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
for (const entry of spec) {
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
