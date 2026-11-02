# Handoff to Claude — 2026-11-02

## User's latest instruction and clarified objective

The user explicitly said **“stop, and create a handoff to Claude.”** Implementation
is stopped. The Codex goal is paused. No goal-completion claim is justified.

Immediately before stopping, the user clarified:

> remember, we are NOT trying to get every rig working with the animations, we
> are instead trying to get the animations working with any new rig imported and
> any animation imported can go on any rig (standard rigs and animations, not
> non-standard) - does this change anything for your goal?

This is the controlling scope: **a general import-and-retarget system for newly
imported standard humanoid rigs and newly imported standard humanoid animations**.
Existing characters and takes are regression fixtures, not a whitelist. Do not
solve this by accumulating per-character/per-take exceptions or curating a finite
animation bank. Better defaults are useful but do not satisfy the central goal.
Motion must look natural at normal speed, preserve representable detail and report
channels a receiving rig cannot represent. Do not invent uncaptured finger/face
motion or claim universal compatibility from fixture counts.

## Read first and protected state

1. Read this handoff.
2. Read **all of `docs/NATURAL_MOTION_CONTINUATION.md`**, including its older
   preservation findings and final session handoffs. It was read fully this turn.
3. Read the original requirement attachment:
   `/home/vincent/.codex/attachments/7c02869b-dc29-4389-84bd-1acf319b5125/pasted-text-1.txt`.

Work only in `/home/vincent/Repos/scene-maker-natural-motion`.
Branch: `fix/natural-motion-baseline`. HEAD remains **`10d1d01`**.
**No commit was made this session. There are intentional uncommitted changes.**

Do not modify `/home/vincent/Repos/scene-maker`, `scene-maker-dialogue`, user
services **4311/4337**, or `/tmp/scene-animation-review/astra-data` and the protected
Astra project. No such state was modified this turn. Private review projects were
read, not recreated or saved. Private data remains `/tmp/scene-natural-motion/data`.

Keep collision defaults/toggle, detours/replanning, immutable played history,
70-second waits/recovery, native source clocks, transitions, seeks and export.
No planner, collision, clock, source asset or default gait changed this session.

## Uncommitted candidate — NOT accepted or fully validated

Current `git status` before this documentation was written:

- Modified `src/rig.ts` (three added integration lines).
- New `src/handClearance.ts`.
- New `tests/handClearance.test.ts`.

This handoff and an appended continuation note are additional documentation.

The latest prior handoff identified Party Woman's hand inside clothing during
CMU 91_34. The initial saved frame was inspected again: the left hand is largely
inside the skirt; right hand points strongly outward. Earlier anatomical audits
do not establish lost arm motion as the cause. The source itself includes hand
flexion, and the target has different proportions/clothing. This motivated a
**generic receiving-surface adaptation experiment**, not a source-specific patch.

Candidate implementation:

- `captureHandClearance` captures skin membership once, using mapped anatomical
  joints, ancestry and weights. No provider, mesh, character or take names.
- Body triangles have no arm-descendant weight; hand probes have >.999 weight
  from that hand's descendants. Mixed cuff vertices are not probes. Only skinned
  geometry is currently considered; rigid attachments are not handled.
- At each transferred pose, constructs a torso coordinate frame from hips and
  shoulders, deforms selected skin vertices and measures lateral body/clothing
  clearance for low, hanging, same-side hands. Height, lateral position and arm
  extension have smooth activation envelopes. Raised/crossed gestures are excluded.
- Uses a projected triangle envelope with tapered edge extension. This is a
  conservative surface approximation, **not a watertight collision detector**.
  2D spatial bins and per-side bounds keep it practical on the measured receiver.
- Correction is bounded to 18% of measured arm length (lateral displacement),
  with eased onset/cap. It swings the complete arm minimally at the shoulder,
  preserving the recorded elbow bend and auxiliary joints' local articulation.
  It restores the hand's world rotation; finger local articulation is unchanged.
- Detached hand/arm chains are conservatively skipped. No stretching/reparenting.
  Geometry and coordinate checks are generic, but that does NOT establish all
  standard-rig support or all-pose contact quality.
- No temporal accumulation/filter state; intended to be deterministic under
  reverse seeking and equivalent source cuts.
- `rig.ts` calls capture during imported-rig configuration and the solve after
  successful detailed transfer, before foot clearance. **Native original playback
  does not call this correction.** The coarse retarget fallback is unchanged.
- `group.userData.handClearance` reports current per-side displacement. It is
  diagnostic state, not persisted user data or a new UI control.

Important open concern: this may be too aggressive for some real performances.
It has not been accepted as a final solution. Keep, revise or reject it based on
normal-speed evidence and generalization, not the work already invested in it.

## Rejected/intermediate experiments and unresolved risks

The first version used hard lateral ray intersections and two-segment IK.
A frame showed the resting hand outside the skirt, but that alone is insufficient.
A hard silhouette/hem query can pop at openings. The current version tapers each
projected triangle past its edges and swings the full arm instead of selecting a
new IK elbow pole. This preserves elbow bend and avoids a potential pole flip.

Do not confuse the first experiment video/collision report with the current code:

- `hand-clearance-experiment-1x.mp4`: first six seconds, close crop, old ray/IK.
- `collisions.json`: old ray/IK results from the prior signed-distance diagnostic.
  That diagnostic is not certified penetration measurement; see earlier handoff.
- `rejected-ray-audit.json`: old ray/IK full-take displacement scan.
- `audit.json`: last **manual-call shoulder-swing** full-take scan before product
  integration (same algorithm except final finite checks/report reset).

The final scan still has large correction changes: about **18.85 mm over one
1/120-second step** near source 17.3583 s, and other large changes around 17.27 s.
Their cause was NOT resolved. Could be source hand motion, envelope sensitivity,
or another implementation/harness issue. Do not claim the edge extension fixed
those measured changes. Dense sub-frame checks and actual full-motion review are
still needed. No smoothing of original capture values was introduced.

The audit driver calls `applyHumanoidPose` and `applyTransferredClip` in a loop
without explicitly resetting `target.position` each time. Check whether this
accumulates world travel before trusting its absolute-coordinate diagnostics.
The measured frame is hip-relative, but audit hygiene still matters.

Two intermediate audits wrote the same `audit.json` concurrently. Their logs
show ~42.22 ms/pose for an unoptimized envelope and ~2.80 ms/pose with per-side
bins; the later dedicated shoulder-swing run finished last and reports **2.45
ms/pose** on this receiver. These are local diagnostic averages, not a general
performance guarantee. The 42 ms intermediate implementation is not current.

The existing manual-call `hand-clearance-audit.mjs` and
`hand-clearance-collision.mjs` will **double-apply** the solve if run against the
integrated runtime. Adapt them or use the frozen pre-integration rig runtime.
Likewise, old experimental ports are not reliable frozen baselines.

## Completed checks — limited claims only

- `tests/handClearance.test.ts`: latest **8 tests pass**. Includes different scale
  and placement; skin clearance in a synthetic fixture; unchanged lengths/root,
  wrist orientation and finger articulation; clear/raised hands; reverse-order
  sampling; bounded mismatches; detached hands; clothing hem continuity; and
  unfamiliar names/different local bone axes with independently rebound skins.
  Test title mentions hierarchy units, but explicit scale coverage is in the
  separate parameterized test, not an exhaustive exporter/unit matrix.
- After integration, focused run passed **53 tests across 3 files** (handClearance,
  retarget, footSurface). This was before the last two hand-clearance tests were
  added; the 8-test file then passed separately. A requested fourth filename did
  not match a file; do not report four files or a captured-library test run.
- TypeScript passed on the INITIAL unintegrated prototype only. **Final typecheck,
  full suite, formatting/diff check and production build have NOT been run.**
- Final integrated route matrix: **140 cases**, two gaits × straight/curved paths
  × source/Party/bundled/private dummy receivers. Max bone change across +/-1us
  repeat samples 0.008496 mm; sampled skin 0.008104 mm; angle .0000289974 rad;
  finite-h velocity residual .0270012 m/s; no threshold failures. This checks
  regression fixtures, not arbitrary future imports or naturalness.
- Final integrated source-cut matrix: **140 cases**; max bone 3.5802005e-8 m,
  sampled skin 2.5802492e-8 m, angle 5.9604645e-8 rad. Existing split fidelity
  appears preserved at those samples. No new full history/export audit ran.
- Prepared but **did not run** `hand-clearance-preservation.mjs` and
  `hand-clearance-export.mjs`. No final actual UI/preview/save test, native-source
  preservation audit, 70-second recovery audit, or export/reload check ran.
- Previous committed implementation's full validation remains the 1,167-test
  baseline described in the continuation document. It does not validate this edit.

## Normal-speed evidence and artifact locations

Work directory: `/tmp/scene-natural-motion/hand-clearance`.
Durable ignored copy: `.data/natural-motion-investigation/hand-clearance`.

Current-code video completed as the user asked to stop:

`hand-clearance-before-after-1x.mp4`

552 frames at 30 fps, 18.4 seconds, covering all of 91_34 at native source cadence.
Left is frozen 10d1d01 transfer; right is integrated candidate; identical take,
phase and framing. Baseline local transforms were recorded from frozen runtime
4614 and replayed on an independent matching hierarchy alongside candidate 4613.
It is an offline fixed-time render, NOT a real wall-clock UI playback recording.
**The final movie was not visually reviewed before stopping.** Its encoder ended
successfully and ffprobe confirmed duration/frame count. Do not call it accepted
natural animation. Earlier frame inspection applied only to the old experiment.

Reports/logs: `route-matrix.{json,log}`, `split-matrix-after.json`,
`split-matrix.log`, `focused.log`, `swing-audit.log`, `audit.json`,
`final-video-stats.json`, `final-review.log`, `before-native-poses.json`.

Ignored `test-results/hand-clearance-*.mjs` drivers cover experiment rendering,
audits, collision diagnostic, final rendering, route/split matrices and prepared
preservation/export. Frozen config: `test-results/hand-before.config.ts`.
The durable archive includes these drivers and code snapshots, but excludes
large frame directories and licensed source/export GLBs.

## Live private runtime at stop

All review/audit node jobs completed before cleanup; none remains pending.
The final render finished naturally while stop/handoff cleanup was being issued.
Owned review tabs were checked/closed. Private servers were left available for
Claude; revalidate PIDs/cwd/env before any lifecycle action.

- API **4413**, listener PID **2893124**, private data path above.
  Started via `PORT=4413 SCENE_MAKER_DATA=/tmp/scene-natural-motion/data
  node_modules/.bin/tsx server/index.ts` from this worktree.
  Its startup text misleadingly says 4311; inspect the listening socket.
- Candidate Vite **4613**, PID **2896921**, `test-results/natural.config.ts`.
- Frozen baseline Vite **4614**, PID **2897142**,
  `test-results/hand-before.config.ts`. Overrides ONLY `src/rig.ts` from
  `/tmp/scene-natural-motion/hand-clearance/before-rig.ts` (10d1d01 contents).
- Owned headless Chrome **9451**, PID **2893221**,
  profile `/tmp/scene-natural-motion/chrome-hand-clearance`.
- Intermediate Vite ports 4609/4610/4611/4612 remain listening. They were used
  for unintegrated experiments; do not treat them as final or reliably frozen.
- HMR/watch is disabled; start a fresh unused Vite port after runtime edits.
- Use `FABLE_APP=http://127.0.0.1:4613` for final drivers. Check each driver for
  hardcoded baseline/current URLs before reuse.

## Suggested next decision for Claude

Do not blindly finish this particular solver. First assess whether it is the
right generic correction for standard imported rigs/animations. Inspect the
completed normal-speed movie and the unresolved late-take correction changes.
Then either harden/generalize the candidate with independent imported fixtures,
or retain it only as a rejected experiment and pursue the better solution.

If keeping it, verify native-source preservation, complete wrist/finger/helper
behavior, new imports with different proportions/bind poses, dense continuity,
actual preview timing, long collision-wait history and export before committing.
Keep source detail and navigation semantics. Do not weaken existing acceptance
bounds to make these tests pass. Update the continuation document with actual
findings and limits. The user does not want a finite compatibility whitelist.
