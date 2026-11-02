# Claude session handoff — 2026-11-02

Worktree `/home/vincent/Repos/scene-maker-natural-motion`, branch
`fix/natural-motion-baseline`. Never work in `/home/vincent/Repos/scene-maker` or
the dialogue worktree; never touch user services 4311/4337 or the protected Astra
project/data. Private data: `/tmp/scene-natural-motion/data` (API 4413).

Controlling scope (user): a general import-and-retarget system — any standard
humanoid rig imported can receive any standard humanoid animation imported. The
existing characters/takes are regression fixtures, not a whitelist. Natural motion
at normal speed; preserve representable detail; disclose what cannot transfer.
The overall natural-animation goal is still OPEN; nothing here is user-accepted.

## What this session did (commits after 10d1d01)

| commit | change |
|---|---|
| 1987b07 | Receiving-body hand clearance (replaces the rejected lateral candidate) |
| 767de0f | Anatomical arm/hand/finger rest for every rig |
| 763f58e | Torso mapped by topology; unit-independent bone-translation check |
| 9c197c4 | Limb twist/share helpers matched by place on the limb |
| 52204a9 | Sole-flat foot/toe rest |
| 5362f66 | Fingers and toes matched by hand/foot layout |
| 34e18e4 | Structural tie-break for equally placed limb helpers |
| 7736423 | Single-neck sources bend both receiving neck segments |
| cf994dc | Animation-only (mesh-less) armature imports recognised |
| 1816a0e | Characters authored facing −Z (or sideways) turned to face +Z on import |
| 756737a | Unresolved hand clearance disclosed in the motion notice |
| a69f256 | Standard skeleton naming conventions (Unreal, Rigify, Daz, VRM, Blender, Biped) recognised |
| 21b8bd0 | BVH motion-capture import; SOMA naming; detached feet on skin-less armatures |
| 5c1987d | VRM/VRoid characters import |
| c039dca | Fingers paired across different finger counts |
| 50270b6 | Eyes paired across naming conventions |
| 6648df0 | VRM declared humanoid map used |
| ef6a76a | CMU ASF skeletons recognised |
| 1024ae7 | Characters lying along another axis stood up on import |
| 96671b5 | Skeleton-only sources keep receivers on the ground |
| 16e7ad2 | BVH imports go to Actions (verified through the real dialog) |
| b030635 | Long takes disclosed; unusable captures refused |
| (next) | Full Rigify exports: DEF- deform bones win over same-named controls |

Every decision, rejected variant, harness pitfall and measurement is in
`docs/CLAUDE_AUTONOMOUS_LOG.md` (D1–D33). Summaries also appended to
`docs/NATURAL_MOTION_CONTINUATION.md`.

## How to check generality

- `test-results/claude-rig-variants.mjs` — re-author a RECEIVER (axes, units,
  A-pose parts, finger curl, foot pitch, stance, other naming conventions), export
  GLB, re-import through the app loader, transfer, compare every bone by name.
- `test-results/claude-source-variants.mjs` — same for a SOURCE with its motion
  kept (bind-only changes leave tracks; unit/Z-up/name changes convert tracks).
- `test-results/claude-generality-matrix.sh` runs both on one runtime.
- `names_<convention>` variants (unreal, rigify, daz, vrm, blender, biped) in
  both drivers rename Party / Dummy M into each standard convention
  (`VARIANTS='["names_unreal",...]'`).
- `test-results/claude-bvh-roundtrip.mjs` (`SRC=<capture id>|dummyM`, `CLIP`)
  authors a BVH from a real take, imports it through `bvhToGlb` and
  `/api/import` with no mapping, and compares body roles, root and receiver
  sole clearance with the original take on Casual and Party.
- `test-results/claude-hand-notice.mjs` counts hand-clearance notices.
- `test-results/claude-bvh-ui.mjs` (`BVH_FILE=...`) imports a BVH through the
  real dialog into a throwaway private project and removes it afterwards;
  `claude-bvh-stills.mjs` renders original vs BVH take side by side.
- Fresh Vite ports resolve `/test-results/animation-entry.ts` lazily: request
  it once (curl) before the first driver, or the first driver can fail with
  "Failed to resolve module specifier".
- Pitfalls (all hit once): re-bake skin at the shared rest before re-authoring
  (glTF bind ≠ node rest); representation-only changes must NOT re-bake; skin
  comparisons are invalid for bind-pose variants (double blend) — use bone
  transforms; unweighted control bones follow the source frame and must be
  excluded; `:` in three.js track names is reserved.

Preservation gates rerun after every change (all drivers `test-results/claude-hand-*.mjs`):
route repeats (140), source cuts (140), native preservation vs frozen 10d1d01
(Vite 4614), 70 s blocked wait/recovery history, export bake/reload, real UI,
full suite, typecheck, build.

## Also verified this session

- Genuinely new Mixamo rigs (three.js example Xbot/Soldier, private evaluation
  copies only) import with all roles and transfer in both directions (D16).
- Root motion carried on a separate root bone is invariant (D16).
- A −Z-authored character (Soldier) walks/runs its own gaits on routes after
  import facing normalization (D19); Z-up or lying bodies are stood up (D28).
- Skeletons named in the Unreal, Rigify, Daz Genesis, VRM/VRoid, Blender and
  3ds Max Biped conventions are recognised as receivers and as animation
  sources, including the sanitized names three.js gives them on load; Party
  re-authored in each transfers identically to the Mixamo-renamed variant (D21).
  `claude-rig-variants.mjs`/`claude-source-variants.mjs` have `names_<convention>`
  variants.
- BVH files import (converted in the browser to an animation-only GLB) and play
  on any recognised rig; a BVH authored from ActorCore Dummy M's 34 s take
  reproduces every body role exactly on Casual and Party (D22,
  `claude-bvh-roundtrip.mjs`). Raw CMU ASF joint names are recognised too (D27).
- VRM/VRoid `.vrm` characters import as their GLB (D23) and their declared
  humanoid joints are used whatever the bones are named (D26).

## Known remaining gaps (measured)

- Rib twist helpers (2.6°) and other facial bones besides the eyes (D25) still
  match only by name; generic position pairing was tried and rejected (D14).
- Limb helpers at identical places with identical structure would still be
  declined (no such case measured).
- Upper-arm twist from a forward-tilted A-pose bind leaks ≈4.7° into twist helpers.
- Hand clearance is limited to hands at their own side of hips/thighs/lower torso;
  crossed/chest/behind-back contacts are untouched; gross proportion mismatches
  are only partly corrected and reported (`handClearance.unresolved`).
- Skeleton-only sources (CMU capsules) keep their bind foot pitch; their finger
  channels stay excluded (not fabricated). Mesh-less sources (BVH) use virtual
  bind-floor soles for ground clearance only (D29).
- A full Rigify export that also carries its control bones ("hips", "head")
  resolves to the DEF- deform bones (D33); other same-named duplicates still
  report ambiguity (policy).
  VRM files' declared humanoid map is read (D26), but VRM materials (MToon)
  and spring bones are not; no real .vrm file was available to test.
- Hand-clearance notice is per pose (as the foot-contact notice), so it can
  appear for a fraction of a second on takes with a brief deep contact.
- Not addressed this session: natural default route starts/stops (35_01 lacks a
  measured stop), running arrivals.
- Full suite on this machine: another session's headless Chrome (PID 1323435)
  holds load at 16–18; run with `--maxWorkers=4` or two asset-heavy
  motionLibrary tests can exceed their 5 s timeout (D20).

## Runtime at handoff

Final Vite 4681 (`test-results/natural.config.ts`, HMR off), frozen 10d1d01 rig
runtime 4614, API 4413, owned Chrome 9451. Intermediate Vite ports 4609–4680 serve
older code; do not use them for evidence. Start a fresh port after edits (no HMR).
Never stop processes with `pkill -f <pattern>` — it matched its own shell once.

Evidence: `/tmp/scene-natural-motion/claude-session/` (durable copy in
`.data/natural-motion-investigation/claude-session/`, incl. `drivers/`).
