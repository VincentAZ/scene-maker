# Animation fidelity investigation and acceptance status

**Latest visual acceptance is failed/open.** The user's November 1 recording
`Astra-long-wait-2026-11-01-203903.mp4` reports robotic walking on a drawn path.
The 1,067-test checkpoint does not clear that requirement. See
[`ANIMATION_ACCEPTANCE.md`](ANIMATION_ACCEPTANCE.md) for the practical test plan
and controlled comparisons. The saved scene identifies bundled Quaternius
`Walk` as the active motion; source choice, retargeting and route adaptation
must be compared before attributing the failure. Sampled recording frames show
an exaggerated stride, but do not by themselves isolate its cause.

## Captured running repeat and skeleton-branch correction

The new running fallback uses CMU 35_18, source seconds 0.2–116/120,
at its original cadence (92/120 seconds per stride). The previous 35_17
interval matched the feet but exceeded the unchanged body-loop wrist limit.
Its original take and saved routes remain unchanged. The new complete take
is available as **Captured running pass**, with source URLs, hashes and the
existing CMU terms alongside it.

Loop correction previously omitted skeleton ancestors and sibling branches.
Those branches can drive skin or attached objects. It now closes their
positions in the moving route frame and corrects the pelvis within its parent,
so the pelvis adjustment cannot move an already-closed root. All bone branches
use the existing position, rotation, velocity and scale bounds; no limit was
loosened. A synthetic attachment regression reproduced a 49 mm jump before the
fix and now checks repeat position, rotation, velocity, reverse seeking,
unchanged one-shot playback and rejection of excessive correction.

The final browser sweep covers both walking/running presets, straight/curved
paths, original source rigs, Party Woman, Motion Dummy Male and 32 bundled
characters: 140 cases. Across two repeats sampled within one microsecond on
each side, maximum joint/skin changes are 0.00850/0.00811 mm and maximum bone
rotation change is 0.000029 rad. A frozen pre-change runtime fails 68 cases,
primarily on omitted root/control bones; its maximum joint jump is 3.086 mm
for these candidate intervals. These figures compare the same candidate
motions before/after the branch fix, not the old running preset against the new.
The source/receiver native-playback matrix (23 cases, 39 timestamps each) is
exactly unchanged in every sampled bone position and rotation.

The first broader sweep mutated paths after compiling them and therefore sampled
the wrong repeat times. It was discarded and rerun with fresh immutable paths
and explicit length assertions. Only the corrected sweep supports these numbers.
Finite-difference velocity residuals remain about 1.63 m/s on the curved walking
Pirate Male case (1.66 before), and 1.58 m/s on Pirate Female (1.60 before).
All measured running cases are below 0.0018 m/s. The pirate walking discontinuity
still needs diagnosis; position closure alone does not establish natural motion.

The actual PathEditor fixture saves a 6 m running route at 2.028612363 seconds
with collisions enabled and the exact new source interval. Its entire route
plus 0.3-second held tail bakes/reloads within 0.0271 mm at joints and 0.0255 mm
at sampled skin vertices, including samples near each repeat. The previous
walking fixture also passes (0.0365/0.0357 mm). The final preview retains the
0.63-second comparison timestamp, plays/pauses, keeps the correct Add recipient,
and leaves saved project content unchanged. Final UI runs have no HTTP or
JavaScript errors; the browser still emits its software-WebGL advisory.

Evidence is retained in ignored `.data/natural-motion-investigation/running-loop/`:
`running-review/running-before-after-1x.mp4` compares old/new presets at native
pace on the actual route; `35-18-native-1x.mp4` compares original/receiver motion.
The route movie includes the explicit held ending. Natural arrivals, ongoing
wait/recovery quality, contacts on broader providers and natural performances
for the remaining action library are still open.

## Scope: every imported model and motion path

The fix belongs to the shared import, rig mapping, retargeting, route playback,
and export pipeline. ActorCore is a small part of the intended input library,
not the compatibility boundary. Provider names and individual clips must not
select corrective behavior. Use measured transforms, skin influences, explicit
joint mappings, source timing, and route geometry; disclose unsupported data.
The available real-asset fixtures cover only a few rig families. Passing them
does not establish compatibility or visual quality for dozens of providers.
This requirement covers both current file-import entry points (GLB and FBX),
native and shared motions, drawn/imported motion routes, preview, and baking.
Provider naming aliases may help identify anatomy; they must not select different
timing, contact, or pose-correction algorithms. Unknown or incompatible anatomy
must remain visible through mapping and unsupported-channel reports.

### Required collision and navigation behavior

These are app-wide acceptance requirements for every imported model, provider,
and path the app accepts. They also apply to bundled assets. Implementation and
verification belong in the shared animation/navigation pipeline; a working
ActorCore example or a single supported route type does not satisfy the scope.

- Collision detection is enabled by default during animation, including newly
  created projects and legacy projects without an explicit saved preference.
- Users can explicitly turn animation collision detection off and back on. The
  setting is saved with the project and must survive reopening and undo/redo.
- AI-controlled movement must navigate around obstacles. A blocked route must
  be adjusted or replanned automatically as staging or obstacle positions change;
  a diagnostic warning or a request to replan manually does not satisfy this.
- Navigation must use loaded geometry across imported providers and preserve
  motion cadence/contact quality. When no safe route exists, the actor must not
  pass through the obstruction. Preview, scrubbing, recording, and export must
  agree on the evaluated movement.

Acceptance requires tests and rendered evidence for default-on behavior,
explicit disabling, a newly blocked AI route, moving obstacles, no-route cases,
and consistent preview/export. Existing static route planning and overlap
diagnostics are not evidence that automatic navigation is complete.

Route replanning must also preserve the intended next interaction: an actor's
own pickup starting at arrival is valid, while an object already held by that
actor or acquired by another actor is not an available stationary destination.
Evaluate ownership using the revised schedule when a detour changes duration.

Coverage must include every AI movement entry point, including coordinate and
object destinations, imported root-motion travel, backward movement, and edited
paths. Any currently unsupported case remains an open implementation gap rather
than an exception to these requirements. Obstacle edits and animated obstacles
must trigger clearance checks and, when necessary, automatic path adjustment or
replanning while collision detection is enabled.

Keep this work with the existing shared animation changes in the main worktree.
The separate dialogue worktree does not own a different collision policy; any
dialogue-generated movement must use the same saved setting and navigation
pipeline when integrated.

The dialogue worktree carries these same acceptance requirements in
`docs/ANIMATION_REQUIREMENTS.md`. Keep shared implementation here and use that
handoff during dialogue integration; no additional worktree is needed for a
second collision implementation.

Treat these requirements as integration gates for both worktrees. Adding a new
provider, model importer, or path importer must inherit the default-on setting,
explicit user override, and automatic obstacle avoidance/replanning. Importing
through a new entry point must not silently bypass the shared collision policy.
Record incomplete navigation cases as open gaps, not provider exceptions.

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
- `userData.retargetReport` separates directly transferred channels, chest
  channels composed into one receiving joint, unchanged bind channels, and
  unsupported channels with reasons. Viewport notices disclose
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
  or low-stance-foot motion and scales it for the receiver. Route distance follows
  the native gait profile, preserving cadence and original joints while replacing the
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

| Take            | Original duration | Original rig |
| --------------- | ----------------: | ------------ |
| Stand and talk  |       28.133333 s | Female dummy |
| Thoughtful walk |              34 s | Male dummy   |
| Relax           |       17.666667 s | Male dummy   |

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
  Choose a proper seamless locomotion cycle. Route source pauses are retained; the chosen duration sets the overall cadence.
  Ordinary non-route takes retain their explicit playback rate.
- Source facial bones/matching weights are preserved when present. These samples
  do not establish expressive facial animation or lip-sync where the source does
  not supply it. Missing target anatomy cannot be recreated by retargeting.
- Route export now includes source keys and measured 60 Hz gait-table phases,
  inverted through distance pacing for each repeated stride. Visual export review
  remains required, especially at loop seams and source pauses; measured profiles and finite export samples still require
  continuous visual inspection.

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

## Follow-up: provider-independent import audit

The user's scope includes all models and paths accepted by the app, across dozens
of providers. ActorCore is a regression case, not the compatibility boundary.
Current automatic canonical naming still covers a limited set of conventions;
arbitrary rigs and cross-provider transfer remain unverified.

The supplied `Conversation-in-the-scene-recovered-riddle-scene-2026-10-31-000745.mp4`
was traced to saved project `0e9b47e4-3a9e-4be6-933b-a37da872d367` at inspection.
Party Woman uses bundled Victory / Walk Carry / Jump; Party Man uses procedural
Dance / Jump / Crawl. It is not the same-source ActorCore comparison above.

Two further pipeline defects were corrected:

- Import sizing/grounding now uses a separate parent transform, preserving the
  imported root's authored position, scale, and animation binding root. Previously
  normalization overwrote provider transforms. A regression checks nonuniform
  source units, ground height, normalized height, and animated root displacement.
- Smooth transitions and final-pose holds now include mesh morph weights, which
  were previously reset while the skeletal pose was retained. Regression checks
  cover boundary/midpoint weights, held expressions, reverse seeks, and rest.

Fresh native-versus-transfer evidence was generated for Stand and talk at
`animation-verification/fixed-cadence/Stand-and-talk-native-60fps.mp4` under the
private evidence directory above. ffprobe confirms 1,688 frames, 1200 × 800,
60 fps, 28.133333 seconds. Every frame was rendered offline; this does not measure
real-time rendering throughput. Inspected frames retain the broad source pose,
with hand/wrist presentation differences still visible. Continuous visual review,
additional providers, and route contact/continuity remain open. The first rendering
process ended on a Vite reload; the isolated, reload-disabled runner resumed at
the first missing frame and completed. The relevant source/target naming was
unaffected by the intervening canonical-name additions.

Additional provider-independent changes:

- Canonical mapping accepts exact upper/lower-leg names and anatomical side-prefix
  / side-suffix conventions, without substring matching of twist/IK/end helpers.
  Duplicate candidates are excluded and surfaced as ambiguous rather than chosen
  by traversal order. This expands naming coverage, not a claim of universal rig
  support. Unknown/custom rig conventions still need a mapping workflow.
- Route export now maps source keys and measured gait samples into timeline time
  by source distance and receiving-rig proportions, repeating them for each stride.
  Regression coverage uses a nonuniform travelling gait, a proportionally different
  receiver, repeated cycles, and a fast off-grid finger gesture.

## Explicit mappings for unfamiliar providers

Imported custom characters now expose **Animation rig mapping** in their inspector.
The scene asset stores a `rigMapping` from semantic role to child-index path relative
to the original imported scene. A null value explicitly disables a role. Paths
survive fresh GLTF parses and distinguish identical bone names; paths belong to
that asset's hierarchy, not to interchangeable files. The editor offers 53 standard
body/extremity roles plus additional named roles for twist/facial/other joints.
Matching roles on source and receiver participate in the detailed solver.

Explicit mappings override naming guesses. Invalid paths, duplicate assignments,
and case-insensitive duplicate roles are rejected/reported. Native actions remain
available for incompatible sharing rigs. Mapping still requires a compatible
humanoid hierarchy and positive uniform scale on relevant skeleton chains; it is
not arbitrary-species retargeting or automatic contact correction.

Verification in this pass:

- Opaque, unrelated bone names on both rigs transfer an explicitly mapped auxiliary
  joint's animated rotation through the actual detailed solver.
- Fresh parse identities, duplicate bone names, disabled/stale assignments and
  schema serialization are covered by regressions.
- Browser review loaded Party Woman's 101 bones, presented 52 standard roles, and
  applied the hips assignment `[0, 1, 0]`. Editor tests cover draft/apply behavior,
  duplicate assignments, disabled roles and load failure.
- An isolated local service test preserves mappings through project save, reload,
  and revision history. Source-rig viewport caching now includes the mapping.
- The local production service was restarted through `/api/restart` without force
  after 646 tests and the production build passed. The endpoint accepted the
  restart, a new server process started, and `/api/health` returned `{"ok":true}`.
  The live service now loads the new schema; open app windows need a reload to
  display the new inspector controls.

Body/contact calibration and cross-provider visual acceptance remain open.

## Route cadence and pause correction

Constant route speed previously inverted the source distance table at every frame,
compressing slow/paused sections into brief source-time jumps. Route playback now
computes the source interval needed for the route distance, advances that interval
uniformly, and derives travelled distance from the measured source profile. Native
pauses and acceleration are retained. The route still reaches its scheduled endpoint.
Export keys use the same mapping. Natural-pace suggestions use the actual partial
take (and repeated cycles), accounting for pauses and receiver/entity scale.

Regression checks cover a source pause while time advances, exact/partial repeated
endpoints, off-grid export keys, zero travel, scrubbing and native/receiving rigs.

Real Thoughtful walk measurements compare 16-second straight, broad-curve and tight
routes on original dummy and Party Woman. Evidence lives in the private fixed-cadence
directory as `route-foot-*-independent.json` and `route-foot-independent-summary.json`.
On the broad curve, Party Woman's near-low-ankle planar-speed median changed from
0.1167 to 0.1072 m/s; p95 changed from 0.6211 to 0.3473 m/s. The filter is ankle height
within 0.025 m of that foot's minimum height. This includes some non-contact samples
and is **not a sole-contact/sliding metric**. Residual drift remains substantial.

An initial harness reused the displayed native model as the hidden transfer source,
so retarget sampling could overwrite its route phase. Those non-independent route
measurements/renders are superseded. Corrected comparisons use separately parsed
hidden source rigs, matching the app's separation. Confirmed via served module content
that the baseline server used the old sampler and the updated server used the new one.
An independent fixed-cadence route video is saved as
`animation-verification/route-cadence-independent/curved-route-60fps.mp4`.
ffprobe confirms 960 frames, 60 fps, and 16.000000 seconds. The runner is stored
beside the video; measurement runners and summary script are in fixed-cadence.
All 648 tests and the production build pass. The video establishes reviewable
output, not final perceptual acceptance or real-time GPU performance.

Remaining: isolate true sole contacts, preserve source turn-in-place behavior while
aligning travel direction, assess curve foot planting, and validate unfamiliar providers.

## Trajectory heading candidate — not production-accepted

The worktree now has a candidate for travelling clips which derives alignment
from a smoothed trajectory direction instead of pelvis yaw. It holds direction
when source travel is too small to distinguish from sway and bounds changes in
alignment. Tests establish correct sideways travel signs and preservation of a
source pivot during a pause. In-place gait handling is unchanged.

The initial short-window experiment lowered median ankle speed but increased
large spikes; its evidence is retained privately as an experiment, not acceptance.
The current longer-window candidate is evaluated against source-stationary frames:
source ankle planar speed below 0.03 m/s and height within 0.025 m of its minimum.
The reference is the actual source rig/take (Thoughtful walk is on the **male**
dummy in the current library; the older table's female attribution was incorrect).
Each receiver is matched to its own sampled source seconds. An initial diagnostic
accidentally sampled the female reference; it yielded no valid receiver contacts
and was corrected before producing `route-stance-summary.json`.

Compared with cadence-only playback, Party Woman's source-stationary broad-curve
ankle-speed median changed 0.0887 → 0.0527 m/s, with p95 0.2591 → 0.2589 m/s.
On the tight curve, median changed 0.0641 → 0.0443 m/s but p95 worsened from
0.2407 → 0.3009 m/s. These are ankle diagnostics, not a sole-contact guarantee.
This mixed result does not justify a quality sign-off or production rollout.

Private evidence:

- `fixed-cadence/route-stance-{cadence,trajectory}.json` and summary/runner scripts.
- `route-trajectory-candidate/curved-route-candidate-60fps.mp4`: 960 rendered frames,
  16 seconds, 60 fps, with separate native-display and hidden transfer-source rigs.
- `route-cadence-independent/provider-rig-matrix.json`: all 14 available imported
  characters loaded with compatible core mappings (11, 23 or 101 bones). Assets
  cover ActorCore, Quaternius-based characters and local Blender fixtures, not
  dozens of independently sourced providers. This inventory is not visual proof.

All 651 tests and TypeScript checks passed. A production-format candidate build
passed into `/tmp/scene-animation-review/trajectory-build`; production `dist/`
was deliberately left on the cadence-only build. Next work is source-contact-aware
correction with deterministic anchors and preservation of native foot roll, then
new visual comparisons. Tight-curve planting and body-proportion contact remain open.

## Source-contact correction candidate

`routeContacts.ts` detects sustained near-stationary ankle intervals in the source
(local units relative to leg height). In-place takes restore implied travel before
contact detection. Short low-displacement gaps can be joined. `routeFootPlanting.ts`
uses a deterministic raw timeline sample at contact start as the world anchor,
retains the source's small ankle displacement, and applies horizontal two-link leg
IK while preserving the foot's world orientation and native vertical motion. Bone
lengths are not changed. Correction is limited to 10% of leg height. Unsupported
humanoid hierarchies/scales get a notice instead of correction.

The first midpoint-anchor/short-fade trial was rejected: despite an improved median,
source-stationary foot speed reached 3.784 m/s on the broad curve. Evidence in
`route-contact-candidate/` and `route-stance-contact.json` is experimental only.
The current version anchors at contact start and carries the accumulated correction
through a smooth release into the swing. Tests cover world foot orientation, bone
length, horizontal targets, deterministic reverse seeks, timing-change cache
invalidation, and continuity at contact/release boundaries.

For Party Woman under the same source-stationary filter, heading-only → current
contact/release results (m/s):

| Route       | Median before → after | p95 before → after | Max before → after |
| ----------- | --------------------- | ------------------ | ------------------ |
| Straight    | 0.0504 → 0.0110       | 0.2676 → 0.1907    | 0.696 → 0.675      |
| Broad curve | 0.0527 → 0.0111       | 0.2589 → 0.1864    | 0.715 → 0.686      |
| Tight curve | 0.0443 → 0.0118       | 0.3009 → 0.2111    | 0.592 → 0.567      |

These ankle-based diagnostics still show residual drift; they do not certify sole
planting, human realism or pixel-perfect output. Skin/sole geometry, contact crossing
repeated-cycle boundaries, unreachable targets, knee behavior across providers, and
blending between distinct actions remain to be verified/corrected. There is no full
body balance solver or terrain collision system in this correction.

Private evidence: `fixed-cadence/route-stance-release.json` and
`route-stance-release-summary.json`. The candidate review video is saved as
`animation-verification/route-contact-release/curved-route-contact-60fps.mp4`: verified
960 frames, 60 fps, 16.000000 seconds, rendered using an isolated server on 4343.
All 654 tests passed plus TypeScript and an isolated production-format build at
`/tmp/scene-animation-review/contact-build`. After adding unsupported-rig disclosure
and contact-release export boundaries, the 30 affected tests and TypeScript checks
passed again. Production `dist/` remains on cadence-only playback.

## Provider-wide import and repeat verification

The requirement covers every model and animation/route import, across providers.
ActorCore is one fixture family, not an acceptance criterion for the shared pipeline.

`routeContactSchedule.ts` now carries compatible foot contacts across a repeated
cycle instead of discarding their anchor at the seam. It offsets source coordinates
at the join, supports a whole-cycle stance, anchors partial initial contacts at the
route start, and releases into the next swing. Reverse seeks use the same anchors.
Export sample boundaries include release times that wrap into the following cycle.
Tests cover repeated and partial cycles, coordinate resets, cold caches, reverse
seeks, and seam verification. A contact is joined only when that foot's **route-aligned**
endpoint poses match; pelvis-relative matching alone hid a large alignment turn.

The browser matrix loaded all 14 available library characters and sampled four
sources (bundled Walk/Run, imported Thoughtful walk, local Blender Original stroll)
on straight, broad-curve and tight-curve routes: 168 combinations. All produced
finite transforms and identical repeated-time results after backward seeks. The
measurement includes inferred ankle endpoints on rigs without foot bones; these
must not be reported as zero displacement merely because a foot bone is absent.
This remains limited provider coverage, not proof for dozens of external providers.

This broader check found a **remaining failure** in the trajectory candidate:
Thoughtful walk's alignment heading changes from -0.397 to 4.289 radians over its
34-second source. Its body-relative feet match, but its route-aligned body does
not. Smaller receivers complete the take on the tested routes and expose a large
snap. Before rejecting the false contact join, the maximum measured seam jump was
0.327 m; after rejecting it, the underlying 0.377 m discontinuity is exposed and
reported by the loop notice. This is an accurate disclosure, **not a quality fix**.
The trajectory/contact candidate remains unsuitable for a production sign-off.
The same probe with contact correction disabled isolates the underlying heading
jump. Walk's seam is much smaller; Run and Original stroll still have residual
endpoint differences. Numerical determinism does not establish natural motion.

Private evidence: `provider-loops/all.json`, `provider-loops/probe.json`, and
`provider-loops-current/all.json`; runners are stored beside the evidence. A six-model
Walk comparison uses Sage Real, Sage Cartoon, Party Woman, Party Man, Toon Goon,
and Rowan, each following a curved route for four cycles at native source cadence.
It is an offline 60 fps render, not a real-time performance benchmark.

### FBX conversion paths

A provider-neutral Blender fixture reproduced two independent import bugs:

- A 12-second FBX take was truncated to 8.333 seconds by the bundler's explicit
  `export_frame_range=True`. The bundler now exports each full action range.
- Bundling 30 fps and 60 fps files changed the 30 fps take to 0.517 seconds because
  the second import changed scene FPS while the first action retained its frame
  numbers. Actions now retain their source rate and have their keys and handles
  rescaled to the highest source rate before export. Both input orders are tested.

The generic FBX converter also explicitly preserves full action ranges, joint
hierarchies, native bone orientation and animation channels, with animation-size
optimization disabled. These changes use file timing and structure, not provider
names. They affect subsequent imports; already truncated GLBs cannot recover
missing frames without an original source. The Blender regression checks compare
full duration and root travel through generic conversion and bundling.

Verification: 658 JavaScript tests, all six Blender engine integration tests,
TypeScript, and an isolated build at `/tmp/scene-animation-review/provider-loop-build`
passed. Production frontend `dist/` remains unchanged; conversion scripts are read
from disk when a new import runs. Global visual acceptance remains open.

## Skinned foot joints and geometry-based ground clearance

The cross-provider visual review led to two further shared-pipeline fixes:

1. Some actual deforming foot bones are outside the hip hierarchy. The bundled
   Quaternius rig's `FootL`/`FootR` skin most shoe vertices, but were previously
   assumed to be harmless unweighted controls. Anatomical side tokens now accept
   this spelling, and skin weights/rigid attachments distinguish deforming feet
   from unweighted controls. Explicit semantic mappings also work. Detached
   extremities are transferred relative to their anatomical shin/forearm anchor,
   solved in dependency order, and retain position/orientation channels. Native
   root measurement now uses the actual mapped foot. Procedural body poses, route
   IK and seated IK also update these detached skin joints.
2. Retargeting ankle/hip rotations alone left visible soles below the floor on
   receivers with different leg proportions and shoes. `footSurface.ts` captures
   foot geometry from skin weights or rigid attachments, including vertices whose
   weights span ankle and shin. It measures deformed/morphed vertices and preserves
   source clearance above the bind sole plane by adjusting receiver body height.
   Airborne clearance remains airborne; this is not a per-frame floor clamp.
   Route contact IK is followed by clearance correction for terminal-shin rigs.
   Bone lengths, source timing, joint orientations and horizontal route position
   are not changed by this height adjustment.

The initial sole-measurement harness was wrong: `updateWorldMatrix` does not run
`SkinnedMesh.updateMatrixWorld`, which refreshes attached-skin bind inverses. The
first baseline/candidate directories (`sole-measurement`, `sole-clearance-candidate`)
therefore contain inflated CPU skin measurements and must not be used as evidence.
The corrected harness updates attached skin matrices like the renderer. The same
pitfall has a dedicated regression test in `footSurface.test.ts`.

Corrected, source-time-aligned measurements of one native-cadence bundled Walk
cycle (75 samples, 60 Hz), using exact deformed whole-mesh bounds:

| Receiver     | Lowest sole before (m) | Lowest sole after (m) |
| ------------ | ---------------------: | --------------------: |
| Sage Real    |                -0.0493 |              -0.00203 |
| Sage Cartoon |                -0.0858 |              -0.00243 |
| Party Woman  |                -0.0457 |              -0.00313 |
| Party Man    |                -0.1029 |              -0.00317 |
| Toon Goon    |                -0.1841 |              -0.00225 |
| Rowan        |                -0.0844 |              -0.00278 |

All 14 library receivers were measured. The native source itself reaches
-0.00195 m and rises to 0.01631 m at the lowest mesh point, so small remaining
negative/positive clearance is inherited and scaled, not proof of perfect sole
planting. Source foot mapping also changes the measured Walk stride from the old
shin estimate (0.938 m) to the actual skinned-foot estimate (1.203 m). This corrects
natural pace; comparisons must not assume the old estimate was ground truth.

The 168-combination route matrix was repeated: finite transforms and deterministic
reverse seeks passed. The long Thoughtful walk trajectory-alignment seam still
fails on a route long enough to repeat it (Rook reached 0.338 m). Some larger
receivers now consume less than one full take after corrected landmark scaling;
absence of a seam on those short routes does not establish that it is fixed.

Private evidence:

- `sole-measurement-corrected/soles.json`: valid prior baseline.
- `sole-clearance-weighted/soles.json`: latest full skin-weight implementation.
- `sole-clearance-final/soles.json`: visually rendered version; its recorded
  measurements match the later mixed-weight expansion on all 14 available models.
- `sole-clearance-corrected/vertices.json`: actual skin weights proving the
  previously omitted foot controls deform the shoes.
- `foot-loops/all.json`: repeated provider/route matrix.
- `foot-clearance-review/six-model-foot-clearance-60fps.mp4`: 300 offline frames,
  5.000 seconds, 1200×800, 60 fps, six characters, four curved-route Walk cycles.
  Screenshots at several phases were inspected. This is a review artifact, not a
  real-time benchmark or universal visual sign-off.

Verification: all 669 JavaScript tests, TypeScript, and the isolated production-format
build at `/tmp/scene-animation-review/foot-clearance-build` passed. Tests include
attached/detached source/receiver combinations, parent ordering, animated root
transforms, airborne clearance, rigid geometry, morph weights, mixed skin weights,
ignored unweighted controls, and seated contact. The seating fixture now sizes its
seat using the measured reach constraint; the old inferred ankle length had made
an overly high seat appear reachable. Production frontend `dist/` remains unchanged.

## Terminal-turn loop alignment — shared pipeline candidate

A long take can return to its original body pose after turning, while its measured
travel direction ends at a different heading. Repeating the route then produces
an artificial body turn at the boundary. The observed 34-second take had this
failure even with contact correction disabled; changing IK alone could not fix it.

The shared locomotion profiler now offers a separate repeat profile when the
source has enough authored turn near its end to close that heading discrepancy.
It consumes at most 90% of same-direction turn remaining after trajectory
alignment, tapers the correction, and checks both feet's resulting endpoint
agreement relative to measured standing height. It rejects unrelated endpoint
pose differences, unreliable strides, stationary endings without a suitable
turn, and cases where the trajectory has already consumed the available turn.
The correction does not select on model, provider, clip name, or route shape.
One-shot route alignment, source samples, source cadence, and travel distance
remain unchanged. Repeated playback, contact schedules, and bake boundaries use
the same selected profile.

On the available long take, the correction starts at source second 31.13 and
closes 1.627 radians of route-frame mismatch. Measurements at 60 Hz over source
seconds 30–38, with straight and curved routes explicitly long enough for every
receiver to repeat, found:

- Across all 14 library receivers, the boundary foot displacement fell from
  0.337–0.422 m to approximately 0.0004–0.0043 m.
- Maximum sampled pelvis angular speed, including the repeat, fell from about
  97.65 rad/s to 1.14 rad/s on the straight route (1.11 on the curve).
- This is not zero sliding: mean ankle speed during detected late-turn contacts
  improved on several rigs (Sage Real, roughly 0.058 to 0.025 m/s), but increased
  slightly on others (Rowan, roughly 0.037 to 0.046 m/s). Ankle speed also includes
  the native authored contact motion. It is not a direct sole-slip measurement.
- A subsequent 224-combination matrix (14 receivers × four source gaits × four
  route cases, including a guaranteed 2.2-cycle route) had finite transforms and
  zero reverse-seek position error. Maximum seam displacements were 0.00025 m
  for bundled Walk, 0.0151 m for bundled Run, 0.0103 m for Original stroll, and
  0.0043 m for Thoughtful walk. Missing receiver channels remain explicitly
  reported; this matrix is not a claim that all receivers have every source joint.

Private evidence: `loop-turn-baseline/all.json`, `loop-turn-candidate/all.json`,
`loop-alignment-final/probe.json`, and `aligned-provider-loops/all.json`. The
final conservative turn-budget guard changes the real-asset probe positions by
less than 0.000002 m relative to the measured candidate. The final broader matrix
and rendered review use that guard. `loop-turn-review/six-model-loop-turn-60fps.mp4`
shows six rig layouts on a curved route, including the original male rig and
Party Woman, at native cadence over source seconds 30–38. It is an offline
480-frame, 8-second, 60-fps review artifact, not a real-time performance result.
The review uses a static textured ground plane so foot contact remains visible;
the first line-grid render did not provide a usable ground reference. The
rendered seam frames and several turn/walk phases were inspected.

All 675 JavaScript tests (67 files), TypeScript, and the isolated build at
`/tmp/scene-animation-review/loop-alignment-build` passed. New tests cover both
turn directions, rejecting already-consumed turn, keeping one-shot alignment,
preserving source timing/distance, and a provider-neutral animated imported
hierarchy with curved travel and an authored terminal pivot. Production frontend
`dist/` remains unchanged. Broader provider coverage, residual sliding, and final
natural-motion acceptance remain open.

## Sole material contacts — shared geometry correction

An ankle can remain almost stationary while the shoe visibly slides. The
previous route solver preserved source ankle displacement on every receiver,
which ignored the different lever arm between each receiver's ankle and sole.
Measurements of actual deformed mesh vertices showed this clearly: bundled Walk
ankle speed during detected stance averaged about 0.0027 m/s at source scale,
while the receiver's low shoe vertices moved substantially faster than the
source's. This was a retarget/contact artifact, not evidence of missing source
joint animation.

`footSurface.ts` now also captures a stable sole material point: a spatially
deduplicated sample of the low bind-pose surface, deformed with the same skin and
morph weights as the visible mesh. Selection remains fixed across frames, so
heel/toe roll does not jump between changing lowest vertices. The locomotion
profile retains both ankle and sole trajectories. Contact correction uses the
sole trajectories only when both source and receiver have usable sole geometry;
animation-only imports and unsupported receiver geometry keep the ankle basis.
Schedules cache the two bases separately. No provider names choose this behavior.

During stance, route IK preserves the source sole point's displacement rather
than freezing the receiver's ankle. Independently animated feet retain their
world rotations. On terminal-shin rigs, the limb solver targets the actual sole
point directly; solving an inferred ankle instead leaves a geometry-dependent
residual because the shin rotates. Bone lengths, source time, route distance,
and airborne source clearance remain unchanged.

The harness samples fixed mesh vertices at 60 Hz. Its metric below is the mean
of each frame's median horizontal speed among vertices within 1.2% of measured
leg height above that foot's current lowest point, restricted to the interior
of the same detected stance intervals. Values are **normalized to source scale**
(divided by the receiver's leg-height ratio), so they are comparable across
characters. This includes authored foot roll and is a surface-motion proxy,
not a claim of exact physical slip or zero contact error.

| Bundled Walk receiver       | Before (m/s, source scale) |  After |
| --------------------------- | -------------------------: | -----: |
| Original source / Sage Real |                     0.0426 | 0.0426 |
| Sage Cartoon                |                     0.2518 | 0.1315 |
| Party Woman                 |                     0.1735 | 0.0450 |
| Party Man                   |                     0.1347 | 0.0579 |
| Toon Goon                   |                     0.2098 | 0.0746 |
| Rowan                       |                     0.1361 | 0.0653 |

For source seconds 30–38 of Thoughtful walk, the corresponding metric improved
from 0.0594 to 0.0341 m/s on Party Woman and from 0.1652 to 0.1195 on Toon Goon.
Small shape-dependent residuals remain. Lowest vertex heights were unchanged.
The source ankle is no longer expected to remain still during a transferred
sole contact: its movement compensates for the receiver's different shoe shape.

The final 224-case matrix checks both ankle and sole-point repeat discontinuities,
finite transforms, and reverse-seek reproducibility. All transforms remained
finite and reverse-seek position errors were zero. Maximum combined ankle/sole
seam distances were 0.00029 m for Walk, 0.0171 m for Run, 0.0103 m for Original
stroll, and 0.00742 m for Thoughtful walk. The latter ankle seam is slightly larger
than the earlier 0.0043 m result; this is a tradeoff accompanying lower stance
surface motion, not a claim that every metric improved.

Two outstanding issues became clearer. The bundled Run has no sustained contact
interval under the current conservative detector, so this change does not fix
its contact behavior. Its native route mesh also reaches approximately -0.0391 m
relative to the normalized ground plane, and receiver ground-clearance transfer
inherits that penetration at the receiver's scale. Ground support and running
stance/flight behavior need further work; neither is silently declared solved.
Original stroll also has no detected contacts. Zero contact-metric entries for
these clips mean **no qualifying samples**, not zero sliding.

Private evidence:

- `sole-slip-baseline/all.json`: corrected bind-pose witness selection, old ankle
  contacts. The harness was corrected before this final baseline was saved.
- `sole-contact-final/all.json`: four gaits on the native source and six receiver
  layouts (28 runs). It exactly matches the preceding terminal-shin candidate
  after adding the missing-geometry fallback.
- `sole-contact-final-seams/all.json`: final 224-case route matrix; each seam's
  four entries are left/right ankle and left/right sole material point.
- `sole-contact-walk-review/six-model-sole-contact-60fps.mp4`: 300 offline frames,
  five seconds, six receivers, four native-cadence curved-route Walk cycles.
- `sole-contact-turn-review/six-model-sole-turn-60fps.mp4`: 480 offline frames,
  eight seconds, six rigs including the original male source and Party Woman,
  source seconds 30–38 on a curved route. Turn, seam, and walking frames were
  inspected against a static textured ground plane.

All 679 JavaScript tests (67 files), TypeScript, and the isolated build at
`/tmp/scene-animation-review/sole-contact-final-build` passed. Added checks cover
stable skinned material points under actor transforms and foot rotation, sole
contact on different shoe shapes, source/receiver missing-geometry fallbacks,
and direct sole targeting without ankle joints. The first combined validation
command was terminated after tests; the check/build were rerun to successful
completion. Production frontend `dist/` is unchanged. Natural-motion acceptance
and validation across the intended provider range remain open.

## Route ground support — penetration removed, running acceptance still open

The route pipeline previously inherited negative native sole clearance and
scaled it with the receiving character. In the bundled Run, the native mesh
reached -0.03911 m relative to the app's normalized standing plane. Party Woman
reached -0.06236 m and Party Man -0.06345 m. This concerns ground placement in the
app; it does not establish that all source animation is faulty.

A direct per-frame body projection removed penetration but sharpened a vertical
jolt: the maximum 60-Hz second difference of native hip height rose from about
138.75 to 264.32 m/s². That initial candidate was rejected. These numbers are a
sampled motion diagnostic and include the source's existing interpolation
corners; they are not a claim about physical human acceleration.

The current shared route profiler measures sole penetration alongside gait
samples. `groundSupportEnvelope` takes a local maximum and then a weighted
average over approximately 40-ms neighbourhoods. Every averaged neighbourhood
contains the original sample, so the resulting envelope bounds its penetration.
It preserves constant contact levels without a permanent hovering offset and
keeps distant zero-support flight regions zero. Repeating routes use wrapped
support samples. Source time, source keys, and horizontal route distance do not
change; exported profile sample boundaries include these support changes.

Runtime support uses the sampled route elevation, not world zero. The body
follows the envelope, and two-link leg correction absorbs the extra lift near
contact so the soles can reach the standing plane. A smooth source-clearance
band releases the legs into flight. Independent foot world rotations and limb
lengths remain intact; terminal-shin rigs target their material sole point.
The correction runs once after route contact sampling, including reverse seeks;
recursive raw anchor samples do not apply it a second time. Non-route native
playback does not enter this ground-support stage.

Measured results on native Run and six receiving layouts:

- Lowest observed sole heights are now approximately zero (floating-point
  residuals around 1e-9 m; Party Woman's minimum is 0.000043 m).
- Native hip-height second-difference maximum is about 140.96 m/s², versus
  264.32 for the rejected direct projection. Receiver maxima generally fell
  relative to the prior baseline, though this does not prove all motion is smooth.
- The original native rig's maximum sole height on source-defined penetrating
  stance samples is about 0.00039 m. Receivers retain some contact-height error:
  roughly 0.0052 m on Toon Goon, 0.0105 m on Party Woman, 0.0237 m on Sage Cartoon,
  and 0.0293 m on Rowan. Removing penetration is not the same as perfect planting.
- The body envelope intentionally affects a short interval around landing and
  takeoff. Native peak minimum-sole height changed from 0.18248 to 0.18577 m;
  peak hip height changed from 0.56931 to 0.57721 m. Flight is not flattened to the
  floor, but the full airborne arc is not claimed to be identical.
- The 224-case matrix again had finite transforms and zero reverse-seek position
  error. Combined ankle/sole seam maxima are 0.00029 m for Walk, 0.0171 m for Run,
  0.0103 m for Original stroll, and 0.0116 m for Thoughtful walk. The latter is
  larger than before ground support and remains part of the quality review.

The running review exposed a separate confirmed pacing defect: the current
in-place distance estimator accumulates backward foot displacement but does not
maintain travel through flight. The measured Run route speed ranges from zero
to 7.6623 m/s within a cycle. This produces stop/start travel despite constant
source playback cadence. Fixing flight pacing while preserving genuine pauses,
source detail, and supported contacts is the next required step. Running still
has no sustained intervals under the current ankle-based contact detector.

Private evidence:

- `ground-support-baseline/all.json`: 28 native/receiver runs before support.
- `ground-support-candidate/all.json`: rejected direct body projection.
- `ground-support-envelope/all.json`: smooth body-only stage, before the legs
  absorbed the extra contact lift.
- `ground-support-legs/all.json`: measured final body/leg algorithm.
- `ground-support-seams/all.json`: final 224-case matrix, including sole points.
- `run-source-probe/probe.json`: native source joint samples without a route.
- `run-pace-probe/probe.json`: actual distance-table velocities and support data.
- `ground-run-review/six-model-ground-run-60fps.mp4`: 210 offline frames, 3.5 s,
  60 fps, native source plus five receivers over four curved-route Run cycles.
  The source is parsed separately from the hidden retarget source. The final
  review explicitly enables mesh shadow casting and a static shadow-receiving
  ground plane, as the viewport does. Landing and flight frames were inspected.
  This is a diagnostic sample of incomplete running behavior, not sign-off.

Verification includes an elevated, sloped route integration case with actor
translation, rotation, scale, and reverse seeking; an idempotent support test;
airborne/contact leg behavior; preservation of foot orientation; and support
bounds, constant levels, and repeated endpoints. TypeScript and the isolated
production-format build at `/tmp/scene-animation-review/ground-support-build`
passed. The final suite contains 685 tests in 68 files. Production frontend
`dist/` is unchanged. Physical terrain/stair contact, all-provider visual quality,
remaining contact errors, and natural-motion acceptance are still open.

## In-place flight travel and running support candidate

The next shared-pipeline candidate reconstructs forward travel only where the
source provides alternating single-foot support separated by sustained flight.
It uses sole clearance and measured backward foot speed relative to the trajectory;
animation-only rigs fall back to ankle clearance above their sampled minima.
Thresholds scale with leg height. Provider, model, and clip names do not select
the behavior. Existing root-motion profiles are unchanged.

Grounded pauses, double-foot jumps, single-foot hops, and grounded walking do
not qualify. Short support fragments are joined across a verified cyclic seam
before rejecting undersized contacts. One-shot sections outside the confirmed
running interval keep their previous travel. Source frame times and clip duration
remain unchanged. This is an inferred root trajectory, not recovered authored
root motion; it changes estimated stride and therefore natural route duration.

The bundled Run's estimated cycle distance changes from 1.30334 m to 3.10445 m.
Route speed changes from 0–7.66231 m/s to 2.44047–4.65323 m/s, removing the
flight stalls. The remaining per-stride pace variation is substantial and still
needs motion-quality review; smoother travel alone is not natural-motion sign-off.
Walk, Thoughtful walk, and Original stroll retain their previous measured distance
tables. A fresh review server reproduced the candidate Run profile exactly.

Confirmed running supports now supply ankle contact goals while preserving
sole-relative-to-ankle displacement (foot roll), vertical source motion, and
independent foot rotation. The source stance drift determines the correction
allowance, bounded between 10% and 40% of leg height; two-link reach constraints
still prevent bone stretching. Existing contact allowances remain unchanged.
Overlapping contact evidence is merged, and cyclic schedules carry the allowance.

On the same interior running-support windows, the source-scale-normalized mean
median speed of low sole vertices changed as follows (m/s). This metric includes
authored foot roll and is not a direct measurement of physical slip:

| Receiver      | Previous ground-support candidate | Flight/support candidate |
| ------------- | --------------------------------: | -----------------------: |
| Native source |                            0.5481 |                   0.2475 |
| Sage Real     |                            0.5481 |                   0.2475 |
| Sage Cartoon  |                            0.6814 |                   0.2942 |
| Party Woman   |                            0.5245 |                   0.2372 |
| Party Man     |                            0.4782 |                   0.3067 |
| Toon Goon     |                            0.5947 |                   0.4157 |
| Rowan         |                            0.4925 |                   0.2306 |

The native horizontal correction reaches about 0.160 m; Party Woman reaches
0.256 m. These are substantial pose adjustments, despite negligible horizontal
solver reach errors in the measured contact interiors. Contact quality and source
pose preservation remain under review. The final ground stage still prevents
penetration in those samples; it does not prove correct terrain interaction.

The 224 model/gait/route cases have finite transforms and zero reverse-seek error.
The maximum combined ankle/sole Run loop-boundary displacement is 0.01714 m;
other gait seam measurements are unchanged. Synthetic tests cover pauses, jumps,
hops, scale independence, cyclic contact fragments, one-shot boundaries, foot-roll
preservation, and correction propagation. The real-asset test checks flight
travel and an unwarped source clock. All 694 tests in 70 files, TypeScript, and
the isolated build at `/tmp/scene-animation-review/flight-support-build` passed.

Private evidence: `flight-pace-probe/probe.json`,
`flight-final-pace-probe/probe.json`, `flight-support-contacts/all.json`,
`flight-support-seams/all.json`, and
`flight-run-review/six-model-flight-run-60fps.mp4` (210 frames, 3.5 s, 60 fps).
The render uses an independently loaded native source and five receiving rigs,
with a static textured floor and shadow casting. Landing, stance, and flight
frames were inspected. This remains a diagnostic candidate; production `dist/`
is unchanged. All-provider coverage and natural-motion acceptance remain open.

## Restored torso and shoulder transfer through anatomical hierarchy

A real cross-rig defect remained after the running support changes: the bundled
source's animated `Torso` joint had no semantic match to compatible receiving
chest joints. Party Woman, Party Man, and Toon Goon each reported
`Torso.quaternion` as unsupported. Their chest skin therefore missed movement
even though the arms and head received composed world rotations. The maximum
chest orientation error against the source delta, compensated for bind axes and
initial heading, was about 10.5515° in Walk and 15.5779° in Run.

`rigDetailRoles` now supplies conservative hierarchy-based fallback roles after
the established body anchors and explicit mappings have been resolved. A common
arm/head branch beneath the spine identifies the chest. If a known lower chest
already precedes that branch, it identifies an additional `upperChest` role.
A single intervening bone identifies a shoulder or neck. An unfamiliar multi-bone
shoulder/neck chain remains ambiguous. Explicit assignments, disabled roles,
excluded bones, existing anatomical names, and duplicate semantic keys take
precedence. The inference uses no provider or asset names. The editor now includes
`upperChest` among its standard roles.

The real source-to-receiver plans increase from 16 to 19 matched joints for
Party Woman, Party Man, and Toon Goon: chest and both shoulders. The source's
previously unsupported torso channel is transferred. Over 121 samples per clip
and receiver, maximum chest orientation error falls below 0.0014° for both Walk
and Run. These values include quaternion/interpolation numerical error. Coarse
receivers without an independent chest retain explicit unsupported-channel
reporting; a topology match does not invent missing deformation joints.

Four runtime regression cases verify chest/shoulder motion between unrelated
names, independent upper-chest motion, disabled chest mapping, and an ambiguous
multi-bone shoulder chain. All 698 tests in 70 files, TypeScript, and the isolated
build at `/tmp/scene-animation-review/torso-support-build` passed. The 224-case
real model/gait/route matrix remains finite and reverse-seek deterministic, with
unchanged ankle/sole loop-seam measurements.

Private evidence: `torso-probe/probe.json`, `torso-fixed-probe/probe.json`,
`torso-error-before/probe.json`, `torso-error-after/probe.json`,
`torso-support-seams/all.json`, and
`torso-run-review/six-model-torso-run-60fps.mp4`. The latter retains the independent
native source, five receivers, original 0.875-s Run cadence, and four curved-route
cycles. Stance and flight frames were inspected. This fixes a measured loss of
supported body motion; it does not establish natural-looking motion for every
source/receiver combination. Inferred running pace variation, large stance
corrections, remaining contact errors, and broader provider coverage remain open.
Production `dist/` is unchanged.

## Steadier running pace and horizontal reach limits

The flight estimator now filters support pace across verified neighbouring flight
links. It averages each stance estimate with the time-interpolated neighbouring
estimates. A two-support repeating gait therefore has steady inferred travel;
longer running takes retain sustained acceleration. Grounded pauses and breaks in
running evidence remain separate, and authored root-motion profiles bypass this
inference. The real Run's route speed is now 3.5479388 m/s throughout its cycle,
versus 2.44047–4.65323 m/s previously. Its inferred stride remains 3.104446 m and
its original duration remains 0.875 s.

Stance-only measurements initially looked better, but complete-stride checks
found a regression: carrying the old horizontal correction through a 0.35-s
release drove airborne feet outside leg reach. The native solver error reached
0.0353 m and Party Man reached 0.0859 m. This intermediate candidate was rejected.
Running contacts now release over their detected stance duration, capped at
0.35 s; split contacts combine their durations across a verified loop seam.
Shorter release alone reduced but did not resolve the reach failure.

The shared horizontal contact solver had another underlying defect: radial
clamping of an unreachable IK goal changed foot height. It now limits correction
along the requested horizontal direction, with a soft approach to the reach
boundary and a small reserve of the original knee bend. Vertical support is a
separate stage. Foot rotation and bone lengths remain intact. `reachLimited`
reports how much requested correction was withheld; small solver error is not
presented as proof that the original contact goal was reached.

The final candidate retains steady travel and lower stance sole-motion metrics:
source-normalized mean median speed of low sole vertices is 0.1924 m/s on the
native source, 0.2507 on Sage Cartoon, 0.0982 on Party Woman, 0.0732 on Party Man,
0.1180 on Toon Goon, and 0.1635 on Rowan. The comparable prior values were 0.2475,
0.2942, 0.2372, 0.3067, 0.4157, and 0.2306. These measurements include foot roll.
The tested running soles remain at or above the ground within numerical error.

Across the full stride, adjusted-goal solver error falls to numerical tolerance
(native maximum about 0.000013 m; receivers about 1e-9 m or less). The withheld
horizontal correction reaches 0.067 m on the native source and 0.176 m on Party
Man. Large corrections and limitations remain a quality concern. Peak sampled
leg-joint angular speed improves from 31.20 to 23.26 rad/s on the native candidate
after reach limiting, but some receivers still exceed the earlier unsteady-pace
baseline: Party Man reaches 26.67 versus 23.18 rad/s, and Rowan reaches 31.97
versus 20.69. Their largest changes occur near the left stance end (phase about
0.725 s), not solely during release. These are sampled diagnostics, not an
assertion of physically correct human joint speeds.

The 224-case matrix remains finite and reverse-seek deterministic. Run seam
displacement is about 0.01720 m. A remaining regression is the native Thoughtful
walk's right foot at repeated seams: maximum combined ankle/sole displacement
rises from the previous matrix maximum 0.01161 m to 0.01831 m (male dummy, long
repeat, at 34 and 68 s). Its sole displacement is about 0.01470 m. This remains
unresolved; the candidate is not ready for natural-motion sign-off or deployment.

Tests cover asymmetric support speeds, sustained acceleration, cadence-based
release including seam fragments, and unreachable horizontal goals retaining foot
height, orientation, and limb length. The detached-foot contact test now uses a
reachable horizontal goal and requires tighter accuracy; its old outward goal
could only be approximated by lifting the foot. All 702 tests in 70 files pass.
The first combined verification command was terminated after tests passed, during
TypeScript checking; a separate TypeScript check and isolated build at
`/tmp/scene-animation-review/reach-support-build` subsequently passed.

Private evidence includes `steady-pace-probe`, `steady-support-contacts`,
`stride-joints-before`, `stride-joints-after` (rejected release behavior),
`stride-joints-release`, `stride-joints-reach`, `reach-support-contacts`, and
`reach-support-seams`. The updated diagnostic render is
`reach-run-review/six-model-reach-run-60fps.mp4`: independent native source plus
five receiving rigs, four curved-route cycles, 210 frames at 60 fps. Takeoff,
stance, and flight frames were inspected. Production `dist/` is unchanged.

## Near-straight leg reach and repeated-walk seam trace

The repeated-walk regression was traced through raw route pose, horizontal
planting, transferred clearance, and final ground support. The native male
dummy's right ankle differs by about 18 mm across the aligned source seam before
contact correction; its height differs by less than 1 mm. At both sides of the
seam the leg is nearly straight. The preceding straight-line reach limiter
withheld almost all of a roughly 14-mm horizontal contact request, even though
some sideways motion around the leg's reachable arc was possible.

Horizontal reach limiting now projects an outward goal onto the reachable disk
at the current foot height. A soft outer boundary preserves the existing knee
bend where there is room. It allows lateral correction around a nearly straight
leg rather than requiring the entire correction to follow one line. Requests
inside the soft boundary remain unchanged, and the source foot height and
orientation remain preserved by this horizontal stage. `reachLimited` now
measures the vector difference between the requested and adjusted correction,
since those vectors need not remain collinear.

The 224-case matrix remains finite and reverse-seek deterministic. The maximum
Thoughtful-walk seam displacement decreases from 18.307 to 14.369 mm; the native
dummy's corresponding sole displacement decreases from 14.699 to 12.085 mm.
This remains worse than the earlier pre-reach-limit native result (3.964 mm at
the ankle, 0.592 mm at the sole). The remaining mismatch is not resolved by this
change. Running seam measurements and the largest stance-end angular changes
are essentially unchanged. Full goal acceptance remains open.

A new regression test requires a nearly straight leg to make a lateral contact
correction without lifting its foot. All 703 tests in 70 files, TypeScript, and
the isolated build at `/tmp/scene-animation-review/disk-support-build` passed.
Private evidence is in `seam-stage-probe/probe.json`, `disk-support-seams/all.json`,
and `stride-joints-disk/all.json`. The temporary instrumented world module used
for stage tracing was removed from the application source tree.

`disk-turn-review/six-model-turn-60fps.mp4` shows the original motion dummy and
five receiving models from source time 32 to 36 seconds, crossing the 34-second
loop seam at the original cadence. The dummy is independently loaded from the
hidden retarget source. The review uses the shadowed static floor and contains
240 frames at 60 fps; before/after seam and subsequent frames were inspected.
This is a diagnostic comparison, not natural-motion sign-off. Production `dist/`
is unchanged.

## Repeated route pose closure and cross-provider unit checks

Small residual endpoint differences now close over the last 0.2 source seconds
(or 20% of a shorter cycle) of a repeated route take. Correction is additive in
the moving route frame: it preserves path travel and heading while closing body
rotations, residual hip displacement, supported local translations, and morph
weights. Detached deforming feet use their anatomical anchors. Native playback
outside routes and one-shot takes retain their original poses and timing.

Both feet must have verified loop-compatible endpoints. Large body or morph
differences and changing endpoint scales disclose a nonseamless take instead of
forcing closure. Translation acceptance uses import scale rather than comparing
centimetre-valued local coordinates directly against metre-valued dimensions.
The closure boundary is included in animation export sampling. This closes
endpoint poses; it does not guarantee matching endpoint velocities.

The final 224 model/route cases have no nonfinite transforms and zero measured
reverse-seek discrepancy. Maximum sampled ankle/sole displacement across seams:

| Source          | Previous candidate | Pose-closure candidate |
| --------------- | -----------------: | ---------------------: |
| Easy walk       |           0.288 mm |               0.013 mm |
| Jog in place    |          17.199 mm |               0.139 mm |
| Thoughtful walk |          14.369 mm |               3.806 mm |
| Original stroll |          10.258 mm |               0.016 mm |

The native male dummy's Thoughtful-walk seam decreases to about 0.800 mm;
the remaining matrix maximum is on the coarse Sage Cartoon receiver. Ground
support and source-versus-receiver clearance remain separate from pose closure
and need further continuity work. Running stance-end angular changes also remain
open: the sampled Party Man peak rises from 26.726 to 28.289 rad/s, while Rowan
changes from 31.965 to 31.938. These are diagnostics, not natural-motion approval.

Provider-independent tests compare equivalent source/receiver rigs represented
at unit scales 100:1, 1:100, and 0.01:1000. They cover native and retargeted poses,
curved repeated routes, small endpoint mismatches, original cadence, and reverse
seeking. Other new tests exercise attached and detached feet, large-pose/scale
rejection, morph closure, one-shot preservation, and export boundaries. All 711
tests in 71 files pass. The application code also passed TypeScript and an
isolated build at `/tmp/scene-animation-review/closed-pose-build` before the final
three unit-variation tests were added.

Private evidence is in `closed-final-seams`, `stride-joints-closed-final`, and
`closed-final-turn-review`. The latter's `six-model-turn-60fps.mp4` contains 240
frames at 60 fps, source time 32–36 seconds, showing an independently loaded
native dummy plus five receivers. Frames at the closure onset and either side
of the 34-second seam were inspected. These results cover the available rig
families, not dozens of untested providers. Production `dist/` is unchanged;
full animation-quality acceptance remains open.

## Vertical ground support without knee lock or lateral foot drift

A 480 Hz trace of raw pose, horizontal planting, body support, and final leg
support locates another source of sharp stance-end movement. The body support
envelope raises the actor; the subsequent leg solve tries to lower the sole.
When that vertical goal exceeds reach, radial IK clamping nearly locks the knee
and also moves the foot horizontally. The next frames bend the knee again.
This occurs in the shared geometry solver, independent of provider identity.

Ground correction now uses the reachable vertical interval at the current foot
XZ position. Like horizontal planting, it softly approaches the reach limit and
retains a small reserve of the existing bend. A second sole-geometry iteration
stops when reach limiting occurs, so it cannot spend the first solve's reserve.
The solver retains foot world orientation and bone lengths. It reports withheld
correction; a near-zero adjusted-goal error does not mean the original ground
goal was reachable.

The 480 Hz stance-end trace reduces the largest sampled leg-joint angular speed
from 38.330 to 32.707 rad/s on Party Man and from 68.116 to 45.180 on Rowan.
These local peaks are still substantially higher than the uncorrected pose and
remain open quality work. Across the full 60 Hz running comparison, peaks fall
from 28.289 to 25.765 and from 31.938 to 26.492 respectively. Other receivers'
full-stride peaks are unchanged. Stance-interior low-sole motion metrics are
unchanged, and minimum soles remain above the floor within numerical tolerance.
At takeoff time 1.6 s, Party Man's remaining sole gap increases from 8.153 to
10.17 mm; Rowan's decreases from 26.846 to 21.32 mm. This is an improvement in
the solver's behavior, not proof of physically correct contact or human motion.

The 224-case route matrix remains finite and reverse-seek deterministic. The
maximum Thoughtful-walk seam displacement decreases from 3.806 to 3.258 mm;
the other three source seam maxima are unchanged. A regression test requires an
unreachable downward goal to retain foot XZ, orientation, lengths, and knee bend.
All 712 tests in 71 files, TypeScript, and the isolated build at
`/tmp/scene-animation-review/vertical-support-build` pass. Production `dist/`
remains unchanged.

Private evidence includes `stance-stage-probe`, `vertical-stage-probe`,
`stride-joints-vertical`, and `vertical-seams`. The instrumented world-module
copy was removed from application source and saved with the trace evidence.
`vertical-run-review/six-model-run-60fps.mp4` contains 210 frames at 60 fps over
four curved-route cycles: independently loaded native source plus five receivers.
Takeoff, stance-end, and flight frames were inspected. The source is the bundled
running take, not an ActorCore human run. Large horizontal stance corrections and
their effect on knee motion still need work across rig proportions.

## Continuous running contact entry and release

The next experiment tested temporal-midpoint and position-balanced contact
anchors, including an intersection of per-frame leg-reach disks. These reduced
some knee peaks but increased stance sole motion on coarse receivers. They were
rejected. Experimental code is saved with `reachable-stage-probe` evidence;
the anchor optimizer and its tests are absent from application source. Existing
stance anchors remain in use for every rig.

The retained change addresses the velocity discontinuity at contact entry and
release. Confirmed running supports prepare during the preceding swing, up to
0.15 source seconds or their own stance duration. Cubic Hermite offsets match the
measured correction velocity at landing and takeoff and return to zero offset
and velocity outside the transition. The derivative is measured on the actual
receiver along the actual route, in source seconds, after applying the existing
correction-distance bound. Measuring an unrestricted derivative caused a release
regression on saturated coarse rigs; that candidate was rejected too. One-sided
sampling uses 0.1 ms so it does not average over a nearby correction-limit change.

Preparation and release share short swing gaps without overlapping or abruptly
dropping the preceding correction. Export includes preparation boundaries,
including those that wrap across a verified loop. A route ending before the next
contact does not prepare that nonexistent landing; trimming within stance keeps
its preceding preparation. Source cadence, root travel, contact positions, and
stance-interior correction remain unchanged.

An independent before/after boundary probe samples horizontal ankle and sole
velocities immediately around each running contact start/end, on the native
source and five receiving rigs. The largest sampled sole-velocity discontinuity
decreases from 5.2313 to 0.0325 m/s. For example, Party Man's right landing changes
from 5.0106 to 0.0113 m/s and right release from 5.2313 to 0.0061; Sage Cartoon's
right landing changes from 3.9123 to 0.0090, with release improving from 0.0133 to
0.0046. These are discontinuity measurements, not absolute foot speeds or a
claim of zero sliding.

The full-stride stance-interior sole-motion metrics remain unchanged, as do the
four source seam maxima in the 224-case route matrix. Transforms remain finite
and reverse-seek discrepancy is zero. Minimum soles remain above the ground
within numerical tolerance. Most peak sampled joint speeds are unchanged because
their largest changes occur inside stance. Toon Goon's full-stride peak rises
slightly from 23.662 to 24.210 rad/s near left landing. Large stance corrections,
within-stance knee motion, geometry-dependent roll, and overall natural-motion
acceptance remain open.

Tests cover transition position/velocity continuity, saturated correction
release, reverse seeking, short gaps, wrapped export boundaries, and trimmed
routes. All 715 tests in 71 files, TypeScript, and the isolated build at
`/tmp/scene-animation-review/swing-support-build` pass. The diagnostic before/after
modules were removed from application source and saved with private evidence.

Final evidence is in `swing-precise-boundary-probe`, `stride-joints-swing-precise`,
and `swing-precise-seams`. `swing-run-review/six-model-run-60fps.mp4` contains 210
frames at 60 fps over four curved-route cycles, using an independently loaded
native source plus five receivers. Landing and release frames were inspected.
This remains the bundled running source, not a human motion-capture run.
Production `dist/` is unchanged; the goal remains open across all imported
providers and paths.

## Complete hierarchy holds and exported interpolation fidelity

The next check exercised the actual GLB export boundary: evaluate the scene,
bake its animation, clone the export snapshot, serialize with `GLTFExporter`,
independently parse the bytes with `GLTFLoader`, and compare playback with the
live evaluator. Verification-only node IDs identify corresponding bones and
meshes after parsing. The check includes original-duration Stand and talk on
its native dummy and Party Woman, bundled Run on its native rig and Party Man,
and Original stroll on Rowan. It compares every bone, morph weights, and 25
distributed CPU-skinned vertices per mesh; it does not inspect every surface
vertex or establish arbitrary-provider compatibility.

Three shared issues emerged and were corrected without provider-specific
selection:

- Loop closure rejected the native running rig because endpoint bone scales
  differed by roughly 1–4 parts per million. Its absolute 1e-6 scale test treated
  that exporter noise as an authored scale change and left a roughly 3 cm knee
  jump. The guard now uses a per-axis relative 1e-5 tolerance. Meaningful scale
  changes still reject closure. This also exposed a gap in the previous route
  matrix: it did not include the actual bundled motion-source rig as a target,
  and foot-only seam measurements could miss jumping knees on detached-foot rigs.
- A final hold reconstructed the articulated body on a reset root instead of
  retaining the complete evaluated hierarchy. Animated non-bone parents and
  detached deformers could jump. Holds now evaluate the last active instant
  directly, preserving the whole hierarchy, morphs, and motion diagnostics.
  Accumulated complete heading turns remain available without changing the held
  orientation. Contact-action endings keep their existing behavior.
- Fixed samples could lose fast nonlinear contact/retargeted poses between keys.
  Baking now evaluates exported TRS interpolation in world space at interval
  midpoints and quarter points, subdividing where it misses the evaluated pose.
  Thresholds are 0.25 mm position, 0.001 rad rotation, 1e-4 relative scale, and
  1e-4 morph weight. Existing source keys, 60 Hz samples, route boundaries, and
  final partial frames remain. Refinement stops at eight subdivisions or Float32
  time resolution. These are sampled criteria, not a mathematical error bound
  for every possible curve, cut, mesh deformation, or timestamp.

Dense round-trip checks add quarter/midpoint samples of every stored route
interval, source/route boundaries, and both sides of loop seams. All bones and
meshes matched after parsing and all compared transforms were finite. Maximum
sampled surface differences from live playback were:

| Case                        | Before (mm) | After, denser sampling (mm) |
| --------------------------- | ----------: | --------------------------: |
| Stand and talk, native      |     0.00037 |                     0.00037 |
| Stand and talk, Party Woman |      0.1702 |                      0.1702 |
| Run, native                 |     32.0264 |                      0.3392 |
| Run, Party Man              |     11.6391 |                      0.2473 |
| Original stroll, native     |      0.1348 |                      0.2122 |

The stroll difference reflects denser measurement; its animation still has 611
keys and the exported file size is unchanged. Native talk retains 1,689 keys;
transferred talk increases from 1,689 to 1,700. Running increases from 257 keys
to 595 native / 862 transferred, with GLB sizes growing from 0.89 to 1.40 MB and
36.50 to 40.03 MB respectively. More evaluations cost CPU: the measured 28-second
transferred talking bake took about 5.2 seconds, and the 1.925-second transferred
running bake about 2.1 seconds. These single local measurements are not controlled
benchmarks; export responsiveness on large scenes remains a practical limit.

The expanded route matrix has 240 cases: 15 targets, four source motions, and
four path shapes. It adds every bone at loop seams and whole-body final-hold
measurements. Non-finite transforms and reverse-seek discrepancy are zero;
final-hold discrepancy is below 2e-15 m. Existing foot seam maxima remain
unchanged, including 3.258 mm on Thoughtful walk. The all-bone measurement also
records a 16.759 mm Thoughtful-walk discontinuity on `PoleTargetR`; this broader
diagnostic must not be reported as universally seamless body motion. Supported
channel limitations continue to be disclosed for incompatible source/target
anatomy. These few rig families do not establish coverage of dozens of providers.

Tests cover complete hierarchy holds, animated parents and detached deformers,
preserved turn counts, nonlinear export at different import units, midpoint
inflections, and relative scale noise. All 720 tests in 71 files, TypeScript,
and the isolated build at `/tmp/scene-animation-review/adaptive-export-build`
pass. The temporary instrumented world module was removed from application
source and saved with the private diagnostic evidence.

Evidence is in `export-roundtrip`, `export-relative-scale`, `export-final-dense`,
`export-seam-stage`, `export-final-route-matrix`, and `export-roundtrip-review`.
The latter contains `preview-versus-reloaded-glb-60fps.mp4`: 150 frames at 60 fps,
2.5 seconds, with native-source and Party Man rows and live/exported columns.
Frames around stance, looping, and the final hold were visually inspected with
matching cameras and clocks. This is a bundled stylized run transferred to a
human rig, not a human motion-capture source or proof of natural running quality.
Production `dist/` remains unchanged. Natural-motion acceptance across all
imported models, providers, and paths remains open.

## Loop clearance continuity and explicit collision preference

The full-body seam diagnostic identified a visible remaining defect on repeated
Thoughtful walk. On Sage Cartoon, the left knee moved 11.607 mm across the loop
boundary even though the closed raw pose and horizontal contact stage differed
by less than 0.001 mm. The source soles still had a small endpoint mismatch;
ground support used those unclosed heights after the receiving pose had already
been closed. A roughly 0.526 mm support-height discontinuity was amplified by
the near-straight leg solve into the knee jump.

Loop closure now returns the matching source-clearance correction over its
existing blend window. Transferred body support and near-contact leg correction
use those same corrected heights. On native rigs, the clearance measurement
also includes the studio-root vertical offset introduced by closure: local mesh
heights alone otherwise cause ground support to undo the world-pose correction.
One-shot takes and rejected loop closures keep their original semantics. The
change is based on sampled geometry and transforms, not provider or clip names.

All 240 route cases remain finite and reverse-seek deterministic. Thoughtful
walk's maximum foot seam displacement decreases from 3.258 mm to 0.000304 mm.
The raw all-bone diagnostic still reports movement of unweighted control/root
nodes, so a second check compares every rendered mesh vertex across the same
boundary. Across 15 targets and 147,260 vertices, maximum surface displacement
decreases from 12.0405 mm to 0.000835 mm. The probe confirms that the reported
`PoleTargetL`, `PoleTargetR`, `root`, and `Bone` controls have no direct positive
skin weights in these assets. Surface comparison, rather than ignoring those
names, establishes the visible result. This is a boundary continuity result,
not an overall gait-naturalness score.

The requested collision/navigation requirements are recorded near the top of
this document. `animationCollisions` now defaults to true in new and legacy
project data and can be changed through scene commands or the labeled Studio
settings checkbox. An explicit false value survives serialization and reload.
The viewport clears animation overlap diagnostics while disabled and resumes
checking when re-enabled. Existing edit-gesture collision guards are unchanged.
**Automatic AI path adjustment/replanning is still outstanding**: the current
object-route planner makes snapshots and does not yet fulfill that requirement.

An isolated browser test loads a legacy fixture, starts playback, switches
collision checking off and on, checks the save payloads, and verifies that the
overlap warning disappears and returns. Save requests are captured by the test
backend in the browser; real project files are not modified. The screenshot
review exposed and fixed a checkbox width/layout issue. Evidence and the runner
are in `collision-toggle`. Model-default/explicit-setting tests complement this
UI check; automatic obstacle avoidance is not claimed by either check.

The complete suite passes: 723 tests in 72 files, TypeScript, and the isolated
build at `/tmp/scene-animation-review/clearance-collision-final-build`. New
regressions cover transferred source-clearance continuity, native root-offset
support, one-shot behavior, deterministic seeking, and the collision preference.
The temporary stage-tracing module is removed from application source.

Private evidence includes `thoughtful-clearance-baseline`,
`thoughtful-clearance-closed`, `closed-clearance-final-matrix`, and
`clearance-deformed-before` / `clearance-deformed-final`. The final visual sample
is `thoughtful-clearance-final-review/six-model-loop-60fps.mp4`: 120 frames,
60 fps, source seconds 33–35 around the real 34-second Thoughtful-walk boundary.
It shows an independently loaded native motion dummy, Party Woman, Party Man,
Toon Goon, Sage Cartoon, and Rowan. Frames on both sides of the boundary were
inspected. This short sample verifies the seam correction, not the full take.
Production `dist/` is unchanged; overall motion quality and the new automatic
navigation requirements remain active.

## Automatic object-destination routes and animated body clearance

AI `walkTo` actions now retain their destination and walk/run intent on the
sequence clip. The shared viewport prepares those routes again after staging
changes while animation collision detection is enabled. Clip IDs survive, so
transcript references remain intact; shared motions are copied before a route
changes. The chosen imported gait and explicit pace survive the detour: route
duration changes in proportion to measured native gait travel time, including
source pauses. AI object routes now select the same imported locomotion defaults
as the route editor instead of silently creating procedural motion.

A missing destination, unavailable gait, obstructed start, or unsolved route
leaves the saved clips editable. Evaluation holds before the failed route and
suppresses dependent later actions. Animation export reports the failure;
project JSON remains downloadable for recovery. The prepared scene supplies
preview, recording, export boundaries, and the production package definition.
Automatic route changes belong to the preceding edit's undo entry. Saving
explicit waypoints through the path editor removes destination tracking for
that clip; its visible explanation makes this consequence clear.

A real browser/export check found that a clear root path was insufficient:
shoulder-based clearance still allowed Party Woman's animated mesh bounds to
overlap a crate. Automatic routes now validate actual deformed skin, morph, and
rigid attachment bounds at 60 Hz against static staging. When those bounds
collide, planning retries with an outward-rounded body radius measured from the
animation, retaining that actor-local clearance for stable subsequent replans.
Unsuccessful validation holds the route instead of accepting the root-line
result. This is conservative mesh-AABB clearance with finite pose sampling,
not a continuous collision proof. Ground support remains the animation pipeline's
responsibility. The scan currently runs synchronously during preparation; its
cost on long scenes needs profiling and scheduling work before release.

The isolated browser fixture uses real Party Woman geometry and the bundled
imported Walk take, with fake assistant responses and intercepted project saves.
It creates an AI destination route, moves a crate into that route, exports a
production package, then obstructs the actor's starting position. The verified
detour lasts 3.802273 seconds versus the original 3.5 seconds, retains the gait,
and records a 0.8-unit body clearance. The blocked state produces the stop
message and preserves the project data. No real project writes or live assistant
requests are used by this harness.

The package's scene definition matches the saved route and clips exactly.
Its GLB is independently reloaded and compared with live evaluation at 241
uniform times, additional reverse seeks, and a final hold. All 101 bones and
25 sampled vertices on the character mesh are compared. Maximum bone-position
error is 0.231446 mm, sampled surface error 0.231922 mm, and angular error
0.000574 radians; non-finite results and detected overlaps are zero. The GLB
contains the project's 12-second sequence, including the route's terminal hold.
Approach, detour, and arrival images were inspected. This bundled stylized gait
is not evidence of accepted human motion-capture naturalness.

All 729 tests in 73 files, TypeScript, and the isolated build at
`/tmp/scene-animation-review/automatic-navigation-build` pass. New regressions
cover static replanning, pace and identity preservation, unavailable destinations,
blocked-route holds, disabling, explicit waypoint edits, imported gait timing,
reverse seeking, and large visible attachments at times between scan samples.
Evidence and runners are in `automatic-route-ui`; the failed shoulder-clearance
comparison is retained in `automatic-route-before-clearance`.

The overall navigation requirement remains open. Moving obstacles require
time-aware planning and validation of interacting actors, not frozen staging.
AI coordinate routes, direct movement commands, and conversational movement
also need the same coverage. The automatic planner currently handles retained
object-destination intent only. Provider breadth, whole-take human animation
quality, moving-obstacle behavior, continuous-time collision coverage, and
planning responsiveness remain acceptance work. These overlapping changes stay
in the current worktree; production `dist/` is unchanged.

## Timed obstacle prediction, cooperative preparation, and native route pace

Object-destination AI routes now evaluate obstacles at the same absolute scene
clock as the actor. The scan includes animated characters/props, conversational
pose changes, and carried objects. Relative sweeps between consecutive mesh AABB
snapshots catch translational crossings that occur between clear endpoints;
parallel-moving objects are not rejected merely because their whole-travel
bounds overlap. Rotating/deforming geometry remains sampled at 60 Hz, so this
is not a continuous-time collision guarantee for arbitrary motion.

The planner first uses fixed staging, then adds local detour constraints at
predicted conflict positions and checks the resulting timed motion again. It
does not exclude the entire future trajectory of an obstacle: a regression
verifies travel through space after that obstacle has vacated it. Checks extend
through a terminal hold/rest, since another object can reach the actor after
arrival. Later AI replans are checked against the final combined schedule;
unresolved conflicts propagate through the held playback scene instead of
leaving other actors driving through a newly stopped character. Search is
bounded, with recoverable holds when it does not find a validated detour.

A carried prop contributes to the carrier's combined clearance bounds. Its
intentional hand contact is excluded from self-collision. Initial AI route
creation also defers animated-obstacle checks to prediction, allowing an actor
to request a route while already holding a prop. Stable mesh identities are
retained when combining colliders and matching consecutive snapshots.

Preparation now runs in cooperative, cancellable steps. A newer scene, disabling
collision detection, or unmounting the viewport cancels obsolete work. The
viewport restores its displayed pose between batches, pauses playback while
preparing, and exports only after the matching preparation finishes. Synchronous
and cooperatively scheduled planning share the same steps; tests render unrelated
times between batches and verify the same result. Message-channel tasks avoid
nested timer clamping. While preparing, an unchanged paused view is not repeatedly
redrawn on the GPU; camera/selection/resize/scrub changes and drag gestures still
request drawing. In the existing browser profile, the observed create-to-replan
interval fell from about 127 seconds to 12.4 seconds after suppressing redundant
GPU redraws. The latter run still recorded a 1.535-second maximum heartbeat gap,
including setup, so this is not a claim of uniformly low latency on every machine.

The timing audit found a small remaining implicit cadence change: initial imported
object-route duration was rounded to a tenth of a second. Imported plans now use
exact measured native travel time; explicitly selected pace is retained during
replanning and used for duration-limit/arrival validation. Procedural defaults
retain their existing rounding. A regression also covers a detour whose unscaled
native duration exceeds the clip limit but whose selected pace fits.

The isolated real-app fixture creates Party Woman's imported Walk route, animates
a crate across it, exports a production package, and then blocks the starting
position. The final route changes from 3.497930 to 4.600780 seconds with native
clock ratios exactly 1 before and after the detour. The package definition agrees
with the saved character route and moving-prop schedule. A freshly parsed GLB is
compared to live evaluation over the route, the full 12-second sequence, and
reverse seeks: 486 evaluations, all 101 bones, 25 sampled character vertices,
and the moving prop root. Maximum bone-position error is 0.229098 mm, sampled
surface error 0.244842 mm, moving-prop error 0.118223 mm, and rotation error
0.000776 radians. Non-finite results and detected overlaps are zero. Re-preparing
the saved imported scene with fresh model loads leaves its scene data unchanged.
Approach, detour, and arrival images were inspected.

A second browser check disables collision detection while prediction is active,
verifies that cancelled work does not pause disabled playback, then re-enables
checking and verifies the detour completes. Fixture project saves and assistant
responses are intercepted; the tests do not write real projects or call a live
assistant. Evidence and runners are in `moving-route-ui`, `moving-route-toggle`,
`moving-route-existing-browser`, and `moving-route-existing-browser-idle-render`.
The earlier rounded-rate measurements are preserved in `moving-route-rounded-pace`.

All 739 tests in 73 files, TypeScript, and the isolated build at
`/tmp/scene-animation-review/moving-route-build` pass. New coverage includes fast
relative crossings, vacated space, final holds, coupled actors, carried props,
cooperative rendering, cancellation, and native/selected pace. Production `dist/`
is unchanged.

**Human-motion and full navigation acceptance remain open.** This fixture uses a
bundled stylized gait on a real imported character, not a human mocap gait. The
arrival image visibly retains a mid-stride pose under the existing Hold ending;
natural arrival settling and turns need further work. Coordinate-authored AI
routes, direct movement commands, conversational movement, automatic waiting,
moving destinations, and continuity after edits during playback are not yet
covered by the object-destination planner. The bounded detour search is not a
complete space-time planner. Provider breadth, natural whole-take motion, and
these remaining movement entry points must be verified before completion.

## Aligned route approaches and stable replanning

Generated object-destination routes now try forward departure guides and radial
arrival guides, with several lead lengths and obstacle margins. Both the original
and corner-rounded control polygons are evaluated using the same interpolated
curve as playback. Among clear candidates the planner prefers lower peak spatial
curvature. Long spans are subdivided beside short guides: without this, uniform
Catmull-Rom interpolation could reverse briefly even on a straight route. The
32-point limit and minimum spacing remain enforced. Tight staging can still fall
back to the earlier feasible route; natural pivot choreography is not implemented.

An existing navigation path is retained when its endpoint and facing still match
an available destination candidate and its animated geometry passes the timed
clearance scan. If a new obstruction blocks it, a fresh plan is attempted even
when the saved body radius is unchanged. Moving the destination invalidates the
old arrival. Repeated preparation and reopening therefore preserve a safe route
instead of changing its timing and shape on every load. Manual paths remain
outside this automatic destination rewrite.

A reverse-seek regression exposed a separate fallback-rig measurement error:
`standingHeight` read live leg attachment translations before resetting the next
pose. Those offsets can contain transferred pelvic motion. The fallback now uses
its saved neutral positions, matching the immutable bind measurements used for
registered imported rigs. The reverse-seek test passes without relaxing its
original 0.1-micrometre positional tolerance. A dedicated test changes animated
leg offsets and verifies that the measured neutral proportions stay constant.

Real-app evidence is in `approach-route-rounded-ui` under the verification root.
The isolated Party Woman / bundled Walk / crossing-crate fixture creates a
3.497930-second direct route and replans to 5.172559 seconds. Native clock ratios
are exactly 1 before and after. It exports a production package and subsequently
reports a blocked route when the starting place is occupied. Reopening with fresh
models leaves the saved data unchanged; the observed preparation took 2.13 seconds
in this fixture. No real projects or live assistant requests were used.

The heading audit compares the earlier saved moving-obstacle detour to the new
one. Departure and arrival direction mismatches fall from 52.59 and 53.82 degrees
to numerical zero; maximum sampled facing/travel mismatch falls from 54.16 to
0.432 degrees. These are path-based measurements, not a proof of natural body
motion. The 1,000-step uniform-distance audit still finds a peak heading rate of
280.75 degrees/second versus 233.12 for the earlier route whose body faced away
from travel. Rounded candidates improve on an intermediate aligned curve's
487.21-degree/second peak, but tight turns remain an acceptance issue. This audit
uses mean route timing; native nonuniform gait timing can alter instantaneous
rates further. No claim of human-quality turning follows from endpoint alignment.

The freshly parsed package was compared with live playback over the route,
the full 12-second take, and reverse seeks (486 evaluations, 101 bones, 25 mesh
vertices, moving-prop root). Maximum bone-position error is 0.243410 mm, sampled
surface error 0.243385 mm, prop error 0.081850 mm, and rotation error 0.000541
radians. Detected overlaps and non-finite results are zero. Approach, detour, and
arrival renders were inspected. The existing Hold ending still freezes a
mid-stride pose; this remains unsuitable as a natural arrival. The fixture uses
a stylized bundled gait, not the requested human-source mocap acceptance take.

All 745 tests in 74 files, TypeScript, and the isolated build at
`/tmp/scene-animation-review/approach-final-build` pass. New regressions cover
approach alignment at multiple scales, actual interpolated clearance, blocked
forward departure, no loop at an already-reached goal, straight-route monotonicity,
changed staging after a prior replan, destination relocation, and fixed neutral
measurements. These changes share the current animation worktree because they
modify the same planner, playback, and rig pipeline. Production `dist/` is unchanged.
The full provider and movement-entry-point acceptance gaps listed above remain
open; this section does not mark the overall goal complete.

## Captured stops and precise source-start ranges

Inspection of the actual source data distinguishes authored stops from arbitrary
final gait frames. The 34-second human **Thoughtful walk** contains several periods
of low travel speed with both soles near the floor; the final measured interval
is 32.45–34.00 seconds. The bundled Walk and Run loops and Rowan's Original stroll
do not contain a qualifying stationary interval in this probe. These measurements
use geometry and timing, not provider names, and are evidence for this fixture,
not an automatic classifier or a promise that every imported take has a stop.

Standalone imported actions now accept `sourceStart`, exposed as **Start in
source** beside playback speed. This selects an exact timestamp in the original
file; the scheduled duration trims or holds the remaining source at the chosen
rate. New source ranges without a rate default to native 1×. Existing legacy
full-take fits retain their explicit migration behavior. Invalid starts are rejected;
saved ranges survive reloads and duration-only updates. Distance-paced routes
continue to use their complete gait; route conversion removes standalone range
timing rather than silently applying a source offset to distance-based playback.

Native and shared root-motion extraction now measures the selected start/end
interval. The selected starting location and heading are rebased to the placed
actor, and only that interval's travel and turn accumulate into later actions.
Root caches distinguish source ranges. Joint, helper, finger, facial, morph and
other supported source channels are sampled at the selected absolute source time.
Export maps source keys to the range's timeline origin and preserves its exact
hold boundary. Neither imported source files nor full-take playback are changed.

This makes a captured stop usable as an explicit action without recreating it as
a bind-pose blend. It does **not** yet automatically connect an arbitrary walking
phase to a compatible stop. Entry phase/contact matching, trajectory alignment,
arrival distance, obstacle clearance during that transition, and a solution for
gaits without an authored stop remain required work.

Evidence is in `human-source-ranges` under the verification root:

- `full-human-take.mp4` compares the same real 303-track human capture on its
  original Motion Dummy and Party Woman, at original 1× speed for the full 34
  seconds, followed by one second of final hold. The rendered file is 35.033
  seconds including the final sampled frame, at 30 fps.
- `captured-stop-tail.mp4` compares source seconds 30–34, followed by one second
  of hold. The final posture is a captured standing pose, not a frozen swing
  frame or a procedural reset. Its starting direction is rebased consistently.
  The 5.033-second file includes the final sampled frame. Full-take middle/end
  frames and the selected stop's end were visually inspected with floor shadows.
- `source-start-control.png`, `ui-saved.json`, and `captured-stop-package.zip`
  verify editing source start to 30 and duration to 5 in the real app while
  keeping playback rate 1. Package scene data retains the same timeline. Saves
  and export uploads are intercepted; no real project or live AI request is used.
- `package-roundtrip.json` compares a freshly parsed GLB with live playback at
  370 times across the full 12-second scene, including reverse seeks and both
  sides of the source-end and slot-end boundaries. It checks 101 bones and 25
  vertices of the character mesh. Maximum sampled bone error is 0.000197 mm,
  surface error 0.000207 mm, and rotation error 0.000000499 radians; no non-finite
  results occur. A separate comparison against the full take at source time
  `30 + timeline time`, after the expected heading rebase, finds maximum relative
  body-position difference 0.000193 mm and rotation difference 0.000000155 radians.

The source interval probe and measurements are in `source-stops/profiles.json`.
All 754 tests in 74 files pass, including native/shared source-range travel and
turn accumulation, supported detailed joint poses, reverse seeking, source-key
and hold export mapping, persistence, invalid ranges, and timing controls.
TypeScript and the isolated build at
`/tmp/scene-animation-review/source-start-final-build` pass. Production `dist/`
is unchanged. This provides actual human-capture comparison evidence and precise
source reuse; the overall natural-motion and universal navigation goal remains open.

## Captured arrival matching and contact-aware joins

The source probe now distinguishes soles that are merely near the floor from
stable material points on the feet. `detectLocomotionStops` requires sustained
low travel, both grounded feet with low three-dimensional surface velocity, and
a preceding travelling entry. Thresholds scale with the measured body; names and
provider metadata do not select behavior. An initial idle, short double-support
phase, airborne pause, or sliding foot is insufficient. Torso turns over stable
feet remain valid. This is conservative sampled evidence, not a physical proof.

On the actual Thoughtful walk, this identifies settled intervals beginning at
7.1333 and 18.6000 seconds. The final near-floor interval from the earlier probe
does **not** meet the new 0.4-second stable-foot criterion: the actual captured
feet continue adjusting until near the end. The earlier manual source-tail
sample remains a usable explicit selection; it was never an automatic stop
classification. Bundled Walk/Run and Original stroll have no qualifying stops.

`matchCapturedArrival` compares possible entries from the same take against the
route's outgoing phase. It measures visible weighted joints, detached deformers,
rigid attachments, scale, morphs, linear/angular velocities, and common support.
Unweighted control bones do not dominate its score. The matcher restores the
source pose after measurement. Of 19 requested source-space travel distances in
this fixture, only 5.98 and 6 metres pass the prospective blend gates. This does
not authorize a pose cut or establish trajectory/obstacle clearance. The matcher
is not yet connected to automatic route insertion.

The 6-metre candidate joins a route prefix ending at source phase 17.48616 to a
standalone source interval 17.45–19.21667, both at native 1× speed. Testing that
actual sequence exposed extra foot sliding from the ordinary smooth blend. The
incoming right-foot contact lasts through source 17.50, so its first 50 ms are
the relevant planted interval; later displacement includes the captured release.

Smooth transitions now retain a contact when the outgoing visible sole is near
the floor and stationary and the incoming travelling capture supplies stance
evidence. The target follows the incoming source's small foot displacement with
an offset from the preceding plant. Horizontal leg IK preserves foot orientation
and respects reach limits. The offset releases smoothly at the captured lift,
with timing mapped through explicit playback speed. A longer stance can outlive
the ordinary pose blend. Reverse seeks initialize the same constraint, and Hold
keeps the corrected final pose. In-place virtual travel contacts are not treated
as stationary standalone support; missing geometry and unsupported anatomy do
not acquire an invented plant. This currently covers qualifying transitions into
standalone imported takes, not every possible procedural or route-to-route join.

Measured horizontal drift over that first 50 ms:

| Body                  | Previous smooth blend | Contact-aware blend |
| --------------------- | --------------------: | ------------------: |
| Original Motion Dummy |             27.860 mm |            2.169 mm |
| Party Woman           |             26.321 mm |            5.493 mm |
| Sage — Cartoon        |             14.256 mm |            4.789 mm |

The remaining movement closely follows the incoming take's own sampled foot
motion; these are not zero-slip claims. The before/after boundary displacement
measured across a 20-microsecond interval is approximately 0.0014 mm for each
foot. The root trajectory, clip durations, playback rates, and original files
are unchanged by contact correction. Full-body and foot-detail renders at the
join, release, and captured standing end were inspected on all three bodies.

Export verification exposed two related coordinate issues. Detached rig roots
now retain world-position continuity during a smooth join, just as the hips do.
The export's stable armature-coordinate handling also applies to configured
imported receiving rigs with no native clips of their own. Such rigs still play
shared takes and can hand movement between armature and timeline coordinates.
Limiting this handling to nonempty native animation lists allowed interpolation
errors at that handoff. Regressions cover both root continuity and compensating
parent changes on a receiving rig without native takes.

Evidence under the verification root:

- `arrival-matching-final/profiles.json` contains real-source stop candidates and
  the distance sweep. `stop-foot-evidence/profiles.json` records the actual final
  foot velocities that prevent a premature stable-stop classification.
- `arrival-join/join.json` preserves the original blend measurements.
  `arrival-join-contact/join.json` contains the corrected three-body comparison
  and the complete two-clip scenes.
- `arrival-join-contact/previous-blend.mp4` and `contact-aware.mp4` show the same
  three-body sequence at native 1×, with full bodies and foot closeups. The
  latter reaches the captured standing gesture instead of holding mid-stride.
- `arrival-join-contact/timeline.png`, `ui-scene.json`, and
  `captured-arrival-package.zip` come from the actual app's production export.
  Project writes and export uploads were intercepted; no real project or live
  AI request was used. `scene.glb` was extracted and freshly parsed for comparison.
- `arrival-join-contact/package-roundtrip.json` checks 587 timeline evaluations,
  including dense join/release samples, reverse seeks, and ending boundaries,
  across 101 bones and 25 mesh vertices. Maximum bone error is 0.186368 mm,
  sampled surface error 0.166473 mm, and rotation error 0.000643224 radians;
  non-finite results are zero. The earlier failed boundary measurements are
  retained in `package-diagnostic.json` and `package-before-stable-frame.json`.

This work shares the existing animation worktree because playback, contact,
retargeting, and export changes depend on the same pipeline. Production `dist/`
is unchanged. All 772 tests in 77 files pass, along with TypeScript and the
isolated build at `/tmp/scene-animation-review/contact-final-build`. An earlier
package test exceeded its five-second timeout during concurrent full-suite
execution and rendering; the final suite passed with two workers and no render
job. No timeout or existing assertion was weakened.

Automatic arrival selection/placement, clearance through the
whole joined sequence, natural arrivals without a captured stop, sharp-turn
quality, the remaining AI movement entry points, and broader provider validation
remain open. The app-wide collision/navigation requirements remain in force.

## AI coordinate destinations and ordered navigation preparation

Automatic navigation now accepts either an object destination or a level point
relative to the action's starting frame. The saved intent requires exactly one
destination and can retain the intended final facing. Point routes use loaded
geometry, approach planning, temporal body-clearance checks, moving-obstacle
constraints, and the same bounded retry/hold behavior as object routes. Prior
travel, rotation, and actor scale are applied once. A coordinate goal remains
fixed when blocked; the planner does not silently move it to a nearby location.

The assistant edit boundary records this intent for new or changed coordinate
routes, including imported routes, and converts forward studio Walk/Run travel
to a private editable route. It also records intent when the AI changes an
existing route's gait or pace. Source asset/animation identity, clip IDs, and the
selected pace remain intact. Static gestures, props, and untouched manual routes
do not acquire navigation intent. Manual path edits, including dialogue-path
edits, release the old automatic goal so replanning cannot restore the previous
path over the creator's drawing. Intent persists while collision detection is
off and is available again when it is enabled.

Assistant edits now await navigation preparation before subsequent plan steps
run. Assistant-directed dialogue actions use the same boundary, allowing a later
action or line to start from the resolved endpoint and clock. A failed preparation
stops later plan execution while retaining the saved, recoverable route. The
assistant instructions explain point-goal replanning and require separate route
actions for mandatory intermediate stops; intermediate control points may change
during a detour.

The real-app fixture in `point-navigation-ui` directs Party Woman along a
six-metre imported Walk route, then animates a crate across it. The route's four
seconds increase to 6.342168 seconds for the longer detour. The measured source
clock rate remains 0.9823797084 before and after; the original four-second timing
was explicit fixture input, not a measured-native-duration claim. Moving the
crate onto the actor's start subsequently produces the blocked-route hold. The
actual production package is exported through the UI with project writes,
assistant responses, and export uploads intercepted. No real project or paid
model request is used.

`package-roundtrip.json` compares the freshly parsed GLB against playback over
486 samples, including the full 12-second scene and reverse seeks. It checks 101
bones, 25 skin vertices, and the moving prop root. Maximum bone error is 0.285793
mm, surface error 0.285686 mm, prop error 0.061714 mm, and rotation error 0.000576
radians. Detected overlaps and non-finite results are zero. A fresh model load
rechecks the saved point route in 2.233 seconds and leaves its scene data unchanged
(`reopen-probe.json`). Approach, detour, and arrival renders were inspected. This
fixture verifies navigation/export behavior with the stylized bundled gait; it
does not establish natural human-motion acceptance or a continuous collision
guarantee.

All 787 tests in 78 files pass. Regressions cover coordinate persistence and
validation, imported gait/pace retention, static and moving obstructions, blocked
goals, collision disabling, repeated preparation, prior travel/facing at different
scales, manual path ownership, and asynchronous assistant-step ordering.
TypeScript, the isolated build at
`/tmp/scene-animation-review/point-navigation-build`, and `git diff --check` pass.
Production `dist/` is unchanged.

The autonomous cast handoff was still open at this checkpoint and is addressed
in the next section. Retiming already scheduled dialogue after later obstacle
edits remains open.
Arbitrary standalone imported travel, backward movement, blocked closed-loop
detours, and natural turn/arrival choreography require further work. These gaps
remain part of the original app-wide goal; the new point-route checks do not
establish all-provider or all-movement completion.

## Autonomous cast turns wait for resolved movement

The app now requests one cast turn at a time. Before the first request and after
accepting each generated turn, it waits for the current assets and automatic
navigation to finish and saves the resolved scene. The next speaker receives
that scene, including detour duration and route geometry. New or changed
AI-authored routes use the same provider-independent movement boundary as
assistant edits. The server's optional `singleTurn` mode retains full-cast model
preflight and rotates from the previous speaker; the existing batch API remains
available to other callers.

A blocked route or failed save stops later model requests. A completed turn is
retained when a later step fails or the creator stops the conversation. Scene
edits made while a model responds are still protected by the strict scene merge.
The client checks capacity for the entire requested conversation before issuing
a model request. During an active conversation, navigation preparation pauses
playback and resumes it after preparation if it had been playing. Explicit
transport changes clear that pending resume; stopping the conversation aborts
the active request.

`conversation-navigation-ui` contains an isolated real-app test with two loaded
Party Woman instances and the imported bundled Walk route. The first character
walks six metres around a static crate. Replanning changes its four-second clip
to 4.840359616 seconds without changing the selected gait. The second request
contains the resolved first turn; the second caption starts at 4.840359616 and
ends at 8.840359616 seconds. The UI resumes playback after the second turn's
preparation. A subsequent request is deliberately held and stopped through the
actual Stop conversation control: both completed lines remain, the active
request receives abort, and no following request is sent. Project saves, model
responses, and export uploads are intercepted; no real project or paid model
request is used. Voice playback remains off for this test.

The production package was exported through the UI (37,982,879 bytes), and its
captions reproduce the resolved timing. A freshly parsed GLB was compared with
playback, including the conversation pose layer, at 263 times across the full
12-second scene. Samples include times between base bake keys, both dialogue
boundaries, the hold after the second line, and reverse seeks. Across 202 bones
and 25 sampled vertices on each character, maximum bone error is 0.227599 mm,
surface error 0.230558 mm, and rotation error 0.000514284 radians. The static prop
root error, detected overlaps, and non-finite result count are zero. The harness
matches raw GLTF node names within each character, because GLTFLoader renames
duplicate display names across instances. Comparison stops at the scene's actual
12-second export/playback boundary; an earlier harness sample at 12.5 seconds
incorrectly compared continuing procedural conversation motion with a clamped
export. This is finite sampled evidence, not a continuous collision or export
error guarantee.

The UI, detour, arrival, and second-speaker renders were inspected. The bundled
gait remains visibly stylized, and the arrival still ends in an unfinished
stride before the conversation turn. These renders do not satisfy the human
motion acceptance requirement. The two instances exercise shared imported
assets and the cast handoff; they do not add new provider coverage. Previously
scheduled dialogue retiming after later obstacle edits, backward/standalone
imported travel, closed-loop detours, and natural turn/arrival choreography remain
open.

All 795 tests in 79 files pass (`vitest run --maxWorkers=2`). New coverage checks
waiting for both geometry and save, actual geometry detours reaching the next
turn, cancellation, blocked-route recovery, creator-edit preservation, batch
capacity, single-turn HTTP validation, speaker rotation, and the next model's
resolved timing. TypeScript, the isolated build at
`/tmp/scene-animation-review/conversation-navigation-build`, and
`git diff --check` pass. Production `dist/` is unchanged. The overlapping shared
animation and app files remain in the existing main worktree; this change was
not split into the separate dialogue worktree.

## Destination-aligned captured arrival proposals

The earlier source-phase matcher allocated the route prefix by subtracting a
captured stop's travelled arc length. That is insufficient for a real arrival:
a stopping trajectory may curve, sway, and change facing, so its displacement
is shorter than its arc. In the earlier six-source-metre candidate, the captured
tail travels 0.356338 m but its horizontal endpoint displacement is about
0.282012 m. Appending it to the old prefix cannot certify the requested endpoint.

`matchCapturedArrival` now optionally obtains the actual approach length for
each captured entry/end pair. `proposeCapturedArrival` uses this to reserve the
native tail's displacement and heading first, plan an approach to its starting
frame with the loaded character footprint, and then match the approach's real
outgoing source phase. It constructs ordinary imported route and source-range
clips, retaining the source identity and measured playback rate. The prefix
keeps its clip ID, and a linked dialogue line includes the new stopping clip.
The proposal validates schema/capacity and checks the approach, captured tail,
and relevant final hold against actual animated geometry. Collision disabling
skips obstacle constraints/checks and is reported in the result. Original scene
data is not mutated. Source and receiver transforms/morph values are restored
after a result or cancellation.

At this checkpoint it was a proposal API; automatic adoption is implemented in
the next section. The proposal itself
removes navigation intent from the shortened prefix because assigning the full
original destination to that prefix would make the existing planner overshoot
once the tail is added. The caller must retain and rebuild the original goal as
one approach/stop dependency before adopting it. At this checkpoint the proposal required the route to be the actor's last action
and refused later scheduled dialogue.
It checks the best matching candidate and rejects a blocked result; trying other
matching candidates or additional detours remains open. Takes with no measured
stop, unmatchable phases, incompatible transfer, and unsupported destinations
are reported without inventing a stop. No provider/asset names select behavior.

Candidate matching now yields between entries and the proposal yields during
clearance checks. The asynchronous browser test cancels after three work batches,
checks restoration of both rigs' local transforms, then verifies that a completed
cooperative result exactly equals the synchronous result. Its 484 work batches
allow 207 timer heartbeats with a largest measured gap of 45.7 ms. This is one
observed workload, not a guaranteed frame-time bound.

Real evidence is in `captured-arrival-planning`. Eighteen cases cover the original
Motion Dummy — Male, Party Woman, and Sage — Cartoon, each with a clear approach,
explicit 2× pace, an unmatched distance, static destination obstruction, a moving
crate reaching the arrival, and collision disabling. Actors are placed at
`[2, 0, -1]`, rotated 0.7 radians, and scaled 1.5×. The clear target is 5.8 source
metres adjusted to each receiver's measured size. All clear/rate/off cases
produce a proposal; obstructed/on and unmatched cases reject it. Horizontal
endpoint and final-facing errors are below 1e-12 in the authoring frame. This
means the planned locomotion anchor, not that the visible hips/soles have no
source sway or vertical offset. The input scenes remain unchanged.

The selected source ranges end at 19.216667 seconds and begin at 17.116667 for
the native dummy, 17.2 for Party Woman, and 17.25 for Sage. Their actual approach
geometry differs with receiver proportions, so matching does not assume one
entry suits all rigs. Total native-rate sequences are 19.211779, 19.218144, and
19.226201 seconds respectively. The previous six-source-metre request has no
accepted match after accounting for the real destination geometry; its earlier
source-only match was not proof of a valid destination-aligned arrival.

`destination-aligned.mp4` shows five seconds around the join and standing finish,
with full-body and foot views of all three rigs at native 1×. The corresponding
contact sheet was inspected. The characters finish in the captured standing pose
rather than holding an unfinished stride. Coarse receiver feet and final holds
still need further quality review; a good candidate does not establish every
route length, rig, or provider. The original full-duration source comparison
remains separate evidence.

The Party Woman proposal was opened in the real app and exported as a production
package with writes/uploads intercepted. Its source start remains 17.2 and its
playback rate remains 1×. The 33,289,871-byte package's parsed GLB was compared
with playback at 587 times across the sequence, close to the join/end, and with
reverse seeks. Across 101 bones and 25 skin points, maximum bone error is
0.240805 mm, surface error 0.229647 mm, and rotation error 0.000650990 radians;
non-finite results are zero. These are finite sampled errors. The final
cooperative implementation reproduces all 18 proposal results used for the
renders and export.

All 801 tests in 79 files pass (`vitest run --maxWorkers=2`). New matching tests
cover geometry-supplied approach length, invalid/unavailable approaches, and
source-pose restoration on cancellation. TypeScript, the isolated build at
`/tmp/scene-animation-review/captured-arrival-build`, and `git diff --check` pass.
Production `dist/` is unchanged. Persistent automatic arrival/replanning,
already-scheduled dialogue dependencies, unmatched gait/stop coverage, and
natural turning remain open parts of the full animation goal.

## Persistent automatic captured arrivals

Automatic navigation now adopts a compatible captured stop for a terminal
imported AI route when collision handling is enabled. The prefix's saved
`navigation.arrival` retains the full route's motion ID and duration, plus the
adjacent stopping clip ID. The ordinary full destination request can therefore
be reconstructed before replanning; the shortened approach is never mistaken
for the entire destination. The original source identity, measured clock, point
or object intent, and clip IDs survive regeneration. The full route remains in
the scene's motion data for that purpose. Schema validation rejects missing,
nonadjacent, self-referential, and incompatible route/take references.

Already saved point arrivals first verify their accumulated endpoint/facing and
both clips' animated clearance against the current scene. A valid arrival can
be reused when another speaker or gesture is added, avoiding repeated source
candidate searches. A changed/blocked arrival expands to its full request,
replans, and matches a new captured entry. Failed regeneration retains the
editable saved pair and holds before the prefix. Multiple controlled actors are
checked against the final schedule, including complete arrival pairs and
blocked-actor holds. Object destinations retain the same original intent but
currently regenerate instead of using the point-arrival reuse check.

Explicit edits to generated clip timing/range, either generated motion, removal,
or reordering release the automatic pairing. Placement edits, appended actions,
and explicit destination-intent changes retain it. Disabling collisions retains
existing clips/intent without replanning. This integration does not yet create
new automatic captured stops while collision handling is off, or for untouched
manual routes. Those cases remain in the broader natural-motion scope.

`persistent-arrival-ui` verifies actual app behavior with imported Party Woman,
the measured Thoughtful walk take, a second imported character, and a crate.
The intercepted AI turn creates only the full native-paced coordinate route;
the application creates the approach/stop pair itself. The first dialogue line
ends at 19.218143564 seconds, and the next model request receives the pair and
resolved clock. Its next line starts at that time and ends at 23.218143564.
Playback resumes after preparation. Blocking the destination via an assistant
edit holds the actor and preserves both clips; removing the obstruction recovers
the identical pair and timing. Project/model/export writes are intercepted, so
no real project or paid model request is used.

For that app fixture, preparation between the first and second intercepted model
requests took about 15.7 seconds (including first source work); resolving the
second turn took about 7.2 seconds. Cooperative work keeps the interface yielding,
but these durations are still substantial and need optimization. The package
is 76,960,965 bytes. Its parsed GLB, including conversation performance, matches
playback over 261 within-duration times: 202 bones and 25 sampled skin points per
character give maximum bone error 0.259943 mm, surface error 0.240955 mm, rotation
error 0.000525693 radians, and zero non-finite results, detected overlaps, or
static-prop root error. Caption/export timing matches the resolved scene.

A separate five-position obstruction probe removes later dialogue so the arrival
can change its ending time. Four selected best candidates remain blocked and
retain the saved pair; one obstruction placement replans successfully. This is
not an exhaustive search for alternative captured stops. The successful case is
then repeated in the actual app in `persistent-arrival-replan-ui`: an assistant
edit moves a quarter-scale crate to `[5.053442, 0, 1.693812]`. The approach changes,
and the captured source start changes from 17.2 to 17.366667 seconds. The stop's
source end remains 19.216667, its playback rate stays 1×, and both clip identities
and the destination survive. Total route-plus-stop time changes from 19.218144
to 19.222170 seconds. The explicit save step in the verifier waits for resolved
scene persistence; earlier harness assertions had read the autosaved pre-plan
pair before the final save and are retained with `harness-before-final-save`
filenames.

The replanned package is 61,088,773 bytes. At 587 sequence/join/end/reverse samples,
its 101 bones and 25 surface points match playback within 0.226888 mm and
0.225753 mm respectively; maximum rotation error is 0.000628911 radians and
non-finite results are zero. The replanned join/standing contact sheet was
rendered and inspected. This confirms that changing the obstacle can rebuild
both the approach and the stopping source range, not merely restore a previously
blocked route.

At this stage, scheduled later dialogue locked an existing arrival's end time.
A regeneration that changed that boundary held instead of overlapping the next
speaker. The later dependency-retiming work below removes that restriction.
The integrated conversation renders also expose an existing post-arrival issue:
the conversation layer rotates a stationary character toward the other speaker
without stepping. That standing turn can move planted feet and does not satisfy
human-motion acceptance. Captured-stop coverage remains narrow, other compatible
entries are not yet tried after the best candidate is blocked, and some routes
still have no acceptable captured stop. No all-provider or all-movement completion
claim follows from these checks.

All 815 tests in 80 files pass (`vitest run --maxWorkers=2`). New lifecycle tests
cover persisted destination/clock reconstruction, manual ownership, placement
and intent edits, removed/reordered stops, malformed pairs, invisible actors,
failed regeneration recovery, retained-pair reuse, and explicit collision
disabling. TypeScript, the isolated build at
`/tmp/scene-animation-review/persistent-arrival-build`, and `git diff --check`
pass. Production `dist/` is unchanged.

## Conversation preserves captured performances and planted lower bodies

The conversation overlay no longer rotates an actor's root toward a speaker.
That rotation moved planted feet without a stepping action after an imported
arrival. Imported and custom performances now own their sampled pose, including
imported routes and the terminal frame when the actor's ending is `hold`.
Dialogue does not add synthetic nods, arm emphasis, or torso motion over them.
An explicit later action can still replace the held performance normally.

Procedural conversation actions retain bounded upper-body attention. Head,
spine, and arm adjustments use the rig's calibrated anatomical orientation,
not the provider's local bone axes. World-space attention accounts for existing
head orientation instead of stacking the full look angle over it. The root,
hips, legs, and feet are not turned by this overlay. Supported detached hand
attachments follow their current offsets and rotations with the articulated
joint, without returning to bind pose. Uncalibrated imported anatomy does not
receive guessed joint adjustments.

`conversation-pose-ownership` contains the new actual-app fixture, saved scenes,
production package, parsed-export checks, cross-rig measurements, runner scripts,
and a five-second `before-after-arrival.mp4` with full-body and foot views.
The comparison uses the previous and new actual exported scenes at the same
native pace and scene times. The rendered frames show the previous root spin
and the preserved captured stance. This removes an invalid turn; it does not
supply the natural stepped turn still needed to face a partner behind the actor.

The app again generated the captured approach/stop pair, prepared the next
speaker after its resolved end, resumed playback, retained the pair when a crate
blocked the destination, and recovered it after the crate moved away. The new
package is 76,834,191 bytes. Parsed GLB checks over 261 times, 202 bones, and 25
sampled surface vertices per character give maximum bone error 0.259943 mm,
surface error 0.240955 mm, and rotation error 0.000525693 radians. No non-finite
results, detected overlaps, or static-prop root errors occurred. Separately,
96 samples through the actual Party Woman imported route, stopping clip, and
hold show zero overlay-induced change in bone position/quaternion components,
sampled skin points, or sole centers. Sole centers remain unchanged throughout
the held arrival while the next speaker talks.

The cross-rig check covers all 14 currently imported character assets: Sage Real
and Cartoon, Party Woman and Man, Toon Goon, both motion dummies, the available
Cleo/Rook/Cass variants, and both Rowan imports. Each receives procedural talk,
the full native-duration Stand and talk take, and a route using Thoughtful walk.
All 42 cases preserve the measured lower body for procedural attention and the
entire sampled hierarchy/morphs for imported performances, with zero differences,
no non-finite results, and reproducible reverse seeking. This is representative
coverage of the available assets, not proof for dozens of future providers.

All 819 tests in 80 files pass (`vitest run --maxWorkers=2`), including imported
route/hold ownership, stationary lower-body invariance, rolled-bone anatomical
adjustments, and detached-hand offsets. TypeScript, the isolated build at
`/tmp/scene-animation-review/conversation-ownership-build`, and `git diff --check`
pass. Production `dist/` remains unchanged. At this stage, natural stepped turns,
smoother attention changes, dependency-based dialogue retiming, broader captured
stop selection, and the remaining provider/gait coverage were still open.

## Retiming existing dialogue after navigation changes

`shared/dialogueSchedule.ts` derives dependencies from the saved clip-linked
performances and unspoken actions that preceded each dialogue line. When a route
or captured arrival changes duration, later dialogue follows those resolved
boundaries. The gap after the formerly latest predecessor is preserved; all
other predecessors must also have finished, including a formerly shorter parallel
performance that now ends later. Existing overlapping speech is not serialized.
Only contiguous, unspoken `idle` padding immediately before a line can shrink,
grow, disappear, or split. Imported source ranges/rates, spoken actions, and
non-idle choreography remain unchanged. A preceding non-idle action can constrain
the earliest feasible start, which then propagates to the following speakers.

The same retiming runs for ordinary navigation candidates, expansion of a saved
arrival to its full route, installation of the new stopping segment, and recovery
of the old pair after failed regeneration. This prevents temporary full-route
clocks from becoming spurious gaps in later dialogue. Captured proposals include
their new tail in unspoken dependency boundaries as well. Temporal clearance and
interaction validation use the retimed candidate before adoption. Explicit
`scheduledEnd` constraints remain available to callers, but existing later
dialogue no longer creates an implicit fixed-end constraint.

This works with already saved scenes, without needing new metadata from a future
conversation generation. It is applied during navigation changes; it does not
yet make every manual timeline edit a dependency-aware editing operation. The
existing 0.2-second minimum clip length also applies to a newly required tiny
wait when there was no adjustable padding. Sequence-capacity errors fail the
candidate instead of stretching an action. Repeated preparation of the same
resolved scene is stable.

Two actual-app checks use intercepted project/assistant/export requests:

- `dialogue-retiming-ui` opens the saved two-speaker Party Woman conversation and
  moves the quarter-scale crate into the captured approach. The route and stop
  replan together; the source entry changes from 17.2 to 17.366667 seconds while
  remaining at 1×. The arrival end moves from 19.218143564 to 19.222170445 seconds.
  The already-scheduled second line moves to exactly that boundary and retains
  its four-second speaking action. The package is 76,765,131 bytes. Over 261
  sampled times, its parsed GLB matches 202 bones within 0.223371 mm and 25
  surface points per character within 0.223599 mm; rotation error is at most
  0.000569374 radians. Detected overlaps and non-finite results are zero.
- `dialogue-detour-ui` starts with a complete two-speaker conversation and an
  ordinary route using the bundled imported Walk gait on Party Woman. Moving
  the crate into the aisle extends the first performance from 4 to 4.840359616
  seconds. The second line shifts from 4–8 to 4.840359616–8.840359616 seconds.
  Measured source-seconds per scene-second remain 0.9823797083936407 before and
  after the detour. The package is 37,924,754 bytes. Its 12-second export matches
  202 bones within 0.227599 mm and sampled skin within 0.230558 mm; maximum
  rotation error is 0.000514284 radians, with no overlaps/non-finite results.

Both packages' SRT files carry the resolved boundaries. The rendered detour and
arrival frames were inspected; the prior captured-pose ownership checks still
measure zero imported overlay changes and zero held-sole drift. The evidence
folders include initial/replanned scenes, app screenshots, packages, GLBs,
subtitles, round-trip measurements, and runner scripts.

All 830 tests in 81 files pass (`vitest run --maxWorkers=2`). Added cases cover
longer/shorter schedules, alternating speakers, deliberate gaps, existing
parallel speech, changed unspoken travel, non-idle constraints, long waits,
capacity failures, a geometry detour, and failed captured-arrival recovery.
TypeScript, the isolated build at
`/tmp/scene-animation-review/dialogue-retiming-build`, and `git diff --check`
pass. Production `dist/` remains unchanged.

## Evidence for the next turning work

`captured-turns/source-frames.json` measures all five standalone imported takes
currently in the private library at 60 Hz, retaining pelvis heading, hip travel,
sole centers, and ground-relative sole heights. The measurement uses transforms
and geometry, not a motion's name, to assess contact. The available Rowan
“Turn and greet” rotates about 90 degrees but has no supported foot in any of
its 121 samples above 0.4 rad/s, under the same conservative height/speed criteria
used by the probe. It also translates the hips at roughly 0.992 m/s. It therefore
has not demonstrated a natural planted stepping turn suitable for automatically
turning a standing actor.

The real Thoughtful walk contains supported turns, including a roughly
101-degree change between settled intervals, but that interval lasts about
8.7 seconds and has roughly 2.88 metres of net hip displacement. Its other large
turn interval also travels substantially. Stand and talk and Relax mostly show
small torso/weight shifts. The downloaded ActorCore archives were inventoried
read-only and contain these same three source motions, not an additional pivot
capture. These findings do not blame ActorCore for the app's animation losses;
they establish that a short stationary turn cannot be assumed from the current
library labels. Selecting/adapting an actual stepping movement with contact,
space, pose matching, and timeline integration remains required. The new timing
work supplies one prerequisite, not a completed turn solution. Broader source
coverage, alternative captured stops when the best candidate is blocked, smooth
attention, and arbitrary-route naturalness remain open.

## Compatible captured-stop alternatives and blocked point recovery

The shared captured-arrival matcher now returns every candidate that passes the
existing pose, velocity, scale, morph, speed, and common-foot-support gates.
Candidates are ordered deterministically by score and source times. A blocked
best candidate no longer ends the search: each alternative gets a fresh approach,
unchanged source playback rate, dependency retiming, and full animated clearance
checks for both the approach and the captured stop. Rejected candidates do not
leak generated motions, clips, or sampled object poses into the saved scene.
Cancellation also restores the sampled transforms and morphs.

After all compatible entries fail, the planner can widen the approach using the
measured body radius and moving-obstacle conflicts, up to eight passes. Every
changed path is matched again against its actual length and gait phase. No pose
quality gate is relaxed to route around an obstacle. Rejection-only clearance
scans stop at their first conflict; successful candidates still require the
complete scan. Explicit fixed-end requests remain hard constraints, and later
candidates can be tried if the best one has the wrong end time.

An actual-app check exposed a second gate: the ordinary walking endpoint could
be rejected before the clear captured stance was considered. Point destinations
now permit the independent captured-approach/stop search after an ordinary-route
failure. The proposal uses the current point and heading intent while retaining
the original route's clock to calculate pace. Only a fully cleared proposal
removes that clip's blocked-route issue. Earlier blocked actions still prevent
planning beyond an unreachable position. Failed object destinations still do
not use a potentially stale endpoint; recovering them through an independently
resolved captured destination remains open.

Private evidence is in `alternative-arrivals` and `alternative-arrival-ui` under
`.data/coding/7980a735-0125-4a7f-9612-eef0a5596862/animation-verification/`.
The latter retains the original app failure and the subsequent successful
assistant edit, saved scene, package, and verification scripts. In the real
Party Woman / Thoughtful walk fixture, a quarter-scale crate near the arrival
rejects the first two compatible entries. The third entry, source time
17.183333333–19.216666667 seconds, clears the approach and stop at native 1×.
The original entry was 17.2 seconds. The app retains the saved approach/stop IDs,
changes the approach, and moves the second speaker's four-second action to the
new arrival boundary, 19.232547691 seconds. The exported production package is
76,881,443 bytes. These decisions use source motion and loaded geometry, with
no provider-name branch.

This is improved coverage, not complete navigation or natural-motion acceptance.
The wider-approach probe still rejects four of five midpoint crate placements:
10–16 initially compatible entries fail clearance, and the wider paths provide
no admissible phase match. Those rejected searches take roughly 40–49 seconds
in the current browser fixture, though work yields cooperatively. They remain
explicit regression evidence, not successful routes. Arbitrary path lengths,
short stepping turns, broader provider coverage, and all AI movement forms
remain open.

All 840 tests in 82 files pass (`vitest run --maxWorkers=2`). New regression cases
cover alternative selection, wider-path rematching, all-blocked recovery,
cancellation, explicit collision disabling, fixed-end constraints, current
point intent, stale object destinations, and unreachable predecessors.
TypeScript, `git diff --check`, and the isolated build at
`/tmp/scene-animation-review/alternative-arrival-final-build` pass. Production
`dist/` remains unchanged.

The parsed package was compared at 261 times against the app evaluation: 202
bones differ by at most 0.234188 mm, sampled skin by 0.218664 mm, and rotations by
0.000520755 radians. No overlaps or non-finite results were detected in this
fixture. Conversation overlay changes and held-sole drift remain zero. SRT
boundaries agree with the retimed dialogue. The five-second
`alternative-arrival-ui/alternative-arrival.mp4` shows the approach-to-stop join
at native speed with an overview and a ground-contact close-up. Join and settled
frames were visually inspected. This sample documents the repaired case; it is
not acceptance of every provider, route, or turning behavior.

## Captured arrivals at current object destinations

Object destinations now share a geometry-derived stopping-position search
between ordinary walking and captured-arrival planning. An ordinary route
failure no longer prevents searching for a captured stance at another reachable
side of the current target. The search never adopts a moved object's stale saved
endpoint. It checks target visibility, loaded geometry, motion, prop reach,
interaction availability, source pose/velocity compatibility, and full approach
and stopping clearance. Small-prop reach is checked from the captured terminal
stance as well as the neutral candidate pose. Earlier unreachable actions still
prevent later arrival planning.

The measured clearance is retained in the existing navigation metadata. Saved
object arrivals can be reused only after matching their actual endpoint and
heading against the current target geometry and rechecking the complete animated
approach, stopping motion, and interaction availability. A moved target or an
obstructed saved pair triggers regeneration. Point intent and object intent use
the same source timing and geometry code; no provider identity selects behavior.

The real fixture exposed an expensive rejection pattern: many captured entries
collide at their terminal stance, but formerly scanned the whole approach first.
Candidate validation now checks the stop before the approach, and can inspect
isolated terminal poses before the full scan. These probes only reject; they
cannot accept a candidate. They never interpolate between separated probe times
or from a probe back to the beginning of the normal scan. Every candidate that
passes them still receives the full 60 Hz/interpolated clearance evaluation.
Tests cover terminal rejection, a middle-of-route collision despite clear
endpoints, and a clear curved detour that a false end-to-start sweep would reject.

Private `object-arrivals/aligned-object-probe.json` records a Party Woman /
Thoughtful walk case whose original stopping stance is obstructed by the target
crate. Searching other sides and wider clearance succeeds after 26 candidates,
at native speed, in 171.1 seconds on the verification browser. The terminal-probe
version (`aligned-object-fast-probe.json`) succeeds after 26 candidates in 61.9
seconds, at source entry 17.116666667 and arrival end 19.222914342 seconds. Because
an early rejection measures a partial body envelope, it can find a different
valid wider route; the accepted approach and stop still pass the complete scan.
These timings establish that the search remains too expensive in difficult
cases, even with cooperative yielding. This is a navigation improvement, not
proof of arbitrary-route coverage or human-perfect motion.

The actual app check (`object-arrival-ui`) moves the crate and changes the saved
point intent to an object destination. It resolves the route and captured stop,
retains their IDs, keeps native 1× playback (within floating-point error), and
moves the second speaker to 19.234965705 seconds. It retains an actor-local
clearance of 0.8. Reopening/repreparing the saved scene reuses the same clips and
route after checking geometry, rather than repeating candidate search.

That package check also exposed a separate live-animation defect: head and torso
motion in the procedural conversation overlay reset phase when an actor began
or finished speaking. A Float32 export boundary could interpolate across that
real pose snap, producing up to 1.909486 mm bone / 1.942712 mm sampled-skin error
at exact dialogue boundaries, even though intervening samples were within the
existing tolerance. The failure is retained in `object-arrival-ui`.

The correction keeps the listening rhythm on one absolute clock and blends
speaking nods in and out with the existing speech envelope. The torso sway no
longer restarts on each turn. Imported/custom performances still bypass these
synthetic overlays. A regression compares additive head, spine, and forearm
orientations just before, at, and after both line boundaries and checks reverse
sampling determinism. This fixes the observed live snap rather than loosening
export tolerance or modifying source playback speed. Multi-person attention
changes and genuinely stepped whole-body turns remain separate open work.

The corrected actual-app export is retained separately in
`object-arrival-ui-final`, including the reopened saved scene, unchanged clips,
76,794,968-byte package, parsed GLB, subtitles, verification scripts, and the
five-second `object-arrival.mp4` overview/ground-contact sample. At 261 sample
times, including the previously failing exact boundaries, the GLB matches 202
bones within 0.262521 mm and sampled skin within 0.217572 mm; maximum rotation
error is 0.000541266 radians. There are no detected overlaps/non-finite results,
no imported overlay changes, and no held-sole drift in this fixture. The
independent saved-route check retains scene identity with no navigation issues
and takes approximately 10.4 seconds for the full animated geometry survey.

The pre-optimization smaller-object probes also completed successfully: the two
moved-target cases required 76/74 candidates and approximately 352/333 seconds.
Their full results remain in `object-arrivals/object-probe.json`; they establish
additional coverage and a serious search-cost limitation, not acceptable
interactive latency. Only the larger-target fixture has been remeasured with
the terminal rejection optimization in this turn.

All 847 tests in 82 files pass, as do TypeScript, `git diff --check`, and the
isolated build at `/tmp/scene-animation-review/object-arrival-final-build`.
Production `dist/` remains unchanged. Broader provider and path coverage,
three-or-more-person attention transitions, actual stepping turns, search cost,
and unsolved arbitrary-route cases remain open.

## Arrival-search profiling without changing accepted motion

A Chrome CPU profile of the larger object-arrival case attributes approximately
45.0 of its 61.2 seconds to approach-curve construction/checking. Most of that
cost is repeated `compilePath` work and temporary-array coordinate conversions,
not the body-clearance gate. Different obstacle margins often produce exactly
the same candidate guide points, but previously each duplicate was compiled and
checked again.

`routeWithApproaches` now evaluates each distinct candidate curve once per
search, preserving the existing candidate order, curvature ranking, and length
tie-break. Shared point transforms, interpolation, and distance calculations
avoid intermediate arrays while retaining the same arithmetic. Curve sampling,
pose/velocity/morph compatibility gates, native cadence, collision sampling, and
candidate coverage are unchanged.

The profiled real case decreases from 61.151 to 21.497 seconds and produces an
identical saved scene, all identical candidate attempts/scores, and the same
admissible-candidate count. Approach planning accounts for about 8.5 seconds in
the new profile; full clearance remains about 6.6 seconds. The independent
162-case corpus covers three scales, three headings, differing obstacle counts,
target positions, and approach lengths. Every resulting path, length, and error
matches exactly; the corpus run decreases from 1.104 to 0.539 seconds. These are
measurements from the local verification environment, not latency guarantees.

Private evidence is in `arrival-search-profile`, including both CPU profiles,
before/after source snapshots for the two changed helpers, route-corpus inputs
and results, real-scene results, and runner scripts. The actual app check in
`arrival-search-ui` completes its assistant edit/save in 33.888 seconds and
asserts that its entities, motions, transcript, and collision setting exactly
match the previously verified `object-arrival-ui-final` result. This remains
slower than an acceptable immediate editing response; the change removes
redundant work without weakening animation or obstacle checks.

Two controlled smaller-target comparisons use the same terminal-checking code
on both sides of this optimization: 75.111 → 26.896 seconds and 66.865 → 19.891
seconds. Both preserve their complete saved scenes, every candidate attempt,
and admissible-candidate counts exactly. Their longer 352/333-second historical
runs also predated terminal rejection and should not be attributed solely to
this curve optimization.

The 76,794,881-byte actual-app package passes the unchanged 261-time comparison:
202 bones remain within 0.262521 mm, sampled skin within 0.217572 mm, and rotation
within 0.000541266 radians. Overlaps, non-finite samples, imported overlay changes,
and held-sole drift are zero in this fixture. Rechecking its saved arrival retains
scene identity with no issues (approximately 6.0 seconds in this run). The parsed
arrival render was inspected. All 847 tests in 82 files, TypeScript, the isolated
`/tmp/scene-animation-review/arrival-search-build`, and `git diff --check` pass.
Production `dist/` is unchanged. This performance evidence does not resolve the
remaining provider coverage, route-phase coverage, or natural-turn requirements.

## Splayed-leg bind calibration: a defect exposed by another motion provider

Two original CMU subject 69 turns (69_16 and 69_18) exposed a shared retargeting
defect. The source skeleton's bind legs splay outward. A captured near-parallel
stance was transferred into crossed legs on Party Woman: the solver compensated
for arm A/T poses but treated the original leg bind stance as anatomical neutral.
This was an application error, not evidence of poor source animation.

`configureImportedRig` now temporarily aligns both thigh and shin segments with
anatomical down when capturing neutral frames. It measures limb endpoints from
the configured joint/contact geometry. Detached weighted hand/foot controls
follow their anatomical anchors during that calibration, just as they do during
procedural posing. Original bind transforms, inverse skin matrices, native take
samples, explicit playback rates, and planar root travel remain intact. No
provider name or clip name selects this correction.

The new regression transfers a captured straight stance and turn from a splayed,
bent-leg bind rig to a receiver with different bone axes. It failed before the
fix with a 0.348 direction-vector error and now passes at all checked times,
including reverse seeks. Existing detached-foot transfer tests caught and drove
the anchor calibration correction. Rejected/no-stride route tests compare to
the calibrated neutral stance; their legs still remain static rather than
silently receiving procedural walking.

### Independent source and rendered evidence

Private evidence directories:

- `animation-verification/cmu-turns`: original ASF/AMC data, original AVI
  previews, conversion script, hashes, explicit rig mappings, before frames and
  source/receiver measurements.
- `animation-verification/cmu-turns-after`: after frames, native 1× 18.2-second
  comparison video, source/receiver measurements, existing-source matrix, baked
  GLBs and round-trip measurements, test/build logs, and current rig source.
- `animation-verification/leg-neutral-ui`: actual assistant edit/save, automatic
  obstacle replanning, retimed dialogue, production package, parsed GLB checks
  and rendered scene evidence.

The fixtures use the [original CMU catalog](https://mocap.cs.cmu.edu/search.php?subjectnumber=69)
and preserve every 120 Hz AMC frame: 1,128 frames / 9.391667 seconds and 1,054
frames / 8.775 seconds. The private converter creates a capsule visualization
and GLB; it does not add ASF/AMC import support to the app. Finger/thumb animation
is excluded because [CMU identifies those channels as uncaptured](https://mocap.cs.cmu.edu/).
Detailed provenance, terms, attribution, conversion conventions and limitations
are in `cmu-turns/PROVENANCE.md`. These fixtures were not added to the user's
library or bundled into the product.

On Party Woman, measured thigh/shin directions, after removing the source's
initial heading, improved from a mean **21.505316°** error (maximum **22.118770°**)
to a maximum below **0.000002°**, across every frame of both takes. Original source
frame measurements were identical before and after. Before/after images visibly
show the crossed-leg artifact removed. Four source channels without matching
target joints remain explicitly reported as unsupported; this result does not
claim their preservation or full perceptual fidelity.

A separate matrix sampled **23 existing clips × 37 times × 3 receiver models**
(Party Woman, Party Man, Toon Goon), including the bundled action source, both
original motion dummies, and imported Rowan sources. Native local position,
rotation and scale samples were exactly identical before/after. Transferred
planar root travel was unchanged. Maximum thigh direction error fell from
**9.095821°** to below **0.000006°**. This measures anatomical direction transfer,
not planted-sole drift, self-collision, or universal source compatibility.

Both CMU turns were baked through the app's source-key/adaptive bake and snapshot
export pipeline at 1×, with an additional 0.5-second hold. Parsed GLBs were checked
at 247 times each, including inter-key times, hold boundaries and reverse seeks,
across 101 bones and sampled skin vertices. Maximum preview/export errors were
**0.241843 mm bone / 0.241840 mm skin** and **0.190548 mm / 0.190524 mm**;
no nonfinite poses occurred. The exports retain their full source timing.

The real obstacle-route UI regression also passed with the updated calibration:
planning took **38.188 seconds**, selected source entry **17.383333 seconds** at
native 1×, and kept the next speaker exactly at the new **19.222476-second**
arrival. The production package was **77,406,454 bytes**. Reopening its GLB and
sampling 202 bones/two meshes found maximum **0.225774 mm bone / 0.184129 mm skin**
error, no measured obstacle overlaps or nonfinite poses, and zero dialogue-overlay
or held-sole change. The saved route was reused with current geometry checks.

All **848 tests in 82 files**, TypeScript checking, isolated production build
(`/tmp/scene-animation-review/leg-neutral-build`), and diff whitespace checks
passed. The production `dist/` output was not replaced.

Natural automatic stepping turns remain unfinished. Preliminary source screening
now finds settled intervals separating roughly 93° and 97° turns over 1.625 and
1.542 seconds in 69_16. They also move the hips about 0.218 m and 0.172 m, so they
cannot be treated as rotation about a fixed root. Capsule-based support screening
is provisional; turn selection, entry/exit matching, actual receiver sole contact,
collision-safe placement and rendered verification still need implementation.
Broader provider/path coverage and the other open acceptance requirements remain.

## Captured turn evidence and native-world transition contacts

The shared locomotion measurement now records candidate stepping-turn intervals
from original hip heading/position, sole heights and foot movement. It uses raw
samples before route smoothing or virtual in-place gait travel. A candidate
requires settled grounded endpoints, meaningful heading change, an actual lifted
and repositioned foot, sustained support, limited root travel, and limited
direction reversal. It preserves source timestamps and records hip displacement
in the entry-facing frame. It does not generate rotations, warp a turn to an
angle, discard its translation, or change the source clock.

`src/capturedTurns.ts` found four candidate intervals in the original 69_16
fixture: approximately 93°, 97°, 182°, and 85°, with durations around 2.065,
1.965, 3.863, and 1.832 seconds. The second fixture did not meet the current
criteria. The existing 23-clip matrix produced no turn candidates, including
ordinary walking, acting poses, and the imported “Turn and greet” example. Tests
cover both directions, different source units, wrapped angles, retained root
displacement, irregular samples, and rejection of torso-only twists, ground-level
spins, airborne pauses, travelling corners and unknown ground evidence.

This metadata is a prerequisite for automatic turn selection, not an installed
turn scheduler. Entry/exit matching, receiver contact quality and obstacle-safe
placement are still required. In particular, the source capsule visualization
does not establish target shoe contact or certify every detected candidate.

The investigation also exposed an existing transition defect. A take classified
as in-place could have real stationary-world support, but transition planting
discarded it. Relax and the bundled Idle both had such contacts. Conversely,
walking support reconstructed by adding virtual travel must not be used to plant
a standalone walking take.

Locomotion profiles now retain **nativeContacts** separately from route gait
contacts. Native contacts require low, slow feet and measured sole height near
the source bind floor; an airborne take's relative ankle minimum is insufficient.
Intervals split when ground evidence is lost. Transition anchoring consumes only
these native contacts and still checks actual outgoing receiver support. It
retains explicit speed, source trims, original foot roll, release behavior and
held endings. The same implementation applies to every configured imported rig.

The shipped Quaternius GLB verifies that Walk/Run have virtual route contacts but
no native stationary contacts, while Idle has native support on both feet for its
complete duration. Additional tests reject a stationary hovering take and unknown
ground heights, preserve separate left/right contact intervals, and verify
in-place transition contact selection, late/reverse seeks and releases.

### Real stance-trim and export verification

Two actual sources were evaluated on Party Woman: the imported Relax take and
the bundled Idle. Each sequence plays source seconds 0–1, then blends into source
seconds 2–3.8 at explicit 1× and holds. Measurements compare the visible sole
material point with its outgoing anchor after the blend (timeline 1.25–2.8 s).
The separate source trims intentionally expose the transition offset problem.

| Source | Before maximum planar drift, L / R | After maximum planar drift, L / R |
| ------ | ---------------------------------: | --------------------------------: |
| Relax  |                   8.755 / 3.212 mm |                  2.963 / 0.800 mm |
| Idle   |                 23.019 / 27.276 mm |                  8.807 / 8.849 mm |

These are reductions, not zero-slip certification. The current transition carries
the initial contact offset while retaining the incoming evaluated movement;
receiver stance drift within that movement remains an open problem. The next
contact work must preserve actual source foot motion while removing additional
receiver drift, rather than freezing authored foot rolls or stretching legs.

Both sequences were baked and parsed back through GLB. Across 188 samples each,
including blend/hold boundaries and reverse seeks, maximum preview/export errors
were **0.024687 mm bone / 0.029565 mm sampled skin** for Relax and **0.129356 mm /
0.040029 mm** for Idle. Foot close-ups and a native 1× before/after video are saved
under `animation-verification/native-stance-4432`; the baseline is
`native-stance-4429`. `captured-turn-detection` contains the source measurements,
turn metadata and existing-source matrix. Native and raw transferred pose samples
across all 23 existing clips and three receiver models remained identical.

The previous real obstacle arrival was revalidated against the final code and
its saved production GLB. The route remained reusable, with no measured overlaps,
no nonfinite poses, zero conversation-overlay/held-sole changes, and the same
**0.225774 mm bone / 0.184129 mm skin** export errors. Evidence is in
`animation-verification/native-contact-route-regression`.

All **855 tests in 83 files**, TypeScript checking, isolated build
(`/tmp/scene-animation-review/native-contact-build`), and whitespace checks pass.
Production `dist/` remains unchanged. Automatic stepping-turn placement, residual
stance drift, broad provider/path coverage, and full visual acceptance remain open.

## Retaining captured sole movement across transferred stance joins

Transferred stance joins now follow the measured source sole displacement relative
to the outgoing receiver contact. The mapping accounts for source-trim heading,
receiver scale, scene orientation and explicit playback rate. This removes added
receiver drift while retaining captured foot movement. Same-rig native playback
retains its evaluated foot motion and join offset without source resampling.

The correction keeps the existing reach limit, leg lengths and foot orientation.
Its release follows the last measured source velocity before fading smoothly to
the incoming pose. Extended clip durations stop the contact trajectory at the
source endpoint instead of extrapolating through a hold. Missing source sole
samples retain the existing offset behavior.

The same two real stance-trim sequences were rechecked on Party Woman at 1×:

| Source | Previous maximum planar drift, L / R | Current maximum planar drift, L / R |
| ------ | -----------------------------------: | ----------------------------------: |
| Relax  |                     2.963 / 0.800 mm |                    2.481 / 0.668 mm |
| Idle   |                     8.807 / 8.849 mm |                    0.942 / 0.950 mm |

These measure displacement from the outgoing anchor, not error against a fully
static foot: captured source movement remains intentional. They do not certify
zero slip or general visual quality. Foot close-ups were inspected and the 2.433 s
native-speed sequence was saved. The review floor lacks useful local contact
shadows, limiting what these close-ups establish about apparent grounding.

Both new GLBs were parsed and compared with preview across 188 times each.
Maximum bone / sampled skin errors were **0.024687 / 0.029565 mm** for Relax and
**0.129348 / 0.040029 mm** for Idle. Evidence, measured comparisons, stills and
`stance-trims.mp4` are in `animation-verification/native-stance-4433`.

The existing real obstacle-arrival scene was also rechecked. Its earlier GLB
differs by up to 10.905 mm at the newly corrected contact transition; that old
bake no longer represents the current pose evaluator. A fresh bake and parsed
GLB restore preview agreement: **0.225774 mm bone / 0.184129 mm sampled skin**
maximum error across 202 bones and two meshes, no nonfinite poses or measured
overlaps, and zero dialogue-overlay or held-sole displacement. The saved route
remains reusable without replanning. The new GLB, measurements and scene are in
`animation-verification/sole-trajectory-route-regression`.

Regression tests cover captured displacement, extra receiver drift, continuous
release velocity, heading/scale/speed conversion, extended holds and unchanged
native movement. All **859 tests in 83 files**, TypeScript checking and the
isolated build (`/tmp/scene-animation-review/sole-trajectory-build`) pass.
The collision/navigation requirements remain shared across both worktrees;
automatic turn placement and the documented provider/path coverage gaps remain
open.

## Backward studio movement participates in automatic navigation

AI-authored negative-distance studio Walk/Run actions now acquire the same saved
destination and automatic clearance/replanning behavior as forward movement.
Previously they bypassed `withAutomaticMovement`. A new optional
`path.backward` flag preserves facing opposite travel instead of turning the
actor around to walk forward. The shared path sampler, departure/arrival guides,
procedural step phase, waypoint splitting and route editor retain this direction.
Direct negative-distance studio playback also reverses its step cycle.

This flag is for procedural gaits. Imported paths continue to retain the captured
body-to-travel orientation; applying procedural reversal to an imported take is
rejected with a message to select a captured backward gait. No imported animation
is reversed, replaced or made procedural. The default imported gait selection is
unchanged. Standalone imported root-motion actions still need automatic navigation
coverage; this change does not close that gap.

Tests exercise both Walk and Run with placed rotation and scale, saved/reopened
direction, a newly placed obstacle, a moving crossing obstacle, unreachable goals,
collision-off, constant pace after detours, route reuse, reversed step phase,
waypoint gestures and baked playback. Editor tests verify that reopening, editing
and planning preserve the setting, and that users can explicitly change it.

Two real imported receivers, Party Woman and Party Man, were evaluated with the
explicit studio backward gait. Both automatically detoured around the crate with
no measured animated-body overlaps. A 5 m / 5 s straight route became a
6.186139 m / 6.186139 s detour, retaining 1 m/s and the original destination and
facing. Fresh GLBs were parsed and compared at 187 times including reverse seeks:

| Receiver    | Maximum bone error | Maximum sampled skin error |
| ----------- | -----------------: | -------------------------: |
| Party Woman |        0.237621 mm |                0.238484 mm |
| Party Man   |        0.225150 mm |                0.222002 mm |

Endpoint error was approximately 0.0001 mm from the evaluator's existing final
sample epsilon; final facing error was below 0.000000077 rad. The initial verifier
used a 0.0001 mm endpoint threshold and failed by floating-point rounding. Its
final endpoint tolerance is 0.001 mm; the fresh run passes. Pose/export tolerances
remain 0.3 mm. Measurements, scenes, eight rendered views and the 6.233 s native
speed video are in `animation-verification/backward-navigation`.

The views establish direction and obstacle clearance, not human motion quality.
The explicit studio gait remains visibly procedural and lacks the captured foot
contacts and stepping turns needed for the overall acceptance requirement.
All **866 tests in 84 files**, TypeScript checking and the isolated build
(`/tmp/scene-animation-review/backward-build`) pass. Shared AI guidance now covers
backward studio navigation while retaining the standalone imported-action caveat.

## Measuring scheduled native source intervals before automatic rerouting

Standalone imported movement still needs an automatic-navigation implementation.
The first prerequisite is now available: `measureNativeTravel` measures the
scheduled source interval, rather than substituting a full take beginning at
source second zero. It returns exact source start/end, explicit rate, active
seconds, held seconds, receiver-scaled native displacement and accumulated body
heading. Displacement remains in the actor's entry-facing frame and retains its
vertical component. A hold starting at the source endpoint reports zero travel
and no active gait interval.

`locomotionProfile` can now measure an explicit source window. It samples the
original clip at the exact requested offset, retaining original detail while
measuring trajectory, feet, contacts, stops and turns. Profile times are local
to the interval, with `sourceStart` recording the original take offset. Route
sampling additionally exposes `sourceTime`, and export-boundary calculation
subtracts that offset from original source keys. Short windows retain the full
take's travel classification so a 20 cm travelling segment does not become a
virtual in-place gait. Full-take behavior is unchanged. The interval cache keeps
the full take and at most 16 recent windows per clip.

Native destination measurement uses actual captured root displacement, never the
virtual distance reconstructed from in-place feet. Tests on the shipped Walk
and Run verify that their measurable route stride does not become invented
standalone travel. Further tests cover off-grid trims, 2× playback, receiver
proportions, meter/centimeter source units, source heading, retained vertical
movement, short travelling intervals, final holds, pure holds, original source
key mapping, invalid ranges, pose restoration and cache isolation.

The browser verification evaluated **50 real trim/hold cases**, including the
existing imported sources, bundled actions and both CMU captures, on Party Woman.
Across all cases, measurement changed neither the displayed source/receiver
transforms nor the subsequently evaluated performance (maximum component change
**zero**). Calculated native endpoints matched the actual accumulated playback
endpoint to **2.23e-16 m**, with **zero heading difference**. These are measurement
and preservation checks, not evidence of automatic rerouting or visual perfection.
Results and the verifier are in `animation-verification/native-source-windows`.

The complete suite passes **870 tests in 84 files**. After adding the hold-only
edge case, the affected 27 tests and TypeScript check also pass. The isolated
build is `/tmp/scene-animation-review/native-window-build`; whitespace checks
pass and production `dist/` is unchanged. Wiring source-window playback, safe
continuation/captured arrivals and obstacle replanning into standalone AI-imported
movement remains required; this measurement helper does not silently convert or
block those performances.

## Selected source intervals now drive route playback and export

Imported routes can now retain `path.sourceRange: {start, end}` in original take
seconds. The shared sampler measures that interval, evaluates its actual source
seconds, and keeps contact/loop scheduling in interval-local time. It normalizes
transfer from the selected entry facing, rather than accidentally restarting at
source zero. Source-key bake boundaries use the same offset. Invalid or missing
intervals do not fall back to a procedural gait or silently clamp to another take.

Natural-pace measurement, automatic point/object replanning, captured-arrival
matching, waypoint splitting and path editing preserve the selected interval.
Captured-arrival candidates expose absolute original source timestamps, while
comparison of body pose and velocity stays in the interval's local clock. Saved
route variants remain distinct from their full-take library gait; selecting a
different gait clears the old range. The editor displays the selected interval.

Imported natural duration is no longer rounded to tenths of a second in the path
editor. That rounding changed cadence even after choosing natural pace. The editor
now shows the resulting source playback multiplier, including deliberate duration
changes, so a slower or faster route is visible rather than implied by the slot.
Procedural duration defaults retain their existing behavior.

Regression coverage includes off-grid source starts, native/shared detailed joint
playback, source-key export timing, reverse seeks, and complete pose/contact parity
when the same gait is shifted five seconds into a longer source file. Original
source windows survive point/object obstacle replans at unchanged explicit pace,
captured-arrival timestamps, JSON persistence and waypoint splits. UI checks cover
window selection, edits, switching back to a full gait, exact 1× natural duration
and a displayed 0.5× deliberate speed change.

The real Thoughtful walk interval **6.173–10.373 s** was played at **1×** along a
curved route on both its original motion dummy and Party Woman. Both panes use the
curved route; the left pane is the original receiver, not the untouched source
trajectory. The source interval travels 0.403321 m before receiver scaling and
0.373412 m on Party Woman. The measured source-clock error is **zero**, with no
motion warnings. Each fresh GLB was parsed and compared at 187 timeline samples,
including source/hold boundaries and reverse seeks:

| Receiver              | Maximum bone error | Maximum sampled skin error |
| --------------------- | -----------------: | -------------------------: |
| Original motion dummy |        0.168228 mm |                0.166242 mm |
| Party Woman           |        0.183849 mm |                0.155835 mm |

Six rendered views were saved and inspected. The 4.733 s native-speed video, both
GLBs, exact scene data, verifier and results are in
`animation-verification/source-range-routes`. The views show retained gestures,
facing and detailed hand poses. They do not certify human-quality physical turns;
this short curved route still needs the broader stepping/contact acceptance work.

The complete suite passes **879 tests in 84 files**. The final speed-display and
wording changes also pass the affected 41 UI/timing/editing tests and 27 API/studio
tests, plus TypeScript, isolated build (`/tmp/scene-animation-review/source-range-build`)
and whitespace checks. Production `dist/` is unchanged. Standalone AI-imported
movement still needs conversion/replanning that retains its active interval and
held tail; this change supplies interval-aware route playback rather than claiming
that remaining integration is complete.

## Arrival ownership after route replanning

Object-route planning incorrectly treated an actor's own pickup starting exactly
at arrival as an occupied destination. It also checked the old pickup timestamp
when a replacement route changed duration. The shared planner now checks the
proposed schedule, including dependent dialogue timing, and allows only the
arriving actor's acquisition boundary. An earlier acquisition, another actor's
pickup at the same instant, and existing ownership still block arrival. Captured
arrival creation and retained-arrival validation use the same ownership rule.

Regression checks cover unchanged, shorter and longer approaches followed by
pickup, immutable saved input, another actor's simultaneous pickup, an already
held prop and a completed release. Automatic preparation also verifies that
passing this ownership check does not bypass actual animated-body clearance:
at that checkpoint, the tested cup approach failed body clearance, retained the
editable pickup, and held playback before the blocked route without executing it.
This is a scheduling correction, not evidence of a successful physical pickup
approach or human-quality movement. Such approaches still require contact-safe
arrival placement and rendered acceptance.

The collision and navigation requirements remain shared by the main and dialogue
worktrees, with all imported providers, models and paths in scope. Standalone
AI-imported root-motion navigation, physical stepping turns and broad provider
verification remain open; no additional collision implementation worktree is
needed.

Validation for this ownership correction: 63 tests across navigation, automatic
routes, captured arrivals, retained arrivals and collision settings pass, along
with TypeScript in main and whitespace checks in both worktrees. The isolated build is
`/tmp/scene-animation-review/arrival-ownership-build`; production `dist/` was not
changed. No new rendered fidelity claim is made for this scheduling correction.

## Skin collision regions and continuous pickup/release

The next investigation traced that cup rejection to an overly broad collision
shape: a single skinned body mesh supplied one bounding box, filling the empty
space between limbs. `skinColliderRegions` now groups complete triangles by
their strongest combined skin influence. Every corner of each assigned triangle
contributes to its region's current world bounds, including blended seam
vertices. Skinning and morphs are evaluated once per vertex; transforms, bone
names, provider names and mesh naming conventions do not select behavior.
Topology and skin-attribute edits invalidate the partition cache, including
interleaved-buffer updates. Snapshots retain stable region identities for sweeps.
These remain conservative region AABBs and sampled relative sweeps, not exact
triangle collision or a continuous-time physics guarantee.

The retry loop also now restores a measured obstruction when planning excluded
it as moving because of a later pickup, although the approach-only inspection
correctly sees it as stationary. The original cup approach now clears and keeps
its following pickup. Tests still require actual obstruction rejection; the fix
does not disable collision checks or exempt destination props.

Browser verification loaded 17 available assets, including original motion
dummies, Party Woman/Man, Toon Goon, bundled/custom Quaternius models and the two
Blender fixtures. Across five timeline samples per asset, including a reverse
seek, all **840,870 triangle evaluations** were covered by a complete region;
all **8,765 surface-contact probes** were detected. Collision snapshots changed
no pose values. Assets produced 15–95 collision regions. This is a limited set
of rig families, not validation of dozens of independent providers.

Export verification exposed a separate visible defect: pickup applied a full
crouch at the first instant of reaching, moving the lower body abruptly. The
interaction solver now eases crouch and arm IK influence in during acquisition
and out during release, retaining full grip contact while attached. Analytic IK
now permits exact full extension instead of forcing a small knee/elbow bend
when influence approaches zero. Tests cover tabletop/floor pickups, standalone
sips, full-body boundary continuity, planted feet, grip contact and reverse seeks.
Across the same 17 loaded assets, acquisition/release samples 10 microseconds on
either side of the boundary had maximum joint displacement **0.007474 mm** and
normalized world-rotation difference **0.000025575 rad**, with no interaction
warnings. These boundary checks do not certify the entire choreography as human.

The 12.4-second procedural obstacle-approach/pickup diagnostic now clears its
route and completes pickup without warnings. The earlier discontinuity produced
a 248.5 mm joint mismatch immediately before pickup in the exported interpolation.
After continuous contact entry, the export check also exposed skin amplification
of the existing joint sampling tolerance. Adaptive baking now uses 0.1 mm joint
position and 0.0005 rad rotation tolerances, leaving more room for composed skin
motion. A fresh 1,475,696-byte GLB, parsed and compared at 189 times across 40
nodes, has maximum joint error **0.099996 mm**, sampled skin error **0.199177 mm**,
and cup-position error **0.062316 mm**. This is sampled evidence, not a bound for
every surface point or future rig.

Evidence, exact scenes, fresh GLB, contact/geometry matrices, source snapshots,
verifiers and inspected renders are in `animation-verification/skin-collision-regions`.
The `skin-regions.mp4` diagnostic shows Party Woman playing Thoughtful walk at
native 1× with old whole-mesh and current region bounds over the same pose.
It illustrates collision geometry, not an improvement to the source performance.
Natural stepping turns, general contact fidelity, standalone AI-imported travel
navigation and broader provider/path acceptance remain open.

Validation: **892 tests in 85 files pass**, plus TypeScript, whitespace checks
and an isolated build at
`/tmp/scene-animation-review/skin-collision-contact-final-build`. The coupled
two-actor navigation regression now has an explicit 10-second test timeout: its
full geometry scans took about 4.5 seconds alone and crossed the old 5-second
default while other verification work was running. Its clearance assertions are
unchanged. Production `dist/` remains unchanged, and the dialogue handoff points
to the same shared collision/contact implementation.

## Imported route entry and outgoing body facing

Imported routes now measure the source's initial body-to-travel angle. Route
entry and obstacle-planning departure guides use that angle, including sideways
and backward takes. The path sampler unwraps the entry correction to the nearest
angle branch so crossing ±π does not introduce a full spin. Procedural routes
retain their existing default entry behavior.

At completion, the world sampler carries the evaluated anatomical body heading
into the next action. Previously it accumulated only the route's travel heading,
which could snap a sideways/backward character or a source with a nonzero initial
yaw into a different orientation. Evaluation just inside the route includes its
captured phase and loop correction; cached results also support direct and reverse
seeks through consecutive routes. This uses rig calibration and measured motion,
without provider-name conditions.

Captured-arrival proposals compensate the approach's ending travel frame so its
actual outgoing body still aims the reserved standalone tail at the destination.
Existing saved pairs are revalidated and regenerated when their endpoint no longer
matches. A real Party Woman/Thoughtful walk saved arrival regenerated successfully,
passed animated clearance, and passed the retained-arrival endpoint/facing checks.
Across its join (100 ns before versus exactly at the boundary), maximum world
bone position change was **0.000052 mm** and normalized bone rotation change was
**4.22e-8 rad**. Group placement alone changes at this coordinate-frame handoff;
the evaluated skeleton remains continuous.

Tests compare forward, backward and both sideways source directions against an
independent standalone original take, at a selected interval and explicit 1× rate,
on native and transferred rigs. They check detailed world joint rotations at
entry, interior, completion and the following idle action, plus chained curved
routes and reverse/direct seeks. The full suite passes **903 tests in 85 files**;
TypeScript, an isolated Vite build and `git diff --check` pass. The build is in
`/tmp/scene-animation-review/route-facing-build`; production `dist/` is unchanged.

Real source-window playback (Thoughtful walk, 6.173–10.373 seconds, 1×) was rendered
again on the original dummy and Party Woman along the same curved route. Source
clock error is zero. Fresh GLB round trips at 187 fractional/boundary/reverse
samples have maximum bone/skin errors of **0.061735/0.061766 mm** for the native
rig and **0.062416/0.057167 mm** for the transferred rig. There are no motion
warnings. The end frame was inspected, and the video, frames, GLBs, scenes,
measurements and verifier scripts are archived in `animation-verification/route-facing`.
Both rendered panes follow the route; this is not an untouched-source-trajectory
comparison or universal human-quality acceptance.

The collision/default/toggle/replanning requirements remain shared across the
main and dialogue worktrees and cover every accepted provider, model and path.
Standalone AI imported travel still needs automatic navigation integration;
physical stepping turns, broader provider fixtures and full contact/visual
acceptance remain open. This change addresses route-facing continuity and its
captured-arrival handoff, not those remaining requirements.

## Standalone imported AI travel: shared clearance and measured continuations

AI authoring now persists the original standalone imported performance as
navigation intent before its geometry is available. The saved descriptor keeps
the original motion ID, duration, source start, explicit rate and legacy-rate
notice. Loaded navigation first checks the actual original trajectory. Clear
performances keep their native playback and source timing; virtual in-place
stride is never treated as a native destination. This applies through the shared
AI authoring boundary, including dialogue performances, without provider names.

Blocked level travel can now detour using the selected source interval when its
whole-performance boundary is compatible with repetition. The gate checks body
and extremity positions/rotations, linear/angular velocities, source travel
speed, scale, rigid-mesh transforms, skinned-mesh local transforms and morph
values/velocities, in addition to the measured foot seam and terminal-stop
classification. It is a compatibility gate, **not a natural-gait classifier**:
a source containing a translating T-pose can be compatible while still looking
unnatural. No procedural gait replaces an imported performance.

The planner retains the complete selected interval before any repetition,
uses its explicit source rate, checks static/animated geometry, and preserves
captured entry and ending facing. Arrival guides use travel direction rather
than assuming the body faces forward along the path. The original saved take is
restored when an obstacle moves away. Its generated private route is then removed,
so repeated obstacle edits do not accumulate unused motions.

A routed clip can now retain its scheduled final hold separately as `routeHold`.
The common sampler freezes the complete evaluated endpoint, including contact and
loop corrections, throughout that hold. Source-key baking uses active travel
time, includes the hold boundary, and leaves the held pose unchanged. Path editing
uses active movement time; waypoint splits retain the hold only on the last
movement segment. The timing description shows the retained hold. Ordinary route
replanning also separates that hold from movement speed. Captured-arrival
replacement does not discard a saved hold.

Native root-origin compensation exposed a clearance defect: the imported
container can be far from the visible body. Measured body width now uses the
hips when available, rather than inflating clearance around the container's
source offset. Initial native planning uses the anatomical shoulder envelope;
full animated geometry checks expand it after a rejected candidate. An empty
obstacle set does not need a full timeline skin scan.

Verification:

- The full suite passed **913 tests in 85 files**. The final route-cleanup,
  visible-channel loop checks and arrival-guide refinements then passed the
  **65 affected tests**. TypeScript, an isolated build and diff whitespace checks
  pass. The final build is `/tmp/scene-animation-review/native-navigation-verified-build`;
  production `dist/` is unchanged.
- Real clear-playback checks cover **58 native/transferred trim/hold cases**
  (12 native, 46 transferred) from the available imported and bundled sources,
  at explicit 1.25× speed. They report **zero pose difference**, zero motion
  warnings, zero navigation issues and no replacement of the controlled scene.
- Tests check a real imported hierarchy on original and transferred receivers,
  source clocks at 0.75×/1.6×, retained holds, export boundary placement,
  obstacle removal/reintroduction, incompatible detailed-joint seams, manual
  path/waypoint edits and moving-obstacle crossings. A mid-route crossing
  replans successfully. A temporary obstruction at the destination is detected
  during the hold and safely prevents playback; waiting for it is still open.
- A real Rowan `Original stroll` interval, 1/24–2.041666746 seconds at 1×, detours
  around a small crate on its original rig and Party Woman, retaining a
  0.4-second hold. The rendered source visibly contains sliding in a T-pose;
  this is a routing/export diagnostic, **not human-animation acceptance**.
  New GLBs have maximum sampled bone/skin errors of **0.117484/0.198387 mm**
  (native) and **0.099773/0.096340 mm** (transferred). Endpoint position error is
  below 1e-12 m and final heading error below 1e-12 rad. The diagnostic frame was
  inspected. Scenes, video, renders, GLBs, source-loop surveys, clear-playback
  measurements and verifier scripts are in `animation-verification/native-navigation`.

Remaining required work is explicit. Whole one-off performances such as the full
Thoughtful walk are not blindly repeated. They still need a compatible inserted
continuation that preserves their ending and detailed performance. Nonlevel or
closed-return travel, shorter detours that would omit selected performance,
source-only endpoint holds, natural waiting for temporarily occupied goals,
physical stepping turns and broad provider/contact/visual acceptance remain open.

## Captured continuation search and source-window trajectory context

Interior continuation search now measures source poses and velocities in the
captured travel frame. It considers positive-weight skin bones, rigid render
parts, skinned-mesh transforms and morph channels. Unweighted controls still
contribute through visible descendants; their unused transforms do not reject
otherwise matching geometry. Whole-performance loop inspection uses the same
sampler with its stricter acceptance limits. Source transforms, morphs and mixer
time are restored after inspection or cancellation. No provider name selects
this behavior.

The search retains space for the original prefix and suffix, requires shared
native ground support and travel, and refines promising phases at subframe times.
Its results are **prospective blend candidates, not accepted continuations**.
They are not yet installed by automatic navigation. Receiving-rig closure,
foot-contact continuity, placement and obstacle clearance are still required.

Investigation found that a trimmed source interval recomputed trajectory
smoothing and direction from only the selected frames. The same source timestamp
could therefore acquire a different travel frame. Selected travel now uses the
full authored interval's measured centers, headings and accumulated distance,
with time and distance rebased to the selection. Original pose sampling remains
at the selected timestamps. Leading empty timestamp padding is excluded from
the reference context; shifting all source keys does not change window playback.
New regressions cover curved, fractional selections with and without that padding.

Loop warnings now use the same proportion-relative foot-seam limit as contact
closure, rather than silently allowing any mismatch below twelve centimeters.
The warning still applies only when a take repeats. One-shot source windows keep
their captured performance.

Verification and remaining failures:

- **919 tests in 85 files pass**; the final continuation-refinement constraints
  then passed all **49 imported playback tests**. TypeScript, diff checks and an
  isolated build in `/tmp/scene-animation-review/continuation-context-build` pass.
- Fresh real source-window playback, Thoughtful walk 6.173–10.373 seconds at 1×,
  has zero source-clock error. GLB round trips have maximum bone/skin errors of
  **0.068510/0.067629 mm** on the native rig and **0.092948/0.110765 mm** on Party
  Woman across fractional samples, the endpoint, its hold and reverse seeks.
  The rendered comparison was inspected; video, frames, scenes and GLBs are in
  `animation-verification/captured-continuations/selected-window`.
- The source search found 142 prospective Thoughtful walk matches, but the best
  interval, 28.108333–30.158333 seconds, fails the receiving loop/contact gate.
  The first 60 ranked intervals also fail the two-foot closure prerequisite.
  A corrected before/after-boundary diagnostic measures **53.698 mm / 0.98135
  rad** native and **44.268 mm / 0.49493 rad** transferred maximum joint jumps.
  Both now report the incompatible foot seam. The diagnostic deliberately
  fails its continuity threshold; it is not acceptance evidence.
- An earlier near-zero native seam result compared the frame before a cycle
  with its exact boundary. Floating-point rounding kept both on the same side.
  That result is invalid; diagnostics now compare samples on opposite sides.
  No seamless continuation or full one-off-performance detour is claimed.

The default-on collision setting, explicit toggle, and automatic navigation
requirements remain integration gates in both worktrees for every present and
future provider/model/path importer. Natural captured continuations, waiting,
physical stepping turns and broad provider/contact/visual acceptance remain open.

## Matched captured-window loops: pose, velocity and contact continuity

The raw two-foot seam test rejected all 142 previously found interior windows.
An isolated closure experiment showed that the best window could join its
rendered body closely after a bounded blend. The large remaining all-bone angle
was in an unweighted control root outside that visible skeleton. Verification
now records both control discrepancies and the actual weighted-bone/mesh results;
it does not count an unused control reset as a rendered body jump.

Selected interior travel windows can now use a repeating-only profile after
measuring compatible detailed source poses and velocities, stable proportions,
morph channels, and shared native ground support. A filename/provider cannot
enable it. Original one-shot playback retains the unmodified profile. The
receiver must independently pass its body pose/velocity gate before closure.
This enables a measured captured window on a drawn/replanned route; it does not
yet splice a continuation into an entire one-off performance.

The receiving blend now matches endpoint velocity as well as pose. It measures
the original pose on both sides of each endpoint, works in the moving route
frame, and retains source rate. Rotation velocity compensation accounts for the
endpoint orientation correction; detached controls, local translations, morphs
and transferred foot-clearance constraints use the same join. Large pose or
velocity mismatches remain rejected. Source sampling outside the blend stays
unchanged.

Three constraints previously reintroduced smaller velocity discontinuities
after body closure. Periodic ground support now uses bounded interpolation with
a shared seam tangent. Matched-window travel corrects speed only in intervals
touching a wrap, with zero endpoint displacement, preserving route length,
source duration and final partial-cycle endpoints. Joined stance tracks retain
every captured contact point and use bounded tangents through the seam; source
contact evidence is not mutated. Ordinary unjoined contacts remain unchanged.

Evidence for Thoughtful walk 28.108333–30.158333 seconds, 2.2 cycles on the same
curved route at explicit 1×, on the original dummy and Party Woman:

- Maximum **full-mesh seam displacement** is **0.507145 µm native / 0.194103 µm
  transferred**, sampled just before/after the actual wrap. The maximum measured
  mesh velocity difference across the seam fell to **1.916 / 1.878 mm/s** with
  0.1 ms finite-difference samples. The rendered comparison was inspected.
- Source-clock error is at most **3.56e-15 seconds**; there are no playback
  warnings. The route uses the same full source interval, source cadence and
  captured detail, with the measured repeated-boundary blend.
- Fresh GLB round trips have maximum weighted-bone/mesh errors of
  **0.057672 / 0.088436 mm native** and **0.187276 / 0.058163 mm transferred**.
  Checks include fractional times, both loop boundaries, the endpoint/hold and
  reverse seeks. The native unweighted control root has a separately recorded
  **6.568170 mm** discrepancy at the exact loop boundary; this is not a claim of
  lossless control-channel export. Weighted joints and the rendered surface
  satisfy the comparison threshold.
- The full suite passed **928 tests in 85 files**, followed by the expanded
  loop-velocity checks at 0.75× and 1.6× on ordinary and detached foot controls.
  TypeScript, diff checks and an isolated build in
  `/tmp/scene-animation-review/captured-loop-build` pass. Production `dist/` is
  unchanged. Tests also cover noncommuting rotations, morph/clearance velocity,
  oversized velocity rejection, bounded ground/contact interpolation and exact
  partial endpoints without changing source time.

Video, frames, scenes, GLBs and measurements are in
`animation-verification/captured-continuations/blended-export`; complete-vertex
seam/velocity measurements are in `captured-continuations/blended-loop`.
The raw rejected diagnostics remain archived separately. Successful window
repetition is not full human-animation acceptance: automatic insertion preserving
the original prefix/ending, natural waits/turns and broad provider coverage are
still required. Default-on collision, explicit disabling and automatic obstacle
replanning remain shared requirements for all imported models and paths.
Rejected cases retain the authored data and hold before the blocked action; that
safe fallback does not satisfy successful navigation for all such cases. The
all-provider, all-model and all-path requirements remain unchanged and active.

## Complete captured trajectories on modest detours

The real 34-second Thoughtful walk travels 8.869561 m but finishes only about
37 cm from its start. A shortest path to that endpoint would remove most of its
performance. Native navigation now repairs obstructed portions of the captured
trajectory, retaining its clear excursions and return travel. Planning uses
meaningful source bends, checks every interpolated segment, and validates the
complete animated receiving body before accepting a candidate. Dense source
samples must not force a last-moment right-angle sidestep.

For a complete grounded performance, a saved imported-only `path.strideScale`
allows 90–110% spatial step length while preserving the full selected source
clock, explicit playback rate, ending and separate hold. Body proportions and
source joint channels are not scaled. The step adaptation survives editor
saves, splitting, point/object replanning, gait measurement, captured arrivals
and export. The editor displays its percentage. Larger changes still require
matched continuation insertion; this implementation does not supply that yet.
Clear native takes remain unchanged, and removing an obstacle restores the
original take and removes its private generated route. Small endpoint floor
measurement drift is tolerated; nonlevel performance compatibility is not
established by these level-travel checks.

A new regression exposed a shared planner gap: obstacles below 8 cm could
collide with a foot but were omitted from planning. Loaded low props and backdrop
obstacles now contribute footprints; the level ground surface remains excluded.
This applies across imported and procedural movement, not by provider name.

The first rendered detours passed collision and export comparisons but failed a
separate motion check: instantaneous path tangents turned captured hip sway into
body swivels. Maximum native/receiver body turn speeds reached 58.475/43.660 rad/s
versus 1.346 rad/s in the original capture. Those initial renders in
`captured-continuations/full-trajectory` are rejected as natural-motion evidence.
Complete adapted performances now retain captured facing and apply only the
change in travel direction caused by the detour. Both trajectories are measured
over the same source-time neighborhood; bounded interpolated corrections retain
entry and final facing and remain deterministic under reverse seeks. The same
source/receiver diagnostic now peaks at 2.671 rad/s. This removes the extreme
swivels, but is not proof of physically correct stepping turns or human quality.

Corrected real-asset verification, on the original dummy and Party Woman at 1×:

- Both originally obstructed takes receive clear repaired trajectories. The full
  34-second source interval and 0.4-second terminal hold remain unchanged.
  Spatial step factors are 0.948031 and 0.945028; the resulting route lengths are
  8.408618 m and 7.760413 m, respectively, after receiver proportions.
- Source-clock error is at most 6.40e-13 seconds; playback reports no warnings.
  Final horizontal route endpoint error is zero, and facing matches modulo a
  full revolution. The initial heading diagnostic incorrectly counted equivalent
  orientations separated by 2π; raw differences remain archived separately.
- Fresh GLB round trips have maximum all-bone/mesh sample errors of
  0.188318/0.185919 mm native and 0.164023/0.081914 mm transferred, including
  fractional samples, the endpoint/hold and reverse seeks.
- The full suite passes 951 tests in 87 files. TypeScript and diff checks pass.
  The isolated build is `/tmp/scene-animation-review/full-trajectory-corrected-build`;
  production `dist/` remains unchanged. Regression coverage includes source
  clocks and detailed joints with adapted step lengths, save/split/editor
  persistence, source-window point/object replans, unscaled stopping tails,
  low obstacles, closed-return trajectories and bounded facing corrections.

Corrected scenes, GLBs, inspected rendered frames and video are in
`animation-verification/captured-continuations/full-trajectory-corrected`.
Heading measurements and the initial rejected renders remain alongside them.
The source-turn timing, stance behavior and human appearance still need further
assessment. Global spatial adaptation does not yet provide a local correspondence
between every original and detoured step. Additional captured steps for larger
detours, natural waiting for temporary obstruction, physical stepping turns,
nonlevel travel and broad provider/model/path acceptance remain open. Safe holds
preserve authored data when planning fails; they do not satisfy the requirement
for successful obstacle navigation in those cases.

Default-on collision, the saved explicit toggle, and automatic obstacle
avoidance/replanning remain integration gates in both existing worktrees for
all current and future model/path importers. No provider-specific exceptions or
separate collision implementation are introduced by this work.

## Local source correspondence and measured stance failures

The preceding global stride adjustment moved retained waypoints away from their
original source phases, even outside the obstruction. Repaired trajectories now
save `path.sourceProgress`: the captured travel fraction at each waypoint. These
fractions survive route repair/simplification and project serialization. A
monotone interpolation maps source travel to route distance, preserving exact
waypoint correspondence, contact pauses, endpoints and continuous speed at
anchors. Source playback time remains unchanged. Facing correction samples this
same mapping, and export includes correspondence-anchor source times.

Correspondence belongs to the repaired geometry, not the reusable gait. An
unchanged editor save retains it; drawing/replanning different geometry or
splitting it into new waypoint-action routes does not copy stale anchors. The
editor labels the mapped route's stride factor as an average step length.
Automatic native navigation reconstructs correspondence from the original take
when an obstacle changes. It now tries progressively larger clearance margins
before using the full circumscribed body radius; every candidate still receives
a complete animated clearance scan. The larger initial jump had incorrectly
made modest, geometrically feasible corrections exceed the stride bound.

Real source-mapped Thoughtful walk evidence (native / Party Woman):

- Complete source time remains 34 seconds at explicit 1×, followed by the same
  0.4-second hold. Source-clock errors remain below 6.40e-13 seconds. Both actual
  animated bodies clear their obstructed scenes. Horizontal endpoint error is
  zero and final facing matches modulo a revolution.
- The new routes are 8.298871 / 7.640862 m, with average spatial stride factors
  0.935658 / 0.930470 after receiver proportions. On those same geometries,
  uniform progress would miss retained waypoint phases by as much as
  0.361258 / 0.350991 m. The new mapping's waypoint phase error is zero.
- Maximum body turn speed is now 1.741271 / 1.665027 rad/s, compared with the
  original capture's 1.345879 rad/s and the previous corrected routes' 2.670527
  rad/s. This is a measured improvement, not a stepping-turn acceptance result.
- Fresh GLB all-bone/mesh sample errors are 0.188318/0.185919 mm native and
  0.164025/0.106951 mm transferred. Rendered frames were inspected and a new
  comparison video was generated in `captured-continuations/source-mapped-trajectory`.
- The full suite passes 956 tests in 87 files. Additional focused checks cover
  unchanged/edited editor saves and correspondence-aware export boundaries.
  TypeScript and diff checks pass. The isolated build is
  `/tmp/scene-animation-review/source-mapped-build`; production `dist/` is unchanged.

**The new stance diagnostic rejects these detours as natural-motion evidence.**
It compares anatomical ankle travel and foot rotation during the original take's
measured grounded contacts, on both original and routed playback at the same
source times. The worst added stance drift is 0.231307 m native / 0.136332 m
transferred. The worst added within-stance rotation is 0.546983 / 0.848438 rad.
These are not acceptable foot planting results. Foot correction reaches its
existing bound and also reports geometric reach limits up to 0.088380 /
0.071382 m; increasing IK correction alone cannot preserve leg proportions.

The largest failures occur in contacts around 5.9–13.3 seconds, spanning the
obstructed stopping pose and its departure. Farther from the obstacle, the
source-phase correspondence improves body turning, but contact drift still
needs assessment. The next required work is contact-constrained trajectory
warping: retain a rigid captured stance through the stop and distribute needed
changes over feasible steps, with physical turns/additional captured steps when
necessary. A route that clears geometry and round-trips through GLB is not
thereby a natural performance. The contact report is archived as
`captured-continuations/trajectory-contact-mapped.json`; heading measurements
are in `trajectory-heading-mapped.json`.

The full all-provider/model/path objective and the default-on collision,
explicit saved toggle, and automatic navigation requirements remain active.
None of the measured contact failures is a provider exception or an accepted
safe-only replacement for successful natural navigation.

## Captured stance orientation and loop-boundary precision

The shared contact solver now removes the route frame's added yaw while a foot
is planted, retaining the source foot's own roll, tilt and yaw articulation.
Approach and release blend that correction with matching angular velocity;
position residuals are sampled after the yaw correction so sole geometry does
not jump when the constraint releases. This uses measured contact data and rig
transforms, with no provider or clip-name branch.

Repeated source coordinates are unfolded into a continuous planted frame.
The actual sampled route phase travels with the raw pose: recomputing it from
equivalent timeline arithmetic could select the wrong cycle at an exact wrap.
Loop closure also extrapolates its just-before-end sample to the actual endpoint,
including pose, morphs and clearance, rather than retaining the sampling offset
as a discontinuity. One-shot source playback is outside that closure.

The source-mapped one-off stance report now measures maximum added rotation of
2.02875e-7 rad native / 2.05064e-8 rad transferred. **Position is still rejected:**
added stance drift remains 0.230470 / 0.134696 m, with geometric reach limits
0.086455 / 0.071382 m. These figures are archived in
`captured-continuations/trajectory-contact-orientation.json`. The required next
change remains contact-constrained trajectory warping and feasible captured
steps; increasing the leg solver's reach cannot solve it without distortion.

Loop verification caught and rejected an initial 8 cm skin seam introduced by
the first orientation correction. Unfolding removed that large seam. Exact
boundary checks at 0.75x, 1x and 1.6x then exposed the floating-point cycle issue,
which now has regression coverage. Finer real-data checks still show a residual
below one micrometer whose finite-difference velocity does not converge. The
strict real-loop velocity gate is therefore still open; a rendered frame or
successful GLB comparison does not erase that diagnostic. Before/after evidence
is retained in `orientation-loop-initial`, `orientation-loop-final`, and
`orientation-loop-endpoint-convergence` under `captured-continuations`.

The full suite passes 962 tests in 87 files, including source articulation,
approach/release angular velocity, reverse seeking, exact repeated boundaries,
explicit rates, and endpoint closure for regular and detached joints.
TypeScript, formatting and diff checks pass. All collision/default/toggle and
automatic navigation requirements above remain integration gates for both
worktrees and every current or future model/path importer.

Fresh one-off planning, loaded-body clearance and GLB checks pass in
`captured-continuations/contact-oriented-trajectory`: the full 34-second take,
explicit 1x rate and 0.4-second hold survive, with no playback warnings. Maximum
bone/mesh errors are 0.188318/0.185919 mm native and 0.164025/0.105912 mm
transferred; destination and final-facing checks pass. Rendered stop frames were
inspected. This verifies geometry, timing and export, not the rejected foot drift.

The final repeated-window render, video and GLBs are archived separately in
`captured-continuations/orientation-loop-endpoint`. Maximum GLB bone/mesh errors
are 0.089582/0.089300 mm native and 0.187150/0.060648 mm transferred. At the exact
join, the native finite-difference skin-velocity check is 0.005604 m/source-second
at a 1e-4-second sampling step, exceeding its 0.005 gate; the verifier correctly
exits unsuccessfully. Finer steps expose the unresolved sub-micrometer residual,
so that threshold has not been relaxed. The isolated final build is
`/tmp/scene-animation-review/contact-orientation-endpoint-build`; production
`dist/` has not been rebuilt.

## Contact-constrained body trajectory

`src/routeContactWarp.ts` now adjusts the body path for complete repaired
performances using the original measured ground contacts. The full-take sparse
solve treats each contact anchor as an unknown shared with later samples. It
minimizes added planted-foot motion and correction acceleration while retaining
the proposed centerline where contact allows. The captured source pose and clock
are unchanged; the existing leg solver handles the remaining error. Entry and
exit corrections and their velocities are zero. Interpolation is continuous in
position and velocity, deterministic under reverse seeking, and independent of
source origin, heading, units and receiver scale. No provider names select it.

The common world sampler applies this before foot planting, so clearance
prediction, preview, scrubbing and export all evaluate the corrected body path.
Native navigation checks the 10% spatial-adaptation bound after this correction
as well as on the proposed route. The actual path can differ from that
centerline: the real native/target examples below require maximum offsets of
0.214360/0.209349 m. This is deliberate body adaptation checked against loaded
obstacle geometry, not permission to enlarge leg lengths or bypass collisions.

The first translation solve reduced the old 0.230470/0.134696 m maximum _added
stance excursion_ to 0.004535/0.010288 m on the existing native/target detours.
A trial additionally constraining detour-facing through contacts worsened the
departure and was removed. Stronger positional contact weighting improves the
result further. That scalar excursion metric alone hid residual motion, so the
new diagnostic also compares every sampled foot position with the original
same-time foot displacement in its rigid planted frame, and measures residual
velocity. Maximum excursion differences must not substitute for that comparison.

Fresh full-scene planning and loaded-body clearance pass on both real rigs.
The native planner selects a different clear route after evaluating the body
correction; the transferred route remains the same. Results are archived in
`captured-continuations/contact-weighted-warp-trajectory`, with the stance report
in `trajectory-contact-weighted-final.json`:

- Both retain the complete 34-second source take at explicit 1x, plus the same
  0.4-second hold. Source-clock error is at most 6.40e-13 seconds, playback
  warnings are empty, and destination/final-facing checks pass.
- Evaluated corrected travel is 8.752233 m native / 8.232508 m transferred,
  or 0.986772/1.002518 of the original proportion-scaled travel. Both remain
  inside the existing 10% spatial-adaptation bound.
- Maximum added stance excursion is 0.000056/0.001988 m. More importantly,
  maximum same-time planted-trajectory residual is **0.000529/0.017738 m**,
  with residual speed **0.031763/0.367432 m/s**. The transferred departure
  contact around 12.24–13.35 seconds is still rejected. Several other target
  contacts have centimetre-scale residuals; the solve currently measures the
  source foot geometry and scales it, so receiver-specific proportions and
  geometric leg reach need the next investigation.
- GLB bone/mesh errors are 0.188303/0.185904 mm native and
  0.164009/0.065861 mm transferred. These export results do not certify natural
  stance motion.

Actual original-versus-detour comparisons at matching source times 5–15 seconds
are in `captured-continuations/contact-warp-comparison/native-comparison.mp4`
and `transferred-comparison.mp4`. Each is 10.033 seconds at 30 fps. Stop and
departure frames were inspected; the videos remain review samples, not human
acceptance. This work does not resolve the earlier strict loop-velocity residual,
automatic insertion of additional captured steps, physical stepping turns,
temporary-obstacle waits, nonlevel travel, or broad real-provider coverage.

The body-contact tests cover receiver scales, source units/origin/heading,
unchanged captured motion, endpoints, correction velocity and reverse seeking.
The existing synthetic planner contact fixture was corrected to use its actual
source-space ankle position: its take starts away from the origin, whereas the
old injected zero point was only a branch-selection flag and is now consumed
as geometry. The new travel bound caught that inconsistent fixture; the bound
was retained. Both worktrees retain all default-on collision, saved explicit
toggle and automatic obstacle-navigation requirements for all model/path imports.

Final validation passes 970 tests in 88 files, TypeScript, formatting and diff
checks. A fresh current-code planning run including the new post-correction
travel gate also passes for both real rigs; its evidence is in
`captured-continuations/contact-warp-planning-final`. The isolated build is
`/tmp/scene-animation-review/contact-warp-final-build`; production `dist/` is
unchanged. Next work must address receiver-specific support and reachable leg
geometry, including whether pelvis adjustment is needed, without masking the
remaining stance error by comparing only maximum excursion.

## Receiver contact support and the in-place regression check

The shared contact solver now gives a planted leg limited room to bend by lowering
body support, bounded by both legs and 5% of leg length. Active and passive feet
retain their pre-support heights, limb lengths and world orientations. This is a
world-space correction that also handles scaled/rotated parents. Zero correction
leaves the pose unchanged. The activation, combination of both legs and final
bound are smooth. A real repeated-motion velocity regression exposed an unsigned
radial calculation: retaining the signed inward/outward reach change removed that
new kink, with a failing-then-passing regression test.

For one-shot captured travel, contact displacement now comes from the receiver's
uncorrected articulation in the source travel frame, rather than only scaling the
source foot trajectory. Approach and release use that same correspondence.
Repeated contacts still use the source contact schedule; receiver-aware repeated
contact trajectories remain required work. These choices depend on measured
motion type and geometry, never provider or clip names.

Fresh complete-take evidence is in `captured-continuations/contact-support-final`
and `trajectory-contact-support-final.json`:

- Both original and transferred Thoughtful walk keep all 34 source seconds at
  explicit 1x, the 0.4-second hold, destination and final facing. Automatic
  obstacle planning and loaded-body clearance pass with no playback warnings.
- Maximum same-time foot-trajectory residual is 0.125395 mm native and
  0.106962 mm on Party Woman, compared with the preceding 0.529165/17.737662 mm.
  Maximum residual speed is 0.007699/0.006572 m/s. Maximum body lowering is
  2.670733/4.277358 mm; tiny reach-limited requests still remain.
- GLB bone/mesh comparison errors are 0.090405/0.089400 mm native and
  0.156354/0.065741 mm transferred. These are export consistency measurements,
  not universal natural-motion acceptance.
- Original-versus-detour videos at matching source seconds 5–15 are in
  `contact-support-comparison/native-comparison.mp4` and
  `contact-support-comparison/transferred-comparison.mp4`. Each is 10.033 seconds
  at 30 fps. Stop/departure frames were inspected; human acceptance remains open.

### Independent in-place rig check rejects a broader articulation assumption

The shipped Quaternius Walk/Run files were tested on the original rig, which has
separately parented foot controls, and transferred to Party Woman. Tests compare
straight/curved routes, one source cycle and 2.2 cycles, reverse seeking, actual
sole material points, loop velocity and GLB output. The original source rig is
used as an internal comparison reference, not a newly saved user asset.

Applying receiver ankle displacement to reconstructed in-place travel was a
regression. The reconstruction already supplies forward travel based on the
source stride; the receiver's different ankle excursion reintroduced sliding.
Maximum one-shot transferred sole drift increased from 56.997 to 112.588 mm for
Walk and from 10.613 to 52.640 mm for Run. A separate sole-lever adaptation trial
also failed the Walk check and was removed. Neither trial remains in playback.
In-place contacts retain the measured source schedule, and a regression test
ensures receiver ankle excursion cannot override that virtual stride. This
restores the earlier behavior; **the remaining drift is not accepted quality**.

The final eight-case report, rendered frames and video are in
`captured-continuations/contact-inplace-4477`. Source-clock errors remain below
7e-16 seconds and reverse-seek differences are zero. Maximum sampled GLB mesh
error across the cases is 0.110501 mm. Despite that export consistency, repeated
Walk and Run are rejected: both emit the loop-closure warning, and Run has a
visible positional jump. These failures also occur in the earlier code, as
recorded in `contact-inplace-4468`; they are not new body-support regressions.

Direct source sampling in `bundled-source-loop-mismatch.json` identifies why the
current bounded closure refuses these loops. Walk matches endpoint positions but
its right-foot angular velocity changes by about 4.51 rad/s. Run has an endpoint
shin-position discrepancy around 24.5 mm and forearm/hand angular velocity
changes around 15.08 rad/s. The existing 2 rad/s closure limit rejects both.
This is evidence for a required cyclic-motion adaptation in the common pipeline,
not permission to blame the provider, loosen an acceptance threshold, or replace
captured motion with a procedural gait. Natural loop adaptation, planted stride
and receiver proportion handling need to be solved together.

### Loop precision and final checks

Loop closure now also closes permitted exporter-scale rounding differences and
their velocities. Previously its acceptance check tolerated these differences,
but visible material points could still jump even when bone origins matched.
New regular/detached-foot tests reproduce that failure and pass after the fix;
meaningful scale changes remain outside the allowed closure.

The fresh real Thoughtful walk repeated-window check remains unsuccessful at its
strict exact-boundary velocity gate. Native skin velocity is 0.005604 m/source-s
against the unchanged 0.005 gate; scale closure does not resolve that residual.
Transferred results remain below the gate. Current rendered frames, video and
GLBs are in `contact-support-final-loop`; GLB bone/mesh errors are
0.099114/0.102066 mm native and 0.097865/0.060237 mm transferred. Passing export
must not hide the failed continuity check.

Final validation passes 981 tests in 88 files, TypeScript, formatting and diff
checks. The isolated build is `/tmp/scene-animation-review/contact-final-build`;
production `dist/` was not rebuilt. The all-provider/model/path objective stays
open, including repeated in-place adaptation, remaining foot drift, strict loop
continuity, additional captured steps, physical turning, temporary-obstacle
waiting, nonlevel travel and broad real-asset/human review. Default-on collision,
the saved explicit toggle and automatic obstacle replanning remain mandatory
integration gates for every current and future importer in both worktrees.

## Two-sided loop correction and preserved cycle timing

Repeated routes now match the mean incoming/outgoing pose velocity on both sides
of each join. The former correction changed only the end of a cycle to match its
start, requiring a larger alteration there and rejecting ordinary fast limbs.
The first entry remains authored, and a final partial entry returns to its
original pose by its endpoint. Position, rotation, permitted scale rounding,
morphs and transferred foot clearance use the same weights. Contact orientation
uses the same sampled phase and velocity correction. Export sampling includes
the new entry-window boundary.

The correction is constrained by its actual maximum displacement: the existing
0.35-radian rotation and 5%-of-height position limits include both the endpoint
mismatch and the peak Hermite tangent contribution. The tangent contribution is
bounded by `2 * window / 27` times the endpoint velocity difference because the
change is shared across both sides. This replaces the absolute 2 rad/s velocity
rejection; it does not remove the pose limits or loosen the measured continuity
gates. Tests reject a small endpoint pose with a tangent correction too large to
fit, and verify a fast cyclic joint that fits the same bounds, including a final
partial cycle and scaled hierarchies. Unchanged-source comparisons remain strict
outside the two blend windows; native/transfer parity is checked inside as well.

Two additional discontinuities were identified and corrected:

- Verified loops now match route-travel speed even when they were not created
  from an interior source window. The harmonic endpoint speed retains zero-speed
  evidence, source timing and exact partial-route endpoints. One-shot travel is
  unaffected. Previously Walk's pose could be closed while its body route still
  changed speed abruptly at the wrap.
- Every noncontinuous foot contact now measures its outgoing correction velocity,
  including contacts without an approach interval. Previously those contacts
  started releasing with zero correction velocity, producing a foot kick. A
  regression measured 0.100015 m/s at release before the fix and passes the
  unchanged 0.0001 m/s test afterward.

Native sampling now normalizes finite, nonzero quaternions after interpolation,
including animated non-bone parents. Float32 rotation rounding must not become
small skin deformation when mixed with normalized retargeting and IK results.
A regression checks material-point distances and rotation length. Source-join
and arrival comparisons use the relative-quaternion atan2 angle, avoiding the
spurious nonzero `acos(dot)` angle for identical normalized poses. The existing
deterministic arrival-order test exposed this issue; its order and quality
expectations were retained.

### Timing regression caught by the real in-place check

A fresh native Walk run showed 0.024333 seconds of source-clock error despite a
nominal one-cycle, 1x route. Compiling/scaling the path put its length a few ulps
above the measured cycle distance, so inverse gait timing added the next cycle's
entry pause. The opposite rounding direction could drop an authored terminal
pause. `gaitTravelTime` now recognizes complete cycles within a relative machine-
precision bound. Real partial cycles still retain their pauses. Tests cover
multiple cycles at geometry scales 1e-8, 1 and 1e8; the original failed cases were
retained. The final eight-case real check has source-clock error at most
6.67e-16 seconds, zero reverse-seek discrepancy and no playback warnings.

### Fresh real results and remaining failures

`captured-continuations/balanced-travel-loop` contains the repeated Thoughtful walk
GLBs, renders, video and successful strict verifier output. At source rates
0.75x, 1x and 1.6x, maximum exact-boundary skin-velocity residual is now
0.000623 m/source-s native and 0.000563 m/source-s transferred, below the unchanged
0.005 gate. The previously failing native value was 0.005604. Maximum GLB bone/
mesh errors are 0.099137/0.102089 mm native and 0.097906/0.060116 mm transferred.
This closes that measured gate on those assets, not universal visual acceptance.

`balanced-one-shot` rechecks full-take planning and export: both rigs clear the
obstacle, retain all 34 source seconds at explicit 1x and the 0.4-second hold,
and reach the same destination/facing with no warnings. Source-clock error is at
most 3.56e-15 seconds. GLB bone/mesh errors are 0.089170/0.089358 mm native and
0.156324/0.085588 mm transferred.

The final Quaternius report is `contact-inplace-4482/results.json`. One-shot and
2.2-cycle Walk/Run are checked on the original detached-foot rig and Party Woman,
with straight/curved paths, reverse seeks and GLB comparison. Maximum GLB bone/
mesh errors across these cases are 0.100124/0.113070 mm. Repeated-loop warnings
are gone because the new correction fits its pose bounds; that alone is not a
quality pass. The sampled skin continuity diagnostic at a 1e-4 source-second step
reports these worst joins across two cycles:

| Motion / rig       | Previous residual (m/s) | Current residual (m/s) |
| ------------------ | ----------------------: | ---------------------: |
| Walk / original    |                1.465347 |               0.020991 |
| Walk / Party Woman |                2.592883 |               0.004222 |
| Run / original     |              306.202073 |               0.006803 |
| Run / Party Woman  |              407.862218 |               0.004086 |

These are finite-difference continuity residuals; a position discontinuity divided
by the sampling step can produce a very large value. They are not the actor's
running speed. **Both original-rig cases still exceed 0.005** and are recorded in
`contact-inplace-4482/continuity-rejections.json`. The gate has not been relaxed.
Remaining native discontinuities, derivatives and finite-difference convergence
need investigation. The transferred cases pass this sampled continuity check.

Foot sliding remains rejected. Maximum transferred sole-material-point travel
within the measured Walk stances is 56.997 mm for one cycle and 43.826 mm for
repeats (the previous repeated value was 40.498 mm). Run measures 10.613/12.852 mm.
Native motion contains some sole travel too, so these are absolute stance
excursions rather than added retargeting error. The remaining receiver stride,
contact limits and body support need joint investigation; successful loop joins
and export must not hide that problem.

Before/after loop-review videos are in `balanced-loop-comparison`, with identical
camera trajectories shared by both versions and explicit 1x timing. Early fixed-
camera renders let runners leave the frame and were replaced for this comparison.
The clips inspect loop joins; they do not certify natural stopping at route ends.

Final validation passes 991 tests in 88 files, TypeScript, formatting and diff
checks. An initial busy-run navigation timeout passed on recheck with its timeout
and assertions unchanged. The isolated build is
`/tmp/scene-animation-review/balanced-complete-build`; production `dist/` remains
unchanged. The all-provider/model/path objective stays active. Natural contact,
remaining native loop checks, additional captured steps, physical turning,
waiting, nonlevel travel and broad real-provider/human review remain open.
Default-on collision, the saved explicit toggle and automatic blocked-path
replanning remain required for all existing and future import entry points.

## Separating contact-distance limits from physical reach

Contact diagnostics now report `distanceLimited` separately from `reachLimited`
and IK solver `error`. A precise solve of an already capped goal must not be
mistaken for accurate planting. The new value measures displacement removed by
the correction allowance, after contact weighting and ignoring the vertical
component for horizontal planting. This change does not alter evaluated poses,
contact limits, timing or navigation behavior.

The eight-case real Walk/Run check is recorded in
`captured-continuations/contact-limit-diagnostic/results.json`. Contact and loop
measurements match the previous `contact-inplace-4482` report exactly. Across
sampled straight/curved contacts, transferred Walk loses up to 32.340 mm of
requested correction for one cycle and 17.256 mm for repeats to the distance
limit, with negligible physical reach loss. Transferred Run reaches both limits:
distance loss is up to 19.455/19.004 mm, and repeated physical reach loss reaches
30.723 mm. These maxima include either foot's correction during the sampled
contacts and must not be summed or equated with one foot's stance excursion.

This identifies a contributing constraint; it does not establish that raising
the limit would preserve natural motion. Receiver stride, body support and
contact articulation still require joint correction. No acceptance threshold or
correction bound was relaxed. Focused validation passes 51 contact/surface tests,
including scale, weighted correction and zero-allowance diagnostics; TypeScript
and diff checks pass. The all-provider/model/path objective and both worktrees'
collision/navigation integration gates remain active.

## Preparing bounded landings from the measured stance

Real receiver measurements show that one height ratio cannot fix every stride:
Party Woman's Quaternius Walk stance excursion is proportionally larger than the
source's, while Run is smaller. `receiver-stride-diagnostic/results.json` records
the relative hip/sole displacement. Changing every route's scale to fit Walk
would miscalibrate other motion and risk changing its saved source clock.

The shared contact sampler now attempts a bounded landing adjustment for an
in-place stance that exceeds its correction allowance. It samples the stance,
approach and release, then finds the nearest landing offset satisfying their
horizontal correction disks and measured leg-reach constraints. It reserves the
existing support solver's bend and soft lowering region. The landing shift itself
has the same correction bound. Feasible original landings stay unchanged; an
unverified or infeasible intersection retains the original anchor. No correction
limit, bone length, source time, route distance or provider condition is changed.

Ordinary inferred in-place stances now prepare during the preceding swing, up to
0.2 source seconds or half their stance duration. Existing running preparation
is retained. The first preparation is clipped to the real route entry: a looping
schedule cannot assume that this first swing started before the route existed.
Already-active initial contacts retain their anchors. Export boundaries use the
same approach schedule.

The first trial reduced Walk drift but caused a 0.5 m/s release kick in the new
regression and increased repeated Run reach loss from 30.723 to 44.090 mm. That
trial was rejected. The final fit includes the approach/release Hermite tangents
and physical reach throughout those blends, and is activated only by actual
distance-limit demand. Running stance and reach measurements are preserved. The
regression now verifies stance planting, unchanged root progression and initial
pose, bounded correction, reverse seeking and continuous approach/release for
both a short first swing and a full swing. Separate geometry tests cover rotated
and scaled constraints, an unchanged feasible anchor, physical reach and an
infeasible intersection.

Fresh evidence from runtime 4488:

- `contact-transfer-residual-entry/results.json` contains the sampled sole
  trajectories and distance/reach diagnostics. The matching baseline is
  `contact-transfer-residual-before/results.json`.
- `contact-transfer-residual-summary.json` compares each stance's displacement
  against the original rig's height-scaled trajectory at the same source times.
  Maximum added planar error over straight/curved one-cycle Walk falls from
  32.601 to 1.267 mm. This stronger measure separates added transfer error from
  the source's own sole articulation. Absolute curved stance excursion falls
  from 56.997 to 26.748 mm; it must not be described as entirely added sliding.
- Repeated Walk still has 17.129 mm added error and 43.826 mm absolute curved
  excursion. Run's added error remains 20.204/19.749 mm for one/repeated cycles.
  The remaining one-cycle Walk residual also shows that finite sampled landing
  constraints do not establish continuous-time contact accuracy. These cases
  remain open; a feasible subset is not universal animation acceptance.
- `contact-landing-export-entry/results.json` rechecks all eight Walk/Run ×
  native/transferred × one/repeated cases. Source-clock error is at most
  6.67e-16 seconds, reverse-seek discrepancy is zero, warnings are empty and
  maximum GLB bone/mesh errors are 0.100124/0.113070 mm. Native loop residuals
  still exceed the unchanged 0.005 m/source-s diagnostic and are recorded in
  that folder's `continuity-rejections.json`.
- `contact-landing-comparison/walk-comparison.mp4` shows the one-cycle transferred
  Walk before/after at explicit 1x, with identical camera trajectories. Rendered
  frames were inspected for framing and pose. The short clip is contact-review
  evidence, not certification of natural stopping or overall human motion.

Final validation passes 1,002 tests in 89 files, TypeScript, formatting and diff
checks. The isolated build is `/tmp/scene-animation-review/contact-landing-entry-build`;
production `dist/` was not rebuilt. All-provider/model/path fidelity remains
active, including repeated contact, native loop continuity, natural turns/waits,
nonlevel travel and broad real-provider/human review. Default-on collision, the
saved explicit toggle and automatic obstacle replanning remain integration gates
for both worktrees and every current or future importer.

## Direct landing geometry closes a missed feasible repeated stance

The repeated Walk fallback was not proof that the existing limits were
incompatible. Capturing the landing constraints showed a valid 15.175 mm offset
inside the unchanged 88.284 mm correction allowance. The iterative projection
had exhausted its 128 passes before accepting it. The evidence is in
`landing-constraint-diagnostic/results.json`; a reduced two-disk fixture in
`missed-feasible-fixture.json` reproduces the rejected feasible solution.

`fitContactLanding` now computes the closest point directly. For an intersection
of horizontal disks, the closest point is the original anchor, a radial
projection onto one circle, or an intersection of two circle boundaries. Every
candidate is checked against all constraints, including the landing-shift bound.
The calculation uses allowance-relative coordinates and machine-precision
tolerances. Empty or numerically unverified intersections still retain the
original anchor. No pose, source timing, reach constraint, correction allowance
or provider branch is changed.

The reduced regression fails on the old solver and passes with the direct
calculation. Additional tests cover two-boundary optima, tangent circles,
pairwise-overlapping circles with an empty common intersection, order invariance,
scales from 1e-8 through 1e8, and 200 varied intersections with known feasible
solutions. These tests verify both feasibility and movement no farther than the
known solution, rather than merely checking that an offset was returned.

The fresh eight-case real check is `contact-transfer-geometric/results.json`.
Compared with runtime 4488, runtime 4490 reduces maximum added repeated-Walk
foot-path error from 17.129 to 2.111 mm over straight/curved routes. Absolute
curved stance excursion falls from 43.826 to 28.683 mm. One-cycle Walk remains
at 1.267 mm added error. Native and transferred running contact measurements
are unchanged. The residual 2.111 mm still fails the full fidelity objective;
the finite temporal sampling of landing constraints needs further investigation.
The solver fix must not be mistaken for correction of the remaining running
contact or native loop errors.

`geometric-landing-comparison/measurements.json` records the before/after values.
The adjacent `walk-comparison.mp4` shows repeated walking at explicit 1x using
identical camera tracks, with synchronized close views of the feet. Frames were
inspected for framing and pose. The comparison ends before the terminal hold
and does not establish natural stopping or overall human-motion acceptance.
Both baseline and current module responses were checked to confirm that the
comparison actually uses the iterative and direct solvers respectively.

`contact-geometric-export/results.json` rechecks native/transferred Walk/Run,
one/repeated cycles, reverse seeking and GLB parity. Maximum source-clock error
is 6.67e-16 seconds and reverse-seek discrepancy is zero, with no warnings.
Maximum GLB bone/mesh errors remain 0.100124/0.113070 mm. Existing native loop
diagnostic failures remain recorded in that folder's `continuity-rejections.json`
against the unchanged 0.005 m/source-s threshold.

Validation passes 1,008 tests in 89 files, TypeScript, formatting and diff checks.
The isolated build is `/tmp/scene-animation-review/contact-geometric-build`;
production `dist/` is unchanged. The all-provider/model/path objective and both
worktrees' default-on collision, saved explicit override and automatic obstacle
avoidance/replanning requirements remain active.

## Authored-key and curved-constraint sampling

The remaining walking correction peaks occurred between the fixed 60 Hz landing
samples. A diagnostic 240 Hz trial removed the measured distance-limit loss,
without changing any limit. The shared profile now retains original track key
times relative to its selected source window. Landing constraints include those
keys, including keys unfolded across a repeated contact, alongside coarse samples.
For a feasible candidate that needs adjustment, the sampler additionally refines
where measured constraint centers/radii deviate from linear interpolation. It
checks quarter points around midpoint inflections, caches sampled phases and
uses a scale-relative tolerance. Unchanged and infeasible candidates avoid this
extra refinement. The source clock and evaluated pose tracks are unchanged.

The refinement has a finite subdivision bound; it is not a proof of accuracy at
every instant for arbitrary input motion. Tests retain a narrow authored peak
missed by the coarse grid, an inflection hidden at the midpoint, and original
key times inside non-frame-aligned source windows with timestamp padding.

`contact-transfer-refined/results.json` records the eight-case real check. In its
original contact-sampling grid, maximum added Walk foot-path error is now
0.418 mm for one cycle and 0.246 mm for repeats. Measured distance-limit loss is
zero in both. Running contact measurements are unchanged and remain rejected.

The stronger independent check, `contact-transfer-refined-dense/results.json`,
uses approximately 1,000 samples per source second and includes almost the full
stance, leaving only 10 microseconds at each contact boundary. It measures
1,120 one-cycle and 2,406 repeated-stance points per path shape on each rig.
Maximum added Walk error is 0.440/0.249 mm, distance-limit loss is zero, physical
reach loss is negligible, and reverse seeking is exact. Its `summary.json`
records these results. These are limited asset/contact measurements, not proof
of natural motion across all providers or of every remaining acceptance gate.

`contact-refined-export/results.json` repeats native/transferred Walk/Run export
checks. Maximum source-clock error is 6.67e-16 seconds; maximum GLB bone/mesh
errors remain 0.100124/0.113070 mm. Existing native loop failures remain recorded
in `continuity-rejections.json` against the unchanged 0.005 diagnostic. Fresh
native/receiver renders are in `refined-contact-render`; framing and poses were
inspected. Final validation passes 1,010 tests in 89 files, TypeScript, formatting
and diff checks. The isolated build is
`/tmp/scene-animation-review/contact-refined-build`; production `dist/` is unchanged.

### Running investigation remains open

`running-constraint-diagnostic/conflicts.json` identifies incompatible landing
offset requirements during the existing approach and release curves. Unlike the
earlier iterative Walk failure, these constraints include disjoint disks: changing
only the constant landing position cannot satisfy the current swing model.
The reported disk separation is in landing-offset coordinates and must not be
reported as actual foot sliding or anatomical overextension.

A diagnostic-only trial halved running approach/release durations. It reduced
sampled swing reach limiting but left the approximately 20 mm added stance error
and 19 mm distance-limit loss. The arbitrary duration reduction was not adopted.
Further work must address the swing/contact trajectory and receiver geometry,
with real visual verification, rather than infer that a new provider needs a
special-case patch. The full all-provider/model/path goal, default-on collision,
saved explicit override and automatic obstacle replanning remain active.

## Bounded running swing correction

The running constraints above cannot always be satisfied by changing only the
constant landing offset. The shared solver now retains the existing fit first,
then, for an infeasible full fit, tries a stance-only landing with independently
bounded approach and release curves. The added interior correction has zero
position, velocity and acceleration at both endpoints. Feasible curve shapes
are ranked by added acceleration energy. The measured physical-reach and actual
correction allowances, source clock, leg lengths and route distance are unchanged.
This is shared geometry, with no motion-name or provider branch.

An initial quartic interior correction reduced contact error but failed the
existing loop diagnostic by introducing endpoint acceleration. It was rejected.
The accepted curves use endpoint powers of at least three; tests also reject an
infeasible endpoint that an interior curve cannot repair. The finite candidate
family and temporal refinement remain bounded searches, not continuous-time
proofs for arbitrary imported animation.

Final runtime 4498 is recorded in `contact-swing-final/results.json`. Maximum
added planar stance trajectory error against the height-scaled original rig
falls from 20.204 to 6.220 mm for one-cycle Run and from 19.749 to 6.536 mm for
repeated Run. The original Walk sampling remains at 0.418/0.246 mm. Measured
distance-limit loss is zero in those checks. Transferred repeated-Run loop
residuals are 0.003976/0.003975 m/source-s against the unchanged 0.005 threshold.
These results do not clear the remaining running fidelity gate.

The independent full-motion curved-route sweep includes swing and flight at
500 samples per source second. `swing-full-motion-before/results.json` and
`swing-full-motion-after/results.json` record target Run reach loss decreasing
from 48.601/57.060 to 11.107/13.564 mm for one/repeated cycles. Correction-distance
loss falls from 16.048/18.198 mm to zero. Physical reach loss therefore remains
outside the contact-focused checks. Peak sampled foot speeds and finite-difference
accelerations are unchanged; the 95th-percentile target acceleration rises from
619.078/608.932 to 671.031/617.304 m/s². These derivatives include source-key and
clamp effects and do not certify physical or perceptual smoothness.

`swing-contact-comparison/run-comparison.mp4` shows before/after repeated running
at explicit 1× with identical camera trajectories and synchronized foot closeups.
Rendered frames were inspected. Its `measurements.json` uses the final runtime
results. This stylized source transfer does not establish human-motion acceptance.

`contact-swing-export/results.json` checks eight native/transferred Walk/Run cases,
one/repeated cycles. Maximum source-clock error is 6.67e-16 seconds, reverse-seek
discrepancy is zero, and there are no motion warnings. Maximum GLB bone/mesh
errors remain 0.100124/0.113070 mm. The unchanged native loop failures are retained
in `continuity-rejections.json`; they are not waived by passing transfer checks.
Validation passes 1,014 tests in 89 files, TypeScript, formatting and diff checks.
The isolated build is `/tmp/scene-animation-review/contact-swing-build`.
The all-provider/model/path objective, default-on collision, saved explicit
override and automatic obstacle avoidance/replanning remain open requirements.

### Independent rig import: Cesium Man

The local verification fixture now includes the independently sourced
[Cesium Man](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan)
sample, © 2017 Cesium, CC BY 4.0 with the logo/trademark exclusion retained.
The original bytes, license and provenance/hash are under
`test-results/assets/cesium-man`. This fixture was not added to the user's asset
library or production bundle.

`cesium-import-inventory/results.json` shows the shared loader retaining its
19 bones and 57 original tracks. The unfamiliar joint names produce an empty
automatic body mapping and an explicit unmapped-joint warning. A fixture mapping
using the existing saved child-index roles clears that warning without adding
provider aliases or corrective runtime branches.

`cesium-route-check/results.json` and `cesium-import-routes.mp4` exercise six
cases through the shared importer and pose evaluator: original Cesium motion on
its own rig, that motion on Party Woman, and Quaternius Walk on Cesium, each with
and without a newly constructed curved path. Source timing is retained, reverse
seeking is exact, and all sampled transforms are finite. The receiving Cesium
rig explicitly reports two unsupported Quaternius shoulder-position channels.
Rendered frames were inspected; these results establish neither human-motion
quality nor full import acceptance.

The Cesium motion is classified as in-place locomotion but produces no detected
stance windows. Its zero correction-loss metrics consequently do not demonstrate
planted-foot quality. Contact inference for this source needs investigation.
The fixture uses explicit mapping data, not automatic recognition or a tested UI
mapping session. Its local URL is outside persisted-scene upload paths: the
harness validates scene data with fixture URLs omitted, then restores those URLs
for runtime evaluation. This is a shared-runtime compatibility check, not proof
of the full upload/save/reload workflow. Broad new-provider acceptance remains
open.

## Grounded in-place support with authored lateral motion

`cesium-contact-diagnostic/results.json` identifies why the new source previously
had no stance windows: its reconstructed low ankle retains lateral speed above
the conservative stationary-ankle threshold. The source also has alternating
low-sole, backward-moving supports. Freezing or deleting the lateral motion
would lose authored detail.

The shared `detectInPlaceContacts` fallback now recognizes sustained alternating
grounded backward steps. It requires measured sole-ground proximity, an elevated
opposite foot, sufficient backward travel and a nearby opposite support. It
retains the measured ankle and sole samples exactly, including lateral motion
and foot roll. It adds no root travel and does not replace an overlapping
stationary-ankle contact or the existing reconstructed-flight contact handling.
Absent usable sole geometry, this extra inference is not used. The thresholds
remain conservative evidence tests, not universal anatomical classification.

This is common locomotion code with no provider or animation-name branch. Tests
cover scale variation, preservation of measured sway/sole samples, no mutation,
missing ground evidence, hovering, buried soles, double support, stationary or
forward-moving feet, and single-foot balance. Existing overlapping contacts
retain their samples, ordering and identity when no contact is added.

The final runtime is 4500. `cesium-route-supports-final/results.json` finds right
support at 0.066667–0.5 seconds and left support at 0.8–1.6 seconds. The same six
original-take/new-route cases remain finite and deterministic, with source timing
unchanged and unsupported Quaternius shoulder-position channels still disclosed.
`contact-supports-final/results.json` is exactly equal to the previous eight-case
Walk/Run report, including its contact points, timing and loop diagnostics.

`cesium-contact-before/results.json` and `cesium-contact-final/results.json`
compare the same independently retained support intervals at approximately
120 samples per source second, with 10 ms margins at contact boundaries. The
metric is added planar stance trajectory displacement on a curved path relative
to the corresponding straight-path displacement, rotated into the initial foot
orientation. It is not total native foot sliding or a whole-animation guarantee.
Maximum residual drops from 51.926/18.810 mm to 0.075/0.044 mm on the native rig
for one/repeated cycles, and from 52.161/34.148 mm to 0.089/0.089 mm on Party Woman.
The contact probe's maximum physical-reach loss is 0.089 mm; its distance-limit
loss is zero. A separate uniform full-take probe records 0.039 mm distance-limit
loss on the receiver, so zero must not be generalized to every sampled phase.

`cesium-support-comparison/cesium-comparison.mp4` shows the Party Woman transfer
before/after at explicit 1×, using the same baseline camera guides and synchronized
foot closeups. Rendered frames were inspected. The stylized source remains a
compatibility fixture, not evidence of final human-motion acceptance.

`cesium-support-export/results.json` verifies native and transferred motion for
one/repeated cycles. Source-clock error is at most 4.44e-16 seconds, reverse-seek
error is zero, and GLB bone/mesh deviations are at most 0.116687/0.120132 mm.
The transferred loop still fails the existing 0.005 m/source-s diagnostic:
0.006350/0.006210 after this change versus 0.006344/0.006219 before it. Those
failures remain explicit in `continuity-rejections.json`; the contact improvement
does not waive them. The existing native Quaternius loop failures also remain.

The explicit mapping, isolated local fixture URL and upload/UI limitations of
the preceding Cesium check still apply. The full all-provider/model/path goal,
default-on collision, saved explicit off toggle and obstacle avoidance/replanning
requirements remain active.

Final validation passes 1,019 tests in 90 files, TypeScript, formatting and
diff checks. One packaging test hit its unchanged 5-second timeout during the
concurrent render/build run; its isolated retry and the subsequent full-suite
recheck both pass. The final isolated build is
`/tmp/scene-animation-review/in-place-support-final-build`. Production `dist/`
is unchanged.

## Loop rotation checkpoint for Claude handoff

The user requested a temporary handoff to Claude. `docs/CLAUDE_HANDOFF.md` records
the full scope, working-tree state, runtime ports, evidence and immediate next
steps. The latest shared changes cancel the leading one-sided endpoint-velocity
sampling bias, remove a fixed ground-support early-exit step, and use composed
quaternion hierarchies for loop capture/application through scaled ancestors.
The corresponding regressions fail before their fixes and pass after. The
scaled-ancestor regression needs nonzero initial rotations; a zero-angle first
pose did not expose the matrix-decomposition error.

`hierarchy-loop-bundled` and `hierarchy-loop-cesium` hold the latest convergence
checks at runtime 4503. They sample 100 visible vertices per mesh; earlier loop
checks sampled 50, so peak values are not directly interchangeable. Native
Cesium's sampled position-discontinuity behavior disappears, but other residuals
remain. All-bone reports include unweighted control helpers; those peaks do not
establish visible mesh error. Preserve the distinction between position jumps,
velocity mismatch and valid acceleration across a finite measurement interval.
No acceptance threshold has been waived.

The full suite passes 1,026 tests in 90 files. TypeScript, formatting, diff checks
and the isolated `/tmp/scene-animation-review/loop-rotation-build` pass. Fresh
export/render scripts for these latest changes are prepared but NOT RUN at the
handoff. See the handoff's explicit commands and output locations; file presence
is not validation. Full human-animation and all-provider/model/path acceptance,
including collision defaults and obstacle replanning, remains unfinished.

## Loop rotation export/render verification and join-residual classification

Claude ran the four export/render scripts that were prepared but unrun at the
handoff, against the unchanged runtime 4503 and headless Chrome 9451. No runtime
source file was changed in this session; the working tree's `src/`, `shared/`
and `tests/` content is exactly the handoff state, and the full suite still
passes 1,026 tests in 90 files (`/tmp/scene-animation-review/claude-baseline-tests.log`).

`loop-rotation-export/results.json` (eight bundled Walk/Run cases, native and
Party Woman, one/2.2 cycles) and `loop-rotation-cesium-export/results.json`
(four Cesium cases) pass the export checks: source-clock error at most 6.7e-16 s,
reverse-seek error zero, exported GLB bone/mesh deviations at most 0.117/0.120 mm,
no motion warnings on the bundled cases, and the Cesium transfer still discloses
the two unsupported `ShoulderL/R.position` channels. Party Woman stance residual
on the curved route is 0.000 mm (bundled) and 0.089 mm (Cesium); native
Quaternius stance residual is at most 0.28 mm. Native Run keeps its 10.7 mm
reach-limited correction and 27 mm support; this was not changed.

Against `contact-swing-export` (the last bundled export before the three closure
changes) the single-h (1e-4) loop-join residuals moved: Walk native
7.165/20.991 → 2.435/2.368 mm/s; Run native 6.528/6.803 → 3.355/5.587 mm/s;
Walk and Run Party Woman essentially unchanged (3.58/3.50 and 3.78/3.78 mm/s).
Cesium Party Woman is 6.416/6.276 versus 6.350/6.210 before. Two cases still
exceed the existing 0.005 m/source-s single-h check and remain listed in
`continuity-rejections.json`: Run native at 1.75 s and Cesium Party Woman at
2 s and 4 s. The threshold was not changed.

`loop-rotation-render/inplace-routes.mp4`, `frame-*.png` and
`loop-rotation-cesium-render/cesium-import-routes.mp4`, `frame-*.png` were
rendered and inspected at 1× with the earlier camera guides. Frame strips around
the rejected joins are in `loop-rotation-render/join-strips/`. No visible pop,
foot slide or pose jump is apparent at the joins at 1280×960 / 30 fps; this is a
negative visual finding at that resolution, not proof of subpixel continuity.

To stop reading acceleration as discontinuity, `test-results/classify-loop-convergence.mjs`
classifies the seven-point h sweeps already recorded in `hierarchy-loop-bundled`
and `hierarchy-loop-cesium` by the local scaling exponent p of the residual
between consecutive h: p≈+1 is acceleration×h, p≈0 is a true velocity jump,
p≈−1 followed by a collapse is a position step located between the two h values.
Output: `loop-rotation-export/convergence-classification.json`. Result:

| Case                                        | h=1e-4 residual  | Classification                                                                                       |
| ------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| Quaternius Walk native, 1.25 s / 2.5 s      | 2.63 / 2.44 mm/s | true velocity jump, plateau 2.16 / 2.57 mm/s as h→1e-6 (Cube004 vertex 1014)                         |
| Quaternius Walk → Party Woman, 1.25 / 2.5 s | 3.76 / 3.60 mm/s | ~2.3–2.4 mm/s plateau at h=1e-5, float noise below 3e-6                                              |
| Quaternius Run native, 0.875 / 1.75 s       | 3.33 / 5.59 mm/s | 0.27 / 0.50 µm position step located 3–10 µs from the join; residual collapses to 9e-5 m/s at h=3e-6 |
| Quaternius Run → Party Woman                | 4.30 / 4.33 mm/s | acceleration-dominated, a≈43 m/s²; plateau ≤1.0 mm/s                                                 |
| Cesium native, 2 s / 4 s                    | 5.20 / 5.09 mm/s | pure acceleration, p=1.00 through h=1e-6; residual 5e-5 m/s at h=1e-6                                |
| Cesium → Party Woman, 2 s / 4 s             | 6.47 / 6.26 mm/s | acceleration-dominated, a≈62 m/s²; float noise below h=3e-6                                          |

So the two remaining single-h rejections are not velocity discontinuities: the
Cesium transfer failure is acceleration×h on a skirt/hair vertex (`blue` 2228),
and the native Run failure is a half-micron position step near, not at, the
join. The genuine velocity kinks are the ~2–2.6 mm/s Walk plateaus, below the
diagnostic threshold and far below visibility. A hypothesis for the Run step,
not verified: `supportRouteFootContacts` still breaks its second iteration on a
fixed `reachLimited > 1e-7`, and native Run is the only case with nonzero reach
limiting (10.7 mm); that is the same fixed-threshold-step pattern the
ground-support change removed. Any fix must keep the knee-bend reserve
semantics and must not raise the diagnostic threshold.

`test-results/verify-loop-rotation-sweep.mjs` and `-cesium-sweep.mjs` are the
original verify scripts with a five-point h sweep (1e-3…1e-6) per join and a
`join-classification.json` output; they write `loop-rotation-sweep-export` and
`loop-rotation-cesium-sweep-export` and agree with the table above. Party Woman
meshes reach float32 vertex noise at h≤3e-6, so their smallest-h values are
noise, not Δv; the seven-point hierarchy sweeps remain the authoritative reading.

None of this is acceptance of the human-animation goal. Loop closure on these
fixtures is now numerically clean to the sub-mm/s level; the open work is the
larger visual/navigation/import scope listed in the handoff.

## Real import, mapping, AI navigation and replanning through the application

This session exercised the actual upload → library → rig mapping → AI movement
→ replanning path in the real app, on an isolated runtime, and fixed what that
path exposed. Evidence base: the usual directory, folders `fable-import-ui/`
and `fable-nav-ui/`. Infrastructure: a private API on port **4411**
(`SCENE_MAKER_DATA=/tmp/scene-animation-review/fable-data`, the user's own
`.data` untouched) behind a review vite on **4512**
(`test-results/fable.config.ts`, `changeOrigin:false` so the same-origin check
passes), driven over CDP on the owned headless Chrome 9451 by
`test-results/fable-ui.mjs` and the `test-results/fable-*.mjs` scenarios.

### Implemented: untitled imported takes could never play

Reproduced through the UI (`fable-import-step1/2.mjs`): importing the
independent Cesium Man GLB (one untitled animation) through "Import your own
asset" succeeds, the take is listed, but adding it to the character shows the
viewport warning "The original file or a measurable foot stride for
CesiumMan's action is unavailable" (`fable-import-ui/step2-result.json`). The
import service labelled the untitled animation "Animation 1" while the glTF
loader names it `animation_0`, so no lookup ever found it. This affects every
provider's untitled takes and the Mixamo bundle path, which trusted Blender
action names the loader does not see.

Fix: `shared/animation.ts#untitledAnimationName` gives the loader's name;
`server/index.ts` and `server/mixamo.ts` report it; `src/rig.ts#importedClip`
is the one lookup used by `world.ts`, `bakeAnimation.ts`,
`automaticRoutes.ts`, `nativeNavigation.ts`, `capturedArrival.ts`,
`transitionContacts.ts` and `useRouteGait.ts`, and it also resolves the
earlier "Animation N" label to the untitled take at index N−1 (never to a
titled one) so projects saved before the fix keep playing. Regression:
`tests/importedTakeNames.test.ts` (service naming through the real `/api/import`
with a generated GLB, loader agreement, legacy-label resolution, titled takes
untouched). After the fix the same saved project plays its take
(`fable-import-ui/06-scrub-1.0-legacy-label-after-fix.png`, `step2-result-legacy-label-after-fix.json`).

### Verified through the UI: explicit rig mapping, persistence, reload

The "Animation rig mapping" editor lists Cesium's joints
(`Skeleton_torso_joint_1`, `leg_joint_L_1`, …) and recognizes none of them
automatically (`fable-import-ui/rig-mapping-form.json`, `07-rig-mapping-automatic.png`).
The 19-role mapping was applied through the selects, the project autosaved
(server revision carries `rigMapping`), and a fresh tab reloaded it
(`08-rig-mapping-applied.png`). The editor now says "Automatic — not
recognized" per role and shows a note when body roles are unrecognized
(`src/RigMappingEditor.tsx`, test in `tests/rigMappingEditor.test.ts`).

### Verified through the UI: AI movement intent on the imported, mapped actor

With no assistant provider the offline helper handles "CesiumMan walk to
Round table" (`fable-nav-step4.mjs`). It created a `walkTo` route clip with
`navigation {targetId, movement:"walk"}` on the bundled Quaternius Walk
transferred to Cesium, and disclosed the two unsupported
`ShoulderL/R.position` channels in the viewport
(`fable-nav-ui/walk-to-table-scene.json`, `replan-after-move-*`).
Moving the actor before playback replanned the saved intent from the new
position (5.2 s, 8 points) without touching the other clips.

### Implemented: oversized detours from isotropic body clearance

Moving the Monstera onto that route (`fable-nav-obstacle.mjs`,
`static-plant-on-route*`) made the planner widen every footprint by the
walker's full swing extent (0.75 m, saved as `navigation.clearance`), which
closed the gap between the plant and the table and produced a 14-point,
9.8 s loop along the back wall ending on the far side of the table
(`static-plant-on-route-scene-after.json`, trace in
`static-plant-on-route-trace3-navtrace.json`). The trace also shows the
escalation jumping straight to the full extent after learning Leo's animated
footprint, although replanning with that footprint alone would have sufficed.

Fixes, all in shared code: `inspectRouteClearanceSteps` now also measures the
body's half-width across its facing (`lateral`, from the per-bone collider
boxes projected on the right axis of `rigHeading`); `automaticRoutes.ts` and
`nativeNavigation.ts` first replan with a newly learned animated footprint at
the same width, otherwise widen to the lateral width, and only then (or once
the same obstacle conflicts again) to the full extent. The mesh sweep still
verifies every candidate. Regressions: `tests/automaticRoutes.test.ts`
"passes beside an obstacle at the body's width across its facing" (a 0.8 m
reach along the facing now yields clearance 0.5 instead of 0.6 and a shorter
verified route; the 1.8 m bar test keeps its 0.9 m width). Result in the app
(`static-plant-final-scene-after.json`, `static-plant-final.mp4`,
`static-plant-final-sheet.png`): clearance 0.4, 9 points, 4.18 s, around the
plant's near side to the table's west side; the sweep found no contact.
Rejected: a "shortest comfortable turn" selection in
`shared/routeApproach.ts` and a heading-wrap fix in its bend metric were
tried; they did not change this scenario and were reverted to the handoff
copy. The wrap bug remains a lead (a reversal scores ~76 rad/m).

### Implemented: playback resumes after a replan

Pressing Play while "Planning a clear route…" paused playback and dropped
the press. `Viewport.onNavigationSettled` now fires when planning finishes
and `App.resumeAfterNavigation` restarts a manual playback it paused (cast
conversations keep their own resume). UI evidence: the obstacle scenarios
below continue from the paused time.

### Verified through the UI: obstacle moved during playback, destination moved

`moved-during-play*`: the plant moved onto the remaining route at 2.8 s;
playback paused for the replan (~4 s wall on SwiftShader), resumed at 2.9 s
on a new 6-point route around the plant, clearance 0.4, no rewind. Note the
geometry is replanned from the clip start; the first lead segment coincided
here, so no visible displacement, but a mid-route replan can move the actor
when the new path differs early — not yet guarded.
`destination-moved*`: moving the round table at 3.0 s replanned to its new
position (4.69 s, endpoint 1.2 m from the moved table), resumed at 3.1 s.
`collision-setting-log.json`: default on; toggled off, saved, reloaded off;
toggled on again; a scene file lacking the field opened through the real file
chooser loads on.

`blocked-start*`: with the plant moved onto the actor's own footprint the
viewport reports "CesiumMan stopped before a blocked route: Move the character
clear of Monstera…", playback runs with the route held (the actor does not
walk through the plant) and the saved route and `navigation` intent are
untouched; moving the plant away clears the message, replans from the retained
intent (to the table's current position) and plays. A destination with no
visibility route at all could not be staged in the café through the UI.

Not UI-verified this session: the "no clear route" variant of a blocked
destination (function-level coverage only), native-duration/explicit
rate/duration-edit checks and exported-GLB playback on this UI scene, and
foot/skin clearance inspection of the detour at close range. Captured videos
are wall-clock paced from a slow headless renderer, not 1× recordings.

Final checks: `npx tsc -b`, prettier on the changed files, `git diff --check`,
full suite **1,032 tests in 91 files** (`/tmp/scene-animation-review/fable-suite-3.log`),
isolated build `/tmp/scene-animation-review/fable-build`.

## Mid-route replanning, stopped routes that recover, and 1× evidence

Third Claude session, following the continuation section of
`docs/FABLE_NEXT_TASK.md`. Runtime: private API 4411, review vite now **4524**
(`test-results/fable.config.ts`; 4513–4523 were used and killed). Suite:
**1,044 tests in 92 files** (`/tmp/scene-animation-review/fable-suite-5.log`),
`tsc -b`, prettier, `git diff --check`, isolated build
`/tmp/scene-animation-review/fable-build-2`.

### Implemented: a replan during playback keeps the body where it is

Reproduced first at function level: after 40 % of a straight route, placing a
crate ahead or moving the destination and rebuilding the plan moved the body
by more than 5 cm at that same time (`tests/automaticRoutes.test.ts`
"replans … during playback without moving the body at the current time",
the `rebuilt` assertion). Fix, shared: planning takes the timeline time of
the edit (`prepareAutomaticRoutesAsync({ at })`, passed by the viewport as
`live.current.time`). A route that is being played keeps the Catmull-Rom guide
points its travelled curve depends on (`shared/path.ts#retainedPathPrefix`:
the span containing the current distance plus the two points after it, so
the played curve is byte-identical) and the remainder is planned from the
last kept point along its tangent (`RoutePrediction.resume`,
`routePlanner.ts#resumedRoute`), then expressed in the clip's own frame.
Travelled distance for imported routes comes from the same
`sampleRouteLocomotion` mapping playback uses, so cadence and source phase
are unchanged. Tests: obstacle ahead and moved destination after partial
travel (poses identical to 1e-9 at and before the edit time, pace unchanged,
sweep clear, stable on re-plan), and superseded jobs ("applies only the newest
plan when edits arrive while an earlier job is still running").

UI measurement (`fable-replan-ui/bend-obstacle-*`, `test-results/fable-replan-bend.mjs`,
`fable-pose-compare.mjs`): CesiumMan played to 3.7 s (past the first bend),
paused, the Monstera moved onto the later route at (1.22, 1.48). After the
replan settled (6.5 s wall) the saved route keeps its first five guide points
and turns south at (−0.04, 2.26) instead of east. At 2.5, 3.0, 3.5, 3.69, 3.7,
3.71, 3.9 and 4.2 s the root, hips, heading, both foot contact points and the
source clock are identical before and after (all deltas 0.00000 m / rad,
`bend-obstacle-pose-compare.json`); the two paths first differ at 4.5 s
(2.6 cm, the new turn). Scrubbing back reproduces the old motion because the
prefix is the same data; save/reload and export reproduce it because it is
the saved path.

Limitations: the entry/arrival heading blends in `samplePath` are fractions of
the route length, so a replan inside the first 8 % or last 15 % of a route can
change the heading blend slightly (not measured here); a replan within the
last two spans keeps the whole old path and continues from its end.

### Implemented: a route blocked while playing stops where the body is

Before, a block removed the whole clip from the playback scene, snapping the
body back to the route start (seen in the previous session's `blocked-start`
run and reproduced at function level). Now the block is recorded on the saved
clip as `routeStop` (seconds into the clip; `shared/scene.ts`), playback
clamps that clip to its stop time (`shared/clipTiming.ts#routeStopTime`,
applied in `entityPose` and `applyAnimatedEntityPose`), the clip's later
travel contributes only up to the stop (`entityPose` completed-clip root), and
as the last playable clip it holds however far the timeline runs. Later
planning passes keep the same stop (no creeping), and the destination intent
stays on the clip. When a passage opens, planning splits the clip: the prefix
keeps its path, distance-time mapping and `routeStop`, waits through a
`routeHold` until the opening time (or until its own scheduled end when that
is later), and a `:continue` clip with the intent is planned from the standing
body (`routeEndOffset`: the completed stopped clip hands the hip offset of its
stop phase to following clips, so the continuation starts on the body, not on
the route guide). `shared/scene.ts` now accepts `routeHold` on a studio route
only together with `routeStop`. Tests: "stops where it is when its route is
blocked while playing, holds there as the timeline advances, and continues
once a passage opens" (round tables enclose the destination; stop persisted,
held poses identical through 30 s, re-plan keeps the stop, split after the
original end, continuation starts within 1 cm of the held root, reaches the
destination, sweep clear, stable) and "continues a stopped route at its
scheduled end when the passage opens earlier".

A start that lies within clearance of furniture but not on it may now step
out of that clearance (`findRoute(…, exitOccupied)` → `routeWithApproaches` →
`startMayExit`); a start on the furniture itself still asks the creator to
move the character. Test in `tests/navigation.test.ts`.

UI (`fable-blocked-ui/blocked-recovery-*`, `test-results/fable-blocked-recovery.mjs`):
five round tables enclose the destination except its west side; Mila was
moved out of that side. Played to 3.25 s, the sixth table closed the west
side: "There is no clear stopping place at this destination", `routeStop`
1.233 recorded, intent kept; played on to 6.65 s (the route would have ended
at 4.085 s) with the body held; opened the side: prefix 4.633 s with
`routeHold` 2.548 and `routeStop` 1.233, continuation 2.051 s with the intent,
played to 8.65 s; scrubbing back and a reload keep the split. Pose continuity
at the resume (`blocked-recovery-poses.json`, 6.59 → 6.61 s): hips
(−1.600, 0.842, 1.212) → (−1.601, 0.842, 1.212), both foot contacts
unchanged; the route root itself shifts by the continuation's own phase-0
hip offset, which is why the body, not the guide, is what stays put.

Remaining: the stop freezes whatever stride phase the body had (a
mid-swing hold is visible in the 1× video below); choosing the last contact
phase for the stop and a matching start phase for the continuation is the
next natural-motion step. The "Move the character clear" message still
appears when an obstacle is dropped onto the body itself.

### Implemented: planning no longer stalls or thrashes behind a held body

Planning with a held (`routeStop`) actor took 40 s per 120 samples because
`routeLoopPose`, `routeFootPlanting` and the route-end-heading cache each
kept one entry per body keyed by scene object; the planning sweep's
evaluation scene and the viewport's playback scene alternated every call and
recaptured loop closures each time. Each cache now keeps four recent entries.
A settled plan that changes nothing also renders once, so a paused viewport
shows the result instead of "Planning…" forever.

### Implemented: learned clearance no longer inflates later routes

`navigation.clearance` stays on the saved route as the width that plan needed
and is used to recheck that saved path; a fresh plan (destination moved,
saved path no longer applies) starts narrow and widens only by what the sweep
measures now. Test: "does not let a width learned for one obstacle inflate
later routes once it is gone" (fails before: clearance stayed 0.35).

Also fixed: `objectRouteGoals` added the clearance along the ray instead of
to the footprint half-size, so diagonal stopping places sat inside the
expanded footprint and were discarded; with enclosures this produced "no
clear stopping place" where a free place existed.

### Playback-resume logic now has unit coverage

`src/playbackTransport.ts` holds the transport state the App used inline:
`tests/playbackTransport.test.ts` covers resume after planning, no start when
nothing was playing, explicit pause/stop cancelling the queued resume, a Play
request during planning resuming exactly once, and conversation/project-switch
ownership.

### 1× video, export and timing checks on the saved UI scene

`test-results/fable-record-1x.mjs` samples the real viewport through the
timeline scrubber at deterministic scene times and encodes at that rate
(20 fps, the scrubber step): `fable-1x/blocked-recovery-1x.mp4` (0–8.7 s,
175 frames, overlay shows scene time) and `blocked-recovery-1x-sheet.png`.
This is a true 1× playback of walk → stop → hold → continue.

`test-results/fable-export-check.mjs` exported the same saved scene as a
production package through the Export modal (zip in the private API's
`exports/`, 17 files, `scene.glb` 7.5 MB) and compared the exported
animation with the live runtime on off-key times 0.613–8.431 s: hips ≤ 0.06 mm,
sampled skin ≤ 0.08 mm (`fable-export/blocked-recovery-offkey-parity.json`);
on-key times are exact.

`test-results/fable-timing-check.mjs` on CesiumMan's own imported take: native
1× samples source = timeline (2 s take); explicit 2× samples source 2t and
holds the final frame after 1 s; duration 3 s at 2× holds for 2 s without
stretching; restoring 1×/2 s returns the native sampling
(`fable-timing/timing-result.json`, panel screenshot).

Not done: the original ActorCore motion-dummy/Party-Woman visual comparison,
running, turns, arrivals and waits remain untouched by this session.

## Codex takeover: frozen waits beyond a minute and export boundaries (2026-11-01)

The user asked Codex to finish the goal after Fable’s fourth-session status.
Fable’s ActorCore batch completed (`actorcore-batch.log`, BATCH DONE); no live
batch was restarted. Its eight videos exist under `animation-verification/actorcore-acceptance`.
The inherited full suite plus the new long-wait tests passed 1,065/94; after the
export-boundary regression it passed 1,066/94. These are functional checks,
not a statement that all animation is visually accepted.

### Shared fixes implemented after the takeover

- A stopped studio/imported route without a measured standing take used to
  reject recovery beyond 60 seconds. Reproduced at 60.1 and 125.25 seconds.
  `routeWait` clips now preserve the earlier stopped pose across additional
  bounded timeline slots, contributing no duplicate travel or heading.
  `routeStopTime` is shared by studio evaluation and loaded preview/export.
  The original route mapping stays fixed through `routeActive`; destination
  intent stays on the continuation. The saved scene validates after reload.
  A remainder shorter than the schema’s 0.2-second minimum may extend a wait
  by that fraction when its stopped prefix cannot be shortened further.
- Deleting the stopped prefix deletes its dependent waits; reordering moves
  the stopped route/waits together. Missing/mismatched hold references are
  rejected. Waits have a distinct timeline/details label and do not offer
  gait-speed or path-edit controls.
- Standing measurements cached by source take used to retain a previous
  library motion’s identity. Reusing the loaded rig under a new source/motion
  ID returned the old ID. A failing regression now passes: physical measurement
  reuse returns the current scene’s motion descriptor.
- Export explicitly samples `routeStop`, including off-grid instants. Frozen
  wait slots contribute their boundaries without generating irrelevant gait
  source keys. The new boundary test failed before this change.

### Real app / saved package evidence

Isolated Vite 4527 → API 4412, later UI review 4528; copied private data at
`/tmp/scene-animation-review/astra-data`. The original user app and production
`dist/` were not changed. Isolated build: `/tmp/scene-animation-review/astra-build`.

`captured-continuations/astra-long-wait/` contains the generated, saved and
reloaded scene, world-joint samples, actual UI screenshots at minute boundaries
and restart, and the exported package/GLB comparison. The source is the bundled
rig registered as an independent custom asset with only its walking take in
that source’s catalogue: it intentionally has no eligible standing performance.
This is a fallback test, not an additional independent provider.

A route stopped at 1.95 seconds recovers at 125.25 seconds, represented by a
60-second stopped prefix, 60- and 5.25-second frozen waits, then a 3.511-second
continuation. Frozen root/body/hand/foot poses are unchanged in regressions;
the UI reload retained the wait references and emitted no console errors.
The Export modal produced a real production package. Off-key samples around
the stop, 60/120-second seams, and resume differ by at most 0.05 mm on sampled
skin and below the report’s 0.01-mm rounding on hips. See
`astra-long-wait/export/long-wait-parity.json`. Check scripts are
`test-results/astra-long-wait.mjs` and `astra-export-check.mjs`.

### Visual review still in progress at this checkpoint

Fable’s hand/foot cameras put portions of the receiver outside the frame.
Those close-ups cannot establish detailed acceptance. Independent camera panels
were added to the ignored comparison driver; corrected 30-fps 1× videos are
`actorcore-acceptance/astra-walk-hands-1x.mp4`, `astra-walk-feet-1x.mp4`, and
`astra-talk-hands-1x.mp4`. Sampled frames show the gestures and articulated hands
on both rigs. The user has been invited to review the full-body/hand videos.

The current original project differs from the supplied October video: it now
contains two Party Women, a bench, and one bundled-Walk route. A read-only
snapshot and isolated copy are under `captured-continuations/astra-user-scene`;
no current user scene was overwritten. Its copied real UI loads without warnings.
Do not label its new recording as an exact before/after of the older video.

To close the human-running evidence gap, original CMU subject 02 trial 03
(run/jog, 120 Hz) is being tested through the existing GLB/mapping boundary.
Raw capture, private capsule visualization, provenance, conversion and hashes
are under `animation-verification/cmu-run`. This extends independent source
coverage; it does not introduce ASF/AMC import support or guarantee arbitrary
future skeletons will auto-map. Human running review, current saved-scene
recording review, and final natural-motion acceptance are still pending here.

### Final takeover validation and authoritative comparison evidence

The final implementation passed **1,066 tests in 94 files**
(`/tmp/scene-animation-review/astra-complete-suite.log`), TypeScript, formatting,
`git diff --check`, and `/tmp/scene-animation-review/astra-complete-build`.
The build retains the existing large-chunk advisory. No production build,
commit, merge or deployment was performed.

Additional editor checks preserve the route/wait group during reordering,
remove dependent waits when their stopped route is removed, and preserve wait
references when an explicit path edit forks a shared motion. Splitting a stopped
route with dependent waits into point actions requires removing those waits
first, with an explicit error. The duration control retains the original travel
clock when shortening/extending a stopped slot and prevents trimming before its
stop. The actual UI verified 60 → 50 → 60 seconds, reorder/restore, and autosave.
`astra-long-wait/ui-controls.json` and `wait-controls.png` record the controls.
One fresh-origin run logged an unidentified initial 404; a follow-up page load
had no log errors, no motion warning and loaded the saved actor. Earlier
save/reload/export checks were also clean.

The initial comparison driver reused the displayed source actor as the
receiver’s internal motion source. Sampling the receiver could therefore alter
the displayed reference after its route corrections. **This was an evidence
fixture defect, not a newly established application defect**: Viewport loads
separate source rigs. The final driver now does the same. A preliminary CMU
route fixture also mutated a path after compilation, reusing a cached length;
it now creates a new path object. Preliminary comparison runs must not be used
as fidelity measurements.

Authoritative ActorCore files under `animation-verification/actorcore-acceptance`:

- `astra-walk-body-final-1x.mp4`: entire 34-second take, 30 fps, 1,021 samples.
- `astra-walk-hands-final-1x.mp4` and `astra-walk-feet-final-1x.mp4`:
  seconds 8–16, 30 fps, 241 samples each.
- `astra-talk-hands-final-1x.mp4`: seconds 4–14, 30 fps, 301 samples.

All four have **zero source-clock difference** between the displayed original
and receiver. Their frame sheets were inspected, including full-body gesture,
hand articulation and foot views. They retain 100 matched joints with no
unsupported channels for these ActorCore pairs. Supported detail and source
pose changes are visible; this is not a proof of universal perceptual quality
or self-contact correctness on every possible body shape. The user was offered
comparison videos for perceptual feedback; no response has arrived yet.

The independent human-run result is `animation-verification/cmu-run/curved-run-final-1x.mp4`.
The 1.433333-second capture runs at native source timing, with receiver route
length scaled to its measured proportions so both rigs sample the same phase.
Source-clock difference is zero. Parsed GLBs at off-key times have maximum
bone/skin error **0.068807/0.069510 mm** (original) and
**0.082066/0.081480 mm** (receiver). The four unmatched channels are explicitly
reported: thorax, upperneck, lhand and rhand rotations. They are not silently
counted as preserved, and the source’s uncaptured finger/thumb channels were
not invented. This one-off capture is not a seamless repeatable run; the measured
loop warning remains. It does not waive the earlier stylized-source running
reach/contact residuals documented above.

The current user-scene copy was recorded through the real UI at 20 fps:
`captured-continuations/astra-user-scene/saved-party-woman-route-1x.mp4`.
Its source snapshot is preserved there. The actor’s explicit “Hold the final
pose” ending is retained; this recording is not evidence of a newly generated
natural arrival. The older supplied video and current project differ, as noted
above. Fable’s natural-stop body/feet sheets were also inspected: the Cesium
actor settles standing through the blocked interval and resumes; background
Leo collision warnings remain in that demonstration scene and are not a clean
whole-scene collision acceptance result.

Current isolated UI: **4529 → 4412**, data `/tmp/scene-animation-review/astra-data`.
The latest source remains uncommitted. The implementation pass and the specific
verified flows above are complete; the overall “pixel-perfect on all imported
models and paths” goal is **not certified complete** by these checks. Unknown
rigs can require explicit mapping; unavailable compatible standing/stop takes
retain the disclosed safe frozen fallback. Perceptual acceptance and the
previously documented remaining physical limits must remain explicit.


### Final running-reach fix — 2026-11-01

The earlier 11–29 mm running reach residual was an application defect, now
fixed in the shared `src/routeFootPlanting.ts` landing preparation. Fitting was
triggered only when a correction exceeded its distance allowance. A correction
within that allowance could still exceed the physical reach of a nearly
extended leg. Every measured physical reach disk now also triggers fitting
when the original landing lies outside it. The existing bounded landing/swing
solver, bone lengths, support limit, source clock and route remain unchanged.
There is no provider/model-name condition and no relaxed threshold.

A new synthetic regression in `tests/routeContacts.test.ts` failed before the
change: a leaning leg lost ground contact while every correction remained
within its distance allowance. It now keeps the stance planted and reachable
through the full interval. The isolated always-fit diagnostic established the
cause first; the source fix only fits when an actual constraint is violated.
The diagnostic transform is confined to ignored `test-results/astra-running.config.ts`;
it is not used by the final runtime.

Full-motion samples at 500 Hz on the same curved Run paths, unchanged native
source timing (0.875 s and 1.925 s), before → after reach loss:

| Rig | Cycles | Before (mm) | After (mm) |
| --- | --- | --- | --- |
| Original Quaternius | 1 | 23.924925 | 0.0000015 |
| Original Quaternius | 2.2 | 29.301592 | 0.0000598 |
| Party Woman | 1 | 11.106867 | 0.0000049 |
| Party Woman | 2.2 | 13.563879 | 0.0002521 |

All four have zero correction-distance loss. The curved-versus-straight
stance comparison now has receiver Run residual below 0.000001 mm, versus
6.220/6.536 mm previously. Original Run retains 0.214/0.275 mm residual; this
is not a claim that every measured displacement in a source take is zero.
The old microscopic loop derivative observations are unchanged, including
native Run's 1.75-second finite-h result (5.59 mm/s). They are not recast as
fixed by this change.

Eight native/transferred Walk/Run cases (one and 2.2 cycles) pass off-key GLB
bone/skin parity, with maximum skin deviation 0.113069 mm; source-clock error
is at most 6.7e-16 seconds and reverse-scrub position error is zero. No motion
warnings were emitted. `captured-continuations/astra-running-export/results.json`
contains every case. Baseline and fixed whole-motion reports are in
`astra-running-baseline/results.json` and `astra-running-fixed/results.json`
under the same captured-continuations directory.

`astra-running-fixed/run-reach-fixed-1x.mp4` is the independent-source-rig
comparison at 60 fps (117 frames, 1.925 seconds). The full-body frame sheet
was inspected; arm/leg phase and flight remain aligned, with no new visible
pose collapse in those samples. This stylized source is not relabelled human
mocap; the independent CMU running evidence above remains the human-capture
comparison. Video/rows/summary and sheet are retained together.

Final source verification: **1,067 tests / 94 files pass**, TypeScript,
formatting and diff check pass. Build is isolated at
`/tmp/scene-animation-review/astra-reach-final-build` (existing chunk-size
advisory only). Logs: `astra-reach-before.log`, `astra-reach-after.log`,
`astra-final-reach-suite.log`, `astra-running-fixed.log`,
`astra-running-export.log`, `astra-running-video.log`, `astra-reach-build.log`
in `/tmp/scene-animation-review`.

Final uninstrumented review runtime: **4531 → 4412**. User services 4311/4337
and original scene data were not changed by this verification. This closes
the specific earlier running reach/contact defect; the general import caveats
remain: a supported humanoid hierarchy/explicit mapping is required, unsupported
channels are disclosed, and no compatible standing take means a safe frozen
wait rather than an invented idle performance. Perceptual feedback on the
provided videos is still welcome; arbitrary unseen rigs are not certified by
these representative cases.

### Captured curved-walk ground refinement (2026-11-01)

Ground support had an iteration-count discontinuity: a tiny reach-limit result
could suppress the second vertical leg solve. Both passes now retain the original
reach envelope while keeping separate correction budgets. Real Pirate Male/Female
regressions catch the nearby knee step at two-microsecond intervals and reverse
seeks. Scaled synthetic fixtures verify knee reserve, foot orientation, bone
lengths, and reachable corrections requiring both passes.

The final 140-case straight/curved walking/running comparison covers 23,870 full
motion timestamps. Route position and source clock are unchanged; repeat position,
rotation and sampled skin checks pass. Maximum finite-difference velocity residual
falls from 1.631317 to 0.027001 m/s. Some knees change away from the repeat: up to
33.797 mm where a formerly skipped second solve now completes more of the ground
correction. Party Woman retains more knee bend (up to 20.685 mm knee change) instead
of spending its reserve twice. These are intentional pose changes, not an assertion
that every pose is identical.

Normal-speed before/after comparisons for Pirate, Casual Bald and Party Woman,
full reports, and diagnostic traces are retained under the ignored
`.data/natural-motion-investigation/pirate-curves/` archive. Curved-route GLB reload
matches app joints/skin within 0.044 mm across 457 samples. A rejected implementation
that inadvertently shared the correction budget across passes is isolated under
`rejected-distance-budget/`; its reports are not final. This milestone fixes contact
continuity; natural source quality and complete arrival/wait behavior remain open.

### Preserve incoming performances through smooth joins (2026-11-01)

Smooth joins now decay the boundary pose difference over the live incoming take,
with a bounded transient velocity correction. They no longer blend each live
frame toward a frozen outgoing pose. Consecutive same-source/same-rate native cuts
preserve the original performance's own keyframe velocity changes. Root travel
and source clocks remain governed by the timeline. Existing cuts and held endings
remain explicit; this change does not make an unsuitable source performance human.

A route handing off to a trimmed native stop now retains the full capture's
vertical reference and supports the final deformed soles against the route floor.
The offset survives subsequent cuts. Positive clearance remains source-authored.
Three actual Party arrivals previously sank 46.6–57.6 mm; final sampled clearance
is numerical noise, with identical horizontal travel/time. Residual joint velocity
mismatch remains at these handoffs (.225–.466 m/s in the dense boundary probe), so
perfect velocity continuity is not claimed for the composed contact system.

Normal-speed comparisons, final export checks and reproduction details are in
`docs/NATURAL_MOTION_CONTINUATION.md` and the ignored evidence archive
`.data/natural-motion-investigation/transitions/`. The ActorCore-to-Party split
comparison drops from 84.357 mm sampled-skin discrepancy to .0000215 mm. Casual
Female retains a separate frame/attachment defect (up to 17.527 mm sampled skin)
that still needs correction. Full suite: 1,126 tests across 97 files; tests support
the fidelity claims but do not establish that the overall natural-motion goal is
complete.

### Receiving-frame fidelity through trimmed takes (2026-11-01)

Shared playback now rebases the entire imported receiving bind hierarchy to the
selected source frame before solving detailed joints. Rebasing only mapped
orientations left off-center pelvis origins and ancestor controls in a different
frame, damaging poses and skin when one original take was split into clips.
Application overlays outside the saved bind hierarchy are excluded.

A140-case source/receiver matrix now preserves the split performance within
.000036mm on every sampled joint and .000026mm on sampled skin; the real Casual
regression also checks every skin vertex. Native original performances are
unchanged. The recorded full scene exports/reloads within .054mm. Normal-speed
comparison and reproduction details are in the continuation brief and ignored
`transfer-frame` evidence archive. This resolves the previously documented
Casual split-frame discrepancy; it does not establish universal naturalness.

The actual Original performance UI has a separate verified timing defect still
open: Viewport's .1-second delta cap slows playback below10fps. A private-tab
200ms frame-delay probe advanced1.4source seconds during3.0001wall seconds while
the UI advertised1×. Correcting that clock, including loop and dialogue behavior,
is the next priority. No clock implementation change is included in this fix.

### Actual preview timing and framing (2026-11-01)

The clock defect documented above is now corrected: playback uses elapsed wall
time, retains loop remainder, and treats explicit seeks separately from delayed
React publications. Audio still owns intentional speech holds; large frame gaps
cannot skip an audible line or instantly time out a newly started request.
Action previews follow horizontal performer travel while preserving the chosen
orbit/zoom and the performance's vertical motion.

Actual UI captures compare frozen af59daf to corrected playback under200ms render
delays: steady source rate improves from .4894x to .9994x. Unrestricted original
playback measures .9980x. Eight-second timestamp-preserving UI videos, including
an unrestricted imported original performance, are in the ignored `playback-clock`
evidence archive. These verify timing and framing; natural source quality and
remaining start/stop/retargeting work are still open. See the continuation brief
for exact reproduction, limits and final validation.
