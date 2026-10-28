# Verification and completion audit

2026-10-28. The original brief remains the goal; the implemented foundation does **not** prove full product completion.

## Executed evidence

- `npm run build`: TypeScript and production Vite build pass. The build reports a large Three.js bundle and harmless third-party Zod annotation warnings; this is not a claim of optimized loading performance.
- `npm test`: 18 automated tests pass. Tests cover rig weights, valid scene references, atomic command execution, chained root movement, custom interpolation, action reorder/removal, offline commands, provider-adapter construction, AI SDK structured output, per-character conversation ordering, persistence, revision conflicts, origin/header protections, credential redaction, malformed asset cleanup, custom prop geometry, and creating/directing a new character in one atomic assistant response.
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

| Brief item                                         | Current evidence                                                                                                                            | Completion limit                                                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1. Complex scenes with Unreal, Blender, Mixxar, AI | Editable multi-object scene, Blender generation/conversion/export, Unreal Interchange script, six AI adapters, Mixamo-compatible FBX import | Unreal runtime and live AI unverified; automatic Mixamo operations missing                                                      |
| 2. Abstract app and tools                          | Shared scene/command schema independent of renderer; production adapters in `engine/`; provider facade in `server/ai.ts`                    | No claim of arbitrary engine interchange parity                                                                                 |
| 3. Nontechnical creators                           | Library, natural language assistant, plain-language details and direction panels                                                            | Usability with actual target users has not been studied                                                                         |
| 4A. Humanoids and professions                      | 14 rigged presets, male/female/mannequin bodies, original outfit variants, imported characters, Blender generator                           | Stylized procedural wardrobe; not a comprehensive professional/photorealistic asset catalog                                     |
| 4B. Props and environments                         | 12 props, six sets, asset import, multi-object placement                                                                                    | Novel props and characters can use geometric compositions; high-fidelity textured generation remains outside current capability |
| 4C. Animation paths                                | 13 built-in actions, custom keyframes and imported native animations                                                                        | Generic motion on imported rigs is not universal retargeting                                                                    |
| 5. Chain animation paths                           | UI chain/reorder/duration controls, cumulative root sampling, tests, baked GLB                                                              | Complex interactions use bounded procedural poses                                                                               |
| 6. Ask AI for a character/motion/action            | Validated command generation; Blender materializes characters; custom motion schema; targetable pick/sip                                    | No live-model run; Mixamo-assisted automatic creation/rigging is not implemented                                                |
| 7. Multiple characters                             | Starter scene contains two independent skinned rigs; library adds more                                                                      | Scene limit is 100 objects                                                                                                      |
| 8. Per-character AI and shared mission             | All six adapters, model overrides, personalities, shared mission/transcript, ordered turns tested with SDK mock model                       | Real provider credentials, model compatibility and account quotas require live validation                                       |
| 9. Everything through assistant                    | Scene mutations, asset/action creation, playback, undo/redo, production export, screenshots, project/settings navigation                    | External sign-in, arbitrary production-engine commands and a fully conversational project lifecycle remain incomplete           |
| 10. Technical details two links deep               | Browser-verified Studio settings → Connections                                                                                              | Export help names destination tools where needed                                                                                |
| 11. Great UI/UX                                    | Coherent desktop/mobile layout, screenshot, undo/redo, visible errors, save state, accessible names                                         | User testing, contrast/accessibility audit and broad device/GPU testing remain                                                  |
| Decide and log assumptions                         | `docs/DECISIONS.md`                                                                                                                         | “Mixxar” interpreted as Mixamo; not independently confirmed                                                                     |
| Create repo, commit, push                          | Private GitHub repository and local Git remote                                                                                              | Branch SHA must match the pushed local commit; this does not imply full product completion                                      |

## Outstanding external dependencies

No provider keys were supplied, so real AI completion, custom character generation from a live prompt, and multi-provider cast conversation cannot be verified here. No Unreal installation was found, so the importer is based on Epic's documented Interchange API and has not run in an editor. There is no established supported Mixamo generation/rigging API in this session; the current integration is file interchange. These limits are not represented as completed features.

Independent product work also remains for unrestricted asset generation, general skeleton retargeting, richer interaction solving, and a complete conversational project lifecycle. Passing the current tests does not close those requirements.

## Development-mode follow-up

Private data access was checked directly against the Vite server: both `/.data/connections.json` and the corresponding `/@fs/` URL return **403** without exposing contents. The private directory is excluded from file watching. Startup failure recovers the existing local draft when available and does not create and save a replacement project. Save retries remain bounded; revision conflicts still require explicit resolution.
