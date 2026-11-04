// Realistic props: photo-scanned CC0 models from Poly Haven (polyhaven.com).
// Each prop is downloaded as glTF with 1k textures, converted by Blender into
// one self-contained GLB (real metres, standing on y=0, front facing +Z,
// centred on x/z) and measured from its own geometry: seats get their sitting
// surface, cups and bottles their hand grip and drinking point, the ladder its
// rungs. Idempotent: downloads are cached in content/.cache/polyhaven and a
// prop is converted again only when its GLB or measurement is missing.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const API = "https://api.polyhaven.com";
const THUMBS = "https://cdn.polyhaven.com/asset_img/thumbs";
// Bump to rebuild every GLB and measurement after changing the converter.
const CONVERTER_VERSION = 7;

// kind: seat | drink | ladder | (plain prop). keep: glTF node names to keep
// when the Poly Haven model is a set. gripHeight: fraction of the height to
// hold a handleless drink at. render: draw our own thumbnail (sets).
export const props = [
  // Seating
  { id: "ph-dining-chair-leather", source: "dining_chair_02", kind: "seat", style: "Seating", name: "Leather dining chair", description: "A tufted dark leather dining chair on square wooden legs." },
  { id: "ph-painted-wooden-chair", source: "painted_wooden_chair_01", kind: "seat", style: "Seating", name: "White wooden kitchen chair", description: "A worn, white-painted wooden kitchen chair." },
  { id: "ph-school-chair", source: "SchoolChair_01", kind: "seat", style: "Seating", name: "School chair", description: "A blue moulded plastic classroom chair on a steel frame." },
  { id: "ph-plastic-patio-chair", source: "plastic_monobloc_chair_01", kind: "seat", style: "Seating", name: "Plastic patio chair", description: "A white stackable monobloc garden chair." },
  { id: "ph-cafe-chair", source: "outdoor_table_chair_set_01", keep: ["outdoor_table_chair_set_01_chair_01"], render: true, kind: "seat", style: "Seating", name: "Folding café chair", description: "A slatted wooden folding chair on a black metal frame, from a street café set." },
  { id: "ph-armchair-upholstered", source: "ArmChair_01", kind: "seat", style: "Seating", name: "Upholstered armchair", description: "A classic carved armchair with pale grey upholstery." },
  { id: "ph-armchair-green", source: "GreenChair_01", kind: "seat", style: "Seating", name: "Green antique armchair", description: "An antique carved-wood armchair upholstered in green velvet." },
  { id: "ph-armchair-leather", source: "modern_arm_chair_01", kind: "seat", style: "Seating", name: "Leather lounge armchair", description: "A modern armchair with black leather cushions on a light wooden frame." },
  { id: "ph-lounge-chair", source: "mid_century_lounge_chair", kind: "seat", seatSlope: 0.6, style: "Seating", name: "Mid-century lounge chair", description: "A swivelling mid-century lounge chair in worn brown leather." },
  { id: "ph-rocking-chair", source: "Rockingchair_01", kind: "seat", style: "Seating", name: "Wooden rocking chair", description: "A traditional dark wooden rocking chair." },
  { id: "ph-wooden-stool", source: "wooden_stool_01", kind: "seat", style: "Seating", name: "Wooden stool", description: "A weathered round wooden stool with turned legs." },
  { id: "ph-painted-stool", source: "painted_wooden_stool", kind: "seat", style: "Seating", name: "Painted wooden stool", description: "A square stool with chipped grey paint." },
  { id: "ph-workshop-stool", source: "metal_stool_02", kind: "seat", style: "Seating", name: "Workshop stool", description: "A round wooden-topped stool on black steel legs." },
  { id: "ph-wooden-bench", source: "painted_wooden_bench", kind: "seat", style: "Seating", name: "Wooden settle bench", description: "A red-painted wooden bench with a back and a shelf underneath." },
  { id: "ph-sofa-classic", source: "Sofa_01", kind: "seat", style: "Seating", name: "Classic two-seat sofa", description: "A carved-frame two-seat sofa with cream cushions." },
  { id: "ph-sofa-leather", source: "sofa_02", kind: "seat", style: "Seating", name: "Black leather sofa", description: "A buttoned black leather two-seat sofa." },
  { id: "ph-sofa-ornate", source: "sofa_03", kind: "seat", style: "Seating", name: "Ornate three-seat sofa", description: "A large carved leather sofa with patterned cushions." },
  // Tables
  { id: "ph-dining-table", source: "dining_table", style: "Tables", name: "Dining table with cloth", description: "A long wooden dining table covered with a checked tablecloth." },
  { id: "ph-wooden-table", source: "wooden_table_02", style: "Tables", name: "Wooden kitchen table", description: "A simple wooden table on four straight legs." },
  { id: "ph-round-table", source: "round_wooden_table_02", style: "Tables", name: "Round side table", description: "A round dark wooden table on a cabinet base." },
  { id: "ph-cafe-table", source: "outdoor_table_chair_set_01", keep: ["outdoor_table_chair_set_01_table"], render: true, style: "Tables", name: "Folding café table", description: "A slatted wooden folding table on a black metal frame." },
  { id: "ph-coffee-table", source: "modern_coffee_table_01", turn: 90, style: "Tables", name: "Modern coffee table", description: "A low coffee table with a stone top on a wooden frame." },
  { id: "ph-coffee-table-chest", source: "CoffeeTable_01", style: "Tables", name: "Painted chest coffee table", description: "A turquoise-painted carved coffee table with drawers." },
  { id: "ph-office-desk", source: "metal_office_desk", style: "Tables", name: "Metal office desk", description: "A grey steel office desk with drawers." },
  { id: "ph-school-desk", source: "SchoolDesk_01", style: "Tables", name: "School desk", description: "A small wooden-topped classroom desk on a steel frame." },
  { id: "ph-side-table", source: "side_table_01", style: "Tables", name: "Wooden side table", description: "A light wooden side table with a lower shelf." },
  { id: "ph-nightstand", source: "painted_wooden_nightstand", style: "Tables", name: "Painted nightstand", description: "A small blue-grey painted nightstand with a drawer." },
  // Kitchen
  { id: "ph-tea-cup", source: "tea_set_01", keep: ["tea_set_01_cup_small_01"], render: true, kind: "drink", style: "Kitchen", name: "Porcelain tea cup", description: "A Victorian porcelain tea cup with floral decals and gold trim." },
  { id: "ph-teapot", source: "tea_set_01", keep: ["tea_set_01_teapot_01", "tea_set_01_teapot_01_lid"], render: true, turn: 90, style: "Kitchen", name: "Porcelain teapot", description: "A Victorian porcelain teapot with floral decals." },
  { id: "ph-goblet", source: "brass_goblets", keep: ["brass_goblet_02"], render: true, kind: "drink", gripHeight: 0.28, style: "Kitchen", name: "Brass goblet", description: "An engraved vintage brass goblet." },
  { id: "ph-wine-bottle", source: "wine_bottles_01", keep: ["wine_bottles_01_bordeaux"], render: true, kind: "drink", gripHeight: 0.35, style: "Kitchen", name: "Red wine bottle", description: "A Bordeaux bottle of red wine with a paper label." },
  { id: "ph-thermos", source: "plastic_thermos", kind: "drink", style: "Kitchen", name: "Thermos flask", description: "A green vintage plastic thermos flask with a handle." },
  { id: "ph-milk-jug", source: "jug_01", kind: "drink", style: "Kitchen", name: "Ceramic milk jug", description: "A white glazed jug with a painted tulip bouquet." },
  { id: "ph-kettle", source: "vintage_electric_kettle", style: "Kitchen", name: "Vintage kettle", description: "A worn chrome electric kettle." },
  { id: "ph-wooden-bowl", source: "wooden_bowl_01", style: "Kitchen", name: "Wooden bowl", description: "A rough hand-carved wooden bowl." },
  { id: "ph-cutting-board", source: "wooden_cutting_board", style: "Kitchen", name: "Cutting board", description: "A well-used wooden cutting board." },
  // Food
  { id: "ph-bananas", source: "bananas", keep: ["bananas_bunch"], render: true, style: "Food", name: "Bunch of bananas", description: "A bunch of ripe bananas." },
  { id: "ph-apple", source: "food_apple_01", style: "Food", name: "Red apple", description: "A shiny red apple." },
  { id: "ph-croissant", source: "croissant", style: "Food", name: "Croissant", description: "A golden baked croissant." },
  { id: "ph-carrot-cake", source: "carrot_cake", style: "Food", name: "Carrot cake", description: "A ring-shaped carrot cake with cream frosting." },
  { id: "ph-strawberry-cake", source: "strawberry_chocolate_cake", style: "Food", name: "Strawberry chocolate cake", description: "A chocolate cake covered in sliced strawberries." },
  // Books and office
  { id: "ph-encyclopedia-set", source: "book_encyclopedia_set_01", style: "Books", name: "Row of encyclopedias", description: "Twenty leather-bound encyclopedia volumes standing in a row." },
  { id: "ph-encyclopedia-book", source: "book_encyclopedia_set_01", keep: ["book_encyclopedia_set_01_book01"], render: true, style: "Books", name: "Leather-bound book", description: "A single leather-bound encyclopedia volume." },
  { id: "ph-binder-notebook", source: "binder_notebook", style: "Books", name: "Leather notebooks", description: "Two worn leather binder notebooks." },
  // Plants and decor
  { id: "ph-potted-tree", source: "potted_plant_01", style: "Plants", name: "Potted tree", description: "A small leafy tree in a terracotta pot." },
  { id: "ph-potted-plant", source: "potted_plant_02", style: "Plants", name: "Potted arrowhead plant", description: "A leafy arrowhead plant in a clay pot." },
  { id: "ph-succulent", source: "potted_plant_04", style: "Plants", name: "Potted succulent", description: "A small aloe-like succulent in a white pot." },
  { id: "ph-vase", source: "ceramic_vase_01", style: "Decor", name: "White ceramic vase", description: "A glazed white ceramic vase." },
  { id: "ph-picture-frame", source: "standing_picture_frame_01", turn: -90, style: "Decor", name: "Framed photograph", description: "A black-and-white photograph in a standing frame." },
  { id: "ph-alarm-clock", source: "alarm_clock_01", style: "Decor", name: "Alarm clock", description: "A mint-green twin-bell alarm clock." },
  { id: "ph-chess-set", source: "chess_set", style: "Decor", name: "Chess set", description: "A marble chessboard with a full set of pieces." },
  { id: "ph-throw-pillow", source: "throw_pillows_01", keep: ["throw_pillows_01_pillow01"], render: true, style: "Decor", name: "Throw pillow", description: "A zig-zag patterned throw pillow." },
  // Lamps
  { id: "ph-pipe-lamp", source: "industrial_pipe_lamp", style: "Lamps", name: "Industrial table lamp", description: "A steel pipe table lamp with a bare filament bulb." },
  { id: "ph-oil-lamp", source: "vintage_oil_lamp", style: "Lamps", name: "Vintage oil lamp", description: "A brass oil lamp with a painted floral base and glass chimney." },
  { id: "ph-lantern", source: "Lantern_01", style: "Lamps", name: "Oil lantern", description: "An old copper hurricane lantern." },
  // Storage and bags
  { id: "ph-cardboard-box", source: "cardboard_box_01", style: "Storage", name: "Cardboard box", description: "A worn, taped cardboard moving box." },
  { id: "ph-wooden-crate", source: "wooden_crate_01", style: "Storage", name: "Wooden crate", description: "An old wooden crate with iron handles." },
  { id: "ph-plastic-crate", source: "plastic_crate_01", style: "Storage", name: "Plastic milk crate", description: "A red plastic milk crate." },
  { id: "ph-wicker-basket", source: "wicker_basket_02", style: "Storage", name: "Wicker basket", description: "A woven wicker basket with its lid beside it." },
  { id: "ph-suitcase", source: "vintage_suitcase", keep: ["vintage_suitcase_01_bottom", "vintage_suitcase_01_clasp", "vintage_suitcase_01_handle", "vintage_suitcase_01_top"], render: true, style: "Storage", name: "Vintage suitcase", description: "A green vintage suitcase covered in travel stickers." },
  { id: "ph-trash-bag", source: "trashbag", style: "Storage", name: "Trash bag", description: "A full black plastic rubbish bag." },
  // Electronics
  { id: "ph-laptop", source: "classic_laptop", style: "Electronics", name: "Vintage laptop", description: "An early-1990s laptop computer, open." },
  { id: "ph-television", source: "television_02", style: "Electronics", name: "Portable television", description: "A small 1980s portable television set." },
  { id: "ph-boombox", source: "boombox", style: "Electronics", name: "Boombox", description: "A black cassette boombox with an aerial." },
  { id: "ph-camera", source: "Camera_01", style: "Electronics", name: "Film camera", description: "A vintage rangefinder film camera with a leather strap." },
  // Ladder
  { id: "ph-ladder", source: "ladder_sectioned_01", kind: "ladder", style: "Tools", name: "Aluminium ladder", description: "A straight sectioned metal ladder with flat treads and safety straps." },
];

const md5 = (file) =>
  crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");

async function fetchJSON(url, file) {
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  const res = await fetch(url, { headers: { "User-Agent": "scene-maker" } });
  if (!res.ok) throw Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  return data;
}

async function download(url, file, expectedMd5) {
  if (fs.existsSync(file) && (!expectedMd5 || md5(file) === expectedMd5))
    return false;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "scene-maker" } });
      if (!res.ok) throw Error(`HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      if (expectedMd5) {
        const got = crypto.createHash("md5").update(data).digest("hex");
        if (got !== expectedMd5) throw Error(`checksum ${got} != ${expectedMd5}`);
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file + ".part", data);
      fs.renameSync(file + ".part", file);
      return true;
    } catch (error) {
      if (attempt >= 3) throw Error(`${url}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

function findBlender(root) {
  const candidates = [
    process.env.SCENE_MAKER_BLENDER,
    path.join(root, ".data/tools/blender/blender"),
    path.join(root, "../scene-maker/.data/tools/blender/blender"),
  ].filter(Boolean);
  const found = candidates.find((c) => fs.existsSync(c));
  if (found) return found;
  const which = spawnSync("which", ["blender"], { encoding: "utf8" });
  if (which.status === 0) return which.stdout.trim();
  throw Error(
    "Blender is needed to convert props. Set SCENE_MAKER_BLENDER to its path.",
  );
}

const round = (n, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

export async function build({ out, cache, root, log }) {
  const dir = path.join(out, "props");
  const sources = path.join(cache, "polyhaven");
  const measures = path.join(cache, "props-measure");
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(measures, { recursive: true });

  // 1. Download every source model once (glTF + bin + 1k textures).
  const info = {};
  for (const source of [...new Set(props.map((p) => p.source))]) {
    const base = path.join(sources, source);
    info[source] = await fetchJSON(`${API}/info/${source}`, path.join(base, "info.json"));
    const files = await fetchJSON(`${API}/files/${source}`, path.join(base, "files.json"));
    const gltf = files.gltf?.["1k"]?.gltf;
    if (!gltf) throw Error(`${source} has no 1k glTF download.`);
    let fetched = await download(gltf.url, path.join(base, "1k", `${source}.gltf`), gltf.md5);
    for (const [rel, file] of Object.entries(gltf.include || {}))
      fetched = (await download(file.url, path.join(base, "1k", rel), file.md5)) || fetched;
    if (fetched) log(`downloaded ${source}`);
  }

  // 2. Convert and measure what is missing, in one Blender session.
  const pending = props.filter((p) => {
    const m = path.join(measures, `${p.id}.json`);
    if (!fs.existsSync(path.join(dir, `${p.id}.glb`)) || !fs.existsSync(m))
      return true;
    if (JSON.parse(fs.readFileSync(m, "utf8")).version !== CONVERTER_VERSION)
      return true;
    return p.render && !fs.existsSync(path.join(dir, `${p.id}.png`));
  });
  if (pending.length) {
    log(`converting ${pending.length} props with Blender`);
    const work = path.join(cache, "props-work");
    fs.mkdirSync(work, { recursive: true });
    const script = path.join(work, "convert_props.py");
    fs.writeFileSync(script, PYTHON);
    const job = path.join(work, "job.json");
    fs.writeFileSync(
      job,
      JSON.stringify({
        version: CONVERTER_VERSION,
        items: pending.map((p) => ({
          id: p.id,
          kind: p.kind || "",
          keep: p.keep || null,
          turn: p.turn || 0,
          seatSlope: p.seatSlope ?? 0.85,
          gripHeight: p.gripHeight ?? 0.4,
          gltf: path.join(sources, p.source, "1k", `${p.source}.gltf`),
          glb: path.join(dir, `${p.id}.glb`),
          png: p.render ? path.join(dir, `${p.id}.png`) : null,
          measure: path.join(measures, `${p.id}.json`),
        })),
      }),
    );
    const run = spawnSync(
      findBlender(root),
      ["--background", "--factory-startup", "--python", script, "--", job],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    for (const line of (run.stdout || "").split("\n"))
      if (line.startsWith("PROP ")) log(line.slice(5));
    if (run.status !== 0) {
      log((run.stderr || "").slice(-3000));
      throw Error(`Blender exited with ${run.status}`);
    }
  }

  // 3. Thumbnails: Poly Haven's own studio renders for whole models.
  for (const p of props) {
    const file = path.join(dir, `${p.id}.png`);
    if (p.render || fs.existsSync(file)) continue;
    await download(`${THUMBS}/${p.source}.png?width=256&height=256`, file);
  }

  // 4. Catalogue entries.
  return props.map((p) => {
    const m = JSON.parse(fs.readFileSync(path.join(measures, `${p.id}.json`), "utf8"));
    if (m.error) throw Error(`${p.id}: ${m.error}`);
    const source = info[p.source];
    const [w, h, d] = m.size;
    const entry = {
      id: p.id,
      name: p.name,
      category: "props",
      style: p.style,
      url: `/content/props/${p.id}.glb`,
      thumbnail: `/content/props/${p.id}.png`,
      description: `${p.description} ${round(w, 2)} × ${round(d, 2)} m, ${round(h, 2)} m tall. Photo-scanned by Poly Haven.`,
      credit: {
        author: Object.keys(source.authors || {}).join(", ") || "Poly Haven",
        license: "CC0",
        source: `https://polyhaven.com/a/${p.source}`,
      },
    };
    if (p.kind === "seat") {
      if (!m.seat) throw Error(`${p.id}: no sitting surface was found.`);
      entry.seat = {
        position: m.seat.position.map((n) => round(n, 4)),
        width: round(m.seat.width),
        depth: round(m.seat.depth),
      };
    }
    if (p.kind === "drink") {
      entry.grip = m.grip.map((n) => round(n));
      entry.mouth = m.mouth.map((n) => round(n));
    }
    if (p.kind === "ladder") {
      if (!m.ladder) throw Error(`${p.id}: no rungs were found.`);
      entry.ladder = {
        height: round(m.ladder.height),
        width: round(m.ladder.width),
        firstRung: round(m.ladder.firstRung),
        spacing: round(m.ladder.spacing),
        rungs: m.ladder.rungs,
      };
    }
    return entry;
  });
}

// Blender side: import, keep the chosen parts, bake transforms, orient,
// ground and centre, export a self-contained GLB, and measure. Blender is
// Z-up with the model's front toward -Y; glTF is Y-up with the front toward
// +Z, so a Blender point (x, y, z) is (x, z, -y) in the exported file.
const PYTHON = String.raw`
import bpy, json, math, sys, traceback
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

job = json.load(open(sys.argv[sys.argv.index('--') + 1]))

def gl(v):
    return [v[0], v[2], -v[1]]

def mesh_objects():
    return [o for o in bpy.data.objects if o.type == 'MESH']

def all_verts():
    return [v.co.copy() for o in mesh_objects() for v in o.data.vertices]

def bounds(verts):
    lo = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    hi = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return lo, hi

def transform(m):
    for o in mesh_objects():
        o.data.transform(m)
        o.data.update()

def ground_and_centre():
    lo, hi = bounds(all_verts())
    transform(Matrix.Translation(Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))))

def turn(angle):
    if abs(angle) > 1e-6:
        transform(Matrix.Rotation(angle, 4, 'Z'))
        ground_and_centre()

def bvh():
    verts, polys = [], []
    for o in mesh_objects():
        base = len(verts)
        verts.extend(v.co.copy() for v in o.data.vertices)
        polys.extend([base + i for i in p.vertices] for p in o.data.polygons)
    return BVHTree.FromPolygons(verts, polys)

def first_hits(step, normal_min, lo, hi, tree):
    cells = {}
    nx = int((hi.x - lo.x) / step) + 1
    ny = int((hi.y - lo.y) / step) + 1
    for i in range(nx):
        for j in range(ny):
            p = Vector((lo.x + i * step, lo.y + j * step, hi.z + 0.1))
            loc, normal, _, _ = tree.ray_cast(p, Vector((0, 0, -1)))
            if loc is not None and abs(normal.z) >= normal_min:
                cells[(i, j)] = loc.z
    return cells

def components(cells, joined):
    comps, seen = [], set()
    for c in cells:
        if c in seen:
            continue
        stack, comp = [c], []
        seen.add(c)
        while stack:
            a = stack.pop()
            comp.append(a)
            for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                b = (a[0] + d[0], a[1] + d[1])
                if b in cells and b not in seen and joined(a, b):
                    seen.add(b)
                    stack.append(b)
        comps.append(comp)
    return comps

def pct(vals, q):
    vals = sorted(vals)
    return vals[min(len(vals) - 1, int(q * len(vals)))]

def seat_surface(slope=0.85):
    # Sitting surfaces: smooth, gently sloped patches seen from above, between
    # knee and table height. Cushions next to each other join into one seat.
    lo, hi = bounds(all_verts())
    step = 0.01
    cells = first_hits(step, slope, lo, hi, bvh())
    comps = components(cells, lambda a, b: abs(cells[a] - cells[b]) < 0.012)
    found = []
    for comp in comps:
        area = len(comp) * step * step
        h = pct([cells[c] for c in comp], 0.5)
        if area >= 0.03 and 0.25 <= h <= 0.9:
            found.append((area, h, comp))
    if not found:
        return None
    area, h, comp = max(found, key=lambda f: f[0])
    seat = list(comp)
    for a2, h2, c2 in found:
        if c2 is not comp and abs(h2 - h) < 0.06 and a2 >= 0.25 * area:
            seat += c2
    xs = [lo.x + c[0] * step for c in seat]
    ys = [lo.y + c[1] * step for c in seat]
    x0, x1 = pct(xs, 0.02), pct(xs, 0.98)
    y0, y1 = pct(ys, 0.02), pct(ys, 0.98)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    near = [cells[c] for c in seat if math.hypot(lo.x + c[0] * step - cx, lo.y + c[1] * step - cy) < 0.1]
    cz = pct(near or [cells[c] for c in seat], 0.5)
    # Exactly the surface under the centre; on a slatted seat, the nearest slat.
    tree = bvh()
    for d in [0] + [s * k * 0.005 for k in range(1, 9) for s in (1, -1)]:
        loc, _, _, _ = tree.ray_cast(Vector((cx, cy + d, cz + 0.15)), Vector((0, 0, -1)))
        if loc is not None and abs(loc.z - cz) < 0.04:
            cy, cz = cy + d, loc.z
            break
    return {'centre': Vector((cx, cy, cz)), 'width': x1 - x0 + step, 'depth': y1 - y0 + step}

def orient_seat(item, log):
    s = seat_surface(item['seatSlope'])
    if not s:
        return None
    # The back (geometry well above the seat) belongs behind it: +Y in Blender.
    above = [v for v in all_verts() if v.z > s['centre'].z + 0.2]
    if len(above) > 50:
        bx = sum(v.x for v in above) / len(above) - s['centre'].x
        by = sum(v.y for v in above) / len(above) - s['centre'].y
        if math.hypot(bx, by) > 0.04:
            want = math.pi / 2 - math.atan2(by, bx)
            snapped = round(want / (math.pi / 2)) * (math.pi / 2)
            snapped = math.atan2(math.sin(snapped), math.cos(snapped))
            if abs(snapped) > 1e-3:
                log('turned %d deg so the back is behind the seat' % round(math.degrees(snapped)))
                turn(snapped)
                s = seat_surface(item['seatSlope'])
    return s

def silhouette():
    lo, hi = bounds(all_verts())
    step = 0.002
    tree = bvh()
    occ = set()
    nx = int((hi.x - lo.x) / step) + 1
    ny = int((hi.y - lo.y) / step) + 1
    for i in range(nx):
        for j in range(ny):
            loc, _, _, _ = tree.ray_cast(Vector((lo.x + i * step, lo.y + j * step, hi.z + 0.1)), Vector((0, 0, -1)))
            if loc is not None:
                occ.add((i, j))
    return occ, lo, step, tree

def disc(r):
    n = int(r)
    return [(a, b) for a in range(-n, n + 1) for b in range(-n, n + 1) if a * a + b * b <= r * r]

def body_and_handle():
    # Top-down silhouette; an opening by a disc removes thin handles and keeps
    # the round body. What the opening removes, beyond a margin, is a handle.
    occ, lo, step, tree = silhouette()
    lo2, hi2 = bounds(all_verts())
    r = 0.35 * min(hi2.x - lo2.x, hi2.y - lo2.y) / 2 / step
    k = disc(r)
    eroded = {c for c in occ if all((c[0] + a, c[1] + b) in occ for a, b in k)}
    opened = set()
    for c in eroded:
        for a, b in k:
            opened.add((c[0] + a, c[1] + b))
    grown = set()
    for c in opened:
        for a, b in disc(3):
            grown.add((c[0] + a, c[1] + b))
    rest = occ - grown
    cx = lo.x + step * sum(c[0] for c in opened) / len(opened)
    cy = lo.y + step * sum(c[1] for c in opened) / len(opened)
    body = math.sqrt(len(opened) / math.pi) * step
    def reach(comp):
        return max(math.hypot(lo.x + c[0] * step - cx, lo.y + c[1] * step - cy) for c in comp)
    # A handle sticks out well beyond the body (a lip or spout stays close).
    comps = [c for c in components(rest, lambda a, b: True)
             if len(c) >= 10 and reach(c) - body > max(0.012, 0.15 * body)]
    handle = None
    if comps:
        comp = max(comps, key=reach)
        handle = [(lo.x + c[0] * step, lo.y + c[1] * step) for c in comp]
    return cx, cy, handle, step

def drink(item, log):
    cx, cy, handle, step = body_and_handle()
    if handle:
        dx = sum(p[0] for p in handle) / len(handle) - cx
        dy = sum(p[1] for p in handle) / len(handle) - cy
        angle = -math.atan2(dy, dx)
        if abs(angle) > 0.05:
            log('handle found; turned %d deg to put it on the right (+X)' % round(math.degrees(angle)))
            turn(angle)
        else:
            log('handle found on the right (+X)')
        cx, cy, handle, step = body_and_handle()
    verts = all_verts()
    lo, hi = bounds(verts)
    H = hi.z
    tree = bvh()
    top = [v for v in verts if v.z > H - max(0.004, 0.03 * H) and math.hypot(v.x - cx, v.y - cy) < 0.5 * min(hi.x - lo.x, hi.y - lo.y) * 1.05]
    rim = max(math.hypot(v.x - cx, v.y - cy) for v in top) if top else 0.02
    if handle:
        cellset = {(round(p[0] / step), round(p[1] / step)) for p in handle}
        hv = [v for v in verts if (round(v.x / step), round(v.y / step)) in cellset]
        hz = sum(v.z for v in hv) / len(hv) if hv else 0.5 * H
        hx = sum(p[0] for p in handle) / len(handle)
        hmax = max(p[0] for p in handle)
        hy = sum(p[1] for p in handle) / len(handle)
        grip = Vector(((hx + hmax) / 2, hy, hz))
    else:
        gz = item['gripHeight'] * H
        loc, _, _, _ = tree.ray_cast(Vector((hi.x + 0.1, cy, gz)), Vector((-1, 0, 0)))
        grip = Vector((loc.x if loc else hi.x, cy, gz))
    # Lips meet the rim on the side facing the drinker (glTF -Z, Blender +Y).
    mouth = Vector((cx, cy + 0.55 * rim, H))
    return {'grip': gl(grip), 'mouth': gl(mouth), 'rim': rim, 'handle': bool(handle)}

def ladder(item, log):
    verts = all_verts()
    lo, hi = bounds(verts)
    tree = bvh()
    H = hi.z
    # March up the centre line from the front; runs of hits are rungs.
    runs, cur = [], None
    z = 0.0
    while z < H:
        loc, _, _, _ = tree.ray_cast(Vector((0, lo.y - 0.2, z)), Vector((0, 1, 0)))
        hit = loc is not None
        if hit and cur is None:
            cur = [z, z]
        elif hit:
            cur[1] = z
        elif cur is not None:
            runs.append(cur)
            cur = None
        z += 0.003
    if cur:
        runs.append(cur)
    centres = [(a + b) / 2 for a, b in runs if b - a < 0.12 and (a + b) / 2 > 0.05]
    if len(centres) < 3:
        return None
    gaps = sorted(b - a for a, b in zip(centres, centres[1:]))
    spacing = gaps[len(gaps) // 2]
    # Rung plane: centre the front/back faces of the middle rung on y = 0.
    zc = centres[len(centres) // 2]
    f, _, _, _ = tree.ray_cast(Vector((0, lo.y - 0.2, zc)), Vector((0, 1, 0)))
    b, _, _, _ = tree.ray_cast(Vector((0, hi.y + 0.2, zc)), Vector((0, -1, 0)))
    mid = (f.y + b.y) / 2
    transform(Matrix.Translation(Vector((0, -mid, 0))))
    tree = bvh()
    # Rail span between the top two rungs, clear of feet and straps.
    zm = centres[-2] + spacing / 2
    l, _, _, _ = tree.ray_cast(Vector((lo.x - 0.2, 0, zm)), Vector((1, 0, 0)))
    r, _, _, _ = tree.ray_cast(Vector((hi.x + 0.2, 0, zm)), Vector((-1, 0, 0)))
    if l is None or r is None:
        raise Exception('could not find the ladder rails')
    width = r.x - l.x
    log('rungs at %s' % ', '.join('%.3f' % c for c in centres))
    return {'height': H, 'width': width, 'firstRung': centres[0], 'spacing': spacing, 'rungs': len(centres)}

def render_thumbnail(path):
    scene = bpy.context.scene
    lo, hi = bounds(all_verts())
    size = hi - lo
    centre = (lo + hi) / 2
    radius = max(size.length / 2, 0.02)
    cam_data = bpy.data.cameras.new('thumb')
    cam_data.lens = 50
    cam = bpy.data.objects.new('thumb', cam_data)
    scene.collection.objects.link(cam)
    direction = Vector((0.55, -1.0, 0.45)).normalized()
    cam.location = centre + direction * radius * 3.1
    cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    for loc, energy in (((3, -4, 5), 900), ((-4, -2, 3), 350), ((0, 4, 4), 400)):
        light_data = bpy.data.lights.new('l', 'AREA')
        light_data.energy = energy * (radius ** 2) * 0.35
        light_data.size = radius * 4
        light = bpy.data.objects.new('l', light_data)
        light.location = centre + Vector(loc).normalized() * radius * 6
        light.rotation_euler = (centre - light.location).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(light)
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.8, 0.8, 1)
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.device = 'CPU'
    scene.render.resolution_x = scene.render.resolution_y = 256
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def process(item):
    msgs = []
    log = lambda m: msgs.append(m)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=item['gltf'])
    for o in mesh_objects():
        for m in list(o.modifiers):
            if m.type == 'ARMATURE':
                bpy.context.view_layer.objects.active = o
                bpy.ops.object.modifier_apply(modifier=m.name)
    # Bake each object's world transform into its own mesh data.
    worlds = [(o, o.matrix_world.copy()) for o in mesh_objects()]
    for o, mw in worlds:
        if o.data.users > 1:
            o.data = o.data.copy()
        o.parent = None
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
        o.data.update()
    keep = item.get('keep')
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or (keep and o.name not in keep and o.name.rsplit('.', 1)[0] not in keep):
            bpy.data.objects.remove(o)
    if not mesh_objects():
        raise Exception('none of %s found' % keep)
    for o in mesh_objects():
        o.shape_key_clear() if o.data.shape_keys else None
    ground_and_centre()
    if item.get('turn'):
        turn(math.radians(item['turn']))
    result = {'version': job['version']}
    kind = item['kind']
    if kind == 'seat':
        s = orient_seat(item, log)
        if s:
            result['seat'] = {'position': gl(s['centre']), 'width': s['width'], 'depth': s['depth']}
            log('seat %.3f m high, %.2f x %.2f m' % (s['centre'].z, s['width'], s['depth']))
    elif kind == 'drink':
        result.update(drink(item, log))
    elif kind == 'ladder':
        lad = ladder(item, log)
        if lad:
            result['ladder'] = lad
    verts = all_verts()
    lo, hi = bounds(verts)
    result['size'] = [hi.x - lo.x, hi.z - lo.z, hi.y - lo.y]
    result['min'] = gl(Vector((lo.x, hi.y, lo.z)))
    result['max'] = gl(Vector((hi.x, lo.y, hi.z)))
    result['triangles'] = sum(len(p.vertices) - 2 for o in mesh_objects() for p in o.data.polygons)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(
        filepath=item['glb'], export_format='GLB', export_image_format='AUTO',
        export_yup=True, export_apply=True, export_animations=False,
        export_skins=False, export_morph=False, export_cameras=False,
        export_lights=False, use_selection=False)
    if item.get('png'):
        render_thumbnail(item['png'])
    result['log'] = msgs
    return result

for item in job['items']:
    try:
        result = process(item)
        print('PROP %s: %.2f x %.2f x %.2f m %s' % (item['id'], result['size'][0], result['size'][1], result['size'][2], '; '.join(result['log'])), flush=True)
    except Exception as e:
        traceback.print_exc()
        result = {'version': job['version'], 'error': str(e)}
        print('PROP %s: FAILED %s' % (item['id'], e), flush=True)
    with open(item['measure'], 'w') as f:
        json.dump(result, f, indent=1)
`;
