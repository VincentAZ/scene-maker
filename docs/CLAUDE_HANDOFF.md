# Scene Maker animation handoff to Claude

> **Isolated natural-motion investigation:** Continue in `/home/vincent/Repos/scene-maker-natural-motion`, branch `fix/natural-motion-baseline`. Read `docs/NATURAL_MOTION_CONTINUATION.md` first. Original-source preview comparison is implemented and verified (1,068 tests); natural motion is still NOT accepted. A CMU walking candidate is in the isolated 4542 → 4413 runtime. The main workspace and user projects remain protected; the older banners below are historical.

> **Latest user acceptance: FAILED natural walking (2026-11-01).** The user supplied `/home/vincent/Videos/Astra-long-wait-2026-11-01-203903.mp4` and reports robotic drawn-path walking. Do not declare the motion-quality goal complete based on 1,067 passing tests. The saved revision-10 scene uses Quaternius `Walk` on Party Woman at 1×; this identifies the active source, not the cause. Preserve the user's now-edited `astra-long-wait` project (it is no longer a disposable test scene). Compare original take → receiver without path → straight path → actual curved path. User test plan: `docs/ANIMATION_ACCEPTANCE.md`. Evidence snapshot: `animation-verification/user-203903/`. Latest uninstrumented review runtime was 4531 → 4412; older status banners below are historical.

> **Codex resumed at the user’s request (2026-11-01).** The older paused/Fable-only banners below are historical. Preserve Fable’s fourth-session source changes. Codex is now the editing agent; private review is Vite 4529 → API 4412, data `/tmp/scene-animation-review/astra-data`. User services 4311/4337 remain untouched. Latest completed full suite: 1,066 tests / 94 files. See the newest quality-log section for the additional long-wait/export fixes and the active human-running review.

> **Latest continuation after session three:** Read the opening section of
> `docs/FABLE_NEXT_TASK.md`. Preserve the 1,044-test navigation checkpoint;
> next implement natural stop/hold/restart without rewinding played motion,
> close heading/long-hold/native-travel boundary cases, and perform the original
> ActorCore visual acceptance comparison. Earlier assignments below are history.
> Codex remains paused; Fable is the runtime editing agent.

> **Current next assignment:** The user has asked Fable to continue substantive
> implementation work with the remaining credits. Read
> `docs/FABLE_NEXT_TASK.md` before proceeding. The earlier four-script checkpoint
> is completed; the next priority is real import/mapping persistence and natural
> obstacle navigation/replanning. Codex remains paused to avoid concurrent edits.

> **After the implementation session:** `docs/FABLE_NEXT_TASK.md` now opens with
> the next focused continuation: fix mid-route displacement, prove fully blocked
> route recovery, cover playback-resume intent, prevent clearance ratcheting,
> and finish true 1×/export checks on the saved UI scene. Preserve the completed
> import/mapping and navigation improvements; do not restart old milestones.

Take over the existing animation-quality work in this checkout. The user is
temporarily switching agents to use expiring Anthropic credits. Codex is pausing
at this checkpoint to avoid concurrent edits. The objective is NOT complete.

> **Status for Codex (2026-11-01, three Claude sessions complete):** see the
> three Claude sections at the end of this note; the newest is "Claude
> session three: mid-route replanning, stopped routes, 1× evidence". Suite is
> **1,044 tests in 92 files**. Current review runtime: vite **4524** →
> private API **4411**. Working tree is intact; nothing was committed.

## Read first

1. `/home/vincent/.codex/attachments/7c02869b-dc29-4389-84bd-1acf319b5125/pasted-text-1.txt`
2. This handoff, then the latest sections of `docs/ANIMATION_QUALITY.md`.
3. `/home/vincent/Repos/scene-maker-dialogue/docs/ANIMATION_REQUIREMENTS.md`

The original reference video is
`/home/vincent/Downloads/Conversation-in-the-scene-recovered-riddle-scene-2026-10-31-000745.mp4`.

The user requires human-looking animation, retaining original captured detail,
and actual visual verification. Do not claim completion from tests alone or
redefine the goal as merely loading an asset successfully.

## Nonnegotiable scope

- The fixes must cover ALL supported imported models and animation/path sources.
  ActorCore is only a small part of the intended provider coverage. Implement
  shared geometry, timing, retargeting and navigation behavior; do not add
  corrective branches keyed by provider, model or animation name.
- Compare the same original ActorCore take on its motion dummy and Party Woman
  at native duration. Retain supported fingers, wrists, feet, twist and facial
  channels; explicitly disclose unsupported channels. Bone mapping must remain
  available for unfamiliar skeletons. A boned model alone does not establish
  anatomical semantics or universal automatic compatibility.
- Imported locomotion must drive drawn/imported routes, retaining source cadence
  and minimizing added sliding. Speed changes must be explicit, not an accidental
  consequence of changing a timeline duration.
- Collision is ON by default during animation, including legacy scenes. Users
  can explicitly turn it off with a saved setting.
- AI-controlled motion must avoid obstacles and adjust/replan when blocked,
  including moving/edited obstacles. A blocked route must not walk through the
  obstacle. Preserve shared preview, scrub, recording and export behavior.
- Verify real rendered behavior. Natural turns, stops, waits and obstacle detours
  remain part of the goal, not optional follow-up work.

## Checkout and preservation

Main checkout: `/home/vincent/Repos/scene-maker`, branch `main`, HEAD at handoff
`56bc266c18f667ab6ae3fb1f71f7fcffeb6bb006`.

Dialogue worktree: `/home/vincent/Repos/scene-maker-dialogue`, branch
`feature/directed-dialogue`, HEAD prefix `ec86e33`. The shared animation changes
are in the main checkout. The dialogue worktree currently has an untracked
`docs/ANIMATION_REQUIREMENTS.md` and a `node_modules` link; the requirements have
been kept in sync, but the animation implementation has not been ported there.

The main checkout has extensive intentional, UNCOMMITTED modifications and many
UNTRACKED source/test files from this work. They are not disposable scratch
files. Inspect `git status --short` before editing. Do not reset, clean, checkout
over changes, or start from the committed HEAD and assume that contains the work.
A tracked-only patch would miss much of the implementation. Checkpoint archives
and manifests are being saved under the evidence directory's `handoff` folder;
they preserve changed source/docs, not all ignored media or dependencies.

Keep one editing agent in this worktree. If you choose a new worktree, transfer
both tracked changes and untracked implementation files deliberately. Do not
merge, deploy or overwrite production `dist/` as part of this handoff.

## Current implementation map

- Import and mappings: `src/importedAsset.ts`, `src/rig.ts`,
  `src/rigMapping.ts`, `src/RigMappingEditor.tsx`, `shared/rigMapping.ts`.
- Detail transfer and ground geometry: `src/detailedRetarget.ts`,
  `src/rigDetailRoles.ts`, `src/footSurface.ts`, `src/ik.ts`.
- Timing and route playback: `shared/clipTiming.ts`, `src/locomotion.ts`,
  `src/routeLocomotion.ts`, `src/world.ts`.
- Contact inference/solving: `src/inPlaceContacts.ts`, `src/inPlaceFlight.ts`,
  `src/flightFootContacts.ts`, `src/routeContacts.ts`,
  `src/routeContactSchedule.ts`, `src/routeFootPlanting.ts`,
  `src/contactLanding.ts`, `src/routeGroundSupport.ts`.
- Loop closure: `src/routeLoopPose.ts`, `src/routeLoopAlignment.ts`,
  `src/sourceJoins.ts`, `src/nativeLoop.ts`, `src/capturedLoop.ts`.
- Navigation and conversation integration: `shared/navigation.ts`,
  `shared/aiMovement.ts`, `src/automaticRoutes.ts`, `src/nativeNavigation.ts`,
  `src/capturedContinuations.ts`, `src/capturedTurns.ts`, `src/capturedArrival.ts`,
  `src/navigationArrivals.ts`, `src/resolvedConversation.ts`, and related tests.

The quality log is long and chronological. Its latest sections are more useful
for immediate work than old test counts or old failure diagnoses.

## Completed work and bounded evidence

The common retargeting/detail, explicit timing, default-on collision and replanning
paths have substantial implementations and tests. That does not mean all of their
end-to-end acceptance cases have passed. Preserve their behavior while fixing
remaining issues.

Recent contact work replaced an iterative landing solver with direct disk
intersection, added authored-key/adaptive temporal sampling, and fitted bounded
interior swing curves with zero endpoint position, velocity and acceleration
contribution. Actual correction allowances and physical leg lengths were not
increased. Before the newest loop changes, the tested Quaternius-to-Party-Woman
Walk added stance-path error was about 0.44/0.25 mm in dense one/repeated-cycle
checks. Run improved from about 20 mm to 6.22/6.54 mm but still had 11.11/13.56 mm
physical reach loss in a full-motion sweep. These are limited assets, not broad
human-animation acceptance. An earlier quartic swing trial introduced loop
acceleration errors and was rejected; do not restore it.

An independent Cesium Man fixture exposed unfamiliar bone names and missing
stance inference. It needs an explicit mapping through the existing generic
mapping mechanism. `src/inPlaceContacts.ts` now recognizes alternating grounded
backward supports while retaining the measured ankle/sole motion, including
lateral sway. It does not freeze authored foot roll, invent root travel or
override existing overlapping contacts. The six-case fixture covers original
and transferred takes, with and without a new curved route. Added curved-versus-
straight stance trajectory residual on Party Woman fell from 52.16/34.15 mm to
0.089/0.089 mm for one/repeated cycles. Existing eight-case Walk/Run metrics were
exactly unchanged by that contact-inference change. This was a runtime harness,
not full upload/save/reload/UI verification.

Cesium fixture: `test-results/assets/cesium-man/`, including source/hash, original
GLB, README and license. It is © 2017 Cesium, CC BY 4.0 with logo/trademark
exclusion. It was not added to the user's project or production bundle. The
fixture mapping is in the evidence `cesium-route-supports-final/results.json`.
Do not count generated/local variants as independent provider coverage; current
evidence is primarily ActorCore, Quaternius and now Cesium.

## Changes made immediately before handoff

These latest changes are in the working tree and pass the complete test suite:

1. `src/routeLoopPose.ts` now estimates endpoint velocity using full and half
   one-sided intervals to cancel the leading sampling bias. This applies to
   positions, angular velocities, scales, morphs and source sole clearance.
   The previous averaging left a velocity residual on accelerating endpoints.
2. `src/routeContacts.ts` reduces a ground-support early-exit threshold from
   a fixed 1e-6 to a numerical, size-relative tolerance. The old threshold
   introduced a position step when continuous clearance crossed it. Its focused
   test fails before the change and passes after; this was not the sole cause
   of the real native-rig loop failures.
3. `src/routeLoopPose.ts` composes authored quaternion hierarchies for loop
   capture/application instead of decomposing world matrices into rotations.
   With rotated, nonuniformly scaled ancestors, matrix decomposition mixes shear
   into rotation and does not recover the original local endpoint pose. The
   new material-point regression covers attached and detached feet, nonzero
   initial rotations, scaled ancestors and multiple playback rates. It fails
   against the old conversion and passes with the new one.

Latest regressions are in `tests/routeLoopPose.test.ts` and
`tests/footSurface.test.ts`. Final current suite: **1,026 tests in 90 files pass**.
Log: `/tmp/scene-animation-review/loop-rotation-tests.log`.
Formatting and `git diff --check` pass. TypeScript and the isolated build also pass. Build output:
`/tmp/scene-animation-review/loop-rotation-build`; log:
`/tmp/scene-animation-review/loop-rotation-build.log`.

Current runtime for these changes: port **4503**. The new hierarchy conversion
removes the sampled position-discontinuity behavior on native Cesium and improves
native Quaternius results. Remaining residuals are NOT all resolved. In
particular, distinguish actual position/velocity discontinuity from normal
acceleration across a finite time interval. A first-order two-sided difference
divided by h contains acceleration times h; smaller h can instead expose tiny
position discontinuities as 1/h growth. Do not simply raise/remove thresholds.

The new convergence probes sample 100 vertices per mesh; the older export probes
sampled 50 for loop checks. Do not compare their peak values as if the sampling
sets were identical. Unweighted control bones such as Quaternius PoleTargetR
dominate an all-bone diagnostic but do not establish visible skin error; use the
separate visible-mesh reports when assessing rendered fidelity.

## Evidence and immediate next steps

Set this local evidence base when inspecting artifacts:

```text
/home/vincent/Repos/scene-maker/.data/coding/7980a735-0125-4a7f-9612-eef0a5596862/animation-verification/captured-continuations
```

Useful folders beneath it:

- `contact-swing-final`, `contact-swing-export`, `swing-full-motion-after`:
  earlier accepted running/contact evidence and remaining reach loss.
- `swing-contact-comparison/run-comparison.mp4`: earlier running comparison.
- `cesium-contact-diagnostic`: raw source foot/sole measurements.
- `cesium-contact-before`, `cesium-contact-final`, `cesium-support-export`:
  accepted contact-inference comparison, preview/export parity and explicit
  transferred-loop failures before the latest closure changes.
- `cesium-support-comparison/cesium-comparison.mp4`: latest user-shared sample,
  before/after contact recognition at 1× with matched camera guides and foot detail.
- `loop-convergence-bundled`, `loop-convergence-cesium`: initial all-bone/skin
  interval sweep; control-bone peaks need the qualification above.
- `visible-loop-bundled-before`, `visible-loop-cesium-before`: visible-only
  baseline at runtime 4500.
- `visible-loop-bundled-after`, `visible-loop-cesium-after`: endpoint-velocity
  and ground-threshold changes, before quaternion hierarchy conversion (4502).
- `hierarchy-loop-bundled`, `hierarchy-loop-cesium`: latest conversion (4503),
  sampled at h = 1e-3 through 1e-6 with first- and second-order derivative checks.

First finish fresh export/render verification for the latest closure changes.
The following scripts were PREPARED BUT NOT YET RUN at the Codex handoff
(**now RUN by Claude on 2026-10-31; see the end of this note**):

```bash
node test-results/verify-loop-rotation.mjs
node test-results/verify-loop-rotation-cesium.mjs
node test-results/render-loop-rotation.mjs
node test-results/render-loop-rotation-cesium.mjs
```

They target runtime 4503 and write `loop-rotation-export`,
`loop-rotation-cesium-export`, `loop-rotation-render` and
`loop-rotation-cesium-render`. Inspect output and actual rendered frames/videos.
Keep rejected continuity measurements explicit, even when export parity passes.
Then investigate remaining loop residuals with the convergence evidence, and
continue toward the much larger unclosed visual/navigation/import requirements.
Do not spend all remaining effort polishing subpixel metrics while ignoring
natural turns, arrivals, waits and broad import workflows.

Other open work includes native/retargeted running fidelity and skin-ground
contact, natural captured-step insertion for larger detours, turns and waits
around temporary obstacles, nonlevel/climbing motion, moving destinations and
mid-playback edits, conversation attention, and real multi-provider import/UI
coverage. Recheck the original user scene and ActorCore source/receiver renders.
No reliable full completion ETA has been established.

## Running and testing safely

The user's API is on 4311 and dev app on 4337. Do not manipulate the user's Chrome
debug session on 9445. Our owned headless Chrome is on **9451**, using SwiftShader.
The ignored `test-results/*.mjs` scripts use CDP on 9451 and create/close their own
tabs; inspect a script before running it. They use fixture data rather than
writing the user's asset library. Current library metadata is also cached at
`/tmp/scene-animation-review/turn-current-library.json`.

Review servers use `test-results/review.config.ts` with HMR/watch disabled.
4500 is the previous accepted contact-inference runtime; 4501/4502 are intermediate
loop trials; 4503 is current. Other 44xx/45xx servers were retained as diagnostic
baselines. Already-loaded modules are cached; after editing runtime code, use a
fresh port (4504+) and update the verification scripts. Do not rely on an old
review tab picking up changes. Do not stop unrelated servers or rebuild `dist/`.

Typical checks from the main checkout:

```bash
npx vitest run --maxWorkers=2
npx tsc -b
npx vite build --outDir /tmp/scene-animation-review/claude-animation-build
git diff --check
```

Run the suite without concurrent heavy renders where practical. One earlier
packaging test hit its unchanged 5-second timeout under concurrent load; its
isolated retry and the full subsequent suite passed. Do not casually loosen it.

## Returning the work to Codex

Before handing back, update this note and the quality log with exact changed
files, current runtime port, completed commands/results, evidence paths,
remaining failures and any rejected experiments. Record any commits/branch
changes. Leave the working tree intact. Tell the user what actually improved and
what remains unverified; do not call the full goal finished without the requested
real visual and all-import-path evidence.

## Final checkpoint status

Checkpoint recorded 2026-10-31 16:27 UTC. No new animation edits are intended
after this note. Codex is pausing for the user-requested handoff; the goal remains
unfinished. Latest verification is 1,026 passing tests, TypeScript, isolated
build, formatting and diff checks. The four latest export/render scripts listed
above remain unrun and are the first verification work to finish.

Source snapshots are in the evidence base under:
`handoff/20261031-162700/`. Read `manifest.json` for included files and hashes.
`scene-maker-changes.tar.gz` includes tracked modifications AND untracked
implementation/docs; `scene-maker-tracked.patch` is only the tracked portion.
`scene-maker-dialogue-changes.tar.gz` preserves the dialogue requirements note.
Ignored test scripts, model fixtures and media remain in the existing checkout
and evidence directories; the archives intentionally exclude dependencies.

## Claude session summary and return to Codex

Session: 2026-10-31, roughly 19:05–19:20 UTC. One editing agent; no concurrent
Codex edits. Nothing was committed; branch is still `main` at `56bc266`; the
dialogue worktree was not touched.

### What was done

1. Ran the four prepared scripts against the unchanged runtime **4503** and the
   owned headless Chrome 9451. All four exit 0:
   - `node test-results/verify-loop-rotation.mjs` →
     `loop-rotation-export/{results,continuity-rejections}.json`;
     log `/tmp/scene-animation-review/loop-rotation-export.log`.
   - `node test-results/verify-loop-rotation-cesium.mjs` →
     `loop-rotation-cesium-export/…`; log `…/loop-rotation-cesium-export.log`.
   - `node test-results/render-loop-rotation.mjs` →
     `loop-rotation-render/{inplace-routes.mp4,frame-*.png,results.json}`.
   - `node test-results/render-loop-rotation-cesium.mjs` →
     `loop-rotation-cesium-render/{cesium-import-routes.mp4,frame-*.png,results.json}`.
     Export parity passes (clock error ≤6.7e-16 s, reverse seek 0, GLB
     bone/mesh deviation ≤0.117/0.120 mm, no warnings besides the disclosed
     Cesium `ShoulderL/R.position` channels). Rendered frames and videos were
     inspected; join frame strips are in `loop-rotation-render/join-strips/`.
2. Two single-h (1e-4) continuity rejections remain and are recorded, not waived:
   Quaternius Run native at 1.75 s (5.59 mm/s) and Cesium → Party Woman at
   2 s / 4 s (6.42 / 6.28 mm/s). Walk native improved from 7.2/21.0 to 2.4/2.4
   mm/s versus the pre-closure `contact-swing-export`.
3. Classified every loop-join residual using the existing seven-point h sweeps
   (`hierarchy-loop-*`) with a new, ignored script
   `test-results/classify-loop-convergence.mjs` →
   `loop-rotation-export/convergence-classification.json`. Findings (full table
   in the new `ANIMATION_QUALITY.md` section):
   - Cesium native and Cesium → Party Woman: pure acceleration×h (a≈50–63 m/s²).
     The 6.4 mm/s rejection is **not** a discontinuity.
   - Quaternius Run native: a **0.27 / 0.50 µm position step** located 3–10 µs
     from the join (1/h growth from h=1e-4 to 1e-5, then collapse to 9e-5 m/s
     at h=3e-6). Invisible, but a real step.
   - Quaternius Walk native and → Party Woman: genuine **~2.2–2.6 mm/s velocity
     plateaus** as h→0. Below threshold, invisible.
   - Quaternius Run → Party Woman: acceleration-dominated.
4. Added `test-results/verify-loop-rotation-sweep.mjs` and
   `verify-loop-rotation-cesium-sweep.mjs` (copies of the verify scripts with a
   five-point h sweep and `join-classification.json`); both ran against 4503 and
   wrote `loop-rotation-sweep-export` / `loop-rotation-cesium-sweep-export`.
   Party Woman meshes hit float32 vertex noise at h≤3e-6, so their smallest-h
   values are noise, not Δv.
5. Re-ran the full suite on the unchanged tree: **1,026 tests in 90 files pass**
   (`/tmp/scene-animation-review/claude-baseline-tests.log`). TypeScript, build
   and `git diff --check` were not re-run because no `src/`, `shared/` or
   `tests/` file changed; the handoff's results for those still apply.

### Changed files (all docs or ignored test tooling; no runtime source)

- `docs/CLAUDE_HANDOFF.md` (this note), `docs/ANIMATION_QUALITY.md` (new final
  section).
- New ignored scripts under `test-results/`: `classify-loop-convergence.mjs`,
  `verify-loop-rotation-sweep.mjs`, `verify-loop-rotation-cesium-sweep.mjs`.
- New evidence folders under the evidence base: `loop-rotation-export`,
  `loop-rotation-cesium-export`, `loop-rotation-render` (+ `join-strips/`),
  `loop-rotation-cesium-render`, `loop-rotation-sweep-export`,
  `loop-rotation-cesium-sweep-export`.
- Logs: `/tmp/scene-animation-review/loop-rotation-{export,cesium-export,render,cesium-render,sweep-export,cesium-sweep-export}.log`,
  `loop-convergence-classification.log`, `claude-baseline-tests.log`.

### Rejected / not attempted

- No threshold was raised or removed. The 0.005 m/source-s single-h check is
  still reported as-is; the classification is additional evidence only.
- No fix was attempted for the Run native half-micron step. Unverified
  hypothesis: `supportRouteFootContacts` (`src/routeContacts.ts`) still breaks
  its second solve on a fixed `reachLimited > 1e-7`, and native Run is the only
  case with reach limiting (10.7 mm). If pursued, keep the knee-bend reserve
  semantics and prove it with a failing-then-passing test as before.
- No work on the Walk ~2 mm/s velocity plateau; it is below visibility and the
  handoff explicitly deprioritizes subpixel polishing.
- No new runtime server was started; 4503 remains current. Start 4504+ after any
  runtime edit.

### What remains (unchanged from the scope above)

Loop closure on the bundled Quaternius and Cesium fixtures is numerically clean
to sub-mm/s. Everything else in "Nonnegotiable scope" is still open: natural
turns/stops/waits and obstacle detours with captured steps, moving/edited
obstacles and mid-playback replanning, native/retargeted running fidelity and
skin-ground contact, nonlevel motion, conversation attention, real
multi-provider import/upload/UI coverage, and a recheck of the original user
scene with the ActorCore motion dummy and Party Woman renders. No completion
ETA. Do not describe the goal as finished.

## Claude implementation session: import, mapping, navigation

Session: 2026-10-31, about 19:25–20:25 UTC, following `docs/FABLE_NEXT_TASK.md`.
Nothing committed; branch `main` at `56bc266`; dialogue worktree untouched.
Full details and evidence in the final `docs/ANIMATION_QUALITY.md` section
"Real import, mapping, AI navigation and replanning through the application".

### Isolated runtime (do not confuse with the user's 4311/4337)

- Private API: `SCENE_MAKER_DATA=/tmp/scene-animation-review/fable-data PORT=4411 NODE_ENV=production npx tsx server/index.ts`
  (log `/tmp/scene-animation-review/fable-api-4411.log`). Its data dir holds
  the verification project "A chance encounter" (starter scene + imported
  CesiumMan, explicit 19-role mapping, walk-to-table route) and a "Legacy scene
  without collision setting" copy. `connections.json` has no assistant, so the
  offline helper answers "CesiumMan walk to Round table". **Restart the API
  after editing `server/`.**
- Review vite: `npx vite --config test-results/fable.config.ts --host 127.0.0.1 --port 4512 --strictPort`
  (proxy to 4411 with `changeOrigin:false`). 4504–4511 were used and killed
  during this session; the earlier Codex servers (4500–4503, 44xx) were left
  running. After runtime edits start 4513+ and update `APP` in
  `test-results/fable-ui.mjs`.
- Scenario scripts (ignored, CDP on 9451, own tabs): `fable-ui.mjs` (driver),
  `fable-import-step1/2/3.mjs`, `fable-nav-step4.mjs`, `fable-nav-obstacle.mjs`
  (env `OBS_TAG/OBS_PROP/OBS_POS/OBS_DURING/OBS_AT`, records frames + mp4),
  `fable-collision-setting.mjs`, `fable-reset-route.mjs` (test setup only:
  restores the base route and parks the plant; uses `projects[0]`, which may
  now be the legacy copy — check `name` first).

### Runtime changes (all shared; regressions fail before, pass after)

1. Untitled imported takes: `shared/animation.ts` (`untitledAnimationName`),
   `server/index.ts`, `server/mixamo.ts`, `src/rig.ts` (`importedClip`), and
   its callers `src/world.ts`, `src/bakeAnimation.ts`, `src/automaticRoutes.ts`,
   `src/nativeNavigation.ts`, `src/capturedArrival.ts`,
   `src/transitionContacts.ts`, `src/useRouteGait.ts`.
   Test: `tests/importedTakeNames.test.ts` (4). Before-fix reproduction:
   `fable-import-ui/step2-result.json` warning text.
2. Body clearance: `src/routeClearance.ts` returns `lateral`;
   `src/automaticRoutes.ts` and `src/nativeNavigation.ts` learned-footprint
   first, then lateral, then full extent (and full extent once the same
   obstacle repeats). Test: `tests/automaticRoutes.test.ts` "passes beside an
   obstacle…" (+ the 1.8 m bar test now asserts ≥ 0.9). Before/after in the
   app: 0.75 / 9.8 s / 14 points → 0.4 / 4.18 s / 9 points
   (`fable-nav-ui/static-plant-on-route-scene-after.json` vs `static-plant-final-scene-after.json`).
3. Playback resume: `src/Viewport.tsx` (`onNavigationSettled`), `src/App.tsx`
   (`pauseForNavigation`/`resumeAfterNavigation`). UI evidence only
   (`moved-during-play-log.json`, `destination-moved-log.json`).
4. Mapping editor hint: `src/RigMappingEditor.tsx`; test in
   `tests/rigMappingEditor.test.ts`.

### Rejected / reverted

- "Shortest comfortable turn" selection and heading-wrap fix in
  `shared/routeApproach.ts`: no effect on the real scenario; both reverted to
  the handoff archive copy (sha256 5ea123df…). The bend metric's ±π wrap
  (a reversal scores ~76 rad/m) is a real lead if sweeping loops reappear.
- Temporary `NAVTRACE`/`NAVFOOT` console tracing in `automaticRoutes.ts` and
  `routePlanner.ts` was removed; `routePlanner.ts` is byte-identical to the
  handoff copy. Re-add such a log and capture `Runtime.consoleAPICalled` in
  `fable-nav-obstacle.mjs` if planning needs tracing again.

### Checks

`npx tsc -b` clean; prettier clean on every changed file (16 pre-existing
unformatted files unrelated to this work, unchanged vs HEAD); `git diff --check`
clean; `npx vitest run --maxWorkers=2` → **1,032 tests, 91 files**
(`/tmp/scene-animation-review/fable-suite-3.log`; an earlier concurrent run
once hit the 5 s timeout on "rechecks the final combined schedule of two
AI-controlled crossing actors", which runs 4.3–4.5 s isolated both before and
after this session's changes — not loosened); isolated build
`/tmp/scene-animation-review/fable-build` (log `fable-build.log`).

### Checkpoint archive

`handoff/20261031-201729-claude/` under the evidence base: `scene-maker-changes.tar.gz`
(all tracked modifications and untracked implementation/docs/tests, 128
files), `scene-maker-tracked.patch` (tracked portion only),
`scene-maker-status.txt`, `sha256sums.txt`, `manifest.json`, plus copies of the
`fable-*.mjs` scenario scripts and `fable.config.ts`.

### Remaining, in priority order (next executable action first)

1. UI-verify the "no clear route" blocked destination that becomes reachable;
   the occupied-start hold → obstacle removed → resume case is UI-verified
   (`fable-nav-ui/blocked-start*`), the visibility-graph failure only at
   function level in `tests/automaticRoutes.test.ts`. Then native duration at 1×, an explicit
   rate change, duration/path edits, reverse scrub and exported-GLB playback on
   the saved Fable project itself (Codex's harness checks covered fixtures, not
   this UI scene).
2. Mid-route replanning geometry: routes are replanned from the clip start;
   when the new path diverges before the current time the actor is displaced.
   Guard by planning from the current pose (or keep the travelled prefix).
3. Persisted `navigation.clearance` and the saved path only ratchet up; a
   removed obstacle never shortens a route. Decide whether a cleared scene
   should re-plan the base route.
4. The starter café shows "Collision: Leo overlaps Round table" by default and
   the Monstera's footprint is 1.15×1.49 m; both inflate detours in the demo
   scene — inspect the collider regions before tuning anything else.
5. The larger visual acceptance scope (ActorCore source/receiver renders,
   fingers/wrists/feet/twist, running, turns, waits, carried props, foot/skin
   clearance during detours at close range, 1× recordings) is untouched by this
   session. The headless renderer is far slower than real time; the saved mp4s
   are wall-clock paced.

## Claude session three: mid-route replanning, stopped routes, 1× evidence

Session: 2026-11-01, following the continuation section of
`docs/FABLE_NEXT_TASK.md`. Nothing committed; `main` at `56bc266`. Full
narrative and numbers in the final `docs/ANIMATION_QUALITY.md` section
"Mid-route replanning, stopped routes that recover, and 1× evidence".

### Runtime (unchanged data, new ports)

API 4411 as before (data `/tmp/scene-animation-review/fable-data`; project
"A chance encounter" now contains five "Enclosure …" round tables and the
split route from the blocked-recovery run; `test-results/fable-reset-route.mjs`
restores the base route and removes `:continue` clips but not the tables).
Review vite **4524**; 4513–4523 were used and killed. After runtime edits start
4525+ and update `APP` in `test-results/fable-ui.mjs`.

### Runtime changes (all with failing-then-passing tests)

1. Replan keeps the travelled prefix: `shared/path.ts` (`retainedPathPrefix`),
   `src/routePlanner.ts` (`RoutePrediction.resume`, `resumedRoute`,
   `startMayExit`, diagonal candidate fix in `objectRouteGoals`),
   `src/automaticRoutes.ts` (`at` plumbing, resume computation),
   `src/Viewport.tsx` (`at: live.current.time`, render after settle).
2. Stopped routes: `shared/scene.ts` (`routeStop`; `routeHold` allowed on a
   studio route with `routeStop`), `shared/clipTiming.ts` (`routeStopTime`),
   `shared/animation.ts` (clamp, completed-clip travel up to the stop,
   `routeEndOffset`), `src/world.ts` (clamp, `completedRouteHeading` returns
   heading + standing-body offset, cache of four recent scenes),
   `src/automaticRoutes.ts` (record `routeStop` on block, split into prefix +
   `:continue` on recovery, `holdBlockedRoutes(…, at)`).
3. Exit from clearance: `shared/navigation.ts` (`findRoute(…, exitOccupied)`),
   `shared/routeApproach.ts` (pass-through; first leg may leave occupying
   boxes). `shared/routeApproach.ts` is otherwise the handoff copy.
4. Cache thrash: `src/routeLoopPose.ts`, `src/routeFootPlanting.ts`,
   `src/world.ts` keep four recent entries per body.
5. Clearance ratchet: `src/automaticRoutes.ts` (saved width rechecks the saved
   path; a fresh plan starts at 0 and widens; `recorded` keeps a retained
   path's width).
6. Playback transport: `src/playbackTransport.ts` (new), `src/App.tsx` uses
   it; `tests/playbackTransport.test.ts`.
7. Tests: `tests/automaticRoutes.test.ts` (+6: during-playback obstacle and
   destination edits, superseded jobs, blocked-then-recover, early opening,
   clearance ratchet; the two-crossing-actors test now has a 15 s budget
   because it runs 4.3–4.5 s alone and timed out once under a concurrent
   full run), `tests/navigation.test.ts` (+1).

### Evidence (evidence base, new folders)

- `fable-replan-ui/`: bend-obstacle before/after scenes, paused screenshots,
  `bend-obstacle-pose-compare.json` (zero deltas at and before 3.7 s), log.
- `fable-blocked-ui/`: blocked-recovery scenes (blocked, resumed), log with
  every stage, frames, `blocked-recovery-poses.json`.
- `fable-1x/blocked-recovery-1x.mp4` (+ sheet, json): true 1× at 20 fps.
- `fable-export/`: package parity on the saved scene (`*-parity.json`,
  exported GLB and scene.json copies).
- `fable-timing/`: native/2×/duration-edit sampling on the UI scene.
- Scripts (ignored): `fable-replan-bend.mjs`, `fable-pose-compare.mjs`,
  `fable-blocked-recovery.mjs`, `fable-record-1x.mjs`, `fable-export-check.mjs`,
  `fable-timing-check.mjs`; checkpoint copies beside the archive below.

### Checks

`npx tsc -b` clean; prettier clean on changed files; `git diff --check` clean;
`npx vitest run --maxWorkers=2` → 1,044 tests, 92 files
(`/tmp/scene-animation-review/fable-suite-5.log`); build
`/tmp/scene-animation-review/fable-build-2`. All temporary `NAVDBG` tracing
was removed (grep for it before trusting a runtime).

### Checkpoint archive

`handoff/20261101-161907-claude3/` under the evidence base: changes tarball,
tracked patch, status, sha256 list, manifest, and the `fable-*.mjs` scripts.

### Remaining, next executable action first

1. Stop phase: choose the last contact phase before the block for `routeStop`
   and start the continuation at a matching phase or through a stop→walk
   transition; the current hold freezes a mid-swing pose (visible in the 1×
   video at 3.3–6.6 s).
2. Replans inside the first 8 % / last 15 % of a route: `samplePath`'s
   fraction-based heading blends can change slightly; convert those windows to
   distances or measure that they are negligible.
3. An obstacle dropped onto the body itself still reports "Move the character
   clear …" and holds; decide whether a stopped body should nudge out.
4. The original ActorCore motion-dummy/Party-Woman comparison, running, turns,
   arrivals and conversation waits are still untouched.

## Codex takeover checkpoint — 2026-11-01

The final quality-log section supersedes the old paused/Fable-only banners.
Source changes after Fable: routeWait fallback beyond 60 seconds; stopped-route
editing, reorder and deletion semantics; current-scene identity on standing
measurement cache hits; exact export stop boundaries; wait UI controls.
Full suite 1,066/94, TypeScript and isolated build pass. Final private runtime
4529 → 4412, copied data `/tmp/scene-animation-review/astra-data`.

Authoritative visual comparisons use independent source rigs and `*-final-*`
filenames in `actorcore-acceptance/`; earlier fixture limitations are documented.
Human-run source, phase equality and off-key GLB checks are in `cmu-run/`.
Saved UI and package evidence: `captured-continuations/astra-long-wait/`.
The current user project was copied, not edited; its 20-fps recording is in
`captured-continuations/astra-user-scene/`.

Do not infer universal human-animation acceptance from the green suite. User
perceptual feedback is still pending; the quality log lists source limitations,
unknown-rig mapping, frozen fallback, and earlier running-contact residuals.
No commit or deployment; preserve all tracked and untracked implementation.


### Final shared running fix after the takeover checkpoint

See the final section of `ANIMATION_QUALITY.md`: physical reach now triggers
landing preparation even when correction distance is within its allowance.
A failing-then-passing synthetic regression covers it. Native/receiver Run
reach loss fell from 11–29 mm to at most 0.000253 mm in the 500-Hz full-motion
checks; receiver added stance drift is below 0.000001 mm. Eight Walk/Run export
cases pass (max skin deviation 0.114 mm), reverse scrub is exact, source timing
unchanged. The older running residual listed above is superseded by this fix;
the microscopic loop observations are not claimed fixed.

Latest full suite: **1,067 tests / 94 files**. TypeScript, formatting, diff and
isolated build pass. Final uninstrumented runtime **4531 → 4412**. Evidence:
`captured-continuations/astra-running-fixed/` and `astra-running-export/`.
No commit/deployment or mutation of the user's running app/scene. Keep all
tracked/untracked implementation files; do not use the diagnostic runtime on
4530 as final evidence. General import mapping/channel/standing-take caveats
remain as stated in the quality log.

Verified final source checkpoint: `.data/coding/7980a735-0125-4a7f-9612-eef0a5596862/animation-verification/captured-continuations/handoff/20261101-182040-astra-final/` (working tree archive, patch,
status, hashes and reproducible review scripts).
