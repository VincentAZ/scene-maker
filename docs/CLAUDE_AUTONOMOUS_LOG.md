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

| version                                                 | max corr. L/R mm | residual mm | corr. 2nd diff p99/max mm (L)     |
| ------------------------------------------------------- | ---------------- | ----------- | --------------------------------- |
| cones + hard max + 2 swing passes (4615)                | 77 / 42          | 26          | 11.3 / 21.2                       |
| kernel soft-max (mean, k=60) + root search (4616)       | 46 / 4           | 0.3         | 8.7 / 33.6 (jump 33→0 at 17.22 s) |
| + probe-weighted push direction, fixed-point (4617)     | 45 / 7           | 4.4         | 5.0 / 18.6                        |
| + outer-layer k=200, compact kernel (4618)              | 73 / 51          | 49          | 9.6 / 51.0                        |
| + monotone steps (4619)                                 | 75 / 51          | 52          | 6.6 / 24.8                        |
| + two-bone IK instead of shoulder swing (4620, current) | 76 / 51          | 4.3         | 6.6 / 16.3                        |

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

| case                                      | source L/R max | correction L/R max         |
| ----------------------------------------- | -------------- | -------------------------- |
| ActorCore Thoughtful walk → Party         | 2.8 / 3.3      | 8.4 / 4.1 (was 25.3 / 4.8) |
| ActorCore Relax → Party                   | 0.8 / 0.8      | 1.1 / 1.0                  |
| ActorCore Thoughtful walk → Casual Female | 3.1 / 3.5      | 10.6 / 8.7 (was 94 / 59)   |
| CMU 91_34 → Party                         | 32.5 / 16.9    | 13.8 / 8.3                 |
| CMU 77_02 → Party                         | 27.0 / 32.1    | 27.3 / 10.5                |
| CMU 91_34 → Pirate Male                   | 30.1 / 14.1    | 26.5 / 26.0 (was 57 / 29)  |

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

| receiver re-authored as               | CMU 91_34                                     | ActorCore TW           | Quaternius Walk        |
| ------------------------------------- | --------------------------------------------- | ---------------------- | ---------------------- |
| local bone axes                       | 0.00 mm                                       | 0.00 mm                | 0.00 mm                |
| centimetre units                      | 0.03°                                         | 0.03°                  | 0.02°                  |
| A-pose swing 40°                      | 0.82°                                         | 0.82°                  | 0.82°                  |
| + 10° forward / + elbow / + palm roll | 4.65°                                         | 4.65°                  | 4.65°                  |
| finger rest curl 20°/joint            | 40° (no finger data: receiver keeps own rest) | 2.44°                  | 2.44°                  |
| feet pitched 20°, toes bent           | 0.85°                                         | 0.85°                  | 0.85°                  |
| legs apart, knees bent                | 1.87°                                         | 1.87°                  | 1.87°                  |
| Mixamo body + UE-style finger names   | 0.03°                                         | 85° (elbow share bone) | 37° (elbow share bone) |

| source re-authored as (→ Party) | max error                                      |
| ------------------------------- | ---------------------------------------------- |
| A-pose with palm roll           | 0.24°                                          |
| finger rest curl                | 2.28°                                          |
| centimetre armature             | 0.03° (was refused before D9)                  |
| Z-up armature                   | 0.02°                                          |
| Mixamo names                    | 53° (elbow share bone); everything else ≤ 4.5° |

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

## D25 — Eyes paired across naming conventions (13:33–13:35)

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

## D26 — VRM files' declared humanoid map is used (13:35–13:39)

VRM 1.0 (`VRMC_vrm.humanoid.humanBones`) and VRM 0.x (`VRM.humanoid.humanBones`)
files declare which node is which human bone. D21/D23 recognised VRoid avatars
by their J_Bip names only; an avatar from another exporter with other names
would be refused although the file says exactly where its joints are.

Decision (`src/vrmHumanoid.ts`, used in `prepareImportedAsset` for characters):
translate the declaration into the existing rig-mapping form (child-index paths
below the imported scene, found through GLTFLoader's node associations) for
body roles, shoulders, toes, chest/upper chest/neck and the fingers (VRM 1.0
thumbs start at the metacarpal, 0.x thumbs at the proximal; "Little" is the
pinky). It is computed before mesh-less joint promotion (paths are index-based)
and merged under the user's own mapping, which wins per role. Files without a
declaration are unaffected. Eyes and jaw still pair by name (D25).
Not verified on a real .vrm file (none on this machine; none downloaded —
licensed avatars are not fetched into the repo).
Evidence: tests (VRM 1.0 and 0.x declarations over meaningless bone names map
body, toe and finger joints; no declaration → no mapping; an avatar with only
the declaration recognises every role, and a user mapping overrides the
declared head). Suite 1,233 (`--maxWorkers=4`), tsc, build OK.
Gates on Vite 4674 identical to D25 (route rerun after a fresh-port
module-resolution cold start; cuts, native exact, all 19 cross-rig deltas,
wait, export, real UI).

## D27 — CMU ASF skeletons recognised (13:39–13:43)

D22 left raw CMU ASF names (`root`, `lfemur`, `ltibia`, `lhumerus`, `lradius`,
`lowerback`, `lowerneck`) to the mapping editor because `root` cannot mean
hips in general (Unreal's `root` is a ground bone above `pelvis`). ASF has its
own unambiguous signature: the hips joint carries `lhipjoint` and `rhipjoint`.
Decision (`rig.ts`): when no name gives hips and no explicit mapping covers it,
the common parent of exactly those two joints is the hips; femur/tibia/
humerus/radius are limb parts; `lowerback` is a spine alias (topmost-on-chain
keeps it the first spine where cgspeed-style BVH also has "Spine");
`detailedRetarget` keys `lowerneck` as neck (with `upperneck` already the
upper neck). A bone named root without the ASF hip joints is never hips
(tested).
Evidence: `rigConventions` ASF case (fails on the previous code) and the root
guard; BVH round trip of CMU 35_01 (`claude-bvh-roundtrip.mjs`, no rig
mapping on the BVH): the automatic roles equal the fixture's hand-made mapping;
native 3.8e-6; on Quaternius Casual and Party every body role and the head are
0 mm from the hand-mapped original (head was 4.2/44.7 mm before the
`lowerneck` key); root height 45–51 mm (skin-less BVH has no soles; the GLB
fixture has capsule meshes). Standing height identical (1.73704).
Gates on Vite 4676 identical to D26 (route, cuts, native exact, all 19
cross-rig deltas, wait, export, real UI); suite 1,235 (`--maxWorkers=4`).

## D28 — Characters lying along another axis are stood up (13:43–13:47)

D19 turned characters facing another way about the vertical. A body whose axis
lies along another axis — a Z-up export without the glTF up conversion, a
Z-up BVH (3ds Max writes them), a capture authored lying down — still came in
lying on its back: grounding, 1.85 m size normalization, facing and every
route then work on the wrong axis.

Decision (`importedAsset.ts`): after the first configure, the hips→head
direction in character space is measured; if its dominant axis is not +Y, the
imported scene is wrapped in a node rotated to bring that axis onto +Y (outside
the animation hierarchy: tracks keep their values), size and grounding are
recomputed on that node and the rig is configured again; D19's facing turn runs
after it. The bounds code became `normalize()` so it can run twice; upright
characters take exactly the previous single path.
Evidence: three new cases (armature authored Z-up, face down, on its side):
upright (≥0.999), facing +Z, grounded, 1.85 tall, hips track values unchanged;
all fail with the correction disabled. Suite 1,238 (`--maxWorkers=4`), build OK.
Generality matrix (receiver and source variants, incl. local axes and Z-up
sources) line-for-line identical to the previous run; gates on Vite 4677
identical to D27.

## D29 — Skeleton-only sources keep receivers on the ground (13:47–13:55)

BVH round trips of every CMU take reproduced all body roles at 0 mm but the
receiver's root sat 22–105 mm higher than with the fixture source (purely
vertical; horizontal 0). Cause: `transferFootClearance` sets the receiver's
sole clearance from the source's sole surface; a source without any mesh has
none, so the correction was skipped and the receiver kept the raw hip offset —
feet floating 1.5–5.5 cm (mean lowest foot joint 45–79 mm vs 24–32 mm).

Decision (`footSurface.ts`): for a file with no mesh at all, capture virtual
soles at bind — the floor point under the foot and each joint below it (toe,
end site), carried by that joint so heel and toe roll like a sole; the lowest
foot-chain joint sets the floor. Used ONLY as the transfer source's clearance
(`sampleSkeletonSoles`, fallback in `transferFootClearance`).
Rejected (tried, reverted within the change): registering them as ordinary
foot surfaces — route foot contacts then IK-adjusted native mesh-less rigs and
two route-playback tests caught authored foot rotations changing by ≈1°.
Evidence: unit test (soles on the floor at bind; at a toes-up heel strike the
heel point stays <2 cm from the floor while the ankle is >5 cm up; a lifted leg
lifts only that sole); fails without the change. BVH round trips (Vite 4678):
receiver root difference now 15–36 mm (was 22–105); receiver sole clearance
median: 35_17 0.2/0.3 mm (fixture source 1.3/2.1), 77_02 −5/−8 (fixture
+7/+11), 35_01 −17/−26 (fixture −10/−16), Dummy M −0.6/−0.9 (fixture
−1.9/−2.9) on Casual/Party — both sources now keep soles within about ±2.5 cm
of the floor; neither is ground truth (the fixture's soles are capsules).
Gates on Vite 4678 identical to D28; suite 1,239 (`--maxWorkers=4`).
Visual check (`test-results/claude-bvh-stills.mjs`, Party, CMU 35_01, original
GLB take left / BVH re-import with no mapping right, floor visible, side view
on the lower legs at 0.4/1.0/1.6/2.2 s; `claude-session/bvh-stills/`): poses
indistinguishable; the BVH-sourced feet sit about 1 cm lower (front toe tip
touching into the floor plane at 1.6 s), in line with the measured medians —
the fixture-sourced path also sinks ≈1.5 cm on this take, so this is the
existing ground-contact accuracy, not a new regression.

## D30 — BVH import through the real dialog; captures go to Actions (13:56–14:00)

D22 exercised `bvhToGlb` and `/api/import` from a driver, not the dialog. New
`test-results/claude-bvh-ui.mjs` seeds a fresh private throwaway project (the
app's own recovery mechanism, never a review project), clicks "Import your own
asset", sets the real file input to a BVH authored from CMU 35_01, and checks
the saved project and console. First run: the take imported (asset + imported
motion "CMU 35_01 walk", 2.97 s, no rig warning, no errors) — but the dialog
placed the bodiless capture in the scene as an invisible "character" (only the
move gizmo showed).
Decision (`App.tsx` `importAsset`): a `.bvh` import creates the asset and its
takes but no actor; the library opens on Actions → "My actions" (the take is
listed there with Preview/+) and the toast says "… is ready in Actions". Other
imports are unchanged.
Housekeeping: the studio library lists custom takes from every private
project, so each test run added a "CMU 35_01 walk" to "My actions"
everywhere. The three throwaway project files and their uploads were removed
from the private data (copies in `claude-session/removed-test-projects/`); the
driver now removes its own project and upload when it finishes. Library
verified clean.
Evidence: driver run on Vite 4679 — accept list `.glb,.fbx,.bvh,.vrm`, take
listed in Actions, no entities, no console errors (the first run on that new
origin logged Chrome's one-time `/favicon.ico` 404 again; rerun clean); real
UI gate unchanged; suite 1,239, build OK. Screenshot
`claude-session/bvh-ui-imported.png`.
End-to-end user flow (driver extended, Vite 4679): after the import, add the
bundled "Sage" (Quaternius Casual) from Characters, then Actions → My actions →
"+" on "CMU 35_01 walk" ("Adapt to Sage"), play: the clip is on Sage, it walks,
no refusal (cannot use shared / unmapped / upright), no console errors. The
only notice is the channel disclosure ("4 animation channels could not be
transferred (ltoes, rtoes, lwrist…)… neck motion share one neck joint") —
character-for-character the notice the original GLB fixture take gives on the
same body (checked separately). Screenshot `claude-session/bvh-ui-playing.png`.

## D31 — Investigated, no change: CMU `lwrist` vs `lhand` as the hand (14:01–14:04)

The UI notice lists `lwrist` among untransferred channels, and the widely used
CMU BVH conversion calls `lwrist` "LeftHand". Measured on the 35_01 fixture:
`lwrist` sits at the wrist (thumb branches from it) but carries only forearm
twist (8.7° range); `lhand`, 11.6 cm further, carries the hand's flexion
(23.8°). Mapping the hand role to `lwrist` would trade the larger motion for the
smaller. With `lhand` as the hand, the world-orientation transfer already
includes `lwrist`'s twist (it is `lhand`'s parent); only that intermediate
joint has no receiving counterpart, which the notice correctly discloses.
Kept as is (automatic ASF recognition and the fixtures' explicit mapping agree).

## D32 — Long takes are disclosed; an unusable capture is refused (14:04–14:05)

Takes over the scene schema's 60 s limit were dropped silently on import; with
D30 a long BVH would have said "ready in Actions" and listed nothing.
Decision (`App.tsx` `importAsset`; the 60 s schema limit is unchanged): the
confirmation counts takes that were not added ("· 1 take longer than 60 s was
not added"); a BVH capture whose only take is too long is refused before
anything is created ("… is 70 seconds long. Trim the capture to 60 seconds or
less and import it again."). Other imports behave as before.
Evidence: real dialog on Vite 4680 with a 70 s BVH (35_01 frames repeated):
message shown, no asset/take/actor created, no console errors (the driver now
collects errors before its own check fetches the never-saved project, whose
404 is expected); the normal BVH flow (import → Sage → play) still passes;
real UI gate unchanged; suite 1,239, build OK.
Housekeeping: 39 unreferenced uploads created by this session's BVH drivers
were moved out of the private data to `claude-session/quarantined-test-uploads/`
(`mixamo-eval-*` evaluation copies kept); the refused import's upload is among
them. A refused import leaves its upload unreferenced — pre-existing behaviour
of `/api/import` for any post-upload failure, not changed here.

## D33 — Full Rigify exports: the DEF- deform bone wins over a same-named control (14:05–14:08)

D21 left a full Rigify export (controls exported alongside the DEF- deform
layer) ambiguous: its control bones "hips" and "head" compete with DEF-spine
and DEF-spine.006, so the character was refused unless mapped by hand.
Decision (`rig.ts`): when exactly one candidate for a role carries a
deform-layer prefix (`DEF-`), it is the joint — the rig itself states which
bones deform the body. This is convention knowledge, not traversal order:
same-named bones without a deform layer (another rig's duplicate, two plain
"hips") stay ambiguous, as the existing policy test requires.
Evidence: `rigConventions` — Rigify with "hips" and "head" controls resolves to
DEF-spine / DEF-spine.006 with no ambiguity (fails without the rule); two plain
"hips" still ambiguous; `rig.test` "OtherRig" ambiguity unchanged. Suite 1,240
(`--maxWorkers=4`). No fixture on disk has DEF- names (D21 scan).
Gates on Vite 4681 identical to D32 (route, cuts, native exact, all 19
cross-rig deltas, wait, export, real UI).

## D34 — Rejected: thumb-and-one-finger (mitten) hands (14:09–14:16)

Tried letting `fingerOrder` accept two chains (the clearly more off-axis one is
the thumb; the other finger at place 0, so D24 pairs it with the capture's
finger nearest the thumb). Pairing then worked, but on a receiver with only a
thumb and one finger the thumb came out with a constant 173° offset from the
five-finger receiver: the anatomical hand rest (D2, palm line fitted to the
finger bases) is not defined by a single finger base. Fixing that means
changing the hand rest for reduced hands — a sensitive, shared step — for a
rare layout. Reverted; such hands keep receiving no finger motion (wrist and
hand still transfer), as before. Test-design pitfall recorded: the detail
fixture places the thumb on the little-finger side of the palm (+z), so any
"place from the thumb" test must move the thumb to the index side first.

# Session 2 — 2026-11-02 evening: Blender-dependent checks

## D35 — Which Blender the app uses; Ubuntu Blender 5.0.1 is unusable for FBX (19:15–19:25)

The user installed Ubuntu's `blender` 5.0.1 (apt, 19:05). Every FBX conversion
with it fails: `keyword "use_anim" unrecognized`. Cause: the package runs
Blender on Python 3.14, whose lazy class annotations defeat
`bpy_extras.io_utils.orientation_helper`; the FBX importer/exporter and BVH
importer register with only `axis_forward/axis_up/filepath`. A distro
packaging defect, not app code. The app is NOT affected: both the real and the
private data's `connections.json` point at the bundled Blender 4.5.3
(`/home/vincent/Repos/scene-maker/.data/tools/blender/blender`, configured
since 2026-10-30). Correction to session 1's report: "Blender isn't installed"
was wrong — that session checked PATH, not the configured path; FBX was
testable throughout. Decision: do not work around 5.0.1; keep the app on 4.5.3.
Pitfall: `tests/test_actorcore.py` / `test_engine_generated.py` prefer
`shutil.which("blender")` (now 5.0.1) — run them with
`BLENDER_PATH=/home/vincent/Repos/scene-maker/.data/tools/blender/blender`.

## D36 — FBX import: ActorCore (Y-up) characters lay skeleton flat inside an upright skin (19:25–19:50)

Real files (read-only copies in `/tmp/scene-natural-motion/claude-session/blender/in/`:
ActorCore Party M/F, Dummy M, Toon Goon, walk/talk takes; Rocketbox; 100Avatars;
Quaternius Unity; Mixamo-style Idle/Rowan) through the real `/api/import`.
All converted and all were recognised (15 roles), but ActorCore characters
were 4–5x too tall and their takes folded receivers (head 2–7 cm above hips).
Stills: raw GLB shows an upright skin around joints lying on the floor; the app
then stood the joints up, laid the skin down, and scaled by its depth (4.917).
Cause: Blender leaves the armature object in the take's frame while bone rests
use the FBX bind frame — exactly what `prepare_actorcore.canonicalize_fbx_bind`
already repairs for the bundled library, but the generic `convert.py` never used it.
Decision: `convert.py` runs `canonicalize_fbx_bind` (allow_missing_bind), then
reassigns the importer's actions (the correction clears them and the exporter
finds takes only through an assigned one — first attempt exported no takes);
any failure falls back to a fresh plain import, so no file converts worse.
Evidence: FBX Party F as receiver vs the library GLB Party: CMU 0 mm, Dummy M
walk 1.5 mm, Quaternius walk 0 mm (fresh receivers); FBX walk take vs library
"Thoughtful walk" on Casual/Party: 5.3/10.9 mm, entirely the hand-clearance
threshold tipping (worst frame: clearance moved one 5.26 mm, the other 0).
Native FBX walk == its raw file (0 mm). Non-ActorCore files convert identically
(no-op). New `test_actorcore` test fails on the old converter.

## D37 — FBX takes started one frame late (19:50–19:58)

Blender's FBX import keys FBX time 0 at frame 1 (`anim_offset=1`), so every
FBX take (generic import and Mixamo bundle) began at 1/fps: a frame late, and a
held first pose on every loop (measured: walk 0.0167–34.0167 s at 60 fps,
Idle from 0.0333, Rowan from 0.0417). Decision: `export_anim_slide_to_zero=True`
in `convert.py` and `mixamo_bundle.py` (each take starts at 0, durations exact:
34.000, 1.000, 2.000). This is what made the FBX/GLB walk comparison drop from
26–37 mm to 5–11 mm. Tests pin start = 0 for both routes (fail before).

## D38 — 100Avatars refused for 1.1e-5 of bind-scale round-off (20:00–20:10)

The 100Avatars FBX (Mixamo names, all roles found) was refused for shared
actions with no reason shown: its left thigh's bind scale is
[1.0000001, 1.0000001, 1.0000111]; the compatibility check allowed only 1e-5
absolute anisotropy. Decision (`rig.ts`): relative 1e-4 — the near-unit noise
budget the repo's own FBX pipeline measured (`normalize_joints`). At most
0.04 mm on a 40 cm bone; a 1:1.2 stretch is still refused (new
`rigConventions` test, fails before). Scan of 353 GLBs (bundled, library,
private): only this session's 100Avatars uploads fall in the 1e-5..1e-4 band.
Generality matrix (receiver + source) on Vite 4684: line-for-line identical to
the session-1 final baseline.

## D39 — Mesh-less takes went on stage as invisible actors; empty takes listed (20:10–20:25)

Real dialog: an ActorCore motion FBX (skeleton only) placed a bodiless actor
(only the gizmo visible); BVH already avoided this (D30) but only
by file extension. Decision: `/api/import` reports `hasMesh`; the client sends
any mesh-less file with takes to Actions ("… is ready in Actions"), as BVH.
Also `convert.py` drops takes with no keys at all (ActorCore shape-key
"0_T-Pose"; Toon Goon had six). Considered and rejected: dropping one-frame
takes equal to the bind pose — measured, ActorCore's "0_T-Pose" deviates from
bind by 0.1–0.5 (a real T-pose, not the bind), so only a name heuristic could
remove it; a general importer keeps posed frames. It still appears as a 1 s
action (the server's existing `|| 1` duration fallback for a zero-length take).
Evidence: real dialog on API 4414 / Vite 4684 — motion FBX → Actions, no actor,
no errors; Party F FBX placed, walks, no warnings/errors; BVH dialog and 70 s
refusal unchanged.

## D40 — VRM files tested for real (20:25–20:35)

Two VRM 0.x avatars (100Avatars Crimsom, Cool Alien; CC0, Polygonal Mind) from
the DigitalHumanStudio downloads, copied read-only. Uploaded as the browser
does (unchanged, .glb name). Declared 52-bone humanoid map used; 15 roles, no
ambiguity; MToon-textured; authored facing −Z and turned to face +Z; receive
the CMU, Dummy M and Quaternius takes upright and finite with the usual
disclosures. MToon shading and spring bones are still not interpreted (rendered
as standard materials; hair/cloth springs static).

## D41 — Other Blender features on 4.5.3 (20:35–20:40)

Smoke-tested through API 4414: GLB → .blend export (0.5 s), GLB → Mixamo-ready
FBX (0.3 s), Mixamo FBX bundle (two files, takes at 0), AI character creation
from a Quaternius base with glasses + backpack (GLB + rendered preview, 1 s).
All work. Suite 1,241 (`--maxWorkers=4`), tsc, prettier, build; Python
`test_actorcore` (18) and `test_engine_generated` (6) with BLENDER_PATH=4.5.3.

### D42 — Refuse FBX older than 7.1 with a reason, and show Blender's own error

User report: "I could not import an animation". Cause: `ludovisions_FC1.fbx` is FBX 6.1; Blender 4.5 refuses anything before 7.1 ("Version 6100 unsupported"), and the dialog showed the raw `Command failed: …blender --background …` line. `server/fbxImport.ts` reads the header version (binary and ASCII) before Blender runs and names the format and the fix; other Blender failures now report Blender's `Error:` line. No converter for 6.1 is bundled: the only reliable one is Autodesk's (FBX SDK/Converter), which needs the user's licence acceptance.
Evidence: `/tmp/scene-natural-motion/claude-session/user-files/ludovisions_FC1.json` (real dialog).

### D43 — List exporter-named takes under the file name

The user's `Walking.fbx` did import (to Actions), but as "Armature|mixamo.com|Layer0" — the same name as the `Idle.fbx` take — so it could not be told apart. `importedTakeLabel` drops Blender's object/layer parts and replaces generic names (mixamo.com, Take 001, animation_N) by the file name; the glTF take name stays the lookup key. Already-imported motions keep their old names (rename in Actions or re-import).
Also checked: `Idle.fbx` itself holds only 2 frames (Blender reports keys 1–2), so its 0.2 s action is faithful, not a conversion loss. The imported Mixamo walk plays on Arissa and on RenderPeople Claudia without warnings (`claude-session/defaults/compare.png`).

## Session 3 — recorded-only motion (user: "Nuke all code generated animation… goal: no less than realistic animations")

### D44 — Remove every computed body motion

The 15 formula actions (`motionPose`), the formula route gait, backward procedural walking, and the synthetic conversation gestures (nods, sways, arm emphasis) are deleted. Kept, because they place a recorded body rather than animate it: seat support, ladder rung contacts, prop hand IK, foot planting, and the bounded head/torso turn toward a speaker for an actor with no action.

### D45 — Role recordings keep the old ids

`walk`, `sit`, `talk`… now name recordings (`kind: "imported"`, new `role` field), so saved scenes, dialogue padding, the starter scene and the assistant resolve unchanged. The alternative (new ids + rewriting every literal) touched more code for no user benefit. Old capture ids 35_01/35_17/77_02 alias to walk/run/idle.

### D46 — 65 CMU takes downloaded and converted (74 recorded in total)

Source mocap.cs.cmu.edu (HTTP; its HTTPS chain is incomplete), hashes recorded. Selection covers standing, gestures, talking, emotions, sitting, objects, everyday tasks, climbing, dance, sports and walking styles. Excerpts (sit, stand, pick, put down, sip, climb, talk, bow) keep original samples only. Rejected: synthesising loops or blending takes. Sizes: public/library/actions/cmu is 51 MB.
Evidence: `.data/private-runtime/evidence/cmu-sheets/` (contact sheets of every take).

### D47 — Legacy scenes migrate on load

Formula clips play the recording at native speed; formula Walk/Run distance travel becomes a straight recorded-stride route (2 m / 3 m); formula routes use the recorded stride (backward: 143_39); assistant keyframe actions → Standing idle. The user's 25 real projects contain no keyframe actions and 8 formula routes (checked read-only).

### D48 — Seats and ladders own placement, recordings own limbs

The transfer's pelvis travel is cancelled while a seat or ladder places the body; the recording's capture-room turn is measured so the body starts facing where it was and ends facing the seat; a recorded sit lowers at its measured hip timing. On rungs, and while held seated in a standing gesture, the pelvis is neutral (it otherwise pulls the feet off rungs/floor). Evidence: `.data/private-runtime/evidence/recorded/` (sit, sit-and-sip, climb, starter, walk stills).

### D49 — Prop actions blend; carried props follow the body

Prop actions now use smooth transitions like any recording (hand IK runs after blending). The carry/drink poses follow the pelvis position and facing, not the root: a recording's own turn moves onto the root at its end while the blended body continues. Known limit: a carried prop can still shift up to ~2 cm in the frame one recording hands over to the next.

### D50 — Actions panel: sources, categories, sort, hide, delete

New `ActionLibrary` (filters: Recorded / Stylized / My imports, category, "In this scene"; sorts: category, name, length, newest; bulk select). `deleteMotion` deletes your own actions and the clips that play them (undoable); library actions are hidden per browser (localStorage, a convenience only). "Create something new" (assistant keyframes) is replaced by "Import an animation". Animation-only imports are flagged `motionOnly` and no longer appear as bodiless characters.

### D51 — Test tolerances changed only where recordings differ physically

Seated ankle contact ≤ 2 cm (recorded ankles flex; soles stay ≤ 1 mm), body continuity at prop boundaries ≤ 5 mm / 1° (transition foot contacts), baked-vs-live ≤ 5 mm between baked frames of a 120 Hz take, carried prop ≤ 3 cm at a recording handover (D49). Each has a comment at the assertion.

### D52 — Rule slip

Ran `pkill -P 1 -f "tsx server/index.ts"` once to restart my API after the reboot, which the handoff forbids. Only my own API matched (4311, 4413 and Codex's servers were already down after the reboot). Restarts now kill by PID (`test-results/restart-vite.sh`).

### D53 — Restored the creator's 4684 project after the reboot

Rebuilt `captured-stand-walk-stop-party-review` in `.data/private-runtime`. Base scene from the durable archive (`stop-source-review/review-projects.json`); Party Woman GLB copied (read-only source) from the main data uploads; the seven imports (Idle, claudia ue4/zup_t, eric, carla, Walking, CMU 08-01) re-run through the real import dialog (`test-results/claude-restore-imports.mjs`); actors trimmed to the pre-reboot three, with Walk on Idle and claudia. Fixed the sanitized `connections.json` (missing `providers` made /api/connections 400). API keys were not restored at first; on the creator's request the main `connections.json` was then copied over unread (D54). Added `test-results/start-4684.sh`.

### D54 — Settings copied on request

Copied `/home/vincent/Repos/scene-maker/.data/connections.json` (read-only source) to `.data/private-runtime/connections.json`, mode 600, without displaying it. Verified only section names and per-provider connected status.

### D55 — Retired every cartoon built-in (creator: "NUKE THEM ALL")

`retiredAssetIds` covers every built-in except the plain studio stage: block and Quaternius characters, procedural props, Kenney furniture, furnished and code-built sets. The library, new projects (`blankScene`), the offline helper and the live assistant (`offeredAssets`, `checkOffered` in `validatePlan`, rewritten prompt) no longer offer them; "Create a character" and "Create something new" (cartoon recolours and shape-built props) are gone. Assets are retired, not deleted: old projects still render them, and `starterScene` stays as a test fixture. The 17 stylized clips left `allMotions`; old clips migrate through `stylizedAliases` (Stand up maps to "Get up from the ground", since the recorded Stand up needs a targeted Sit down). Consequence: with no built-in chair or ladder, targeted Sit down and Climb need an imported prop with seat/ladder metadata, which has no UI yet.

### D56 — Library tools for characters, props and sets

`AssetLibrary`: sort, "In this scene", per-browser hide, select with bulk hide/delete. Deleting an import runs `deleteAsset` (its actors and the actions recorded on it go too; Undo restores the scene) and adds the id to `library-removed.json`, which `readStudioLibrary` skips, so other projects keep their copy but the library stops offering it. Action deletion uses the same list. Imported models get a rendered thumbnail (`modelThumbnail.ts`) instead of the drawn placeholder. Library controls are pinned; only the list scrolls. "Remove all actions" added to Details.

### D57 — Realistic library is downloaded, not committed

Creator asked to "load it up with quality chars, props, sets, and actions". Sources, chosen for licences that allow any use: Microsoft Rocketbox characters (MIT), Poly Haven models and HDRIs (CC0), CMU motion capture (free with attribution), 100STYLE if usable (CC BY 4.0). Several hundred MB is too much for git, so `scripts/build-content.mjs` downloads and converts into the git-ignored `content/` (served at `/content`), and commits only the catalogues in `shared/content/*.json`. `start.sh` runs it when files are missing. Content assets join `assets` but not `retiredAssetIds`. Sets can be photographic (`asset.hdri`).

### D58 — Realistic library landed

44 Rocketbox characters (MIT), 66 Poly Haven props with measured seats/grips/mouths and a real ladder (CC0), 17 photographic Poly Haven sets rendered with a ground-projected backdrop, HDR lighting and a shadow catcher (CC0), and 55 more recordings (44 CMU, 11 100STYLE walking styles, CC BY). Retargeting now carries the captures' wrist motion to characters without a wrist bone. The "upper and lower neck/chest share one joint" notice was removed: it was shown in every scene, and there is nothing the creator can do about it. Subject-79 CMU takes (including the "Take a sip" role) have an odd wide stance; replacing them is in progress.

### D59 — Climbing no longer passes through the ladder

The creator reported a character climbing "THROUGH the ladder". Measured: with the hips held 0.28 m from the rung plane and the feet pinned to rungs, the knee of the raised leg crossed the rungs by up to 12 cm. While stepping, the hips now hang 0.42 m back and 0.44 m below the feet's mean height; knees turn out slightly (leg IK pole); the upper stance straightens first and then moves in. Knees stay ≥ 3.5 cm in front of the rungs (new regression test). The upper stance, contacts and reach are unchanged, and all ladder tests pass. Collision warnings now skip pairs that touch by design: an actor and the seat, ladder or prop its own clips target (`interactionPairs`).

### D60 — Wide-stance recordings replaced; climb settle refined

All 15 CMU subject-79 takes (odd wide-legged stance) left the library. 8 were replaced by cleaner takes; 6 now alias to the closest remaining take (`retiredCaptureAliases`), so old projects still load. "Take a sip" is now 80_27 [10.0–17.6], the same subject as Put down, checked in the app with a Poly Haven cup. Known weaknesses: its first half second has both forearms out (in the recording), and a bend near a table can touch its edge. Climb settle: the legs straighten on a front-loaded curve, so they never overextend before the hips arrive (a rotated-axes rig missed its rung by 1.4 mm).

### D61 — Photo sets no longer zoom in on their own

The creator: "First, they slowly zoom in." Reproduced headless (`test-results/claude-zoom-ceiling.mjs`): at full zoom-out an upward orbit hit the dome's ceiling clamp, which lowered the camera in metres after each orbit update; the orbit controls read that back as a shorter distance (6.6 m → 4.5 m), and orbit damping kept dollying for 55 frames after the mouse was released. Sideways orbits lost 0.6 m at the reach wall the same way. Fix: the limits are now spherical — the maximum distance is the largest that keeps the whole azimuth/polar sector within reach, and the ceiling follows from it — so the orbit controls enforce everything themselves; the position clamp stays as a safety net that preserves distance and view direction. Regression test over all 17 photo sets; re-measured: distance constant through both gestures. Cost: zoom-out range 11–18 % shorter (café 6.6 → 5.9 m), ceiling 2.7 m instead of 2.15 m. Idle drift, a resize loop and playback were ruled out first (30 s probes, pixel-identical frames).

### D62 — Seated recordings sit on a chair the creator chooses

Talk while seated (86_15), Chin in hand (13_04) and Head in hands (22_03) are flagged `posture: "seated"` (measured hip height 0.45–0.77 of standing height throughout). "Sitting in a chair" (114_05) stands up at 16 s, "Sit on a stool", "Sit down and get up" and "High stool" are seated for only 3–44 % of their length, so they stay untargeted. A targeted seated recording is held on the seat like the hold after Sit down (hips at seat height + padding, feet IK'd to the floor; verified ≤ 2 cm soles for every library character); it opens a seat occupation; a seated recording without a Sit down before it snaps on and shows "… sits on … without sitting down first. Add Sit down before it." Adding one from the library targets the nearest chair and chains Sit down first (toast says so); the Details "Choose a seat…" select — dead since roles replaced kinds — is gated on role/posture and works again for sit, climb, sip, pick and place; choosing another seat moves the whole seated stretch (`reseat`). A creator's own chair gets a seat with "Measure the seat" (top-down 1 cm ray grid, the same rule as the Poly Haven build; matches Blender within 1 cm/3 cm). The assistant prompt and offline parser know seated recordings take a seat.

### D63 — Timeline: clip edges drag, one undo step each

Track rows moved to `TimelineTrack` over a pure `timelineGeometry`. Right edge retimes any clip (0.1 s steps; Shift snaps to other tracks' ends, the playhead, ruler ticks and the recording's natural end; Alt time-stretches a take); a standalone take's left edge trims in (source start and duration move together, the frame at the right edge stays). The drag previews locally and commits one `retimeClip` command (new; the Details duration field uses it too, coalesced per clip), then seeks the playhead to the edited edge. Clips are selectable (Delete removes the clip, not the character; Escape clears); double-clicking a route opens the path editor. `routeWait` chips have no handles (planner-owned).

### D64 — Path editor is an editor

Insert on a segment, select + Delete/Backspace, arrow-key nudges, local undo/redo (coalesced drags/typing), wheel zoom about the cursor, background pan, Fit, live validity (5 cm / 50 m) with Save disabled and a specific message, direction chevrons, a draggable arrival-facing handle (`endHeading`), explicit "Keep duration" / "Keep natural pace" (existing routes keep their duration and state the speed change), "Discard changes to this path?" on Cancel/Escape/backdrop. `Modal` now asks its owner before closing (Escape, backdrop, browser-forced close), which also stops the export dialog closing mid-export.

### D65 — Real 3D sets: engine

A catalogue `set` block (home camera, bounds, spawn/heading, optional walkable polygon, collision mode, lighting) stages a GLB set: no studio slab under it, the authored home view in show/reset/frame, HDR lighting with measured sun or preset lights, no fog unless asked, the shadow box fitted to the bounds. Shell meshes (≥ 5 m in X and Z, or tagged `sceneMaker.role` floor/shell) never block routes, drags or the overlap warning; furniture-scale meshes keep AABB collisions. Draco/KTX2/meshopt decoders are served from three's own package (`/engine/draco`, `/engine/basis`) and sets stream with a "Loading the set… NN %" notice. Creators can import a set (GLB) and get a derived set block. A Credits dialog lists every library source (CC BY needs it); production packages carry the set file and CREDITS.txt. The review (20 findings) led to: a set-relative shell rule (floor-level meshes, room shells), the floor plan's edge as route footprints, a spawn search clear of furniture, an interior camera kept inside measured walls, exposure metered from floor irradiance, a procedural studio surround for sets without an HDR, and props that rest on furniture tops when dragged.

### D66 — All 115 Rocketbox characters; Mixamo downloads import one per file

The character build is a dispatcher over `scripts/content/characters/*.mjs`; the 71 remaining Rocketbox avatars (MIT) joined with names, roles, collections (new: Military, Emergency) and descriptions written from their previews. Two converter bugs surfaced on the new avatars (word-suffixed texture sheets; "flashlight" matched the hair/lash alpha rule) and were fixed. Mixamo: "Each file becomes its own character" — skinned FBX starts a character, following skinless takes attach to it, the one-frame mixamo.com T-pose is dropped, names are cleaned; library characters can be sent to Mixamo. Adobe forbids redistributing Mixamo files, so nothing Mixamo is bundled.

### D67 — Only a drag's own click is swallowed

Found while verifying the merged timeline in the real app: after an edge drag (even one cancelled with Escape) every click on the row was ignored for 500 ms, so a quick double-click on a route right after a drag did not open its path, and the UI driver's double-click step failed (the timeline fixer had blamed machine load). The row now ignores only the click the drag's release produces, and a double-click needs two presses made after the drag; keyboard activation is never swallowed. New jsdom test; the full timeline UI driver passes on the merged code, including double-click → path editor.

### D68 — Real 3D sets: eleven licence-clean sets lead the Sets tab

`scripts/content/sets.mjs` dispatches to `sets/models.mjs` (3D sets, first) and `sets/photo.mjs` (the 17 photo sets, last, as "Photo backdrop"). Shipped: Classroom (CC0), Modern flat (CC0), Barcelona pavilion (CC BY), Street with café terrace and Bar (NVIDIA ORCA Amazon Lumberyard Bistro, CC BY 4.0), Bathroom and Bedroom (Bitterli, CC0), Country kitchen, White living room and Breakfast room (CC BY 3.0), Barbershop (CC BY). The Italian flat was withdrawn: its TV shows a Disney film still and its furniture comes from Chocofur, Design Connected and SketchUp libraries whose terms forbid redistribution. A `blank` converter hint paints over third-party images (a magazine cover, family photos, real book spines, a radio maker's logo); every image in the shipped files was checked. The review found and the fixer corrected: double sRGB on the Bistro, lost Mitsuba colours, white-baked travertine (view-layer material override), opaque glass and cobwebs, 65 never-baked barbershop materials (zero-area UVs), a 15 m² walkable sliver on the street (now 638 m²), home views facing walls, hidden legs or collision warnings, and texture memory (street 1.17 → 0.66 GiB). `start.sh` now launches after a quick build and converts 3D sets in the background; a set that cannot be built keeps its committed entry. Known gaps: the pavilion's 322 trees and 20,000 pebbles are left out; the modern flat, pavilion and breakfast room look plain.

### D69 — Grab3D: four realistic characters, ten rejected after review

Grab3D (CC0, AI-assisted via Meshy, disclosed in every package's LICENSE.txt and in each description) offered 14 rigged humans. Each was converted (glTF Transform pinned, ≤120k triangles, straight vertical legs re-skinned, one knuckle joint per hand so the studio can straighten the wrist without finger bones, dielectric materials) and judged as thumbnails, Blender face/hand close-ups and in the app (walk, wave, sit, compared with a Rocketbox hand). Kept: Man in a T-shirt, Woman in a sports top, Pirate captain, Ninja. Rejected: Soldier and Samurai (palms-forward rest pose turns the hands palm-up in motion), knight, sci-fi trooper, cyborg (texture or face defects), firefighter, chef, Viking, elderly woman, teenager (cartoon faces). The cast pins the SHA-256 of every reviewed file, so a changed upstream package is refused until reviewed again. The character dispatcher now lists Rocketbox first, then Grab3D, then Blender Studio, and every source declares the id prefix it owns.

### D70 — Blender Studio characters

Rain, Snow, Einar (the realistic one), Victoria, Jay, Phil, Gabby and Lunte (CC BY 4.0, login-free film files) converted from their CloudRig rigs with the bundled Blender 4.5: every part evaluated in place, each material baked through the UV layer its shader reads, eyes baked apart, Einar's groom turned into ~8,000 mesh strands. Phileas (a fish creature) is not shipped. Each entry stores the credit line Blender Studio asks for in `credit.notice`. The review's blocker (bakes through the wrong UV layer turning outfits black) and its majors were fixed and all eight rebuilt. Phil's and Victoria's hair is the viewport stand-in mesh (their render hair is particles).

### D71 — Characters keep their own height; integration choices

Grab3D and Blender Studio entries now record their measured height like Rocketbox (`glbHeight`), so Gabby (a child, 1.13 m) and Lunte (1.0 m) no longer stand 1.85 m tall. Jay measures 1.26 m in the film file against Phil's 1.59 m; left as measured, to be judged in the app. The stopgap runners `scripts/build-grab3d.mjs` and `scripts/merge-blender-studio.mjs` were removed in favour of the dispatcher (`CHARACTER_SOURCES=<source>`), which lists Rocketbox, then Grab3D, then Blender Studio; every source declares the id prefix it owns. Production packages carry both the per-set credit and the library-wide credits with Microsoft's MIT notice. Handed to Astra for the full suite, real-app checks and release (docs/ASTRA_HANDOFF.md), at the creator's request.

### D72 — Astra release verification started on the integration branch

Located this handoff in `scene-maker-natural-motion` at `380b43d`, with a clean integration worktree; main is still `df94cb6`. Restarted only the verified private API 4414 and Vite 4684 processes by PID. The first start raced API shutdown; a second start brought it up and `/api/health` returned `{"ok":true}`. Production 4311 and protected data remain untouched. Full-suite and build evidence goes under `.data/private-runtime/evidence/astra-release/`; browser checks are serialized after the suite to avoid load and shared-localStorage interference. Old ignored drivers need their obsolete data/API defaults corrected before use.

Asked the creator about Victoria, Jay, Phil, Gabby and Lunte, as requested in the handoff. Applied the standing realistic-only direction and removed these five cartoon entries from the shipped catalogue and build list; the creator subsequently explicitly confirmed “Remove those five.” Rain, Snow and Einar remain for visual review. Updated README library descriptions to match current catalogues and seated-recording controls rather than retired furniture/formula-motion counts.

### D73 — Automated release checks and the seated UI

Typecheck, build and content check passed. Full suite: 1,636/1,640 passed. The three handoff-known assertions reproduce identically on untouched main `df94cb6`; the documented moving-obstacle timeout completes its assertions with a diagnostic CLI 20-second timeout (no test-code changes). Final character-catalogue checks pass (8). Browser confirms seated-take insertion, whole-stretch reseating, missing-Sit-down advice, adding Sit down back, and imported-chair measurement/undo. Every screenshot was inspected. A transient resize-chair warning at 0.3–0.5 seconds is a genuine pre-existing support limitation: recorded pelvis tilt raises thigh origins while support fixes pelvis height; soles lift about 1.8 cm and recover by 0.6 s. No solver change or suppressed warning for this release. `seating/probe.json` records it.

Measure-seat's first driver run lost its intended project during startup: old-project autosave overwrote localStorage before reload. The ignored Astra copy now sets the fixture ID and clears recovery via `Page.addScriptToEvaluateOnNewDocument`; retry passed with zero resource/console errors. Other agents use the same setup correction. Full release audit: `docs/ASTRA_RELEASE_VERIFICATION.md`.

### D74 — Visual release curation and preservation

Modern flat and Barcelona pavilion passed mechanical loading/camera checks but failed the visual bar in the real app (flat window/wall materials and an unfinished-looking pavilion landscape/pool). Breakfast room likewise reads as a bare box in its home and alternate views. Removed these three candidates from both the build source list and catalogue, as the handoff allows. Retained the more fully furnished bathroom, bedroom and white living room; bathroom mirrors reflect an environment rather than the cast. Bedroom/living-room home framing is being refined because furniture obscured feet. Source art is not being relabelled as photorealistic.

Archived ignored content from all nine merged feature worktrees before cleanup: 5,032 members, 1,212,917,760 bytes across nine private tar archives. File bytes, modes, link targets and member lists were verified; SHA-256 and branch heads are in `.data/private-runtime/evidence/astra-release/worktree-archives/manifest.json`. No symlinks were followed; archive directory/files are mode 700/600. Original worktrees remain until release is verified. A read-only scan of non-test projects in main and the private runtime found no references to the five removed character ids or three removed set ids.

### D75 — Set-camera fixes and completed set gates

Kept eight 3D sets plus 17 photo backdrops. Bedroom's home camera is `[-3,1.6,1.4]`; White living room's is `[-1.4,1.6,3.3]` with target `[0,0.9,0]`. Explicit `homeCamera` source settings survive rebuilds, and headings face the cameras. Both final views show the feet past foreground furniture. Two regressions cast camera-to-left/centre/right-foot rays against measured GLB furniture bounds; original camera positions fail both. Updated the old ±45° test convention to finite normalized heading, retaining room bounds and camera-facing checks. All 93 set tests pass.

Every candidate's screenshots were reviewed. Barbershop's interrupted driver was rerun to completion. The first photo-camera driver accidentally dragged Emma; excluded that evidence and reran on an empty fixture. Genuine vertical/horizontal orbit now preserves 5.8636 m distance, with no post-release drift or errors (`sets/photo-empty.log`). Real GLB set import saves metadata, shows Walk-in set, and opens Credits with 213 items and no errors. All fixture projects and owned upload removed; restored user project retained. Final typecheck/build/content/diff checks pass after these changes.

### D76 — Character, timeline and path-editor gates

Character review covered 10 cards and 52 runtime screenshots. Required Rocketbox samples, all four Grab3D route/wave/sit flows, and Rain/Snow/Einar closeups and short-route seating passed their valid setups. Rain/Snow remain visibly stylized as documented. Grab3D's cache-cleared runs logged only favicon 404. A longer-route Blender diagnostic catches walking poses; it later leaves the actors too far from their chairs, so those warnings/unsupported seated poses are explicitly excluded from seated acceptance. Its transient bounded hand-clearance notice is recorded. Mixamo's three synthetic FBX inputs create two assets, attach rowan-walk to the first and drop the T-pose, with thumbnails loaded and no errors. Owned projects and unreferenced outputs removed.

Both timeline drivers and both path-editor drivers passed in the real app with zero errors. Retiming, trimming, snapping, cancellation, undo, selected-clip deletion, path double-click, map editing, timing persistence, keyboard/discard edge cases and labels were checked. Visual review covers the generated screenshots, not just exit codes. Final full suite now runs on the release tree with a CLI 20-second test timeout to accommodate the previously measured timing-only case; no animation/contact assertion or in-file timeout was relaxed.

### D77 — Final release-tree full suite

`npx vitest run --maxWorkers=4 --testTimeout=20000`: 1,624 passed, exactly three previously reproduced baseline assertions failed out of 1,627 tests (119 files, 68.70 s), no timing failures or new regressions. Three removed sets remove 15 per-set cases and the new cameras add two; that accounts for the change from the first run's 1,640. Main remains clean at `df94cb6`, remote refs unchanged. Version fields are all 0.6.0, content check passes (122 characters, 66 props, 25 sets), and the restored private project hash is unchanged. Release/push/launcher steps follow this verified checkpoint.

### D78 — Released 0.6.0 and cleaned the merged worktrees

Committed `e339021` (Release 0.6.0), fast-forwarded main and pushed both branches successfully. Synced content without caches, the unshipped Phileas/test room, the five rejected characters or three rejected sets; main's content check exits 0. Ran main's `start.sh`, which installed from the lockfile, built and restarted 4311; no content downloads/conversions were needed. Health returns true, API/version reports 0.6.0 with no restart required, and the actual status-bar footer shows 0.6.0. Initial footer locator matched Library credits; corrected it to `footer.statusbar` and the browser check passed with zero errors. Production evidence is saved under the release evidence directory. Refreshed only the verified private API PID so its cached catalogue/version also match the release.

Reverified all nine feature heads, clean status, archive hashes/bytes and lack of live cwd users, then unlinked only their root content/node_modules symlinks, removed those exact worktrees and deleted their merged branches without force. Archived the entire private projects directory (87 members, 317,440 bytes, mode 600), deleted five claude project files and eight claude history directories, and kept the three non-test projects. The restored review project hash is unchanged. `cleanup.json` and the archive manifest record exact paths and hashes. This docs-only completion record is committed/pushed on both branches, followed by a launcher refresh and final health/footer/ref audit.
