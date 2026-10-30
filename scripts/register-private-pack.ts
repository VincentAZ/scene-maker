/** Register pre-converted, user-owned models through the running studio's APIs.
 * npx tsx scripts/register-private-pack.ts /private/pack.json [http://127.0.0.1:4311]
 * Never edits an existing project or copies licensed models into public/.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  applyCommands,
  assetSchema,
  validateScene,
  type Asset,
  type Motion,
  type Scene,
} from "../shared/scene";

const placementSchema = z.object({
  position: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  rotation: z.number().finite().default(0),
  scale: z.number().min(0.1).max(10).default(1),
  action: z.string().optional(),
});
export const privatePackSchema = z.object({
  name: z.string().min(1).max(100),
  mission: z.string().max(4000),
  models: z.array(z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: assetSchema.shape.name,
    category: z.enum(["characters", "props"]),
    body: assetSchema.shape.body,
    description: assetSchema.shape.description,
    glb: z.string().min(1),
    thumbnail: z.string().min(1),
    seat: assetSchema.shape.seat,
    placement: placementSchema.optional(),
  })).min(1).max(100),
}).superRefine((pack, ctx) => {
  if (new Set(pack.models.map((model) => model.slug)).size !== pack.models.length)
    ctx.addIssue({ code: "custom", message: "Model slugs must be unique." });
});
export type PrivatePack = z.infer<typeof privatePackSchema>;
export type ImportedPrivateModel = {
  definition: PrivatePack["models"][number];
  sha256: string;
  url: string;
  thumbnail: string;
  animations: { name: string; duration: number }[];
};

export function localStudioURL(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw Error("Choose a local studio origin, such as http://127.0.0.1:4311.");
  return url;
}

export function privatePackScene(pack: PrivatePack, imported: ImportedPrivateModel[]): Scene {
  if (imported.length !== pack.models.length || imported.some((item, index) => item.definition.slug !== pack.models[index].slug))
    throw Error("Imported models do not match the pack manifest.");
  const customAssets: Asset[] = imported.map(({ definition, sha256, url, thumbnail }) => {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw Error("Missing model content hash.");
    return assetSchema.parse({
      id: `private-${definition.slug}-${sha256.slice(0, 12)}`,
      name: definition.name,
      category: definition.category,
      body: definition.body,
      style: "Imported",
      color: "#8d9e92",
      url,
      thumbnail,
      description: definition.description,
      ...(definition.seat ? { seat: definition.seat } : {}),
    });
  });
  const customMotions: Motion[] = imported.flatMap((item, index) => item.animations.map((animation, take) => {
    if (item.definition.category !== "characters") throw Error("Only characters can supply humanoid actions.");
    return {
      id: `${customAssets[index].id}-action-${take + 1}`,
      name: animation.name,
      kind: "imported" as const,
      duration: animation.duration,
      distance: 0,
      poses: [],
      sourceAssetId: customAssets[index].id,
      animationName: animation.name,
    };
  }));
  let scene: Scene = validateScene({
    version: 1,
    id: randomUUID(),
    revision: 0,
    name: pack.name,
    environment: "studio",
    lighting: "daylight",
    mission: pack.mission,
    entities: [],
    customAssets,
    customMotions,
    transcript: [],
  });
  for (let index = 0; index < imported.length; index++) {
    const { placement } = imported[index].definition;
    if (!placement) continue;
    const id = randomUUID();
    scene = applyCommands(scene, [
      { type: "add", assetId: customAssets[index].id, id, position: placement.position },
      { type: "update", id, changes: { rotation: placement.rotation, scale: placement.scale } },
    ]);
    if (placement.action) {
      const matches = customMotions.filter((action) => action.name === placement.action);
      if (matches.length !== 1) throw Error(`Showcase action must identify one take: ${placement.action}`);
      // Preserve the take's real duration: shortening a clip time-scales it.
      scene = applyCommands(scene, [{ type: "chain", id, motionId: matches[0].id }]);
    }
  }
  return validateScene(scene);
}

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function registerPrivatePack(manifestFile: string, studio = "http://127.0.0.1:4311") {
  const base = localStudioURL(studio), manifestPath = path.resolve(manifestFile);
  const manifestBytes = await fs.readFile(manifestPath);
  const pack = privatePackSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const receiptFile = manifestPath + ".receipt.json";
  const signature = hash(manifestBytes);
  const request = async (route: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(route, base), {
      ...init,
      headers: { "X-Scene-Maker": "1", ...init.headers },
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) throw Error(`${route}: ${response.status} ${(await response.text()).slice(0, 1000)}`);
    return response;
  };
  // Preflight every local file BEFORE uploading anything. Hashes are part of the
  // receipt, so a changed model/preview cannot accidentally reuse an old import.
  const files = await Promise.all(pack.models.map(async (definition) => {
    const glb = await fs.readFile(path.resolve(path.dirname(manifestPath), definition.glb));
    const png = await fs.readFile(path.resolve(path.dirname(manifestPath), definition.thumbnail));
    if (glb.length < 28 || glb.toString("ascii", 0, 4) !== "glTF"
        || glb.readUInt32LE(4) !== 2 || glb.readUInt32LE(8) !== glb.length)
      throw Error(`Invalid GLB: ${definition.slug}`);
    if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        || png.toString("ascii", 12, 16) !== "IHDR"
        || png.readUInt32BE(16) < 1 || png.readUInt32BE(16) > 1024
        || png.readUInt32BE(20) < 1 || png.readUInt32BE(20) > 1024)
      throw Error(`Invalid thumbnail: ${definition.slug}`);
    return { definition, glb, png, sha256: hash(glb), previewSha256: hash(png) };
  }));
  const contentSignature = hash(Buffer.from(JSON.stringify(files.map(({ sha256, previewSha256 }) => [sha256, previewSha256]))));
  let receipt: { studio: string; manifestSha256: string; contentSha256: string; scene: Scene; imported: ImportedPrivateModel[] } | undefined;
  try { receipt = JSON.parse(await fs.readFile(receiptFile, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (receipt) {
    if (receipt.studio !== base.origin || receipt.manifestSha256 !== signature || receipt.contentSha256 !== contentSignature)
      throw Error("The manifest or source content changed. Use a new manifest/receipt path to import a new collection.");
    // Do not overwrite subsequent user edits, even when rerunning this command.
    const response = await request(`/api/projects/${receipt.scene.id}`);
    const saved = validateScene(await response.json());
    console.log(`Already imported: ${saved.name} (${saved.id}); no uploads or project edits.`);
    return saved;
  }
  await request("/api/health");
  const upload = async (route: string, bytes: Buffer, filename: string, type: string) => {
    const body = new FormData();
    body.append("file", new Blob([new Uint8Array(bytes)], { type }), filename);
    return (await request(route, { method: "POST", body })).json();
  };
  const imported: ImportedPrivateModel[] = [];
  for (const file of files) {
    const model = await upload("/api/import", file.glb, file.definition.slug + ".glb", "model/gltf-binary");
    const thumbnail = await upload("/api/thumbnails", file.png, file.definition.slug + ".png", "image/png");
    imported.push({ definition: file.definition, sha256: file.sha256, url: model.url,
      thumbnail: thumbnail.url, animations: model.animations });
    console.log(`Uploaded ${file.definition.name}: ${model.animations.length} takes`);
  }
  const scene = privatePackScene(pack, imported);
  const saved = validateScene(await (await request(`/api/projects/${scene.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(scene),
  })).json());
  const record = { studio: base.origin, manifestSha256: signature, contentSha256: contentSignature,
    importedAt: new Date().toISOString(), scene: saved, imported };
  // Exclusive creation prevents silently replacing another run's receipt.
  await fs.writeFile(receiptFile, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  console.log(`Ready in Projects: ${saved.name} (${saved.id})`);
  console.log(`Private receipt: ${receiptFile}`);
  return saved;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (!process.argv[2]) {
    console.error("Usage: npx tsx scripts/register-private-pack.ts /private/pack.json [http://127.0.0.1:4311]");
    process.exitCode = 1;
  } else {
    registerPrivatePack(process.argv[2], process.argv[3]).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
