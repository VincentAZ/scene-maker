# Handoff to Astra: verify and ship Scene Maker 0.6.0

Astra verification and release record: [ASTRA_RELEASE_VERIFICATION.md](ASTRA_RELEASE_VERIFICATION.md). The instructions below preserve the original handoff.

From Claude, 2026-11-05. The creator asked for this handoff once only testing
and release remained. Read this file first, then the decision-log entries
D61–D71 at the end of `docs/CLAUDE_AUTONOMOUS_LOG.md`.

## Where things stand

Everything the creator asked for on 2026-11-04 is implemented, reviewed by
independent agents, fixed, and merged into the integration branch
`fix/natural-motion-baseline`. Its worktree is
`/home/vincent/Repos/scene-maker-natural-motion`, and its head is the commit
that adds this file. All nine feature branches are merged. At handoff:

- `npx tsc -b` is clean.
- The tests of every merged area pass: 177 tests in the first batch and 149
  set and character tests on the final merge.
- `node scripts/build-content.mjs --check` exits 0: every library file in
  the catalogues is on disk.
- The full suite, the production build and the release have not been run.
  That is your part.

Your job is the finish line:

1. the full test suite on a quiet machine, and the production build;
2. the real-app checks with the headless drivers;
3. a visual check of the new sets and characters, as the creator will judge
   them;
4. release 0.6.0: version bump, `main`, push, library sync, desktop launcher.

Nothing below needs new feature work. If a check fails, fix the cause on the
integration branch with a test, and add a decision-log entry (D72 onwards).

## What the creator asked for (2026-11-04)

1. Seated recordings ("Talk while seated", "Chin in hand", "Head in hands")
   floated in the air. Answer: "Sit on a chair I choose."
2. Timeline editing: drag a clip's edge to change its length, and
   double-click a path clip to edit its path. "Yes - a capable robust one."
3. "The sets are 100% terrible. First, they slowly zoom in. Second, they were
   created for VR." The creator said they would send a list of sites for
   hi-res sets; it has not arrived. Real 3D sets were built from researched,
   licence-clean sources instead.
4. "You need to add other realistic characters - not just scans. Like Mixamo
   [and] Blender superstar characters."

Standing taste: realistic only. The creator retired every cartoon or block
character, fake-looking prop and code-made animation ("NUKE THEM ALL").
Anything that looks fake is a defect, whatever the tests say.

## What was built

| Area              | What the creator sees                                                                                                                                                                                                                                                                                                                       | Log                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Photo-set camera  | Photo sets no longer creep in after an orbit. The dome limits are now orbit limits; the position clamp is only a safety net.                                                                                                                                                                                                                | D61                |
| Seated recordings | Adding a seated take targets the nearest free chair and puts Sit down in front of it. Details has a working "Choose a seat…" picker for sit, climb, sip, pick, place and seated takes. Choosing another chair moves the whole seated stretch. A creator's own chair gets "Measure the seat". Dialogue and the assistant can seat takes too. | D62                |
| Timeline          | Drag a clip's right edge to retime it, or the left edge of a recording to trim in. Shift snaps to cues, Alt time-stretches a take, and Escape cancels. Each drag is one undo step. Clips can be selected; Delete removes the clip, not the character. Double-click a route to edit its path.                                                | D63, D67           |
| Path editor       | Insert on a segment, select, Delete, arrow nudges, undo/redo, wheel zoom, pan, Fit, live validity, direction chevrons, a draggable arrival facing, "Keep duration" vs "Keep natural pace", and a discard question.                                                                                                                          | D64                |
| 3D sets (engine)  | A set GLB with a catalogue `set` block gets its own home camera, lighting, bounds, spawn and walkable floor, and no studio slab. Floors and room shells never count as collisions. Compressed GLBs load, sets stream with a progress notice, creators can import a set, and a Credits dialog lists every source.                            | D65                |
| 3D sets (content) | 11 licence-clean sets lead the Sets tab: Classroom, Modern flat, Barcelona pavilion, Street with café terrace, Bar, Bathroom, Bedroom, Country kitchen, White living room, Breakfast room and Barbershop. The 17 photo sets follow as "Photo backdrop".                                                                                     | D68                |
| Characters        | 127 in all: 115 Microsoft Rocketbox (71 new), 4 Grab3D (man, woman, pirate, ninja; 10 rejected) and 8 Blender Studio (Rain, Snow, Einar, Victoria, Jay, Phil, Gabby, Lunte). Every character stands at its measured height. Mixamo downloads import one character per file.                                                                 | D66, D69, D70, D71 |

## Branches

All merged into `fix/natural-motion-baseline`. Each worktree is under
`/home/vincent/Repos/` and can be removed after release
(`git worktree remove <path>`), together with its branch.

| Branch               | Worktree                       | Merged head                                   |
| -------------------- | ------------------------------ | --------------------------------------------- |
| feat/sets-camera     | scene-maker-wt-sets-camera     | 925d615                                       |
| feat/timeline        | scene-maker-wt-timeline        | e064172 (+ 8bb84c4 on the integration branch) |
| feat/seating         | scene-maker-wt-seating         | 52fb733                                       |
| feat/path-editor     | scene-maker-wt-path-editor     | 7e04a33                                       |
| feat/sets-engine     | scene-maker-wt-sets-engine     | 137e738                                       |
| feat/sets-pipeline   | scene-maker-wt-sets-pipeline   | 78a44ca                                       |
| feat/chars-rocketbox | scene-maker-wt-chars-rocketbox | afa0acf                                       |
| feat/chars-grab3d    | scene-maker-wt-chars-grab3d    | 890d495                                       |
| feat/chars-blender   | scene-maker-wt-chars-blender   | cd14c1a                                       |

The worktrees' `node_modules` and `content/` are symlinks into the integration
worktree, so they share one `content/` folder (1.2 GB of library files plus
`content/.cache`, all git-ignored).

## The finish line, step by step

### 0. Runtime (already set up)

- Integration worktree: `/home/vincent/Repos/scene-maker-natural-motion`.
- Test API: port 4414, data `.data/private-runtime`. It holds the creator's
  restored project `captured-stand-walk-stop-party-review`; keep it.
- Test Vite: port 4684, config `test-results/claude-api4414.config.ts`, no
  HMR.
  - Restart Vite after code changes with `sh test-results/restart-vite.sh`.
  - Restart the API by killing the PID listening on 4414 (`ss -ltnp`), then
    `sh test-results/start-4684.sh`, which starts whatever is not running.
  - Both run code from before the final merges, so restart both first.
- Headless Chrome: port 9451, profile `.data/private-runtime/chrome-profile`.
  - `test-results/fable-ui.mjs` drives it, and every driver opens and closes
    its own tab.
  - A tab left open keeps rendering WebGL in software and slows the whole
    machine. List tabs at `http://127.0.0.1:9451/json/list`, and close
    strays at `/json/close/<id>`.
- On a fresh Vite, request
  `http://127.0.0.1:4684/test-results/animation-entry.ts` once with curl
  before the first driver.

### 1. Typecheck, build and the full suite

```sh
cd /home/vincent/Repos/scene-maker-natural-motion
npx tsc -b
npm run build
npx vitest run --maxWorkers=4
```

Known failures on the base, not caused by this work:

- `tests/capturedLibrary.test.ts` "loads and previews Stand up…"
- `tests/navigation.test.ts` "plans from the preceding action endpoint…"
- `tests/rig.test.ts` "produces equivalent joint trajectories with rotated
  bone axes and helper bones"

Load-dependent timeouts, which every agent reproduced on the untouched base
under load:

- `tests/automaticRoutes.test.ts`: "predicts moving obstacles…", "rechecks
  the final combined schedule…", "chooses a clear stopping place…" and
  "keeps cooperative planning deterministic…"
- `tests/capturedLibrary.test.ts`: "packages referenced capture files…"

Run the suite when nothing else is busy (check `uptime`). Any other failure is
real.

### 2. Real-app checks

Every driver below is in `test-results/` of the integration worktree, which is
git-ignored.

- Run each with `FABLE_APP=http://127.0.0.1:4684`. Where a driver asks for an
  API, pass `FABLE_API=http://127.0.0.1:4414` or `API=http://127.0.0.1:4414`.
- Send screenshots to `.data/private-runtime/evidence/<area>/` with `OUT=`.
- Read every screenshot. A passing script with a wrong-looking picture is a
  failure.

| Area               | Driver and inputs                                                                                                                                                                                                 | Pass looks like                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photo-set camera   | `claude-zoom-ceiling.mjs` with `PID=claude-zoom-probe SET="Corner café"`                                                                                                                                          | distance unchanged through both drags and after release                                                                                                  |
| Seated takes       | `claude-seated-recording.mjs`, `claude-seated-sitdown-check.mjs`, `claude-measure-seat.mjs`, each with `SCENE_MAKER_DATA=.data/private-runtime`                                                                   | Emma on the armchair with feet on the floor; the picker moves her to the second chair; the advice appears without Sit down; the measured chair is sat on |
| Timeline           | `claude-timeline-drag.mjs`, `claude-timeline-delete.mjs`, each with `FABLE_API`                                                                                                                                   | every check listed, including "double-click opened …" and "no page exceptions or console errors". Both passed on the merged timeline code on 2026-11-05  |
| Path editor        | `claude-path-editor.mjs`, `claude-path-editor-awkward.mjs`                                                                                                                                                        | `{"ok":true,"errors":[]}`                                                                                                                                |
| 3D sets            | `agent-set-check.mjs` with `SET=<id>` for each of the 11 `set-*` ids; `claude-set3d-import.mjs` with `API`, `PID=claude-set3d-import` and `GLB=` any set GLB                                                      | the cast stands on the floor in the home view with no collision warning; the room reads; the import gives a "Walk-in set" card and Credits opens         |
| Rocketbox          | `agent-characters-look.mjs` with `IDS=rocketbox-military-male-01,rocketbox-fire-female-01,rocketbox-female-child-02`                                                                                              | textures, hair and eyes present; the child is child-sized; feet on the floor                                                                             |
| Grab3D             | `agent-grab3d-look.mjs` with `IDS=grab3d-man-base-character,grab3d-woman-base-character,grab3d-pirate,grab3d-ninja`                                                                                               | walk, wave and sit look natural; hands acceptable without finger bones                                                                                   |
| Blender Studio     | `agent-blender-look.mjs` with `MODE=closeup` and `MODE=sequence`, `IDS=blender-rain,blender-snow,blender-einar` and then the rest                                                                                 | textures, hair and eyes; no black bakes; no joint twisting                                                                                               |
| Mixamo bulk import | `agent-mixamo-bulk.mjs` with `FILES=<d>/rowan-tpose.fbx,<d>/rowan-walk.fbx,<d>/rowan.fbx MODE=each`, where `<d>` is `.data/private-runtime/fixtures/mixamo-style` (locally generated test files, not Adobe files) | "2 characters are ready"; the walk lands on the first character; the one-frame T-pose take is dropped                                                    |

### 3. Visual check of the new library

Open the Sets and Characters tabs and judge them as the creator will.

- Sets: each must open at eye height inside the room (not in a wall), with a
  character on open floor.
  - Earlier builds failed exactly here. The fixer corrected wall-facing
    cameras, washed-out colours, grey rooms, opaque glass and third-party art.
  - The modern flat, the Barcelona pavilion and the breakfast room still look
    plain on their cards. Decide whether they are good enough to ship, or
    drop them from `scripts/content/sets/models.mjs` and the catalogue.
- Characters: the order is Rocketbox, then Grab3D, then Blender Studio (`LEAD`
  in `scripts/content/characters.mjs`).
  - Rain, Snow and Einar are what the creator asked for.
  - Victoria, Jay, Phil, Gabby and Lunte are clearly cartoon-styled (Sprite
    Fright, Settlers). Ask the creator whether to keep them; they can also be
    hidden per browser in the library.
  - Jay measures 1.26 m in his film file against Phil's 1.59 m. If he looks
    like a child next to Phil, give him an explicit height in
    `scripts/content/characters/blender-studio.mjs` and the catalogue.

### 4. Release

1. Set `version` to `0.6.0` in `package.json` and in both `version` fields of
   `package-lock.json`. Commit "Release 0.6.0" on the integration branch.
2. Fast-forward `main`. The main checkout `/home/vincent/Repos/scene-maker` is
   on `main` and runs the desktop launcher:
   `git -C /home/vincent/Repos/scene-maker merge --ff-only fix/natural-motion-baseline`.
   If `main` has moved, merge `main` into the integration branch first,
   re-test, then fast-forward.
3. Push both branches: `git push origin main fix/natural-motion-baseline`.
4. Sync the built library into the main checkout. `content/` is git-ignored,
   and without it `start.sh` would rebuild the library on launch, downloading
   gigabytes and converting with Blender:
   ```sh
   rsync -a --exclude .cache --exclude sets/standin-room.glb \
     --exclude 'characters/blender-phileas.*' \
     /home/vincent/Repos/scene-maker-natural-motion/content/ \
     /home/vincent/Repos/scene-maker/content/
   node /home/vincent/Repos/scene-maker/scripts/build-content.mjs --check   # must exit 0
   ```
   The three excluded files are the only ones no catalogue references: a test
   room and the unshipped Phileas.
5. Run the launcher once: `/home/vincent/Repos/scene-maker/start.sh`.
   - It rebuilds when the commit has changed, restarts the 4311 service on the
     new build and opens the app window.
   - Its new background 3D-set build should find nothing to do once the
     library is synced.
   - Check that `http://127.0.0.1:4311/api/health` answers `{"ok":true}` and
     the footer reads 0.6.0.
6. Tell the creator what changed, in plain language. Include the cartoon
   Blender characters question.

### 5. Clean-up after release

- Remove the agent worktrees and their branches.
- Throwaway projects in `.data/private-runtime/projects` named `claude-*` or
  `agent-*` can go. Keep `captured-stand-walk-stop-party-review`.

## Known issues (follow-ups, not blockers)

**Seating, timeline and path editor**

- "Measure the seat" assumes the chair faces +Z. A model facing elsewhere
  needs a facing offset in the seat metadata.
- The timeline rescales on release, not while a drag runs past the end of the
  sequence.
- Path-editor point shortcuts still fire while a toolbar button has focus.
  Some older drivers click "Use natural pace", which is now "Keep natural
  pace".

**3D sets**

- Large static sets redraw every mesh each frame: no merging, and every mesh
  casts a shadow.
- Thin merged walls block routes by their bounding box.
- The Barcelona pavilion leaves out its 322 trees and 20,000 pebbles.
- The Italian flat was withdrawn for third-party art and furniture.

**Characters**

- Grab3D characters have no finger or face bones. A knuckle joint per hand
  straightens the wrist; the fingers keep their rest curl.
- Phil's and Victoria's hair is the film's viewport stand-in mesh.
- Einar is 25.8 MB, with about 430 MB of decoded textures.
- Jay, Phil and Gabby cannot reach the floor from a deep armchair, and Gabby's
  head can dip into the floor during a bow.

**Credits**

- Production packages carry `assets/library/CREDITS.txt`,
  `assets/sets/CREDITS.txt` and Microsoft's `LICENSE.txt`, and the Credits
  dialog lists every source.
- The Blender export does not carry credits yet.
- The exact Blender Studio credit line (`credit.notice`) is stored but not
  shown.

## Rules that still apply

- Never stop a process with `pkill -f`, `killall` or any pattern. Kill by PID.
- Never touch the creator's 4311 service, except through `start.sh` at
  release.
- Never touch 4337, or the protected Astra data:
  `/tmp/scene-animation-review/astra-data` and the `astra-long-wait` project.
- `connections.json` holds API keys. Never print or log it.
- Commit only on the integration branch and `main`. Push only at release.
- Log every autonomous decision in `docs/CLAUDE_AUTONOMOUS_LOG.md`.
- The bundled Blender 4.5.3 LTS is at
  `/home/vincent/Repos/scene-maker/.data/tools/blender/blender` (set
  `BLENDER_PATH`). `/usr/bin/blender` is 5.0.1, and the library was not built
  with it.
