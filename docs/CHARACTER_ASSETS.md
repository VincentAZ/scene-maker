# Bundled character library

The studio includes 32 curated humanoids from [Quaternius's Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html), alongside its 14 original presets. The pack is published under CC0 1.0. The creator's [license file](https://drive.google.com/file/d/1eooYt7zHAMOPEU6d3QHMzR2p0gk9ZJF8/view) is preserved at [public/library/quaternius/LICENSE.txt](../public/library/quaternius/LICENSE.txt).

[character-sources.json](character-sources.json) records each original file's public Drive URL and ID. These were read through the Google Drive connector from the folder linked by the creator's website, downloaded on 2026-10-28, and processed locally. No private Drive content or credentials are included. Original downloads are ignored under `.data/sources/quaternius/`.

The curated models cover everyday and formal clothing, doctors, chefs, builders, business outfits, kimono, cowboys, pirates, knights, a witch, a wizard, and an elf. Display names and collection assignments belong to Scene Maker. They are stylized low-poly characters, not photorealistic humans.

## Conversion

1. Download the `.gltf` files listed in the source manifest into a local directory. Each embeds its buffer and has no external textures.
2. Run `npx tsx scripts/prepare-character-library.ts <source-directory>`.
3. Run Blender with `--background --factory-startup --disable-autoexec --threads 4 --python-exit-code 1 --python scripts/render-character-library.py -- <source-directory>/previews public/library/quaternius`.
4. Run `npm test` and `npm run build` before committing the regenerated assets.

The conversion restores the actual bind pose from skin inverse matrices: source files initially open on a walking pose. It maps the source's Body/Abdomen/limb bones to the studio's humanoid names. The source Hips bone is an extra torso joint; Body is the common parent of torso and legs and becomes the studio hips. Foot and pole target controls remain auxiliary bones rather than being mistaken for anatomical ankle joints.

Near-unit source bone scale noise (less than 0.0001) is normalized and inverse matrices recomputed. Larger discrepancies fail conversion. Geometry, skin weights, auxiliary bones, and outfit colors remain; the Skin material receives the catalogue's curated skin tone. Source animation clips are intentionally omitted from the compact model files. These characters use the studio's actions and supported shared-motion adaptation. The original pack's 17 source clips are not offered as built-in actions.

Thumbnails are rendered in Blender from the same calibrated neutral pose used in the viewport. Camera framing excludes Blender's hidden bone display widget. They are local PNGs; no third-party image or model request occurs while using the app. The 32 GLBs and thumbnails total approximately 16 MB and load only as needed.

## Portable exports

Production and Unreal ZIPs retain used library GLBs under `assets/quaternius/`, plus the original license. The baked scene contains all visible geometry, materials, skins, and animation independently of those source files. Editable JSON keeps stable built-in asset IDs, just as it does for the original studio presets; reopening it requires a Scene Maker version with this catalogue. Custom assets retain the existing portable import path.

Character designs use a separate local GLB and rendered PNG; the shipped starting model is never overwritten. Blender recolors the existing materials and adds head/spine-weighted glasses or a backpack. A recipe records the starting catalogue ID, palette, and wearable choices. Generated model-only exports normalize measured near-unit bone scale noise and correct inverse binds before the studio calibrates them. Production packages include the recipe, generated GLB, preview, starting model, and license. Reopening uploads the generated model and preview to new local filenames.

Contact actions still use the studio's geometric approximations. The pack does not add facial animation, physical collision solving, automatic Mixamo service access, or validated Unreal playback.
