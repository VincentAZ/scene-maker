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

## D8 — Rig-authoring invariance; anatomical arm/hand/finger rest (11:02–11:45)

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
