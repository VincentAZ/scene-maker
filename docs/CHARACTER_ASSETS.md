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

Near-unit source bone scale noise (less than 0.0001) is normalized and inverse matrices recomputed. Larger discrepancies fail conversion. Geometry, skin weights, auxiliary bones, and outfit colors remain; the Skin material receives the catalogue's curated skin tone. Source animation clips are omitted from the compact model files. The pack's 17 source clips are now offered through a [separate motion bank](MOTION_ASSETS.md), loaded when needed and adapted to the chosen character. Character generation continues to use the model-only GLBs.

Thumbnails are rendered in Blender from the same calibrated neutral pose used in the viewport. Camera framing excludes Blender's hidden bone display widget. They are local PNGs; no third-party image or model request occurs while using the app. The 32 GLBs and thumbnails total approximately 16 MB and load only as needed.

## Portable exports

Production and Unreal ZIPs retain used library GLBs under `assets/quaternius/`, plus the original license. The baked scene contains all visible geometry, materials, skins, and animation independently of those source files. Editable JSON keeps stable built-in asset IDs, just as it does for the original studio presets; reopening it requires a Scene Maker version with this catalogue. Custom assets retain the existing portable import path.

Character designs use a separate local GLB and rendered PNG; the shipped starting model is never overwritten. Blender recolors the existing materials and adds head/spine-weighted glasses or a backpack. A recipe records the starting catalogue ID, palette, and wearable choices. Generated model-only exports normalize measured near-unit bone scale noise and correct inverse binds before the studio calibrates them. Production packages include the recipe, generated GLB, preview, starting model, and license. Reopening uploads the generated model and preview to new local filenames.

Contact actions still use the studio's geometric approximations. The pack does not add facial animation, physical collision solving, automatic Mixamo service access, or validated Unreal playback.

## Grab3D realistic characters

Six rigged humans from [Grab3D](https://grab3d.com/models/characters/) join the Rocketbox cast: Man in a T-shirt, Woman in a sports top, Soldier, Samurai, Pirate captain and Ninja. Every package is dedicated to the public domain (CC0 1.0) by its author, Alexander Popov; the models are AI-assisted (a Meshy image-to-3D base cleaned up, textured and rigged in Blender, which the package's `LICENSE.txt` discloses), so the catalogue credits them as "Alexander Popov (Grab3D), AI-assisted" with each model page as the source. `scripts/content/characters/grab3d.mjs` downloads the rigged GLB with its `manifest.json` and `LICENSE.txt` into `content/.cache/grab3d/<slug>/`, refuses any package whose licence text is not the CC0 dedication, and converts it with glTF Transform: welded and simplified to at most 120k triangles (meshopt keeps the skin weights), the bundled walk and run clips dropped, textures kept at 2048 px, the spine renamed the Mixamo way (`Spine`, `Spine1`, `Spine2` counting up from the hips), the rest pose re-posed onto straight vertical legs and the material made dielectric unless the outfit carries metal. Thumbnails are EEVEE renders of the converted file, framed like the Rocketbox previews. `node scripts/build-grab3d.mjs` builds this source alone and merges its entries into `shared/content/characters.json`.

The skeleton is Meshy's 24-joint humanoid: hips, a three-segment spine, neck, head, shoulders, arms, hands, legs, feet and toes. There are no face bones, and of the candidates only the Samurai and the Viking carry finger bones (added in Blender by the author); among the six that ship only the Samurai has them, so the other hands keep the shape of their rest pose while the arms act, which is why the review looked closely at hands. The ankle joints sit a little up the shin, which is why the tests check the floor contact of the mesh rather than the joint height. Meshy's rest pose also stands with the knees bent (9–34°) and the legs apart (5–10° off vertical); the studio grounds a character by the extent of its rest pose and then plays recordings whose legs are straight, so the feet sank below the floor by whatever the bend and the splay had taken from the height (the Pirate captain reached 6 cm and was flagged as overlapping the backdrop the moment he was placed). The converter therefore straightens each leg and swings it vertical from the hip, keeps the foot's orientation, skins the vertices into the new rest pose and rebuilds the leg joints' inverse bind matrices; the tests check the straight legs in the file and the idle floor contact.

Every candidate was converted and reviewed as a thumbnail, as face and hand close-ups rendered in Blender, and in the studio: a walk route to the upholstered armchair, Wave hello and Sit down, with stills of the whole body, the upper body and the waving hand taken from the character's front three-quarter. The creator wants nothing that looks fake, so only convincing characters ship:

| Model                 | Decision | Why                                                                                                         |
| --------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| Man in a T-shirt      | kept     | Plain realistic body and face; relaxed hands.                                                               |
| Woman in a sports top | kept     | Plain realistic body and face; relaxed hands.                                                               |
| Soldier               | kept     | Realistic face and kit; gloves hide the lack of finger bones.                                               |
| Samurai               | kept     | Realistic face, lacquered armour, finger bones.                                                             |
| Pirate captain        | kept     | Realistic face, detailed coat and sash; relaxed hands.                                                      |
| Ninja                 | kept     | Masked face with realistic eyes, convincing cloth.                                                          |
| Armoured knight       | rejected | Stylised game-hero face and hair, smeared gold trim; the open gauntlets turn palm-up in every action.       |
| Sci-fi trooper        | rejected | Paint edges smeared across the armour and gloves; the open hands bend back palm-up when it waves.           |
| Cyborg courier        | rejected | The human hand's texture looks raw and blistered (red blotches, painted-on shine), and every wave shows it. |
| Firefighter           | rejected | Cartoon face (animated-film style).                                                                         |
| Chef                  | rejected | Cartoon face and proportions.                                                                               |
| Viking                | rejected | Heroic proportions, oversized hands, cartoon face.                                                          |
| Elderly woman         | rejected | Painterly, stylised face.                                                                                   |
| Teenager              | rejected | Anime-style face with oversized eyes.                                                                       |
