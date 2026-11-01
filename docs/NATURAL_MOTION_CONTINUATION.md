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
