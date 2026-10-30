# Authored action library

The studio bundles all 17 clips from the Casual Male file in Quaternius's CC0 Ultimate Animated Character Pack. Together with 15 studio actions, including the targeted Sit down and Stand up pair, these provide 32 built-in choices. [motion-source.json](motion-source.json) records the original public download URL, original SHA-256, processed GLB SHA-256, and exact clip durations. The creator's original [license](../public/library/actions/LICENSE.txt) accompanies the bank. Source acquisition is recorded in [character provenance](CHARACTER_ASSETS.md).

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

The bank is a private animation reference, absent from the selectable cast. Each viewport loads it on demand when an action needs it. Transfer uses anatomical joint rotations, proportion-scaled body movement, and attachment displacement from torso/shoulder/pelvis helpers. This preserves the tuck in a roll and the source's shoulder motion. Elbow/knee length changes and animated anatomical scale remain unsupported. Detached auxiliary controls do not become anatomical joints. Imported receivers now also transfer unambiguous matching extremity, twist/share, and facial bones, plus named morph weights. Unsupported channels are reported rather than silently omitted. Procedural receivers still have only their authored coarse skeleton. See [animation quality](ANIMATION_QUALITY.md) for capability and visual-verification limits.

All 17 real clips are tested on all 32 bundled bodies and an original procedural performer, including reverse scrubbing. A same-body comparison samples five fractions of each original clip and checks mapped joint origins and world rotations. This verifies the supported anatomical mapping; it does not claim identical source skin deformation on bodies with different proportions or auxiliary bones.

Production ZIPs include the bank once under `assets/actions/` with its license when referenced. The baked GLB contains only actual scene objects. Editable JSON uses stable catalogue IDs and requires a studio version with this action bank, as it does for other built-in assets.

Authored walks and jogs are in-place performances. Drawn routes can now select these or a private imported locomotion take; measured foot/root travel drives the original gait by route distance. Studio procedural Walk/Run remain explicit alternatives. Carrying/reaching/sitting performances do not attach props or solve seat contact; staged swings/aiming add no weapons. Targeted studio interactions remain separate. No motion-capture, universal retargeting, collision avoidance, planted-foot solving, or automatic Mixamo access is implied.

## Imported clip timing

Imported actions (including the authored bank) store two independent values in editable scene JSON:

- `duration`: scheduled timeline seconds. Shortening it **trims** the source take; lengthening it **holds** the final source pose. It never loops or automatically stretches a take.
- `playbackRate`: source seconds per timeline second. New clips use **1× native speed**. Set this explicitly in the action inspector to speed up or slow down a take. Changing it keeps the scheduled duration unchanged. Rates must be finite and between 0.001× and 300× (the wide range also accommodates historical fits).

**Imported drawn routes are different:** their duration is movement time and their gait phase follows measured distance, not `playbackRate`. The editor measures the source and target rig to offer a natural pace, and labels this distance-paced behavior. It never infers ActorCore ownership from a walk/run label.

For example, a four-second take in a two-second slot at 1× plays its first two source seconds. In a six-second slot it plays the full four seconds, then holds for two. At 2× it reaches the source end after two timeline seconds. Final accumulated travel and facing must come from the last **sampled** source timestamp, including when the take is trimmed; the full take's displacement is not a substitute.

Older projects without `playbackRate` used automatic fit-to-duration stretching. Loading them preserves that performance by materializing `source duration / clip duration` once and persisting `legacyFit: true`. The inspector labels this **Legacy fit**, shows the actual rate, and offers **Use native 1×**. Future duration edits preserve that fixed rate. Picking a speed explicitly clears the migration notice. Procedural actions retain their existing duration-based semantics and do not accept playback rates.

`shared/clipTiming.ts` centralizes source sampling (`sourceSecondsAt`), source-end sampling (`clipSourceEnd`), and the local timeline time where source motion stops (`clipEffectiveEnd`). Preview, accumulated root travel, and export must use the same helpers. Bake sampling should include both scheduled boundaries and source-stop times inside held clips, to retain their exact timing between the 60 Hz base timeline samples. Native/source key times and accelerated source-time samples are also included, so a speed change cannot erase a whole take between bake frames.

## Export comparison

For the browser-created **A wider performance** fixture, export a production package and extract `scene.glb` and `scene.json`. Run the following with your Blender path:

```sh
npx tsx scripts/sample-motion-library.ts scene.json expected.json
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python engine/blender_import.py -- scene.glb scene.blend
blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python tests/verify_motion_library_blender.py -- scene.blend scene.json expected.json
```

The fixture has Harper playing Celebrate → Walk → Wave hello, Sage playing Athletic jump → Forward roll → Wave hello, and Mila playing Disappointed → Stage punch → Wave hello. The independent Blender reader compares the actual baked scene against the studio's sampled joint positions, checks final holds and motion, and rejects extra hidden rigs. See [verification](VERIFICATION.md) for measured results.
