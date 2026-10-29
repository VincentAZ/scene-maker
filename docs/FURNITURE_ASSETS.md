# Furniture and furnished sets

Scene Maker bundles **93 furniture props** curated from Kenney's original Furniture Pack (1.0), alongside the 12 existing studio props. Six collections cover Living, Work, Kitchen, Bed & bath, Storage, and Details. Five furnished layouts and the new Empty room bring the Sets library to 12 choices.

## Source and license

- Creator-published source: [Furniture Kit by Kenney on OpenGameArt](https://opengameart.org/content/furniture-kit), published January 3, 2018.
- Downloaded archive: [kenney_furniturePack.zip](https://opengameart.org/sites/default/files/kenney_furniturePack.zip).
- Archive SHA-256: `68afa4e6dc8a53942379fb47f1e84ec735d46b77bb1c1ceb968e245693dde067`.
- License: Creative Commons Zero (CC0). The original license is preserved verbatim in [public/library/furniture/LICENSE.txt](../public/library/furniture/LICENSE.txt). Credit: Kenney, www.kenney.nl.
- [furniture-sources.json](furniture-sources.json) records each selected original OBJ hash and resulting dimensions. [furniture-catalogue.json](../shared/furniture-catalogue.json) supplies names and collections.

This is a curated subset of the original archive, not the later expanded pack listed on Kenney's current site. Source downloads and extracted originals stay in ignored `.data/sources`; runtime does not contact external asset services.

## Reproduction

Extract `Models/` and `License.txt` into a source folder, retaining the archive as `source.zip`. Run the repository script with a trusted local Blender installation:

```sh
blender --background --factory-startup --disable-autoexec --threads 4 --python-exit-code 1 \
  --python scripts/prepare-furniture-library.py -- .data/sources/kenney-furniture
npx tsx scripts/prepare-set-previews.ts
blender --background --factory-startup --disable-autoexec --threads 4 --python-exit-code 1 \
  --python scripts/render-set-previews.py
```

Conversion scales source coordinates by 0.2, centers each prop on X/Z, grounds it on Y=0, and turns its front toward +Z. This produces a desk approximately 1.469 m wide and 0.769 m tall, with a kitchen counter 0.9 m tall. The palette is converted from source sRGB values into linear material colors. GLBs contain geometry and named material regions without external textures or buffers. Lights/cameras are used only for thumbnails. Rendered cards show the actual shipped models; the five set previews are built using the studio's actual layouts and geometry.

## Creator behavior

Choose a furnished set in **Sets**, or ask “Switch to Open kitchen”. Each furnishing becomes an ordinary editable scene object. Switching sets replaces only objects marked as set dressing; cast and independently added props remain. Select a furnishing and choose **Details → Keep when switching sets**, or duplicate it, to retain it. The offline helper also understands “Keep Standing coat rack when switching sets”.

Layouts are starting points with open floor space for a cast. They do not solve collisions, seating, appliance interactions, or lighting. Props preserve their source material palette; the generic signature-color control is hidden for imported and bundled mesh assets because it cannot recolor those materials. The Bedroom at dawn name does not change the creator's selected lighting.

Production packages include the exact referenced furniture GLBs and the original license; the baked scene embeds geometry. Editable project JSON uses stable catalogue IDs and requires a studio version containing this catalogue. No texture service, Blender installation, or network access is needed to place these bundled models.
