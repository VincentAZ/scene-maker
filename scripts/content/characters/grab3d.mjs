// Realistic characters from Grab3D (CC0, grab3d.com): AI-assisted humans by
// Alexander Popov, rigged by Meshy with a Mixamo-named skeleton. The skeleton
// has no face bones and, apart from the samurai and the viking, no finger
// bones, so hands stay in their relaxed rest pose. Each rigged GLB is
// downloaded with its manifest and LICENSE.txt, and a model is only used once
// its LICENSE.txt dedicates the package to the public domain. The mesh is
// then simplified to at most 120k triangles with glTF Transform (meshopt keeps
// the skin weights), textures are capped at 2048 px, the bundled walk and run
// clips are dropped (the studio has its own recordings) and the material is
// made dielectric unless the outfit carries metal. Idempotent: downloads are
// cached in content/.cache/grab3d/<slug> and a character is converted again
// only when its GLB or thumbnail is missing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SITE = "https://grab3d.com";
// Pinned so every machine simplifies the same way; `npx` fetches it on demand.
const GLTF_TRANSFORM = "@gltf-transform/cli@4.2.1";
const MAX_TRIANGLES = 120_000;
const MAX_TEXTURE = 2048;
// Bump to rebuild every GLB after changing the converter.
const CONVERTER_VERSION = 1;

// The cast is the vetted subset of Grab3D's human characters: the ones whose
// faces, hands and textures hold up as real people (docs/CHARACTER_ASSETS.md
// lists the rejected ones and why). slug: the model page
// grab3d.com/models/characters/<slug>/. metal: the outfit has small metal
// parts (buckles, a blade, a prosthetic) whose painted metal mask is kept;
// otherwise the character is fully dielectric so stray mask values cannot
// darken skin or cloth. The knight's plate stays dielectric too: the studio
// stage has little for a metal to reflect, so a mostly-metal outfit turns
// almost black there. body: feminine | masculine.
export const cast = [
  // Everyday
  { slug: "man-base-character", name: "Man in a T-shirt", body: "masculine", style: "Everyday", description: "A man with short dark hair in a plain taupe T-shirt and charcoal shorts, barefoot." },
  { slug: "woman-base-character", name: "Woman in a sports top", body: "feminine", style: "Everyday", description: "A woman with her dark hair in a bun, in a taupe sports top and fitted charcoal shorts, barefoot." },
  // Uniformed
  { slug: "soldier", name: "Soldier", body: "masculine", style: "Uniformed", description: "A modern infantry soldier in grey-green digital camouflage with a helmet, plate carrier, knee pads, gloves and tan combat boots." },
  // Historical
  { slug: "samurai", name: "Samurai", body: "masculine", style: "Historical", metal: true, description: "A samurai in layered red lacquered armour edged with gold, a crested helmet and a katana at his hip." },
  { slug: "pirate", name: "Pirate captain", body: "masculine", style: "Historical", metal: true, description: "A pirate captain in a black tricorn hat with a red feather, a navy coat with brass buttons, a teal waistcoat, a coral sash and tall boots." },
  { slug: "ninja", name: "Ninja", body: "masculine", style: "Historical", description: "A masked ninja in a fitted indigo hood and wrapped jacket with a persimmon sash, forearm wraps and a short sword across his back." },
  // Fantasy
  { slug: "armored-knight", name: "Armoured knight", body: "masculine", style: "Fantasy", description: "A young knight in polished plate armour edged with gold, a royal-blue tabard with a golden sun and a tall blue plume." },
  // Sci-fi
  { slug: "sci-fi-soldier", name: "Sci-fi trooper", body: "masculine", style: "Sci-fi", description: "A futuristic trooper in slim white armour plates over a dark undersuit, with cyan accent lines and a visored helmet that hides the face." },
  { slug: "cyborg", name: "Cyborg courier", body: "masculine", style: "Sci-fi", metal: true, description: "A courier with an orange prosthetic left arm and lower leg, in a charcoal bomber jacket, cargo trousers and a backpack." },
];
const idOf = (c) => "grab3d-" + c.slug;

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
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (res.ok) return res.text();
      await res.body?.cancel();
      if (res.status === 404) throw Error(`${url}: not found`);
    } catch (error) {
      if (attempt >= 5) throw error;
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

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
 * a package that is not dedicated to the public domain is never used. */
async function fetchPackage(character, dir, log) {
  const base = `${SITE}/dl/${character.slug}-rigged/`;
  fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, "manifest.json");
  const licenseFile = path.join(dir, "LICENSE.txt");
  if (!fs.existsSync(manifestFile))
    fs.writeFileSync(manifestFile, await fetchText(base + "manifest.json"));
  if (!fs.existsSync(licenseFile))
    fs.writeFileSync(licenseFile, await fetchText(base + "LICENSE.txt"));
  const license = fs.readFileSync(licenseFile, "utf8");
  if (!/CC0 1\.0 Universal/.test(license) || !/public domain/i.test(license))
    throw Error(`${character.slug}: LICENSE.txt is not a CC0 dedication`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const glb = manifest.files?.glb;
  if (!glb?.name || !glb.bytes)
    throw Error(`${character.slug}: manifest lists no rigged GLB`);
  const file = path.join(dir, glb.name);
  if (!(fs.existsSync(file) && fs.statSync(file).size === glb.bytes))
    log(`downloading ${character.slug} (${(glb.bytes / 1e6).toFixed(1)} MB)`);
  await download(base + glb.name, file, glb.bytes);
  return file;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, timeout: 600_000 });
    let output = "";
    child.stdout.on("data", (d) => (output = (output + d).slice(-20000)));
    child.stderr.on("data", (d) => (output = (output + d).slice(-20000)));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(output)
        : reject(Error(`${command} ${args[0]} failed: ${output.slice(-2000)}`)),
    );
  });
}
const gltfTransform = (root, args) =>
  run("npx", ["-y", GLTF_TRANSFORM, ...args], root);

function blender(root, script, args) {
  const exe = process.env.BLENDER_PATH || blenderPath(root);
  return run(
    exe,
    ["--background", "--factory-startup", "--python-exit-code", "1", "--python", script, "--", ...args],
    root,
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
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) throw Error("not a JPEG marker");
    const marker = bytes[i + 1];
    if (marker >= 0xc0 && marker <= 0xc2)
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
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
          n +
          json.accessors[p.indices ?? p.attributes.POSITION].count / 3,
        0,
      ),
    0,
  );

/** Meshy numbers the spine from the top down (Spine02 sits on the hips,
 * Spine carries the shoulders); the studio's rig recognition, like Mixamo,
 * counts up from the hips. Renaming keeps the chest and shoulders where a
 * captured torso bend expects them. */
function renameSpine(json, slug) {
  const byName = new Map(json.nodes.map((n) => [n.name, n]));
  const chain = ["Hips", "Spine02", "Spine01", "Spine"].map((n) => byName.get(n));
  for (let i = 1; i < chain.length; i++)
    if (!chain[i] || !chain[i - 1]?.children?.includes(json.nodes.indexOf(chain[i])))
      throw Error(`${slug}: unexpected spine, no Hips > Spine02 > Spine01 > Spine`);
  chain[1].name = "Spine";
  chain[2].name = "Spine1";
  chain[3].name = "Spine2";
}

/** Drop the bundled clips, name the spine the Mixamo way and settle the
 * material: one textured, double-sided material per character whose metal
 * mask is kept only where the outfit has metal. */
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
  writeGlb(file, json, rest);
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
scene.render.engine = 'BLENDER_EEVEE_NEXT'
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
    for (let ratio = Math.min(1, (0.92 * MAX_TRIANGLES) / count); ; ratio *= 0.85) {
      await gltfTransform(root, [
        "simplify", step("welded"), step("simplified"),
        "--ratio", ratio.toFixed(3), "--error", "0.01",
      ]);
      if (triangles(readGlb(step("simplified")).json) <= MAX_TRIANGLES) break;
      if (ratio < 0.05) throw Error(`${character.slug}: cannot reach ${MAX_TRIANGLES} triangles`);
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
        "resize", step("pruned"), step("final"),
        "--width", String(MAX_TEXTURE), "--height", String(MAX_TEXTURE),
      ]);
    }
    fs.copyFileSync(step("final"), glb + ".part");
    fs.renameSync(glb + ".part", glb);
    fs.rmSync(work, { recursive: true, force: true });
    fs.writeFileSync(stamp, "");
  }
  if (!fs.existsSync(thumb)) {
    await blender(root, path.join(cache, "grab3d", "thumbnail.py"), [glb, thumb + ".part.png"]);
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
  const sources = new Map();
  await pool(characters, 4, async (character) => {
    sources.set(character, await fetchPackage(character, path.join(dir, character.slug), log));
  });
  // The renders share the GPU: a few side by side is enough.
  await pool(characters, 3, (character) =>
    convert(character, sources.get(character), { out, cache, root, log }),
  );
  return cast
    .filter((c) => fs.existsSync(path.join(out, "characters", idOf(c) + ".glb")))
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
