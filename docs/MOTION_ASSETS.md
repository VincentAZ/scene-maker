# Authored action library

The studio bundles all 17 clips from the Casual Male file in Quaternius's CC0 Ultimate Animated Character Pack. Together with the original 14 studio actions, these provide 31 built-in choices. [motion-source.json](motion-source.json) records the original public download URL, original SHA-256, processed GLB SHA-256, and exact clip durations. The creator's original [license](../public/library/actions/LICENSE.txt) accompanies the bank. Source acquisition is recorded in [character provenance](CHARACTER_ASSETS.md).

The catalogue uses creator-facing names and descriptions in [motion-catalogue.json](../shared/motion-catalogue.json). These include relaxed idle, walking/jogging/carrying poses, an athletic jump, forward roll, sitting/rising/reaching, celebration/disappointment, and staged action performances. Source animation names remain intact, including the source spelling `RecieveHit`.

## Reproduce

Download the original `Casual_Male.gltf` into a local source directory using its public URL in the provenance files. The conversion reuses the original license already shipped with the character library. Run:

```sh
npx tsx scripts/prepare-motion-library.ts <source-directory>
npm test
npm run build
```

The conversion restores the inverse-bind pose, maps Body to hips and Abdomen to spine, retains the original torso/shoulder helpers, and normalizes only measured near-unit bind-scale noise within 0.0001. It writes `public/library/actions/quaternius-actions.glb`, the unchanged license, exact duration data, and the source manifest. The original animation curves and key times remain; the 32 model-only character files are unchanged. Unexpected scales, missing clips, or unsupported transfer stop conversion.

## Playback and packaging

The bank is a private animation reference, absent from the selectable cast. Each viewport loads it on demand when an action needs it. Transfer uses anatomical joint rotations, proportion-scaled body movement, and attachment displacement from torso/shoulder/pelvis helpers. This preserves the tuck in a roll and the source's shoulder motion. Elbow/knee length changes and animated anatomical scale remain unsupported. Detached auxiliary controls do not become anatomical joints. Fingers, facial animation, and arbitrary extra deform bones are outside this transfer.

All 17 real clips are tested on all 32 bundled bodies and an original procedural performer, including reverse scrubbing. A same-body comparison samples five fractions of each original clip and checks mapped joint origins and world rotations. This verifies the supported anatomical mapping; it does not claim identical source skin deformation on bodies with different proportions or auxiliary bones.

Production ZIPs include the bank once under `assets/actions/` with its license when referenced. The baked GLB contains only actual scene objects. Editable JSON uses stable catalogue IDs and requires a studio version with this action bank, as it does for other built-in assets.

Authored walks and jogs are in-place performances. Use Walk, Run, or a drawn route for travel. Carrying/reaching/sitting performances do not attach props or solve seat contact; staged swings/aiming add no weapons. Targeted studio interactions remain separate. No motion-capture, universal retargeting, collision avoidance, planted-foot solving, or automatic Mixamo access is implied.

## Export comparison

For the browser-created **A wider performance** fixture, export a production package and extract `scene.glb` and `scene.json`. Run the following with your Blender path:

```sh
npx tsx scripts/sample-motion-library.ts scene.json expected.json
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python engine/blender_import.py -- scene.glb scene.blend
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python tests/verify_motion_library_blender.py -- scene.blend scene.json expected.json
```

The fixture has Harper playing Celebrate → Walk → Wave hello, Sage playing Athletic jump → Forward roll → Wave hello, and Mila playing Disappointed → Stage punch → Wave hello. The independent Blender reader compares the actual baked scene against the studio's sampled joint positions, checks final holds and motion, and rejects extra hidden rigs. See [verification](VERIFICATION.md) for measured results.
