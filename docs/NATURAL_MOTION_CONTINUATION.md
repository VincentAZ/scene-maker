# Continue the natural-motion goal in this worktree

The user requested either autonomous work in a clean worktree or a self-contained
prompt for a fresh session. This is that isolated worktree and continuation brief.
**The natural-motion goal is NOT complete.** Do not report it complete from tests.

## User requirement and latest rejection

All animation must look human and natural, including the original action preview.
The user has rejected the current result as robotic and unnatural and now says:
“Play the original walking take — is the first failure. Every single action looks
fake in preview mode. We need a solution here.”

Reference recording:
`/home/vincent/Videos/Astra-long-wait-2026-11-01-203903.mp4`.
Earlier requirement:
`/home/vincent/.codex/attachments/7c02869b-dc29-4389-84bd-1acf319b5125/pasted-text-1.txt`.
Read both the requirement and this brief before making changes. User feedback
overrides prior “passed” summaries. The user expects practical results, not more
numerical tests presented as visual proof.

## Workspace and protected state

- Work only in `/home/vincent/Repos/scene-maker-natural-motion`, branch
  `fix/natural-motion-baseline`.
- Baseline commit `0e2a54c` contains the previous workspace's current implementation,
  including Fable's work. It was copied and hash-verified, then committed on this
  isolated branch. This is a clean starting checkpoint, not a rewrite of main.
- Do not reset, clean, commit, or overwrite `/home/vincent/Repos/scene-maker` or
  `/home/vincent/Repos/scene-maker-dialogue`. Main has substantial intentional
  uncommitted work. Do not change user services 4311/4337.
- The user edited `astra-long-wait` in the earlier private runtime. It is now a
  user project, not a disposable fixture. Do not overwrite it or its source data
  in `/tmp/scene-animation-review/astra-data`.
- This worktree's disposable copy is `/tmp/scene-natural-motion/data`.
  Private API is 4413, Vite 4542, owned headless Chrome 9451. Confirm availability
  before use. The API startup log incorrectly prints 4311 regardless of PORT;
  inspect the listening socket instead of trusting that message.
- Vite uses `test-results/natural.config.ts`, with HMR disabled. Start a fresh
  unused port after runtime edits. Keep builds in `/tmp/scene-natural-motion`.
- Dependencies are ignored local links to installed packages. No secrets or
  licensed user assets were added to Git.

## What was established in this investigation

1. The actual recorded scene used bundled Quaternius `Walk` on Party Woman,
   not an ActorCore walking take. The character's provider does not determine
   the selected animation source.
2. The shipped library is 17 stylized authored Quaternius clips plus 15
   procedural actions. It is not a curated human motion-capture library.
   See `docs/MOTION_ASSETS.md` and `docs/motion-source.json`.
3. Existing Preview was NOT an original-source comparison. It played a take
   on the selected avatar, or on a sample female character. The earlier test
   instruction therefore conflated source performance and retargeting.
4. A direct raw-bank comparison sampled all 17 takes on 23 original joints.
   Compared with the original Casual_Male.gltf, bundled local positions/scales
   match exactly, and max normalized quaternion angle is 6.664e-8 radians.
   Durations match. This rules out lost joint animation in that conversion at
   those samples. It does not prove visual quality, rendering correctness, or
   arbitrary retarget fidelity.
   - Raw source: original workspace `.data/sources/quaternius/Casual_Male.gltf`.
   - Driver: `test-results/raw-bank-parity.mjs`.
   - Report: `/tmp/scene-natural-motion/raw-bank-parity.json`.
5. A new human walking reference was obtained from CMU Graphics Lab subject 08,
   trial 01, 120 Hz. Its 277 frames span 2.3 seconds. It is a private evaluation
   fixture, not a shipped default or a new ASF/AMC app importer.
   - Raw sources: `https://mocap.cs.cmu.edu/subjects/08/08.asf` and
     `https://mocap.cs.cmu.edu/subjects/08/08_01.amc`.
   - Official catalogue: `https://mocap.cs.cmu.edu/subjects.php`.
   - Raw/converted files, mapping, hashes and 60-fps comparison are under
     `/tmp/scene-natural-motion/cmu-walk/`.
   - Converter: `test-results/convert-cmu-walk.mjs`, adapted from the prior
     private CMU converter; excludes uncaptured finger/thumb channels.
   - Movie: `captured-walk-native-1x.mp4`, original skeleton left, Party Woman
     right. Source rigs are independent; no shared mutable displayed source.
   - Receiver reports 21 matched joints and 4 unsupported rotations:
     thorax, upperneck, lhand, rhand. Do not call those preserved.
   - The raw downloads used per-command `curl -k` after the previous session's
     certificate-chain failures. No credentials or persistent TLS changes.
     Source rights have NOT been established for redistributing an animation
     bank; verify official terms before shipping any new capture assets.

## Implemented in this worktree

- `shared/actionPreview.ts`: explicit character/original view. Original imported
  takes run on a private source-asset alias using native playback, with 1× timing
  and no transfer. Aliases and motions exist only in the disposable rehearsal.
  The reserved internal source ID stays protected. Paths are not presented as
  raw original takes by this comparison control.
- `src/ActionPreview.tsx`: **Original performance** / **On [character]** controls;
  same timeline time across switches; pauses while switching; clear labeling.
  The Add button still targets the user's selected avatar, not the source rig.
- `shared/scene.ts`: allow the exact existing bundled action-bank URL as a custom
  asset reference for the private rehearsal alias, without relaxing arbitrary
  URL validation. Explicit boolean return annotation avoids a circular inferred
  Asset type.
- `tests/motionLibrary.test.ts`: native-source timing and joint-transform parity,
  no retarget dependency, no project mutation, arbitrary imported-source naming
  and alias collisions.
- Private project `natural-motion-baseline`, name **Natural motion baseline —
  candidate**, contains Party Woman playing the CMU take. It was saved only to
  API 4413's copied data. The main/default action bank has NOT been replaced.

Validation: **1,068 tests / 94 files**, TypeScript, diff check and isolated build
pass. Build retains the existing chunk-size advisory. Actual UI checked bundled
and CMU previews: same 0.63-second scrub position, native source switch, return
to avatar, Play/Pause, correct Add recipient, no console errors, unchanged
project content. Normal app autosave can increment revision without content
changes; the UI check excludes revision only after comparing scene content.
Logs and screenshots: `/tmp/scene-natural-motion/`.
Scripts: `test-results/preview-ui.mjs`, `captured-preview-ui.mjs`,
`captured-walk.mjs`, `create-baseline-project.mjs`.

## Next work: solve the visible problem

The user was asked whether the 2.3-second CMU candidate looks clearly more
natural, still unnatural, or needs a longer/closer view. No answer had arrived
when this brief was written. Do not assume approval from silence.

1. Inspect the user's recording and the candidate at normal speed. Get a useful
   close body/feet view and longer evidence if needed. The source reference must
   look natural before building more route/contact corrections around it.
2. Separate defects with controlled comparisons: raw original → app original
   preview → same take on receiver → straight route → curved route. Preserve
   take identity, source phase, rate and camera. Do not blame a provider or the
   source without this evidence.
3. Choose and implement the appropriate solution: preserve source data if the
   renderer/transfer damages it; establish suitable captured performances for
   defaults if stylized/procedural source behavior is the problem. The likely
   library direction is a curated natural-performance bank, with stylized and
   procedural choices explicit rather than silently serving as realistic walks.
   This is a hypothesis/design direction, not an accepted completed fix.
4. Do not merely add labels, preview controls, or a new test count and stop.
   Deliver visibly better human motion in the actual app. If a replacement
   library is needed, establish usable source rights, provenance and actual
   quality before shipping; never substitute private licensed ActorCore files
   into a redistributable bank without authority.
5. Changes must cover supported models and motions from dozens of providers:
   measured transforms, topology and explicit mapping, not provider-name hacks.
   Preserve hands, wrists, feet, twist/facial motion where representable; disclose
   unsupported channels. Do not invent uncaptured detail or silently call a
   procedural action motion capture.
6. Only after the base performance passes, verify native-speed walking/running,
   bends, starts/arrivals, waits and transitions. Keep collisions default-on with
   an explicit saved off toggle, AI obstacle detours and dynamic replanning,
   no rewinding played poses, long blocked waits/recovery, and preview/export
   parity. Preserve the earlier fixes; do not trade them away to make a demo.

Do not ask the user to repeat the whole test matrix while basic movement fails.
Own reproduction and fixes. Show honest 1× samples for feedback. Never claim
“pixel-perfect on every import” from numerical tolerances or selected frames.

A durable ignored copy of the evidence and verification scripts is in
`.data/natural-motion-investigation/` within this worktree. Use it if temporary
files are unavailable; the separate API data copy is not included in that
evidence archive.

## Continuation update — longer capture and hand mapping (2026-11-01)

Previous turn classified as **progress**: original-preview controls, source parity
and candidate evidence existed. This turn also made progress, not completion.

- Services were absent, so restarted only isolated API 4413, fresh Vite **4543**,
  and owned Chrome 9451. Current exec handles: API 53392, Vite 68832, Chrome
  40524. Revalidate them before relying on these handles.
- Added tracked `scripts/prepare-cmu-motion.mjs`, an offline evaluation converter
  accepting `<directory> <subject_trial>`. It retains the existing converter's
  120 Hz samples without filtering or timing changes, checks its supported
  ASF root/unit convention, and records input/output hashes. Not an app importer.
- Fixed the evaluation mapping: CMU `lwrist/rwrist` are forearm segments with
  axial rotation; `lhand/rhand` contain hand flexion and are the anatomical hand
  origins. The old fixture mapped the upstream node and omitted hand flexion.
  The app's world-orientation transfer now receives downstream hand orientation.
  This corrects the **fixture**, not the user's original Quaternius playback.
- Acquired CMU 69_06 (walk and turn, repeated): 5,213 frames at the official
  catalogue's 120 Hz = 43.433333 seconds. Directory:
  `/tmp/scene-natural-motion/cmu-turns/`. Includes ASF/AMC, converted GLB,
  mapping, hashes, official catalogue HTML, and official rendered `69_06.avi`.
- New isolated project `natural-motion-long-capture`, revision 1, contains the
  full take at explicit 1x on Party Woman. Existing baseline and user project
  were not overwritten. API copy uses `uploads/cmu-walk-69-06.glb`.
- Normal-speed evidence: `cmu-turns/walk-turns-body-1x.mp4`, 12 seconds at 60 fps,
  native original skeleton left / Party Woman right using app runtime. Source
  and receiver use independent source instances. Report has 21 matched joints,
  four unsupported channel reports, and no GL errors. These are diagnostics,
  not proof of naturalness. Contact sheets were inspected; sequential video
  quality acceptance remains open. Receiver shoes and hand posture deserve
  further close views. The official rendered AVI provides an independent
  source reference for conversion checks (different camera, not time-aligned).
- CMU official FAQ was fetched successfully via per-command curl -k after web
  tool failures: `/tmp/scene-natural-motion/cmu-faq.html`. Its “How can I use
  this data?” section explicitly permits copying, modification, redistribution.
  Source: https://mocap.cs.cmu.edu/faqs.php . Homepage attribution should be
  retained if shipping. No new capture assets shipped in public/library yet.
- Subject 35_01 was also tried but is only 2.975 seconds; its 8-second recording
  includes a long final hold and is **not** evidence of a longer performance.
  Harness now caps recording at take duration. Do not use that misleading hold
  diagnostic (median speed is zero due to held frames).
- Updated ignored `test-results/captured-walk.mjs` accepts `CMU_ASSET` and
  `CMU_MAPPING`; no hardcoded skeleton index mapping. New ignored project driver
  is `test-results/create-long-capture-project.mjs`.

Reproduce comparison:

```sh
FABLE_APP=http://127.0.0.1:4543 CMU_ASSET=cmu-walk-69-06 \
CMU_MAPPING=/tmp/scene-natural-motion/cmu-turns/69_06-mapping.json \
AC_TAKE=69_06 AC_TO=12 AC_FPS=60 AC_TAG=walk-turns-body \
AC_OUT=/tmp/scene-natural-motion/cmu-turns node test-results/captured-walk.mjs
```

Next: scrutinize source/app/receiver at normal speed with feet and side views;
check source conversion against independent official AVI, especially turn timing.
Then solve transfer/contact defects and choose natural defaults. Do not mistake
this added evaluation take for delivery across providers, routes or exports.
All original broad requirements above remain open.

## Continuation update — native/shared vertical-reference fix

The preceding turn was **progress** (longer fixture, corrected hand mapping,
normal-speed evidence). This turn found and fixed an actual app playback defect:

- `applyTransferredClip` removes the source take's initial root displacement,
  just like native playback, but `transferFootClearance` subsequently used raw
  capture-space clearance. This reintroduced the starting vertical offset.
  A source above its bind root floated on transfer; one below it sank.
- `src/footSurface.ts` now accepts an explicit source-origin Y offset (default
  zero for existing route/contact callers); both retargeting branches in
  `src/rig.ts` pass `profile.start.y`. No per-provider branch or animation speed
  change. Native sampled joint curves remain untouched.
- Added end-to-end pose regression cases to `tests/footSurface.test.ts`: native
  versus transferred copies of the same rig, positive/negative starting capture
  offsets, trimmed starts, airborne variation, final holds, reverse scrubbing,
  and placed entity rotation/scale/height. Reproduced failures before the fix.
- CMU 69_06 on Party Woman had roughly **1.98 cm extra sinking** from this bug.
  New 60-fps, 1x feet evidence (source seconds 1–6):
  `/tmp/scene-natural-motion/cmu-turns/walk-turns-feet-fixed-1x.mp4`.
  Before: `walk-turns-feet-1x.mp4` in the same directory. Both retain the source
  left / receiver right layout. At all 301 new frames the scaled native versus
  transferred sole-clearance discrepancy is below 6.5e-10 m. This establishes
  vertical-reference parity, **not** naturalness or no planar sliding.
- Full suite: **1072 tests / 94 files passed**, log
  `/tmp/scene-natural-motion/full-suite-clearance.log`. Existing AI SDK schema
  compatibility warning remains. New Vite ports 4544 and **4545** serve changed
  code. Latest Vite exec handle 7655; API 4413 and Chrome 9451 remain live.
- Updated ignored capture harness includes surface samples in rows. Export
  harness initially failed on a bare `three` import from raw node_modules;
  fixed its imports through Vite's `test-results/animation-entry.ts`. That was
  a harness failure, not an app export result.

Still open: source quality acceptance, default natural bank, planar contacts,
more providers, route/arrival/wait visual matrix, and full visual export review.
The source capsule display is not a captured foot surface, and Party Woman's
heels need explicit visual scrutiny. Do not infer all those requirements from
this targeted clearance fix or from the green suite.

Export check completed successfully after the harness import fix. The full take
was baked and reloaded as GLB; sampled joint/skin errors were <0.000004 m for
Party Woman and <0.00000009 m for the source. Sampling uses the harness's listed
initial timestamps (through 1.6 s), so this is not a full-take pose audit. Report:
`cmu-turns/clearance-export-export.json`; log `clearance-export.log`. TypeScript
and diff checks also passed.

## Continuation update — captured library integration

Prior turn was **progress**: actual vertical-reference bug fixed, regression and
normal-speed evidence saved. This turn adds the captures to the real library.

- Added public CMU 35_01 and 69_06 GLBs, terms/attribution, and full provenance,
  hashes and mappings in `shared/captured-motion-catalogue.json`. They appear
  as **Captured walk** and **Captured walk and turns** in every project's Actions.
  They are not hidden private project fixtures anymore. No licensed user model
  was shipped. Source capsules are visualization geometry, not measured skin.
- Generalized built-in motion source resolution, reserved IDs, exact URL
  validation, studio-library dependency registration, and production packaging
  to handle multiple sources. Legacy Quaternius source/IDs remain unchanged.
  `libraryMotions` remains the legacy authored collection; `capturedMotions`
  contains new entries, both included by `allMotions`.
- Full CMU homepage terms were fetched and saved as
  `/tmp/scene-natural-motion/cmu-home.html`. Important addition to FAQ evidence:
  products may include captures, but the data itself may not be resold, even
  converted. Bundled `cmu/LICENSE.txt` carries that restriction and attribution.
- Real UI verified the bundled **Captured walk** original/Party Woman preview,
  same 0.63-second scrub position, Play/Pause, correct Add recipient, no console
  errors, unchanged saved scene content. Script:
  `test-results/library-captured-preview-ui.mjs`; screenshots
  `/tmp/scene-natural-motion/library-capture-{character,original}.png`.
- New curved-route 1x evidence:
  `/tmp/scene-natural-motion/cmu-long/captured-walk-route-1x.mp4` (2.967 s at
  60 fps). Harness requests 8 s but correctly caps at the actual take duration.
  Full 35_01 measured 4.359 m travel, with a mismatched-foot endpoint warning.
  **Default route gait has not been switched**: repeating the full take is not
  acceptable as a natural default.
- An interval search found ~1.1–1.125-second stride windows with both foot seams
  matched (e.g. 0.4–1.525 s). Results in `cmu-long/stride-candidates.json`;
  driver `test-results/find-captured-stride.mjs`. However all candidates report
  **zero detected contacts**. Investigate source capsule sole geometry versus
  captured foot landmarks before trusting route planting. Do not interpret an
  empty warning as sufficient quality evidence or change defaults from it.
- Private API was restarted to load new catalogue code: current handle 66444,
  port4413. Vite4546 handle80797; Chrome 9451 remains live. A final UI-only badge
  edit requires a fresh Vite port per existing no-HMR practice.

Still required: natural default walking/running and remaining actions, source
contact calibration, provider coverage and all earlier visual acceptance gates.
No success claim from catalogue integration or tests.

Validation for this integration: **1075 tests / 95 files**, TypeScript, diff
check and isolated production build passed. One existing exact catalogue-count
assertion was updated from 32 to 34; new tests cover actual shipped capture
hashes, native source preview/mapping/timing, reserved source IDs, and packaging
with terms. A new test initially hit Vitest's 5-second timeout deep-comparing
multi-megabyte byte arrays; changed it to compare SHA-256 of actual package and
source bytes, then passed. No assertion about visual quality was weakened.
The real UI preview was rechecked on final Vite **4547** (handle 55420).

Fresh normal-speed native evidence uses the **shipped** GLB URL, not an upload:
`/tmp/scene-natural-motion/cmu-long/shipped-capture-native-1x.mp4` (179 frames,
60 fps, source/Party Woman). It ends at the actual take end without a padded
hold. Native render log is `/tmp/scene-natural-motion/shipped-capture.log`.
Artifacts and scripts are also archived under
`.data/natural-motion-investigation/captured-library/`.
Final-port UI run initially logged one unlocated HTTP404 while all preview
assertions passed. Repeated with URL-bearing log capture: no errors, only
headless Chrome software-WebGL deprecation warnings. The original 404 URL was
not retained, so its cause is unproven; do not claim it was a known favicon.

## Continuation update — bounded capture stance detection

Previous turn was **progress**: captured assets reached the actual library with
UI/export integration. This turn investigated the zero-contact result.

- Diagnostic `test-results/capture-contact-diagnostic.mjs` sampled the shipped
  35_01 at 120 Hz, measuring ankles, toes and sole contact points. Output:
  `/tmp/scene-natural-motion/cmu-long/contact-diagnostic.json`. Ankle planar
  speeds at the 25th percentile were about 0.12/0.15 m/s; the original detector
  required about 0.037 m/s to enter stance. Even sole contact points had enough
  jitter/roll to repeatedly interrupt the required 0.12-second support.
- `src/routeContacts.ts` retains its original strict detector and adds bounded
  ground support evidence. A centered 150 ms window must contain at least 100 ms,
  have ground-height evidence throughout, stay within 1.2% of leg height, and
  have endpoint displacement below 1% of leg height. Prefer measured sole
  contact points when present. Reject missing ground evidence, airborne heights,
  nonfinite points and larger travel. Original animation/sample values remain
  unchanged. This is generic temporal/spatial evidence, no provider-name logic.
- `src/locomotion.ts` now passes already-measured sole heights to route-contact
  detection (previously they were supplied only to the native-contact pass).
- A first window implementation accidentally excluded many 60 Hz windows due to
  the minimum duration versus sample spacing. Corrected the window bound and
  numeric tolerance; added both 60 Hz and 120 Hz noisy-capture tests.
- Shipped stride interval 0.4–1.525s now yields 3 contact intervals across both
  feet, versus zero. Regression test checks the actual shipped asset and verifies
  source key arrays remain unchanged. Synthetic tests reject airborne/missing
  height evidence and sliding feet, and check preservation of every raw sample.
- Six native-pace repetitions on a curved route rendered at 60 fps,6.75 seconds:
  `/tmp/scene-natural-motion/cmu-long/stride-route-contact-window-1x.mp4`.
  Same take/range/path/camera baseline:
  `stride-route-before-contact-window-1x.mp4`. Old port 4547 was confirmed to
  serve code without boundedGroundSupport; new 4549 served it. Both 406 frames.
  Native skeleton is left, Party Woman right. No slowing or padded final hold.
- A/B ankle placement differs by up to 4.54 cm on the original and 3.58 cm on the
  receiver. Lower-foot median planar speed improves on the source but is
  unchanged on the receiver (~0.170m/s); p 90 increases slightly. These crude
  statistics include swing and are NOT proof of reduced skating. Inspect
  actual stance trajectories and loop boundaries before claiming naturalness.
- Full suite before the final nonfinite-point guard: **1078 tests /95 files**,
  log `/tmp/scene-natural-motion/full-suite-contact-window-final.log`.
  Focused route-contact/captured-library tests and TypeScript rerun after guard.
- Newest Vite is 4549, exec handle 44548; it predates only the nonfinite guard.
  Private API 4413 and Chrome 9451 remain live. Captured harness now supports
  `CMU_RANGE` JSON and `CMU_REPEATS`; use both to reproduce multi-cycle routes.

Next: quantify and inspect actual sole/stance behavior at repeats; contact
windows truncate at interval edges, so inspect seam continuity carefully.
Make a reviewed captured stride available as a route option/default when its
visible quality is established. Running and other natural defaults, independent
provider coverage, waits/arrival/collision/export visual gates still remain.
Do not mark complete or interpret this detector change as completion.

## Continuation update — preserved cut contacts and captured walking default

Prior turn was **progress**: a generic bounded stance detector enabled actual
capture contact intervals. This turn fixes their behavior at selected cuts and
uses the stride in normal route creation.

- Added `trimFootContacts` in `src/routeContacts.ts`. It trims full-take support
  evidence, interpolating boundary ankle/sole samples and preserving interior
  samples. `locomotionProfile` uses uninterrupted native support for selected
  travelling intervals with sole geometry. This avoids losing contact solely
  because a detector's lookaround window extends outside a selected stride.
  The 0.4–1.525 s stride now retains left support at both interval boundaries.
- Added `capturedRouteGaits` selector preset **Captured walking stride**. It
  references original 35_01, source range 0.4–1.525 s; no generated keyframes or
  new GLB. `defaultRouteLocomotion` uses it for new walking routes with no
  established/native gait. Existing performances keep priority. Running still
  falls back to the authored run; existing saved routes are not migrated.
- Production PathEditor UI verified on private project
  `captured-route-default-review`: selected captured-walking-stride by default,
  measured Party Woman at 1.20 m/s, saved a 6 m route in 4.987045 seconds with the
  exact source ID/animation/sourceRange and collisions=true. No console errors.
  Evidence: `/tmp/scene-natural-motion/default-captured-route-saved.json`,
  `default-captured-route-ui.log`, `captured-default-editor.png`.
  Driver: `test-results/default-captured-route-ui.mjs`.
- UI harness initially had wrong button matching, missing Boolean coercion of
  a DOM query, quoting errors and stale revision on its own disposable project.
  Corrected the driver; final real save/reload assertions pass. These were
  harness errors, not requests to modify the protected user project.
- Six-cycle, 6.75-second, 60-fps normal-speed evidence after contact trimming:
  `/tmp/scene-natural-motion/cmu-long/stride-route-preserved-contacts-1x.mp4`
  (source skeleton/Party Woman). Also rendered source/Sage (Casual Female):
  `stride-route-casual-female-full-body-1x.mp4`. The earlier
  `stride-route-casual-female-1x.mp4` clipped the stylized head; harness body
  framing now uses full model bounds rather than hip-to-floor length.
- Party Woman lower-foot median/p90 speed changed from 0.1703/2.0446 m/s to
  0.1669/1.9782 m/s with preserved cut contacts. This remains a mixed swing/stance
  metric, not a no-skating or naturalness proof. Sage's corresponding values
  are 0.0695/0.7243 m/s, with different proportions; do not compare them as a
  cross-provider quality score. Both render runs reported no GL errors.
- Full suite: **1078 tests /95 files**, TypeScript and isolated build pass.
  Logs: `full-suite-captured-default.log`, `build-captured-default.log` under
  `/tmp/scene-natural-motion/`. Existing PathEditor mocks/expectations were
  updated to the captured source and selected 1.125-second interval. Authored
  gait selection and existing-route tests remain. After changing source lookup
  to explicit 35_01 rather than array order, 15 focused tests and TypeScript pass.
- Baked/reloaded six-cycle route export: max sampled joint/skin error <0.058 mm
  source, <0.039 mm receiver. Report `cmu-long/default-stride-export-export.json`.
  This is the harness's initial timestamp sample set, not full-take visual QA.
- Latest Vite 4551 handle 48460; API 4413 and Chrome 9451 remain live. Vite predates
  only the equivalent explicit 35_01 preset lookup; use a fresh port for further
  runtime changes. No original workspace or protected project was modified.

Next work remains substantial: running/other natural defaults; verify the saved
new default in a real scene through arrivals, waits, detours and export; more
provider rigs and close sole/hand views. Native source and receiver aesthetics
still need acceptance. Do not turn this walking-default milestone into a claim
that the whole natural-animation objective is complete.

## Continuation update — captured running and animated-skin visibility

Prior turn was **progress**: walking defaults/contact trimming were committed as
4bf996b. This turn adds a running source and fixes an observed rendering defect.
The complete natural-animation objective is still **not achieved**.

- Retrieved official CMU subject 35 trial 17: **run/jog**, 120 Hz, 167 frames,
  1.383333 seconds. Raw ASF/AMC, official catalogue and reference AVI are in
  `/tmp/scene-natural-motion/cmu-run/`. Also evaluated 09_01 (1.225 s), not shipped.
  Source URLs/terms use the already-established CMU terms. Website row colors
  alone were not treated as quality evidence; the feedback link is a report form,
  not a list of confirmed defects. Official reference and app frame sequences
  show alternating running flight/stance and arm swing, not an authored jog.
- Shipped 35_17 as **Captured run**, with hashes/mapping/provenance in the existing
  captured catalogue and existing CMU terms. Original 120 Hz key values retained,
  no smoothing/time warp/finger fabrication. Added selector preset **Captured
  running stride**, source seconds 0.15–106/120 (88/120 s), measured distance
  2.6321303311993876. New runs without an established/native gait now select it.
  Existing saved authored routes/native priorities remain. Foot endpoint matching
  found three candidates; selected this interior window. **No stance intervals
  are detected in this capture**; it uses original foot motion without stance
  locks. Do not claim no skating or complete running acceptance from the seam.
- The native runner disappeared in side-view footage after ~0.5 s, despite its
  skin being inside the camera. Reproduced WebGL draws: at 0.67/1.2 s the cached
  SkinnedMesh sphere was outside, precise deformed bounds inside, normal draws=0,
  disabling frustum culling draws=1. `prepareImportedAsset` now disables cached
  frustum culling on imported skins; static meshes keep culling. This preserves
  animation poses and avoids per-frame full vertex scans, with an off-screen
  skin drawing cost. New regression exercises real bone travel and renderer's
  visibility predicate. Its initial failure was a test action remaining paused
  after LoopOnce; resetting before each seek fixed the test setup.
- Browser after-fix diagnostic draws the runner at every listed time. Files:
  `cmu-run/culling-before.json`, `culling-after.json`; driver
  `test-results/skinned-culling-diagnostic.mjs`. Before movie
  `jog-native-side-1x.mp4` visibly loses the original; corrected
  `jog-native-side-visible-1x.mp4` shows both through the entire actual take.
- Normal-speed six-stride route videos, 4.4 seconds / 60 fps:
  `cmu-run/shipped-run-route-party-1x.mp4` (original skeleton / Party Woman),
  `cmu-run/jog-route-sage-1x.mp4` (original / Casual Female, displayed as Sage).
  Party final video uses shipped URL and generic captured-performance label.
  Earlier jog/Sage labels mistakenly say "CMU walking capture" but the actual
  take is 35_17; do not mistake that harness label for a different input.
  Reviewed source visibility, body/flight sequence and repeat-adjacent frames.
  These remain feedback evidence, not universal naturalness acceptance.
- Actual Actions preview of **Captured run** preserves .63 s across Original/
  Party Woman switches, Play/Pause, correct Add recipient, no saved-content
  changes, no errors. `cmu-run/preview-ui.log`; driver
  `test-results/library-run-preview-ui.mjs`.
- Actual route editor selected running stride and saved 6 m / 2.0124856 s on
  Party Woman with exact source/range and collisions=true, in disposable
  `captured-run-default-review`. `/tmp/scene-natural-motion/default-captured-run-saved.json`.
  `cmu-run/route-ui-recheck.log` has no errors. First run had one unlocated 404;
  URL-bearing repeat did not reproduce it, so the original cause is unproven.
- Export harness now samples the **entire** route + .3 s held tail, explicit bake
  boundaries and half-frame times, instead of only initial timestamps. Baked and
  reloaded both source and receiver: 843 samples each through 4.7 s. Maximum
  joint/skin position discrepancy: source <0.135 mm; Party Woman <0.159 mm;
  Sage <0.197 mm. Reports `run-full-export-parity-export.json` and
  `run-sage-full-export-parity-export.json`. This is full-duration numerical
  comparison, not independent visual export review. The tiny parity-run MP4s
  intentionally capture only .05 s; use the named full route videos for viewing.
- Full suite: **1080 tests /96 files**, TypeScript, diff check, isolated build
  pass. Logs in `cmu-run/{full-suite,typescript,build}.log`. Existing AI SDK schema
  and build chunk-size warnings remain. No collision/navigation/timing logic was
  edited. New Vite **4553**, handle 28719; API4413 restarted for catalogue,
  handle4471, PID2633778. Owned Chrome9451 remains PID2594784. Revalidate services.
- Durable evidence (including converter raw files/movies/scripts/logs) is in
  `.data/natural-motion-investigation/captured-running/`. The main comparison
  harness defaults now write to `/tmp/scene-natural-motion/comparisons`, not the
  protected original workspace. No protected project/workspace was modified.

Next priority: inspect the **saved walking/running routes in a real scene**
through starts, arrivals, blocked waits/recovery and detours. In particular,
verify that a route ending during a running flight does not simply hold that
pose. Use the existing route-stop/transition machinery and inspect evidence
before adding another correction. Other authored/procedural actions still need
natural source replacements or appropriate behavior. The explicit original
ActorCore-dummy/Party-Woman comparison and broader provider/extremity validation
remain required; this turn's running take is CMU, not an ActorCore motion.
