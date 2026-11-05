#!/usr/bin/env node
// Builds the realistic library into content/ (git-ignored) and writes each
// category's catalogue to shared/content/<category>.json (committed).
//   node scripts/build-content.mjs                 build what is missing
//   node scripts/build-content.mjs props sets      only these categories
//   node scripts/build-content.mjs --check         exit 1 if files are missing
//   node scripts/build-content.mjs --defer-3d-sets keep the real 3D sets as
//                                                  listed (about 2 GB of
//                                                  downloads converted by
//                                                  Blender) for a later run
// Each category is a module in scripts/content/<category>.mjs exporting
// `build({ out, cache, log })`, which returns catalogue entries and is
// idempotent: finished files are kept, downloads are cached in content/.cache.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.resolve(root, process.env.SCENE_MAKER_CONTENT || "content");
const cache = path.join(out, ".cache");
const categories = ["characters", "props", "sets"];
const args = process.argv.slice(2);
const chosen = args.filter((a) => !a.startsWith("--"));

if (args.includes("--check")) {
  const missing = categories.flatMap((category) =>
    JSON.parse(
      fs.readFileSync(
        path.join(root, "shared/content", `${category}.json`),
        "utf8",
      ),
    )
      .flatMap((e) => [e.url, e.thumbnail, e.hdri, e.backdrop?.image])
      .filter((url) => url?.startsWith("/content/"))
      .filter((url) => !fs.existsSync(path.join(out, url.slice(9)))),
  );
  if (missing.length) {
    console.log(`${missing.length} library files are missing.`);
    process.exit(1);
  }
  process.exit(0);
}

fs.mkdirSync(cache, { recursive: true });
for (const category of chosen.length ? chosen : categories) {
  const modulePath = path.join(root, "scripts/content", `${category}.mjs`);
  if (!fs.existsSync(modulePath)) continue;
  const { build } = await import(modulePath);
  const log = (...m) => console.log(`[${category}]`, ...m);
  const entries = await build({
    out,
    cache,
    root,
    log,
    deferModels: args.includes("--defer-3d-sets"),
  });
  fs.writeFileSync(
    path.join(root, "shared/content", `${category}.json`),
    JSON.stringify(entries, null, 2) + "\n",
  );
  log(`${entries.length} items`);
}
