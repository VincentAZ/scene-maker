# Action library

## Recorded studio actions

Every body animation is a recording or stylized hand-authored animation; the studio no longer computes any body motion by formula. The library holds 130 recorded takes in 12 categories (Walking, Running, Standing, Talking, Gestures, Emotions, Sitting, Objects, Everyday, Climbing, Dance, Sports): 119 from the [CMU Graphics Lab Motion Capture Database](https://mocap.cs.cmu.edu/) and 11 walking styles from the [100STYLE dataset](https://zenodo.org/records/8127870) (CC BY 4.0), plus the 17 stylized Quaternius clips below and each creator's own imports. Both sources allow commercial use; their attribution and terms are in [public/library/actions/cmu/LICENSE.txt](../public/library/actions/cmu/LICENSE.txt), which production packages carry with the takes.

The November 2026 additions (44 CMU takes, 11 100STYLE walks, about 30 MB) cover everyday gestures and idles (Shift weight, Hands on hips, Look around, Turn around, Clap, Explain, Furious, Swat at a bug), seated poses that need a seat under them (Talk while seated, Chin in hand, Head in hands), walking and running variations (Brisk, Slow, Confident and Happy walks, Walk and turn left/right, Step over, Walk into a run, Jog to a stop), objects (Lift a box, Pick up and carry/move, Push and Pull something heavy), everyday tasks (Hammer a nail, Put on a coat/hat, Vacuum, Examine the ground, Lie down), dances (Charleston, Lindy hop, Moonwalk) and sports (Kick a ball, Pitch, Swing a bat, Shoot a basket, Golf swing, Putt, Shadow boxing, Throw and catch, Warm-up stretches, Jumping jacks). Each was previewed on its source skeleton and on an imported realistic character before it was kept. 100STYLE was captured walking loops in a small volume, so its takes are its straightest 3.5 s stretches (about four strides, at most ~40° of drift); styles that never walk straight (Angry, Rushed, Elated, Followed, Old) and the cartoonish ones were left out.

Fifteen recordings serve a role and keep that role's long-standing action id, so saved scenes, dialogue and the assistant address them as before: idle (Standing idle, 77_02), walk (35_01), run (35_17), jump (13_11), wave (141_16), sit (113_15, 1.2–4.2 s), stand (113_15, 4.2–6.4 s), dance (141_12), crawl (111_03), climb (13_33, 1.8–6.8 s), sip (79_38, 1.2–8.8 s), pick (80_08, 3.3–9.9 s), place (80_27, 2.0–7.0 s), talk (80_14, 2–10 s) and bow (113_02, 0.2–3.2 s). Seats, ladders and props still place the body and its contacts (seat support, rung and hand IK); the recording supplies every limb. A recorded sit lowers onto the seat at its own measured hip timing (`timing` in the catalogue).

Scenes saved with the earlier computed actions are migrated on load (`migrateLegacyMotions` in shared/scene.ts): their clips play the recordings at native speed, computed walk/run travel becomes a straight route on the recorded stride, computed-gait routes use the recorded stride (backward ones the recorded backward walk), and assistant-made keyframe actions become Standing idle.

[scripts/cmu-library.json](../scripts/cmu-library.json) lists every take with its name, category, role and excerpt. To rebuild, download each listed ASF/AMC from mocap.cs.cmu.edu (HTTP; its HTTPS chain is incomplete) into one directory per subject, convert each take with `node scripts/prepare-cmu-motion.mjs <subject-directory> <trial> <60|120>` (the frame rate is listed on the CMU search page), put each 100STYLE `<style>_FW.bvh` (from 100STYLE.zip) in `<source-directory>/100STYLE/`, then run `node scripts/build-cmu-library.mjs <source-directory> [key ...]` (with keys, only those entries are rebuilt). 100STYLE entries (`"source": "100STYLE"`) are converted by the build itself: recorded joint rotations and root path, centimetres to metres, a capsule skeleton for display, and a role mapping to its own joint names. Excerpts keep only the original samples inside the interval, shifted to start at zero; the catalogue records source URLs, SHA-256 hashes of the sources and output, and joint mappings re-derived in the written file.

The Actions panel filters by source (Recorded, Stylized, My imports), category and use in the scene, sorts by category, name, length or newest import, and selects several actions at once. Your own actions can be deleted (with every clip that plays them; undoable); library actions can be hidden in this browser.

## Stylized action library

The studio bundles all 17 clips from the Casual Male file in Quaternius's CC0 Ultimate Animated Character Pack. [motion-source.json](motion-source.json) records the original public download URL, original SHA-256, processed GLB SHA-256, and exact clip durations. The creator's original [license](../public/library/actions/LICENSE.txt) accompanies the bank. Source acquisition is recorded in [character provenance](CHARACTER_ASSETS.md).

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

## Captured performances

Nine CMU Graphics Lab captures are also bundled: **Captured walk** (35_01,
2.975 s), **Captured walk and turns** (69_06, 43.433 s), **Captured run**
(35_17, 1.383 s), **Captured walk and stop** (16_33, 2.367 s),
**Captured run and stop** (16_57, 2.225 s), **Captured standing**
(77_02, 15.6 s), and **Captured walking with a gradual stop**
(82_14, 7.55 s), **Captured running pass** (35_18, 1.45 s), and
**Captured stand, walk, and stop** (91_34, 18.392 s).
Standing retains its original 60 Hz samples; the other eight
retain their original 120 Hz samples. These are body performances; finger/thumb
channels were not captured and are excluded. Facial animation is not included. Source skeletons are displayed as
capsules for original-performance previews. That display is not a body scan
or a measured shoe surface. These entries do not replace saved authored clips.

The stand/walk/stop take retains its initial standing and weight shift, walking
turns, and final settled stance as one original performance. It is a selectable
action, not a new default repeating route gait. Its short steady-cycle candidates
do not reliably match its later stop across route lengths. No source samples or
standing intervals were fabricated to make it loop or end sooner. Body proportions
and missing finger/face capture still limit transferred appearance.

`shared/captured-motion-catalogue.json` records exact source URLs, raw/converted
SHA-256 hashes, duration, sample count, exclusions and anatomical mappings.
Download the listed ASF and AMC into a private source directory, then run:

```sh
node scripts/prepare-cmu-motion.mjs <source-directory> 35_01
node scripts/prepare-cmu-motion.mjs <source-directory> 69_06
node scripts/prepare-cmu-motion.mjs <source-directory> 35_17
node scripts/prepare-cmu-motion.mjs <source-directory> 16_33
node scripts/prepare-cmu-motion.mjs <source-directory> 16_57
node scripts/prepare-cmu-motion.mjs <source-directory> 77_02 60
node scripts/prepare-cmu-motion.mjs <source-directory> 82_14
node scripts/prepare-cmu-motion.mjs <source-directory> 35_18
node scripts/prepare-cmu-motion.mjs <source-directory> 91_34
```

Use separate directories for different subjects. Copy each resulting GLB to
`public/library/actions/cmu/`, and retain its corresponding manifest entry.
The converter preserves original samples without denoising, looping or speed
changes. It rejects unsupported root/unit conventions; it is not a general
ASF/AMC app importer.

CMU's [homepage](https://mocap.cs.cmu.edu/) permits including the data in
commercial products but prohibits reselling the data directly, even converted.
Its [FAQ](https://mocap.cs.cmu.edu/faqs.php) permits copying, modification and
redistribution. The terms and requested attribution accompany the assets in
`public/library/actions/cmu/LICENSE.txt` and in production ZIPs referencing
these captures. These assets are not CC0.

The complete walking take has unmatched endpoint foot poses. New walking routes
without an established or native gait now select **Captured walking stride**,
which references source seconds 1.1–2.2166666667 of 35_01. The editor measures that
interval and receiver proportions to offer the original pace. It saves the
source identity and interval on the route; it does not alter the original take
or migrate saved routes. New running routes use **Captured running stride**,
source seconds 0.2–0.9666666667 of 35_18, unless the actor already has an
established/native running gait. Authored and procedural choices remain available.

The walking interval was selected using the complete body at repeats, including
hands and joint rotations, on the original rig, Party Woman and all 32 bundled
characters. It replaces the earlier 0.4–1.525-second preset, whose feet matched
but whose hand motion did not. Existing saved intervals retain their values.
The runtime's bounded loop correction closes the selected repeat without
rewriting the original capture. These checks do not guarantee planted soles or
naturalness on every imported body.

The running preset replaces the earlier 35_17 interval, whose feet matched but
whose hands exceeded the body-loop correction limit. The complete original
35_17 capture and saved routes remain available and unchanged. The new running
interval lasts 92/120 seconds and travels 2.7281847433 source metres. Its source
keys remain untouched; small repeat differences use the existing bounded
correction. No correction limit was increased.

Contact evidence is measured on the uninterrupted capture and trimmed to the
selected stride, preserving support when a cut falls inside a planted step.
The previous running take had no detected stance intervals and retained captured
foot motion without stance-lock correction. Neither matching feet nor a
motion-capture label proves a good loop.

Loop correction now includes skeleton roots and sibling bone branches, which
can drive skin or attachments outside the hips hierarchy. Root positions close
in the route frame; pelvis correction stays within its parent so it cannot
shift an already-closed root or attachment. One-shot playback is unchanged.
Both presets passed position, rotation and sampled-skin repeat checks on straight
and curved routes across the source, Party Woman, Motion Dummy Male and all
32 bundled bodies (140 cases). Curved-route velocity residuals remain under
investigation; these checks do not establish continuous velocity or natural
arrivals, waits and contacts across providers.

Imported skins bypass cached frustum bounds, which can otherwise hide a body
whose root motion moves its bones outside the bounds of an earlier pose.
Static meshes retain normal frustum culling. This avoids a per-frame scan of
every deformed vertex, at the cost of drawing off-screen imported skins.

Normal-speed walking/running route evidence exists for Party Woman and Casual Female. Broader
provider coverage, contact quality, arrival/wait visual verification, and other
natural defaults remain unfinished; this is not a universal quality claim.

The three recorded stops include the captured deceleration and standing finish.
Their catalogue role is `arrival`; they remain selectable performances but are
excluded from automatic repeating-gait defaults, including renamed source
copies. A stop is not a reusable steady walking/running cycle.

Automatic navigation routes can reserve their ending for a captured stop when
source and receiving pose, velocity, support and clearance checks pass. The
stop search includes up to four seconds before sustained standing: the final
two seconds alone can exclude the walking phase of a gradual slowdown. The
longer search keeps the same compatibility and clearance gates and preserves
native source timing. It does not stretch a stop into a fixed schedule.

82_14 is a full, selectable one-shot performance. It is not a new default route
gait. Candidate repeated intervals can match the feet while still jumping at
the hands, and one interval that closes on Party Woman fails on Casual Female.
Those experiments remain outside the shipped route presets. Adding that stop
did not replace the walking/running presets. Automatic finishes for
manually drawn paths, reliable running stops and broader receiver compatibility
remain unfinished. Existing saved `ending: "hold"` semantics remain unchanged.

Automatic imported routes can use **Captured standing** when their gait source
has no suitable standing take. The eligibility check measures planted feet,
hip height, body travel and endpoint pose at 60 samples per second. Source-local
measurement keeps placement and character scale out of this decision. The
optional source is preloaded for navigation; a failed optional download retains
the existing stopped-pose fallback. Saved waits make the source a required
export dependency.

Generated standing waits preserve native timing and body sway, with smooth
transitions between takes. Their explicit `stationary` marker prevents the
capture's small net root displacement and facing change from accumulating over
repeats. Other imported performances and explicit ending holds retain their
existing behavior. A 70-second blocked-route fixture checks repeated standing
and subsequent recovery without altering earlier playback. This does not yet
resolve natural gait-to-standing joins for every source or running stops.

Standing waits inherit the stopped body's horizontal position and the route's
floor, without retaining the gait's vertical calibration as a new floor. A final
sole check after blending prevents supported route/standing poses from crossing
the floor during a join. This removes penetration; it does not assert perfect
contact or eliminate the capture skeleton's small positive clearance.

When a blocked coordinate route resumes, its destination and facing are
converted from the original starting frame into the continuation's frame.
Otherwise the same local vector would send the actor toward a different world
position after a long wait. Both standing and frozen recovery have regressions
for the actual destination as well as preservation of earlier playback.

When the source has lower and upper chest joints but the receiver has only one
chest at the common arm/head branch, detailed transfer now carries the composed
upper-chest orientation and displacement into that joint. Previously its mesh
missed the upper bend although the arms and head inherited it. Separate chest
joints are retained when available; explicit exclusions and ambiguous mappings
prevent automatic composition. The transfer report distinguishes composed
channels from direct matches and unsupported channels. Combining two source
segments cannot reproduce their independent skin deformation on a one-joint
receiver. Neck, wrist, toe and other unsupported details remain disclosed.

Ground support retains the original leg reach envelope through both sole-geometry
refinement passes. Each pass keeps its own correction allowance. This avoids a
threshold-dependent extra leg solve while retaining knee bend; it does not alter
the capture, its cadence, or the route. Explicit held endings still require a
separate natural-arrival solution.
