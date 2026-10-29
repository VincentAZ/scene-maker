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

Then open **http://127.0.0.1:4311**. The server intentionally binds to loopback. The version and build appear in the footer; click them (or open **Studio settings**) for **Check for updates**, which compares your checkout with GitHub and shows the update commands. Nothing is downloaded or applied automatically. This is a single-user local studio, not a publicly hosted multi-user service.

## Create a scene

The menu bar shows the active **provider · model**. Open it and click a saved provider to use its last selected model, or search and click an exact model identifier. Each choice saves and takes effect immediately for the next request. **Manage connections** adds or replaces provider keys.

Use **Clear chat** above the assistant conversation to start fresh. **Undo clear** restores it until you send another message. Clearing chat keeps your scene and its edits; the next request still receives the current scene but no previous chat messages.

The **Assistant**, **Details**, and **Code** sidebar sections can be resized by dragging their left edge. Each remembers its own width. Use the collapse button to tuck them into a narrow rail, then click a section to reopen it; collapsing keeps unsent drafts. The resize edge also supports arrow keys and Home/End. On small screens, expanded panels overlay the scene and collapsed sections become a compact row below it.

Use **Clear scene** above the viewport to start with a blank studio: it removes placed characters, props, actions, dialogue, and the scene direction. Your project name and library assets are kept. **Undo** (Ctrl/Cmd+Z) restores the scene.

The character library includes **46 ready-to-use characters**: 32 bundled Quaternius humanoids plus 14 original studio presets and mannequins. Browse Everyday, Professionals, Adventure, Fantasy, or Mannequins; search by name or role. The new cards show rendered previews of their actual models. Try “Add Harper” or “Add Dr Amara”, then chain their actions as usual. The [asset provenance and conversion notes](docs/CHARACTER_ASSETS.md) record the CC0 sources and local processing.

Choose **Characters → Create a character** to make one of your own. Pick a starting look, name, outfit/skin/hair/accent colors, glasses, and a backpack. The character maker creates a separate skinned model and a preview card, then adds it to your cast and **My assets**. It needs the local production connection set up once. The assistant opens this flow with “Create a character”; the offline helper also accepts “Create a character named Cleo based on Sage”. Connected AI can author the same recipe and chain actions in one request. This customizes existing clothing and hair shapes; it does not invent a new haircut or outfit cut.

The prop library includes **105 props**, with 93 bundled furniture models across six collections. **Sets** offers 12 choices, including five furnished rooms with individually editable furniture. Try “Switch to Open kitchen” or “Add a glass coffee table”. Changing sets keeps your cast and separately added props; select a furnishing and choose **Details → Keep when switching sets** to keep that piece too. The [furniture source notes](docs/FURNITURE_ASSETS.md) record licensing and conversion.

**Actions** includes **32 built-in motions**, with 17 authored performances from the Quaternius pack. Browse Movement, Everyday, Acting, Stunts, or Interactions. Choose **Preview** to rehearse on the selected character, play or scrub the action, then add it when ready. Without a selected character, a sample performer demonstrates the motion. The rehearsal leaves your scene unchanged. The assistant accepts “Preview Celebrate”, “Sage Athletic jump then Forward roll”, or “Mila Disappointed then wave”. Authored walks/jogs stay in place; use the studio Walk/Run or a drawn path for travel. Authored carrying, reaching, sitting, and stage-combat performances are poses. The studio’s targeted Sit down/Stand up and Pick up/Take a sip/Put down handle supported seat and prop contact. See [motion sources and limits](docs/MOTION_ASSETS.md).

Drag any character or prop card from the side library into the 3D scene to place it under the pointer. Grab a placed object directly to slide it around at its current height; drag empty space to orbit. A translucent preview and placement outline follow your hand. New props can land on tabletops. Hold **Shift** for quarter-metre snapping, **Esc** to cancel, and **Ctrl/Cmd+Z** to undo the whole placement. The existing move gizmo still handles vertical placement. Playback pauses when dragging starts, and committed placements autosave. Click-to-add and keyboard activation remain available. Sets can also be dropped into the viewport to switch the backdrop/layout.

1. Choose characters, props, and a set from the library. The starter café is already populated.
2. Select an object to edit its placement, size, character personality, and (for geometric presets) color. The move tool also provides a 3D translation gizmo.
3. Select a character and add actions. Reorder actions, change their duration, and assign props in Details. Space plays/pauses; the timeline scrubs; Ctrl/Cmd+Z undoes.
4. Describe changes to the assistant. Without a provider, the **offline command helper** supports a small, explicit command vocabulary, such as “Add a coffee cup”, “Mila walk then jump”, and “Set moonlight”. It is not a simulated AI service.
5. Use **Direct the cast** to open the collapsible, resizable conversation aside. Give the visible cast a mission or topic; connected characters respond in turn, and each completed reply saves and plays in the scene as it arrives. Speech bubbles follow the speaker, a thinking bubble marks the character preparing a reply, and the cast turns, looks and gestures toward each other. **Voice & pace** enables browser voices, individual voice choices and playback speed. **Write a line yourself** works without an AI connection. **Draw a path for this line** times a walking or running route to that line without moving the next speaker's turn. Stop preserves completed replies; continuing starts with the next speaker. Preview any transcript line, frame the cast, or save dialogue and timed SRT subtitles.
6. Export an editable project, an animated production package, a Blender file, or a still image. Open a package again from the project browser to restore the scene and imported assets.

The assistant can also manage your workspace. Try “Create a new scene called Moonwalk”, “Copy this project as Second take”, “Open Moonwalk”, “Save”, “Export scene”, “Export Unreal”, “Export subtitles”, or “Reset camera” with the offline helper. With a connected model, one request can create a project, add and direct its cast, save, and export in order. The assistant receives recent chat context for follow-up requests. “Let them talk” runs the cast with its assigned models; file imports open the appropriate file-selection flow.

For a prop interaction, position the character within reach and ask “Leo pick up the cup then sip then put down”. Pick up reaches before lifting and keeps the prop in hand across later actions. Take a sip brings its rim to the mouth; Put down returns it to its original spot. A standalone sip returns the cup automatically. Unreachable props stay in place with a staging hint; if the character has walked too far to put a held prop back, it stays in hand until the staging is corrected. Each character uses one prop in the right hand. Try “Jump to 3.5 seconds” to inspect a pose. The assistant receives the playhead and current staging hint.

For a seated performance, search Props for “sitting” and choose a chair or bench marked **Ready for sitting**. Place the character near its front, then ask “Mila sit on Dining chair then talk then wave then stand up then walk”. **Sit down** chooses a nearby seat; Details lets you select another one. The character stays seated through idle, talk, wave, bow, and supported cup actions. Add **Stand up** before walking or another full-body action. Seats have one sitting position and must stay still; resize the furniture when a staging hint says the performer’s feet cannot reach the floor. Sit/Stand previews use a separate bench fitted to the selected body. The short approach does not route around intervening furniture.

New chained actions ease from the preceding body pose over up to a quarter second. In **Details → Into this action**, choose Smooth or Cut; **After the last action** chooses a held pose or neutral stance. The offline helper also accepts “Make Mila’s transitions smooth” and “Leo hold the final pose”. Timing and travel stay unchanged. New characters hold their final pose; older projects retain their saved behavior until edited. Targeted prop, ladder, and seating actions keep their own contact choreography.

Projects save automatically on the local service with revision checks. A recovery copy is stored in this browser; conflicting remote revisions are never silently overwritten. Undo history lasts for the current session. Switching projects waits for all pending edits to save. Failed operations stop an assistant workflow and identify any steps that already completed.

For a ladder climb, add a ladder and ask “Jack climb the ladder”. Jack approaches its front, alternates hands and feet between rungs, and finishes in an upper-rung stance. Details lets you choose another ladder and adjust duration. The action library selects the nearest visible ladder; the assistant can target one by name. Both hands must be free. A final climb holds its stance, while a following action starts from that height and facing direction. Stage the exit yourself: this action does not navigate around obstacles or step onto a platform. Imported or custom-part ladders need accurate rung metadata; unknown rungs are not inferred from geometry.

To direct a route, ask “Draw a path for Mila” or choose **Actions → Draw a path** with a character selected. Click the map to add points, drag them to reshape the route, and choose Walk or Run. The route begins after the character's existing actions. Smooth turns, duration, and optional point coordinates are editable; **Use natural pace** estimates a duration from the route length. **Details → Edit path** revises that performance without changing another character's reused action.

To reach a specific object, select it under **Walk to an object** and choose **Plan a clear route**. The map shows measured footprints and a route around placed objects. The assistant can do the same with “Mila walk to Coffee cup then pick up then sip then put down”, or “Mila run to Wooden crate then wave”. Small-prop stopping points use the character's actual arm reach; larger destinations leave standing room beside them. The character turns toward the destination at arrival. If the staging leaves no clear route or reachable stop, the studio explains what needs moving and adds no route. Routes stay editable in **My actions**. Replan after moving objects or changing earlier actions; these are flat routes through a staging snapshot, so check backdrop walls and moving characters yourself.

The offline helper can also create “Mila walk in a circle then wave” and “Mila run in a square”. Connected AI can create and revise arbitrary level routes using the same validated data. Characters turn into their route, follow its curves, and keep the final position and facing for the next action. Hand-drawn and coordinate-authored paths need your clearance check. Routes do not adapt to stairs or uneven ground.

Imported humanoid actions can be shared across the cast. Select a different character and choose the imported action in **Actions**; its label reads **Adapt to [character]**. Or ask “Mila Turn and greet then walk”, using your imported action's name. The studio adapts recognized body joints and scales travel to the receiving body. Its final position and facing carry into the next action. The original file remains unchanged, and the original character does not need to stay in the scene. Production ZIPs retain the source asset so the editable project remains portable.

## Connect AI and production tools

Technical controls are **two steps deep: Studio settings → Connections**.

- **AI:** paste your API key, click **Load models**, choose **Everyday directing**, **Complex scenes**, or **Quick edits** from the available studio suggestions, then **Save & use in studio**. Saved keys are reused automatically. Exact identifiers, older releases, snapshots, and fine-tunes are under **Advanced models**. The form distinguishes unsaved changes, saved settings, and discovery errors; **Return to studio** opens and focuses the assistant. Loading models reads the catalogue without generating a reply; successful discovery does not prove generation access, credit, or structured-output compatibility. Each character can speak with any connected provider and model: open the character’s **Details → Their mind**, or **Who speaks with which AI** in the conversation panel, to pick a provider, search its full catalogue or paste an exact identifier, and set a per-character thinking effort. Choices apply immediately and save with the scene; a warning shows when a chosen provider has no saved key. The same controls and the offline helper are also under **Assistant & character preferences**. Production tools have their own independent save. Supports OpenAI, Anthropic, Google, xAI, Kimi (international Moonshot endpoint), and OpenRouter. Choose models that support structured JSON output. API usage is billed by your provider; a conversation makes one request per visible character per round.
- **Blender:** install Blender 4.5 LTS or compatible and enter the executable path, or use `BLENDER_PATH`. The adapter customizes bundled skinned characters and attaches wearables, creates geometric characters from validated specifications, converts FBX imports, and saves animated `.blend` scenes. Model-generated Python is never executed.
- **Mixamo:** download your own rigged character with its animation as FBX and import it. Blender converts it; native animation clips up to 60 seconds enter the action library. Studio actions adapt to recognized humanoid hierarchies, including namespaced Mixamo-style bones, rotated bone axes, and T-pose arms. Original clips retain their own playback on their source character and can also be adapted to other compatible humanoids. Native translation and final facing carry into later actions; the initial clip facing aligns to the character’s scene facing. Unrecognized bodies show a staging hint when a studio or shared action is requested; their original animations remain available.
- **Unreal:** choose **Export scene → Unreal project**, or ask “Export Unreal”. Unpack the whole ZIP into a new folder and open `SceneMaker.uproject` with Unreal Engine 5.6 or later. The included project enables its required plugins and starts scene setup after the editor loads. The adapter imports into a new level, adds editable lights, saves the result, and reopens that level on later launches without reimporting over edits. Import results and animation warnings go to `Saved/SceneMaker/import-report.json`. This handoff has been packaged and contract-tested; actual Unreal import and playback have not been verified here.

The production ZIP includes `scene.glb` (baked skeletal/object animation at 24 fps), `scene.json`, original imported GLBs, engine import scripts, a configured Unreal project, and `dialogue.srt` when the scene contains timed dialogue. Plain project JSON does not embed imported assets; use ZIP for portability. Lighting in the editor is for preview; the Unreal adapter supplies basic editable lights. Configure production cameras and lighting in your destination engine.

Conversation gestures and facing are included in baked animation. Voice playback offers four kinds of voices, grouped in each character’s selector under **Voice & pace**: the browser’s own voices, **Piper** local neural voices that run on this computer, **OpenAI** voices (using your saved OpenAI key) and **ElevenLabs** voices (with its own key). Install the Piper engine and any of its 140+ voices in 40+ languages, or add cloud keys, under **Studio settings → Connections → Voices**. Characters without a choice are cast automatically with distinct voices; **Preview** plays a sample; choices save with the scene. Generated lines are cached on this computer, so replays and scrubbing cost nothing, and a line whose voice fails falls back to a browser voice. Playback follows speech timing and resumes near the selected word after seeking. Voice audio and bubble graphics are preview features, not embedded in production exports; SRT keeps the authored timeline. The existing stylized characters do not have phoneme lip-sync.

## Implementation

- React + TypeScript + Vite; Three.js for the interactive scene and animated GLB export.
- An engine-neutral scene schema and command reducer in `shared/`; scene changes use the same validation path from both UI and AI.
- 46 rigged character choices, 105 props, 12 sets, 32 built-in actions, custom keyframed actions, and imported native clips.
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

`npx tsx scripts/verify-character-designs.ts /path/to/blender` generates all 32 starting looks in a temporary test directory, checks their palettes and rendered previews, and animates their fitted wearables through the studio loader. It removes that temporary directory afterward. `tests/verify_character_design_blender.py` independently compares a generated model with its original body and skin weights; `tests/verify_designed_cast_blender.py` checks the exported Cleo/Rook browser scene. See the [creator dialog](docs/character-creator-form.png) and [restored studio scene](docs/character-creator-preview.png).

For a browser-exported starter scene, extract the ZIP and run:

```sh
blender --background --python-exit-code 1 --python engine/blender_import.py -- scene.glb scene.blend
blender --background --python-exit-code 1 --python tests/verify_blender.py -- scene.blend
```

The verification script checks the two starter rigs, 22 bones, and actual pose changes, then creates a character FBX fixture for the conversion path. It is intentionally specific to the starter scene.

For an exported built-in character whose first actions are Pick up → Take a sip → Put down on a reachable coffee cup, `tests/verify_interactions_blender.py` accepts the resulting `scene.blend` and `scene.json`. It measures baked hand/grip and rim/mouth contact, lift, and return to the original transform. Interaction unit tests also cover low reaches, reverse scrubbing, ownership conflicts, unreachable staging, and preservation of imported body animation while carrying.

`tests/verify_ladder_blender.py` checks a built-in ladder climb in the browser-exported Blender file against physical rung positions. It verifies planted hand/foot contact at 24 fps and the final held stance. [Ladder preview](docs/ladder-preview.jpg) shows the browser result.

`tests/create_imported_fixture.py` creates an original weighted T-pose FBX/GLB with namespaced joints, different bone axes, and native translation. After importing it and exporting a native → native → wave → walk sequence, `tests/verify_imported_blender.py` checks the resulting Blender file against the packaged source asset. The animated export includes parent transforms, scale, and morph weights as well as bones. The offline assistant also supports “Focus on Rowan” to frame a named character or object.

`tests/verify_path_blender.py` checks the browser-authored Walk → curved route → Wave → Walk fixture in Blender, measuring waypoint positions, facing, travel speed, boundary continuity, and leg animation. See the [path editor](docs/path-editor.jpg) and [playback preview](docs/path-preview.jpg).

`tests/verify_seating_blender.py` checks the browser-created **A seat at the table** fixture: Sit down → Talk → Wave → Take a sip → Stand up → Walk. It measures actual deformed shoe/floor and pelvis/chair contact, stable seated hips, cup grip/return, standing, travel, and boundary continuity. See the [seated performance](docs/seated-performance.png).

`tests/verify_navigation_blender.py` checks the browser-created **A clear way through** fixture: Walk → planned route around a crate/table → Pick up → Take a sip → Put down. It measures body-centre clearance against actual imported geometry, arrival facing, hand/cup and rim/mouth contact, exact return, and the full fractional-frame ending. See the [planned route](docs/planned-route-editor.png) and [sip at the destination](docs/planned-route-preview.png).

`tests/create_shared_motion_fixture.py` makes an original FBX with a T-pose bind skeleton, changed bone axes, travel, a turn, and an overhead gesture. `tests/verify_shared_motion_blender.py` compares the original and two receiving characters in the browser export, checking limb directions, scaled travel, final facing, and the following walk. [Shared motion preview](docs/shared-motion-preview.jpg) shows the same imported gesture on all three characters.

`tests/verify_transitions_blender.py` checks the browser-authored original/adapted gesture → walk sequences and a held final pose in Blender. It measures arm continuity, gradual blending, unchanged horizontal travel, retained facing, and every held joint transform. [Sequence preview](docs/sequence-transition-preview.jpg) shows the creator controls.

The production package tests check the original assets, project files, content hashes, missing-file failures, and assistant route. Run `python3 -m unittest discover -s tests -p test_unreal_adapter.py` for adapter contracts covering first import, safe reopening/retry, missing rigs, failed saves, and unsupported engines. These use a fake engine and do not establish Unreal runtime compatibility. [Unreal export controls](docs/unreal-project-export.jpg) show the browser entry point.

See [decisions](docs/DECISIONS.md), [verification evidence and remaining work](docs/VERIFICATION.md), and [integration references](docs/REFERENCES.md).

## Current scope limits

This is an implemented studio foundation, not proof of the entire original product vision. The brief's “Mixxar” is assumed to mean Mixamo; automatic creation/rigging through that service is not implemented. Character creation customizes 32 skinned starting looks with colors and fitted wearables, or uses validated geometric compositions for original shapes. High-fidelity textured geometry generation, universal motion retargeting, live Unreal round-trip editing, and broad live-provider validation remain outstanding. The assistant can edit scenes, generate supported assets/actions, create/copy/open/save projects, control the view and playback, run cast conversations, export, and open studio tools. It does not automate external logins or arbitrary external-engine operations. Its planning and conversation contracts are tested with deterministic responses; actual OpenAI and Anthropic assistant replies and an Anthropic cast conversation are also recorded in [the verification log](docs/VERIFICATION.md). Other provider/model combinations still need account-specific verification.

Prop interactions use geometric reach solving on compatible arm rigs. Request a Walk to route first when the prop is distant. The planner uses conservative placed-object footprints and a shoulder-width clearance estimate; it does not solve arbitrary limb collisions, backdrop architecture, moving obstacles, finger articulation, or general physical simulation. Custom props can specify local `grip` and `mouth` contact points through their validated asset definition.

Imported humanoid calibration requires recognizable joints, compatible ancestry, and uniform positive scale along the bone hierarchy. Sharing transfers eleven body joints, hip movement, and body travel; it does not transfer fingers, facial animation, morph shapes, or planted-foot constraints. Actions that animate bone lengths or scale remain available only on their original character. This is not universal retargeting. Original and adapted playback carry final facing into subsequent actions. Body-pose blending does not solve collisions, foot planting, or new contact constraints; facial/morph animation and arbitrary nonuniform animated rig transforms are outside this blending guarantee.

### Ask the assistant to improve the app

Open **Code** beside Assistant and Details. Describe an application feature or bug fix, then choose **Start coding task**. This uses the AI provider selected in the studio and sends the relevant source files to that provider.

Each task gets a private Git checkout and a **studio engineer**: an autonomous agent with full control of that checkout. It can read and edit any file (dependencies included), run any shell command with the host environment, commit, push the task branch to `origin`, deploy the committed branch into the running studio (merge, rebuild, restart), call HTTP APIs, consult any connected AI provider, delegate sub-tasks to fresh agents, and use the MCP servers configured in Studio settings → Connections. Ask for what you want in the prompt: "run the checks, commit and push", or "…then deploy". Without those words the work stays uncommitted for review and the sandboxed TypeScript, test and production-build checks run before you push from the panel. Task history and partial changes survive restarts in `.data/coding/`.

The Code panel shows live progress: elapsed time, model step count, the engineer's own one-line narration before each batch of tool calls, and every file read, command run, commit and push. Long gaps are called out with how long the model has been thinking.

Requirements: Linux with Git, installed studio dependencies, a connected model with tool calling, and a GitHub `origin` remote for pushing (`gh auth login` for pull requests). Bubblewrap (`bwrap`) is needed only for the panel-driven sandbox checks. There is no step or time limit by default; set `SCENE_MAKER_CODING_STEPS` or `SCENE_MAKER_CODING_TIMEOUT_MINUTES` to add one. Commands run by the engineer use your real environment and credentials, exactly as if you ran them, so give it the same trust you give a colleague with push access.

The bottom-left footer shows the app version and a UTC build number. Include both when reporting an issue so the running build can be identified precisely.

Adjust **Thinking effort** in the top model dropdown or Studio settings → Connections. The dropdown saves immediately; Connections applies it when you save. The preference is separate for each provider and applies to scene replies, cast conversations and coding tasks. Available levels depend on the selected model; higher levels can increase latency and token use.
