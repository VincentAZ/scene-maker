// Realistic characters from Grab3D (CC0, grab3d.com): AI-assisted humans by
// Alexander Popov, rigged by Meshy with a Mixamo-named skeleton. The skeleton
// has no face or finger bones; each hand gets one unweighted joint at its
// knuckles so the studio can straighten its wrist like any other. Each rigged
// GLB is downloaded with its manifest and LICENSE.txt, and a model is only
// used once its LICENSE.txt dedicates the package to the public domain and
// both files are the ones that were reviewed. The mesh is then simplified to
// at most 120k triangles with glTF Transform (meshopt keeps the skin
// weights), textures are capped at 2048 px, the bundled walk and run clips
// are dropped (the studio has its own recordings), the rest pose is given
// straight vertical legs and the material is made dielectric unless the
// outfit carries metal. Idempotent: downloads are cached in
// content/.cache/grab3d/<slug> and a character is converted again only when
// its GLB is missing or the converter version has moved on. A character that
// cannot be built is reported and left out; the others still build.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as T from "three";

const SITE = "https://grab3d.com";
// glTF Transform and the simplifier it runs, each at an exact version (the
// CLI alone would let npx pick newer libraries), so every machine simplifies
// the same way; `npx` fetches them on demand.
const GLTF_TRANSFORM = [
  "@gltf-transform/cli@4.2.1",
  "@gltf-transform/core@4.5.1",
  "@gltf-transform/functions@4.5.1",
  "@gltf-transform/extensions@4.5.1",
  "meshoptimizer@0.24.0",
];
const MAX_TRIANGLES = 120_000;
const MAX_TEXTURE = 2048;
// Bump to rebuild every GLB after changing the converter.
const CONVERTER_VERSION = 4;

// The cast is the vetted subset of Grab3D's human characters: the ones whose
// faces, hands and textures hold up as real people (docs/CHARACTER_ASSETS.md
// lists the rejected ones and why). slug: the model page
// grab3d.com/models/characters/<slug>/. metal: the outfit has small metal
// parts (buckles, buttons, a blade) whose painted metal mask is kept;
// otherwise the character is fully dielectric so stray mask values cannot
// darken skin or cloth. body: feminine | masculine. sha256: the reviewed
// rigged GLB and LICENSE.txt. Grab3D's download links carry no version and
// the author does revise packages, so a changed file is refused until it has
// been looked at again.
export const cast = [
  // Everyday
  {
    slug: "man-base-character",
    name: "Man in a T-shirt",
    body: "masculine",
    style: "Everyday",
    description:
      "A man with short dark hair in a plain taupe T-shirt and charcoal shorts, barefoot. An AI-assisted model.",
    sha256: {
      glb: "3038f56e1225d0ef9692189ed19ff688f1424e669281148a4cc6995fed568496",
      license:
        "66eda0cadb138a0b94a4c7b850ee0e074b537d66368cd41cd312ba8f23d65347",
    },
  },
  {
    slug: "woman-base-character",
    name: "Woman in a sports top",
    body: "feminine",
    style: "Everyday",
    description:
      "A woman with her dark hair in a bun, in a taupe sports top and fitted charcoal shorts, barefoot. An AI-assisted model.",
    sha256: {
      glb: "ea49ef6644dfcaa503b2e009f37b43cf6b2069501201552dc10a5b5ab1fc8bfa",
      license:
        "66eda0cadb138a0b94a4c7b850ee0e074b537d66368cd41cd312ba8f23d65347",
    },
  },
  // Historical
  {
    slug: "pirate",
    name: "Pirate captain",
    body: "masculine",
    style: "Historical",
    metal: true,
    description:
      "A pirate captain in a black tricorn hat with a red feather, a navy coat with brass buttons, a teal waistcoat, a coral sash and tall boots. An AI-assisted model.",
    sha256: {
      glb: "1646442b39cb3168c14001a47f7ea20b32543538adb770b692582148fe308927",
      license:
        "66eda0cadb138a0b94a4c7b850ee0e074b537d66368cd41cd312ba8f23d65347",
    },
  },
  {
    slug: "ninja",
    name: "Ninja",
    body: "masculine",
    style: "Historical",
    description:
      "A masked ninja in a fitted indigo hood and wrapped jacket with a persimmon sash, forearm wraps and a short sword across his back. An AI-assisted model.",
    sha256: {
      glb: "dcaedffe5f363db7a07bdca70edb72d364288f8dff6d4b5539560c5ce1bb9bfb",
      license:
        "66eda0cadb138a0b94a4c7b850ee0e074b537d66368cd41cd312ba8f23d65347",
    },
  },
];
/** The start of every id this source owns (see scripts/content/characters.mjs). */
export const idPrefix = "grab3d-";
const idOf = (c) => idPrefix + c.slug;

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

async function fetchText(url) {
  for (let attempt = 1; ; attempt++) {
    let status;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res.text();
      status = res.status;
      await res.body?.cancel();
    } catch (error) {
      if (attempt >= 5) throw error;
    }
    // A missing file stays missing: no point waiting for it.
    if (status === 404) throw Error(`${url}: not found`);
    if (attempt >= 5) throw Error(`${url}: ${status}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

const sha256 = (bytes) =>
  crypto.createHash("sha256").update(bytes).digest("hex");

async function download(url, file, size) {
  if (fs.existsSync(file) && fs.statSync(file).size === size) return;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (res.ok) {
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === size) {
          fs.writeFileSync(file + ".part", bytes);
          fs.renameSync(file + ".part", file);
          return;
        }
      } else await res.body?.cancel();
    } catch {
      // timeout or reset: retry
    }
    if (attempt >= 5) throw Error(`could not download ${url}`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

/** The rigged package of one character: manifest.json, LICENSE.txt and the
 * rigged GLB, kept together in the cache. The licence text is the authority:
 * a package that is not dedicated to the public domain is never used, and a
 * licence or model that differs from the reviewed one is refused. */
async function fetchPackage(character, dir, log) {
  const base = `${SITE}/dl/${character.slug}-rigged/`;
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, "manifest.json");
  const licenseFile = path.join(dir, "LICENSE.txt");
  if (!fs.existsSync(manifestFile))
    fs.writeFileSync(manifestFile, await fetchText(base + "manifest.json"));
  if (!fs.existsSync(licenseFile))
    fs.writeFileSync(licenseFile, await fetchText(base + "LICENSE.txt"));
  const changed = `Grab3D changed ${character.name}; review it before it ships`;
  const license = fs.readFileSync(licenseFile);
  if (sha256(license) !== character.sha256.license)
    throw Error(`${changed} (LICENSE.txt)`);
  const text = license.toString("utf8");
  if (!/CC0 1\.0 Universal/.test(text) || !/public domain/i.test(text))
    throw Error(`${character.slug}: LICENSE.txt is not a CC0 dedication`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  // A light variant is simplified already; so far only the unrigged packages
  // offer one.
  const glb = manifest.files?.glb_light ?? manifest.files?.glb;
  if (!glb?.name || !glb.bytes)
    throw Error(`${character.slug}: manifest lists no rigged GLB`);
  const file = path.join(dir, glb.name);
  if (!(fs.existsSync(file) && fs.statSync(file).size === glb.bytes))
    log(`downloading ${character.slug} (${(glb.bytes / 1e6).toFixed(1)} MB)`);
  await download(base + glb.name, file, glb.bytes);
  if (sha256(fs.readFileSync(file)) !== character.sha256.glb)
    throw Error(`${changed} (${glb.name})`);
  return file;
}

function run(command, args, cwd, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, timeout: 600_000 });
    let output = "";
    child.stdout.on("data", (d) => (output = (output + d).slice(-20000)));
    child.stderr.on("data", (d) => (output = (output + d).slice(-20000)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(Error(`${label} failed: ${output.slice(-2000)}`)),
    );
  });
}
const gltfTransform = (root, args) =>
  run(
    "npx",
    [
      "-y",
      ...GLTF_TRANSFORM.flatMap((spec) => ["-p", spec]),
      "gltf-transform",
      ...args,
    ],
    root,
    `gltf-transform ${args[0]}`,
  );

function blender(root, script, args) {
  const exe = process.env.BLENDER_PATH || blenderPath(root);
  return run(
    exe,
    [
      "--background",
      "--factory-startup",
      "--python-exit-code",
      "1",
      "--python",
      script,
      "--",
      ...args,
    ],
    root,
    "Blender",
  );
}
function blenderPath(root) {
  for (const candidate of [
    path.join(root, ".data/tools/blender/blender"),
    path.resolve(root, "../scene-maker/.data/tools/blender/blender"),
  ])
    if (fs.existsSync(candidate)) return candidate;
  return "blender";
}

function readGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")),
    rest: bytes.subarray(20 + jsonLength),
  };
}
function writeGlb(file, json, rest) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  if (text.length % 4)
    text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.write("JSON", 16, "ascii");
  fs.writeFileSync(file, Buffer.concat([header, text, rest]));
}
/** Pixel size of an embedded JPEG (from its first frame header) or PNG. */
export function imageSize(bytes) {
  if (bytes.readUInt32BE(0) === 0x89504e47)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  for (let i = 2; i + 9 < bytes.length;) {
    if (bytes[i] !== 0xff) throw Error("not a JPEG marker");
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2)
      return {
        height: bytes.readUInt16BE(i + 5),
        width: bytes.readUInt16BE(i + 7),
      };
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  throw Error("JPEG without a frame header");
}
const imageBytes = ({ json, rest }, image) => {
  const view = json.bufferViews[image.bufferView];
  // The BIN chunk follows its own 8-byte header.
  const start = 8 + (view.byteOffset ?? 0);
  return rest.subarray(start, start + view.byteLength);
};
const triangles = (json) =>
  json.meshes.reduce(
    (sum, mesh) =>
      sum +
      mesh.primitives.reduce(
        (n, p) =>
          n + json.accessors[p.indices ?? p.attributes.POSITION].count / 3,
        0,
      ),
    0,
  );

/** Element access to one accessor of the BIN chunk, packed or interleaved. */
function accessorView(json, rest, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[
    accessor.type
  ];
  const bytes = { 5121: 1, 5123: 2, 5126: 4 }[accessor.componentType];
  if (!size || !bytes)
    throw Error(
      `unsupported accessor ${accessor.type} ${accessor.componentType}`,
    );
  const stride = view.byteStride ?? size * bytes;
  const start = 8 + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const at = (i, k) => start + i * stride + k * bytes;
  const read = (i, k) => {
    if (accessor.componentType === 5126) return rest.readFloatLE(at(i, k));
    const raw =
      bytes === 1 ? rest.readUInt8(at(i, k)) : rest.readUInt16LE(at(i, k));
    return accessor.normalized ? raw / (bytes === 1 ? 255 : 65535) : raw;
  };
  const write = (i, k, value) => {
    if (accessor.componentType !== 5126)
      throw Error("only float accessors are rewritten");
    rest.writeFloatLE(value, at(i, k));
  };
  return { accessor, count: accessor.count, read, write };
}

/** Local and global node matrices of the scene graph. */
function nodeMatrices(json) {
  const local = json.nodes.map((node) =>
    node.matrix
      ? new T.Matrix4().fromArray(node.matrix)
      : new T.Matrix4().compose(
          new T.Vector3(...(node.translation ?? [0, 0, 0])),
          new T.Quaternion(...(node.rotation ?? [0, 0, 0, 1])),
          new T.Vector3(...(node.scale ?? [1, 1, 1])),
        ),
  );
  const parent = json.nodes.map(() => -1);
  json.nodes.forEach((node, i) =>
    node.children?.forEach((child) => (parent[child] = i)),
  );
  const global = json.nodes.map(() => null);
  const of = (i) =>
    (global[i] ??=
      parent[i] < 0
        ? local[i].clone()
        : of(parent[i]).clone().multiply(local[i]));
  json.nodes.forEach((_, i) => of(i));
  return { local, parent, global };
}

const position = (matrix) => new T.Vector3().setFromMatrixPosition(matrix);
const rotateAbout = (point, quaternion) =>
  new T.Matrix4()
    .makeTranslation(point)
    .multiply(new T.Matrix4().makeRotationFromQuaternion(quaternion))
    .multiply(new T.Matrix4().makeTranslation(point.clone().negate()));
const degrees = (a, b) => T.MathUtils.radToDeg(a.angleTo(b));
const median = (values) => {
  const sorted = Float64Array.from(values).sort();
  const middle = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Meshy's rest pose stands with the knees bent and the legs apart (knees
 * 9–34°, hips to ankles 5–10° off vertical). The studio grounds a character
 * by the extent of its rest pose and then plays recordings whose legs are
 * straight, so the feet reach below the floor by whatever the bend and the
 * splay took from the height: the pirate sank 6 cm and overlapped the stage.
 * The rest pose is re-posed instead: each leg is straightened and swung
 * vertical from the hip, the foot keeps its orientation, the skinned vertices
 * follow and the leg joints' inverse bind matrices are rebuilt, so the file
 * shows the same character standing tall. */
function straightenLegs(json, rest, slug) {
  const byName = new Map(json.nodes.map((node, i) => [node.name, i]));
  const skin = json.skins[0];
  const { local, parent, global } = nodeMatrices(json);
  const ibm = accessorView(json, rest, skin.inverseBindMatrices);
  const bind = skin.joints.map((_, k) =>
    new T.Matrix4().fromArray(
      Array.from({ length: 16 }, (_, e) => ibm.read(k, e)),
    ),
  );
  // With the bind pose as the rest pose, every joint maps the stored
  // vertices to the world by one and the same transform.
  const shown = global[skin.joints[0]].clone().multiply(bind[0]);
  skin.joints.forEach((node, k) => {
    const other = global[node].clone().multiply(bind[k]);
    if (other.elements.some((e, i) => Math.abs(e - shown.elements[i]) > 1e-3))
      throw Error(`${slug}: bind pose differs from rest pose`);
  });
  const down = new T.Vector3(0, -1, 0);
  const changed = new Map();
  for (const side of ["Left", "Right"]) {
    const [thigh, shin, foot, toe] = ["UpLeg", "Leg", "Foot", "ToeBase"].map(
      (bone) => byName.get(side + bone),
    );
    if (
      [thigh, shin, foot].includes(undefined) ||
      parent[shin] !== thigh ||
      parent[foot] !== shin
    )
      throw Error(`${slug}: unexpected ${side.toLowerCase()} leg`);
    const hip = position(global[thigh]);
    const knee = position(global[shin]);
    const ankle = position(global[foot]);
    const straighten = rotateAbout(
      knee,
      new T.Quaternion().setFromUnitVectors(
        ankle.clone().sub(knee).normalize(),
        knee.clone().sub(hip).normalize(),
      ),
    );
    const lower = rotateAbout(
      hip,
      new T.Quaternion().setFromUnitVectors(
        knee.clone().sub(hip).normalize(),
        down,
      ),
    );
    const footMoved = lower.clone().multiply(straighten).multiply(global[foot]);
    const footRotation = new T.Quaternion();
    const footScale = new T.Vector3();
    global[foot].decompose(new T.Vector3(), footRotation, footScale);
    const footGlobal = new T.Matrix4().compose(
      position(footMoved),
      footRotation,
      footScale,
    );
    changed.set(thigh, lower.clone().multiply(global[thigh]));
    changed.set(
      shin,
      lower.clone().multiply(straighten).multiply(global[shin]),
    );
    changed.set(foot, footGlobal);
    if (toe !== undefined)
      changed.set(toe, footGlobal.clone().multiply(local[toe]));
  }
  // Only rotations change: every joint keeps its place in its parent.
  for (const [node, matrix] of changed) {
    const parentGlobal = changed.get(parent[node]) ?? global[parent[node]];
    const rotation = new T.Quaternion();
    parentGlobal
      .clone()
      .invert()
      .multiply(matrix)
      .decompose(new T.Vector3(), rotation, new T.Vector3());
    if (json.nodes[node].matrix)
      throw Error(`${slug}: leg joint uses a matrix`);
    json.nodes[node].rotation = rotation.toArray();
  }
  // Pose the skin by the nodes as written, so the file is exactly consistent.
  const posed = nodeMatrices(json).global;
  const shownInverse = shown.clone().invert();
  const jointMatrix = skin.joints.map((node, k) =>
    shownInverse.clone().multiply(posed[node]).multiply(bind[k]),
  );
  const seen = new Set();
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) {
      const a = primitive.attributes;
      if (a.JOINTS_0 === undefined || seen.has(a.POSITION)) continue;
      seen.add(a.POSITION);
      if (a.TANGENT !== undefined)
        throw Error(`${slug}: tangents are not re-posed`);
      const positions = accessorView(json, rest, a.POSITION);
      const normals =
        a.NORMAL !== undefined && accessorView(json, rest, a.NORMAL);
      const joints = accessorView(json, rest, a.JOINTS_0);
      const weights = accessorView(json, rest, a.WEIGHTS_0);
      const blend = new T.Matrix4();
      const normalMatrix = new T.Matrix3();
      const vertex = new T.Vector3();
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < positions.count; i++) {
        blend.elements.fill(0);
        let total = 0;
        for (let k = 0; k < 4; k++) {
          const weight = weights.read(i, k);
          if (!weight) continue;
          total += weight;
          const part = jointMatrix[joints.read(i, k)].elements;
          for (let e = 0; e < 16; e++) blend.elements[e] += weight * part[e];
        }
        if (total < 0.5) throw Error(`${slug}: vertex ${i} is not skinned`);
        vertex
          .set(positions.read(i, 0), positions.read(i, 1), positions.read(i, 2))
          .applyMatrix4(blend);
        vertex.toArray().forEach((value, axis) => {
          positions.write(i, axis, value);
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
        });
        if (normals) {
          vertex
            .set(normals.read(i, 0), normals.read(i, 1), normals.read(i, 2))
            .applyNormalMatrix(normalMatrix.getNormalMatrix(blend))
            .normalize();
          vertex
            .toArray()
            .forEach((value, axis) => normals.write(i, axis, value));
        }
      }
      positions.accessor.min = min;
      positions.accessor.max = max;
    }
  skin.joints.forEach((node, k) => {
    if (!changed.has(node)) return;
    const matrix = posed[node].clone().invert().multiply(shown);
    matrix.elements.forEach((value, e) => ibm.write(k, e, value));
  });
  for (const side of ["Left", "Right"]) {
    const [hip, knee, ankle] = ["UpLeg", "Leg", "Foot"].map((bone) =>
      position(posed[byName.get(side + bone)]),
    );
    const thigh = knee.clone().sub(hip);
    const shin = ankle.clone().sub(knee);
    if (degrees(thigh, down) > 0.5 || degrees(shin, thigh) > 0.5)
      throw Error(`${slug}: ${side.toLowerCase()} leg is not straight`);
  }
}

/** Meshy numbers the spine from the top down (Spine02 sits on the hips,
 * Spine carries the shoulders); the studio's rig recognition, like Mixamo,
 * counts up from the hips. Renaming keeps the chest and shoulders where a
 * captured torso bend expects them. */
function renameSpine(json, slug) {
  const byName = new Map(json.nodes.map((n) => [n.name, n]));
  const chain = ["Hips", "Spine02", "Spine01", "Spine"].map((n) =>
    byName.get(n),
  );
  for (let i = 1; i < chain.length; i++)
    if (
      !chain[i] ||
      !chain[i - 1]?.children?.includes(json.nodes.indexOf(chain[i]))
    )
      throw Error(
        `${slug}: unexpected spine, no Hips > Spine02 > Spine01 > Spine`,
      );
  chain[1].name = "Spine";
  chain[2].name = "Spine1";
  chain[3].name = "Spine2";
}

/** The BIN chunk with `data` appended in a new buffer view; returns the
 * chunk and the view's index. */
function appendBinary(json, rest, data) {
  const length = rest.readUInt32LE(0);
  const offset = Math.ceil(length / 4) * 4;
  const body = Buffer.concat([
    rest.subarray(8, 8 + length),
    Buffer.alloc(offset - length),
    data,
    Buffer.alloc((4 - (data.length % 4)) % 4),
  ]);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(body.length, 0);
  header.writeUInt32LE(0x004e4942, 4); // "BIN"
  json.buffers[0].byteLength = offset + data.length;
  json.bufferViews.push({
    buffer: 0,
    byteOffset: offset,
    byteLength: data.length,
  });
  return {
    rest: Buffer.concat([header, body]),
    view: json.bufferViews.length - 1,
  };
}

/** Meshy's hands have no finger joints, and the studio straightens a wrist
 * for its anatomical neutral only from the joints under the hand. These hands
 * hang bent 15–25° at the wrist in the rest pose, so that bend stayed in the
 * neutral and every recording added it to the captured wrist: in Wave hello
 * the raised hand folded sideways. One unweighted joint at the centre of the
 * knuckles gives the studio its reference without touching the mesh. The
 * centre is measured from the skin: the median of the hand's vertices across
 * the first finger segments (a median, so the thumb lying beside them does
 * not pull it), found by iterating along its own direction from the wrist.
 * On the Rocketbox and Samurai hands, whose finger joints are known, that
 * direction lies within 6° of the real knuckles'. A lone joint names no
 * thumb, so the forearm keeps the roll of its rest pose (palms toward the
 * thighs). Returns the BIN chunk, which grows by the new inverse bind
 * matrices. */
function markKnuckles(json, rest, slug) {
  const byName = new Map(json.nodes.map((node, i) => [node.name, i]));
  const skin = json.skins[0];
  const { global } = nodeMatrices(json);
  const ibm = accessorView(json, rest, skin.inverseBindMatrices);
  const bind = skin.joints.map((_, k) =>
    new T.Matrix4().fromArray(
      Array.from({ length: 16 }, (_, e) => ibm.read(k, e)),
    ),
  );
  // The bind pose is the rest pose (checked when the legs were straightened).
  const shown = global[skin.joints[0]].clone().multiply(bind[0]);
  const hands = ["Left", "Right"]
    .map((side) => ({
      side,
      hand: byName.get(side + "Hand"),
      forearm: byName.get(side + "ForeArm"),
    }))
    .filter(({ side, hand, forearm }) => {
      if (hand === undefined || forearm === undefined)
        throw Error(`${slug}: no ${side.toLowerCase()} hand`);
      // Finger joints give the studio its reference already.
      return !json.nodes[hand].children?.some((c) => skin.joints.includes(c));
    });
  if (!hands.length) return rest;
  // Rest-pose vertices carried mostly by each hand.
  const points = new Map(hands.map(({ hand }) => [hand, []]));
  const slot = new Map(
    hands.map(({ hand }) => [skin.joints.indexOf(hand), hand]),
  );
  const seen = new Set();
  for (const mesh of json.meshes)
    for (const primitive of mesh.primitives) {
      const a = primitive.attributes;
      if (a.JOINTS_0 === undefined || seen.has(a.POSITION)) continue;
      seen.add(a.POSITION);
      const positions = accessorView(json, rest, a.POSITION);
      const joints = accessorView(json, rest, a.JOINTS_0);
      const weights = accessorView(json, rest, a.WEIGHTS_0);
      for (let i = 0; i < positions.count; i++)
        for (const [k, hand] of slot) {
          let weight = 0;
          for (let j = 0; j < 4; j++)
            if (joints.read(i, j) === k) weight += weights.read(i, j);
          if (weight >= 0.5)
            points
              .get(hand)
              .push(
                new T.Vector3(
                  positions.read(i, 0),
                  positions.read(i, 1),
                  positions.read(i, 2),
                ).applyMatrix4(shown),
              );
        }
    }
  const added = hands.map(({ side, hand, forearm }) => {
    const cloud = points.get(hand);
    if (cloud.length < 100)
      throw Error(`${slug}: ${side.toLowerCase()} hand has no skin`);
    const wrist = position(global[hand]);
    let axis = wrist.clone().sub(position(global[forearm])).normalize();
    let reach = 0;
    for (let i = 0; i < 8; i++) {
      const along = cloud.map((p) => p.clone().sub(wrist).dot(axis));
      reach = Math.max(...along);
      const slab = cloud
        .filter((_, j) => along[j] > 0.55 * reach && along[j] < 0.75 * reach)
        .map((p) => p.clone().sub(wrist));
      if (!slab.length)
        throw Error(`${slug}: ${side.toLowerCase()} hand has no fingers`);
      const across = new T.Vector3(1, 0, 0);
      if (Math.abs(across.dot(axis)) > 0.9) across.set(0, 1, 0);
      across.addScaledVector(axis, -across.dot(axis)).normalize();
      const frame = [axis, across, new T.Vector3().crossVectors(axis, across)];
      axis = frame
        .reduce(
          (centre, direction) =>
            centre.addScaledVector(
              direction,
              median(slab.map((p) => p.dot(direction))),
            ),
          new T.Vector3(),
        )
        .normalize();
    }
    // The knuckles sit about half way from the wrist to the fingertips.
    const local = wrist
      .clone()
      .addScaledVector(axis, 0.5 * reach)
      .applyMatrix4(global[hand].clone().invert());
    const node =
      json.nodes.push({
        name: side + "HandKnuckles",
        translation: local.toArray(),
      }) - 1;
    (json.nodes[hand].children ??= []).push(node);
    const inverseBind = global[hand]
      .clone()
      .multiply(new T.Matrix4().makeTranslation(local))
      .invert()
      .multiply(shown);
    return { node, inverseBind };
  });
  // The new joints go last, so the skin's joint indices stay as they are.
  skin.joints.push(...added.map(({ node }) => node));
  const matrices = [...bind, ...added.map(({ inverseBind }) => inverseBind)];
  const data = Buffer.alloc(matrices.length * 64);
  matrices.forEach((matrix, k) =>
    matrix.elements.forEach((value, e) =>
      data.writeFloatLE(value, (k * 16 + e) * 4),
    ),
  );
  const appended = appendBinary(json, rest, data);
  skin.inverseBindMatrices =
    json.accessors.push({
      bufferView: appended.view,
      componentType: 5126,
      count: matrices.length,
      type: "MAT4",
    }) - 1;
  return appended.rest;
}

/** Drop the bundled clips, name the spine the Mixamo way, stand the rest
 * pose on straight legs, mark the knuckles of hands without fingers and
 * settle the material: one textured, double-sided material per character
 * whose metal mask is kept only where the outfit has metal. */
function correctGlb(file, character) {
  const { json, rest } = readGlb(file);
  const name = path.basename(file);
  for (const material of json.materials ?? []) {
    material.pbrMetallicRoughness ??= {};
    const pbr = material.pbrMetallicRoughness;
    if (!pbr.baseColorTexture)
      throw Error(`${name}: ${material.name} has no texture`);
    if (!character.metal) pbr.metallicFactor = 0;
    else delete pbr.metallicFactor;
    delete pbr.roughnessFactor;
  }
  if (json.skins?.length !== 1) throw Error(`${name}: expected one skin`);
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((e) => e.uri))
    throw Error(`${name} is not self-contained`);
  for (const image of json.images ?? [])
    if (!["image/jpeg", "image/png"].includes(image.mimeType))
      throw Error(`${name}: ${image.mimeType} texture`);
  delete json.animations;
  renameSpine(json, character.slug);
  straightenLegs(json, rest, character.slug);
  writeGlb(file, json, markKnuckles(json, rest, character.slug));
}

// Blender renders the card: the converted character in its rest pose, framed
// like the Rocketbox previews (three-quarter view, the figure filling the
// square with a small margin) on a transparent background.
const THUMBNAIL_PY = `
import bpy, sys
from mathutils import Vector
src, dst = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
# The importer adds a hidden icosphere as a bone display shape; frame only the
# visible meshes.
depsgraph = bpy.context.evaluated_depsgraph_get()
points = []
for original in list(bpy.context.scene.objects):
    if original.type != 'MESH' or original.hide_render or not original.visible_get():
        continue
    evaluated = original.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    points.extend(evaluated.matrix_world @ v.co for v in mesh.vertices)
    evaluated.to_mesh_clear()
low = Vector(tuple(min(p[i] for p in points) for i in range(3)))
high = Vector(tuple(max(p[i] for p in points) for i in range(3)))
height, center = high.z - low.z, (high + low) / 2
bpy.ops.object.camera_add(location=center + Vector((0.65, -2.7, 0.4)) * height)
camera = bpy.context.object
camera.rotation_euler = (center - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = height * 1.08
scene = bpy.context.scene
scene.camera = camera
for offset, energy, size in [((2, -3, 4), 650, 4), ((-3, -1, 2), 350, 4), ((1, 2, 3), 500, 3)]:
    bpy.ops.object.light_add(type='AREA', location=center + Vector(offset) * height / 2)
    light = bpy.context.object
    light.data.energy = energy * height * height / 4
    light.data.shape = 'DISK'
    light.data.size = size * height / 2
    light.rotation_euler = (center - light.location).to_track_quat('-Z', 'Y').to_euler()
scene.world = bpy.data.worlds.new('World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.8, 0.9, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.4
# EEVEE is BLENDER_EEVEE_NEXT in Blender 4.2-4.5 and BLENDER_EEVEE again from 5.0.
engines = {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items}
scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 64
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 384
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = dst
bpy.ops.render.render(write_still=True)
`;

async function convert(character, source, { out, cache, root, log }) {
  const id = idOf(character);
  const dir = path.join(cache, "grab3d", character.slug);
  const glb = path.join(out, "characters", id + ".glb");
  const thumb = path.join(out, "characters", id + ".png");
  const stamp = path.join(dir, `converted-v${CONVERTER_VERSION}`);
  fs.mkdirSync(path.dirname(glb), { recursive: true });
  if (!fs.existsSync(glb) || !fs.existsSync(stamp)) {
    log(`converting ${character.slug}`);
    const work = path.join(dir, "prepared");
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const step = (name) => path.join(work, name + ".glb");
    await gltfTransform(root, ["weld", source, step("welded")]);
    // meshopt stops at the error bound before the ratio when the bound is
    // tight; the ratio is lowered until the budget is met.
    const count = triangles(readGlb(step("welded")).json);
    for (
      let ratio = Math.min(1, (0.92 * MAX_TRIANGLES) / count);
      ;
      ratio *= 0.85
    ) {
      await gltfTransform(root, [
        "simplify",
        step("welded"),
        step("simplified"),
        "--ratio",
        ratio.toFixed(3),
        "--error",
        "0.01",
      ]);
      if (triangles(readGlb(step("simplified")).json) <= MAX_TRIANGLES) break;
      if (ratio < 0.05)
        throw Error(
          `${character.slug}: cannot reach ${MAX_TRIANGLES} triangles`,
        );
    }
    correctGlb(step("simplified"), character);
    // prune drops the accessors the removed clips used.
    await gltfTransform(root, ["prune", step("simplified"), step("final")]);
    // Textures are only re-encoded when one is too large: resizing rewrites
    // every JPEG, and the packages already ship 2048 px.
    const pruned = readGlb(step("final"));
    const oversized = (pruned.json.images ?? []).some((image) => {
      const { width, height } = imageSize(imageBytes(pruned, image));
      return Math.max(width, height) > MAX_TEXTURE;
    });
    if (oversized) {
      fs.renameSync(step("final"), step("pruned"));
      await gltfTransform(root, [
        "resize",
        step("pruned"),
        step("final"),
        "--width",
        String(MAX_TEXTURE),
        "--height",
        String(MAX_TEXTURE),
      ]);
    }
    fs.copyFileSync(step("final"), glb + ".part");
    fs.renameSync(glb + ".part", glb);
    fs.rmSync(work, { recursive: true, force: true });
    // The card shows the rest pose, so it follows the file.
    fs.rmSync(thumb, { force: true });
    fs.writeFileSync(stamp, "");
  }
  if (!fs.existsSync(thumb)) {
    await blender(root, path.join(cache, "grab3d", "thumbnail.py"), [
      glb,
      thumb + ".part.png",
    ]);
    fs.renameSync(thumb + ".part.png", thumb);
  }
}

export async function build({ out, cache, root, log }) {
  // CHARACTERS_ONLY=<id>,<id> rebuilds just those (for converter work).
  const only = process.env.CHARACTERS_ONLY?.split(",");
  const characters = only ? cast.filter((c) => only.includes(idOf(c))) : cast;
  const dir = path.join(cache, "grab3d");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "thumbnail.py"), THUMBNAIL_PY);
  // A character that fails (a changed package, the network, Blender) is
  // reported and only that character is left out.
  const failed = (character) => (error) =>
    log(`could not build ${character.name}: ${error.message}`);
  const sources = new Map();
  await pool(characters, 4, (character) =>
    fetchPackage(character, path.join(dir, character.slug), log).then(
      (file) => sources.set(character, file),
      failed(character),
    ),
  );
  // The renders share the GPU: a few side by side is enough.
  await pool([...sources.keys()], 3, (character) =>
    convert(character, sources.get(character), {
      out,
      cache,
      root,
      log,
    }).catch(failed(character)),
  );
  const built = (c, extension) =>
    fs.existsSync(path.join(out, "characters", idOf(c) + extension));
  return cast
    .filter((c) => built(c, ".glb") && built(c, ".png"))
    .map((c) => ({
      id: idOf(c),
      name: c.name,
      category: "characters",
      style: c.style,
      body: c.body,
      url: `/content/characters/${idOf(c)}.glb`,
      thumbnail: `/content/characters/${idOf(c)}.png`,
      description: c.description,
      credit: {
        author: "Alexander Popov (Grab3D), AI-assisted",
        license: "CC0",
        source: `${SITE}/models/characters/${c.slug}/`,
      },
    }));
}
