// Helpers shared by the content modules: a bounded worker pool, a patient
// downloader, the Blender runner, GLB JSON rewriting, a character's measured
// height and the thumbnail crop of an upstream preview render.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Box3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/** Runs `work` over `items` with at most `limit` jobs in flight. */
export async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

// raw.githubusercontent answers a large blob that is not yet in GitHub's cache
// with a 503 or a stalled body after ~30s, and serves it in seconds once a
// request has warmed it. Keep retrying each file until it arrives whole.
export async function download(url, file, size) {
  if (fs.existsSync(file) && fs.statSync(file).size === size) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
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
    if (attempt >= 30) throw Error(`could not download ${url}`);
    await new Promise((r) => setTimeout(r, Math.min(30, attempt * 3) * 1000));
  }
}

/** Runs a Blender Python script headless and resolves with its output. */
export function blender(root, script, args) {
  const exe = process.env.BLENDER_PATH || blenderPath(root);
  return new Promise((resolve, reject) => {
    const child = spawn(
      exe,
      ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", ...args],
      { cwd: root, timeout: 600_000 },
    );
    let output = "";
    child.stdout.on("data", (d) => (output = (output + d).slice(-20000)));
    child.stderr.on("data", (d) => (output = (output + d).slice(-20000)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(Error(`Blender failed on ${args[0]}: ${output.slice(-2000)}`)),
    );
  });
}
export function blenderPath(root) {
  for (const candidate of [
    path.join(root, ".data/tools/blender/blender"),
    path.resolve(root, "../scene-maker/.data/tools/blender/blender"),
  ])
    if (fs.existsSync(candidate)) return candidate;
  return "blender";
}

/** Writes a Blender helper script into `dir` (a source's cache folder) and
 * returns its path, so the build never runs a script from a download. */
export function blenderScript(dir, name, source) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== source)
    fs.writeFileSync(file, source);
  return file;
}

/** Splits a GLB into its JSON and the binary chunk(s) that follow. */
export function readGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  return {
    json: JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")),
    rest: bytes.subarray(20 + jsonLength),
  };
}

/** `json` in front of `rest` as GLB bytes. */
function glbBytes(json, rest) {
  let text = Buffer.from(JSON.stringify(json), "utf8");
  if (text.length % 4)
    text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const header = Buffer.alloc(20);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(20 + text.length + rest.length, 8);
  header.writeUInt32LE(text.length, 12);
  header.write("JSON", 16, "ascii");
  return Buffer.concat([header, text, rest]);
}

/** Writes `json` in front of `rest` as a GLB. */
export function writeGlb(file, json, rest) {
  fs.writeFileSync(file, glbBytes(json, rest));
}

/** Edits a GLB's JSON in place. The library is served as single files, so a
 * GLB that still points at an external buffer or image is refused. */
export function rewriteGlb(file, edit) {
  const { json, rest } = readGlb(file);
  edit(json);
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((e) => e.uri))
    throw Error(`${path.basename(file)} is not self-contained`);
  writeGlb(file, json, rest);
}

/** A character's standing height in metres: the bind-pose bounds of the GLB
 * as the studio's loader sees them, so the catalogue can record how tall each
 * person really is. Textures are dropped before parsing because Node has no
 * image decoder, and a skinned mesh's bounds come from its bones, not from
 * the raw vertex box. */
export async function glbHeight(file) {
  const { json, rest } = readGlb(file);
  for (const material of json.materials ?? [])
    for (const part of [material, material.pbrMetallicRoughness ?? {}])
      for (const key of Object.keys(part))
        if (key.endsWith("Texture")) delete part[key];
  delete json.images;
  delete json.textures;
  delete json.samplers;
  const glb = glbBytes(json, rest);
  const gltf = await new GLTFLoader().parseAsync(
    glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength),
    "",
  );
  gltf.scene.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(gltf.scene);
  return bounds.max.y - bounds.min.y;
}

// Quaternion helpers for attachClaviclesToChest.
const qmul = ([ax, ay, az, aw], [bx, by, bz, bw]) => [
  aw * bx + ax * bw + ay * bz - az * by,
  aw * by - ax * bz + ay * bw + az * bx,
  aw * bz + ax * by - ay * bx + az * bw,
  aw * bw - ax * bx - ay * by - az * bz,
];
const qrotate = (q, [x, y, z]) =>
  qmul(qmul(q, [x, y, z, 0]), [-q[0], -q[1], -q[2], q[3]]).slice(0, 3);

/** 3ds Max Biped hangs both clavicles from the neck, so the neck is the
 * branch that carries the arms: a captured neck bend would have to swing the
 * shoulders, and the studio leaves it on the head instead. Re-parent the
 * clavicles to the top spine bone, keeping every joint's world bind (skin
 * inverse binds are world-space, so the skinning is unchanged). The neck then
 * holds just the head and bends like a human neck. */
export function attachClaviclesToChest(json) {
  const nodes = json.nodes;
  const find = (re) => nodes.findIndex((n) => re.test(n.name ?? ""));
  const neck = find(/^Bip01[ _]Neck$/),
    chest = find(/^Bip01[ _]Spine2$/);
  if (neck < 0 || chest < 0 || !nodes[chest].children?.includes(neck))
    throw Error("Unexpected Biped spine: no Spine2 > Neck");
  const n = nodes[neck];
  if ((n.scale ?? [1, 1, 1]).some((v) => Math.abs(v - 1) > 1e-3))
    throw Error("Scaled Biped neck");
  const nt = n.translation ?? [0, 0, 0],
    nr = n.rotation ?? [0, 0, 0, 1];
  for (const side of ["L", "R"]) {
    const clavicle = find(new RegExp(`^Bip01[ _]${side}[ _]Clavicle$`));
    if (clavicle < 0 || !n.children.includes(clavicle))
      throw Error(`Unexpected Biped ${side} clavicle`);
    const c = nodes[clavicle];
    const t = qrotate(nr, c.translation ?? [0, 0, 0]);
    c.translation = [nt[0] + t[0], nt[1] + t[1], nt[2] + t[2]];
    c.rotation = qmul(nr, c.rotation ?? [0, 0, 0, 1]);
    n.children = n.children.filter((i) => i !== clavicle);
    nodes[chest].children.push(clavicle);
  }
}

// Crops an upstream preview render to the figure and scales it to a square
// card; a 16-bit preview loads as a linear float buffer and is converted to
// 8-bit sRGB.
const THUMBNAIL_PY = `
import bpy, sys
import numpy as np
src, dst = sys.argv[sys.argv.index('--') + 1:]
img = bpy.data.images.load(src)
w, h = img.size
px = np.empty(w * h * 4, dtype=np.float32)
img.pixels.foreach_get(px)
px = px.reshape(h, w, 4)
ys, xs = np.nonzero(px[:, :, 3] > 0.05)
cx, top, bottom = (xs.min() + xs.max()) / 2, ys.min(), ys.max()
side = int((bottom - top) * 1.08)
x0, y0 = int(cx - side / 2), int((top + bottom) / 2 - side / 2)
out = np.zeros((side, side, 4), dtype=np.float32)
sx0, sy0 = max(0, x0), max(0, y0)
sx1, sy1 = min(w, x0 + side), min(h, y0 + side)
out[sy0 - y0:sy1 - y0, sx0 - x0:sx1 - x0] = px[sy0:sy1, sx0:sx1]
# A 16-bit preview loads as a linear float buffer; the card is 8-bit sRGB.
if img.is_float:
    rgb = out[:, :, :3]
    out[:, :, :3] = np.where(rgb <= 0.0031308, rgb * 12.92,
                             1.055 * np.power(np.clip(rgb, 0, None), 1 / 2.4) - 0.055)
card = bpy.data.images.new('card', side, side, alpha=True)
card.pixels.foreach_set(out.ravel())
card.scale(384, 384)
card.file_format = 'PNG'
card.save(filepath=dst)
`;

/** Turns a source's preview render into a 384 px PNG card at `dst`. */
export async function cropPreview({ root, scriptDir, src, dst }) {
  const script = blenderScript(scriptDir, "thumbnail.py", THUMBNAIL_PY);
  await blender(root, script, [src, dst + ".part.png"]);
  fs.renameSync(dst + ".part.png", dst);
}
