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
