# Scene Maker

A local-first 3D studio for creators: build a cast, set the scene, chain actions, and direct the story through an assistant.

## Run

Requires Node.js 22.12+ and npm. A GPU-capable browser is recommended.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. For a production build:

```sh
npm run build
npm start
```

Then open **http://127.0.0.1:4311**. The server intentionally binds to loopback. This is a single-user local studio, not a publicly hosted multi-user service.

## Create a scene

1. Choose characters, props, and a set from the library. The starter café is already populated.
2. Select an object to edit its placement, color, size, and character personality. The move tool also provides a 3D translation gizmo.
3. Select a character and add actions. Reorder actions, change their duration, and assign props in Details. Space plays/pauses; the timeline scrubs; Ctrl/Cmd+Z undoes.
4. Describe changes to the assistant. Without a provider, the **offline command helper** supports a small, explicit command vocabulary, such as “Add a coffee cup”, “Mila walk then jump”, and “Set moonlight”. It is not a simulated AI service.
5. Use **Direct the cast** to give multiple characters a mission or topic. With connected providers, visible characters take turns responding to the conversation. Each completed turn appears and saves immediately, with its action scheduled after the previous turn. Stop at any time; continuing starts with the next speaker. Preview a line from the transcript to see its caption and action, or save dialogue as text and timed subtitles as SRT. Voice audio is not generated.
6. Export an editable project, an animated production package, a Blender file, or a still image. Open a package again from the project browser to restore the scene and imported assets.

The assistant can also manage your workspace. Try “Create a new scene called Moonwalk”, “Copy this project as Second take”, “Open Moonwalk”, “Save”, “Export scene”, “Export subtitles”, or “Reset camera” with the offline helper. With a connected model, one request can create a project, add and direct its cast, save, and export in order. The assistant receives recent chat context for follow-up requests. “Let them talk” runs the cast with its assigned models; file imports open the appropriate file-selection flow.

For a prop interaction, position the character within reach and ask “Leo pick up the cup then sip then put down”. Pick up reaches before lifting and keeps the prop in hand across later actions. Take a sip brings its rim to the mouth; Put down returns it to its original spot. A standalone sip returns the cup automatically. Unreachable props stay in place with a staging hint; if the character has walked too far to put a held prop back, it stays in hand until the staging is corrected. Each character uses one prop in the right hand. Try “Jump to 3.5 seconds” to inspect a pose. The assistant receives the playhead and current staging hint.

Projects save automatically on the local service with revision checks. A recovery copy is stored in this browser; conflicting remote revisions are never silently overwritten. Undo history lasts for the current session. Switching projects waits for all pending edits to save. Failed operations stop an assistant workflow and identify any steps that already completed.

## Connect AI and production tools

Technical controls are **two steps deep: Studio settings → Connections**.

- **AI:** enter your own API key and a model identifier available to that account. Select the studio assistant provider. Assign each character a different provider/model or inherit the studio default. Supports OpenAI, Anthropic, Google, xAI, Kimi (international Moonshot endpoint), and OpenRouter. Choose models that support structured JSON output. API usage is billed by your provider; a conversation makes one request per visible character per round.
- **Blender:** install Blender 4.5 LTS or compatible and enter the executable path, or use `BLENDER_PATH`. The adapter creates original weighted character meshes from validated AI specifications, converts FBX imports, and saves animated `.blend` scenes. Model-generated Python is never executed.
- **Mixamo:** download your own rigged character with its animation as FBX and import it. Blender converts it; native animation clips up to 60 seconds enter the action library. Imported clips are bound to their original character, so they cannot accidentally animate an incompatible skeleton. Generic procedural actions are best on the built-in rigs; arbitrary imported rigs need proper retargeting for equivalent results.
- **Unreal:** export the production package, enable Python Editor Script and Interchange in Unreal, and run the included `unreal_import.py` using **Execute Python Script**. It imports the scene hierarchy into the current level. Save the level. Live Unreal import has not been verified in this environment.

The production ZIP includes `scene.glb` (baked skeletal/object animation at 24 fps), `scene.json`, original imported GLBs, engine import scripts, and `dialogue.srt` when the scene contains timed dialogue. Plain project JSON does not embed imported assets; use ZIP for portability. Lighting in the editor is for preview; configure production cameras and lighting in your destination engine.

## Implementation

- React + TypeScript + Vite; Three.js for the interactive scene and animated GLB export.
- An engine-neutral scene schema and command reducer in `shared/`; scene changes use the same validation path from both UI and AI.
- 14 original rigged character presets, 12 props, 6 sets, 14 procedural actions, custom keyframed actions, and imported native clips.
- The AI SDK uses native provider adapters for OpenAI/Anthropic/Google and OpenAI-compatible adapters for xAI/Kimi/OpenRouter. Credentials are server-side only after entry and are stored with mode `0600` in `.data/connections.json` (local disk storage, not an encrypted credential vault).
- Local JSON persistence uses atomic writes and optimistic revision checks. Imported assets and generated exports live under `.data/`; nothing in this folder is committed.
- `SCENE_MAKER_DATA` changes the data directory; `PORT` changes the production server port (dev proxy uses 4311). Browser write requests require the studio header and an allowed loopback origin.

## Verification

```sh
npm test
npm run build
npm audit
```

Tests cover ordered assistant workflows, project switches and failed saves, edits made during saving, isolated export snapshots, scene invariants, motion chaining, skeletal weights, custom paths, assistant structured-output contracts, per-character provider routing, ordered conversation context, progressive HTTP delivery, cancellation, partial provider failures, truncated streams, caption timing and subtitle export, on-disk persistence, revision conflicts, credential redaction, origin checks, and invalid imports. Provider tests use deterministic model responses, not paid live API calls. The HTTP conversation tests use the production stream handler and parser with controlled model responses. A provider failure or Stop preserves delivered turns; editing the scene cancels the active conversation so it cannot overwrite your changes. A server or network crash can still lose an unfinished turn.

For a browser-exported starter scene, extract the ZIP and run:

```sh
blender --background --python-exit-code 1 --python engine/blender_import.py -- scene.glb scene.blend
blender --background --python-exit-code 1 --python tests/verify_blender.py -- scene.blend
```

The verification script checks the two starter rigs, 22 bones, and actual pose changes, then creates a character FBX fixture for the conversion path. It is intentionally specific to the starter scene.

For an exported built-in character whose first actions are Pick up → Take a sip → Put down on a reachable coffee cup, `tests/verify_interactions_blender.py` accepts the resulting `scene.blend` and `scene.json`. It measures baked hand/grip and rim/mouth contact, lift, and return to the original transform. Interaction unit tests also cover low reaches, reverse scrubbing, ownership conflicts, unreachable staging, and preservation of imported body animation while carrying.

See [decisions](docs/DECISIONS.md), [verification evidence and remaining work](docs/VERIFICATION.md), and [integration references](docs/REFERENCES.md).

## Current scope limits

This is an implemented studio foundation, not proof of the entire original product vision. The brief's “Mixxar” is assumed to mean Mixamo; automatic creation/rigging through that service is not implemented. AI-created characters currently use a stylized Blender generator with preset outfits and custom compositions of validated geometric shapes. High-fidelity textured geometry generation, universal motion retargeting, live Unreal round-trip editing, and provider credentials/live-service validation remain outstanding. The assistant can edit scenes, generate supported assets/actions, create/copy/open/save projects, control the view and playback, run cast conversations, export, and open studio tools. It does not automate external logins or arbitrary external-engine operations. Its live planning and conversation contracts are tested with deterministic responses; real provider calls still require account credentials.

Prop interactions use geometric reach solving on compatible arm rigs. They do not provide collision avoidance, automatic navigation to a prop, finger articulation, or general physical simulation. Custom props can specify local `grip` and `mouth` contact points through their validated asset definition.
