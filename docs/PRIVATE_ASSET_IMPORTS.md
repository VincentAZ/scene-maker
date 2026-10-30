# Private downloaded asset collections

User-owned/licensed downloads are imported into private studio storage, **not** added to `public/library` or committed to git. Possessing an archive does not establish redistribution rights. Preserve the original downloads and purchase/licence records; check the applicable licence before sharing editable projects, source models, or a bundled application.

## ActorCore collection

The supplied ActorCore Unity downloads were converted and registered as a separate saved project:

**Projects → ActorCore — upgraded asset collection**

- Characters: Party Woman, Party Man, Toon Goon, Motion Dummy — Female, Motion Dummy — Male.
- Prop: Classic Park Bench, with measured seat metadata (surface about 0.429 m above the floor).
- Shared actions: Stand and talk (28.133 s), Thoughtful walk (34 s), Relax (17.7 s).
- The duplicate stand-and-talk archive was not imported twice.
- Original source proportions, skinning, facial morph targets, and real motion durations are retained. Textures are embedded, limited to 2048 pixels per side. Previews are rendered from re-imported GLBs, with neutral arm calibration for characters.
- The showcase preserves original model heights through entity scale. The studio normally normalizes imported character models to 1.85 m before entity scale is applied.

The side panel now has a **private studio-wide catalog** (available after deploying this source change). Saved imported characters, props, sets, and actions appear in their normal categories in every project, including a new empty scene. Choose **My assets** or **My actions**, or use search. Opening/cloning the showcase project is no longer required.

`GET /api/library` reads saved projects without changing their contents or revisions, preferring the newest saved definitions and skipping missing uploaded models and their dependent actions. The current project’s own definitions always take precedence. Catalog metadata is refreshed when the studio opens, changes project, or regains focus; failures show a retryable notice without blocking project editing.

Clicking or completing a drag copies only the selected definition into the project, as part of one undoable edit. Adding a shared action also copies its source-rig definition **without placing another character**. Action previews copy dependencies only into a disposable rehearsal and never change the project. This keeps saved scenes and portable exports independent of the source collection. Browsing the catalog does not fill every scene with the entire library.

The catalog discovers assets from saved projects; it is not a separately maintained asset database. Preserve at least one saved project containing an unused import if you want that import to remain discoverable. Model/thumbnail file contents are not revalidated on every catalog read; normal runtime loading and conversion verification still apply. Licensed files remain in private studio storage and are never added to the bundled public library.

A private production ZIP, individual GLBs, previews, and an import report were also saved alongside the user's downloads, under `Scene Maker Ready`. The ZIP contains the baked animated scene, editable project, original imported assets/previews, and the normal Blender/Unreal adapters. This is a private backup, not a redistribution permission. The Unreal adapter is not evidence of tested Unreal playback.

## Reproduce a conversion

Safely extract copies of purchased archives into an ignored/private working folder. Do not execute archive scripts, install bundled plugins, or overwrite originals. Keep each FBX with its JSON sidecar and complete relative texture folders.

```sh
"$BLENDER_PATH" --background --factory-startup --disable-autoexec \
  --python-exit-code 1 --python engine/prepare_actorcore.py -- \
  --source /private/extracted/Actor/person/person.fbx \
  --output /private/prepared/person.glb \
  --max-texture 2048 --preview-size 512 --samples 24
```

For a matching motion-dummy body, add explicitly named takes:

```sh
  --motion "Stand and talk=/private/extracted/Motion/stand-talk.fbx"
```

Only genuinely matching skeletons are attached; mismatches fail. A `.png` preview and `.json` verification/provenance report are written beside the GLB. Optional `--blend /private/prepared/person.blend` saves an editable Blender copy. Originals are hashed before and after conversion.

### Important FBX bind-frame detail

These ActorCore FBXs can have an animated armature object frame different from their actual FBX BindPose. A naive Blender-to-glTF export can show an upright mesh while Three.js reads horizontal joint origins. Blender re-import alone did not catch this.

The converter restores authoritative FBX bind frames and explicitly rebases root motion. It checks source motion parity, canonicalizes only verified `CC_Base_*` joints, removes tightly bounded numerical scale/translation noise, and updates inverse-bind matrices together. It independently verifies raw glTF node worlds and all-vertex skinning, then re-imports in Blender. Raw joints must agree with the mesh's Y-up frame. Do not replace this with a warning suppression or an arbitrary visual rotation.

## Register converted models

Create a **private** JSON manifest next to the prepared files:

```json
{
  "name": "My private asset collection",
  "mission": "Review the newly imported assets.",
  "models": [
    {
      "slug": "person",
      "name": "Person",
      "category": "characters",
      "body": "feminine",
      "description": "Private licensed import.",
      "glb": "prepared/person.glb",
      "thumbnail": "prepared/person.png",
      "placement": { "position": [0, 0, 0], "scale": 1 }
    }
  ]
}
```

```sh
npx tsx scripts/register-private-pack.ts /private/pack.json
```

The registration script:

- accepts only a local studio origin (default `http://127.0.0.1:4311`);
- preflights local GLB/PNG files before making uploads;
- uses the existing import, thumbnail, and optimistic project-save APIs;
- registers native takes as reusable source-backed custom motions;
- creates a new project, never overwriting an existing one; its saved imports become discoverable in the studio-wide side panel;
- writes a private receipt containing hashes, upload references, and the saved scene;
- detects a repeated import using manifest and file hashes, returning the saved project without re-uploading or overwriting subsequent edits.

For a showcase action, set `placement.action` to an unambiguous native take name. Its original duration is used; shortening a timeline clip would otherwise speed up the entire take. Omit placement to include a model in the library without adding an entity.

Do not run concurrent registrations of the same manifest. If a network failure occurs before a receipt is saved, uploaded files may remain unreferenced; inspect the saved project list and private files before retrying. The script intentionally refuses changed manifests/source content at an existing receipt path. Use a new manifest path to create a new collection version.

## Coffee shop: pending portable export

The supplied Cosmos coffee-shop ZIP is an **Unreal 4.27 project**, not a portable model pack. Inspection found 66 static-mesh packages, 55 texture packages, and two maps, but no loose FBX, glTF, GLB, or image files. No verified local Unreal editor/export route was available; no fake substitute environment was imported, no project plugins were executed, and no large engine runtime was installed.

Fastest next step: obtain the vendor's FBX/Blender/glTF download, if available under the purchased licence. Otherwise use an authorized compatible Unreal editor on a **copy** of the project and export the furnished showcase level with transforms, complete textures and materials. Prefer a self-contained GLB. A set of isolated meshes without the level layout is not an equivalent environment import. Keep useful standalone chairs/tables/cups as separate assets for placement and interaction.

## Production-package size

The full six-model showcase produced an approximately 200 MB uncompressed production ZIP, exceeding the running studio's 100 MB upload limit. Lossless DEFLATE level 6 reduced the actual package to approximately 85 MB, with unchanged inner file bytes. `productionPackage` now uses this compression policy in source; the initial private backup was produced and accepted using the same compression in the isolated inspection tab. **The source change is not deployed automatically.**

Compression is not a guarantee that every future scene fits the limit. An already-compressed or substantially larger project can still exceed it. The original models were not degraded to work around the limit.

## Verification

```sh
npm run check
npm test
npm run build
BLENDER_PATH=/path/to/blender python3 -m unittest discover -s tests -p test_actorcore.py -v
```

The Blender tests create and convert actual FBX fixtures. They test missing textures, source-file protection, PBR image embedding, skins/morphs, complete non-default takes, bind frames, inverse matrices, raw glTF upright-joint verification, and CPU-rendered PNGs. Set `BLENDER_PATH` to run integration tests; without a discoverable Blender executable those tests explicitly skip.

Real downloaded assets were additionally checked using actual texture decoding and rendering in Chrome: all six loaded, all five humanoid rigs were recognized, all 15 character/action combinations had no transfer warnings, all three native takes ran, and procedural wave/sitting poses stayed finite without runtime warnings. These checks do not certify cinematic motion quality or eliminate the need for human visual review.
