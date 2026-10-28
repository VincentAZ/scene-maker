# Verification and completion audit

2026-10-28. The original brief remains the goal; the implemented foundation does **not** prove full product completion.

## Executed evidence

- `npm run build`: TypeScript and production Vite build pass. The build reports a large Three.js bundle and harmless third-party Zod annotation warnings; this is not a claim of optimized loading performance.
- `npm test`: 43 automated tests pass. Tests cover rig weights, valid scene references, atomic command execution, chained root movement, custom interpolation, action reorder/removal, offline commands, provider-adapter construction, AI SDK structured output, per-character conversation ordering, persistence, revision conflicts, origin/header protections, credential redaction, malformed asset cleanup, custom prop geometry, creating/directing a new character in one atomic assistant response, ordered project workflows, failed-switch preservation, stale planning revisions, partial execution receipts, follow-up chat context, concurrent save draining, isolated export rigs, sequential dialogue scheduling, caption/SRT timing, streamed turn delivery, active provider cancellation, partial failures, continuation order, and truncated-stream preservation.
- `npm audit`: zero known vulnerabilities at verification time.
- `python3 -m py_compile engine/*.py tests/verify_blender.py`: Python scripts compile.
- Chrome: the desktop workspace renders, the assistant adds `walk → wave` to Mila, Undo restores the original clips, playback advances, and captured browser logs contain no errors/warnings at that checkpoint.
- Chrome responsive viewport at 390 × 844: the editor fits horizontally; the assistant moves below the workspace. Default viewport restored afterward.
- Chrome: Studio settings → Connections exposes the six providers and per-character assignments. Check connection returns **Blender is ready**.
- Chrome production export: package creation completes and the generated ZIP is saved locally. Package contains `scene.json`, `scene.glb`, Blender and Unreal import scripts, and README instructions.
- Export parsing: starter GLB contains **75 meshes, 2 skins, and 54 animation channels**.
- Blender 4.5.3 LTS opens the browser-exported GLB and saves `.blend`. `tests/verify_blender.py` reports **2 rigs, 22 bones, 1 animation action, and end frame 288** and verifies bone pose values change between frames 0 and 24.
- Blender creates an original female builder from the declarative character generator and exports a weighted GLB. A second run verifies that custom geometric parts replace the preset body and export as a skinned GLB.
- A real character FBX exported by Blender was sent through `/api/import`. The service converted it to GLB and returned its native animation name and duration (12.04 seconds).
- GitHub connector confirms `VincentAZ/scene-maker` exists with **private** visibility and push permission. Commit/push evidence is the repository history and remote branch.

The screenshot in [studio-preview.jpg](studio-preview.jpg) is from the live browser editor. Test and export artifacts are in ignored `.data/qa`; the Blender binary is in ignored `.data/tools/blender`.

## Requirement-by-requirement audit

| Brief item                                         | Current evidence                                                                                                                                                                     | Completion limit                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Complex scenes with Unreal, Blender, Mixxar, AI | Editable multi-object scene, Blender generation/conversion/export, Unreal Interchange script, six AI adapters, Mixamo-compatible FBX import                                          | Unreal runtime and live AI unverified; automatic Mixamo operations missing                                                                  |
| 2. Abstract app and tools                          | Shared scene/command schema independent of renderer; production adapters in `engine/`; provider facade in `server/ai.ts`                                                             | No claim of arbitrary engine interchange parity                                                                                             |
| 3. Nontechnical creators                           | Library, natural language assistant, plain-language details and direction panels                                                                                                     | Usability with actual target users has not been studied                                                                                     |
| 4A. Humanoids and professions                      | 14 rigged presets, male/female/mannequin bodies, original outfit variants, imported characters, Blender generator                                                                    | Stylized procedural wardrobe; not a comprehensive professional/photorealistic asset catalog                                                 |
| 4B. Props and environments                         | 12 props, six sets, asset import, multi-object placement                                                                                                                             | Novel props and characters can use geometric compositions; high-fidelity textured generation remains outside current capability             |
| 4C. Animation paths                                | 13 built-in actions, custom keyframes and imported native animations                                                                                                                 | Generic motion on imported rigs is not universal retargeting                                                                                |
| 5. Chain animation paths                           | UI chain/reorder/duration controls, cumulative root sampling, tests, baked GLB                                                                                                       | Complex interactions use bounded procedural poses                                                                                           |
| 6. Ask AI for a character/motion/action            | Validated command generation; Blender materializes characters; custom motion schema; targetable pick/sip                                                                             | No live-model run; Mixamo-assisted automatic creation/rigging is not implemented                                                            |
| 7. Multiple characters                             | Starter scene contains two independent skinned rigs; library adds more                                                                                                               | Scene limit is 100 objects                                                                                                                  |
| 8. Per-character AI and shared mission             | All six adapters, model overrides, personalities, shared mission/transcript, progressive saved turns, cancellation/continuation, timed captions and actions, SDK/HTTP contract tests | Real provider credentials, model compatibility and account quotas require live validation                                                   |
| 9. Everything through assistant                    | Scene edits, asset/action creation, new/copy/open/save projects, ordered workflows, camera/playback, direct cast conversation, exports and tool navigation                           | External sign-in and arbitrary production-engine commands remain outside implemented control; live planning still needs provider validation |
| 10. Technical details two links deep               | Browser-verified Studio settings → Connections                                                                                                                                       | Export help names destination tools where needed                                                                                            |
| 11. Great UI/UX                                    | Coherent desktop/mobile layout, screenshot, undo/redo, visible errors, save state, accessible names                                                                                  | User testing, contrast/accessibility audit and broad device/GPU testing remain                                                              |
| Decide and log assumptions                         | `docs/DECISIONS.md`                                                                                                                                                                  | “Mixxar” interpreted as Mixamo; not independently confirmed                                                                                 |
| Create repo, commit, push                          | Private GitHub repository and local Git remote                                                                                                                                       | Branch SHA must match the pushed local commit; this does not imply full product completion                                                  |

## Outstanding external dependencies

No provider keys were supplied, so real AI completion, custom character generation from a live prompt, and multi-provider cast conversation cannot be verified here. No Unreal installation was found, so the importer is based on Epic's documented Interchange API and has not run in an editor. There is no established supported Mixamo generation/rigging API in this session; the current integration is file interchange. These limits are not represented as completed features.

Independent product work also remains for unrestricted asset generation, general skeleton retargeting, and richer interaction solving. Passing the current tests does not close those requirements.

## Development-mode follow-up

Private data access was checked directly against the Vite server: both `/.data/connections.json` and the corresponding `/@fs/` URL return **403** without exposing contents. The private directory is excluded from file watching. Startup failure recovers the existing local draft when available and does not create and save a replacement project. Save retries remain bounded; revision conflicts still require explicit resolution.

## Assistant workflow follow-up

The verified story is: creator prompt → assistant plan API → ordered browser execution → confirmed local save/export → visible completion receipt.

| Boundary                 | Evidence                                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI → assistant API       | Chrome prompts created `Assistant workflow check`, added Mila, and chained walk then wave using the labeled offline helper.                                                                                                          |
| Plan → project storage   | Copy/open requests completed; API reads found separate original and copy projects, each retaining Mila's walk/wave sequence. Opening the active project also succeeded.                                                              |
| Export → production file | “Export scene” produced a ZIP containing the intended one-character project and a GLB with one skin and 24 animation channels.                                                                                                       |
| GLB → Blender            | Blender 4.5.3 opened that actual browser export, found one rig with 11 bones, verified two meters of root movement over the walk, and saved `workflow.blend`.                                                                        |
| Response → UI            | Completion receipts appear after successful steps. Duplicate project names open a choice dialog. Camera reset completed from chat. Chrome reported no warnings/errors at the export checkpoint.                                      |
| Failure paths            | Automated tests prove failed saves prevent project switches, changed saved revisions prevent opening stale plans, failed exports retain completed edits and stop later steps, and edits during saving are flushed before completion. |

[Assistant workflow screenshot](assistant-workflow.jpg) shows the editor after restoring the café project. Browser-created example projects and the export verification artifacts remain in ignored `.data/`. The provider planner and conversation tests use deterministic SDK responses; no live provider call is claimed.

## Cast conversation follow-up

- `npm test`: 43 tests pass; `npm run build` passes with the previously noted bundle/third-party annotation warnings.
- The production conversation route was exercised over a real local HTTP connection with controlled SDK models. The first turn reaches the client while the second provider is still pending. Closing the client request aborts the active model call and prevents subsequent calls. A later provider failure retains the first delivered turn; an interrupted conversation continues with the next character.
- The stream parser rejects premature completion, missing turn counts, and truncated streams. UTF-8 text split across byte chunks survives unchanged. Merge tests prove that returned project revisions are preserved and newer creator edits cannot be overwritten by a late turn.
- Staging tests place the first turn after existing scene actions and subsequent turns after the prior speaker. Dialogue follows its linked action when reordered. Removed actions preserve the words as untimed history. Old project transcripts remain valid.
- Chrome: opened the explicitly authored fixture `A reason to stay — authored dialogue`, inspected both transcript entries, and previewed Mila's line at 7.0 seconds. Captions appeared in the scene during playback and remained visible when paused. Captured logs at this checkpoint contained no warnings/errors.
- Chrome: starting a conversation without configured provider keys shows the connection message and preserves the two existing transcript entries.
- Chrome production export includes two SRT entries: **7.000–17.200 seconds** and **17.200–24.600 seconds**, matching their linked action clips. The exported GLB contains three skins and 78 animation channels (the browser scene contained an additional character by export time).
- [Caption preview](dialogue-preview.jpg) shows authored test dialogue. `.data/qa/create_dialogue_fixture.ts` documents its provenance in ignored local test artifacts. No live-model dialogue, generated voice audio, or lip synchronization is claimed.

Live provider credentials/model compatibility, automatic Mixamo operations, Unreal editor verification, high-fidelity generation, and general retargeting remain unproven or incomplete as listed above.
