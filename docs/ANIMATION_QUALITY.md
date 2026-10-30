# Animation fidelity investigation and acceptance status

## Finding

The tested ActorCore sources are **not missing the detail**. Each real take has
101 skeleton joints and 303 position/quaternion/scale tracks. The old shared
animation path consumed only 11 anatomical joints. Native playback used the
whole Three.js clip; sharing it discarded wrists, feet/toes, fingers, additional
spine/neck/clavicle joints, twist/share joints, and facial joints.

Two other independent issues existed: duration edits silently fitted a whole
take to its slot, and drawn routes substituted procedural gait. A drag-preview
mesh/material repair does not address any of these paths.

## Implemented behavior

- Detailed imported-rig transfer matches unambiguous anatomical/extremity names
  (including CC/Mixamo fingers) and exact normalized auxiliary names. It applies
  world-space rotational deltas with neutral-axis compensation, retains target
  proportions, and preserves attachment displacement through unmatched helpers.
  Matching helpers are not applied twice. The original 11-joint fallback is
  retained for genuinely coarse procedural rigs.
- Named morphs transfer by matching mesh/name or unambiguous source names, never
  by guessing numerical weight indices. Rest weights reset between takes/seeks.
- `userData.retargetReport` separates transferred channels, unchanged bind
  channels, and unsupported channels with reasons. Viewport notices disclose
  losses even on procedural receivers. Constant **non-bind** poses/deformations
  count as meaningful channels, not harmless exporter noise. Non-bind scaling,
  unsupported anatomical length changes, ambiguous names, unavailable joints,
  unnamed morph weights, and unsupported properties are not silently invented.
- New imported clips play at explicit **1×**. Duration trims or holds; an explicit
  playback-rate control changes speed. Old fitted takes retain a fixed visible
  “Legacy fit” rate and offer a 1× reset. Trimmed travel/facing stop at the sampled
  source endpoint instead of teleporting to the full take's endpoint.
- Drawn routes select an imported gait, including private ActorCore takes, or an
  explicitly procedural alternative. The editor measures actual source travel
  or low-stance-foot motion and scales it for the receiver. Runtime phase follows
  distance through that profile, preserving original joints while replacing the
  source trajectory/heading with the route and retaining residual body sway.
  Default bundled rigs use shin contact offsets where no deform foot is mapped.
  Missing/non-locomotor clips do not get a pretend procedural substitute; known
  nonmatching loop endpoints warn when repeating. Dialogue routes, object-route
  planning, waypoint splits and imported↔procedural edits retain these semantics.
- Baking includes named morph weights on receivers without native clips. It uses
  a 60 Hz base cadence, explicit hold/trim boundaries, mapped source keys, and an
  accelerated source-time grid rather than losing fast gestures between frames.

## Real-asset comparison performed

Used the actual private imported **Party Woman**, **Motion Dummy — Female**, and
**Motion Dummy — Male** files, not generated substitutes or bundled stand-ins.
Compared the same source clip at the same source seconds at original duration:

| Take | Original duration | Original rig |
|---|---:|---|
| Stand and talk | 28.133333 s | Female dummy |
| Thoughtful walk | 34 s | Female dummy |
| Relax | 17.666667 s | Male dummy |

Chrome/Three.js WebGL rendered native dummy, old transfer, and upgraded transfer
side-by-side. The old solver was loaded from the pre-change Git version. Full
native-duration **1× WebM recordings**, full-body stills, hand close-ups, a curved
route recording, channel reports, and measurement JSON were saved privately in:

`.data/coding/7980a735-0125-4a7f-9612-eef0a5596862/animation-verification/`

The disposable harness and runner scripts are stored beside that evidence, not
in the checkout. Licensed GLBs, textures, renders and provider credentials are
not added to Git. The running studio was not deployed/replaced for this review.

Results:

- All three takes mapped **100 joints plus separately handled root travel**.
  All 202 position/rotation channels were accounted for; 101 default-scale
  channels were unchanged. No unsupported-channel or WebGL errors occurred.
- Sampled local rotation excursions confirm the old transfer froze detailed
  joints. On **Stand and talk**, native → upgraded ranges were: wrist
  2.239444 → 2.239444 rad; first index joint 0.540632 → 0.540632; foot
  0.349015 → 0.349016; toe 0.715035 → 0.715035; forearm twist
  0.238193 → 0.238193. Old values were zero apart from negligible quaternion
  normalization noise. Thoughtful walk and Relax gave corresponding parity.
- Thoughtful walk's measured trajectory is approximately **8.870 m / 34 s**.
  The real clip played along a curved 16-second route on both original and
  receiving characters, with deterministic scrubbing and no transfer warnings.
- The real bundled in-place Walk and Run also measured successfully through
  contact offsets: approximately **0.938 m / 1.25 s** and **1.291 m / 0.875 s**
  before receiver-proportion scaling. This default-editor path is now covered
  by a test using the shipped GLB, not only mock loading.
- Configured vision-model review inspected actual full-body/sequence images and
  close-ups. Broad poses were coherent with no obvious gross mesh collapse.
  Close-ups showed the new gathered/curled fingers improving the old conspicuous
  splayed-hand pose. It also flagged remaining wrist-pose/contact differences;
  wide stills alone did **not** establish a major perceptual improvement.

## Acceptance limits — do not silently close the quality issue

Channel preservation is verified; universal “natural-looking” performance is
not certified by these numbers or stills. Keep final animation-quality sign-off
open for native-rate visual review of the private recordings on the target GPU.
The software-WebGL session rendered the three-way playback at roughly 13–14 fps,
while preserving wall-clock 1× timing. It is not evidence of 60 fps playback.

- Different body proportions/bind orientations and high heels still affect hand
  contact, wrist presentation, sole contact and self-intersection. No full-body
  IK, sole planting, collision correction or individual hand-pose calibration
  was added. Detailed ankle/foot rotation restoration alone is not a sliding fix.
  For example, Thoughtful walk's median lower-ankle planar speed was ~0.011 m/s
  on the source versus ~0.019 m/s on Party Woman for both old and new standalone
  transfers. This is a diagnostic, **not** a planted-sole/sliding measurement.
- Distance-paced routes reduce speed/stride mismatch, but cannot guarantee planted
  feet on tight curves, aggressive timing, noncyclic takes or stop-heavy gestures.
  Choose a proper seamless locomotion cycle. Route source pauses can be compressed
  by distance pacing; ordinary non-route takes retain their native timing.
- Source facial bones/matching weights are preserved when present. These samples
  do not establish expressive facial animation or lip-sync where the source does
  not supply it. Missing target anatomy cannot be recreated by retargeting.
- Route export remains sampled at the 60 Hz timeline cadence; unlike ordinary
  imported takes it has no phase-aware source-key bake. Arbitrarily accelerated
  route timing can therefore still alias, and requires visual export review.

## Repeatable acceptance procedure

1. In an isolated review scene add the original motion dummy and Party Woman.
   Place the same imported take on both, set explicit **1×**, retain the exact
   original duration, disable automatic dialogue performance, and compare all
   three takes above. Include front/side full-body and wrist/finger/foot close-ups.
2. Review continuous playback and reverse/random scrubs, not only key poses.
   Inspect wrist articulation, individual finger curls, heel/toe rolls, shoulders,
   twist deformation, torso movement and any actual facial tracks.
3. Draw a broad curved route; select the imported walking take. Wait for measured
   natural pace, then compare original and receiving rigs. Repeat with bundled
   in-place Walk/Run, longer repeated routes, explicit duration changes, and a
   deliberately non-locomotor take to check failure reporting.
4. Trim a take, extend it into a hold, and change playback rate explicitly.
   Check displayed speed, endpoint continuity, saved/reloaded timing and export.
5. Run `npm run check`, `npm test`, and `npm run build`. Tests cover detailed and
   coarse rigs, source-key baking, timed endpoints, morphs, helper hierarchies,
   loaded route gait measurement, dialogue/editing round trips and actual bundled
   GLBs. Automated checks supplement rather than replace the visual gate above.
