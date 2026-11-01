# Animation acceptance — practical user test

Status: **natural walking is not accepted**. The user's recording
`/home/vincent/Videos/Astra-long-wait-2026-11-01-203903.mp4` reports robotic
drawn-path movement. Passing timing, collision and export tests does not
override that result.

The saved `Astra long wait` scene (revision 10) has Party Woman following a
smooth four-point path using the bundled Quaternius `Walk`, displayed as
`Easy walk`, at playback rate 1. The clip lasts 14.114 seconds. This is not an
ActorCore walking take merely because the character is an ActorCore model.
That identifies the active source; it does not establish that the source is
responsible for the unnatural result. The recording ends before the clip ends,
so it does not establish arrival quality.

## First pass — about ten minutes

Use a duplicate scene. Keep speed at 1×. Frame the whole body and feet at
roughly eye level, with visible floor markings. Start with one character and
an empty floor. Keep collision detection on. Do not alter duration to make
the animation look smoother.

Stop at the first failed test. Save a short recording and note its timestamp;
there is no need to work through the rest while basic walking fails.

| Test | What to do | What a pass looks like |
| --- | --- | --- |
| Original take | Play a walking animation on its original rig at native speed. For the reported case, the developer must supply the bundled Walk reference alongside Party Woman. Also test one known natural imported walk. | Comfortable cadence, believable weight transfer, relaxed upper-body motion. This is the visual reference, not an automatic pass for later stages. |
| Same take on your avatar | Play that exact take on Party Woman without adding a path. Keep the same speed. | Its character and timing survive transfer. No new rigid shoulders, stretched strides, locked knees, trembling feet or lost hand motion. |
| Straight drawn path | Select the avatar → **Draw a path**. Choose the same take under **Locomotion**. Draw a straight route of roughly 5 metres. Wait for gait measurement and confirm **Source playback: 1×**. | Feet support the body rather than skating underneath it. Travel agrees with stride. No marching, excessive bounce, body gliding or foot snaps. |
| Curved drawn path | Edit that route into a broad S-curve using the same take and speed. Watch once from the side and once from the front. | The character turns through the walk without abrupt whole-body pivots, skating around bends or visibly changing cadence. |

If the original take passes and transfer fails, investigate retargeting. If
transfer passes and the straight path fails, investigate route adaptation. If
straight travel passes and curves fail, investigate turn handling. If the
baseline itself is unsuitable for natural walking, compare a suitable captured
walk before choosing the default; do not compensate by hiding source motion
with more smoothing.

## After basic walking passes

| Test | What to do | What a pass looks like |
| --- | --- | --- |
| Starts and arrivals | Test a fresh start, a destination, and a route followed by a standing action. | No teleport, abrupt pose change or mid-stride freeze when a standing arrival is requested. The explicit **Hold the final pose** option is a separate behavior, not a natural-arrival pass. |
| AI obstacle avoidance | Ask the character to walk to a table. Move a second object onto the future route during playback. Then block all safe passages and reopen one. | Detour or stop safely; wait; resume when clear. No rewind, body jump, wall clipping or foot sliding at the joins. |
| Collision setting | Confirm collisions are on in a new scene. Turn them off, save/reload, then turn them on again. | Default on; the explicit choice persists; re-enabling restores collision checks. |
| Replay and export | Scrub backward, replay, save/reload, then record/export the same route. | Same pose and motion at the same time, including turns and waits. A faithful export of robotic movement still fails visual acceptance. |
| Different imports | Repeat the original/transfer/straight/curve tests with a substantially different rig and walking take from another provider. Include a rig requiring explicit mapping. | Correct mapping or an actionable warning. No silently discarded animation channels and no provider-specific exception masking a failure. |

For a failed case, keep the project, avatar name, exact Locomotion selection,
speed, timestamp and one sentence describing what looks wrong. The developer
owns reproduction, source/receiver comparisons and the broader provider matrix;
the user should not have to diagnose bone mappings or numerical solver errors.

## Current release gate

The user's recorded walk must be reproduced and compared against its original
source and a suitable captured-walk reference. Natural-motion acceptance is
open until the visible problem is corrected and reviewed at normal speed.
The existing 1,067 passing tests remain regression evidence, not proof that
this release gate has passed.
