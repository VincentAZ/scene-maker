# Shared animation and navigation requirements

These requirements apply to every imported provider, model and motion path,
including bundled assets. ActorCore is only one input provider; provider-specific
fixes do not satisfy the requirement.

- Collision detection must be enabled by default during animation, including
  legacy projects with no saved preference.
- Users must be able to explicitly turn it off and back on. Save this preference
  with the project and preserve it through reopening and undo/redo.
- AI-controlled movement must navigate around obstacles and automatically adjust
  or replan blocked paths, including after obstacle edits and for animated
  obstacles. Warnings or manual replanning alone do not satisfy this requirement.
- Cover every AI movement entry point: dialogue-generated movement, coordinate
  and object destinations, imported root motion, backward movement and edited
  paths. Use actual loaded geometry regardless of the asset provider.
- With collision detection enabled, an actor must not pass through an obstruction
  when no safe route exists. Preview, scrubbing, recording and export must agree.
- Preserve source timing, detailed animation and foot-contact quality while
  routing. Do not silently change playback speed to fit a revised path.
- Preserve interactions after replanning: the arriving actor can start a pickup
  at arrival, but an already-held prop or another actor's acquisition must still
  block the destination. Check ownership against the revised timeline.

## Worktree ownership and acceptance

The shared implementation remains with the animation changes in the main
`scene-maker` worktree. This dialogue worktree must integrate that same saved
setting and navigation pipeline rather than introduce a separate collision policy.
The main worktree's `docs/ANIMATION_QUALITY.md` records implementation evidence and
open gaps; this handoff does not certify that all requirements are implemented.

These requirements are integration gates for both worktrees. Every future
provider, model importer, and path importer must inherit the same default-on
setting, explicit user override, and automatic obstacle avoidance/replanning.
New import entry points must not bypass the shared collision policy; incomplete
navigation cases remain open gaps rather than provider exceptions.

Before integration, verify default-on behavior, explicit disabling and persistence,
newly blocked AI routes, moving obstacles, no-route cases and matching
preview/export behavior. Use tests and rendered evidence across imported rig and
path types. The main worktree now routes backward studio Walk/Run movement;
standalone imported root-motion travel now has shared clearance checks and
measured compatible-cycle detours, with remaining cases described below.
Captured gait fidelity, physical turning and broad provider coverage remain
required work; the procedural backward implementation does not certify them.

The main pipeline also now uses complete-triangle skin regions for collision
checks, avoiding false obstructions caused by a whole-body mesh box. Pickup and
release ease body/arm contact influence to avoid pose snaps. Carry these shared
changes through integration; the main quality log records geometry, contact and
export evidence, along with the remaining all-provider acceptance gaps.


Imported route entry and outgoing body facing must also survive integration.
The main sampler now measures captured sideways/backward entry orientation and
carries evaluated body facing into the next action; captured-arrival planning
compensates its reserved tail accordingly. Use that shared behavior for dialogue
movement, and retain the default-on collision setting, explicit opt-out and
blocked-path replanning requirements above. The main quality log records the
903-test run and real rendered/export/arrival evidence; standalone imported
AI travel and broad provider acceptance remain open.


Standalone imported AI performances now retain their original source window,
rate and schedule as shared navigation intent. Clear takes play unchanged;
compatible repeated source motion can detour while retaining a separate terminal
hold. Obstacle removal restores the original take and releases the generated
route. Dialogue integration must retain the new native intent and `routeHold`
fields and use the same preparation/sampling/export pipeline. One-off captured
performances, temporary destination obstructions requiring natural waiting,
nonlevel/closed-return travel and broad human-quality acceptance remain open.
The main log separates routing diagnostics from actual natural-motion evidence.

Carry the shared source-window trajectory context through integration as well:
trimming imported travel must retain the full captured take's measured travel
frame, explicit clock and detailed pose. Interior continuation search currently
produces candidates only; it does not yet provide accepted one-off-performance
detours. The main quality log records the rejected real loop seams and the
verified one-shot window/export behavior separately.

Selected captured windows can now repeat through a measured body/velocity blend
and continuous ground/contact constraints. Carry that common sampler through
dialogue integration. This is not yet automatic continuation insertion into a
complete one-off performance; the original prefix and ending must still be
preserved when that planner integration is implemented. The main quality log
records real rendered/export evidence and the remaining control-channel and
all-provider acceptance limitations.

Complete captured trajectories now support modest obstacle detours with bounded
spatial step adaptation. Dialogue integration must preserve the imported path's
`strideScale`, complete source interval, explicit rate and terminal hold, and use
the same source-relative facing sampler. The original outward/return movement
must not become a shortest path to its endpoint. Low loaded obstacles also use
the shared planner. The main quality log records 951 passing tests and corrected
real rendering/export evidence, including a rejected earlier body-swivel result.
Larger detours requiring inserted captured steps, physical turns, natural waits,
nonlevel travel and broad all-provider acceptance remain open. These additions
do not relax the default-on, explicit-toggle or automatic-replanning requirements.

Preserve `path.sourceProgress` on unchanged repaired trajectories: it ties each
retained waypoint to captured travel and is used by playback, facing and export.
New geometry must rebuild that correspondence rather than copy stale anchors.
The shared implementation now tries progressive clearance margins and passes
956 tests, but new real-data stance measurements reject the current detours as
natural animation: planted-foot drift and rotation near the obstructed stop
remain too large. Contact-constrained warping and physical captured steps/turns
remain required before treating these detours as animation-quality acceptance.

The shared contact solver now preserves captured planted-foot articulation while
removing rotation added by a route turn, including continuous release and loop
handling. Dialogue integration must keep its actual sampled source phase through
contact evaluation. The main quality log records 962 passing tests and greatly
reduced added stance rotation, but rejects the remaining 13–23 cm added foot drift
and retains the strict real-loop velocity diagnostic as open. These changes do
not complete contact-constrained detours or relax any collision requirement.

Complete repaired performances now share a contact-constrained body-path solve
before foot IK. Dialogue integration must carry that sampler through clearance,
playback and export, and retain the post-correction travel bound. The solve uses
source ground contacts, preserves the full source clock and detailed pose, and
keeps entry/exit movement unchanged. Real native/target clearance and export
checks pass, but a stronger same-time foot-trajectory diagnostic still finds
about 18 mm residual error and a departure speed spike on the transferred rig.
Receiver-specific contact geometry remains required work; the main quality log
links original-versus-detour review videos and records the narrower evidence.

The shared contact solver now uses bounded body lowering to support reachable
planted goals, retaining both feet's heights, orientation and limb lengths.
One-shot captured travel uses receiver articulation for contact displacement;
repeated contacts and reconstructed in-place gait still use their source contact
schedule. Do not apply raw receiver ankle excursion to virtual in-place travel:
real Quaternius Walk/Run tests found that it reintroduced sliding, and that trial
was removed. This distinction is based on motion geometry, not asset providers.

Fresh Thoughtful walk detours retain their full source clock, clear the obstacle,
and reduce maximum same-time transferred foot-path residual from about 18 mm to
0.107 mm. The main log links new comparison videos and records 981 passing tests.
These are limited measurements, not animation-quality acceptance. Independent
Quaternius repeats still fail loop continuity, transferred in-place stance drift
remains, and the strict native Thoughtful walk loop-velocity gate is still open.
Preserve the shared loop-scale correction through integration, and do not treat
warnings or safe holds as completion of natural navigation. All default-on,
explicit-toggle and automatic-replanning requirements continue to apply to every
provider, model and path importer.

Repeated-route integration now includes two-sided pose/velocity correction,
matching route speed on verified loops, and release-velocity matching for foot
contacts without an approach interval. Preserve the first entry, partial-cycle
endpoints and added export sample boundaries. The common sampler also normalizes
sampled quaternion rounding, and gait timing recognizes exact cycles despite
path-length floating-point error so pauses cannot silently change playback speed.

The strict real Thoughtful walk loop check now passes at 0.75x, 1x and 1.6x with
its existing thresholds. Quaternius transferred Walk/Run loops improve markedly,
but native-rig continuity and transferred stance sliding remain rejected. The
main log records these separately, links before/after samples, and reports 991
passing tests plus fresh full-scene/export evidence. Carry these shared changes
through dialogue integration without declaring animation quality complete or
relaxing the all-provider/model/path collision and navigation requirements.

Contact diagnostics now distinguish displacement lost to the correction-distance
allowance from physical leg reach and IK precision. Integration must preserve
that distinction: low solver error alone does not establish planted-foot quality.
The real transferred Walk reaches the distance allowance while retaining physical
reach. Playback and limits are unchanged; receiver stride/contact work remains
open. This diagnostic does not relax default-on collision, the explicit saved
toggle, or automatic obstacle avoidance/replanning for any importer.

In-place contact integration now prepares a bounded landing from the measured
stance when the original anchor exceeds its correction allowance. Keep the
shared approach/release and leg-reach constraints, first-entry clipping, and
export boundaries. The fit retains source timing, route distance, bone lengths
and existing correction limits. Infeasible cases keep their original anchor;
this fallback does not establish natural-motion acceptance.

Fresh native/transferred Walk/Run export checks and 1,002 tests pass. Added
one-cycle transferred Walk foot-path error falls from 32.601 to 1.267 mm against
the original rig's scaled trajectory, but repeated contact and native loop
failures remain open. The main quality log links the comparison video and
separates these limited improvements from the full all-provider objective.
All default-on collision, saved explicit-toggle and automatic-replanning
requirements remain unchanged.

The landing fit now uses direct disk geometry instead of an iterative cutoff.
A repeated walking stance previously treated as unverified has a valid bounded
landing; the shared solver now finds it without changing correction or reach
limits. Added repeated-Walk foot-path error falls from 17.129 to 2.111 mm, with
timing preserved and running measurements unchanged. Carry this solver through
integration. The main log records 1,008 passing tests and fresh rendered/export
evidence; residual contact errors, native loop failures and broad provider
acceptance remain open. All collision and automatic-replanning gates still apply.

Landing sampling now retains original animation key times in the selected source
window and refines curved stance constraints for feasible adjusted landings.
Preserve those keys, repeated-contact phases and the common sampler through
integration. Dense real Walk checks reduce added foot-path error to 0.440 mm for
one cycle and 0.249 mm for repeats with timing preserved; 1,010 tests and fresh
export checks pass. Running swing/stance constraints, native loop failures and
broad new-provider import verification remain open. No provider-specific policy,
correction-limit increase or arbitrary running-duration trial was adopted.

Running contact fitting now has a shared fallback that fits the stance landing
and bends the approach/release interiors within the existing correction and
physical-reach bounds. Preserve its zero endpoint position, velocity and
acceleration contribution through integration. Added Run stance error falls
from approximately 20 mm to 6.220/6.536 mm for one/repeated cycles; 1,014 tests and
fresh export checks pass. Full-motion checks still find 11.107/13.564 mm reach
loss, and acceleration measurements do not uniformly improve. The main quality
log records the accepted curve, rejected earlier trial and rendered comparison.
Running quality, native loop failures and broad import acceptance remain open.
All default-on collision, saved explicit toggle and obstacle replanning gates
continue to apply to every provider, model and path.

The first independent Cesium Man fixture loads its original animation but needs
an explicit joint mapping. With that existing mapping mechanism, shared playback
and curved routes retain timing and reverse-seek determinism. Its own motion
still yields no detected stance windows; zero correction-loss metrics must not
be treated as contact-quality evidence. The main log records rendered results,
unsupported channels and the isolated harness's upload/UI verification limits.
Do not describe this as universal automatic rig compatibility.

The shared in-place support fallback now resolves the Cesium contact-detection
gap using alternating ground proximity and backward foot travel. It retains
measured ankle/sole motion, including lateral sway, without replacing existing
contacts or changing the source clock. Added curved-versus-straight stance
trajectory residual falls from 52.161/34.148 mm to 0.089/0.089 mm on Party Woman
for one/repeated cycles in the finite contact probe. Existing eight-case Walk/Run
measurements remain exactly unchanged. New-source export checks and 1,019 tests
pass; the main log records render links, measurement scope and the successful
retry of a packaging timeout. Transferred Cesium loop diagnostics still fail,
and mapping/upload/UI and broad-provider acceptance limits remain open. Carry
this common contact inference through integration while retaining every
default-on collision, explicit saved toggle and obstacle-replanning requirement.

At the user-requested Claude handoff, the main checkout adds endpoint-velocity
extrapolation, numerical-scale ground-support stopping tolerance, and reversible
quaternion-hierarchy loop closure through scaled ancestors. The main suite passes
1,026 tests plus TypeScript/build checks. Fresh export/render checks of these
latest changes are prepared but pending; `docs/CLAUDE_HANDOFF.md` in the main
checkout is the current continuation guide. This handoff does not clear remaining
visual, broad-import, collision or navigation acceptance requirements.
