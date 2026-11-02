# Claude autonomous session log — 2026-11-02

Budget: 6 hours, started 10:08 MST, hard stop 16:08 MST.
Scope (user, controlling): a general import-and-retarget system for new standard
humanoid rigs and animations. Existing characters/takes are fixtures, not a whitelist.
Worktree: `/home/vincent/Repos/scene-maker-natural-motion`, branch
`fix/natural-motion-baseline`, starting HEAD `10d1d01` plus the uncommitted
hand-clearance candidate.

Each entry: decision, rationale, evidence. Evidence directory for this session:
`/tmp/scene-natural-motion/claude-session/` (durable copy under
`.data/natural-motion-investigation/claude-session/`).

## D1 — Reject the lateral hand-clearance candidate (10:08)

Decision: do not ship `src/handClearance.ts`; revert its three `src/rig.ts` lines.
The candidate source/test are already archived at
`.data/natural-motion-investigation/hand-clearance/candidate-*.ts`.

Rationale: the unreviewed before/after movie shows CMU 91_34's left hand moving to
the front of the belly (≈17.0–17.4 s). The candidate treats that as penetration and
pushes it to the hip: left correction 0 → 88 mm between 17.23 s and 17.30 s, back
to 0 by 17.50 s (`final-video-stats.json`). That is the unexplained "18.85 mm per
1/120 s" jump. Cause is structural: the inside test compares lateral position
against the body's lateral extent in each (height, depth) cell, so a hand in front
of the torso is indistinguishable from a hand buried in the hip. A correction that
silently rewrites recorded contact gestures violates the preservation requirement.
The resting-pose improvement at 0 s is real, so the problem it targeted remains.

Evidence: frames `f0.2.png`, `f17.3.png`, `late.png` copied to the session evidence
directory.

## D2 — Measure before designing; drop skeleton-derived body width (10:12)

Driver `test-results/claude-body-profile.mjs` → `claude-session/body-profiles.json`.
All values below are in units of each rig's hip-to-shoulder torso length, in a torso
frame (x lateral, y up from the hip-joint line, z forward).

- Hip-joint half spacing: CMU 0.231, ActorCore Dummy M 0.181, Dummy F 0.197,
  Party Woman 0.178, Quaternius 0.291. CMU's ASF hip joints sit much wider than
  ActorCore's for comparable bodies, so joint spacing reflects skeleton convention,
  not flesh. Estimating a source body surface from the skeleton (what I proposed as
  option 1 for skeleton-only sources) would be wrong. Rejected.
- CMU's only "skin" is the visualization capsules (hip half-width 0.29); not a body.
- 91_34 at 0 s: source left wrist (0.39, -0.10, 0.03); rotation-only transfer on
  Party (0.34, 0.01, -0.09). Party's skirt half-width at that height ≈0.34–0.36,
  so the wrist lands at/inside the surface. Shorter receiver arms (1.05 vs 1.15),
  narrower shoulders (0.29 vs 0.33) and wider hips/skirt all contribute.
- 91_34 at 17.3 s: source left wrist (0.15, 0.13, 0.37) in front of the belly;
  Party transfer (0.18, 0.17, 0.24) while Party's belly front is ≈0.29–0.31. The
  hand really is embedded in the belly. The rejected candidate's lateral push moved
  it to the hip; the correct resolution is outward through the nearest body side,
  i.e. forward, preserving the hand-on-belly contact.
- Pure torso-normalized hand placement is also unsafe: Quaternius bodies are
  ≈0.41–0.45 wide at hip height, wider than CMU's hanging-hand offset (0.39).

Decision: correct only against the RECEIVER's skin, with a radial (around the
torso axis) envelope instead of a lateral one, so the push direction follows the
body side the hand is actually in. Applies only to transferred playback.

## D3 — First radial version jitters; replace max-of-cones with a smooth solve (10:15)

Radial envelope v1 (cone per body vertex, hard max, two shoulder-swing passes):
91_34 → Party, 2,207 samples at 120 Hz, 2.16 ms/pose including the whole transfer.
It no longer pushes the belly gesture to the hip, but `claude-hand-jitter.mjs`
shows the correction adds high-frequency motion: second difference of the
correction vector p99 11.3 mm / max 21.2 mm per 1/120 s, versus p99 7.6 mm for the
uncorrected (already noisy CMU) wrist. Example 3.66–3.75 s: correction swings
52↔67 mm between adjacent samples with 2–11 mm residual penetration. Causes: hard
max over probes/vertices (kinks), and two approximate passes that do not converge.

Decision: (1) body surface = kernel-weighted soft-max of vertex radii around each
(height, arc) query, normalized by kernel weight so mesh density does not inflate
it, and blended to zero where there is no nearby body; (2) push distance = root of
a smooth soft-max penetration along the wrist's radial direction, evaluated with
the exact displacement a shoulder swing produces (hand orientation is restored, so
hand vertices translate rigidly with the wrist). No temporal state is added.

## D4 — Iterations to a stable, visibly correct solve (10:16–10:23)

Each step measured on 91_34 → Party Woman, full take at 120 Hz
(`claude-hand-sweep.mjs`, `claude-hand-jitter.mjs`); runtime ports 4615–4620.

| version | max corr. L/R mm | residual mm | corr. 2nd diff p99/max mm (L) |
|---|---|---|---|
| cones + hard max + 2 swing passes (4615) | 77 / 42 | 26 | 11.3 / 21.2 |
| kernel soft-max (mean, k=60) + root search (4616) | 46 / 4 | 0.3 | 8.7 / 33.6 (jump 33→0 at 17.22 s) |
| + probe-weighted push direction, fixed-point (4617) | 45 / 7 | 4.4 | 5.0 / 18.6 |
| + outer-layer k=200, compact kernel (4618) | 73 / 51 | 49 | 9.6 / 51.0 |
| + monotone steps (4619) | 75 / 51 | 52 | 6.6 / 24.8 |
| + two-bone IK instead of shoulder swing (4620, current) | 76 / 51 | 4.3 | 6.6 / 16.3 |

Uncorrected CMU wrist 2nd difference is p99 7.6 / max 24.5 mm (source noise);
corrected wrist is p99 8.2 / max 31.0 mm (left), right max unchanged at 40.9 mm.

Key findings: (a) root search on a non-monotone penetration curve jumps between
roots — replaced by monotone linearized steps; (b) the k=60 weighted mean sat ≈2 cm
under the skirt because dense skin under a thin clothing shell pulls a mean
inward — visible in `close-start` frames; k=200 plus a saturating coverage term
fixed it; (c) a shoulder swing cannot move a forward-held hand away from the body
(the push is along the shoulder–wrist line); two-bone IK with the recorded elbow
pole (small backward default only as the arm straightens) resolves it.

Visual (offline 1×, 30 fps, same source clock, frozen 10d1d01 left / current right):
`claude-session/review/close-start-before-after-1x.mp4` (0–4.5 s) and
`close-end-before-after-1x.mp4` (16.5–18.4 s). Fingers no longer pass through the
skirt in the opening stance or final stance; the hand-on-belly gesture at 17.3 s is
retained (hand rests on the belt) instead of being moved to the hip.

## D5 — Further continuity fixes, then narrow the scope (10:24–10:36)

Smooth ActorCore sources (Thoughtful walk wrist 2nd difference ≈3 mm max at 60 Hz)
exposed pops the noisy CMU take had hidden:

- Push direction from a soft-max over probes flipped between palm and curled-finger
  clusters within ~1 mm of motion (Party 3.63 s, 48→28 mm in one 1/120 s step).
  Fixed: direction weights ∝ (positive penetration)².
- Monotone linearized steps overshoot on the first step and never return
  (0.115 torso at 3.617 s, 0.06 one sample later). Fixed: push distance = length of
  the push path still inside the body (20 samples, linear interpolation). This is
  continuous by construction and equals the exit distance for monotone exits.
- A depth fade-out for deeply buried hands was tried and rejected: it flipped
  between states (1→52 mm in one 1/60 s sample). Soft cap retained; buried hands are
  reported in `handClearance.unresolved`.
- Numerically differentiated surface normals were tried for the push direction:
  noisier (p99 6.6→10.7 mm) and did not fix the case they targeted. Rejected.

Visual check that changed scope (`review/actorcore-party-folded-1x.mp4`, 2–6 s of
Thoughtful walk on Party): with folded arms, the transferred hand tucks under the
opposite arm against the chest — hidden, natural. The solver pulled it out (77 mm,
capped) and the forearm stuck out sideways. Same failure class as D1. The
behind-the-back case on stylized Casual Female (hands buried 10+ cm in a much wider
body) also only relocated the hands to the hip sides.

Decision: restrict activation to hands at their own side of hips/thighs/lower
torso — smooth fades for height (off above 0.55 torso), crossing the midline
(off at the midline, full at 0.12 torso on own side) and behind the body (off
behind −0.3 torso). Crossed arms, chest contacts and behind-back contacts keep the
transferred pose unchanged. This covers the original visible defect (resting and
hanging hands in clothing, the hand-on-belly gesture) without touching deliberate
inter-limb contacts. Not solved: hands buried by gross proportion mismatch in those
excluded regions.

## D6 — Smooth surface caps and a wider kernel; current algorithm (10:40–10:55)

Pirate Male (low-poly hand, belt accessories) showed f(0) jumping 0.107→0.022 torso
for a 0.013 torso wrist move. Cause: with a strong outer-layer bias and only a
compact taper, a protruding vertex keeps almost full height across the window and
falls off a cliff in its last ~1%. Fix: Gaussian log-space falloff (exp(−3.5q)) so
each vertex is a smooth cap, coverage measured with the broad taper (sparse
low-poly meshes are not undercut), and σ widened 0.035→0.06 torso (the narrower
effective kernel exposed cloth wrinkles: Party Relax 0.9→3.2 mm max).

Correction second difference at 60 Hz (mm, max) vs source wrist max, Vite 4629:

| case | source L/R max | correction L/R max |
|---|---|---|
| ActorCore Thoughtful walk → Party | 2.8 / 3.3 | 8.4 / 4.1 (was 25.3 / 4.8) |
| ActorCore Relax → Party | 0.8 / 0.8 | 1.1 / 1.0 |
| ActorCore Thoughtful walk → Casual Female | 3.1 / 3.5 | 10.6 / 8.7 (was 94 / 59) |
| CMU 91_34 → Party | 32.5 / 16.9 | 13.8 / 8.3 |
| CMU 77_02 → Party | 27.0 / 32.1 | 27.3 / 10.5 |
| CMU 91_34 → Pirate Male | 30.1 / 14.1 | 26.5 / 26.0 (was 57 / 29) |

91_34 → Party full take: 2,207 samples at 120 Hz, 2.25 ms/pose for the whole
transfer, max correction 75/52 mm, residual ≤ 7.9 mm (L) / 0.3 mm (R).

1× review movies, all `claude-session/review/`: `close-start-…`, `close-end-…`
(91_34 on Party vs frozen 10d1d01), `actorcore-party-folded-1x.mp4` (no change to
folded arms), `actorcore-casual-behind-1x.mp4` (behind-back hands only lightly
touched, gesture kept), `cmu-pirate-1x.mp4`. Left = no correction, right = current.

## D7 — Source-contact allowance, performance, validation, commit (10:42–11:00)

- Full suite caught a real violation: a motion shared onto the SAME body changed
  ("Settle into a seat" leftArm 0.0037 rad) — the solver pushed out a hand the
  source itself rests on its thigh. Fix: when the source rig has skin, its own hand
  penetration at the same instant is allowed on the receiver; identical bodies are
  unchanged; skeleton-only sources allow nothing.
- That doubled cost and timed out the 17-motion × all-bodies unit test (>5 s vs
  1.2 s baseline). I did not raise the timeout. Profiling: 2.3 s in three.js
  `getVertexPosition` (two 4×4 multiplies per vertex influence) plus Map binning.
  Per-bone skinning matrices on raw arrays, typed-array grid, focusing the body
  build on the region probes can reach, 40 probes and 12 path samples → test
  ≈2.4 s; browser 1.0 ms/pose for the whole transfer.
- All gates pass (details in the continuation doc section "Receiving-body hand
  clearance"). Committed locally on `fix/natural-motion-baseline` (no push):
  milestone commits are this branch's convention and the handoff's listed
  pre-commit checks were all run.

## D8 — Rig-authoring invariance; anatomical arm/hand/finger rest (11:02–11:14)

Goal-driven question: does transfer depend on how a standard receiver happens to
be authored? Harness `test-results/claude-rig-variants.mjs` re-authors Party Woman
(raw GLB), exports to GLB and re-imports through the app loader, then transfers CMU
91_34, ActorCore Thoughtful walk and Quaternius Walk and compares every bone's world
position/orientation (matched by name) with the identity round trip.

Harness errors found and fixed before trusting results (recorded so nobody repeats
them): glTF inverse bind matrices can define a bind pose different from node rest,
so every variant must first re-bake skin at the shared rest; representation-only
changes must then only recompute inverse binds, never re-bake (re-baking with old
inverses deformed the mesh: 101–777 mm false errors); my first A-pose elbow bend was
in a non-anatomical plane (87° false error); skin comparison is invalid for
bind-pose variants (re-baked rest + re-skin double-blends weighted vertices), so the
metric is bone transforms. Rest-shape check vs identity guards the harness.

Findings on the committed 1987b07 runtime (max bone error after transfer):
local axes 0.00 mm, centimetre units 0.00 mm (invariant); A-pose swing 0.8°,
+10° forward 4.7°, +25° palm roll 21°, finger rest curl 20°/joint 40°.

Decision: add `src/restNeutral.ts`, applied in the existing neutral pass to every
rig (source and receiver alike), name-free:
- wrist straight (hand → mean non-thumb finger base along the forearm);
- forearm twist from the palm line across the four finger bases (thumb, found as
  the chain angled clearly furthest from the forearm, only fixes the sign);
- upper-arm twist from the bind elbow hinge only for clearly bent binds (15–25°
  fade-in). Measured binds are 0–4.4° bent, where the hinge is noise (Dummy M's
  flipped ±175° at 0.8°); the first version used it from 2–6° and treated Party's
  left/right arms differently. Palm roll is NOT put into the upper arm (pronation is
  a forearm motion; doing so moved a forearm-only bind roll into the shoulder);
- finger chains straight; thumb straight at a fixed opening toward the front.
  First thumb version kept the bind thumb's azimuth (20° residual); fixed.
- Hands without ≥3 non-thumb chains and a thumb (CMU, Quaternius) keep old twist.
Thumb-base azimuth as palm reference was tried and rejected: it varies ≈±10°
between Character Creator bodies with identical binds.

After (Vite 4637): units 0.00 mm/0.03°; A-pose swing 0.8°, forward/elbow/palm-roll
4.65° (upper-arm twist helpers only), finger curl 2.4° (ActorCore fingers; CMU has
no finger data so the receiver's own authored finger rest correctly remains).
Visible agreement, native ActorCore source vs Party over 680 hand samples:
knuckle-line direction p50 14.2°→8.4°, max 18.1°→10.3°; hand pointing p90
11.6°→8.8°. Effect on existing transfers (`claude-rest-impact.mjs`): forearm/hand
2–9.6°, fingers 4–12.8°, upper arms ≈0, CMU→Casual Female exactly unchanged.

Gates on 4637: full suite 1,181 tests (1,178 + 3 new); route 140 cases unchanged
maxima; source cuts 140 unchanged; native preservation exact; 70 s wait history
3.445e-8 / 6.005 mm; export 2,248 samples max 0.00098 mm; real UI unchanged/no
errors; build OK. Hand clearance on 91_34→Party: residual ≤8.1 mm, correction 2nd
difference max 16.0/8.8 mm (source 32.5/16.9). New `tests/restNeutral.test.ts`: two
of three tests fail with the normalization stubbed out.

## D9 — Source-side invariance: unit-independent check, torso by topology (11:15–11:37)

Harness `test-results/claude-source-variants.mjs` re-authors the SOURCE (ActorCore
Dummy M with Thoughtful walk), keeping its visible motion (bind-only changes leave
glTF tracks alone; unit/armature/name changes convert the tracks), re-imports it and
transfers to unchanged Party Woman. Metric: every skin-weighted receiver bone (the
unweighted `root` control follows the source frame and is invisible).

Findings and decisions:
- A centimetre source armature (bone translations ×100 under a 0.01-scaled node,
  tracks converted) was REFUSED for sharing: "This action changes bone lengths or
  scale". `transferWarning` compared bone-translation tracks with the bind in local
  units against 1e-4, i.e. 1 µm in centimetres; ordinary capture jitter failed.
  Fix (`src/rig.ts`): deviation in world units (parent world scale) relative to body
  height, tolerance 6e-5 × height (= the old 0.1 mm for a 1.7 m body). Scale tracks
  keep the dimensionless 1e-4. Now 0.02° and accepted.
- Z-up (Blender-style) rotated armature: 0.02° (already invariant).
- Source A-pose bind with rolled palms: 0.24°; source finger-rest curl: 2.3°.
- Mixamo-convention names on the same body: torso driven one segment off (the
  name table calls Mixamo "Spine" the spine, which sits where Character Creator has
  "Waist"; Mixamo Spine2 = chest). New in `src/detailedRetarget.ts`: torso chains
  (hips → arm/head branch) mapped by normalized height, slerping between source
  joints; the branch always maps to the source branch. Exact raw-name anchors only
  within one convention (at least one non-canonical torso bone shares its exact
  name); canonical role labels and prefix-stripped names never anchor. Disabled
  (listed AND unassigned) or ambiguous torso roles keep the old named matching.
  Pitfalls hit on the way, all fixed: `disabledRigRoles` also lists valid explicit
  assignments (blocked CMU sources); `normalized()` strips `mixamorig` so
  "mixamorigSpine" falsely anchored to Party's "spine"; a Python replace with an
  empty match mangled the file once (restored from backup, re-applied with
  occurrence assertions).
- Remaining (not fixed): twist/share helper bones match only by exact name, so a
  renamed source loses their data (upper-arm twist 55°, elbow share 53°, forearm
  twist 18°, thigh/calf twist ≤8° on that variant). Geometric helper matching like
  `forearmRoll.ts` would generalize it. Logged as next work.

Torso effect on existing fixtures (`claude-torso-shape.mjs`, bend away from each
rig's own rest along normalized height): CMU 91_34 → Casual Female p50 2.53°→1.28°,
p90 7.02°→3.99°, max 10.81°→5.87°; 91_34 → Party p50 2.24°→2.69° (p90/max equal);
69_06 → Party unchanged. ActorCore → Party / Dummy F exactly unchanged (same
convention, exact anchors). CMU → Party upper body moves ≤14.6 mm (legs 0.000 mm).
My first impact readout mislabelled toe bones as fingers (regex), briefly suggesting
a whole-body shift; a direct per-bone comparison and a sampling-history test (fresh
vs prior samples: 0.000 mm on 4614/4630/4637/4643) ruled that out.

Gates on Vite 4644: suite 1,184 tests (3 new: torso naming convention, centimetre
armature ×2 — each fails on the previous code); route 140 unchanged maxima;
source cuts 140 (≤3.58e-8 m); native preservation exact, transferred lower body/
root ≤1.4e-15; 70 s wait 3.445e-8 / 6.005 mm; export 2,248 samples ≤0.0035 mm;
real UI unchanged/no errors; typecheck, Prettier, diff, build OK.

## D10 — Limb helper bones matched by their place on the limb (11:38–11:44)

New `src/limbHelpers.ts`, called from the detailed plan after name pairs and
`forearmRoll.ts`: on each anatomical limb segment (upper arm, forearm, thigh, calf),
non-anatomical bones that branch off the segment's start joint, lie within 10% of
the segment length from its axis and are not otherwise paired are located by
fraction along the segment; source and receiver helpers pair only on a mutual,
unique (second candidate ≥0.1 further) nearest match within 0.2. Receivers with
skin only drive weighted helpers (unweighted controls untouched); explicit roles
and exclusions win; unmatched helpers keep following their parent as before.

Renamed-convention ActorCore source → Party (vs same-convention reference):
upper-arm twist 55°→0.1°, forearm twist 18°→0.1°, thigh/calf twist ≤8°→≤2.6°.
The right ElbowShareBone (53°) stays unmatched: it sits at a fraction ambiguous
with a forearm twist bone, so the matcher declines — conservative by design.
Existing fixtures (CMU→Party/Casual, ActorCore→Party/Dummy F, Quaternius→Party)
exactly unchanged. New test (renamed helpers on the CC fixture) fails on the
previous code. Gates on Vite 4646 all identical to D9 values; suite 1,185.

## D11 — Sole-flat foot rest (11:45–11:56)

Receiver variants (`claude-rig-variants.mjs` feet/stance): a bind with feet
pitched 20° gave every transferred pose 20° foot error (toe joints 73 mm); a legs-
apart, bent-knee stance only 1.9°. Decision: the foot's neutral is "sole flat":
with the leg vertical, the skin's lowest supporting line under the ankle (sagittal
lower convex hull) is level — physically right also in heeled shoes. Toes likewise
from the support line under their own region. Applied to every rig in the shared
neutral pass, AFTER detached joints follow their anchors (a detached foot first
failed `footSurface.test.ts`: attached/detached copies disagreed).

Guards, each motivated by measurement: bind sole slopes of real bodies are ≈0
(Party 0.3°, Dummy M −0.3°, Dummy F −0.9°); CMU visualization capsules gave a
degenerate −82° with zero span; Quaternius blocky feet only 2 cm of support. A
line must cover ≥30% of the foot (15% for toes) and lie ≥20% of its span below
the joint (10% for toes): a capsule around the bone has only its radius below it
— my first synthetic capsule test proved coverage alone did not reject capsules
(CMU was skipped only by geometric luck). Otherwise the bind is kept.

Unexpected existing defect found and fixed by this: Party Woman's left sole was
pitched while the source stood still — 12–14° on 91_34 (now 4.5–6.5°), up to 10°
on 77_02 (now −4…2°), 5.5–9° on ActorCore Relax (now −2…2°); the right foot was
already within ≈5°. Cause: her bind legs are not vertical, so the legs-vertical
neutral left her left sole ≈7.4° off level. Side-view stills
`claude-session/feet/{old,new}-{91,relax}.png`: shoe heel tip and toe box now
level. Foot variant after: 0.85° (uniform ≈21 mm position offset there is most
likely my re-baked shoe geometry changing ground support — not proven).

Gates on Vite 4653: suite 1,187 (2 new foot tests; the leveling test fails with
the normalization stubbed); route 140 unchanged maxima; source cuts unchanged;
native exact; transferred body height changes ≤21.8 mm (ground support under
flatter soles); wait 3.448e-8 / 6.005 mm; export ≤0.0035 mm; UI clean; build OK.

Process note: `pkill -f "port 4651 "` also matched its own shell command line and
killed that shell (and my Vite 4651). User services 4311 (listening) untouched;
4337 was not listening when checked afterwards — not checked at session start,
and that pattern cannot match it. Use PIDs, not -f patterns.

## D12 — Fingers and toes matched by hand/foot layout (11:57–12:05)

Receiver renamed to another convention (Mixamo body, UE-style fingers
`index_01_l`, unnamed helpers): ActorCore finger animation was lost (up to 143°);
CMU toe motion lost (26.7°). New `src/extremityChains.ts` (after name pairs and
forearm roll, before limb helpers): thumb = chain leaving the hand clearly (>10°)
further from the forearm axis than the others; other fingers ordered across the
palm from the thumb side; chains pair by order and joints by segment index, only
when both hands show the same finger count. Toe chain = the foot's forward child
carrying the most bones (a toe share bone at the ball has none; reach only breaks
ties — my first reach-only rule declined CC feet as ambiguous). Bind positions
only. Explicit roles do NOT block (they say which bone a joint is; my first
version skipped them and so missed CMU's catalogue-mapped `ltoes`); excluded
(`unmapped:`) joints still do, so CMU's uncaptured fingers stay unfabricated.

Renamed receiver after: CMU 91_34 source 0.00 mm / 0.02° (fully invariant);
ActorCore source — fingers/toes matched; remaining elbow/knee share bones
(57–69° / 9–15°, ambiguous positions, declined by design), eyes 5–10° (facial
bones still name-matched), twist ≤4.5°. Existing fixtures exactly unchanged.
New test (renamed fingers/toe; the synthetic fixture needed an anatomically
angled thumb) fails on the previous code. Gates on Vite 4657 identical to D11;
suite 1,188.

## D13 — Final 1× review movies and generality matrix (12:05–12:30)

1× before/after movies (frozen 10d1d01 recorded live on Vite 4614 left, all
session changes on 4657 right; offline fixed-time renders, 30 fps):
`claude-session/review/actorcore-final-full-before-after-1x.mp4` (34 s ActorCore
Thoughtful walk on Party across the 10.4 s cut), `actorcore-final-upper-…` (0–14 s,
folded arms/chin), `cmu-final-full-…` (18.4 s 91_34), `cmu-final-feet-…` (0–8 s side
view of the feet). Contact sheets inspected: gestures (folded arms, hand to chin,
hands behind back) preserved, no new artefacts; differences are local to hands/feet.

Final matrix (`test-results/claude-generality-matrix.sh`, Vite 4657; max error of
any skin-weighted bone after transfer, vs the identity re-import):

| receiver re-authored as | CMU 91_34 | ActorCore TW | Quaternius Walk |
|---|---|---|---|
| local bone axes | 0.00 mm | 0.00 mm | 0.00 mm |
| centimetre units | 0.03° | 0.03° | 0.02° |
| A-pose swing 40° | 0.82° | 0.82° | 0.82° |
| + 10° forward / + elbow / + palm roll | 4.65° | 4.65° | 4.65° |
| finger rest curl 20°/joint | 40° (no finger data: receiver keeps own rest) | 2.44° | 2.44° |
| feet pitched 20°, toes bent | 0.85° | 0.85° | 0.85° |
| legs apart, knees bent | 1.87° | 1.87° | 1.87° |
| Mixamo body + UE-style finger names | 0.03° | 85° (elbow share bone) | 37° (elbow share bone) |

| source re-authored as (→ Party) | max error |
|---|---|
| A-pose with palm roll | 0.24° |
| finger rest curl | 2.28° |
| centimetre armature | 0.03° (was refused before D9) |
| Z-up armature | 0.02° |
| Mixamo names | 53° (elbow share bone); everything else ≤ 4.5° |

(Before this session the same receiver variants measured 21° palm roll, 40° finger
curl, 20° feet; renamed sources/receivers lost torso segments, twist, finger and
toe animation.) Raw: `claude-session/matrix/{receiver,source}.{json,log}`.

## D14 — Correction, structural tie-break, rejected residual pairing (12:12–12:35)

Correction to D13: the 53–85° "elbow share bone" errors on renamed rigs are on
bones with ZERO skin weight on both Character Creator rigs (Party, Dummy M) — not
visible. The receiver harness counted unweighted bones; it now counts only
skin-weighted ones (the source harness already did). The visible residual was
`ForearmTwist01` (59 weighted vertices on Party; 3–4.5°), declined because a leaf
share bone sits at exactly the same place.

Decision: break such ties by structure — among equally placed helpers, pair the
one whose own sub-hierarchy size matches (twist 01 carries twist 02; the share
bone is a leaf). Renamed receivers now: all arm/leg twist and share bones ≈0.1°;
remaining visible residuals eyes 10.4°/5.5° and rib twist 2.6° (name-matched
facial/torso helpers). Renamed source: max 0.75°. New test fails on the previous
code. Suite 1,189; gates on Vite 4659 identical to D11.

Rejected: generic "residual child" pairing (unpaired children of paired joints by
normalized bind offset, mutual unique nearest within 3%). It broke five existing
tests that encode deliberate policy — a disabled chest role must not be re-enabled
by topology; renamed facial/control joints are REPORTED as unsupported rather than
silently paired. Overriding that for a 5–10° eye residual is not justified.
Source archived at `.data/natural-motion-investigation/claude-session/rejected/residualPairs.ts`.

## D15 — Single-neck sources bend both receiving neck segments (12:21–12:28)

Quaternius sources have one neck bone; their heads bend up to 65° relative to it
(SwordSlash; Roll 48°, Death 39°). Character Creator receivers have two neck
segments; the upper one was unpaired and held still, so the whole bend landed at
the top of the neck (Party, SwordSlash: neck joint 0°, head joint 30.7°).
Decision: unpaired receiving neck bones are FILLED by height between the source's
neck-chain knots (branch → … → head), slerping the source rotations. Existing
pairs, including the validated two-to-one "single neck takes the upper endpoint"
rule, are untouched; disabled (listed and unassigned) and excluded roles skip.
After: SwordSlash 11.2° / 19.5°, Roll 3.2° / 5.5°, Death 4.9° / 8.4° (neck joint /
head joint). Existing fixtures exactly unchanged (all their necks already pair).
New test (single-neck source fixture) fails on the previous code. Suite 1,190;
gates on Vite 4660 identical to D11.

## D16 — Root-motion convention and genuinely new Mixamo rigs (12:28–12:31)

Source variant `rootmotion` (game-engine layout: a new root bone above the hips
carries horizontal travel; hips keep the rest): receiver result 0.00 mm / 0.02° vs
the hips-travel original. (My variant double-counts the hips' rest offset in its
own native comparison — a harness imperfection that transfer normalization
removes; the receiver comparison is the meaningful one.)

New standard rigs, not derived from any fixture: three.js example characters
`Xbot.glb` (67 bones) and `Soldier.glb` (49 bones), both Mixamo-rigged with their
own Mixamo clips (walk/run/idle…). Fetched from jsdelivr (three.js r160 examples)
into `/tmp/scene-natural-motion/claude-session/mixamo-eval/` and the private API's
`uploads/mixamo-eval-*.glb` only — evaluation fixtures, not shipped or committed;
their redistribution terms were not established. Driver `claude-new-rigs.mjs`.

- Real importer mapping: all 15 roles, no ambiguous/missing/invalid.
- 8 transfer directions (CMU, ActorCore, Quaternius → Xbot/Soldier; Xbot/Soldier
  walk → Party, Dummy M, each other): no sharing warnings, all poses finite.
- Disclosure behaves: ActorCore → Xbot reports 26 unsupported CC twist/share
  channels (Xbot has none); Soldier ↔ Xbot report 3 distal finger channels the
  other rig lacks; composed chest/neck notices appear where segment counts differ.
- 1× pair movies (native left / receiver right) `mixamo-eval/{xbot-walk-party,
  cmu-xbot,actorcore-xbot}-1x.mp4`: Xbot's own walk on Party looks consistent.
- Hand clearance on a new body: CMU 91_34 → Xbot, the resting left hand is buried
  in Xbot's very wide thigh shell without correction (only fingertips visible);
  with it the hand rests on the thigh surface (86 mm, capped → `unresolved`).
  `mixamo-eval/cmu-capture-91-34-xbot-{1,3}.png` (left = correction off).

## D17 — Animation-only (mesh-less) imports recognised (12:33–12:36)

An armature exported without a mesh (Mixamo "without skin", many motion packs)
imported with ZERO recognised roles: glTF only marks nodes as bones when a skin
references them, so the joints loaded as plain nodes; sharing was refused ("needs
a recognizable humanoid body") and the report function crashed on missing hips.
A second latent defect: with no mesh, the character bounds were empty and the
height normalization factor became 1.85/−∞ = −0 (rig collapsed to zero scale).

Decision (`src/importedAsset.ts`): for characters with no bones at all, promote
the animated joint hierarchy — every plain (non-mesh/camera/light) node at or
below the topmost animated nodes — to `T.Bone`, keeping UUIDs (tracks may bind by
UUID), names, transforms and child order; files with bones are untouched. Empty
bounds fall back to joint positions. `planFor` returns nothing without hips.

Evidence: Xbot exported without its 2 meshes → 15 roles, no warnings, 55 matched
joints; its walk drives Party within 12.3 mm of the skinned original (expected:
no skin → bind foot pitch kept, no source contact allowance). New test (plain-node
armature) fails on the previous code. Existing fixtures exactly unchanged; suite
1,191; gates on Vite 4661 identical to D11.

## D18 — Rejected: anatomical two-step arm pointing (12:38–12:40)

Tried to remove the ≈4.7° upper-arm twist leak of forward-tilted A-pose binds by
pointing arms down along a fixed anatomical path (undo flexion about the
side-to-side axis, then abduction about the forward axis) instead of one
shortest rotation. First version used shortest rotation for the "flexion" step —
which is not about the side-to-side axis when the sideways component is non-zero —
and made it worse (7.7°, existing fixtures shifted 2–4°). The explicit-axis
version exposed the real problem: for a T-pose arm (pointing sideways) the
flexion angle is undefined, and rotating about the side-to-side axis spins the
arm about its own length (85–175° errors). The single shortest rotation is regular
everywhere; with a nearly straight bind elbow there is no anatomical reference for
upper-arm twist. Reverted; the 4.7° (upper-arm twist helpers only) stays a
documented limit. Nothing committed for this attempt.

## D19 — Characters authored facing another way are turned to face +Z (12:40–12:55)

Imported-gait evaluation of genuinely new rigs found Soldier.glb (three.js
example, private evaluation copy) authored facing −Z. The app assumes the glTF
convention (+Z forward), so every route played it backwards: its own Walk/Run
were refused for distance or moonwalked with stance slide 3–9 m/s.

Decision (`src/importedAsset.ts`, characters only): after the rig is configured,
measure the body's facing from the recognised legs (else arms) — forward =
left→right-across × up — and, if it is more than 45° off +Z, turn the content
node by the nearest quarter turn and reconfigure. Small artistic yaw (≤45°) is
kept. The turn sits above the animation hierarchy, so track values, clocks,
root motion and transfer are untouched; nothing is keyed on names.
Rejected: patching the locomotion "ahead" direction per character (tried and
reverted earlier; it fixed one consumer and left facing, seating and gaze wrong).

Evidence (Vite 4665): Soldier now faces +Z (−1°); every existing fixture
measures 0° and takes the identical single-configure path. Soldier Walk on a
route 1.538 m/s, stance slide p50 0.199 m/s; Run 2.613 m/s, p50 0.26 m/s
(before: refused or 3–9 m/s); seams 0.006–0.02 mm; CMU 35_01 on Party
unchanged (p50 0.211). New parametrised test (yaw 0, π, ±π/2, 0.3) — the three
quarter-turn cases fail on the previous code; tracks verified unchanged.
Gates on Vite 4665 identical to D17: route 140 (maxJump 0.008496 mm), cuts 140
(≤3.6e-5 mm), native exact, wait 3.448e-8 / 6.005 mm, export ≤0.0035 mm, real UI
unchanged with no errors; tsc, prettier, diff-check, build OK; suite 1,196.
One full-suite run made while the browser gates ran in parallel had a single
failure that did not reproduce (re-run: 1,196/1,196, logged in
`claude-session/gates-facing/suite.log`); treated as load-induced timing.

## D20 — Unresolved hand clearance is disclosed in the motion notice (12:52–13:00)

The receiving-body hand correction is bounded (15% of arm reach); beyond that it
only reported `handClearance.unresolved` in userData, invisible to the user. The
scope requires disclosing what cannot transfer. Decision
(`src/handClearance.ts`): when a side is unresolved, append "The left hand
reaches into this character's body here; it is moved out only as far as the arm
allows." (or "Both hands …") to `motionNotice`, after the transfer's own notice,
the same per-pose pattern as the foot-contact and route-loop notices; the
viewport already lists motion notices. Pose output is unchanged.
Not done: a hint for every (small) correction — it applies on most cross-rig
frames and would be noise.

Frequency (`test-results/claude-hand-notice.mjs`, every captured take + ActorCore
Thoughtful walk/Relax on Party, Casual, Dummy M, Dummy F at 10 Hz, Vite 4666):
0 hits on 38 of 44 pairs; 1–4 of 23–184 samples on CMU 16_57/91_34 → Party,
91_34 → Dummy M/F; 53 of 340 on Thoughtful walk → Quaternius Casual, a
genuinely visible hand-in-hip on that stylized body. Tests: unresolved case
carries the notice, resolved case leaves `motionNotice` unset. Real UI gate
unchanged, no errors; tsc, prettier, build OK.

Suite note: on this machine another session's headless Chrome GPU process (PID
1323435, started Oct 29, ≈12 cores) holds load at 16–18; with default workers two
asset-heavy `motionLibrary` tests intermittently exceed the 5 s timeout (each
≈2.6 s alone on this code, on cf994dc and on 7736423 alike). The file passes
alone; the full suite passes 1,196/1,196 with `--maxWorkers=4`. Not touched (not
ours); timeouts not raised.

## D21 — Standard skeleton naming conventions recognised (13:00–13:13)

Probe: a synthetic skinned body named in each common standard convention.
Before: Unity-style names passed; Unreal lacked `spine` (`spine_01` unknown);
Blender `upper_arm.L` lacked both arms; Daz Genesis lacked hips/spine/arms/legs
(`hip`, `abdomenLower`, `lShldrBend`, `lForearmBend`, `lThighBend`); VRM/VRoid
(`J_Bip_L_UpperArm`), Rigify (`DEF-upper_arm.L`, numbered `DEF-spine.00n`
torso) and 3ds Max Biped (`Bip01 L UpperArm`) recognised NOTHING — every such
character or animation was refused as "not a recognizable humanoid body".
Also found: three.js sanitizes node names on load (`DEF-spine.001` →
`DEF-spine001`, `hand.L` → `handL`, `Bip01 Neck` → `Bip01_Neck`).

Decision (`src/boneConventions.ts`, used by `rig.ts` roles and
`detailedRetarget.ts` detail keys): strip the standard deform-layer prefixes
(`DEF-`, `J_Bip_<C|L|R>_`, `Bip01 `); resolve Rigify's numbered torso chain
(both spellings) to hips/spine/chest/upperChest/neck/upperNeck/head; parse side
and limb part in either order with separators ignored; add Daz part names
(ShldrBend/Shldr, ForearmBend, ThighBend), `hip`, `abdomenLower`/`abdomen`
(spine), `spine_01`; neck keys `neck_01`/`neckLower` → neck,
`neck_02`/`neckUpper` → upper neck. Hip above pelvis (Daz, CC): when every hips
candidate lies on one ancestor chain the topmost is taken; unrelated duplicates
stay ambiguous. Control (`MCH-`, `ORG-`, `_fk`, `_ik`) and twist/segment
(`.001`, `Twist`) names still never match.
Rejected (tried, reverted): (1) topology inference of hips/spine/head when no
name matched — contradicts the established policy that a missing named joint is
reported, not guessed (actorcoreRig tests), and on CC bodies the thighs meet at
Pelvis, not Hip; (2) dropping unweighted name candidates as "control bones" —
suppressed the ambiguity report the policy requires and dropped unweighted
fixture joints. A full Rigify export with its "hips"/"head" controls therefore
reports ambiguity and points to the rig mapping editor (tested).

Evidence: `tests/rigConventions.test.ts` (17): every role for Unreal, Rigify,
Daz, VRM, Blender, Unity, Biped, both as authored and as three.js loads them;
Daz hip-over-pelvis; twist/MCH/ORG/fk/ik names excluded; control-bone
ambiguity. 9 of 10 original-spelling cases fail on the previous code.
Real-mesh invariance (`claude-rig-variants.mjs` new `names_<convention>`
variants: Party re-authored in each convention, GLB export, app re-import,
Vite 4668): CMU 91_34 0.00 mm/0.03° on all six; Thoughtful walk 3.15 mm and
Quaternius Walk 0.00 mm with only the known eye (10.4°/5.5°) and rib-twist
(2.6°) name-only helpers deviating — identical to the existing Mixamo-renamed
variant. Before the neck keys, the four conventions without a bare `neck`
deviated 32.6°/24 mm at the neck on single-neck sources. Source side
(`claude-source-variants.mjs`, ActorCore Dummy M re-authored with tracks
renamed): all six drive Party at 3.15 mm/0.75° (known Waist layout), source
joints 0.00 mm vs identity. No collisions with any of 190 GLB files on disk
(bundled + private). Suite 1,213 (`--maxWorkers=4`), tsc, prettier, build OK.

## D22 — BVH motion capture imports; SOMA naming; detached feet without skin (13:14–13:26)

Imports accepted only GLB and FBX (FBX through Blender, which is not installed
on this machine). BVH — the common interchange format of motion-capture
libraries — was refused.

Decision: convert BVH in the browser (`src/bvhImport.ts`, three.js BVHLoader +
GLTFExporter) to the shape of an animation-only GLB export (a mesh-less
animated armature, D17) and upload that through the unchanged `/api/import`;
the import picker accepts `.bvh`, copy updated. Joint values and names are kept;
only track-unsafe characters are sanitized, unnamed end sites become
`<joint>_End`, and the per-joint position tracks BVHLoader adds are kept only
where a joint actually translates (a constant one becomes the rest position, so
a stationary capture keeps its height). The server is unchanged.

Found while checking a real file (NVIDIA SOMA 77-joint BVH, read-only from
another repo, not copied): SOMA names the thigh "LeftLeg" above "LeftShin"
(Mixamo uses "LeftLeg" for the shin) and numbers its spine from "Spine1".
Decision (`rig.ts`): with no thigh name on a side, the upper of two chained
shin names is the thigh; `spine1` is a spine alias and the topmost-on-one-chain
rule now also covers spine, so Mixamo/CMU-BVH/LAFAN/Biped (which have "Spine"
above "Spine1") keep "Spine". Unrelated duplicates still stay ambiguous.

Found in the end-to-end check: an armature without any skin lost its hands/feet
when they are detached IK-style joints (not under the forearm/shin): the
candidate filter only accepts detached extremities that carry skin weight.
Decision: with no skin in the file at all, a single named candidate is that
joint (it then follows the existing detached-joint path).

Not done: raw CMU ASF names (`root`, `lfemur`, `lhumerus`…) — `root` cannot
safely mean hips (Unreal's `root` is a ground bone above `pelvis`), so such
files need the rig mapping editor; the widely used CMU BVH conversions use
Mixamo-style names, which are recognised.

Evidence: `tests/bvhImport.test.ts` (4: recognised armature, position tracks
only on the travelling root, stationary capture keeps its height, GLB round
trip with its take name, a BVH take driving a VRM-named skeleton);
`rigConventions` SOMA and Mixamo cases (SOMA fails on the previous code);
`animationOnlyImport` detached-foot case (fails without the rule). The real SOMA
file maps every role. `test-results/claude-bvh-roundtrip.mjs` authors a real
BVH from a GLB take (world-axis rest offsets, ZXY channels), converts it with
`bvhToGlb` in the browser, uploads through the app's `api('/api/import')`, and
plays it on receivers against the original GLB take: ActorCore Dummy M
"Thoughtful walk" (≈100 joints, 34 s) — native pose 1.7e-6 (relative), every
body role 0 mm relative to the hips on Quaternius Casual and Party; hands differ
4–34 mm (a skin-less source gives no source-contact allowance to hand
clearance, by design) and the root 17–28 mm vertically (a skin-less source's
ground comes from joints, not soles). The first attempt from Quaternius Walk
differed 0.35–0.54 m at the feet: its feet are detached IK joints with their
own translation keys, which BVH (root translation only) cannot carry — a test
authoring limitation, not an importer one; real BVH is pure FK. Standing
height (the root-motion scale) of the BVH and GLB sources is identical
(1.48096 torso lengths), so strides are unaffected. The import modal itself was
not clicked through (that would add an asset to a review project); the driver
calls the same `bvhToGlb` and `api('/api/import')` the modal calls.
Gates on Vite 4670 identical to D21 (route 140, cuts 140, native exact, all 19
cross-rig deltas, wait, export, real UI); suite 1,222 (`--maxWorkers=4`), tsc,
prettier, build OK.

## D23 — VRM/VRoid characters import (13:26–13:28)

`.vrm` (VRoid Studio and most VTuber avatars) is binary glTF 2.0 with the
J_Bip names recognised since D21, but the picker and server refused the
extension. Decision: one client helper (`importableFile`, `src/importFile.ts`,
renamed from `bvhImport.ts`) prepares every import — BVH is converted (D22),
VRM goes up byte-for-byte under a `.glb` name (the server's GLB 2.0 header and
size check still applies), anything else unchanged. Picker and copy list VRM.
VRM 0.x avatars face −Z in glTF space; the D19 facing turn covers them.
Not done: VRM-specific extensions (MToon materials, spring bones, a VRM 1.0
humanoid map without J_Bip names) are ignored by GLTFLoader; such an avatar
falls back to standard materials and name recognition.
Evidence: test (renamed, bytes identical; a .glb passes through as the same
File); suite 1,223 (`--maxWorkers=4`), tsc, build OK; real UI gate on Vite 4671
unchanged with no errors on the rerun — the first run on that new origin logged
Chrome's automatic `/favicon.ico` 404 (the app has no favicon link; the probe
happens once per origin), not an app request.

## D24 — Fingers paired across different finger counts (13:28–13:35)

Finger chains of differently named rigs are paired by hand layout (D6), but only
when both hands have the same number of fingers. A four-finger hand (common on
stylized characters; Mixamo's auto-rigger also offers reduced-finger
skeletons) therefore received no finger motion at all from a five-finger
capture, although four of its fingers can represent it.

Decision (`src/extremityChains.ts`): `fingerOrder` also reports each finger's
place across the palm (0 at the thumb side, 1 at the far side). With different
counts, thumbs pair and the other fingers pair by mutual nearest place; an exact
tie pairs nothing, a finger without a counterpart keeps its rest (no motion is
invented), equal counts behave exactly as before.
Evidence: new test (five-finger CC capture → four-finger receiver under another
convention's names, ring finger removed): thumb, index, middle and little finger
follow the capture with a constant offset ≤0.33° (the four-finger palm's own
anatomical rest, D2) identical at both sampled times while the fingers move
5–23°; without the change the thumb is 7.8° off and nothing moves. Suite 1,224
(`--maxWorkers=4`).
Gates on Vite 4672 identical to D22 (route, cuts, native exact, all 19
cross-rig deltas, wait, export, real UI).

## D25 — Eyes paired across naming conventions (13:40–13:50)

The renamed-rig evidence kept one name-only gap: eyes (10.4°/5.5° on Thoughtful
walk), because CC "CC_Base_L_Eye" keyed as "ccbaseleye" and never met another
convention's eye. Every standard convention names eyes with a side and "eye".
Decision (`detailedRetarget.ts` `jointKey`): CC_Base_/J_Adj_/FACIAL_ prefixes
dropped, then side + (face)eye in either order → "lefteye"/"righteye"
(CC_Base_L_Eye, LeftEye, lEye, J_Adj_L_FaceEye, FACIAL_L_Eye, eye.L,
DEF-eye.L, Bip01 L Eye). Same-convention pairs still key identically.
Not done: rib twist helpers (2.6°) — no shared naming across conventions; D14's
generic position pairing stays rejected.
Evidence: parametrised test (five eye conventions; all fail on the previous
code); `names_<convention>` variants now carry convention eye names — eyes 0°
on all six, worst bone 2.6° (rib twist) instead of 10.38°. Suite 1,229
(`--maxWorkers=4`).
Gates on Vite 4673 identical to D24 (route, cuts, native exact, all 19
cross-rig deltas, wait, export, real UI).
