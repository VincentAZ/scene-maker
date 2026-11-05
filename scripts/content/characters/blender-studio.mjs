// Blender Studio's open-movie characters (CC BY 4.0, studio.blender.org):
// Rain, Snow, the realistic Einar and friends, each a .blend (or a zip
// holding one) with a CloudRig film rig. The download lands in
// content/.cache/blender-studio/<character>/, checked against its sha256 and
// extracted into its own folder; the bundled Blender then turns the file into
// a skinned GLB (scripts/content/blender/blender_studio_export.py: deform
// skeleton, rest pose, baked materials) and renders the card
// (character_thumbnail.py). The GLB's materials are made dielectric and
// self-contained the way the Rocketbox converter does it. Idempotent: a
// character is converted again only when its GLB, card or converter stamp is
// missing. The site's credit line follows from an entry: "<name> v<version>
// (CC) Blender Foundation | studio.blender.org", the version being the last
// part of credit.source.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const SITE = "https://studio.blender.org";
const FILES = `${SITE}/download-source/files`;
// Bump to rebuild every GLB after changing the converter.
const CONVERTER_VERSION = 13;
const scripts = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../blender",
);

// folder: content/.cache/blender-studio/<folder>. blend: inside the extracted
// zip, or the downloaded file itself. body: feminine | masculine. options:
// passed to the converter (skip: name patterns of parts to leave out).
export const cast = [
  {
    id: "blender-rain",
    name: "Rain",
    folder: "rain",
    page: `${SITE}/characters/rain/v3/`,
    download: `${FILES}/ee/a7/eea73e55dba1cea31c09848df6a794b2-4.zip`,
    sha256: "80217f163f6392dc829233d63c2cfb5e1376775bc34101ad14f39631fea70d24",
    file: "rain-v3.zip",
    blend: "Rain v3.3/rain_v3.2.blend",
    body: "feminine",
    description:
      "A young woman with an undercut and a swept-back ponytail, in a white tank top with a light-blue neckerchief, blue jeans and sneakers. Blender Studio's Rain, version 3, adapted for the studio.",
  },
  {
    id: "blender-snow",
    name: "Snow",
    folder: "snow",
    page: `${SITE}/characters/snow/v4/`,
    download: `${FILES}/ba/0f/ba0fe6d810333b1d73c1c359e4dc03cb-6.zip`,
    sha256: "98d58ef3a07083ede14140bc462cccb55d317062846aa0eb652d2e4a7ac422a6",
    file: "snow-v4.zip",
    blend: "Snow/snow_v4.2.blend",
    body: "masculine",
    description:
      "A young man with his dark hair tied in a top knot, in a grey V-neck T-shirt, jeans and trainers. Blender Studio's Snow, version 4, adapted for the studio.",
  },
  {
    id: "blender-einar",
    name: "Einar",
    folder: "einar",
    page: `${SITE}/characters/einar/v1/`,
    download: `${FILES}/41/419e83fb75f30b989adf7920dec7a21c/419e83fb75f30b989adf7920dec7a21c.zip`,
    sha256: "3cbb5a1dd9ffd3ca39edab420a83ea7f7db337b435a78ef27a0c87ff3e6977f7",
    file: "einar-v1.zip",
    blend: "einar_release_v1.blend",
    // The film's injury decals.
    options: { skip: ["blood"] },
    body: "masculine",
    description:
      "An Icelandic tinkerer with a white beard and a woollen hat, in a padded jacket, a knitted sweater and work trousers, with a satchel and the robotic left arm he built from scrap: the realistic lead of the open movie Charge. Blender Studio's Einar, version 1, adapted for the studio.",
  },
  {
    id: "blender-phil",
    name: "Phil",
    folder: "phil",
    page: `${SITE}/characters/phil/v1/`,
    download: `${FILES}/c1/c1a19179f6136a2f8c7b802d1201ea3b/c1a19179f6136a2f8c7b802d1201ea3b.blend`,
    sha256: "b9671b4add7a7e52000c5dba3ddfa322fb0c0c85abf70ea3ad5fcf6499947e59",
    file: "phil.blend",
    body: "masculine",
    description:
      "A big, round-faced teenager with curly red hair, in a dark T-shirt, denim shorts and flip-flops: the gear-hauling cook of the open movie Sprite Fright. Blender Studio's Phil, version 1, adapted for the studio.",
  },
  {
    id: "blender-jay",
    name: "Jay",
    folder: "jay",
    page: `${SITE}/characters/jay/v1/`,
    download: `${FILES}/5f/5fe2b56638e96ce325e47b916524ded5/5fe2b56638e96ce325e47b916524ded5.blend`,
    sha256: "18383a3d25d68c6a91208e4240f2e4dfe67592739078f18b21cf257be91a8458",
    file: "jay.blend",
    body: "masculine",
    description:
      "A lanky teenager in a black bucket hat, red shutter shades, a white track jacket, a gold chain, red shorts and chunky trainers: the would-be eighties music star of the open movie Sprite Fright. Blender Studio's Jay, version 1, adapted for the studio.",
  },
  {
    id: "blender-victoria",
    name: "Victoria",
    folder: "victoria",
    page: `${SITE}/characters/victoria/v1/`,
    download: `${FILES}/f3/f399fb2523e10448b6d6e7b77d2eaa26/f399fb2523e10448b6d6e7b77d2eaa26.blend`,
    sha256: "852dc7bea686db2d59302679609bd0c438ef88936f3684dd193a74b3b292cd6b",
    file: "victoria.blend",
    body: "feminine",
    description:
      "A teenage girl with a huge mane of yellow and orange hair, in a pink dress, black tights and long black gloves, with bead necklaces and teal boots: the most popular girl in school from the open movie Sprite Fright. Blender Studio's Victoria, version 1, adapted for the studio.",
  },
  {
    id: "blender-phileas",
    name: "Phileas",
    folder: "phileas",
    page: `${SITE}/characters/phileas/v3/`,
    download: `${FILES}/30/30040f5df6a2ea573fb4fe408358be92/30040f5df6a2ea573fb4fe408358be92.blend`,
    sha256: "9da377750f0db24147ba8a1cac3a459d96b80a71eb914f484360aecb539cdeba",
    file: "phileas.blend",
    body: "masculine",
    description:
      "Sir Phileas Fish, an explorer with a purple fish's head, big round eyes and a fin on top, in an orange jumpsuit with a backpack and white boots, from Blender Studio's Settlers. Blender Studio's Phileas, version 3, adapted for the studio.",
  },
  {
    id: "blender-gabby",
    name: "Gabby",
    folder: "gabby",
    page: `${SITE}/characters/gabby/v3/`,
    download: `${FILES}/68/680933efa5276c8ebb20826df7726836/680933efa5276c8ebb20826df7726836.blend`,
    sha256: "80e0c2e8a7d97746bfa192104f07d36caecd32ff4bfc423f2a7ddbefacc065c4",
    file: "gabby.blend",
    body: "feminine",
    description:
      "A freckled girl whose teal hair curls up like a devil's horns, with goggles on her head, a white T-shirt, purple shorts and yellow boots: the only settler who is (probably) human, from Blender Studio's Settlers. Blender Studio's Gabby, version 3, adapted for the studio.",
  },
  {
    id: "blender-lunte",
    name: "Lunte",
    folder: "lunte",
    page: `${SITE}/characters/lunte/v4/`,
    download: `${FILES}/a4/a428e902193306ef2d4f161069c6f342/a428e902193306ef2d4f161069c6f342.blend`,
    sha256: "8c95c3a929dbceae20a0028d6e0066a3c855fe74ccb62829ff84072150f51360",
    file: "lunte.blend",
    body: "masculine",
    description:
      "A settler with a shock of orange hair and a boxy metal mask that somehow still shows his glowing eyes and grin, in a dark suit with a backpack, from Blender Studio's Settlers. Blender Studio's Lunte, version 4, adapted for the studio.",
  },
];
const idOf = (c) => c.id;

const sha256 = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** Fetch a release file once, streaming it to disk, and refuse anything
 * that does not hash to what this module was written against. */
async function download(url, file, expected, log) {
  if (fs.existsSync(file) && sha256(file) === expected) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      log(`downloading ${path.basename(file)}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(1_800_000) });
      if (!res.ok || !res.body) throw Error(`HTTP ${res.status}`);
      const hash = crypto.createHash("sha256");
      await pipeline(
        Readable.fromWeb(res.body),
        async function* (chunks) {
          for await (const chunk of chunks) {
            hash.update(chunk);
            yield chunk;
          }
        },
        fs.createWriteStream(file + ".part"),
      );
      const got = hash.digest("hex");
      if (got !== expected) throw Error(`sha256 ${got} is not ${expected}`);
      fs.renameSync(file + ".part", file);
      return;
    } catch (error) {
      fs.rmSync(file + ".part", { force: true });
      if (attempt >= 5 || /sha256/.test(error.message))
        throw Error(`${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/** Run a command; resolves with the converter's own "studio:" lines, which
 * Blender's bake progress would otherwise push out of the output tail kept
 * for errors. */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { timeout: 1_800_000, ...options });
    let tail = "";
    let pending = "";
    const notes = [];
    const keep = (data) => {
      tail = (tail + data).slice(-30000);
      const lines = (pending + data).split("\n");
      pending = lines.pop();
      for (const line of lines)
        if (line.startsWith("studio: ")) notes.push(line.slice(8));
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(notes)
        : reject(Error(`${command} failed: ${tail.slice(-3000)}`)),
    );
  });
}

/** Unpack an archive into its own empty folder; nothing inside it runs. */
async function extract(archive, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  await run("unzip", ["-q", "-o", archive, "-d", dir]);
}

function blenderPath(root) {
  for (const candidate of [
    path.join(root, ".data/tools/blender/blender"),
    path.resolve(root, "../scene-maker/.data/tools/blender/blender"),
  ])
    if (fs.existsSync(candidate)) return candidate;
  return "blender";
}

/** Run one of this folder's Blender scripts headless. The downloaded file is
 * opened with its own scripts disabled. */
function blender(root, script, args) {
  return run(
    process.env.BLENDER_PATH || blenderPath(root),
    [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      path.join(scripts, script),
      "--",
      ...args,
    ],
    { cwd: root },
  );
}

async function pool(items, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/** Make the exported GLB render as people under the studio's lights: every
 * material dielectric (the baked roughness stays), rendering extensions a
 * film shader may have left behind dropped, cut-outs alpha-tested so hair
 * cards never sort over the face, no emission, no animations, and nothing
 * referenced outside the file. */
export function correctGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const rest = bytes.subarray(20 + jsonLength);
  const dropped = [
    "KHR_materials_specular",
    "KHR_materials_ior",
    "KHR_materials_transmission",
    "KHR_materials_volume",
    "KHR_materials_clearcoat",
    "KHR_materials_sheen",
    "KHR_materials_emissive_strength",
  ];
  for (const material of json.materials ?? []) {
    material.pbrMetallicRoughness ??= {};
    material.pbrMetallicRoughness.metallicFactor = 0;
    for (const extension of dropped) delete material.extensions?.[extension];
    if (material.extensions && !Object.keys(material.extensions).length)
      delete material.extensions;
    delete material.emissiveFactor;
    delete material.emissiveTexture;
    if (material.alphaMode === "BLEND") {
      material.alphaMode = "MASK";
      material.alphaCutoff = 0.5;
      material.doubleSided = true;
    }
  }
  json.extensionsUsed = (json.extensionsUsed ?? []).filter(
    (e) => !dropped.includes(e),
  );
  if (!json.extensionsUsed.length) delete json.extensionsUsed;
  delete json.animations;
  if ([...(json.buffers ?? []), ...(json.images ?? [])].some((e) => e.uri))
    throw Error(`${path.basename(file)} is not self-contained`);
  if (json.skins?.length !== 1)
    throw Error(`${path.basename(file)} has ${json.skins?.length ?? 0} skins`);
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

async function convert(character, { out, cache, root, log }) {
  const id = idOf(character);
  const src = path.join(cache, "blender-studio", character.folder);
  const glb = path.join(out, "characters", id + ".glb");
  const thumb = path.join(out, "characters", id + ".png");
  const stamp = path.join(src, `converted-v${CONVERTER_VERSION}`);
  fs.mkdirSync(path.dirname(glb), { recursive: true });
  if (fs.existsSync(glb) && fs.existsSync(stamp) && fs.existsSync(thumb))
    return;
  const archive = path.join(src, character.file);
  await download(character.download, archive, character.sha256, log);
  let blend = archive;
  if (archive.endsWith(".zip")) {
    const extracted = path.join(src, "extracted");
    blend = path.join(extracted, character.blend);
    if (!fs.existsSync(blend)) await extract(archive, extracted);
  }
  if (!fs.existsSync(glb) || !fs.existsSync(stamp)) {
    log(`converting ${character.name}`);
    const work = path.join(src, "export");
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    const part = path.join(work, id + ".glb");
    const notes = await blender(root, "blender_studio_export.py", [
      blend,
      work,
      part,
      JSON.stringify(character.options ?? {}),
    ]);
    fs.writeFileSync(path.join(src, "convert.log"), notes.join("\n") + "\n");
    for (const line of notes)
      if (/^(roles|joints|left out|missing|groom|unwrapped)\b/.test(line))
        log(`  ${character.name}: ${line}`);
    const skinned = notes.filter((line) => line.startsWith("skinned ")).length;
    if (skinned)
      log(`  ${character.name}: skinned ${skinned} unweighted parts`);
    correctGlb(part);
    fs.renameSync(part, glb);
    fs.rmSync(thumb, { force: true });
    fs.writeFileSync(stamp, "");
  }
  if (!fs.existsSync(thumb)) {
    await blender(root, "character_thumbnail.py", [glb, thumb + ".part.png"]);
    fs.renameSync(thumb + ".part.png", thumb);
  }
}

export async function build({ out, cache, root, log }) {
  // CHARACTERS_ONLY=<id>,<id> rebuilds just those (for converter work).
  const only = process.env.CHARACTERS_ONLY?.split(",");
  const chosen = only ? cast.filter((c) => only.includes(idOf(c))) : cast;
  // Each conversion bakes on the GPU; two side by side keep it busy. A
  // character that fails is reported; the catalogue lists the GLBs there are.
  await pool(chosen, 2, async (character) => {
    try {
      await convert(character, { out, cache, root, log });
    } catch (error) {
      log(`${character.name} failed: ${error.message.slice(-2000)}`);
    }
  });
  return cast
    .filter((c) =>
      fs.existsSync(path.join(out, "characters", idOf(c) + ".glb")),
    )
    .map((c) => ({
      id: idOf(c),
      name: c.name,
      category: "characters",
      style: "Blender Studio",
      body: c.body,
      url: `/content/characters/${idOf(c)}.glb`,
      thumbnail: `/content/characters/${idOf(c)}.png`,
      description: c.description,
      credit: {
        author: "Blender Studio",
        license: "CC BY 4.0",
        source: c.page,
      },
    }));
}
