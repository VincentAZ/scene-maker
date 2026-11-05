#!/usr/bin/env node
// Converts the Blender Studio characters and merges their entries into
// shared/content/characters.json, for work on that converter alone:
//   node scripts/merge-blender-studio.mjs
//   CHARACTERS_ONLY=blender-rain node scripts/merge-blender-studio.mjs
// The full catalogue build (scripts/build-content.mjs) regenerates the file.
// It lives outside scripts/content/characters/, whose modules the
// characters catalogue imports as sources.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "./content/characters/blender-studio.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.env.SCENE_MAKER_CONTENT || "content");
const log = (...m) => console.log("[characters]", ...m);
const entries = await build({
  out,
  cache: path.join(out, ".cache"),
  root,
  log,
});
const file = path.join(root, "shared/content/characters.json");
// This source owns every blender- entry: one no longer in the cast goes.
const others = JSON.parse(fs.readFileSync(file, "utf8")).filter(
  (entry) => !entry.id.startsWith("blender-"),
);
fs.writeFileSync(file, JSON.stringify([...others, ...entries], null, 2) + "\n");
log(`${entries.length} Blender Studio items`);
