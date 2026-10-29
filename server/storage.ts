import fs from "node:fs";
import path from "node:path";
import { validateScene, type Scene } from "../shared/scene";
export const dataDir = path.resolve(process.env.SCENE_MAKER_DATA || ".data");
fs.mkdirSync(path.join(dataDir, "projects"), { recursive: true, mode: 0o700 });
fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true, mode: 0o700 });
export function readJSON<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
export function atomicWrite(file: string, data: unknown) {
  const temp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
export function projectPath(id: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw Error("Invalid project ID.");
  return path.join(dataDir, "projects", id + ".json");
}
export function saveProject(input: unknown): Scene {
  const scene = validateScene(input),
    file = projectPath(scene.id),
    existing = readJSON<Scene | null>(file, null);
  if (existing && existing.revision !== scene.revision)
    throw Object.assign(
      Error(
        "This project changed in another window. Export your changes before reopening the saved project.",
      ),
      { status: 409 },
    );
  const saved = { ...scene, revision: scene.revision + 1 };
  atomicWrite(file, saved);
  return saved;
}

export function readProject(id: string): Scene {
  const found = readJSON<Scene | null>(projectPath(id), null);
  if (!found) throw Object.assign(Error("Project not found."), { status: 404 });
  return validateScene(found);
}
export function listProjects() {
  const projects: {
    id: string;
    name: string;
    revision: number;
    environment: Scene["environment"];
    updated: number;
  }[] = [];
  for (const file of fs.readdirSync(path.join(dataDir, "projects"))) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
    try {
      const s = readProject(file.slice(0, -5));
      projects.push({
        id: s.id,
        name: s.name,
        revision: s.revision,
        environment: s.environment,
        updated: fs.statSync(projectPath(s.id)).mtimeMs,
      });
    } catch (error) {
      // One unreadable or outdated file must not take every other project offline.
      console.warn(
        `Skipping project file ${file}: ${(error as Error).message}`,
      );
    }
  }
  return projects.sort((a, b) => b.updated - a.updated);
}
