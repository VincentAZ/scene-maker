import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assetSchema, type Asset } from "../shared/scene";
import { libraryCharacters } from "../shared/characterLibrary";
import { atomicWrite, dataDir } from "./storage";

const run = promisify(execFile);
export async function generateCharacter(
  input: unknown,
  blender: string,
  signal?: AbortSignal,
): Promise<Asset> {
  const asset = assetSchema.parse(input);
  if (asset.category !== "characters" || asset.url)
    throw Error("Create a new character design before making its model.");
  signal?.throwIfAborted();
  const base =
    asset.design &&
    libraryCharacters.find((entry) => entry.id === asset.design!.baseId);
  if (base) {
    asset.body = base.body;
    asset.style = base.style;
  }
  const id = crypto.randomUUID(),
    directory = path.join(dataDir, "uploads"),
    spec = path.join(directory, id + ".json"),
    output = path.join(directory, id + ".glb"),
    thumbnail = path.join(directory, id + ".png");
  fs.mkdirSync(directory, { recursive: true });
  try {
    atomicWrite(spec, {
      ...asset,
      ...(base
        ? {
            templatePath: path.resolve("public" + base.url),
            previewPath: thumbnail,
          }
        : {}),
    });
    await run(
      blender,
      [
        "--background",
        "--factory-startup",
        "--disable-autoexec",
        "--threads",
        "4",
        "--python-exit-code",
        "1",
        "--python",
        path.resolve(
          base ? "engine/customize_character.py" : "engine/create_character.py",
        ),
        "--",
        spec,
        output,
      ],
      { timeout: 120000, maxBuffer: 2 * 1024 * 1024, signal },
    );
    signal?.throwIfAborted();
    const bytes = fs.readFileSync(output);
    if (
      bytes.length < 20 ||
      bytes.toString("ascii", 0, 4) !== "glTF" ||
      bytes.readUInt32LE(4) !== 2 ||
      bytes.readUInt32LE(8) !== bytes.length
    )
      throw Error(
        "The character could not be prepared. Try creating it again.",
      );
    if (base && !fs.existsSync(thumbnail))
      throw Error("The character preview could not be prepared.");
    return assetSchema.parse({
      ...asset,
      url: "/uploads/" + id + ".glb",
      ...(base ? { thumbnail: "/uploads/" + id + ".png" } : {}),
    });
  } catch (error) {
    for (const file of [output, thumbnail]) fs.rmSync(file, { force: true });
    const failure = error as Error & { code?: string | number };
    if (failure.code === "ENOENT")
      throw new Error(
        "The character maker needs a connection. Open Studio settings → Connections to finish setup.",
        { cause: error },
      );
    if (failure.name !== "AbortError" && failure.code !== undefined)
      throw new Error(
        "Your character could not be made. Try again, or choose another starting look.",
        { cause: error },
      );
    throw error;
  } finally {
    fs.rmSync(spec, { force: true });
  }
}
