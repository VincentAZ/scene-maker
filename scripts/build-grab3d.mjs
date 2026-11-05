#!/usr/bin/env node
// Builds the Grab3D characters on their own and merges their catalogue
// entries into shared/content/characters.json, replacing earlier Grab3D
// entries and keeping every other source's. scripts/build-content.mjs builds
// the whole characters category; this is for work on this one source.
//   node scripts/build-grab3d.mjs
//   CHARACTERS_ONLY=grab3d-soldier node scripts/build-grab3d.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./content/characters/grab3d.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.env.SCENE_MAKER_CONTENT || "content");
const cache = path.join(out, ".cache");
const log = (...m) => console.log("[grab3d]", ...m);

fs.mkdirSync(cache, { recursive: true });
const entries = await build({ out, cache, root, log });
const file = path.join(root, "shared/content/characters.json");
const others = JSON.parse(fs.readFileSync(file, "utf8")).filter(
  (entry) => !entry.id.startsWith("grab3d-"),
);
fs.writeFileSync(file, JSON.stringify([...others, ...entries], null, 2) + "\n");
log(`${entries.length} items`);
