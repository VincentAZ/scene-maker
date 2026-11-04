// Photographic sets: CC0 360° HDRIs from Poly Haven (https://polyhaven.com).
//
// Each set downloads three files into content/sets/:
//   <id>.jpg     Poly Haven's tonemapped 8K (8192×4096) panorama, shown as the
//                visible, ground-projected backdrop. At the studio's 38° field
//                of view an 8K panorama gives ~860 px across the frame, sharp
//                enough for a 1080p viewport, for 2–6 MB per set. A 4K .hdr
//                would be blurrier (430 px) at 25 MB.
//   <id>.hdr     The 1K unclipped HDR, used only for image-based lighting and
//                to find the sun. Lighting is prefiltered to a 256 px cube
//                anyway, so higher resolutions add size without changing light.
//   <id>.png     Poly Haven's thumbnail.
//
// `backdrop` records how the photo is projected onto the studio floor:
//   height    the photographer's camera height in meters. The floor in the
//             photo is projected onto y = 0 from that height, so it sets the
//             scale of everything on the ground. Tuned by eye against doors,
//             cars, paving and a 1.75 m character.
//   radius    the projection dome radius in meters: roughly the distance to
//             the walls indoors, further outdoors. The camera stays inside it.
//   rotation  yaw in degrees that turns the most useful view of the photo
//             toward the studio's default camera.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sets = [
  {
    source: "comfy_cafe",
    id: "photo-corner-cafe",
    name: "Corner café",
    style: "Indoor",
    description:
      "A cosy coffee shop with sofas, small tables and warm lamps on a wooden floor.",
    backdrop: { height: 1.55, radius: 6, rotation: 155 },
  },
  {
    source: "warm_restaurant",
    id: "photo-lodge-restaurant",
    name: "Lodge restaurant",
    style: "Indoor",
    description:
      "A bright restaurant under timber trusses, with long tables and a terracotta floor.",
    backdrop: { height: 1.6, radius: 11, rotation: -144 },
  },
  {
    source: "reading_room",
    id: "photo-living-room",
    name: "Living room",
    style: "Indoor",
    description:
      "A sunny Italian living room with a sofa, armchairs and a rug on a terrazzo floor.",
    backdrop: { height: 1.55, radius: 8, rotation: 115 },
  },
  {
    source: "brown_photostudio_02",
    id: "photo-loft-apartment",
    name: "Loft apartment",
    style: "Indoor",
    description:
      "A white loft with an open kitchen, a bed under tall windows and a pale floor.",
    backdrop: { height: 1.55, radius: 6, rotation: -18 },
  },
  {
    source: "poly_haven_studio",
    id: "photo-small-office",
    name: "Small office",
    style: "Indoor",
    description:
      "A working office with desks, monitors and office chairs under a wooden ceiling.",
    backdrop: { height: 1.5, radius: 6, rotation: 108 },
  },
  {
    source: "empty_warehouse_01",
    id: "photo-warehouse",
    name: "Empty warehouse",
    style: "Indoor",
    description:
      "A large, empty industrial hall with a bare concrete floor and strip lights.",
    backdrop: { height: 1.7, radius: 16, rotation: 155 },
  },
  {
    source: "carpentry_shop_01",
    id: "photo-carpentry-workshop",
    name: "Carpentry workshop",
    style: "Indoor",
    description:
      "A timber workshop with racks of planks, workbenches and saws.",
    backdrop: { height: 1.6, radius: 9, rotation: 108 },
  },
  {
    source: "school_hall",
    id: "photo-school-stage",
    name: "School stage",
    style: "Indoor",
    description:
      "The wooden stage of a school hall, in front of black stage curtains.",
    backdrop: { height: 1.6, radius: 8, rotation: 18 },
  },
  {
    source: "parking_garage",
    id: "photo-underground-car-park",
    name: "Underground car park",
    style: "Indoor",
    description:
      "A concrete parking garage with pillars, painted arrows and parked cars.",
    backdrop: { height: 1.6, radius: 16, rotation: 108 },
  },
  {
    source: "urban_street_03",
    id: "photo-residential-street",
    name: "Residential street",
    style: "Outdoor",
    description:
      "A quiet street of brick houses and parked cars on an overcast day.",
    backdrop: { height: 1.7, radius: 20, rotation: 90 },
  },
  {
    source: "palermo_park",
    id: "photo-city-park",
    name: "City park",
    style: "Outdoor",
    description:
      "A shady city park with a gravel square, a fountain and huge old fig trees.",
    backdrop: { height: 1.7, radius: 25, rotation: -18 },
  },
  {
    source: "suburban_garden",
    id: "photo-backyard-garden",
    name: "Backyard garden",
    style: "Outdoor",
    description:
      "A wide lawn with flower beds and thatched gazebos under a clear sky.",
    backdrop: { height: 1.7, radius: 25, rotation: 72 },
  },
  {
    source: "forest_grove",
    id: "photo-woodland",
    name: "Woodland",
    style: "Outdoor",
    description:
      "An open grove of bare trees on a flat, leafy forest floor at low sun.",
    backdrop: { height: 1.7, radius: 20, rotation: 18 },
  },
  {
    source: "spiaggia_di_mondello",
    id: "photo-sandy-beach",
    name: "Sandy beach",
    style: "Outdoor",
    description:
      "A broad Mediterranean beach of fine sand, with pines and hills behind.",
    backdrop: { height: 1.7, radius: 40, rotation: -72 },
  },
  {
    source: "mall_parking_lot",
    id: "photo-parking-lot",
    name: "Parking lot",
    style: "Outdoor",
    description:
      "A large, nearly empty parking lot with painted bays in the afternoon sun.",
    backdrop: { height: 1.7, radius: 40, rotation: 61 },
  },
  {
    source: "cobblestone_street_night",
    id: "photo-night-street",
    name: "Night street",
    style: "Night",
    description:
      "A cobbled side street at night, lit by warm street lamps, with parked cars.",
    backdrop: { height: 1.6, radius: 12, rotation: -54 },
  },
  {
    source: "hansaplatz",
    id: "photo-night-square",
    name: "Town square at night",
    style: "Night",
    description:
      "A paved city square at night, ringed by lit apartment blocks and bare trees.",
    backdrop: { height: 1.7, radius: 30, rotation: 90 },
  },
];

const api = "https://api.polyhaven.com";
const headers = { "User-Agent": "SceneMaker content build" };

async function json(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw Error(`${url}: ${response.status}`);
  return response.json();
}

async function download(url, file, log) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  log(`downloading ${path.basename(file)}`);
  const response = await fetch(url, { headers });
  if (!response.ok) throw Error(`${url}: ${response.status}`);
  const partial = `${file}.part`;
  fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(partial, file);
}

// Some of Poly Haven's 8K panoramas are saved at JPEG quality 100 (40–60 MB).
// Re-encode those at ffmpeg quality 4 (about JPEG 88): no visible difference at
// 1:1, a quarter of the size. Without ffmpeg the original is kept.
const maxPanorama = 12e6;
function panorama(raw, file, log) {
  if (fs.statSync(raw).size > maxPanorama) {
    try {
      log(`re-encoding ${path.basename(file)}`);
      execFileSync("ffmpeg", [
        "-loglevel",
        "error",
        "-y",
        "-i",
        raw,
        "-q:v",
        "4",
        "-f",
        "mjpeg",
        `${file}.part`,
      ]);
      fs.renameSync(`${file}.part`, file);
      fs.rmSync(raw);
      return;
    } catch {
      fs.rmSync(`${file}.part`, { force: true });
      log("ffmpeg is unavailable; keeping the full-size panorama");
    }
  }
  fs.renameSync(raw, file);
}

export async function build({ out, cache, log }) {
  const dir = path.join(out, "sets");
  fs.mkdirSync(dir, { recursive: true });
  const entries = [];
  for (const set of sets) {
    // Metadata is cached so a rebuild works offline once files exist.
    const metaFile = path.join(cache, `sets-${set.source}.json`);
    let meta;
    if (fs.existsSync(metaFile))
      meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    else {
      const [info, files] = await Promise.all([
        json(`${api}/info/${set.source}`),
        json(`${api}/files/${set.source}`),
      ]);
      meta = {
        authors: Object.keys(info.authors ?? {}),
        hdr: files.hdri["1k"].hdr.url,
        jpg: files.tonemapped.url,
      };
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
    }
    const base = set.id;
    await download(meta.hdr, path.join(dir, `${base}.hdr`), log);
    const jpg = path.join(dir, `${base}.jpg`);
    if (!fs.existsSync(jpg)) {
      const raw = path.join(cache, `sets-${set.source}.jpg`);
      await download(meta.jpg, raw, log);
      panorama(raw, jpg, log);
    }
    await download(
      `https://cdn.polyhaven.com/asset_img/thumbs/${set.source}.png?width=320&height=240`,
      path.join(dir, `${base}.png`),
      log,
    );
    entries.push({
      id: set.id,
      name: set.name,
      category: "environments",
      style: set.style,
      description: set.description,
      thumbnail: `/content/sets/${base}.png`,
      hdri: `/content/sets/${base}.hdr`,
      backdrop: { image: `/content/sets/${base}.jpg`, ...set.backdrop },
      credit: {
        author: meta.authors.join(", ") || "Poly Haven",
        license: "CC0",
        source: `https://polyhaven.com/a/${set.source}`,
      },
    });
  }
  return entries;
}
