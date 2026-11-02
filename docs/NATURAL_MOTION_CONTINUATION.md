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
  Private API is 4413, latest Vite 4571, owned headless Chrome 9451. Confirm availability
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
  and owned Chrome 9451. Current exec handles: API 53392, Vite 68832, Chrome 40524. Revalidate them before relying on these handles.
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

## Continuation update — recorded arrivals and direct ActorCore evidence

Prior turn was **progress**: captured running/default and animated-skin culling
fix committed as 8d26811. This turn reproduces the saved-route ending defect,
adds original stop performances, and materializes experimental recorded arrivals.
It does **not** implement automatic path-editor arrival assembly yet.

- Saved straight six-metre routes really do freeze mid-stride: walking ends at
  4.987045 s, running at 2.012486 s with the trailing foot raised. Both entities
  explicitly save `ending: "hold"`; `shared/transitions.ts` preserves the last
  evaluated frame. Do not globally rewrite hold semantics. Evidence:
  `/tmp/scene-natural-motion/arrivals/saved-routes-before-1x.mp4` (6.5 s,60 fps).
  Driver `test-results/saved-route-review.mjs` loads the actual saved projects,
  sources and normal `applyAnimatedEntityPose`, including after their endings.
- The existing obstacle-wait machinery only searches for a measured standing
  take on the gait's **own** source (`standingPerformance.ts`). Isolated CMU
  gait files have no standing take. This explains the remaining held waits;
  no general standing-performance fallback was implemented in this turn.
- Obtained official CMU 16_33 **slow walk, stop** (285 frames/2.366667 s) and
  16_57 **run/jog, sudden stop** (268 frames/2.225 s), both120Hz. Evaluated 16_08
  too, not shipped. Raw files/provenance/catalogue in `arrivals/`. Same verified
  CMU inclusion/redistribution terms. Added the first two as **Captured walk and
  stop** / **Captured run and stop**, with original samples, hashes and mapping.
- Added catalogue `routeRole: "arrival"`, exported `recordedArrivals` and
  `isRecordedArrival`. Automatic gait defaults exclude those source identities,
  even on renamed copies: a one-shot deceleration must not become a repeated
  route cycle merely because its name contains walk/run. Explicit choices remain
  available; saved scenes are not migrated. Two regression cases cover this.
- Native stop comparison videos (original skeleton / Party Woman,60fps):
  `arrivals/captured-walk-stop-native-1x.mp4` and
  `arrivals/captured-run-stop-native-1x.mp4`. The running capture makes a recovery
  step and lowers its arms into standing. It is not an invented crossfade to
  the bind pose. Its source still lacks captured fingers/face.
- Experimental private projects **recorded-walk-arrival-review** and
  **recorded-run-arrival-review** reserve the final route distance for a recorded
  stop and use two ordinary imported path clips. Their destination remains six
  metres; final hips are within about1mm of it in these straight cases. Native
  source timing makes the movement5.965955 s walking /3.159774 s running.
  Current saved projects reference the shipped stop sources. Earlier render used
  byte-identical private upload URLs, before catalogue integration.
- Prototype driver `test-results/recorded-arrival-project.mjs` samples candidate
  stop cuts and scores world rotations/hip-relative joint positions on Party
  Woman. Selected source starts .025s walking, .75s running. The running handoff
  remains weak: incoming stop speed≈1.79m/s versus steady gait≈2.98m/s. This
  script does **not** score velocity; it hardcodes a straight six-metre layout.
  Do not promote it directly as a universal arrival planner. Candidate metrics,
  selected poses, durations/endpoints: `arrivals/recorded-arrival-plan.json`.
  Initial validation failure was a missing revision in the new fixture, fixed
  to revision0 before creation. No protected project was changed.
- Normal-speed experimental arrival evidence:
  `arrivals/recorded-arrivals-1x.mp4` (7.5s,60fps; walking left/running right),
  including the final standing hold. Export baked/reloaded GLBs, then rendered
  the exported hierarchies at the same speed:
  `arrivals/recorded-arrivals-export-1x.mp4` (7.5s). Whole-duration120Hz joint/skin
  comparisons through each end+1s: walking max<0.146mm, running max<0.083mm.
  Report `recorded-arrivals-export-setup.json`. This is Three.js GLB reload,
  not independent Blender verification. The camera follows live evaluated hips
  but visible meshes in that movie are the reloaded exported models.
- Both new library Actions previews pass source/receiver toggle at .63s,
  Play/Pause, correct Add target and unchanged saved scene content. Logs:
  `arrivals/library-{walk,run}-stop-ui.log`. Walk preview captured one404 with
  its actual URL: `/favicon.ico`. Run preview has no errors. This identifies
  this run's404 only, not the unlocated404s in previous turns.
- Full suite **1084 tests/96 files**, TypeScript, diff check and isolated build
  pass; logs in `arrivals/{full-suite,typescript,build}.log`. Existing chunk-size
  and AI SDK schema warnings remain. No new route timing/collision algorithm or
  TSX component was changed. The React review skill was read while considering
  UI work but not applied; no UI arrival feature was implemented.
- Latest Vite **4555**, handle94055, includes arrival-role filtering. API4413
  handle31823 was restarted for new sources (it predates only role metadata,
  irrelevant to its source identity/validation). Chrome9451 is still owned.
  Revalidate service handles. The older4554 runtime served Action preview tests.

Direct user-supplied ActorCore comparison (current runtime):

- New ignored `test-results/current-actorcore-compare.mjs` adapts the comparison
  harness for licensed Motion Dummy Male upload4fd5ba42-2c91-43c0-b113-0268a40f5f94
  and Party Woman upload3120824b-4d15-4fea-8464-7a213b68a9fd. Private copies only;
  no licensed source assets added to Git. Separate source instances, no CMU rig
  mapping applied. Native take **Thoughtful walk** is34s; **Relax** is17.667s.
- Six-second60fps side-view `arrivals/actorcore-original-party-native-1x.mp4`
  uses the same native1x take on original dummy/receiver. Transfer report maps
  **100 joints**, unsupported[], no playback warnings/GL errors. Reported mapping
  is not by itself visual proof or a universal compatibility claim.
- A raw-GLB key audit (`test-results/audit-actorcore-channels.mjs`) found303 source
  channels,76 actively varying at the stated thresholds (.001rad rotations /
  .00001position/scale), including30 active finger channels and22 twist/share
  channels. No actively varying facial channel in this take: do not claim facial
  motion coverage merely because facial bones are mapped. Report
  `arrivals/actorcore-channel-audit.json`.

Next: improve the experimental arrival handoff using **phase and velocity**
evidence, then implement a reusable planner/editor flow rather than saving
straight-only fixtures. Arrival distance/time must be budgeted inside the route;
appending native root motion after the existing endpoint overshoots. Preserve
explicit durations/speed choices, arbitrary curves, existing pose history,
point actions/dialogue timing, collision checks and automatic replanning. Do not
silently treat the hardcoded prototype as that implementation. Standing waits,
starts, more natural actions, detailed receiver/sole views and wider provider
coverage remain open. All original broad completion requirements still apply.

The full **34-second** ActorCore comparison is complete at native1x/30fps,
1021 sampled frames: `arrivals/actorcore-full-native-1x.mp4`. Both rigs remain
visible through walking, folded arms, hand-to-chin gestures and hands behind
back. Report `actorcore-full-native-summary.json`:100 mapped joints,
unsupported[], warnings empty, GL0 throughout. This completes a full-duration
current-runtime original/receiver video for that user-supplied take; close
contact/finger/facial fidelity and cross-provider acceptance are still not
proved by those report counts. No active facial animation exists in this take.

A durable archive for this turn is
`.data/natural-motion-investigation/recorded-arrivals/`, including the raw public
CMU inputs, saved experimental project JSON, videos, reports and drivers. The
licensed ActorCore input GLBs remain only in the private runtime uploads. The
private review project exports do not become redistributable source assets.

## Continuation update — route height reference and full-take arrivals

The prior turn was **progress**, and the overall natural-animation goal remains
**open**. This turn fixes two production issues; it does not ship a new editor
control or an automatic transition between separate capture files.

- Found existing `capturedArrival.ts`, `arrivalMatching.ts` and
  `navigationArrivals.ts` already implement same-take stopping proposals,
  geometry checks, schedules and automatic destination replanning. Reuse these;
  do not duplicate their collision/history machinery with the straight prototype.
- That planner previously searched only `motion.path.sourceRange`. A selected
  stride consequently hid the stopping segment elsewhere in its original take.
  The proposer now measures the full take for stops while retaining the selected
  stride for approach distance/rate/phase. The matcher uses separate samplers,
  offsets and support clocks for the gait interval and full stopping performance.
  Existing pose, velocity, support and clearance gates are unchanged. Regressions
  exercise repeated selected strides, actual source offsets, unsupported phases,
  and the proposal's retained sourceRange/standalone-tail metadata.
- A second defect appeared in real capture evaluation: travelling routes used
  raw capture-space heights for ground evidence and route clearance, although
  standalone native/retargeted playback normalizes initial root displacement.
  Added `LocomotionProfile.sourceOriginY`, normalizing travelling sole heights,
  penetration support and both native/retargeted route evaluation. Selected
  intervals keep the full take's floor, so trimming at a raised gait phase does
  not invent a new floor. Source keys, planar trajectory and cadence are unchanged.
- In-place virtual gait reconstruction retains its existing bind-floor
  calibration. Applying normalization there initially broke bundled Run flight
  reconstruction (zero speed samples); the travelling-only correction passes that
  existing regression. Do not claim arbitrary vertical-offset invariance for
  in-place gait reconstruction. New travelling-route regressions failed before
  the fix and pass for +/- capture offsets, trimmed starts, positioned/scaled
  characters, reverse seeking, final holds, native and transferred playback.
- Evaluated additional official CMU captures 104_09,104_56,143_02,16_34 (raw AMC,
  ASF, converted GLBs/mappings/hashes in `/tmp/scene-natural-motion/arrival-selection`).
  They are private evaluation assets, **not shipped library entries**. Files in
  isolated uploads use `arrival-candidate-<subject>-<trial>.glb`. Downloads used
  per-command curl -k after the web tool could not open the official site.
- 104_56 is a 3.058333-second running stop. Before correction no stop was detected;
  after correction it has a measured settled interval approximately2.427–3.025s
  and three supported entries. The existing short16_33/16_57 takes still do not
  contain the required0.4s of settled motion. Do not weaken the gate to admit them.
  A bounded-jitter detector experiment was tried, did not solve this condition,
  and was completely reverted (no stop/contact threshold change shipped).
- Native1x/60fps source/Party Woman curved-route videos:
  `arrival-selection/run-stop-route-before-1x.mp4` and
  `run-stop-route-fixed-1x.mp4`, each the actual3.05s performance. Combined honest
  before/after: `route-height-before-after-1x.mp4` (before above, fixed below).
  Source and receiver stay visible; inspected the sequence/contact sheet.
  At2.5s the receiver's two foot origins are about7.3cm lower after correction,
  removing excess clearance. This is a targeted floor-reference result, not
  universal no-skating or naturalness acceptance. Capsule feet are still only
  visualization geometry. Full baked/reloaded GLB comparison through end+0.3s:
  742samples/rig; maximum joint/skin discrepancy under0.0007mm.
- Repeated shipped walking stride: `walking-stride-height-fixed-1x.mp4`,
  six strides/6.75s/60fps. Full bake/reload through7.05s,1648samples/rig,
  max joint/skin discrepancy under0.004mm. All playback warnings empty/GL0;
  four unsupported CMU anatomical channels remain explicitly reported.
- The ignored velocity-scored prototype now saves separate private
  `velocity-walk-arrival-review` and `velocity-run-arrival-review` projects;
  it did not overwrite the earlier recorded-* projects. It picks stop starts
  .05s walking and .375s running (instead of .025/.75), reducing the root-speed
  mismatch at the cost of a worse running pose match. It remains straight-only,
  experimental and **not** the production arrival planner. Report remains in
  `arrivals/velocity-arrival-plan.json`; driver `velocity-arrival-project.mjs`.
- Latest Vite4558 (handle9242) serves final runtime. API4413 and owned Chrome9451
  still live.4556 retains the pre-height-fix cached runtime used for controlled
  before footage;4557 contains an intermediate version. Revalidate services.

Next: use the existing arrival planner's safety machinery for compatible full
performances or carefully extend it to independent sources. Cross-source joins
must compare both pose and velocity on the receiver; do not adopt the prototype's
weighted score as a safety gate. Running contact evidence, standing waits,
starts, other natural actions and wider provider/extremity validation remain
open. Keep the original workspaces/services and protected user project untouched.

Final verification for this milestone: **1,090 tests/96files passed** using
`vitest run --maxWorkers=2` with unchanged test timeouts, plus TypeScript,
diff check and isolated production build. Two earlier runs under concurrent
render/export load each hit a different existing5s test timeout (conversation
geometry and authored-bank packaging); the final run avoided competing rendering.
The first run also caught the genuine in-place Run regression described above,
which was corrected before the final run. Existing SDK schema/chunk-size warnings
remain. Logs are `arrival-selection/{full-suite-verified,typescript-final,build}.log`.

Final shipped-running-stride evidence is
`arrival-selection/running-stride-height-fixed-1x.mp4`: six native strides,
4.4s/60fps (264 sampled frames through4.3833s; no stretched final frame).
Full bake/reload through4.7s,843samples/rig: source max<0.135mm, receiver<0.159mm.
Body/feet frame sequences inspected for walking/running and the stop candidate;
normal-speed movies are available for actual visual review. These checks do not
settle broad provider quality or the remaining arrivals/waits problem.

Durable ignored archive: `.data/natural-motion-investigation/arrival-selection/`
contains videos, reports, public raw inputs and conversion outputs, validation
logs and drivers (not the large frame directories or licensed input models).

## Recorded standing waits and coordinate recovery milestone

The goal remains active. This milestone improves waiting; it does not establish
naturalness across every action/provider or solve starts and arrivals.

- Shipped CMU **77_02 Captured standing**: 937 original samples, 15.6 seconds,
  **60 Hz**, 26 tracks/31 bones. Its catalogue page explicitly identifies 60 Hz;
  do not treat it as a 120 Hz capture. The offline converter accepts an optional
  `60`/`120` fourth argument, defaulting to 120. Raw ASF/AMC, catalogue snapshots,
  mapping, conversion report and hashes are in `/tmp/scene-natural-motion/standing`.
  The existing CMU terms/attribution apply. No finger or facial capture is added.
- The standing detector now samples at 60 Hz, in source-local coordinates. It
  checks planar foot movement and hip height as well as body travel, vertical
  foot range and endpoint pose. This admits real weight shifts with planted feet
  without admitting walking or seated/crouched takes. Own-source standing remains
  preferred; the recorded take is a fallback when loaded and suitable.
- `planningMotionSources`/`loadPlanningMotionSources` preload optional standing
  for imported automatic navigation. Optional failure does not hide a playable
  character. Once a saved clip uses standing, it is a required dependency and
  failure is reported. Export dependencies still reflect actual saved clips.
- Generated wait clips have `stationary: true`, native playback rate and smooth
  transitions. The marker preserves within-take sway while suppressing net root
  travel/facing accumulation between repeats. It persists through save/reload
  and compatible clip edits, is removed for procedural/path changes, and is
  rejected on navigation clips. Other imported clips/ending holds retain their
  existing semantics.
- Two real floor defects were found in the footage and corrected. A stopped
  route's body-height calibration must not become the next standing take's floor;
  the standing handoff retains horizontal offset and the route floor. Blending
  individually supported poses can still lower a shoe through the floor, so
  `world.ts` rechecks the final deformed sole for standing and blended routes.
  Unblended routes avoid an extra redundant surface scan. Regressions use actual
  shipped captures on a scaled, elevated body, including reverse seeking.
- The recovery video also exposed an existing coordinate-navigation defect:
  after splitting a stopped route, its actor-local destination was reused from
  the new starting frame. The example walked to roughly (1.65, -6.01) instead
  of (6, 0). Automatic recovery now converts the original world destination and
  facing into the continuation frame. Both standing and frozen-wait regression
  cases failed before the fix and pass after it. Object/native destination
  semantics remain unchanged.
- Private fixture `captured-standing-wait-review` blocks Party Woman on a 6 m
  captured-walk route at 1.25 s. The stop is 1.2738970588 s; opening a wall after
  70 seconds resumes at 71.2738970588 s. A second actor supplies an 80-second
  scene horizon. The private save is regenerated by `standing-wait-project.mjs`;
  it explicitly fails if the recovered body misses (6, 0) by more than 12 cm.
  Latest actual endpoint: (6.006465, 0.001677) in the ground plane, 6.679 mm error,
  at 74.9977846083 s. It has no remaining navigation issue.
- History audit: 4,284 timestamps at 60 Hz plus boundary-adjacent samples,
  101 joints, from the beginning through recovery. Maximum position/quaternion
  component discrepancy between blocked playback and recovered saved playback
  is exactly zero. This is preservation evidence, not proof of naturalness.
- Normal-speed 30 fps movies: `captured-standing-native-1x.mp4` shows the actual
  15.6-second original capture and Party Woman; `wait-first-cycle-1x.mp4` shows
  seconds 0–20 (frozen-pose comparison left, recorded wait right), including the
  first repeat; `wait-recovery-1x.mp4` shows actual timeline seconds 69–78.
  The explicit final hold remains visible. Entry/loop/recovery frame sequences
  were inspected. Do not call the entry or final stop fully natural: entry is
  still a blend from a stopped gait, not a recorded deceleration, and the final
  route still uses its explicit ending hold.
- The original/body action preview UI preserves the selected source time and
  leaves saved project content unchanged; no browser errors. Only the known
  software-WebGL warning appeared. Screenshots/log: `library-standing-*` and
  `preview-ui.log` in the standing directory.
- Dense wait sole clearance remains about 3.33–17.03 mm above the floor on this
  receiver. The source capsule geometry is not a shoe scan. This is explicitly
  **not** a perfect-contact/no-skating claim. Final joins are checked for
  penetration; see `wait-floor-report.json`.
- Tests: **1,099 tests/97 files passed**, `--maxWorkers=2`, with unchanged
  timeouts and no competing renderer. TypeScript and isolated production build
  passed. The first full run caught two stale warning-text assertions; the
  final run follows the coordinate-recovery fix too. Existing SDK schema and
  build chunk-size warnings remain. Logs: `full-suite-final.log`,
  `typescript-final.log`, `build-final.log`.
- Latest runtime: Vite4563, API4413 (restarted this milestone with the private
  data directory), owned Chrome9451. Vite4562 has the floor correction but the
  old coordinate-recovery code;4561 predates the final post-blend floor check;
  4560 predates both floor corrections.4558 retains the previous commit runtime.
  Revalidate before using a service. Do not use stale runtimes for new evidence.
- Before/intermediate failures are retained under `before-floor-handoff`,
  `before-final-ground-check`, and `wrong-coordinate-recovery`. They are not
  final evidence. The first-cycle footage is unchanged by the later coordinate
  fix; the recovery movie is regenerated after that fix and history is rechecked.

Next work remains the same broad user goal. Integrate genuinely compatible
recorded starts/stops using receiver pose AND velocity/contact safety gates,
not merely a weighted score or generic blend. Verify running contact evidence,
other natural actions and broader provider/extremity coverage. Preserve existing
collision, timing, history, explicit ending holds and export behavior. Do not
infer goal completion from this milestone's tests or a single captured wait.

Final export audit for the corrected recovery: baked and reloaded a 106,102,324-byte
GLB through 75.2977846083 seconds (route end plus 0.3 s), compared 9,072 timestamps
at 120 Hz plus boundary-adjacent samples, and 102 matched bone/mesh nodes.
Maximum joint discrepancy is 0.0989 mm; maximum discrepancy on 12 sampled vertices
per mesh is 0.1002 mm. This is full-scene-duration numerical parity, not a claim
that every vertex was sampled or that the exported performance is naturally
acceptable. Final video sole minima are within 4e-10 m of zero at the joins.

Durable ignored archive: `.data/natural-motion-investigation/standing/` contains
final movies, reports, screenshots, public CMU inputs/conversions, failure examples,
validation logs and reproduction drivers. Large frame directories and licensed
character assets are omitted. The corrected recovery is the root-level
`wait-recovery-1x.mp4`; the wrong-direction example is explicitly segregated.


## Gradual slowdown capture and rejected route presets (2026-11-01, after 6e821bd)

This goal turn made progress, not completion. The shipped result is deliberately
narrower than the intermediate route experiments: CMU 82_14 as a full original
performance, plus a four-second stop-entry search. No new repeating-gait preset
or default-selection exception ships. The broad natural-animation goal remains
active. Tests do not establish naturalness or universal retargeting quality.

- Added **Captured walking with a gradual stop**, CMU 82_14: 7.55 s, 907 frames,
  original 120 Hz, 26 tracks, 31 bones, 666,932 bytes. The original source keys
  are retained. No fingers/thumbs or facial capture are invented. Provenance,
  hashes, rig mapping, terms and production packaging follow the existing CMU
  entries. Public source catalogue: https://mocap.cs.cmu.edu/search.php?subjectnumber=82.
- `detectLocomotionStops` previously considered only two seconds before settled
  standing. For 82_14, that excluded the walking lead-in of a gradual slowdown.
  It now considers four seconds, retaining the existing sustained standing,
  pose/velocity, support, morph/scale and clearance gates. Standing starts near
  5.5045 s; the selected settled source end is near 6.1198 s. The full take
  continues through 7.55 s. A real-asset regression proves that an earlier
  compatible entry remains available; it does NOT certify a repeating stride.
- Native 1× footage: `walk-slowdown-native-1x.mp4`, source capsules left and
  Party Woman right, full 7.55-second take at 30 fps. Inspected slowdown and
  final-pose frames. The original includes a backward lean and bent-knee
  finish; do not relabel this as a neutral standing idle. Native capture and
  transfer still need the user's visual judgment and broader receiver work.
- Final library UI check on Vite4567: original/character switch preserves .63 s,
  play/pause works, Add stays targeted at Party Woman, saved scene content is
  unchanged, no browser errors. `library-ui-final.log` and two screenshots.
  An earlier attempt used a navigation scene while it was replanning and did
  not become ready; the final preview test uses an isolated empty-clip project.
  Do not count the earlier timeout as a fixed navigation/UI issue.
- Native bake/reload parity: 7.85 s including final hold, 947 timestamps at
  120 Hz plus clip-boundary neighbours, 102 matched bone/mesh nodes and 12
  sampled skin vertices per mesh. Max joint error 0.001310 mm, max sampled
  skin error 0.001312 mm. 41,204,936-byte GLB round-tripped in memory.
  `production-native-export.json` / `native-export.log`. This is numerical
  parity, not a claim of perfect contact, transferred detail or naturalness.

Rejected / experimental findings (retain these, do not re-promote by test count):

- None of the previously shipped sources yielded a detected sustained stop.
  Private ActorCore Thoughtful walk does have long standing regions, but full
  and selected gait intervals failed arrival gates. `actorcore-audit.json`,
  `actorcore-proposals.json`; no licensed source was added to Git.
- CMU 131_01 is labelled Start Walk Stop but belongs to Michael Jackson styled
  motions and ends theatrically with a raised arm. Rejected after native 1×
  rendering. CMU 82_08 and 127_17 did not supply sustained stops. Public raw
  inputs/conversions and audit reports remain private investigation evidence.
- 82_14 interval 3–4.2 s matched some stops but was not a seamless gait. Its
  `arrival-full-1x.mp4` is an unsuccessful experiment, not final evidence.
- 82_14 interval 1.3–2.5 s passes the FOOT seam criterion and allows 3/4/6 m
  arrivals after the four-second search change. Full-body sampling found an
  approximately 11.4 cm hand jump at repeats on Party Woman; receiver loop
  correction correctly refuses it. A coarse 120 Hz export audit initially
  reported only 0.69 mm, but samples immediately before the wrap exposed the
  true discontinuity. This is a concrete warning against relying on foot-only
  or fixed-grid checks. `target-seams.json`, rejected-1.3-2.5-stride export
  diagnostic and video retain the evidence. No bake change was appropriate.
- Nearby interval 1.2–2.375 s closes on Party Woman using the existing bounded
  route-loop correction (~0.007 mm change across a 2 microsecond seam sample).
  Automatic arrivals reach 3/6 m endpoints; a detour around a crate at z=1.4
  works, a tighter crate at z=2.5 rejects without weakening clearance gates.
  Party Woman route bake/reload max errors: straight ~0.087 mm, detour ~0.098 mm.
  However, the same interval jumps ~5.73 cm on Casual Female, and all 128 nearby
  sampled intervals fail that receiver's seam test. Thus the optional curated
  preset and its default-selection exception were REMOVED before final checks.
  `casual-fine-seams.json`, `receiver-seam-test.log`, `production-projects.json`
  and the Party-only movie are diagnostic evidence, not shipped route quality.
- The source-level loop test and receiving loop test are distinct; a body can
  pass one and fail the other. Both foot and complete receiving pose/velocity
  matter. Do not loosen thresholds just to accept this capture as a gait.
- Detailed-retarget notices still report unsupported helper channels on these
  receivers (Party Woman: thorax, upperneck, wrists; Casual Female includes
  toes). The original source preview retains them. Their exact composed
  contribution needs audit; do not claim full channel parity or silence notices.

Verification: 1,102 tests / 97 files passed, default timeouts and maxWorkers=2.
TypeScript and isolated Vite build passed; existing SDK schema and chunk-size
warnings remain. Final source runtime: Vite4567, API4413 restarted with private
`/tmp/scene-natural-motion/data`, owned Chrome9451. Revalidate before use.
Vite4566 still contains the rejected 1.2–2.375 preset;4565 contains rejected
1.3–2.5;4564 has only the four-second search change and old catalogue. Do not
use them as final runtimes. User services4311/4337 and original/dialogue
worktrees were not changed. The API startup message misleadingly says4311;
actual bound port is4413.

Ignored durable archive: `.data/natural-motion-investigation/arrival-integration/`.
`NOTES.txt` distinguishes the shipped original performance from rejected route
experiments. It includes reports, public raw sources/conversions, validation
logs, normal-speed movies and reproduction drivers; excludes frame directories
and licensed character source files. Experimental drivers define their own
unshipped stride and require the private review projects/character uploads.
Next work: source/receiver detail audit and a gait/stop combination that closes
on multiple receivers, then native starts, running stops and the broader
provider/contact/history/export goal. No cross-source arrival matcher was
implemented during this investigation. Existing manual drawn-path behavior
and default walk/run sources remain unchanged.


## Complete chest transfer and full-body walking interval (after 8fecc12)

This turn is progress, not completion. It fixes measured lost torso motion and
replaces the walking preset's discontinuous interval. Running loops, natural
starts/arrivals, unsupported detail and broad provider/visual acceptance remain
open. The normal-speed clips include the remaining held route ending.

Chest transfer defect and correction:

- CMU has lower chest (`upperback`) and upper chest (`thorax`); Party Woman and
  Casual Female have one chest at the common arm/head branch. The previous
  semantic match sent only the lower chest to that joint. Arms/head received
  composed world orientations, but the chest mesh missed the upper bend.
- `chest-transfer-audit.mjs` measures the anatomical branch orientation against
  source motion, compensating bind axes and source entry heading. At 60 Hz over
  the FULL 35_01,69_06,82_14 takes, both receivers miss respectively ~7.115°,8.176°,
  and7.765°. After correction max error is0.001124° on Party Woman and below
  0.000004° on Casual Female. Reports: `before.json`, `after.json`.
- `detailedRetarget.ts` now uses the upper source chest as the endpoint for a
  single receiving chest only when both are the actual common arm/head branch,
  the source lower/upper chain is valid, and there is no distinct, ambiguous or
  explicitly disabled receiving upper chest. Separate upper/lower target joints
  keep their existing independent transfer. No provider/clip-name condition.
- `retargetReport.composed` identifies the lower channel represented through
  that endpoint; the UI explains that both chest segments share one joint.
  This is not identical independent skin deformation. Unsupported upper-neck,
  wrist and toe detail remains disclosed, not silently marked preserved.
- Synthetic runtime regression failed before the change by0.0856rad at its first
  sample. It now passes with different bind axes and reverse seeks; explicit
  upper-chest disabling and duplicate/ambiguous upper-chest names prevent the
  fallback. The existing separate-upper-chest regression still passes.
- Before/after preservation matrix: 23 native/receiver cases,39 timestamps each
  (37 full-duration fractions plus reverse seeks), all bone positions/quaternions.
  Seven native CMU takes and the native ActorCore Thoughtful walk are exactly
  unchanged. ActorCore Thoughtful walk -> Party Woman is exactly unchanged.
  Root placement and lower-body joint positions are exactly unchanged for ALL
  cases (CMU -> Party Woman/Casual Female included). `preservation.json`.
- `chest-transfer-before-after-1x.mp4`:7.55s capture at30fps, previous transfer left,
  corrected transfer right. Before transforms are sampled from Vite4567 then
  replayed on an independently loaded identical hierarchy beside live new poses;
  source clock/camera/lighting agree. `before-native-poses.json` retains replay
  evidence. Frame sequences inspected, including6.87s (peak chest difference).
  The torso improvement is real; the clip does not settle overall naturalness.
- Native slowdown bake/reload:7.85s including held tail,947timestamps,102nodes,
  12sampled vertices/mesh. Max joint/skin error0.001550/0.001554mm,41,204,944bytes.
  `production-native-export.json`. No export/bake algorithm was changed.

The existing walking/running presets were not actually seamless full-body loops:

- New complete-body seam sampling of the old defaults exposes~28.8mm native /
  35.3mm Party Woman /29.4mm Casual Female walking jumps, and~59.4/68.8/49.9mm
  running jumps. These existed BEFORE the torso fix. Earlier foot-only checks
  and fixed-grid export tests did not establish full-body continuity.
- A PRIVATE diagnostic Vite transform records why the existing loop gate rejects
  them. Walk's left hand correction is~0.798rad, above the unchanged0.35rad bound;
  the run's hands are~0.35085/0.35131rad. Finger descendants inherit the wrist
  jump even though no finger capture was fabricated. Do not loosen these gates.
  `loop-rejections.json` and `test-results/loop-diagnostic.config.ts` record the
  diagnosis. That transform is not production code. Its root-position diagnostic
  includes hips in the printed list although the actual gate handles hips
  separately; do not treat that list entry as the reason for native rejection.
- A search of950walking intervals finds two full-body candidates on native,
  Party Woman and Casual Female. Selected **1.1–266/120s** of35_01, duration134/120s,
  distance1.6394472422source metres. The existing bounded route-loop correction
  closes this interval. Raw capture keys remain unchanged.
- `captured-walking-stride` now references this interval for NEW routes. No saved
  route migration. Browser matrix: original source + Party Woman + all32bundled
  characters (34cases), largest all-joint change across the2microsecond seam
  sample is0.133mm. Do not claim exact velocity continuity: residual submillimetre
  contact/rotation differences remain. Automated regressions sample positions
  AND rotations on both sides of two repeats, native and Casual Female; both
  fail on the old preset and pass on the new one.
- Actual PathEditor saved `captured-full-body-walk-review`:6m across,4.915413976s,
  exact source/range, collisions=true. `walking-ui-final.log` has no errors.
  Prior saved `captured-route-default-review` remains4.987045177s with .4–1.525s.
  `walking-saved.json` and `walking-editor.png` retain new UI evidence. The first
  UI run logged two unlocated404s; final repeat with URL logging has none.
- `walking-review/walking-before-after-1x.mp4`:6s at30fps using the two actual
  saved routes at natural pace; old interval left/new interval right. Their
  source phase and stride period intentionally differ. Both explicit final
  held poses remain visible. This is a loop improvement, NOT a natural arrival.
- Walking bake/reload:5.215413976s (whole route+.3s),656timestamps including
  neighbours within1microsecond of repeats,102nodes,12vertices/mesh. Max joint /
  sampled-skin errors0.065147/0.063576mm;46,995,164byte GLB.
- Running search:248coarse then930finer intervals,21foot-compatible fine
  candidates, NO complete-body candidate across the three rigs. Running preset
  is unchanged and its known discontinuity remains a priority. Prefer a longer,
  suitable original running take over silently filtering wrists or weakening
  body/velocity gates. Walking's candidate alone does not solve the full goal.

Reproduction and current state:

- Final production runtime4571;4570 includes both fixes before the final guard
  against ambiguous upper-chest names (irrelevant to measured fixture mappings).
  4568 has torso correction with the old walking preset;4567 is the pre-turn
  baseline.4569 is the PRIVATE loop-diagnostic transform, not a final runtime.
  API4413 was restarted with the same private data directory;Chrome9451 remains
  owned. Revalidate processes before use; keep user4311/4337 untouched.
- Rendering two separate browser surfaces alternately was very slow. The driver
  was stopped only after confirming its live process and progress, then replaced
  with single-viewport replay of the original recorded transforms. Final driver:
  `chest-transfer-review-single.mjs`; walking counterpart `full-body-walking-review.mjs`.
  The abandoned two-tab renderer and its partial frames are not final evidence.
- Durable ignored archive: `.data/natural-motion-investigation/chest-transfer/`.
  Include final videos, before/after reports, pose replay, search/rejection evidence,
  UI screenshots/logs, exports' numerical reports and reproduction drivers; omit
  frame directories and licensed input GLBs. Private fixture uploads are required
  for Party Woman/ActorCore reproduction. Nothing publishes those assets.

Next priorities: replace the remaining bad running loop; verify walking with
curves, dynamic waits/recovery and native stops using the existing navigation
planner, not straight-only prototypes; audit remaining neck/wrist/toe composition
and source quality. All original provider/contact/timing/export requirements
remain active. Do not infer completion from the improved chest metric or34body
walking-seam matrix.


Final checks for this milestone: **1,107tests/97files passed** with default
limits and `--maxWorkers=2`, plus TypeScript, isolated production build and
whitespace checks. The first full run found one stale default-range assertion;
that expectation was updated and the full suite rerun successfully. Existing
SDK schema and build chunk-size warnings remain. Final4571 Action Preview
preserves0.63s across source/receiver views, plays/pauses, keeps the Add recipient
and leaves saved content unchanged. Its only HTTP error is the recorded
`/favicon.ico`404; there are no animation-load or JavaScript errors. Screenshots
are `library-slowdown-{character,original}.png` in the new durable archive.
