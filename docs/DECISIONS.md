# Decisions for review

2026-10-28 — Initial implementation from the supplied creator-studio brief.

- Product name: Scene Maker. A warm, cinematic workspace with a slate shell, ivory canvas, and lime accent. Creator language is used throughout the workspace.
- This repository is a local-first application. The browser editor and a local Node service run together. Engine jobs run on the creator's machine; there is no public deployment or cloud account requirement.
- “Mixxar” is interpreted as Adobe Mixamo, pending correction. No undocumented Mixamo generation API is invented. User-owned FBX/GLB characters and animations can be imported, with Blender handling FBX conversion. The built-in library is original procedural content and does not redistribute Adobe's raw character library.
- The initial character art direction is stylized, fully weighted skeletal meshes, with masculine/feminine/mannequin variations and profession outfits. Photorealistic characters can be imported. “Fully skinned” means skeletal skin weights, not a promise of photographic realism.
- Technical settings require Studio settings → Connections. Each character's personality and creative direction are directly available; model and engine identifiers stay in Connections.
- Six model providers are supported with user-supplied credentials and explicit model IDs: OpenAI, Anthropic, Google, xAI, Moonshot (Kimi), and OpenRouter. No default model IDs are frozen into the app. Credentials remain in the local server's private data directory.
- Without credentials, a clearly labeled offline command helper handles a bounded set of scene operations. It never claims to be a live AI model. Live assistant instructions become validated scene commands; arbitrary generated code is never executed.
- Blender is a local command-line adapter. Unreal receives a portable animated GLB plus an editor import script. A live Unreal editor is required to verify its import on the creator's installation.
- Project persistence is on disk, with revision checks and atomic writes. Undo/redo is per open editing session. Exported project JSON carries the portable scene definition; ZIP packages also carry original imported assets and animated GLB.
- Create the GitHub repository as private by default, preserving the user's ability to choose a public release later.

## Implementation follow-through

- AI-generated character specifications are materialized by a trusted Blender Python adapter, with skinned GLB output. The adapter has a bounded procedural vocabulary; it does not pretend to produce arbitrary photorealistic geometry.
- Imported native animations remain associated with their originating asset. Generic procedural motion and arbitrary skeleton retargeting are distinct capabilities; the latter is not claimed complete.
- A Blender 4.5.3 LTS binary from download.blender.org was downloaded into ignored `.data/tools/blender` and connected for verification on this machine. It is not part of the source distribution; other machines install/configure Blender separately.
- Production packages are retained locally under `.data/exports` as well as offered for download, making generated outputs inspectable and recoverable.
- Provider calls were tested with deterministic AI SDK models because no API credentials were supplied. No credentials were copied from unrelated projects or browser accounts.
- The repository was created as private at `VincentAZ/scene-maker` using the signed-in GitHub UI. Existing SSH authentication is used for the push.

- Generated assets can carry up to 256 validated geometric parts (sphere, box, cylinder, cone, torus), with transforms, colors, and character bone bindings. Blender materializes custom characters; the preview builds custom props from the same declarative schema. This supports new shapes without executing generated code.

## Assistant workflow follow-through

- Assistant requests return ordered, schema-validated studio steps. Scene edits, new/copy/open/save, object selection, camera framing, playback, cast conversation, library search, exports, history, and tool navigation share a single executor. Credentials remain outside chat in Connections.
- A workflow stops on its first failed operation and reports the steps that completed. Its success response appears only after execution. Completed edits remain available for undo; exports and conversation requests are not silently retried.
- Project switches wait for a serialized save queue to drain, including edits made during an in-flight save. Opening a saved project verifies the revision used for planning. Reopening the current project retains its current content; revisiting an earlier project in the same workflow uses the revision saved by that workflow.
- The live planner receives up to 20 recent chat messages, project summaries, and up to three explicitly named saved project definitions. Snapshot caching binds validation to the same project data the planner saw. Undo/redo must be isolated from further plan steps because their resulting state belongs to the browser's session history.
- Exports wait for the requested scene and its imported assets to render, then bake animation against an isolated copy of the skeletons, geometry, and materials. Editing or switching scenes cannot mutate an export in progress.
- File imports remain an explicit local file-selection flow. The offline helper offers named project operations and a documented fixed command vocabulary; open-ended planning still requires a provider.

## Cast conversation follow-through

- A round means one turn per visible character. Continuing after a stopped or interrupted run starts with the character after the last completed speaker, preserving conversational order. Provider connections and available dialogue capacity are checked before paid calls; retries remain disabled to avoid repeating completed turns.
- The local conversation endpoint streams completed, validated turns as newline-delimited JSON. The browser applies each turn immediately and waits for its save before consuming the next streamed turn. Closing the request or pressing Stop aborts the active provider request and prevents later turns. The plain JSON endpoint behavior remains available, with partial scene data on an interrupted run.
- Conversation turns are placed sequentially after existing scene actions. Breathe clips fill the waiting time on the speaker's track. A text-length estimate sets the speaking action duration; creators can adjust it in Details. This is staged motion and caption timing, not generated voice or lip synchronization.
- Dialogue references its action by clip ID, so captions and subtitle timings follow action reorder/duration changes. Removing an action or character preserves its dialogue as untimed history. Existing projects with untimed dialogue still load unchanged.
- Transcript preview jumps to the selected line and plays its action. Timed SRT is available from the cast dialog, from the assistant, and inside production packages. Editing or switching scenes while models are working stops the conversation and retains delivered turns and the creator's newer edits.
- HTTP lifecycle and cancellation are verified with SDK mock models. The browser caption fixture is explicitly labeled authored dialogue and does not imply a paid/live model run. Completed delivered turns are saved through the normal revision-checked project queue; this does not promise recovery of an unfinished provider call after a process or network crash.

## Prop interaction follow-through

- Pick up, Take a sip, and Put down derive prop ownership from the entire timeline. No previous-frame state is required, so reverse scrubbing and export produce the same pose. Pick up holds across later actions; a standalone sip acquires and returns the prop within its own clip. Put down returns to the prop's authored starting transform.
- Arm contact uses analytic two-segment reach solving in world coordinates. Known hand/foot bones supply endpoints on imported rigs; compatible rigs without those bones use rest-length proportions. Low reaches add a crouch and preserve computed foot contact points. This is bounded choreography, not collision or general physical simulation.
- Reach is checked at both acquisition and release. A distant prop stays home. If the actor walks away before Put down, the held prop stays in hand and the preview explains how to correct the staging. Failed release prevents a later actor or second prop from taking over the occupied hand. The assistant receives that feedback and the current playhead.
- One right-hand prop per character is supported. Overlapping scheduled ownership is rejected during scene validation. A cast dialogue response that requests a sip while another character owns the only cup uses a talking gesture instead.
- Imported body animation and procedural poses use the same sampler for contact checks, preview, and baking. Carrying constrains the right arm without erasing the native motion on the rest of the body. This does not establish arbitrary skeleton retargeting.
- Custom prop definitions may include local `grip` and `mouth` points. The built-in cup supplies known defaults. Full hand/finger articulation, collision avoidance, automatic approach navigation, and arbitrary placement surfaces remain work to do.

## Imported humanoid follow-through

- Recognized humanoids get an anatomical pose adapter. It records the original bind transforms, establishes arms-down neutral orientations, and applies studio rotations in character space through the actual bone hierarchy. Original skin inverse matrices remain unchanged. Native clips use the original bind pose rather than this calibrated pose.
- Mapping accepts the studio names, common humanoid aliases, and namespaced Mixamo-style joints. Required ancestry is checked, and helper bones between recognized joints are preserved. Nonuniform or mirrored scale along the bone hierarchy is unsupported. Unrecognized characters keep native playback and receive a plain-language hint when studio actions are requested.
- Native translation is sampled from the original clip's start and end and accumulated across the sequence. Horizontal travel follows the hips; vertical travel follows the lowest mapped foot contact when available, avoiding a false height change from crouching alone. Original animation offsets are aligned to the character's scene position. Facing-direction carry-over and transition blending remain separate, unfinished work.
- Every character load owns its GLTF scene, so its original node identifiers are retained for native tracks targeting unnamed nodes. Export baking records animated ancestor/object transforms, bone transforms, scale, and morph weights. A bone-only bake was insufficient for FBX animation on the armature object.
- The verification fixture is generated locally with Blender and is not a downloaded or licensed Adobe asset. Chrome file upload was unavailable because the extension's file-URL permission is disabled, so this test used the same local import API, registered its result in an isolated project, and verified browser action editing, assistant direction, saving, and export from that project. No browser permission was changed.
- Native clips remain associated with their original asset. Automatic native-animation transfer across different skeletons and unconstrained rig matching are not claimed complete.
