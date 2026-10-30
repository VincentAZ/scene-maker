# AI asset pilot — decision log and handoff

Session: 2026-10-29, 19:00–20:45 America/Phoenix (maximum 1h45m).
Requested deliverable: two AI characters, one AI prop, one scene, using Scene Maker, Blender and presumed Mixamo (user wrote “mixxar”).

## Actual status — incomplete

The generation/rigging pipeline is implemented as reviewable code. **No actual AI character, prop or scene has been generated or delivered.** Synthetic test fixtures are not finished assets. The complex phase is NOT complete; do not treat this as a “Switch to Opus” handoff.

No code was committed, pushed or deployed. The active studio/project was not changed.

## Decisions made on the user's behalf

| Decision | Reason | Review / limitations |
|---|---|---|
| Interpret “mixxar” as Adobe Mixamo | Existing studio rig recognition supports Mixamo; fits the requested rigging workflow | Confirm the intended product when returning |
| Implement Meshy text-to-3D as first provider | Public job-based API offers preview, texturing and GLB download | No live paid generation was made; payload and current vendor terms need live verification. No credentials were created or purchases made |
| Keep Adobe login/upload/marker placement manual | No supported public Mixamo API was identified; do not invent one or bypass authentication | Guided browser round trip, FBX download and return import; NOT fully autonomous rigging |
| Watch Downloads only after user explicitly opens Mixamo | Avoid presenting all historic downloads; allow manual file selection instead | Local desktop assumption; not a multi-user/cloud workflow. Watches new FBX files, cannot prove they came from Adobe |
| Require character With Skin file first | Ensures a master rig/mesh exists before animation merging | Multiple downloads merge through Blender NLA tracks; tested on synthetic fixtures, not real Adobe downloads |
| Use meters, character default 1.75m, prop longest side default 1m | Existing scene scale is meter-based | Users can change sizes; forward-axis inference is heuristic, not semantic understanding |
| Limit cleaned assets to 30k character / 15k prop faces and 2k textures | Browser performance budget | Decimation cannot fix anatomy, finger fusion or bad clothing topology. Face quality requires visual review |
| Reuse uploads and custom-asset placement | Fits existing library and command flow | Generation jobs are memory-only, no resume after restart; provenance JSON is written but full export attribution integration remains to do |
| Defer scene implementation rather than call a single generated object a scene | Walkable room layout, floor/seat metadata and imported environment support need design and tests | No generated scene support was added; scene deliverable remains open |
| Preserve user's original downloads and adjacent texture directories | Cleanup must not delete user-owned files | Review temp FBX extraction and isolate it to a job directory in follow-up |
| Leave everything uncommitted and undeployed | No explicit commit/push/deploy instruction | User can review the task diff first |

## Implemented

- `server/generation.ts`: preview/refine job orchestration, polling, cancellation, Blender cleanup, provenance sidecar.
- `/api/generate` and job routes; Meshy secret stored via Connections, returned only as a configured boolean.
- `engine/prepare_generated.py`: cleanup, decimation, normals, grounding, sizing, texture downscaling, GLB/FBX export.
- `engine/mixamo_export.py`: flatten GLB mesh for manual Mixamo auto-rigging.
- `engine/mixamo_bundle.py`: merge a skinned FBX plus animation FBXs into an animated GLB.
- `server/mixamo.ts` and routes: preparation, opt-in Downloads polling, manual multi-file upload/import.
- `src/GenerateAsset.tsx`: generation and guided Mixamo panel; App placement handlers and Connections settings.

## Verification (actually executed)

- `npm run check`: passed.
- `npm test`: 35 files, 285 tests passed.
- `npm run build`: passed; chunk-size and third-party annotation warnings remain.
- `python3 -m unittest discover -s tests -p test_engine_generated.py`: four tests passed against Blender 4.5.3.
- Generation API tests mock Meshy and Blender; they validate orchestration, NOT live generation.
- Blender integration tests use synthetic meshes/rigs, validate size/grounding, face budgets, embedded/downscaled textures and distinct animation clips.
- An ESLint attempt found no configured ESLint setup; it is not an established passing check.

## Remaining complex work / dependencies

1. Verify actual Meshy access, credits, current API behavior and output redistribution terms. No supplied Meshy key was demonstrated during this session. No paid call was made.
2. Generate the actual two character meshes; inspect face/hands/clothing, correct topology and pose as needed.
3. Complete the Adobe-authenticated manual rigging step, then validate real Mixamo downloads, scale, retargeting, feet, seats and grips.
4. Design and implement the scene delivery: composed generated set pieces vs imported environment; add room/floor/collision/seat/lighting data.
5. Produce a real viewport screenshot/video showing all requested deliverables together. Do not substitute fixtures or mockups.
6. Reliability/security follow-up: bounded download sizes/timeouts, remote cancellation, memory/job cleanup, isolated FBX extraction, UI request lifecycle, durable job recovery and live error paths.

## Stop reason

Original time budget expires at 20:45. Remaining complex work is not complete. This is a timed checkpoint, not a successful final delivery or an instruction to switch models.

---

## Extension and final checkpoint (supersedes initial timeout status above)

The user extended the deadline to **23:00** (four hours from original start). Feature work stopped at **21:06** on a verified external access blocker, not on the time limit.

### Immutable blocker verified

A newly opened dedicated browser tab at `https://www.mixamo.com/#/` displayed **Log in / Sign up**. No authenticated Adobe session was available. Actual Mixamo auto-rigging requires this user-controlled login. No account was created and no authentication was bypassed. Evidence:

- [Mixamo access screenshot](evidence/mixamo-access-check.png)
- [Captured page URL/title/text](evidence/mixamo-access-check.json)

**The complex phase remains incomplete. Do not switch to Opus yet.**

### Additional implementation during extension

- Local CUDA SDXL → Hunyuan3D adapter added (`engine/local_generate.py`); pinned revisions, offline by default, explicit failure if cached weights are absent; no synthetic geometry fallback.
- Local provider selection and licence acknowledgement in generation UI. Local results are labelled untextured/unrigged; thumbnails are rendered geometry rather than misleading reference photos.
- Imported environments: persistent `environmentAssetId`, backward-compatible validation, authored origin/scale preserved, async stale-load disposal, scene readiness and export-content integration. Twelve regression tests added. Binary environment export and Unreal export were not verified.
- Mixamo FBX processing now uses isolated copies, preserving original downloads and adjacent texture directories. No authenticated real-Mixamo bundle was processed.
- Added job concurrency limits and remote polling deadline; bounded model downloads. Live remote cancellation and full reliability hardening remain open.

### Actual generated assets — honest inventory

| Requested item | Actual result | Remaining work |
|---|---|---|
| Character 1 | Real Hunyuan3D-generated male archivist mesh, from actual AI image reference | Untextured, unrigged; anatomy/quality requires review; NOT production-ready |
| Character 2 | Not delivered | Local model downloads were still incomplete; SDXL female generation did not finish |
| Prop | Real Hunyuan3D-generated banker’s lamp mesh | Untextured, requires material finishing and studio integration |
| Scene | AI-authored Blender archival office; actual textured GLB, editable `.blend`, rendered preview | Not a diffusion-generated environment. Not yet assembled with all requested actors/prop inside Scene Maker |

The male and lamp used the public `tencent/Hunyuan3D-2` demo through its exposed Gradio interface. The public generation quota was exhausted after these results; **no quota bypass was attempted**. The alternative local runtime was being installed in isolation. Those downloads/generation processes were terminated at the blocker; their resumable cache remains under `.data/ai-pilot`.

The authored office is 7×6m, 100,732 triangles, four embedded authored image textures and 19 meshes/materials. It passed Blender re-import. Its furniture is authored geometry; textures are mathematical authored textures, not diffusion output. Camera/lighting remain in `.blend`, so the in-app appearance needs separate review.

### Evidence and review files

- [Generation panel screenshot](evidence/generation-panel.png)
- [Mixamo round-trip panel screenshot](evidence/mixamo-panel.png)
- [Office render](evidence/archival-office-preview.png)
- [Actual male mesh clay render](evidence/archivist-male-clay-inspection.png)
- [Actual lamp mesh clay render](evidence/bankers-lamp-clay-inspection.png)
- `artifacts/`: preserved actual GLBs, editable office `.blend`, AI reference images and provenance JSON.
- `licenses/`: retrieved model licence notices. Hunyuan3D has territorial and other restrictions; **these assets are review-only, not cleared for an unrestricted bundled library**. Generated output is not assumed CC0 or automatically owned outright.
- `manifest.json`: file sizes and SHA-256 hashes.

Screenshots were captured in a dedicated local preview on port 4319, using a separate data directory. No existing user project was changed. Pixel-level aesthetic review was not performed; renders are provided for the user to judge, not presented as approved quality.

### Final checks executed after last application-code edits

- `npm run check`: passed.
- `npm test`: **297 tests, 36 files**, passed.
- `npm run build`: passed; third-party annotation and bundle-size warnings remain.
- `python3 -m unittest discover -s tests -p test_engine_generated.py`: **4 passed** against real Blender.
- `.data/ai-pilot/venv/bin/python -m unittest discover -s tests -p test_local_generate.py`: **8 passed**.

The local runner's full diffusion path has **not** completed. The Meshy API path is mocked in tests, not live-tested. Local-provider Node orchestration has type coverage but still needs targeted integration tests. Browser evidence verifies panel rendering, not a successful end-to-end generation or rigging run.

### Resume prerequisites

1. Sign in to Adobe/Mixamo in the browser (or explicitly approve replacing Mixamo with a Blender/service rigging alternative).
2. Resume pinned local model downloads or provide an approved paid generator connection; finish the second character.
3. Finish materials, inspect anatomy, rig both characters, and validate real animations/deformation.
4. Assemble the requested cast, lamp and office in Scene Maker and capture an actual combined viewport/video.
5. Review the generated asset licensing/quality before any production bundling.

No commit, push or deployment performed. Files are left for review (some are staged, others unstaged). Background pilot generators and isolated preview are stopped; the active studio remains untouched.


## Deployment authorization (subsequent user request)

The user explicitly requested: “commit, push and deploy all code”. This supersedes the earlier uncommitted/undeployed checkpoint; it does not mark the incomplete asset pilot finished.

Deployment scope includes the workflow code, tests, decision log, evidence and review-only artifacts. Assets remain under documentation, not the unrestricted built-in library. Isolated `.data/ai-pilot` runtime, dependencies and model caches are not checked in or installed by deployment; local generation requires separate runtime setup on the studio host. Meshy needs a configured API key, and real Mixamo rigging still needs Adobe sign-in.

Pre-deployment review fixed animation lookup keys: FBX inputs now retain their original stems in separate temporary directories, and returned animation names exactly match the GLB clips. A regression test covers numeric prefixes and checks that user-owned FBX/texture files survive import. Licence copies have whitespace-only normalization; legal wording is unchanged and manifest hashes are refreshed.

Final pre-commit verification for the authorized deployment: `npm run check`, `npm test` (**298 tests / 36 files**), `npm run build`, four Blender integration tests, eight local-runner tests and `git diff --check HEAD` all passed. The artifact manifest hashes were rechecked. Build warnings remain unchanged. Runtime model caches and credentials are excluded from Git.
