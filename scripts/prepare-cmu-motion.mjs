// Offline CMU ASF/AMC evaluation converter. Not a general application importer.
// CMU wrist nodes partition the forearm: the anatomical hand begins at lhand/rhand.
// Mapping the upstream wrist node drops captured hand flexion.
// Supply the catalogue's frame rate (default 120 Hz). No filtering or looping.
import fs from "node:fs";
import crypto from "node:crypto";
import * as T from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
const out = process.argv[2];
const trial = process.argv[3];
const frequency = Number(process.argv[4] ?? 120);
if (
  !out ||
  !/^\d{2,3}_\d{2}$/.test(trial || "") ||
  ![60, 120].includes(frequency)
)
  throw Error(
    "Usage: node scripts/prepare-cmu-motion.mjs <directory> <subject_trial> [60|120 Hz]",
  );
const subject = trial.split("_")[0];
const asf = fs.readFileSync(out + "/" + subject + ".asf", "utf8");
const scale = 0.0254 / Number(asf.match(/:units[\s\S]*?length\s+(\S+)/)[1]);
// Fail closed on conventions this evaluation adapter has not implemented.
const rootHeader = asf.split(":root")[1]?.split(":bonedata")[0] || "";
if (
  !Number.isFinite(scale) ||
  scale <= 0 ||
  !/angle\s+deg\b/.test(asf) ||
  !/order\s+TX TY TZ RX RY RZ/.test(rootHeader) ||
  !/axis\s+XYZ/.test(rootHeader) ||
  !/position\s+0 0 0\s/.test(rootHeader) ||
  !/orientation\s+0 0 0\s/.test(rootHeader)
)
  throw Error("Unsupported ASF root or unit convention");

const defs = new Map([
  [
    "root",
    {
      name: "root",
      direction: [0, 0, 0],
      length: 0,
      axis: [0, 0, 0],
      order: "XYZ",
      dof: ["rx", "ry", "rz"],
    },
  ],
]);
for (const block of asf
  .split(":bonedata")[1]
  .split(":hierarchy")[0]
  .matchAll(/begin([\s\S]*?)end/g)) {
  const lines = Object.fromEntries(
    block[1]
      .trim()
      .split(/\r?\n/)
      .map((l) => {
        const [k, ...v] = l.trim().split(/\s+/);
        return [k, v];
      }),
  );
  const name = lines.name[0];
  defs.set(name, {
    name,
    direction: lines.direction.map(Number),
    length: +lines.length[0] * scale,
    axis: lines.axis.slice(0, 3).map(Number),
    order: lines.axis[3],
    dof: lines.dof || [],
  });
}
for (const line of asf.split(":hierarchy")[1].trim().split(/\r?\n/)) {
  const [parent, ...children] = line.trim().split(/\s+/);
  if (!defs.has(parent)) continue;
  for (const child of children) defs.get(child).parent = parent;
}
const axes = {
  x: new T.Vector3(1, 0, 0),
  y: new T.Vector3(0, 1, 0),
  z: new T.Vector3(0, 0, 1),
};
function rotation(order, angles) {
  const q = new T.Quaternion();
  order.forEach((axis, i) =>
    q.premultiply(
      new T.Quaternion().setFromAxisAngle(
        axes[axis],
        (angles[i] * Math.PI) / 180,
      ),
    ),
  );
  return q.normalize();
}
const roles = {
  root: "hips",
  lowerback: "spine",
  upperback: "chest",
  thorax: "upperChest",
  lowerneck: "neck",
  head: "head",
  lclavicle: "leftShoulder",
  rclavicle: "rightShoulder",
  lhumerus: "leftArm",
  rhumerus: "rightArm",
  lradius: "leftForearm",
  rradius: "rightForearm",
  lhand: "leftHand",
  rhand: "rightHand",
  lfemur: "leftLeg",
  rfemur: "rightLeg",
  ltibia: "leftShin",
  rtibia: "rightShin",
  lfoot: "leftFoot",
  rfoot: "rightFoot",
  ltoes: "leftToeBase",
  rtoes: "rightToeBase",
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type};base64,${Buffer.from(r).toString("base64")}`;
      this.onloadend?.();
    });
  }
};
const summary = [];
{
  const amc = fs.readFileSync(out + "/" + trial + ".amc", "utf8");
  if (!amc.includes(":DEGREES") || !amc.includes(":FULLY-SPECIFIED"))
    throw Error("Expected fully specified AMC angles in degrees");
  let current;
  const frames = [];
  for (const line of amc.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (/^\d+$/.test(tokens[0])) {
      if (+tokens[0] !== frames.length + 1) throw Error("Noncontiguous frames");
      current = {};
      frames.push(current);
    } else if (defs.has(tokens[0]))
      current[tokens[0]] = tokens.slice(1).map(Number);
  }
  if (
    frames.length < 2 ||
    frames.some(
      (f) =>
        !f.root ||
        Object.values(f).some((values) =>
          values.some((v) => !Number.isFinite(v)),
        ),
    )
  )
    throw Error("Invalid or empty capture");
  const root = new T.Group();
  root.name = "CMU_" + trial;
  const nodes = new Map(
    [...defs].map(([name]) => {
      const bone = new T.Bone();
      bone.name = name;
      return [name, bone];
    }),
  );
  for (const [name, def] of defs) {
    const bone = nodes.get(name);
    if (def.parent) {
      const parent = defs.get(def.parent);
      bone.position.fromArray(parent.direction).multiplyScalar(parent.length);
      nodes.get(def.parent).add(bone);
    } else {
      bone.position.fromArray(frames[0].root.slice(0, 3)).multiplyScalar(scale);
      root.add(bone);
    }
  }
  root.updateMatrixWorld(true);
  const boneArray = [...nodes.values()],
    parts = [];
  for (const [name, def] of defs) {
    if (!def.length) continue;
    const node = nodes.get(name),
      radius = /foot|toes/.test(name)
        ? 0.018
        : /hand|wrist|finger|thumb/.test(name)
          ? 0.012
          : 0.027;
    const geo = new T.CapsuleGeometry(
      radius,
      Math.max(0.001, def.length - 2 * radius),
      4,
      8,
    );
    const offset = new T.Vector3()
      .fromArray(def.direction)
      .multiplyScalar(def.length / 2);
    geo.applyQuaternion(
      new T.Quaternion().setFromUnitVectors(
        axes.y,
        new T.Vector3().fromArray(def.direction).normalize(),
      ),
    );
    geo.translate(...offset.toArray());
    geo.applyMatrix4(node.matrixWorld);
    const n = geo.attributes.position.count,
      index = boneArray.indexOf(node),
      indices = new Uint16Array(n * 4),
      weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      indices[i * 4] = index;
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
  root.add(mesh);
  mesh.bind(new T.Skeleton(boneArray));
  const times = frames.map((_, i) => i / frequency),
    tracks = [
      new T.VectorKeyframeTrack(
        "root.position",
        times,
        frames.flatMap((f) => f.root.slice(0, 3).map((v) => v * scale)),
      ),
    ];
  for (const [name, def] of defs) {
    if (!def.dof.length || /fingers|thumb/.test(name)) continue;
    const c = rotation(def.order.toLowerCase().split(""), def.axis),
      ci = c.clone().invert();
    let previous;
    const values = [];
    for (const f of frames) {
      const angles = name === "root" ? f.root.slice(3) : f[name];
      if (!angles || angles.length !== def.dof.length)
        throw Error("Missing degrees of freedom " + name);
      const q = rotation(
        def.dof.map((d) => d.slice(1)),
        angles,
      );
      if (name !== "root") q.premultiply(c).multiply(ci);
      if (previous && previous.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w);
      values.push(...q.toArray());
      previous = q;
    }
    tracks.push(
      new T.QuaternionKeyframeTrack(name + ".quaternion", times, values),
    );
  }
  const clip = new T.AnimationClip(trial, times.at(-1), tracks),
    mapping = {};
  for (const [name, role] of Object.entries(roles)) {
    const path = [];
    for (let node = nodes.get(name); node !== root; node = node.parent)
      path.unshift(node.parent.children.indexOf(node));
    mapping[role] = [0, ...path];
  }
  root.userData.provenance = {
    provider: "CMU Graphics Lab",
    subject: Number(subject),
    trial,
    frequency,
    excludedUncapturedChannels: ["lfingers", "rfingers", "lthumb", "rthumb"],
  };
  const buffer = await new GLTFExporter().parseAsync(root, {
    binary: true,
    animations: [clip],
  });
  fs.writeFileSync(out + "/" + trial + ".glb", Buffer.from(buffer));
  fs.writeFileSync(
    out + "/" + trial + "-mapping.json",
    JSON.stringify(mapping, null, 2),
  );
  summary.push({
    trial,
    frames: frames.length,
    frequency,
    duration: clip.duration,
    tracks: tracks.length,
    bones: boneArray.length,
    bytes: buffer.byteLength,
    scale,
    sha256: Object.fromEntries(
      [subject + ".asf", trial + ".amc", trial + ".glb"].map((name) => [
        name,
        crypto
          .createHash("sha256")
          .update(fs.readFileSync(out + "/" + name))
          .digest("hex"),
      ]),
    ),
  });
}
fs.writeFileSync(out + "/conversion.json", JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
