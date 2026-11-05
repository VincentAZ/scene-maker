// Real 3D sets: licence-clean archviz scenes from Blender's demo files, NVIDIA
// ORCA, Benedikt Bitterli's rendering resources and the McGuire archive,
// converted by Blender (sets/blender_set.py) into one self-contained GLB each:
// metres, Y-up, the walkable floor at y = 0, the origin on open floor where
// the cast appears, facing +Z toward the home camera. The converter measures
// the bounds, chooses the home camera, traces the open floor and renders the
// thumbnail; this module records all of it in the catalogue's `set` block.
// Idempotent: sources are cached in content/.cache/sets-models/<slug>/ and a
// set is converted again only when its GLB, thumbnail or measurement is
// missing or was made by an older converter.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract, findFile } from "../lib/archive.mjs";
import { findBlender, runBlender } from "../lib/blender.mjs";
import { download, fetchJSON, mb } from "../lib/download.mjs";
import { blenderLib } from "../lib/thumbnail.mjs";

// Bump to convert every set again after changing the converter.
const CONVERTER_VERSION = 2;
const here = path.dirname(fileURLToPath(import.meta.url));

// NVIDIA's stable download URL bounces to a signed, short-lived link; the zip
// holds the street and the bar.
const bistro = {
  url: "https://developer.nvidia.com/downloads/bistro",
  file: "Bistro_v5_2.zip",
  extract: true,
};

// `licence` is the text that must appear in the licence file shipped inside
// the archive (or beside a bare file); a set whose archive says something
// else is skipped and reported, never shipped. `hdri` names a sky shipped in
// the archive, `sky` a Poly Haven CC0 sky for an outdoor set without one.
// `convert` holds per-set hints for blender_set.py: `floorLevel` (the source
// height of the floor the cast lives on, when the largest floor is the wrong
// one), `extent` (metres from the cast beyond which a landscape is cut off),
// `maxTriangles` (a budget met by decimating the heaviest meshes), `scale`,
// `camera` (the artist's camera to use), `materials`, `maxTexture`.
export const sets = [
  {
    id: "set-classroom",
    slug: "classroom",
    name: "Classroom",
    style: "Indoor",
    description:
      "A sunlit school classroom with rows of wooden desks, a blackboard, radiators and children's drawings on the walls.",
    files: [
      {
        url: "https://download.blender.org/demo/test/classroom.zip",
        file: "classroom.zip",
        extract: true,
      },
    ],
    main: /^classroom\.blend$/,
    format: "blend",
    credit: {
      author: "Christophe Seux",
      license: "CC0",
      source: "https://www.blender.org/download/demo-files/",
    },
  },
  {
    id: "set-modern-flat",
    slug: "modern-flat",
    name: "Modern flat",
    style: "Indoor",
    description:
      "A bright modern flat: an open living room with an oak floor and a bedroom, with a hall and bathroom off to the side.",
    files: [
      {
        url: "https://download.blender.org/demo/eevee/archiviz/archiviz.blend",
        file: "archiviz.blend",
      },
      {
        url: "https://download.blender.org/demo/eevee/archiviz/README.txt",
        file: "README.txt",
      },
    ],
    licence: { file: "README.txt", text: "CC0 1.0 Universal" },
    main: /^archiviz\.blend$/,
    format: "blend",
    credit: {
      author: "Marek Moravec (bed by Lech Sokolowski)",
      license: "CC0",
      source: "https://download.blender.org/demo/eevee/archiviz/README.txt",
    },
  },
  {
    id: "set-italian-flat",
    slug: "italian-flat",
    name: "Italian flat",
    style: "Indoor",
    description:
      "A lived-in Italian apartment: a living room with a sofa and bookshelves opening onto a kitchen.",
    files: [
      {
        url: "https://download.blender.org/demo/cycles/flat-archiviz.blend",
        file: "flat-archiviz.blend",
      },
    ],
    main: /^flat-archiviz\.blend$/,
    format: "blend",
    credit: {
      author: "Flavio Della Tommasa",
      license: "CC BY",
      source: "https://www.blender.org/download/demo-files/",
    },
  },
  {
    id: "set-barcelona-pavilion",
    slug: "barcelona-pavilion",
    name: "Barcelona pavilion",
    style: "Outdoor",
    description:
      "Mies van der Rohe's Barcelona pavilion: a travertine plaza with a shallow pool, marble walls and a flat roof on chrome columns.",
    files: [
      {
        url: "https://download.blender.org/demo/test/pabellon_barcelona_v1.scene_.zip",
        file: "pabellon_barcelona_v1.scene_.zip",
        extract: true,
      },
    ],
    main: /^pavillon_barcelone.*\.blend$/,
    format: "blend",
    // The plaza stands 1.06 m above a lawn that runs 140 m to the horizon.
    convert: { floorLevel: 1.5, extent: 45 },
    sky: "kloofendal_48d_partly_cloudy_puresky",
    credit: {
      author: "Hamza Cheggour (eMirage)",
      license: "CC BY",
      source: "https://www.blender.org/download/demo-files/",
    },
  },
  {
    id: "set-street-cafe",
    slug: "bistro",
    name: "Street with café terrace",
    style: "Outdoor",
    description:
      "A Parisian street corner with a bistro terrace, parked scooters, string lights and shop fronts.",
    files: [bistro],
    licence: { file: "LICENSE.txt", text: "Attribution 4.0 International" },
    main: /^BistroExterior\.fbx$/,
    format: "fbx",
    // 2.8 million triangles as published; the budget keeps the file under
    // 100 MB.
    convert: {
      materials: "bistro",
      maxTexture: 1024,
      shellNames: false,
      maxTriangles: 1900000,
    },
    hdri: /^san_giuseppe_bridge_4k\.hdr$/,
    credit: {
      author: "Amazon Lumberyard",
      license: "CC BY 4.0",
      source: "https://developer.nvidia.com/orca/amazon-lumberyard-bistro",
    },
  },
  {
    id: "set-bar",
    slug: "bistro",
    name: "Bar",
    style: "Indoor",
    description:
      "The inside of a Parisian bistro: a long bar with stools, bottles on the shelves and small tables by the windows.",
    files: [bistro],
    licence: { file: "LICENSE.txt", text: "Attribution 4.0 International" },
    main: /^BistroInterior\.fbx$/,
    format: "fbx",
    convert: { materials: "bistro", maxTexture: 1024, shellNames: false },
    credit: {
      author: "Amazon Lumberyard",
      license: "CC BY 4.0",
      source: "https://developer.nvidia.com/orca/amazon-lumberyard-bistro",
    },
  },
  {
    id: "set-bathroom",
    slug: "bathroom",
    name: "Bathroom",
    style: "Indoor",
    description:
      "A contemporary bathroom with a freestanding tub, a double washstand, tiled floor and a rug.",
    files: [
      {
        url: "https://benedikt-bitterli.me/resources/mitsuba/bathroom.zip",
        file: "bathroom.zip",
        extract: true,
      },
    ],
    licence: { file: "LICENSE.txt", text: "released under a CC0 license" },
    main: /^scene_v3\.xml$/,
    format: "mitsuba",
    credit: {
      author: "Mareck",
      license: "CC0",
      source: "https://benedikt-bitterli.me/resources/",
    },
  },
  {
    id: "set-cosy-bedroom",
    slug: "bedroom",
    name: "Bedroom",
    style: "Indoor",
    description:
      "A calm bedroom with a low double bed, wooden panelling and a teapot on the side table.",
    files: [
      {
        url: "https://benedikt-bitterli.me/resources/mitsuba/bedroom.zip",
        file: "bedroom.zip",
        extract: true,
      },
    ],
    licence: { file: "LICENSE.txt", text: "released under a CC0 license" },
    main: /^scene_v3\.xml$/,
    format: "mitsuba",
    credit: {
      author: "SlykDrako",
      license: "CC0",
      source: "https://benedikt-bitterli.me/resources/",
    },
  },
  {
    id: "set-country-kitchen",
    slug: "country-kitchen",
    name: "Country kitchen",
    style: "Indoor",
    description:
      "A farmhouse kitchen with a wooden table, hanging pans, a range cooker and open shelves.",
    files: [
      {
        url: "https://benedikt-bitterli.me/resources/mitsuba/kitchen.zip",
        file: "kitchen.zip",
        extract: true,
      },
    ],
    licence: { file: "LICENSE.txt", text: "released under a CC-BY license" },
    main: /^scene_v3\.xml$/,
    format: "mitsuba",
    credit: {
      author: "Jay-Artist",
      license: "CC BY 3.0",
      source: "https://benedikt-bitterli.me/resources/",
    },
  },
  {
    id: "set-white-living-room",
    slug: "living-room",
    name: "Living room",
    style: "Indoor",
    description:
      "A white living room with a sofa, cushions, a bookcase and framed pictures.",
    files: [
      {
        url: "https://casual-effects.com/g3d/data10/research/model/living_room/living_room.zip",
        file: "living_room.zip",
        extract: true,
      },
    ],
    // The archive carries no licence file; the archive page states CC BY 3.0.
    main: /^living_room\.obj$/,
    format: "obj",
    credit: {
      author: "Jay-Artist",
      license: "CC BY 3.0",
      source: "https://casual-effects.com/data",
    },
  },
  {
    id: "set-breakfast-room",
    slug: "breakfast-room",
    name: "Breakfast room",
    style: "Indoor",
    description:
      "A bright breakfast room with a marble-topped table, chairs and tall windows.",
    files: [
      {
        url: "https://casual-effects.com/g3d/data10/research/model/breakfast_room/breakfast_room.zip",
        file: "breakfast_room.zip",
        extract: true,
      },
    ],
    licence: { file: "license.txt", text: "Creative Commons Attribution 3.0" },
    main: /^breakfast_room\.obj$/,
    format: "obj",
    // Modelled in feet: the table top sits 2.3 units up.
    convert: { scale: 0.3048 },
    credit: {
      author: "Wig42",
      license: "CC BY 3.0",
      source: "https://casual-effects.com/data",
    },
  },
];

// Not shipped: San Miguel (McGuire archive, San_Miguel.zip) is listed as
// CC BY 3.0 on the archive page, but the license.txt inside the archive only
// allows "research and educational use", so it stays out until the archive
// resolves the contradiction.

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const roundAll = (v, d = 2) => v.map((n) => round(n, d));

function checkLicence(set, dir, log) {
  if (!set.licence) return true;
  const file = findFile(dir, new RegExp(`^${set.licence.file}$`, "i"));
  const text = file ? fs.readFileSync(file, "utf8") : "";
  if (text.includes(set.licence.text)) return true;
  log(
    `${set.id}: skipped, its licence file does not say "${set.licence.text}".`,
  );
  return false;
}

// Poly Haven CC0 skies light the outdoor sets that ship no sky of their own.
async function sky(name, file, cache, log) {
  if (fs.existsSync(file)) return;
  const files = await fetchJSON(
    `https://api.polyhaven.com/files/${name}`,
    path.join(cache, `sky-${name}.json`),
  );
  await download(files.hdri["1k"].hdr.url, file, { log });
}

export async function build({ out, cache, root, log, only }) {
  const dir = path.join(out, "sets");
  const sources = path.join(cache, "sets-models");
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const set of sets) {
    const base = path.join(sources, set.slug);
    const measureFile = path.join(base, `${set.id}.json`);
    const glb = path.join(dir, `${set.id}.glb`);
    const png = path.join(dir, `${set.id}.png`);
    const hdr = path.join(dir, `${set.id}.hdr`);
    const active = !only || only.includes(set.id);
    if (!active) {
      if (!fs.existsSync(measureFile)) {
        log(`${set.id}: not built yet (SETS_ONLY left it out)`);
        continue;
      }
    } else {
      const say = (m) => log(`${set.id}: ${m}`);
      for (const source of set.files) {
        const file = path.join(base, source.file);
        await download(source.url, file, { log: say });
        if (source.extract) extract(file, path.join(base, "src"), { log: say });
      }
      if (!checkLicence(set, base, log)) continue;
      if (set.sky) await sky(set.sky, hdr, cache, say);
      if (set.hdri && !fs.existsSync(hdr)) {
        const shipped = findFile(base, set.hdri);
        if (!shipped)
          throw Error(`${set.id}: ${set.hdri} not found in ${base}`);
        fs.copyFileSync(shipped, hdr);
      }
      const current =
        fs.existsSync(glb) &&
        fs.existsSync(png) &&
        fs.existsSync(measureFile) &&
        JSON.parse(fs.readFileSync(measureFile, "utf8")).version ===
          CONVERTER_VERSION;
      if (!current) {
        const main = findFile(base, set.main);
        if (!main) throw Error(`${set.id}: ${set.main} not found in ${base}`);
        const job = path.join(base, `${set.id}.job.json`);
        fs.writeFileSync(
          job,
          JSON.stringify(
            {
              id: set.id,
              version: CONVERTER_VERSION,
              format: set.format,
              indoor: set.style === "Indoor",
              source: main,
              glb,
              png,
              measure: measureFile,
              work: path.join(base, `work-${set.id}`),
              lib: blenderLib,
              ...set.convert,
            },
            null,
            2,
          ),
        );
        say("converting with Blender");
        const started = Date.now();
        runBlender(
          findBlender(root),
          path.join(here, "blender_set.py"),
          [job],
          {
            log: say,
            timeout: 90 * 60 * 1000,
          },
        );
        say(`converted in ${Math.round((Date.now() - started) / 1000)} s`);
      }
    }
    const m = JSON.parse(fs.readFileSync(measureFile, "utf8"));
    if (m.error) throw Error(`${set.id}: ${m.error}`);
    const [w, h, d] = [0, 1, 2].map((i) => m.bounds.max[i] - m.bounds.min[i]);
    log(
      `${set.id}: ${round(w, 1)} × ${round(d, 1)} m, ${m.triangles} triangles, ${mb(fs.statSync(glb).size)}`,
    );
    const entry = {
      id: set.id,
      name: set.name,
      category: "environments",
      style: set.style,
      description: `${set.description} About ${round(w, 0)} by ${round(d, 0)} metres.`,
      url: `/content/sets/${set.id}.glb`,
      thumbnail: `/content/sets/${set.id}.png`,
      ...(fs.existsSync(hdr) ? { hdri: `/content/sets/${set.id}.hdr` } : {}),
      set: {
        camera: {
          position: roundAll(m.camera.position),
          target: roundAll(m.camera.target),
          maxDistance: round(m.camera.maxDistance, 1),
        },
        bounds: { min: roundAll(m.bounds.min), max: roundAll(m.bounds.max) },
        spawn: [0, 0, 0],
        heading: 0,
        ...(m.walkable?.length >= 3
          ? { walkable: m.walkable.map((p) => roundAll(p)) }
          : {}),
        collision: "furniture",
        ...(set.sky || set.hdri
          ? {
              lighting: { exposure: 1, hemisphere: 1.2, fog: false, sky: true },
            }
          : {}),
      },
      credit: set.credit,
    };
    entries.push(entry);
  }
  return entries;
}
