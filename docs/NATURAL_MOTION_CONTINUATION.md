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
