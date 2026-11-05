// Zip extraction for downloaded sources. Each archive is unpacked into its
// own folder once; a marker file records the finished extraction so a rebuild
// is instant. Archives are untrusted downloads: nothing inside is executed,
// the folder is only read by the converters.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function extract(archive, dir, { log } = {}) {
  const marker = path.join(dir, ".extracted");
  if (fs.existsSync(marker)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  log?.(`extracting ${path.basename(archive)}`);
  const run = spawnSync("unzip", ["-q", "-o", archive, "-d", dir], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (run.error) throw Error(`unzip is needed to unpack ${archive}.`);
  // unzip exits 1 for harmless warnings (e.g. backslashes in names).
  if (run.status > 1)
    throw Error(`unzip failed on ${archive}: ${run.stderr || run.stdout}`);
  fs.writeFileSync(marker, new Date().toISOString());
  return true;
}

/** The first file below `dir` whose name matches, searched breadth first. */
export function findFile(dir, pattern) {
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries)
      if (entry.isFile() && pattern.test(entry.name))
        return path.join(current, entry.name);
    for (const entry of entries)
      if (entry.isDirectory()) queue.push(path.join(current, entry.name));
  }
  return null;
}
