# Scene Maker 0.6.0 release verification

Scene Maker **0.6.0 was released on 2026-11-05** at commit `e339021`.
Verification started at integration commit `380b43d` in
`scene-maker-natural-motion`. The release gates below are complete, with the
explicitly documented baseline exceptions and visual limitations. Evidence is local under `.data/private-runtime/evidence/astra-release/`.

## Automated checks

Final release-tree suite: **1,624 passed, three known baseline assertions failed
out of 1,627 tests**, across 119 files in 68.70 seconds. Command:
`npx vitest run --maxWorkers=4 --testTimeout=20000`. No new failures or timeouts.
Removing three candidate sets removes 15 per-set tests; adding two camera
regressions explains the net 13 fewer cases than the first run. Final log:
`vitest-release-final.log`.

- `npx tsc -b`: passed.
- `npm run build`: passed; existing large-bundle and Zod annotation warnings.
- `node scripts/build-content.mjs --check`: passed.
- `npx vitest run --maxWorkers=4`: 1,636 passed, four failed (1,640 tests,
  119 files). Three assertion failures were reproduced identically on untouched
  main `df94cb6`: Stand up on its raw capture skeleton; Quaternius witch reaching
  a cup after navigation; equivalent trajectories with rotated axes/helper bones.
  These are the handoff's declared baseline exceptions, not passing checks.
- The fourth failure was the handoff's known five-second moving-obstacle timeout.
  Running that case with a command-line 20-second timeout completed its assertions
  successfully in about seven seconds. Test code and thresholds were not changed.
- After removing the five cartoon Blender characters, both character catalogue
  test files passed (8 tests). The final eight-set catalogue and camera regressions
  passed all 93 focused set tests; injecting the original camera positions makes
  both new foot-visibility regressions fail. Formatting and `git diff --check` passed.

See `typecheck.log`, `build.log`, `content-check.log`, `vitest-full.log`,
`vitest-base-known-failures.log`, and `vitest-characters-final.log`.

## Browser and visual gates

The private API 4414 and Vite 4684 were restarted from the integration checkout.
Drivers use the owned Chrome 9451, one at a time because they share origin storage.
Screenshots are reviewed as rendered evidence, not inferred from script exit codes.

- Seated recordings: browser confirmed Sit down insertion, changing the entire
  seated stretch to a second chair, advice when Sit down is removed, and restored
  playback after adding it back. Seated body/feet and closeup reviewed. A transient
  resize-chair warning during the initial Sit down was reproduced on unchanged
  base code: at 0.3–0.5 s the recorded pelvis lean briefly exceeds leg reach
  (about 1.8 cm sole lift), clearing by 0.6 s. Kept as a pre-existing contact
  limitation; no warning was hidden or solver threshold relaxed.
- Measured seat: passed. The imported-chair fixture measured a 45 cm seat,
  became Ready for sitting, supported Emma, and restored the measurement button
  on undo; no browser errors. The first driver run lost its target project to
  startup storage writes. Setting its project ID before page initialization
  fixed that harness race; the second run passed. All three screenshots reviewed.
- Timeline drag/delete: both real-app drivers passed with no browser/resource
  errors. Verified right-edge retiming, left-edge trimming, preview/landing
  agreement, one-step undo, Shift snapping, Alt speed changes, Escape cancellation,
  narrow layout, route double-click and deletion that preserves the actor.
  Screenshots in `timeline/drag/` and `timeline/delete/` reviewed.
- Path editor: both standard and awkward-input drivers returned `ok:true` and
  `errors:[]`. Verified point creation/drag/insert/delete, undo/redo, zoom/pan/Fit,
  arrival facing, timing persistence, save/reopen, discard confirmation, Escape
  during a drag, typed duration, planning undo, and non-overlapping start labels.
  All 36 editor screenshots were inspected across the two timeline and two path
  drivers, including the compact-window cases; no visual blocker was found.
- Sets: all eleven candidates mechanically checked; eight retained after visual
  review: Classroom, Street with café terrace, Bar, Bathroom, Bedroom, Country
  kitchen, White living room and Barbershop. Modern flat, Barcelona pavilion and
  Breakfast room were omitted for poor visual quality. Every generated screenshot
  was inspected; the interrupted barbershop driver was rerun to completion.
  Bedroom and White living room now open at reviewed eye-height views with both
  feet visible; source build settings preserve these camera/heading choices.
  Bathroom mirrors reflect an environment rather than the cast.
- Photo camera: the corrected empty-scene check holds 5.8636 m throughout both
  orbits and after release, with zero browser errors. Camera height changes from
  2.182 to 2.6989 m during the vertical orbit; screenshots confirm horizontal
  orbit too. Final evidence is `sets/photo-empty.log` and `sets/photo-empty/`.
  The earlier `sets/photo/` run grabbed an actor instead of orbiting and is
  explicitly excluded from acceptance.
- Set import and Credits: real GLB upload saved a derived set block and appeared
  as a Walk-in set. Credits opened with 213 library items. No resource or browser
  errors; evidence in `sets/import/`.
- Characters: 10 cards and 52 runtime screenshots reviewed. Rocketbox samples
  and all four Grab3D route/wave/sit setups passed; Grab3D logged only the existing
  favicon 404. Rain, Snow and Einar closeups show intact textures/hair/eyes and
  supported poses; their short-route sequence demonstrates seated floor contact.
  A longer-route diagnostic confirms walking poses but its paths leave the chairs
  too far away, so its later seated warnings/poses are **not** passing seat evidence.
  It also exposes a transient bounded hand-clearance notice. See
  `characters/visual-review.md` for these exact limits; Rain/Snow are stylized.
- Mixamo bulk import: two character assets saved; `rowan-walk` belongs to the
  first, the one-frame T-pose is absent, and both thumbnails load. No errors.
  Inputs are local synthetic fixtures, not a test of Adobe account/download access.

## Release and preservation

- All three version fields are 0.6.0. Final typecheck, production build, content
  check and diff check passed (`build-final.log`).
- Release commit `e339021` fast-forwarded main and was pushed to both `main` and
  `fix/natural-motion-baseline`. This verification record follows as a docs-only
  commit on both branches.
- Synced the built library to main with rsync, excluding caches and unshipped
  candidates. Main's `build-content.mjs --check` exits 0. No library conversion
  or download was needed by the launcher.
- Ran main's `start.sh`: it rebuilt and restarted the desktop service on 4311.
  `/api/health` returns `{"ok":true}`; `/api/version` and the rendered status bar
  report 0.6.0. Browser inspection had no console errors. Latest production
  evidence is `production.json` and `production-0.6.0.png`.
- Removed all nine merged feature worktrees and their local branches only after
  verifying the private archives against every file. Archived 5,032 members
  (about 1.21 GB) with hashes, original heads, modes and symlink targets preserved.
  Main, integration, dialogue and unrelated worktrees remain.
- Archived the private projects folder, then removed five throwaway `claude-*`
  project files and eight history directories. Three non-test projects remain.
  The creator's `captured-stand-walk-stop-party-review` SHA-256 is unchanged.
  Exact cleanup and backup hashes: `cleanup.json`; archives are mode 600 in a
  mode-700 directory.
- Protected Astra data and service 4337 were untouched. Production 4311 was
  restarted only through `start.sh`. Private API 4414 was refreshed by its
  verified PID after the checks; its health endpoint is also healthy.

These checks establish the scoped 0.6.0 release, not universal rig compatibility
or photorealism for every source asset. The three baseline test failures, brief
Sit down support limitation, fixed Grab3D fingers, stylized Rain/Snow, environment
mirror reflections and additional long-route diagnostic limits remain disclosed
above and in the detailed evidence.
