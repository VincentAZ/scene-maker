// Realistic characters come from several sources, one module per source in
// scripts/content/characters/<source>.mjs, each exporting
// build({ out, cache, root, log }) → catalogue entries. Every module in that
// folder runs, in name order, and the entries are concatenated.
// CHARACTER_SOURCES=rocketbox,grab3d limits a run to those sources; the other
// sources' entries are then kept from the current catalogue. A module may
// export `idPrefix`, the start of every id it owns, so that such a run also
// drops the entries it no longer builds.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const folder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "characters",
);

function sources() {
  return fs
    .readdirSync(folder)
    .filter((f) => f.endsWith(".mjs"))
    .map((f) => f.slice(0, -".mjs".length))
    .sort();
}

export async function build({ out, cache, root, log }) {
  const available = sources();
  const chosen = process.env.CHARACTER_SOURCES?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const name of chosen ?? [])
    if (!available.includes(name))
      throw Error(
        `Unknown character source "${name}" (have ${available.join(", ")})`,
      );
  const built = [];
  const owned = [];
  for (const source of available) {
    if (chosen && !chosen.includes(source)) continue;
    const module = await import(path.join(folder, source + ".mjs"));
    const entries = await module.build({
      out,
      cache,
      root,
      log: (...m) => log(`${source}:`, ...m),
    });
    log(`${source}: ${entries.length} characters`);
    built.push(...entries);
    if (module.idPrefix) owned.push(module.idPrefix);
  }
  const ids = new Set();
  for (const entry of built) {
    if (ids.has(entry.id)) throw Error(`Two characters share the id ${entry.id}`);
    ids.add(entry.id);
  }
  if (!chosen) return built;
  const catalogue = path.join(root, "shared/content/characters.json");
  const current = fs.existsSync(catalogue)
    ? JSON.parse(fs.readFileSync(catalogue, "utf8"))
    : [];
  return mergeCatalogue({ current, built, owned });
}

/** The catalogue after a limited run: rebuilt entries replace their current
 * ones in place and new ones follow; a current entry whose id starts with an
 * `owned` prefix but was not rebuilt (removed or renamed upstream) is
 * dropped; every other source's entries are kept as they are. */
export function mergeCatalogue({ current, built, owned }) {
  const fresh = new Map(built.map((e) => [e.id, e]));
  const kept = current
    .filter((e) => fresh.has(e.id) || !owned.some((p) => e.id.startsWith(p)))
    .map((e) => fresh.get(e.id) ?? e);
  const known = new Set(current.map((e) => e.id));
  return [...kept, ...built.filter((e) => !known.has(e.id))];
}
