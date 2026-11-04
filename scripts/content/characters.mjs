// Realistic characters: rigged, textured humans from Microsoft Rocketbox
// (MIT, github.com/microsoft/Microsoft-Rocketbox). Each avatar's FBX and its
// colour, normal and opacity textures are downloaded, the TGA textures are
// shrunk and re-encoded (JPEG; PNG with alpha for hair and lashes), the FBX
// goes through the app's own importer (engine/convert.py), and the resulting
// GLB's materials are corrected: Rocketbox ships every material as fully
// metallic, which renders skin and cloth as dark chrome. Idempotent:
// downloads are cached in content/.cache/rocketbox and an avatar is converted
// again only when its GLB or thumbnail is missing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The library is pinned to this upstream commit.
const COMMIT = "0943055db6ec570bcef9f2c8b41c9e5467c808f9";
const REPO = "https://github.com/microsoft/Microsoft-Rocketbox";
const RAW = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/`;
// Bump to rebuild every GLB after changing the converter.
const CONVERTER_VERSION = 3;

// folder: Assets/Avatars/<folder>. body: feminine | masculine.
export const cast = [
  // Everyday
  { folder: "Adults/Female_Adult_01", name: "Emma", body: "feminine", style: "Everyday", description: "A blonde woman in a pink blouse, jeans and flats." },
  { folder: "Adults/Female_Adult_04", name: "Hanna", body: "feminine", style: "Everyday", description: "A blonde woman in a brown leather jacket, cargo trousers and boots." },
  { folder: "Adults/Female_Adult_06", name: "Amira", body: "feminine", style: "Everyday", description: "A woman in a white headscarf and an olive tunic over trousers." },
  { folder: "Adults/Female_Adult_08", name: "Sofia", body: "feminine", style: "Everyday", description: "A brunette woman in a grey print T-shirt and ripped jeans." },
  { folder: "Adults/Female_Adult_11", name: "Lucia", body: "feminine", style: "Everyday", description: "A dark-haired woman in a brown knit dress with a belt and tall boots." },
  { folder: "Adults/Female_Adult_12", name: "Mia", body: "feminine", style: "Everyday", description: "A young woman in a black zip hoodie, denim shorts and trainers." },
  { folder: "Adults/Female_Adult_15", name: "Claire", body: "feminine", style: "Everyday", description: "A woman with long auburn hair in a blue blouse, black skirt and boots." },
  { folder: "Adults/Female_Adult_17", name: "Grace", body: "feminine", style: "Everyday", description: "A blonde woman in a green T-shirt and light jeans." },
  { folder: "Adults/Male_Adult_03", name: "Richard", body: "masculine", style: "Everyday", description: "A grey-haired older man in a tweed jacket and dark trousers." },
  { folder: "Adults/Male_Adult_04", name: "Marcus", body: "masculine", style: "Everyday", description: "A man with curly hair in a black jacket over a hoodie and work trousers." },
  { folder: "Adults/Male_Adult_10", name: "Kenji", body: "masculine", style: "Everyday", description: "A young man in a red track jacket, black track trousers and trainers." },
  { folder: "Adults/Male_Adult_12", name: "Daniel", body: "masculine", style: "Everyday", description: "A man in a denim jacket over a white T-shirt and jeans." },
  { folder: "Adults/Male_Adult_13", name: "Thomas", body: "masculine", style: "Everyday", description: "A balding man in an argyle sweater vest and jeans." },
  { folder: "Adults/Male_Adult_15", name: "Omar", body: "masculine", style: "Everyday", description: "A bearded man in a white kurta, trousers and a prayer cap." },
  { folder: "Adults/Male_Adult_17", name: "Arjun", body: "masculine", style: "Everyday", description: "A bearded man in a blue and white sports jacket and jeans." },
  { folder: "Adults/Male_Adult_18", name: "Kwame", body: "masculine", style: "Everyday", description: "A man in a grey hoodie with the hood up and black trousers." },
  { folder: "Adults/Female_Party_02", name: "Zara", body: "feminine", style: "Everyday", description: "A woman with curly hair in a patterned top, black mini skirt and sandals, dressed for an evening out." },
  // Business
  { folder: "Professions/Business_Female_01", name: "Nia", role: "Executive", body: "feminine", style: "Business", description: "A woman in a black trouser suit and white shirt." },
  { folder: "Professions/Business_Female_02", name: "Margaret", role: "Manager", body: "feminine", style: "Business", description: "An older woman with glasses in a burgundy blazer and dark trousers." },
  { folder: "Professions/Business_Female_03", name: "Elena", role: "Accountant", body: "feminine", style: "Business", description: "A woman in a brown skirt suit and heels." },
  { folder: "Professions/Business_Male_01", name: "James", role: "Executive", body: "masculine", style: "Business", description: "A man in a black suit with a red tie." },
  { folder: "Professions/Business_Male_04", name: "Viktor", role: "Office worker", body: "masculine", style: "Business", description: "A bald man in a grey waistcoat, shirt and dark trousers." },
  { folder: "Professions/Business_Male_05", name: "Andre", role: "Lawyer", body: "masculine", style: "Business", description: "A man in a checked charcoal suit with a purple shirt and tie." },
  // Medical
  { folder: "Professions/Medical_Female_02", name: "Laura", role: "Doctor", body: "feminine", style: "Medical", description: "A doctor in a white coat with a stethoscope." },
  { folder: "Professions/Medical_Female_01", name: "Rosa", role: "Nurse", body: "feminine", style: "Medical", description: "A nurse in a white tunic and trousers." },
  { folder: "Professions/Medical_Male_03", name: "Henry", role: "Doctor", body: "masculine", style: "Medical", description: "An older doctor in a white coat with a stethoscope." },
  { folder: "Professions/Medical_Male_04", name: "David", role: "Surgeon", body: "masculine", style: "Medical", description: "A surgeon in green scrubs, cap and face mask." },
  // Service
  { folder: "Professions/Chef_Female_01", name: "Mei", role: "Chef", body: "feminine", style: "Service", description: "A chef in a white jacket, apron and cap." },
  { folder: "Professions/Delivery_Male_01", name: "Lukas", role: "Courier", body: "masculine", style: "Service", description: "A bearded man in a beanie, red flannel shirt, jeans and work boots." },
  { folder: "Professions/Gardener_Male_01", name: "Frank", role: "Gardener", body: "masculine", style: "Service", description: "A gardener in brown overalls, gloves and yellow rubber boots." },
  // Uniformed
  { folder: "Professions/Police_Male_01", name: "Rashid", role: "Police officer", body: "masculine", style: "Uniformed", description: "A police officer in a light blue uniform and cap with a duty belt." },
  { folder: "Professions/Police_Male_03", name: "Ben", role: "Police officer", body: "masculine", style: "Uniformed", description: "A police officer in a dark uniform and peaked cap." },
  { folder: "Professions/Security_Female_01", name: "Nadia", role: "Security guard", body: "feminine", style: "Uniformed", description: "A security guard in a black uniform and cap." },
  { folder: "Professions/Pilot_Male_01", name: "Michael", role: "Pilot", body: "masculine", style: "Uniformed", description: "An airline captain in a black uniform with gold stripes and a cap." },
  { folder: "Professions/Pilot_Female_02", name: "Aisha", role: "Pilot", body: "feminine", style: "Uniformed", description: "A pilot in a white short-sleeved shirt, dark trousers and a white cap." },
  { folder: "Professions/Fire_Male_06", name: "Carlos", role: "Firefighter", body: "masculine", style: "Uniformed", description: "A firefighter in tan turnout gear and a helmet." },
  { folder: "Professions/Construction_Female_01", name: "Kate", role: "Construction worker", body: "feminine", style: "Uniformed", description: "A construction worker in blue overalls, a hi-vis vest and a hard hat." },
  { folder: "Professions/Construction_Male_03", name: "Samuel", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A construction worker in blue overalls, a tool belt and a hard hat." },
  // Sports
  { folder: "Professions/Sports_Female_02", name: "Yuna", role: "Athlete", body: "feminine", style: "Sports", description: "A woman in a grey tank top, track trousers and trainers." },
  { folder: "Professions/Sports_Male_02", name: "Leo", role: "Footballer", body: "masculine", style: "Sports", description: "A footballer in a striped kit, socks and boots." },
  { folder: "Professions/Sports_Male_04", name: "Ryan", role: "Runner", body: "masculine", style: "Sports", description: "A runner in a blue vest, white shorts and running shoes." },
  // Children
  { folder: "Children/Female_Child_01", name: "Lily", body: "feminine", style: "Children", description: "A blonde girl in a pink T-shirt and jeans." },
  { folder: "Children/Male_Child_01", name: "Noah", body: "masculine", style: "Children", description: "A boy in a blue sweatshirt, jeans and trainers." },
  { folder: "Children/Male_Child_02", name: "Kofi", body: "masculine", style: "Children", description: "A boy in an orange number T-shirt, shorts and sandals." },
];
const avatarName = (a) => a.folder.split("/")[1];
const idOf = (a) =>
  "rocketbox-" + avatarName(a).toLowerCase().replaceAll("_", "-");

async function upstreamTree(cache, log) {
  const file = path.join(cache, "tree.json");
  if (!fs.existsSync(file)) {
    log("listing the Rocketbox repository");
    const res = await fetch(
      `https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/${COMMIT}?recursive=1`,
    );
    if (!res.ok) throw Error(`GitHub tree listing failed: ${res.status}`);
    fs.writeFileSync(file, await res.text());
  }
  return JSON.parse(fs.readFileSync(file, "utf8")).tree;
}

/** The upstream files each avatar needs: its FBX (without facial blend
 * shapes), its preview and its colour, normal and opacity textures. Specular
 * maps are skipped: the corrected materials are dielectric. */
function avatarFiles(tree, avatar) {
  const base = `Assets/Avatars/${avatar.folder}/`;
  const name = avatarName(avatar);
  const files = tree.filter(
    (t) =>
      t.type === "blob" &&
      (t.path === `${base}Export/${name}.fbx` ||
        t.path === `${base}${name}.png` ||
        (t.path.startsWith(`${base}Textures/`) &&
          /_(color|normal)(_[a-z])?\.tga$/i.test(t.path))),
  );
  if (!files.some((f) => f.path.endsWith(".fbx")))
    throw Error(`${name}: no FBX upstream`);
  return files;
}

// raw.githubusercontent answers a large blob that is not yet in GitHub's cache
// with a 503 or a stalled body after ~30s, and serves it in seconds once a
// request has warmed it. Keep retrying each file until it arrives whole.
async function download(url, file, size) {
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

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

export async function downloadAll({ cache, log, avatars = cast }) {
  const dir = path.join(cache, "rocketbox");
  fs.mkdirSync(dir, { recursive: true });
  const tree = await upstreamTree(dir, log);
  const jobs = avatars.flatMap((a) =>
    avatarFiles(tree, a).map((f) => ({
      url: RAW + f.path,
      size: f.size,
      file: path.join(
        dir,
        avatarName(a),
        f.path.slice(`Assets/Avatars/${a.folder}/`.length),
      ),
    })),
  );
  const missing = jobs.filter(
    (j) => !(fs.existsSync(j.file) && fs.statSync(j.file).size === j.size),
  );
  if (missing.length) log(`downloading ${missing.length} Rocketbox files`);
  let done = 0;
  await pool(missing, 24, async (j) => {
    await download(j.url, j.file, j.size);
    if (++done % 10 === 0 || done === missing.length)
      log(`  ${done}/${missing.length} files`);
  });
}

// Blender helpers, written next to the cache when the build runs.
// prepare: re-encode each TGA as JPEG (≤2k colour, ≤1k normal) or, for the
// RGBA hair/lash opacity sheet, PNG (≤1k). thumbnail: crop the upstream
// preview render to the figure and scale it to a square card.
const PREPARE_PY = `
import bpy, sys
args = sys.argv[sys.argv.index('--') + 1:]
for src, dst in zip(args[0::2], args[1::2]):
    img = bpy.data.images.load(src)
    alpha = dst.endswith('.png')
    normal = 'normal' in src.lower()
    limit = 1024 if (alpha or normal) else 2048
    w, h = img.size
    if max(w, h) > limit:
        s = limit / max(w, h)
        img.scale(max(1, round(w * s)), max(1, round(h * s)))
    if normal:
        img.colorspace_settings.name = 'Non-Color'
    img.file_format = 'PNG' if alpha else 'JPEG'
    if alpha:
        img.save(filepath=dst)
    else:
        img.save(filepath=dst, quality=88)
    bpy.data.images.remove(img)
`;
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

function blender(root, script, args) {
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
function blenderPath(root) {
  for (const candidate of [
    path.join(root, ".data/tools/blender/blender"),
    path.resolve(root, "../scene-maker/.data/tools/blender/blender"),
  ])
    if (fs.existsSync(candidate)) return candidate;
  return "blender";
}

/** Rocketbox FBX files name their textures *.tga. The prepared files are JPEG
 * or PNG (the glTF exporter only keeps a JPEG as JPEG when its name says so),
 * so rename each reference in place: ".tga" -> ".jpg"/".png" keeps every
 * string's length, which keeps the binary FBX valid. */
function patchFbx(source, destination) {
  const bytes = fs.readFileSync(source);
  const text = bytes.toString("latin1");
  const re = /[A-Za-z0-9_]+\.tga/g;
  for (let m; (m = re.exec(text)); ) {
    const ext = /opacity/i.test(m[0]) ? ".png" : ".jpg";
    bytes.write(ext, m.index + m[0].length - 4, "latin1");
  }
  fs.writeFileSync(destination, bytes);
}

/** Make the converted GLB render as people, not chrome: Rocketbox materials
 * are authored fully metallic (glTF's default when the exporter omits the
 * factor) with a zero specular on the hair. Skin and cloth become dielectric,
 * hair and lashes alpha-tested so their cards never draw as dark sheets or
 * sort over the face (glasses keep their blended lenses), and the empty two-frame "Take 001" is dropped so the
 * character carries no meaningless action. */
// Quaternion and TRS helpers for attachClaviclesToChest.
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
function attachClaviclesToChest(json) {
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

function correctGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const rest = bytes.subarray(20 + jsonLength);
  for (const material of json.materials ?? []) {
    const hair = /opacity|hair|lash/i.test(material.name ?? "");
    material.pbrMetallicRoughness ??= {};
    material.pbrMetallicRoughness.metallicFactor = 0;
    material.pbrMetallicRoughness.roughnessFactor = hair ? 0.6 : 0.72;
    delete material.extensions?.KHR_materials_specular;
    if (material.extensions && !Object.keys(material.extensions).length)
      delete material.extensions;
    // Glasses keep their blended, tinted lenses.
    if (hair) {
      material.alphaMode = "MASK";
      material.alphaCutoff = 0.4;
      material.doubleSided = true;
    }
    if (!material.pbrMetallicRoughness.baseColorTexture)
      throw Error(`${path.basename(file)}: ${material.name} has no texture`);
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (e) => e !== "KHR_materials_specular",
  );
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  delete json.animations;
  // The children's Bipeds are named "Bip02": use the usual Biped prefix the
  // studio's rig recognition strips.
  for (const node of json.nodes)
    node.name = node.name?.replace(/^Bip0\d(?=[ _]|$)/, "Bip01");
  attachClaviclesToChest(json);
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((e) => e.uri))
    throw Error(`${path.basename(file)} is not self-contained`);
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

async function convert(avatar, { out, cache, root, log }) {
  const name = avatarName(avatar);
  const id = idOf(avatar);
  const src = path.join(cache, "rocketbox", name);
  const glb = path.join(out, "characters", id + ".glb");
  const thumb = path.join(out, "characters", id + ".png");
  const part = path.join(out, "characters", id + ".part.glb");
  const stamp = path.join(src, `converted-v${CONVERTER_VERSION}`);
  fs.mkdirSync(path.dirname(glb), { recursive: true });
  if (!fs.existsSync(glb) || !fs.existsSync(stamp)) {
    log(`converting ${name}`);
    const work = path.join(src, "prepared");
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(path.join(work, "Textures"), { recursive: true });
    const textures = fs
      .readdirSync(path.join(src, "Textures"))
      .filter((f) => f.endsWith(".tga"));
    await blender(
      root,
      path.join(cache, "rocketbox", "prepare.py"),
      textures.flatMap((f) => [
        path.join(src, "Textures", f),
        path.join(work, "Textures", f.replace(/\.tga$/, /opacity/i.test(f) ? ".png" : ".jpg")),
      ]),
    );
    patchFbx(path.join(src, "Export", name + ".fbx"), path.join(work, name + ".fbx"));
    await blender(root, path.join(root, "engine/convert.py"), [path.join(work, name + ".fbx"), part]);
    correctGlb(part);
    fs.renameSync(part, glb);
    fs.writeFileSync(stamp, "");
  }
  if (!fs.existsSync(thumb)) {
    await blender(root, path.join(cache, "rocketbox", "thumbnail.py"), [path.join(src, name + ".png"), thumb + ".part.png"]);
    fs.renameSync(thumb + ".part.png", thumb);
  }
}

export async function build({ out, cache, root, log }) {
  // CHARACTERS_ONLY=<id>,<id> rebuilds just those (for converter work).
  const only = process.env.CHARACTERS_ONLY?.split(",");
  const avatars = only ? cast.filter((a) => only.includes(idOf(a))) : cast;
  await downloadAll({ cache, log, avatars });
  fs.writeFileSync(path.join(cache, "rocketbox", "prepare.py"), PREPARE_PY);
  fs.writeFileSync(path.join(cache, "rocketbox", "thumbnail.py"), THUMBNAIL_PY);
  // Blender runs are single-threaded enough to convert a few side by side.
  await pool(avatars, 6, (avatar) =>
    convert(avatar, { out, cache, root, log }),
  );
  return cast
    .filter((a) => fs.existsSync(path.join(out, "characters", idOf(a) + ".glb")))
    .map((a) => ({
      id: idOf(a),
      name: a.role ? `${a.name} — ${a.role}` : a.name,
      category: "characters",
      style: a.style,
      body: a.body,
      url: `/content/characters/${idOf(a)}.glb`,
      thumbnail: `/content/characters/${idOf(a)}.png`,
      description: a.description,
      credit: {
        author: "Microsoft",
        license: "MIT",
        source: `${REPO}/tree/${COMMIT}/Assets/Avatars/${a.folder}`,
      },
    }));
}
