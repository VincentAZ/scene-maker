# Fable next implementation assignment

## Current continuation after mid-route recovery

The latest session substantially advanced navigation: retained travelled route
prefixes, persisted stops and continuation clips, cleared-width replanning,
playback transport tests, true 1× recording and saved-scene export parity. Keep
that work. The current recorded baseline is **1,044 tests in 92 files**. Do not
restart the earlier verification/import milestones below.

Read the session-three section in `docs/CLAUDE_HANDOFF.md` for exact state and
artifacts. API 4411 uses `/tmp/scene-animation-review/fable-data`; review runtime
4524 is the latest recorded one. Revalidate live state; use a fresh available
port starting at 4525 after runtime edits and restart the private API for server
changes. Do not operate the user's 4311/4337 services. Select the intended project
by stable ID/name, not array position. The verification café currently contains
added enclosure tables and split continuation clips; preserve the baseline copy.

### First implement natural stop hold and restart

The accepted navigation behavior still freezes the imported actor mid-stride.
This is visible through the hold in `fable-1x/blocked-recovery-1x.mp4` and its
contact sheet. It is safe route suppression, not human-looking waiting.

Important correction to the proposed "last contact phase before the block":
**do not rewind already-played motion to an earlier stance phase.** Changing
`routeStop` backward can recreate the very pose jump and altered history just
fixed. Preserve playback and exported history at and before the edit time.

Implement a shared, collision-aware transition from the current pose to a
supported resting pose, followed by a compatible restart when the path opens.
Use measured contacts, source phase and available captured stopping/starting
motion. Reuse `locomotionStops`, `capturedArrival`, `arrivalMatching`,
`navigationArrivals`, contact scheduling and transition machinery where they
fit; trace their actual assumptions before adapting them. Avoid a second
provider-specific animation system.

For anticipated obstacles, select a feasible future stopping phase/transition
within the remaining clear space. A plantable foot and sufficient braking/step
space must be demonstrated, not inferred from a clip name. For a sudden block,
prioritize safe current-state handling; do not continue into the obstacle just
to reach a nicer pose or teleport to a historical one. If the available motion
cannot supply a safe natural transition, preserve the safe state and expose the
specific limitation. Do not label a frozen swing or a disguised procedural gait
as completed natural-motion behavior.

During the settled hold, feet must be grounded and the body plausibly supported.
Retain supported captured upper-body/detail motion; avoid unrelated whole-body
freezing where an appropriate standing performance is available. Resume with a
compatible support foot, heading, hip offset and source phase. Do not plant by
stretching bones, sliding the feet, changing source speed silently or weakening
collision checks. This must work through shared code on the mapped Cesium rig
and ActorCore/Quaternius cases, without model/clip-name branches.

Reproduce failures and add meaningful regressions for blocks arriving during
left support, right support and swing; reopening early/late; repeated block/open
cycles; and explicit playback-rate changes. Check root/hips, foot contact,
orientation and source time at both transition boundaries, not just the route
guide. Record the actual UI workflow and close-up 1× before/after video. A wide
café overview is insufficient to judge foot support and skating.

### Close the remaining temporal boundary cases

1. Entry and arrival heading: reproduce replanning inside the first 8% and last
   15% of a route. The guide-point prefix alone does not preserve the fraction-
   based heading windows when route length changes. Preserve already-played
   orientation as well as position, using stable distance/time-anchored blend
   data or another evidenced solution. Measure before/after at the same times;
   do not just call a change "negligible" without testing it.
2. Long blockages: recovery currently throws when the held prefix exceeds 60
   seconds (`src/automaticRoutes.ts`). Test beyond this boundary. Respect schema
   limits with a supported persisted representation if extending recovery; do
   not lose destination intent or silently require rewinding while claiming
   arbitrary-duration automatic recovery.
3. Native imported travel: stop/recovery splitting currently has an
   `!intent.native` condition. Trace and test the native-performance path as well
   as transferred gait-on-route motion. Document and implement missing behavior
   where possible; the all-import requirement is not satisfied by one path.
4. Keep the completed pause/stop cancellation, superseded-job and project-switch
   semantics while changing transition scheduling. Verify subsequent actions
   and dialogue references after multiple continuation splits, and source
   identity/mapping after reload.

An obstacle placed directly through the body is already an invalid overlapping
state. Do not add an untested automatic "nudge" that teleports or crosses geometry.
Keep this case separate from a reachable, collision-free stopping transition.

### Then perform the original human-motion acceptance comparison

Return to the original reference video and scene named in the handoff. Render
the same ActorCore take on its original motion dummy and Party Woman at the
original duration, plus the imported route version. Include full-body and
hand/foot detail at explicit 1×. Inspect fingers, wrists, supported twist and
facial channels, stance/sliding, running, turns, arrivals and conversation waits.
Unsupported channels must remain explicit and correctly attributed.

Implement app-introduced motion/detail fixes discovered in this comparison.
Do not keep spending sessions exclusively on plumbing or invisible loop residuals
while leaving the user's primary visual complaint untested. Verify at least one
independent rig family after a shared fix; existing Cesium results do not imply
all future skeletons are automatically mapped.

For every new transition, compare preview, reverse scrub, saved/reloaded scene,
recording and exported GLB at off-key times across stop, settled hold and restart.
Use deterministic timestamp sampling at a declared frame rate for 1× footage.
Preserve captured timing outside explicit transition windows and rate edits.

### Finish each milestone with evidence and continue

Run focused failing-then-passing tests, then appropriate full checks and an
isolated build. Keep source snapshots, real before/after scenes, source provenance,
matched-camera footage, boundary measurements and remaining failures. Do not
weaken physical assertions or numerical thresholds to obtain a green result.
The crossing-actor test timeout was increased to 15 seconds in the last session;
retain that history and check runtime regressions rather than treating the larger
timeout as performance evidence.

Update the quality log and handoff with current runtime ports and the next
executable action. Continue through the open work while resources are available.
Report a partial checkpoint if the user stops you or credits end. Green tests and
export parity do not establish human-motion acceptance. Codex remains paused so
only you edit the runtime.

## Original assignment and full scope

The user wants you to continue substantial implementation work using the
remaining credits. The animation goal is NOT complete. Your last session
completed useful verification of the previous checkpoint, but did not change
runtime behavior. This assignment continues beyond that verification.

Codex is remaining paused. You are the editing agent. Work in
`/home/vincent/Repos/scene-maker` and preserve its extensive uncommitted and
untracked implementation. Read `docs/CLAUDE_HANDOFF.md` for the full original
scope, backups, infrastructure, evidence locations and safety constraints.
The four previously unrun scripts are now completed; do not restart the task
from that obsolete checkpoint instruction.

## Primary deliverable

Make the real user workflow work: **import an unfamiliar boned rig, use a newly
imported motion on a route, and navigate around obstacles with natural-looking
movement, stopping and resuming when required.** Implement the shared fixes
needed to achieve this. Do not stop after another baseline test run or findings
report while a reproducible, actionable failure remains.

Start with the existing implementations. `tests/automaticRoutes.test.ts` already
covers stationary and predicted moving obstacles, destination edits, cancellation
and blocked-route suppression at the function level. These are not missing
features to rewrite from scratch. Find where the real UI/playback/persistence
flow or visual behavior fails, then fix the responsible shared code.

## First make a real import and persistence case

Use a separate, clearly named verification scene. Preserve the user's original
scene and asset library. Start with the independent Cesium fixture and existing
licensed ActorCore/Quaternius assets; these are available locally. Then add a
genuinely independent rig family if practical and properly licensed. Renamed
copies and generated variants do not establish additional provider coverage.

Exercise the actual supported upload/conversion, library and UI path. The app
file input accepts GLB/FBX. The previous Cesium harness loaded a local file with
an explicit mapping and temporarily omitted URLs to pass scene validation; that
does NOT prove upload, persistence or user-facing mapping works.

Verify and fix as needed:

1. Import the model and motion through the real application workflow. Imported
   source identities, original tracks and duration must survive conversion.
2. Use the existing Animation rig mapping UI for unfamiliar joint names. Persist
   the mapping, save the scene, reload it, and confirm the same rig/motion works.
   No hand-edited fixture JSON as a substitute for this acceptance step.
3. Apply motion from another source to the receiver and create/edit a curved
   route. Preserve the source clip, explicit playback rate and supported detailed
   channels. Make unsupported channels visible and accurately attributed to the
   source/receiver pair. Do not silently substitute a procedural walk.
4. Confirm native duration at 1×, an explicit changed rate, and duration/path edits
   that do not silently stretch the captured take. Verify forward playback,
   reverse scrubbing, save/reload and exported GLB playback on this same scene.
5. Record a short reproducible UI walkthrough and save the scene artifact and
   precise steps. Fix shared import/mapping/timing/persistence failures you find.

The implementation must generalize. Do not add runtime branches keyed by
Cesium, ActorCore, Quaternius, Party Woman, a filename or a particular clip.
Explicit user mapping for unknown anatomy is valid; pretending arbitrary bone
names are automatically understood is not.

## Then complete the obstacle and recovery scenario

Use the same imported actor and source motion in the real viewport. Drive a
destination through the actual AI movement command/intent path, not only a
manually assigned test route. Test at least these distinct cases:

| Case | Required observed behavior |
| --- | --- |
| New scene and legacy scene lacking the setting | Animation collision detection starts enabled. |
| Explicit toggle off, save and reload, then toggle on | The user's setting persists; enabling it restores collision-aware behavior. |
| Static obstacle between actor and destination | Actor takes a clear route and reaches the intended destination without changing source cadence silently. |
| Animated obstacle crossing the route | Planning accounts for the crossing at the relevant time and movement stays clear. |
| Obstacle moved into the route during playback | A new plan is applied safely from the current state, without teleporting, rewinding to the route start, or applying a stale result. |
| No traversable route, then obstacle removed | Actor stops safely, retains destination intent, and can resume automatically when the route becomes available. |
| Destination moved during movement | Actor updates the route to the new destination without stale arrival or unrelated timeline changes. |

Treat collision geometry, actual motion and visual quality together. Inspect
foot/skin clearance and the body during the detour; a clear centerline alone is
not sufficient. Preserve intentional interaction contacts and account for a
carried object where applicable. Do not claim continuous collision guarantees
from a sparse sampling check; document sampling and remaining limitations.

For natural behavior, use captured motion and phase-aware transitions where
available. Avoid foot skating, abrupt torso yaw, a frozen mid-stride wait, or
an arrival that simply cuts off a walking pose. Preserve the source cadence
through replanning; extra travel may require extra captured steps/time, not
silent whole-take speed changes. If a needed performance is unavailable, expose
that limitation honestly instead of inventing evidence of natural motion.

Candidate areas to inspect: `src/automaticRoutes.ts`, `src/navigationWork.ts`,
`src/nativeNavigation.ts`, `src/nativeTravel.ts`, `src/routePlanner.ts`,
`src/routeClearance.ts`, `src/Viewport.tsx`, `src/App.tsx`,
`src/resolvedConversation.ts`, `src/capturedTurns.ts`, `src/capturedArrival.ts`,
`src/navigationArrivals.ts`, `shared/aiMovement.ts`, `shared/navigation.ts`,
and `shared/scene.ts`. Trace the actual failing path before choosing a fix.

## Continue into the original visual acceptance case

After the import/navigation milestone, revisit the original user scene and video
identified in the handoff. Render the same ActorCore take on its original motion
dummy and Party Woman at native duration, with clear full-body and hand/foot views.
Check fingers, wrists, feet, supported twist/facial motion, running, turns,
arrivals and conversation waits. Fix app-introduced losses or unnatural behavior
in the common pipeline. The user needs human-looking results, not merely smaller
floating-point residuals.

The prior approximately 6–7 mm running stance discrepancy and full-motion reach
loss remain useful leads. Match metrics to their original definitions and assets;
curved-versus-straight residual, receiver-versus-source error, physical reach loss
and actual sole sliding are different quantities. Zero in one metric does not
clear the others.

## Working and stopping rules

- Use the available Desktop Commander tools if the session lacks a device shell;
  that worked in your previous session. Inspect tool instructions before use.
- Validate live infrastructure first. The last known current review runtime is
  4503 and owned headless Chrome is 9451. Do not operate the user's Chrome 9445.
  After runtime edits use a fresh unused port, starting at 4504, with
  `test-results/review.config.ts`; its HMR/watch is disabled. Update scripts to
  target the new runtime. Reusing a cached old server is not testing new code.
- The baseline is 1,026 passing tests. Add meaningful failing-then-passing
  regressions for the actual failures fixed. Preserve all existing requirements.
  Run focused tests during development and the appropriate full checks after
  changes. Build to a separate `/tmp/scene-animation-review/...` directory;
  do not replace production `dist/`.
- Do not spend this session repeatedly classifying the invisible loop residuals
  already investigated. Retain the evidence and unchanged thresholds. Revisit
  them only if a current visible failure depends on them.
- If a scenario already passes, record its concrete evidence and move to the next
  unresolved case. Do not manufacture code changes to satisfy a quota. If it
  fails, implement and verify the fix before moving on, unless genuinely blocked
  by missing information or unavailable source material.
- A natural-motion failure is not resolved by weakening a check, hiding a
  warning, switching collisions off, dropping an animation channel, discarding
  navigation intent, or narrowing testing to the original two rigs.
- Continue through these deliverables while resources are available. A green
  baseline, one rendered loop, or a list of open issues is not completion of
  this assignment. If credits/time run out or the user stops you, leave an exact
  partial handoff and identify the next executable action.
- No concurrent agents editing the same files, destructive cleanup, commits,
  merges or deployment are needed for this assignment. Keep the current worktree
  intact and update the dialogue requirements document when shared behavior
  changes affect its integration.

## Evidence to deliver

For each completed milestone provide the exact source changes, a reproducible
before-fix failure, the meaningful regression test and its result, saved scene
and input provenance, and a before/after 1× video with foot/detail views where
relevant. Show the actual UI persistence/replanning behavior. Compare preview,
scrub and export for the same scene rather than unrelated fixtures.

Update `docs/ANIMATION_QUALITY.md` and `docs/CLAUDE_HANDOFF.md` with the current
runtime port, completed commands, artifacts, remaining failures and rejected
experiments. Report implemented improvements separately from verification-only
work. Be precise about what still prevents acceptance of the full goal.
