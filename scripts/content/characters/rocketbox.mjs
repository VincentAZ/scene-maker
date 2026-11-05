// Realistic characters: rigged, textured humans from Microsoft Rocketbox
// (MIT, github.com/microsoft/Microsoft-Rocketbox). Each avatar's FBX and its
// colour, normal and opacity textures are downloaded, the TGA textures are
// shrunk and re-encoded (JPEG; PNG with alpha for hair and lashes), the FBX
// goes through the app's own importer (engine/convert.py), and the resulting
// GLB's materials are corrected: Rocketbox ships every material as fully
// metallic, which renders skin and cloth as dark chrome. Idempotent:
// downloads are cached in content/.cache/rocketbox and an avatar is converted
// again only when its GLB or thumbnail is missing.
import fs from "node:fs";
import path from "node:path";
import {
  attachClaviclesToChest,
  blender,
  blenderScript,
  cropPreview,
  download,
  glbHeight,
  pool,
  rewriteGlb,
} from "../lib.mjs";

// The library is pinned to this upstream commit.
const COMMIT = "0943055db6ec570bcef9f2c8b41c9e5467c808f9";
const REPO = "https://github.com/microsoft/Microsoft-Rocketbox";
const RAW = `https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/${COMMIT}/`;
// Bump to rebuild every GLB after changing the converter.
const CONVERTER_VERSION = 3;

// All 115 avatars. folder: Assets/Avatars/<folder>. body: feminine | masculine.
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
  { folder: "Adults/Female_Adult_02", name: "Julia", body: "feminine", style: "Everyday", description: "A woman with a dark ponytail in a white V-neck sweater over a pale blue shirt, a denim skirt and black heels." },
  { folder: "Adults/Female_Adult_03", name: "Lin", body: "feminine", style: "Everyday", description: "A woman with black hair in a purple strappy top with a sash, dark trousers and flat shoes." },
  { folder: "Adults/Female_Adult_05", name: "Carmen", body: "feminine", style: "Everyday", description: "A woman with short dark hair in a pink blazer over a blue shirt, belted jeans and black heels." },
  { folder: "Adults/Female_Adult_07", name: "Ingrid", body: "feminine", style: "Everyday", description: "A woman with tied-back hair in a belted brown corduroy jacket over a pink top, jeans and tall brown boots." },
  { folder: "Adults/Female_Adult_09", name: "Helen", body: "feminine", style: "Everyday", description: "A woman in a long taupe cardigan over a white blouse and necklace, dark trousers and flats." },
  { folder: "Adults/Female_Adult_10", name: "Fatima", body: "feminine", style: "Everyday", description: "A woman in a black chador over dark trousers and sandals." },
  { folder: "Adults/Female_Adult_13", name: "Anna", body: "feminine", style: "Everyday", description: "A woman with short blonde hair in a grey waistcoat over a black top, jeans and black heeled boots." },
  { folder: "Adults/Female_Adult_14", name: "Marta", body: "feminine", style: "Everyday", description: "A woman with short brown hair in a grey wrap cardigan over a black top, jeans and brown boots." },
  { folder: "Adults/Female_Adult_16", name: "Zahra", body: "feminine", style: "Everyday", description: "A woman in a blue burqa with an embroidered mesh face panel and dark shoes." },
  { folder: "Adults/Male_Adult_03", name: "Richard", body: "masculine", style: "Everyday", description: "A grey-haired older man in a tweed jacket and dark trousers." },
  { folder: "Adults/Male_Adult_04", name: "Marcus", body: "masculine", style: "Everyday", description: "A man with curly hair in a black jacket over a hoodie and work trousers." },
  { folder: "Adults/Male_Adult_10", name: "Kenji", body: "masculine", style: "Everyday", description: "A young man in a red track jacket, black track trousers and trainers." },
  { folder: "Adults/Male_Adult_12", name: "Daniel", body: "masculine", style: "Everyday", description: "A man in a denim jacket over a white T-shirt and jeans." },
  { folder: "Adults/Male_Adult_13", name: "Thomas", body: "masculine", style: "Everyday", description: "A balding man in an argyle sweater vest and jeans." },
  { folder: "Adults/Male_Adult_15", name: "Omar", body: "masculine", style: "Everyday", description: "A bearded man in a white kurta, trousers and a prayer cap." },
  { folder: "Adults/Male_Adult_17", name: "Arjun", body: "masculine", style: "Everyday", description: "A bearded man in a blue and white sports jacket and jeans." },
  { folder: "Adults/Male_Adult_18", name: "Kwame", body: "masculine", style: "Everyday", description: "A man in a grey hoodie with the hood up and black trousers." },
  { folder: "Adults/Male_Adult_01", name: "Jake", body: "masculine", style: "Everyday", description: "A young man in a striped polo shirt, khaki cargo shorts and grey trainers." },
  { folder: "Adults/Male_Adult_02", name: "Peter", body: "masculine", style: "Everyday", description: "A man in a beige V-neck sweater, dark trousers and brown shoes." },
  { folder: "Adults/Male_Adult_05", name: "Walter", body: "masculine", style: "Everyday", description: "A grey-bearded man in a beige utility vest over a green sweater, brown trousers and tan boots." },
  { folder: "Adults/Male_Adult_06", name: "Felix", body: "masculine", style: "Everyday", description: "A young man with shoulder-length hair in a red henley shirt, jeans and blue trainers." },
  { folder: "Adults/Male_Adult_07", name: "Adrian", body: "masculine", style: "Everyday", description: "A man in a grey blazer over a brown cardigan, jeans and rust suede shoes." },
  { folder: "Adults/Male_Adult_08", name: "Erik", body: "masculine", style: "Everyday", description: "A man with cropped hair in a light blue shirt with rolled sleeves, dark trousers and black shoes." },
  { folder: "Adults/Male_Adult_09", name: "Hiro", body: "masculine", style: "Everyday", description: "A man with long tied-back hair in a navy graphic T-shirt, jeans and brown trainers." },
  { folder: "Adults/Male_Adult_11", name: "Sean", body: "masculine", style: "Everyday", description: "A man in a dark green short-sleeved shirt, jeans and brown shoes." },
  { folder: "Adults/Male_Adult_14", name: "George", body: "masculine", style: "Everyday", description: "A balding man in a grey shirt, belted khaki trousers and brown shoes." },
  { folder: "Adults/Male_Adult_16", name: "Oliver", body: "masculine", style: "Everyday", description: "A blond man in a blue graphic T-shirt, jeans and black trainers." },
  { folder: "Adults/Male_Adult_19", name: "Khalid", body: "masculine", style: "Everyday", description: "A bearded man in a white thobe with a red and white checked headdress and sandals." },
  { folder: "Adults/Male_Adult_20", name: "Max", body: "masculine", style: "Everyday", description: "A man in a brown hoodie, dark jeans and black trainers." },
  { folder: "Adults/Male_Adult_21", name: "Yusuf", body: "masculine", style: "Everyday", description: "A man in a white thobe with a red and white checked headdress and black shoes." },
  { folder: "Adults/Female_Party_02", name: "Zara", body: "feminine", style: "Everyday", description: "A woman with curly hair in a patterned top, black mini skirt and sandals, dressed for an evening out." },
  { folder: "Adults/Female_Party_01", name: "Chloe", body: "feminine", style: "Everyday", description: "A woman with wavy blonde hair in a white camisole, denim cut-off shorts and white knee-high boots, dressed for a night out." },
  // Business
  { folder: "Professions/Business_Female_01", name: "Nia", role: "Executive", body: "feminine", style: "Business", description: "A woman in a black trouser suit and white shirt." },
  { folder: "Professions/Business_Female_02", name: "Margaret", role: "Manager", body: "feminine", style: "Business", description: "An older woman with glasses in a burgundy blazer and dark trousers." },
  { folder: "Professions/Business_Female_03", name: "Elena", role: "Accountant", body: "feminine", style: "Business", description: "A woman in a brown skirt suit and heels." },
  { folder: "Professions/Business_Female_04", name: "Victoria", role: "Consultant", body: "feminine", style: "Business", description: "A woman with tied-back hair in a dark pinstripe trouser suit over a white top, with black heels." },
  { folder: "Professions/Business_Male_01", name: "James", role: "Executive", body: "masculine", style: "Business", description: "A man in a black suit with a red tie." },
  { folder: "Professions/Business_Male_04", name: "Viktor", role: "Office worker", body: "masculine", style: "Business", description: "A bald man in a grey waistcoat, shirt and dark trousers." },
  { folder: "Professions/Business_Male_05", name: "Andre", role: "Lawyer", body: "masculine", style: "Business", description: "A man in a checked charcoal suit with a purple shirt and tie." },
  { folder: "Professions/Business_Male_02", name: "Wei", role: "Banker", body: "masculine", style: "Business", description: "A man in a navy suit with a white shirt and a patterned blue tie." },
  { folder: "Professions/Business_Male_03", name: "Patrick", role: "Sales director", body: "masculine", style: "Business", description: "A man in a black suit with a white shirt and a green striped tie." },
  { folder: "Professions/Business_Male_06", name: "Luis", role: "Analyst", body: "masculine", style: "Business", description: "A man in a white shirt without a tie, black trousers and black shoes." },
  { folder: "Professions/Business_Male_07", name: "Harold", role: "Manager", body: "masculine", style: "Business", description: "A bald older man in a white shirt with a grey striped tie, jeans and brown shoes." },
  // Medical
  { folder: "Professions/Medical_Female_02", name: "Laura", role: "Doctor", body: "feminine", style: "Medical", description: "A doctor in a white coat with a stethoscope." },
  { folder: "Professions/Medical_Female_01", name: "Rosa", role: "Nurse", body: "feminine", style: "Medical", description: "A nurse in a white tunic and trousers." },
  { folder: "Professions/Medical_Female_03", name: "Eva", role: "Paramedic", body: "feminine", style: "Medical", description: "A paramedic in a blue uniform jacket and trousers with reflective stripes and black boots." },
  { folder: "Professions/Medical_Male_03", name: "Henry", role: "Doctor", body: "masculine", style: "Medical", description: "An older doctor in a white coat with a stethoscope." },
  { folder: "Professions/Medical_Male_04", name: "David", role: "Surgeon", body: "masculine", style: "Medical", description: "A surgeon in green scrubs, cap and face mask." },
  { folder: "Professions/Medical_Male_01", name: "Simon", role: "Doctor", body: "masculine", style: "Medical", description: "A doctor in a long white coat with a name badge, white trousers and white shoes." },
  { folder: "Professions/Medical_Male_02", name: "Jonah", role: "Paramedic", body: "masculine", style: "Medical", description: "A paramedic in a blue uniform jacket and trousers with reflective stripes." },
  { folder: "Professions/Medical_Male_05", name: "Kenta", role: "Radiographer", body: "masculine", style: "Medical", description: "A radiographer in green scrubs under a blue lead apron, with a surgical cap and face mask." },
  // Service
  { folder: "Professions/Chef_Female_01", name: "Mei", role: "Chef", body: "feminine", style: "Service", description: "A chef in a white jacket, apron and cap." },
  { folder: "Professions/Delivery_Male_01", name: "Lukas", role: "Courier", body: "masculine", style: "Service", description: "A bearded man in a beanie, red flannel shirt, jeans and work boots." },
  { folder: "Professions/Gardener_Male_01", name: "Frank", role: "Gardener", body: "masculine", style: "Service", description: "A gardener in brown overalls, gloves and yellow rubber boots." },
  { folder: "Professions/Wood_Male_01", name: "Rafael", role: "Woodworker", body: "masculine", style: "Service", description: "A woodworker in a light denim shirt, belted jeans, a beige cap and brown boots." },
  // Uniformed
  { folder: "Professions/Police_Male_01", name: "Rashid", role: "Police officer", body: "masculine", style: "Uniformed", description: "A police officer in a light blue uniform and cap with a duty belt." },
  { folder: "Professions/Police_Male_03", name: "Ben", role: "Police officer", body: "masculine", style: "Uniformed", description: "A police officer in a dark uniform and peaked cap." },
  { folder: "Professions/Police_Female_01", name: "Alex", role: "Riot police officer", body: "feminine", style: "Uniformed", description: "A riot police officer in black tactical gear with a POLICE vest and a helmet with a visor." },
  { folder: "Professions/Police_Male_02", name: "Marco", role: "SWAT officer", body: "masculine", style: "Uniformed", description: "A SWAT officer in black tactical gear with a balaclava, goggles and a S.W.A.T. vest." },
  { folder: "Professions/Police_Male_04", name: "Stefan", role: "Police officer", body: "masculine", style: "Uniformed", description: "An officer in a red beret, a black uniform shirt with a lanyard and badge, black trousers and boots." },
  { folder: "Professions/Police_Male_05", name: "Takeshi", role: "Police officer", body: "masculine", style: "Uniformed", description: "An officer in a white short-sleeved dress shirt with epaulettes, black trousers and a white peaked cap." },
  { folder: "Professions/Police_Male_06", name: "Danny", role: "Detective", body: "masculine", style: "Uniformed", description: "A detective in a white shirt under a black POLICE vest, jeans with a badge on the belt and black shoes." },
  { folder: "Professions/Police_Male_07", name: "Raymond", role: "Detective", body: "masculine", style: "Uniformed", description: "A detective in a white shirt and red tie under a navy POLICE vest, dark trousers and a badge on the belt." },
  { folder: "Professions/Security_Female_01", name: "Nadia", role: "Security guard", body: "feminine", style: "Uniformed", description: "A security guard in a black uniform and cap." },
  { folder: "Professions/Security_Male_01", name: "Ron", role: "Security guard", body: "masculine", style: "Uniformed", description: "A security guard in a grey uniform shirt with a black tie, a peaked cap, black trousers and a baton on his belt." },
  { folder: "Professions/Pilot_Male_01", name: "Michael", role: "Pilot", body: "masculine", style: "Uniformed", description: "An airline captain in a black uniform with gold stripes and a cap." },
  { folder: "Professions/Pilot_Female_02", name: "Aisha", role: "Pilot", body: "feminine", style: "Uniformed", description: "A pilot in a white short-sleeved shirt, dark trousers and a white cap." },
  { folder: "Professions/Pilot_Female_01", name: "Nora", role: "Pilot", body: "feminine", style: "Uniformed", description: "A pilot in a white long-sleeved shirt with epaulettes, dark trousers and a white peaked cap." },
  { folder: "Professions/Pilot_Male_02", name: "Robert", role: "Airline captain", body: "masculine", style: "Uniformed", description: "A grey-haired captain in a black uniform with four gold sleeve stripes, a black tie and a peaked cap." },
  { folder: "Professions/Pilot_Male_03", name: "Paulo", role: "First officer", body: "masculine", style: "Uniformed", description: "A pilot in a white short-sleeved shirt with epaulettes, dark trousers and a white peaked cap." },
  { folder: "Professions/Construction_Female_01", name: "Kate", role: "Construction worker", body: "feminine", style: "Uniformed", description: "A construction worker in blue overalls, a hi-vis vest and a hard hat." },
  { folder: "Professions/Construction_Male_03", name: "Samuel", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A construction worker in blue overalls, a tool belt and a hard hat." },
  { folder: "Professions/Construction_Male_01", name: "Gus", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in a white hard hat with a mesh face shield, a blue checked shirt, a tool belt and jeans." },
  { folder: "Professions/Construction_Male_02", name: "Pavel", role: "Construction worker", body: "masculine", style: "Uniformed", description: "An older worker in a white hard hat, a blue work jacket over blue dungarees and tan boots." },
  { folder: "Professions/Construction_Male_04", name: "Jonas", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in a white hard hat, a white polo shirt under blue dungarees, a tool belt and tan boots." },
  { folder: "Professions/Construction_Male_05", name: "Dieter", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in a white hard hat, a blue work jacket and trousers and tan boots." },
  { folder: "Professions/Construction_Male_06", name: "Milan", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in a white hard hat, a blue boiler suit with a tool belt and tan boots." },
  { folder: "Professions/Construction_Male_07", name: "Tobias", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in an orange hard hat and an orange hi-vis vest over blue overalls, with black boots." },
  { folder: "Professions/Construction_Male_08", name: "Idris", role: "Construction worker", body: "masculine", style: "Uniformed", description: "A worker in a white hard hat, a yellow hi-vis vest over blue overalls, yellow gloves and tan boots." },
  // Emergency
  { folder: "Professions/Fire_Male_06", name: "Carlos", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in tan turnout gear and a helmet." },
  { folder: "Professions/Fire_Female_01", name: "Jess", role: "Firefighter", body: "feminine", style: "Emergency", description: "A firefighter in tan turnout gear with reflective stripes, a breathing mask and a yellow helmet." },
  { folder: "Professions/Fire_Female_02", name: "Dana", role: "Firefighter", body: "feminine", style: "Emergency", description: "A firefighter in yellow turnout gear with a breathing mask and a yellow helmet." },
  { folder: "Professions/Fire_Female_03", name: "Sara", role: "Firefighter", body: "feminine", style: "Emergency", description: "A firefighter in a dark blue jacket and trousers with reflective stripes, a breathing mask and a white helmet." },
  { folder: "Professions/Fire_Male_01", name: "Mateo", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in a dark blue jacket and trousers with reflective stripes and a yellow helmet." },
  { folder: "Professions/Fire_Male_02", name: "Owen", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in yellow turnout gear, black gloves and a yellow helmet with a visor." },
  { folder: "Professions/Fire_Male_03", name: "Raj", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in tan turnout gear with yellow stripes and a white helmet with a visor." },
  { folder: "Professions/Fire_Male_04", name: "Niko", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in tan turnout gear with a breathing mask and a white helmet." },
  { folder: "Professions/Fire_Male_05", name: "Bruno", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in a dark blue jacket and trousers with reflective stripes and a white helmet with a face shield." },
  { folder: "Professions/Fire_Male_07", name: "Ivan", role: "Firefighter", body: "masculine", style: "Emergency", description: "A firefighter in a black jacket and trousers with yellow stripes, a breathing mask and a yellow helmet." },
  // Military
  { folder: "Professions/Military_Female_01", name: "Megan", role: "Soldier", body: "feminine", style: "Military", description: "A soldier in digital camouflage fatigues with a tactical vest, helmet, gloves and desert boots." },
  { folder: "Professions/Military_Female_02", name: "Priya", role: "Soldier", body: "feminine", style: "Military", description: "A soldier in digital camouflage fatigues with a tactical vest, helmet and desert boots." },
  { folder: "Professions/Military_Male_01", name: "Darius", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a tactical vest, a helmet with goggles, gloves and desert boots." },
  { folder: "Professions/Military_Male_02", name: "Luke", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a patrol cap and desert boots." },
  { folder: "Professions/Military_Male_03", name: "Cole", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a tactical vest, helmet, sunglasses, gloves and knee pads." },
  { folder: "Professions/Military_Male_04", name: "Amir", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a tactical vest, a helmet with a night-vision mount, gloves and knee pads." },
  { folder: "Professions/Military_Male_05", name: "Ethan", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a patrol cap, unit patches and desert boots." },
  { folder: "Professions/Military_Male_06", name: "Jamal", role: "Soldier", body: "masculine", style: "Military", description: "A soldier in digital camouflage fatigues with a patrol cap, rolled sleeves and desert boots." },
  // Sports
  { folder: "Professions/Sports_Female_02", name: "Yuna", role: "Athlete", body: "feminine", style: "Sports", description: "A woman in a grey tank top, track trousers and trainers." },
  { folder: "Professions/Sports_Female_01", name: "Lena", role: "Swimmer", body: "feminine", style: "Sports", description: "A woman with tied-back blonde hair in a pink floral bikini, barefoot." },
  { folder: "Professions/Sports_Male_02", name: "Leo", role: "Footballer", body: "masculine", style: "Sports", description: "A footballer in a striped kit, socks and boots." },
  { folder: "Professions/Sports_Male_04", name: "Ryan", role: "Runner", body: "masculine", style: "Sports", description: "A runner in a blue vest, white shorts and running shoes." },
  { folder: "Professions/Sports_Male_01", name: "Finn", role: "Swimmer", body: "masculine", style: "Sports", description: "A man in black swimming trunks, barefoot." },
  { folder: "Professions/Sports_Male_03", name: "Jerome", role: "Footballer", body: "masculine", style: "Sports", description: "A footballer with dreadlocks in a black and white striped kit with orange trim, striped socks and boots." },
  // Children
  { folder: "Children/Female_Child_01", name: "Lily", body: "feminine", style: "Children", description: "A blonde girl in a pink T-shirt and jeans." },
  { folder: "Children/Female_Child_02", name: "Amina", body: "feminine", style: "Children", description: "A girl in a maroon headscarf and a green embroidered tunic over trousers, with black shoes." },
  { folder: "Children/Male_Child_01", name: "Noah", body: "masculine", style: "Children", description: "A boy in a blue sweatshirt, jeans and trainers." },
  { folder: "Children/Male_Child_02", name: "Kofi", body: "masculine", style: "Children", description: "A boy in an orange number T-shirt, shorts and sandals." },
];

/** The name an avatar is cached and identified by. Upstream files
 * Female_Party_01/02 under both Adults and Professions, so a twin of an
 * Adults avatar carries its parent folder: the Adults one keeps the id the
 * library shipped with, and two avatars can never share an id. */
function stem(a) {
  const [parent, name] = a.folder.split("/");
  const twin =
    parent !== "Adults" && cast.some((b) => b.folder === `Adults/${name}`);
  return twin ? `${parent}_${name}` : name;
}
const avatarName = (a) => a.folder.split("/")[1];
/** Every id this source gives out starts with it (see characters.mjs). */
export const idPrefix = "rocketbox-";
export const idOf = (a) =>
  idPrefix + stem(a).toLowerCase().replaceAll("_", "-");

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
 * shapes), its preview and its colour, normal and opacity textures, including
 * variants such as the soldiers' "_color_acu" camouflage sheets. Specular maps
 * are skipped (the corrected materials are dielectric), and so are the wrinkle
 * normals only the facial FBX uses. */
function avatarFiles(tree, avatar) {
  const base = `Assets/Avatars/${avatar.folder}/`;
  const name = avatarName(avatar);
  const files = tree.filter(
    (t) =>
      t.type === "blob" &&
      (t.path === `${base}Export/${name}.fbx` ||
        t.path === `${base}${name}.png` ||
        (t.path.startsWith(`${base}Textures/`) &&
          /_(color|normal)(_(?!wrinkle)[a-z]+)?\.tga$/i.test(t.path))),
  );
  if (!files.some((f) => f.path.endsWith(".fbx")))
    throw Error(`${name}: no FBX upstream`);
  return files;
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
        stem(a),
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

// Blender helper, written next to the cache when the build runs: re-encode
// each TGA as JPEG (≤2k colour, ≤1k normal) or, for the RGBA hair/lash
// opacity sheet, PNG (≤1k).
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
 * sort over the face (glasses keep their blended lenses), and the empty
 * two-frame "Take 001" is dropped so the character carries no meaningless
 * action. */
function correctGlb(file) {
  rewriteGlb(file, (json) => {
    for (const material of json.materials ?? []) {
      // Whole words only: a firefighter's "flashlight" is not a lash sheet.
      const hair = /opacity|(?<![a-z])(hair|lash)/i.test(material.name ?? "");
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
  });
}

async function convert(avatar, { out, cache, root, log }) {
  const name = avatarName(avatar);
  const id = idOf(avatar);
  const scripts = path.join(cache, "rocketbox");
  const src = path.join(scripts, stem(avatar));
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
      blenderScript(scripts, "prepare.py", PREPARE_PY),
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
  if (!fs.existsSync(thumb))
    await cropPreview({
      root,
      scriptDir: scripts,
      src: path.join(src, name + ".png"),
      dst: thumb,
    });
}

export async function build({ out, cache, root, log }) {
  // CHARACTERS_ONLY=<id>,<id> rebuilds just those (for converter work).
  const only = process.env.CHARACTERS_ONLY?.split(",");
  const avatars = only ? cast.filter((a) => only.includes(idOf(a))) : cast;
  await downloadAll({ cache, log, avatars });
  // Blender runs are single-threaded enough to convert a few side by side.
  await pool(avatars, 6, (avatar) =>
    convert(avatar, { out, cache, root, log }),
  );
  const entries = [];
  for (const a of cast) {
    const glb = path.join(out, "characters", idOf(a) + ".glb");
    if (!fs.existsSync(glb)) continue;
    entries.push({
      id: idOf(a),
      name: a.role ? `${a.name} — ${a.role}` : a.name,
      category: "characters",
      style: a.style,
      body: a.body,
      // The files are made at real-world scale, so each person keeps their
      // own height (a child about 1.4 m) rather than the studio's 1.85 m.
      height: Number((await glbHeight(glb)).toFixed(3)),
      url: `/content/characters/${idOf(a)}.glb`,
      thumbnail: `/content/characters/${idOf(a)}.png`,
      description: a.description,
      credit: {
        author: "Microsoft",
        license: "MIT",
        source: `${REPO}/tree/${COMMIT}/Assets/Avatars/${a.folder}`,
      },
    });
  }
  return entries;
}
