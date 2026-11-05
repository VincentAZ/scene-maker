# Realistic character library

The characters offered in the library are realistic, rigged, textured humans downloaded and converted at build time by `node scripts/build-content.mjs characters`. The converted files live in `content/characters/` (git-ignored, served at `/content/`); the committed catalogue is `shared/content/characters.json`, and every entry records its author, licence and source URL in `credit`. Only CC0, CC BY, CC BY-SA and MIT content is shipped.

## Sources

- **Microsoft Rocketbox** (115 characters, [MIT](https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md)): the complete avatar library, pinned to commit `0943055d`. Adults, children and professions (business, medical, chef, delivery, gardener, woodworker, construction, police, security, pilots, firefighters, soldiers, athletes). Display names, roles, collections and descriptions belong to Scene Maker; the ids come from the upstream folder names (`rocketbox-female-adult-01`). `Female_Party_01/02` exist under both `Adults` and `Professions` upstream, so a twin under another folder would carry its folder in its id; the Adults pair keep the plain ids. The two Professions copies hold only a stray facial FBX and are not converted.
- **Blender Studio** characters (CC BY 4.0) and **Grab3D** rigged characters (CC0) are being added as further source modules on the same pipeline; their credits appear in the catalogue when their modules land.

Sources that cannot be bundled stay with the creator's own account: Adobe Mixamo characters and animations are imported by the creator through the guided round trip (see below) and are never shipped with the app.

## Pipeline

`scripts/content/characters.mjs` is a dispatcher: every module in `scripts/content/characters/` exports `build({ out, cache, root, log })` and returns catalogue entries; the modules run in name order and their entries are concatenated. `CHARACTER_SOURCES=rocketbox,grab3d` limits a run to those sources and keeps the other sources' entries from the current catalogue. Shared helpers (download pool with retries, the Blender runner, GLB JSON rewriting, the Biped clavicle fix, the preview crop) live in `scripts/content/lib.mjs`.

The Rocketbox module (`scripts/content/characters/rocketbox.mjs`) downloads each avatar's non-facial FBX, its preview render and its colour, normal and opacity textures (including variant sheets such as the soldiers' `_color_acu`; specular and wrinkle maps are skipped) into `content/.cache/rocketbox/<Avatar>/`, then:

1. shrinks and re-encodes the 4K TGA textures in Blender (JPEG ≤2k for colour, ≤1k for normals; PNG ≤1k for the RGBA hair/lash sheet) and renames the references inside the binary FBX in place;
2. converts the FBX with the app's own importer, `engine/convert.py` (bind frame restored from the FBX bind pose, no scale or axis change: the centimetre units survive as a 0.01 scale on the Biped root);
3. corrects the GLB: every material becomes dielectric (Rocketbox ships them fully metallic, which renders as dark chrome), hair and lashes are alpha-tested so their cards never sort over the face, the empty "Take 001" is dropped, the children's `Bip02` prefix becomes `Bip01`, and the clavicles are re-parented from the neck to the chest while keeping their world binds, so a neck bend no longer swings the shoulders;
4. crops the upstream preview render to the figure as the 384 px card;
5. records the character's standing height, measured from the converted file's bind pose (hats and helmets included), as `height` in the catalogue. The studio shows a character at its recorded height, so the children stand about 1.4 m tall and the adults 1.72–1.87 m; a character without one (an import, a Mixamo download) is sized to 1.85 m as before.

Conversions are idempotent (a GLB is rebuilt only when it or its `converted-v<version>` stamp is missing), run six side by side, and `CHARACTERS_ONLY=<id>,<id>` limits a rebuild. The library was built with the bundled Blender 4.5 LTS; set `BLENDER_PATH` to pin it. Every character is recognised by the studio's rig mapping (3ds Max Biped names) with all fifteen body roles, stands on the floor and takes the studio actions; `tests/characters.test.ts` checks the catalogue and, when the files are built, every GLB.

## Mixamo

Adobe forbids redistributing Mixamo files, so the studio never bundles them. **Generate with AI · Rig with Mixamo** prepares any character, including the realistic library, as an unrigged FBX, opens mixamo.com and watches the Downloads folder. The downloads can be imported as one character (the file downloaded With Skin plus its animations) or, with **Each file becomes its own character**, as a batch of up to 40 files: every skinned file becomes a character named after its file ("Ch14_nonPBR" → "Ch14"), the skinless animation files after it become its actions, and the one-frame T-pose take is left out. Card thumbnails are rendered in the browser.

## Retired stylized library

Earlier versions bundled 32 stylized low-poly humanoids from [Quaternius's Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html) (CC0 1.0; licence preserved at [public/library/quaternius/LICENSE.txt](../public/library/quaternius/LICENSE.txt), per-file provenance in [character-sources.json](character-sources.json)). They are no longer offered in the library but still back the [motion bank](MOTION_ASSETS.md) and the character maker's starting looks: `scripts/prepare-character-library.ts` restores their bind pose from the skin inverse matrices and maps Body/Abdomen to the studio's hips and spine, and `scripts/render-character-library.py` renders their cards. Production and Unreal packages keep the used Quaternius GLBs under `assets/quaternius/` with the licence.
