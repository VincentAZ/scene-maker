import { usePlayhead } from "./usePlayhead";
import { routeActiveDuration } from "../shared/clipTiming";
import { importedTakeLabel } from "../shared/animation";
import { studioVersion, studioBuild } from "./version";
import { CodingAssistant } from "./CodingAssistant";
import { ChatExportMenu } from "./ChatExportMenu";
import { exportAssistantChat, exportFilename } from "./code/transcriptExport";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Clapperboard,
  Sparkles,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowLeft,
  ArrowRight,
  Play,
  Pause,
  SkipBack,
  Undo2,
  Redo2,
  Settings2,
  Users,
  Box,
  Mountain,
  Footprints,
  Layers,
  Camera,
  Move,
  RotateCw,
  Scaling,
  Maximize,
  Download,
  Upload,
  Check,
  Trash2,
  Copy,
  Eye,
  EyeOff,
  MessageCircle,
  FolderOpen,
  Sun,
  MoreHorizontal,
  X,
  LoaderCircle,
  Film,
  Lightbulb,
  PanelRightClose,
} from "lucide-react";
import JSZip from "jszip";
import { AssistantModelMenu } from "./AssistantModelMenu";
import { productionPackage } from "./productionPackage";
import { ActionPreview } from "./ActionPreview";
import { ImportedClipTiming } from "./ImportedClipTiming";
import { motionDetails } from "../shared/motionLibrary";
import { ActionLibrary } from "./ActionLibrary";
import { AssetLibrary } from "./AssetLibrary";
import { CharacterCreator } from "./CharacterCreator";
import { libraryEntry } from "../shared/characterLibrary";
import { furnitureEntry } from "../shared/furnitureLibrary";
import { setLayout } from "../shared/setLayouts";
import { seatProfile, nearestSeat } from "../shared/seating";
import { ladderProfile, nearestLadder } from "../shared/ladder";
import { contactAction } from "../shared/transitions";
import { savePathCommands, type PathFrame } from "../shared/path";
import { PathEditor } from "./PathEditor";
import type { Footprint } from "../shared/navigation";
import {
  dialogueAt,
  dialogueSubtitles,
  dialogueTiming,
  appendSpeech,
  setDialoguePath,
  reviseDialogue,
} from "../shared/conversation";
import { DialogueComposer } from "./DialogueComposer";
import { runResolvedConversation } from "./resolvedConversation";
import {
  CastProgress,
  DialogueTranscript,
  type CastProgressState,
} from "./Dialogue";
import { type AssistantReply, type StudioStep } from "../shared/studio";
import { runStudioPlan, StudioPlanError } from "./studioRunner";
import { withAutomaticMovement } from "../shared/aiMovement";
import { hasAutomaticRoutes } from "./automaticRoutes";
import { ProjectSaveQueue } from "./projectSave";
import { defaultRouteLocomotion } from "./routeLocomotion";
import { loadRouteGait } from "./useRouteGait";
import {
  emptyStudioLibrary,
  studioLibrarySchema,
  studioLibraryAssets,
  studioLibraryMotions,
  studioLibraryCommands,
  type StudioLibrary,
} from "../shared/studioLibrary";
import {
  type Scene,
  type Entity,
  type Asset,
  type Command,
  type Motion,
  blankScene,
  retiredAssetIds,
  allAssets,
  allMotions,
  resolveMotionSource,
  applyCommands,
  duration,
  validateScene,
  uid,
  assets,
} from "../shared/scene";
import {
  readConversationPreferences,
  saveConversationPreferences,
} from "./conversationPreferences";
import { ConversationAside } from "./ConversationAside";
import { StudioAside } from "./StudioAside";
import { useConversationVoice } from "./conversationVoice";
import { RecordButton, type RecordingStatus } from "./RecordButton";
import {
  CINEMA,
  SceneRecorder,
  recordingFileName,
  recordingToMp4,
} from "./sceneRecorder";
import { armRecordingAudio, disarmRecordingAudio } from "./recordingAudio";
import {
  useBrowserVoices,
  useVoiceCatalog,
  effectiveVoiceChoices,
  previewVoice,
} from "./voiceCatalog";
import { Viewport, type ViewportHandle } from "./Viewport";
import { environmentAsset, photoSetAsset } from "./environmentModel";
import { AssetArt } from "./AssetArt";
import { Modal } from "./Modal";
import { GenerateAsset, type ImportedModel } from "./GenerateAsset";
import { Connections } from "./Connections";
import { RigMappingEditor } from "./RigMappingEditor";
import { createPlaybackTransport } from "./playbackTransport";
import { CharacterModelPicker } from "./CharacterModelPicker";
import { UpdateCheck } from "./UpdateCheck";
import { RestartStudio } from "./RestartStudio";
import {
  AttachButton,
  PendingChips,
  pastedFiles,
  useFileDrop,
  useImageAttachments,
} from "./Attachments";
import { api, download } from "./api";
import { importableFile } from "./importFile";
type Tab = "characters" | "props" | "environments" | "motions";
type Message = {
  role: "user" | "assistant";
  text: string;
  mode?: string;
  /** Reference images sent with a request, as data URLs for display. */
  images?: string[];
};
const welcomeMessage: Message = {
  role: "assistant",
  text: "Every great scene starts with a little “what if”. Tell me what you have in mind, and let’s make it happen.",
  mode: "welcome",
};
const tabs = [
  { id: "characters", label: "Characters", icon: Users },
  { id: "props", label: "Props", icon: Box },
  { id: "environments", label: "Sets", icon: Mountain },
  { id: "motions", label: "Actions", icon: Footprints },
] as const;
const sameContent = (s: Scene) => JSON.stringify({ ...s, revision: 0 });
const versionSummary = (s: Scene) => {
  const assets = allAssets(s);
  const cast = s.entities.filter(
    (e) => assets.find((a) => a.id === e.assetId)?.category === "characters",
  ).length;
  const actions = s.entities.reduce((n, e) => n + e.clips.length, 0);
  return `Revision ${s.revision} · ${s.entities.length} objects (${cast} characters) · ${actions} actions · ${s.transcript.length} dialogue lines`;
};
export default function App() {
  const {
    time,
    seekVersion,
    seek: setTime,
    publish: publishTime,
  } = usePlayhead();
  const [scene, setScene] = useState<Scene>(blankScene),
    [ready, setReady] = useState(false),
    [studioLibrary, setStudioLibrary] =
      useState<StudioLibrary>(emptyStudioLibrary),
    [studioLibraryError, setStudioLibraryError] = useState(""),
    [selected, setSelectedState] = useState<string | null>(null),
    [tab, setTab] = useState<Tab>("characters"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [playing, setPlayingState] = useState(false),
    [move, setMove] = useState(false),
    [transformMode, setTransformMode] = useState<
      "translate" | "rotate" | "scale"
    >("translate"),
    [rightTab, setRightTab] = useState<"assistant" | "details" | "code">(
      "assistant",
    ),
    [panel, setPanelState] = useState(true),
    [conversationOpen, setConversationOpen] = useState(false),
    [voiceEnabled, setVoiceEnabled] = useState(false),
    [voiceChoices, setVoiceChoices] = useState<Record<string, string>>(
      () => readConversationPreferences().choices,
    ),
    [conversationRate, setConversationRate] = useState(
      () => readConversationPreferences().rate,
    ),
    [modal, setModal] = useState<
      | "settings"
      | "connections"
      | "projects"
      | "export"
      | "import"
      | "generate"
      | "conversation"
      | "path"
      | "character"
      | "clearScene"
      | "conflict"
      | null
    >(null),
    [previewAction, setPreviewAction] = useState<{
      motion: Motion;
      actorId?: string;
      source: Scene;
    } | null>(null),
    [pathEdit, setPathEdit] = useState<{
      actorId: string;
      actor: Entity;
      clipId?: string;
      frame: PathFrame;
      footprints: Footprint[];
      motion?: Motion;
      content: string;
      dialogueClip?: boolean;
    } | null>(null),
    [error, setError] = useState(""),
    [interactionWarning, setInteractionWarning] = useState(""),
    [notice, setNotice] = useState(""),
    [conflict, setConflict] = useState<Scene | null>(null),
    [saveState, setSaveState] = useState("Opening studio…"),
    [messages, setMessages] = useState<Message[]>([welcomeMessage]),
    [clearedMessages, setClearedMessages] = useState<Message[] | null>(null),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
    [modelSwitchBusy, setModelSwitchBusy] = useState(false),
    [connectionsRevision, setConnectionsRevision] = useState(0),
    [castProgress, setCastProgress] = useState<CastProgressState | null>(null),
    [exporting, setExporting] = useState(false),
    [projects, setProjects] = useState<
      { id: string; name: string; environment: string; updated: number }[]
    >([]),
    [rounds, setRounds] = useState(1),
    [historyVersion, setHistoryVersion] = useState(0),
    [importCategory, setImportCategory] = useState<"characters" | "props">(
      "characters",
    );
  const libraryRequest = useRef(0);
  const refreshStudioLibrary = useCallback(async () => {
    const request = ++libraryRequest.current;
    try {
      const library = studioLibrarySchema.parse(await api("/api/library"));
      if (request !== libraryRequest.current) return;
      setStudioLibrary(library);
      setStudioLibraryError("");
    } catch {
      if (request !== libraryRequest.current) return;
      // A catalog outage must not prevent opening/editing an existing project.
      // Keep the last good catalog, but make failures visible and retryable.
      setStudioLibraryError(
        "Your saved library could not be refreshed. Project assets are still available.",
      );
    }
  }, []);
  useEffect(() => {
    void refreshStudioLibrary();
    const refresh = () => void refreshStudioLibrary();
    window.addEventListener("focus", refresh);
    return () => {
      libraryRequest.current++;
      window.removeEventListener("focus", refresh);
    };
  }, [refreshStudioLibrary]);
  const transport = useRef<ReturnType<typeof createPlaybackTransport> | null>(
    null,
  );
  if (!transport.current)
    transport.current = createPlaybackTransport(setPlayingState);
  const setPlaying = useCallback(
    (value: boolean | ((current: boolean) => boolean)) =>
      transport.current!.setPlaying(value),
    [],
  );
  const setPanel = useCallback((open: boolean) => {
    setPanelState(open);
    if (open) setConversationOpen(false);
  }, []);
  useEffect(() => {
    if (modal === "conversation") {
      setConversationOpen(true);
      setPanel(false);
      setModal(null);
    }
  }, [modal]);
  const setSelected = useCallback((id: string | null) => {
    setSelectedState(id);
    setMove(id !== null);
  }, []);
  useEffect(() => {
    saveConversationPreferences({ rate: conversationRate });
  }, [conversationRate]);
  // Voices: browser engine + local Piper + cloud, resolved per character.
  // Explicit choices live on the entity; older localStorage choices still
  // apply until a character gets an explicit one.
  const browserVoices = useBrowserVoices();
  const voiceCatalog = useVoiceCatalog(connectionsRevision, browserVoices);
  const speakers = useMemo(() => {
    const assets = allAssets(scene);
    return scene.entities.filter(
      (e) => assets.find((a) => a.id === e.assetId)?.category === "characters",
    );
  }, [scene]);
  const effectiveVoices = useMemo(
    () => effectiveVoiceChoices(speakers, voiceChoices, voiceCatalog.all),
    [speakers, voiceChoices, voiceCatalog.all],
  );
  const voice = useConversationVoice(
    scene,
    playing,
    voiceEnabled,
    effectiveVoices,
    conversationRate,
    setError,
  );
  const conversationController = useRef<AbortController | null>(null);
  // Planning pauses playback so no stale route plays; a running playback
  // (manual or cast conversation) resumes by itself once planning settles.
  const pauseForNavigation = useCallback(
    () => transport.current!.pauseForPlanning(),
    [],
  );
  const resumeAfterNavigation = useCallback(
    () => transport.current!.planningSettled(!!conversationController.current),
    [],
  );
  useEffect(() => {
    if (
      playing &&
      !castProgress &&
      scene.transcript.length &&
      time >=
        Math.max(
          ...scene.entities.map((e) =>
            e.clips.reduce((t, c) => t + c.duration, 0),
          ),
        )
    )
      setPlaying(false);
  }, [playing, castProgress, time, scene]);
  useEffect(() => () => conversationController.current?.abort(), []);
  const viewport = useRef<ViewportHandle>(null),
    sceneRef = useRef(scene),
    // lastCoalesce/lastAt let continuous typing share one undo entry.
    history = useRef<{
      past: Scene[];
      future: Scene[];
      lastCoalesce: string | null;
      lastAt: number;
    }>({
      past: [],
      future: [],
      lastCoalesce: null,
      lastAt: 0,
    }),
    conflictRef = useRef<Scene | null>(null),
    saveBlocked = useRef(false),
    saveRetries = useRef(0),
    saveFailure = useRef(""),
    readyRef = useRef(false),
    fileInput = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null),
    chatEnd = useRef<HTMLDivElement>(null);
  sceneRef.current = scene;
  const report = useCallback((text: string) => {
    setError(text);
  }, []);
  const images = useImageAttachments(report);
  const imageDrop = useFileDrop(images.add);
  const toast = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };
  // Recording the viewport during playback; the take ends when playback stops.
  // The take follows the scene clock, so it can span a live cast conversation
  // and skips the waits while the cast generates replies.
  const recorder = useRef<SceneRecorder | null>(null);
  const [recording, setRecording] = useState<RecordingStatus>("idle");
  const [activeTake, setActiveTake] = useState<SceneRecorder | null>(null);
  const sceneEnd = Math.max(
    0,
    ...scene.entities.map((e) => e.clips.reduce((t, c) => t + c.duration, 0)),
  );
  /** Arm a take; `play` also starts playback from the playhead. */
  const startRecording = (play: boolean) => {
    if (recording !== "idle" || recorder.current) return false;
    // Film camera: 1920×1080 from the preview's view, no editor helpers.
    const film = viewport.current?.startCinema(CINEMA.width, CINEMA.height);
    if (!film) {
      report(
        "The film camera could not start. Wait for the scene to load, then record again.",
      );
      return false;
    }
    const audio = voiceEnabled ? armRecordingAudio() : null;
    let take: SceneRecorder;
    try {
      take = new SceneRecorder(
        film,
        (t) => dialogueAt(sceneRef.current, t),
        audio,
      );
    } catch (error) {
      disarmRecordingAudio();
      viewport.current?.stopCinema();
      report((error as Error).message);
      return false;
    }
    recorder.current = take;
    setActiveTake(take);
    viewport.current?.onFrame((t) => take.drawFrame(t));
    // Restart the current voice line so its audio joins the recording.
    voice.stop();
    setRecording("recording");
    if (play) {
      if (sceneEnd > 0 && time >= sceneEnd) setTime(0);
      setPlaying(true);
    }
    return true;
  };
  const recordConversation = () => {
    if (startRecording(false)) void runConversation();
  };
  const stopRecording = () => {
    if (!castProgress) setPlaying(false);
    void finishRecording();
  };
  const finishRecording = useCallback(async () => {
    const take = recorder.current;
    if (!take) return;
    recorder.current = null;
    viewport.current?.onFrame(null);
    disarmRecordingAudio();
    setRecording("saving");
    const finished = take.stop();
    viewport.current?.stopCinema();
    try {
      const mp4 = await recordingToMp4(await finished);
      download(mp4, recordingFileName(sceneRef.current.name), "video/mp4");
      setNotice("Recording saved as MP4.");
      setTimeout(() => setNotice(""), 4000);
    } catch (error) {
      report((error as Error).message);
    } finally {
      setActiveTake(null);
      setRecording("idle");
    }
  }, [report]);
  // A take ends when playback stops, unless a cast conversation is still
  // generating (it pauses playback while waiting for the first reply).
  useEffect(() => {
    if (recording === "recording" && !playing && !castProgress)
      void finishRecording();
  }, [recording, playing, castProgress, finishRecording]);
  useEffect(
    () => () => {
      recorder.current?.stop().catch(() => {});
      recorder.current = null;
      viewport.current?.stopCinema();
      disarmRecordingAudio();
    },
    [],
  );
  const saveQueue = useRef<ProjectSaveQueue | null>(null);
  if (!saveQueue.current)
    saveQueue.current = new ProjectSaveQueue(
      () => sceneRef.current,
      (next) => {
        sceneRef.current = next;
        setScene(next);
        localStorage.setItem("scene-maker-last", next.id);
        localStorage.setItem("scene-maker-recovery", JSON.stringify(next));
      },
      (snapshot) =>
        api<Scene>(`/api/projects/${snapshot.id}`, {
          method: "PUT",
          body: JSON.stringify(snapshot),
        }),
    );
  const save = useCallback(async (): Promise<boolean> => {
    if (!readyRef.current || saveBlocked.current) return false;
    setSaveState("Saving…");
    try {
      await saveQueue.current!.flush();
      setSaveState("All changes saved");
      saveFailure.current = "";
      saveRetries.current = 0;
      return true;
    } catch (e) {
      saveFailure.current = (e as Error).message;
      setSaveState("Changes not saved");
      if (
        (e as { status?: number }).status !== 409 &&
        saveRetries.current < 3
      ) {
        saveRetries.current++;
        setTimeout(() => void save(), 2000);
      } else {
        saveBlocked.current = true;
        report((e as Error).message);
        if ((e as { status?: number }).status === 409) void showConflict();
      }
      return false;
    }
  }, [report]);
  // Another window saved a newer revision. Show both versions and let the
  // creator choose, instead of leaving a banner and a dead save button.
  async function showConflict() {
    try {
      conflictRef.current = validateScene(
        await api(`/api/projects/${sceneRef.current.id}`),
      );
    } catch {
      conflictRef.current = null;
    }
    setConflict(conflictRef.current);
    setModal("conflict");
  }
  function keepMineAsCopy() {
    const copy = structuredClone(sceneRef.current);
    copy.id = uid();
    copy.revision = 0;
    copy.name = `${copy.name} (my version)`;
    conflictRef.current = null;
    setConflict(null);
    loadScene(copy);
    toast("Saved your version as a separate project.");
  }
  function reloadSaved() {
    const remote = conflictRef.current;
    if (!remote) return;
    conflictRef.current = null;
    setConflict(null);
    loadScene(remote);
    toast(
      "Reloaded the saved version. Earlier saves stay in Previous versions.",
    );
  }
  async function saveOrThrow() {
    if (!(await save()))
      throw Error(
        saveFailure.current ||
          "Your current project could not be saved. Your changes are still here; the requested operation has stopped.",
      );
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const list = await api<typeof projects>("/api/projects");
        let loaded: Scene;
        const id = localStorage.getItem("scene-maker-last");
        if (list.length)
          loaded = validateScene(
            await api(
              `/api/projects/${list.find((p) => p.id === id)?.id || list[0].id}`,
            ),
          );
        else loaded = blankScene();
        const recovery = localStorage.getItem("scene-maker-recovery");
        if (recovery) {
          try {
            const draft = validateScene(JSON.parse(recovery));
            if (draft.id === loaded.id && draft.revision === loaded.revision)
              loaded = draft;
            // Work done while the service was unreachable has no saved file
            // yet; keep it as a project instead of discarding it.
            else if (!list.some((p) => p.id === draft.id)) loaded = draft;
          } catch {}
        }
        if (active) {
          sceneRef.current = loaded;
          setScene(loaded);
          setSelected(loaded.entities[0]?.id || null);
          readyRef.current = true;
          setReady(true);
          setSaveState("All changes saved");
        }
      } catch (e) {
        if (active) {
          report((e as Error).message);
          const recovery = localStorage.getItem("scene-maker-recovery");
          if (recovery) {
            try {
              const draft = validateScene(JSON.parse(recovery));
              sceneRef.current = draft;
              setScene(draft);
              setSelected(draft.entities[0]?.id || null);
              readyRef.current = true;
              setReady(true);
              setSaveState("Recovered local changes");
            } catch {
              startOffline();
            }
          } else {
            startOffline();
          }
        }
      }
      // Without a saved project, keep editing persisted: the recovery copy
      // is written on every change and saving retries when the service is back.
      function startOffline() {
        readyRef.current = true;
        setReady(true);
        setSaveState("Reconnect to open projects");
      }
    })();
    return () => {
      active = false;
    };
  }, [report]);
  const content = useMemo(() => sameContent(scene), [scene]);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(
      "scene-maker-recovery",
      JSON.stringify(sceneRef.current),
    );
    const timer = setTimeout(() => void save(), 700);
    return () => clearTimeout(timer);
  }, [content, ready, save]);
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  function cancelConversationForEdit() {
    conversationController.current?.abort(
      "The scene changed, so the conversation stopped. Completed turns and your edits are kept.",
    );
  }
  // coalesce: edits with the same key within two seconds (typing in one
  // field) extend the previous undo entry instead of adding one per keystroke.
  const change = (next: Scene, fromConversation = false, coalesce?: string) => {
    next = validateScene(next);
    if (!fromConversation) cancelConversationForEdit();
    const h = history.current,
      now = Date.now();
    if (!(coalesce && coalesce === h.lastCoalesce && now - h.lastAt < 2000)) {
      h.past.push(structuredClone(sceneRef.current));
      if (h.past.length > 60) h.past.shift();
    }
    h.lastCoalesce = coalesce ?? null;
    h.lastAt = now;
    h.future = [];
    sceneRef.current = next;
    setScene(next);
    setHistoryVersion((v) => v + 1);
  };
  const execute = (commands: Command[], coalesce?: string) => {
    try {
      change(applyCommands(sceneRef.current, commands), false, coalesce);
      return true;
    } catch (e) {
      report((e as Error).message);
      return false;
    }
  };
  async function applyAssistantScene(next: Scene) {
    const staged = withAutomaticMovement(sceneRef.current, next);
    change(staged);
    if (hasAutomaticRoutes(staged)) {
      // Later commands/dialogue must start from the resolved endpoint and clock.
      await viewport.current!.waitForScene(staged);
      viewport.current!.prepareNavigation();
    }
  }
  const undo = () => {
    const old = history.current.past.pop();
    if (!old) return;
    cancelConversationForEdit();
    history.current.future.push(sceneRef.current);
    history.current.lastCoalesce = null;
    const next = { ...old, revision: sceneRef.current.revision };
    sceneRef.current = next;
    setScene(next);
    setHistoryVersion((v) => v + 1);
  };
  const clearScene = () => {
    setModal(null);
    change({
      ...sceneRef.current,
      environment: "studio",
      lighting: "daylight",
      mission: "",
      entities: [],
      transcript: [],
    });
    setPlaying(false);
    setTime(0);
    setSelected(null);
    setPreviewAction(null);
    setPathEdit(null);
    setInteractionWarning("");
    toast("Scene cleared. Use Undo (Ctrl/Cmd+Z) to restore it.");
  };
  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    cancelConversationForEdit();
    history.current.past.push(sceneRef.current);
    history.current.lastCoalesce = null;
    next.revision = sceneRef.current.revision;
    sceneRef.current = next;
    setScene(next);
    setHistoryVersion((v) => v + 1);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        modal ||
        previewAction
      )
        return;
      // Space must still activate focused buttons, links, sliders and the
      // panel resize handle; only play/pause when nothing interactive has focus.
      const interactive =
        e.target instanceof HTMLElement &&
        e.target.closest(
          "button, a, summary, [contenteditable], [role=button], [role=slider], [role=separator], [role=tab], [role=menuitem], [role=option]",
        );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.code === "Space" && !interactive) {
        e.preventDefault();
        setPlaying((v) => !v);
      }
      if (e.key === "Delete" && selected)
        execute([{ type: "remove", id: selected }]);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selected, modal, previewAction, historyVersion]);
  async function openPathEditor(
    actorId: string,
    clipId?: string,
    dialogueClip = false,
  ) {
    setPlaying(false);
    cancelConversationForEdit();
    const snapshot = sceneRef.current;
    const actor = snapshot.entities.find((e) => e.id === actorId);
    if (
      !actor ||
      allAssets(snapshot).find((a) => a.id === actor.assetId)?.category !==
        "characters"
    )
      throw Error("Choose a character before creating a path.");
    await viewport.current!.waitForScene(snapshot);
    if (sameContent(sceneRef.current) !== sameContent(snapshot))
      throw Error(
        "The scene changed while loading. Open the route editor again.",
      );
    const clip = clipId ? actor.clips.find((c) => c.id === clipId) : undefined;
    if (clip?.routeWait)
      throw Error(
        "This action holds a stopped pose. Edit the preceding route to change its path.",
      );
    const motion =
      clip && allMotions(snapshot).find((m) => m.id === clip.motionId);
    if (clipId && !motion?.path && !dialogueClip)
      throw Error("This action does not have an editable path.");
    const navigation = viewport.current!.routeContext(actorId, clipId);
    setPathEdit({
      actorId,
      actor,
      clipId,
      frame: navigation.frame,
      footprints: navigation.footprints,
      dialogueClip,
      motion: motion?.path
        ? { ...motion, duration: routeActiveDuration(clip!) }
        : undefined,
      content: sameContent(snapshot),
    });
    setError("");
    setModal("path");
  }
  const entity = scene.entities.find((e) => e.id === selected);
  const selectedAsset = allAssets(scene).find((a) => a.id === entity?.assetId);
  const isCharacter = selectedAsset?.category === "characters";
  const cast = scene.entities.filter(
    (e) =>
      allAssets(scene).find((a) => a.id === e.assetId)?.category ===
      "characters",
  );
  const total = duration(scene);
  const dialogueClips = useMemo(
    () =>
      new Set(
        scene.transcript.flatMap((line) =>
          (line.clipIds || (line.clipId ? [line.clipId] : [])).map(
            (id) => `${line.characterId}:${id}`,
          ),
        ),
      ),
    [scene.transcript],
  );
  const update = (id: string, changes: Partial<Entity>, coalesce?: string) =>
    execute([{ type: "update", id, changes }], coalesce);
  function add(asset: Asset, position?: [number, number, number]) {
    const before = sceneRef.current.entities.length;
    try {
      if (
        !execute([
          ...studioLibraryCommands(sceneRef.current, studioLibrary, {
            assetIds: [asset.id],
          }),
          { type: "add", assetId: asset.id, ...(position ? { position } : {}) },
        ])
      )
        return;
    } catch (error) {
      report((error as Error).message);
      return;
    }
    if (asset.category !== "environments") {
      const added = sceneRef.current.entities[before];
      if (added) {
        setSelected(added.id);
        toast(`${asset.name} added to your scene`);
      }
    } else toast(`${asset.name} is ready`);
  }
  async function ask(text = prompt) {
    const attached = images.items.filter((i) => i.image);
    if (images.items.some((i) => i.status === "uploading")) return;
    if ((!text.trim() && !attached.length) || busy || modelSwitchBusy) return;
    setPrompt("");
    images.clear();
    setClearedMessages(null);
    setMessages((m) => [
      ...m,
      {
        role: "user",
        text,
        images: attached.length
          ? attached.map((i) => i.preview || "")
          : undefined,
      },
    ]);
    setBusy(true);
    const starting = sceneRef.current;
    try {
      const result = await api<AssistantReply>("/api/assistant", {
        method: "POST",
        body: JSON.stringify({
          scene: starting,
          prompt: text.trim() || "Use the attached reference image.",
          images: attached.map((i) => ({
            name: i.name,
            mediaType: i.image!.mediaType,
            data: i.image!.data,
          })),
          selected,
          playhead: time,
          stagingFeedback: interactionWarning,
          history: messages
            .filter((m) => m.mode !== "welcome" && m.mode !== "error")
            .slice(-20)
            .map(({ role, text, images }) => ({
              role,
              text: text || (images ? "(Sent reference images.)" : ""),
            })),
        }),
      });
      if (
        sceneRef.current.id !== starting.id ||
        sameContent(sceneRef.current) !== sameContent(starting)
      )
        throw Error(
          "The scene changed while the assistant was thinking. Please ask again with the latest scene.",
        );
      const completed = await runStudioPlan(result, {
        getScene: () => sceneRef.current,
        save: saveOrThrow,
        load: loadScene,
        read: (id) => api<Scene>("/api/projects/" + id),
        edit: (commands) =>
          applyAssistantScene(applyCommands(sceneRef.current, commands)),
        perform: performStudioStep,
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            result.response +
            (completed.length ? "\n\n" + completed.join(" · ") : ""),
          mode: result.mode,
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            (e instanceof StudioPlanError && e.completed.length
              ? `Completed: ${e.completed.join(" · ")}.\n\n`
              : "") + (e as Error).message,
          mode: "error",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }
  function addMotion(motion: Motion, actorId = selected) {
    const current = sceneRef.current;
    const actor = current.entities.find((e) => e.id === actorId);
    if (
      !actor ||
      allAssets(current).find((a) => a.id === actor.assetId)?.category !==
        "characters"
    ) {
      report("Choose a character in your scene first.");
      return;
    }
    const ladder =
      motion.role === "climb"
        ? nearestLadder(current.entities, allAssets(current), actor)
        : undefined;
    if (motion.role === "climb" && !ladder) {
      toast("Add a ladder from Props, then try this action.");
      return;
    }
    const seat =
      motion.role === "sit"
        ? nearestSeat(current, allAssets(current), actor)
        : undefined;
    if (motion.role === "sit" && !seat) {
      toast(
        "Add a chair with a sitting surface from Props, then try this action.",
      );
      return;
    }
    try {
      const added = execute([
        ...studioLibraryCommands(current, studioLibrary, {
          motionIds: [motion.id],
        }),
        {
          type: "chain",
          id: actor.id,
          motionId: motion.id,
          ...(seat ? { targetId: seat.id } : {}),
          ...(ladder ? { targetId: ladder.id } : {}),
        },
      ]);
      if (added) toast(`${motion.name} added to ${actor.name}’s sequence`);
    } catch (error) {
      report((error as Error).message);
    }
  }
  function previewMotion(motion: Motion, actorId?: string) {
    // Register dependencies only in the disposable preview, not in the project.
    const source = applyCommands(
      sceneRef.current,
      studioLibraryCommands(sceneRef.current, studioLibrary, {
        motionIds: [motion.id],
      }),
    );
    setPlaying(false);
    setPreviewAction({ motion, source, actorId });
  }
  async function performStudioStep(
    step: Exclude<
      StudioStep,
      { type: "edit" | "newProject" | "copyProject" | "openProject" | "save" }
    >,
  ) {
    if (step.type === "dialogue") {
      await applyAssistantScene(
        appendSpeech(sceneRef.current, step.characterId, step),
      );
      return;
    }
    if (step.type === "reviseDialogue" || step.type === "removeDialogue") {
      change(
        reviseDialogue(
          sceneRef.current,
          step.index,
          step.type === "reviseDialogue" ? step.text : undefined,
        ),
      );
      return;
    }
    if (step.type === "walkTo") {
      setPlaying(false);
      cancelConversationForEdit();
      let snapshot = sceneRef.current;
      await viewport.current!.waitForScene(snapshot);
      snapshot = viewport.current!.prepareNavigation();
      const actor = snapshot.entities.find(
        (entity) => entity.id === step.actorId,
      );
      if (!actor) throw Error("The route character is no longer in the scene.");
      const locomotion = defaultRouteLocomotion(snapshot, actor, step.movement);
      const cycle =
        locomotion.kind === "imported"
          ? await loadRouteGait(
              resolveMotionSource(snapshot, locomotion.sourceAssetId),
              allAssets(snapshot).find((asset) => asset.id === actor.assetId),
              locomotion.animationName,
              undefined,
              locomotion.path?.sourceRange,
              locomotion.path?.strideScale,
            )
          : undefined;
      if (sameContent(sceneRef.current) !== sameContent(snapshot))
        throw Error(
          "The scene changed while planning. Ask for the route again.",
        );
      const motion = viewport.current!.planRoute(
        step.actorId,
        step.targetId,
        step.movement,
        undefined,
        locomotion,
        cycle,
        true,
      );
      const planned = applyCommands(
        snapshot,
        savePathCommands(snapshot, step.actorId, motion),
      );
      planned.entities
        .find((entity) => entity.id === step.actorId)!
        .clips.at(-1)!.navigation = {
        targetId: step.targetId,
        movement: step.movement,
      };
      change(planned);
      setSelected(step.actorId);
      setRightTab("details");
      setPanel(true);
      return;
    }
    if (step.type === "previewAction") {
      const motion = studioLibraryMotions(sceneRef.current, studioLibrary).find(
        (item) => item.id === step.motionId,
      );
      if (!motion) throw Error("That action is no longer in your library.");
      previewMotion(motion, step.actorId);
      return;
    }
    if (step.type === "pathEditor") {
      await openPathEditor(step.actorId, step.clipId);
      return;
    }
    if (step.type === "select") {
      setSelected(step.id);
      return;
    }
    if (step.type === "playback") {
      if (step.mode === "play") setPlaying(true);
      else {
        setPlaying(false);
        if (step.mode === "rewind") setTime(0);
        if (step.mode === "seek") {
          if (step.time === undefined || step.time > duration(sceneRef.current))
            throw Error("Choose a time within this scene’s sequence.");
          setTime(step.time);
        }
      }
      return;
    }
    if (step.type === "camera") {
      await viewport.current!.waitForScene(sceneRef.current);
      viewport.current!.frame(step.view, step.focusId);
      return;
    }
    if (step.type === "conversation") {
      await runConversation(step.rounds, true);
      return;
    }
    if (step.type === "export") {
      if (step.format === "subtitles") {
        const subtitles = dialogueSubtitles(sceneRef.current);
        if (!subtitles)
          throw Error("There are no timed dialogue lines to export yet.");
        download(subtitles, "scene-dialogue.srt", "text/plain");
      } else if (step.format === "dialogue") {
        if (!sceneRef.current.transcript.length)
          throw Error("There is no dialogue to export yet.");
        download(
          sceneRef.current.transcript
            .map((t) => `${t.name}: ${t.text}`)
            .join("\n\n"),
          "scene-dialogue.txt",
          "text/plain",
        );
      } else if (step.format === "image") {
        await viewport.current!.waitForScene(sceneRef.current);
        viewport.current!.screenshot();
      } else await exportScene(step.format, true);
      return;
    }
    if (step.type === "library") {
      setTab(step.category);
      setFilter("All");
      setSearch(step.search);
      return;
    }
    if (step.type === "history") {
      if (step.direction === "undo") {
        if (!history.current.past.length)
          throw Error("There are no edits to undo.");
        undo();
      } else {
        if (!history.current.future.length)
          throw Error("There are no edits to redo.");
        redo();
      }
      return;
    }
    if (step.type === "show") {
      if (step.panel === "projects" || step.panel === "importProject") {
        await saveOrThrow();
        setProjects(await api("/api/projects"));
        setModal("projects");
      } else if (step.panel === "importAsset") {
        setImportCategory(step.category || "characters");
        setModal("import");
      } else if (step.panel === "settings") setModal("settings");
      else if (step.panel === "createCharacter") setModal("character");
      else if (step.panel === "dialogue") setModal("conversation");
      else {
        setRightTab(step.panel);
        setPanel(true);
      }
    }
  }
  function stopConversation() {
    conversationController.current?.abort();
    setPlaying(false);
    voice.stop();
    setCastProgress((progress) =>
      progress ? { ...progress, stopping: true } : null,
    );
  }
  async function runConversation(roundCount = rounds, propagate = false) {
    if (conversationController.current)
      throw Error("A cast conversation is already running.");
    if (!propagate && (busy || modelSwitchBusy)) return;
    if (!propagate) setBusy(true);
    setPlaying(false);
    setConversationOpen(true);
    setPanel(false);
    setTime(
      Math.max(
        0,
        ...sceneRef.current.entities.map((e) =>
          e.clips.reduce((t, c) => t + c.duration, 0),
        ),
      ),
    );
    voice.stop();
    setError("");
    const controller = new AbortController();
    conversationController.current = controller;
    let completed = 0;
    setCastProgress({
      name: "",
      characterId: "",
      completed: 0,
      total: cast.filter((e) => e.visible).length * roundCount,
    });
    try {
      const total = cast.filter((e) => e.visible).length * roundCount;
      await runResolvedConversation(
        total,
        {
          getScene: () => sceneRef.current,
          request: (expected, signal) =>
            fetch("/api/conversation", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/x-ndjson",
                "X-Scene-Maker": "1",
              },
              body: JSON.stringify({
                scene: expected,
                rounds: 1,
                singleTurn: true,
              }),
              signal,
            }),
          accept: (next, count) => {
            change(next, true);
            completed = count;
            setCastProgress({
              name: "",
              characterId: "",
              completed,
              total,
              stopping: controller.signal.aborted,
            });
          },
          prepare: async (next, signal) => {
            if (hasAutomaticRoutes(next)) pauseForNavigation();
            await viewport.current!.waitForScene(next, signal);
            viewport.current!.prepareNavigation();
          },
          save: saveOrThrow,
          thinking: (event, count) =>
            setCastProgress({
              name: event.name,
              characterId: event.characterId,
              completed: count,
              total,
              stopping: controller.signal.aborted,
            }),
          ready: (resolved, count) => {
            if (count === 1) {
              const start =
                dialogueTiming(resolved, resolved.transcript.at(-1)!)?.start ||
                0;
              setTime(start);
              setPlaying(true);
              setSelected(null);
              viewport.current?.frame("conversation", undefined, start);
            } else if (transport.current!.resumePending) setPlaying(true);
          },
        },
        controller.signal,
      );
      toast(`Your cast added ${completed} turns to the scene`);
    } catch (e) {
      const stopped = controller.signal.aborted;
      // Closing the stream also cancels the active provider request on the server.
      controller.abort();
      const message = stopped
        ? typeof controller.signal.reason === "string"
          ? controller.signal.reason
          : `Conversation stopped. ${completed} completed ${completed === 1 ? "turn is" : "turns are"} kept.`
        : (e as Error).message;
      if (propagate) throw Error(message);
      if (stopped) toast(message);
      else report(message);
    } finally {
      conversationController.current = null;
      transport.current!.cancelResume();
      setCastProgress(null);
      if (!propagate) setBusy(false);
    }
  }
  function retrySave() {
    if (!saveBlocked.current) return;
    if (conflictRef.current) {
      setConflict(conflictRef.current);
      setModal("conflict");
      return;
    }
    saveBlocked.current = false;
    void save();
  }
  async function openProjects() {
    try {
      await saveOrThrow();
      setProjects(await api("/api/projects"));
      setModal("projects");
    } catch (e) {
      report((e as Error).message);
    }
  }
  function loadScene(next: Scene) {
    cancelConversationForEdit();
    // A plan still settling for the previous project must not restart playback.
    setPlaying(false);
    setTime(0);
    setSelected(next.entities[0]?.id || null);
    history.current = { past: [], future: [], lastCoalesce: null, lastAt: 0 };
    saveBlocked.current = false;
    conflictRef.current = null;
    sceneRef.current = next;
    setScene(next);
    setModal(null);
    setHistoryVersion((v) => v + 1);
    localStorage.setItem("scene-maker-last", next.id);
    void refreshStudioLibrary();
  }
  async function importProject(file: File) {
    try {
      let next: Scene;
      if (file.name.endsWith(".zip")) {
        const zip = await JSZip.loadAsync(file);
        const definition = zip.file("scene.json");
        if (!definition) throw Error("The package is missing scene.json.");
        next = validateScene(JSON.parse(await definition.async("string")));
        for (const a of next.customAssets) {
          if (a.url) {
            const asset = zip.file("assets/" + a.url.split("/").pop());
            if (!asset) throw Error(`The package is missing ${a.name}.`);
            const data = new FormData();
            data.append(
              "file",
              new Blob([await asset.async("arraybuffer")]),
              "asset.glb",
            );
            const result = await api<{ url: string }>("/api/import", {
              method: "POST",
              body: data,
            });
            a.url = result.url;
          }
          if (a.thumbnail) {
            const preview = zip.file("assets/" + a.thumbnail.split("/").pop());
            if (!preview)
              throw Error(`The package is missing the preview for ${a.name}.`);
            const data = new FormData();
            data.append(
              "file",
              new Blob([await preview.async("arraybuffer")]),
              "preview.png",
            );
            a.thumbnail = (
              await api<{ url: string }>("/api/thumbnails", {
                method: "POST",
                body: data,
              })
            ).url;
          }
        }
      } else next = validateScene(JSON.parse(await file.text()));
      next.id = uid();
      next.revision = 0;
      await saveOrThrow();
      loadScene(next);
      toast("Project imported");
    } catch (e) {
      report((e as Error).message);
    }
  }
  async function importAsset(file: File) {
    setBusy(true);
    try {
      // Motion capture arrives as an animated armature GLB; VRM as its GLB.
      file = await importableFile(file);
      const data = new FormData();
      data.append("file", file);
      const result = await api<{
        url: string;
        name: string;
        animations: { name: string; duration: number }[];
        hasMesh: boolean;
      }>("/api/import", { method: "POST", body: data });
      // A capture or animation-only take has no body to place: its takes go
      // to Actions for any cast.
      const capture = !result.hasMesh && result.animations.length > 0;
      // Takes are limited to 60 seconds; longer ones are counted in the notice,
      // not dropped silently, and a capture with nothing usable is not imported.
      const tooLong = result.animations.filter((a) => a.duration > 60);
      if (
        capture &&
        tooLong.length &&
        tooLong.length === result.animations.length
      ) {
        report(
          `${result.name} is ${Math.round(tooLong[0]?.duration ?? 0)} seconds long. Trim the capture to 60 seconds or less and import it again.`,
        );
        return;
      }
      const skipped = tooLong.length
        ? ` · ${tooLong.length} take${tooLong.length > 1 ? "s" : ""} longer than 60 s ${tooLong.length > 1 ? "were" : "was"} not added`
        : "";
      const asset: Asset = {
        id: uid(),
        name: result.name.slice(0, 100),
        category: importCategory,
        style: "Imported",
        url: result.url,
        color: "#a8b89b",
        skin: "#b98a69",
        body: "masculine",
        description: "Imported from your files.",
        ...(capture ? { motionOnly: true } : {}),
      };
      execute([
        { type: "createAsset", asset },
        ...result.animations
          .map((a, index, all) => ({
            ...a,
            label: importedTakeLabel(a.name, asset.name, index, all.length),
          }))
          .filter((a) => a.duration <= 60)
          .map((a) => ({
            type: "createMotion" as const,
            motion: {
              id: uid(),
              name: a.label.slice(0, 100),
              kind: "imported" as const,
              duration: a.duration,
              distance: 0,
              poses: [],
              sourceAssetId: asset.id,
              animationName: a.name,
            },
          })),
        ...(capture ? [] : [{ type: "add" as const, assetId: asset.id }]),
      ]);
      setModal(null);
      if (capture) {
        setTab("motions");
        setFilter("My actions");
        setSearch("");
        toast(`${asset.name} is ready in Actions${skipped}`);
      } else {
        setSelected(sceneRef.current.entities.at(-1)!.id);
        toast(`${asset.name} is ready${skipped}`);
      }
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function placeImportedModel(
    model: ImportedModel,
    category: "characters" | "props",
  ) {
    const asset: Asset = {
      id: uid(),
      name: model.name.slice(0, 100),
      category,
      style: "Mixamo",
      url: model.url,
      color: "#a8b89b",
      skin: "#b98a69",
      body: "masculine",
      description: "Rigged and animated with Mixamo.",
    };
    execute([
      { type: "createAsset", asset },
      ...model.animations
        .map((a, index, all) => ({
          ...a,
          label: importedTakeLabel(a.name, asset.name, index, all.length),
        }))
        .filter((a) => a.duration <= 60)
        .map((a) => ({
          type: "createMotion" as const,
          motion: {
            id: uid(),
            name: a.label.slice(0, 100),
            kind: "imported" as const,
            duration: a.duration,
            distance: 0,
            poses: [],
            sourceAssetId: asset.id,
            animationName: a.name,
          },
        })),
      { type: "add", assetId: asset.id },
    ]);
    setSelected(sceneRef.current.entities.at(-1)!.id);
    setModal(null);
    toast(`${asset.name} is ready`);
  }
  function placeGeneratedAsset(asset: Asset) {
    const exists = sceneRef.current.customAssets.some((a) => a.id === asset.id);
    execute([
      ...(exists ? [] : [{ type: "createAsset" as const, asset }]),
      { type: "add", assetId: asset.id },
    ]);
    setSelected(sceneRef.current.entities.at(-1)!.id);
    setModal(null);
    toast(`${asset.name} placed`);
  }
  async function exportScene(
    kind: "project" | "package" | "blender" | "unreal",
    propagate = false,
  ) {
    let snapshot = structuredClone(sceneRef.current);
    setExporting(true);
    setPlaying(false);
    try {
      if (kind === "project") {
        download(JSON.stringify(snapshot, null, 2), "scene-maker.json");
      } else {
        await viewport.current!.waitForScene(snapshot);
        snapshot = structuredClone(viewport.current!.prepareNavigation());
        const glb = await viewport.current!.exportGLB();
        if (kind === "blender") {
          const form = new FormData();
          form.append("file", new Blob([glb]), "scene.glb");
          const result = await api<{ url: string }>("/api/blender", {
            method: "POST",
            body: form,
          });
          const response = await fetch(result.url);
          if (!response.ok)
            throw Error("The Blender file could not be downloaded.");
          download(
            await response.arrayBuffer(),
            "scene.blend",
            "application/octet-stream",
          );
        } else {
          const packageData = await productionPackage(snapshot, glb);
          const filename =
            kind === "unreal"
              ? "scene-maker-unreal.zip"
              : "scene-maker-package.zip";
          const form = new FormData();
          form.append(
            "file",
            new Blob([packageData], { type: "application/zip" }),
            filename,
          );
          const saved = await api<{ url: string }>("/api/exports", {
            method: "POST",
            body: form,
          });
          const link = document.createElement("a");
          link.href = saved.url;
          link.download = filename;
          link.click();
        }
      }
      toast("Your scene is ready to download");
      setModal(null);
    } catch (e) {
      if (propagate) throw e;
      report((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const panelAssets = studioLibraryAssets(scene, studioLibrary);
  const privateAssetIds = new Set(
    [...scene.customAssets, ...studioLibrary.assets].map((asset) => asset.id),
  );
  const privateMotionIds = new Set(
    [...scene.customMotions, ...studioLibrary.motions].map(
      (motion) => motion.id,
    ),
  );
  const filtered = panelAssets
    .filter(
      (a) =>
        a.category === tab &&
        !a.motionOnly &&
        !retiredAssetIds.has(a.id) &&
        (filter !== "My assets" || privateAssetIds.has(a.id)) &&
        (
          a.name +
          " " +
          a.style +
          " " +
          a.description +
          (seatProfile(a) ? " seat sitting" : "")
        )
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(!!(libraryEntry(b) || furnitureEntry(b) || setLayout(b.id))) -
        Number(!!(libraryEntry(a) || furnitureEntry(a) || setLayout(a.id))),
    );
  const libraryMotionList = studioLibraryMotions(scene, studioLibrary);
  const motionUsage = new Map<string, number>();
  for (const entity of scene.entities)
    for (const clip of entity.clips)
      motionUsage.set(clip.motionId, (motionUsage.get(clip.motionId) ?? 0) + 1);
  const assetUsage = new Map<string, number>();
  for (const entity of scene.entities)
    assetUsage.set(entity.assetId, (assetUsage.get(entity.assetId) ?? 0) + 1);
  /** Delete the creator's own imports: from this scene (Undo restores it)
   * and from their library, so other projects stop offering them. */
  async function deleteFromLibrary(ids: string[], kind: "asset" | "motion") {
    const current = sceneRef.current;
    const inScene = ids.filter((id) =>
      kind === "asset"
        ? current.customAssets.some((a) => a.id === id)
        : current.customMotions.some((m) => m.id === id),
    );
    try {
      if (inScene.length)
        execute(
          inScene.map((id) =>
            kind === "asset"
              ? { type: "deleteAsset" as const, assetId: id }
              : { type: "deleteMotion" as const, motionId: id },
          ),
        );
      await api("/api/library/remove", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      await refreshStudioLibrary();
    } catch (error) {
      report((error as Error).message);
    }
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">
            <Clapperboard size={21} />
          </span>
          <span>
            scene<span className="brand-light">maker</span>
            <small>STUDIO</small>
          </span>
        </a>
        <div className="project-crumb">
          <span>My workspace</span>
          <ChevronRight size={14} />
          <button onClick={openProjects}>
            {scene.name}
            <ChevronDown size={14} />
          </button>
        </div>
        <div className="top-actions">
          <span
            className={`save-label ${saveState.includes("not") ? "warning" : ""}`}
            role="button"
            tabIndex={0}
            title="Click to retry saving"
            onClick={retrySave}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                retrySave();
              }
            }}
          >
            <span className="status-dot" />
            {saveState}
          </span>
          <button
            className="icon-button"
            onClick={undo}
            disabled={!history.current.past.length}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 size={17} />
          </button>
          <button
            className="icon-button"
            onClick={redo}
            disabled={!history.current.future.length}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 size={17} />
          </button>
          <span className="top-divider" />
          <button
            className="icon-button"
            aria-label="Studio settings"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={18} />
          </button>
          <button className="export-button" onClick={() => setModal("export")}>
            <Download size={15} /> Export scene
          </button>
          <div className="avatar">V</div>
        </div>
      </header>
      <div className="workspace">
        <aside className="library">
          <div className="panel-heading">
            <h2>Your creative toolkit</h2>
            <span className="tiny-label">LIBRARY</span>
          </div>
          <div className="library-tabs">
            {tabs.map((t) => (
              <button
                key={t.id}
                className={tab === t.id ? "active" : ""}
                onClick={() => {
                  setTab(t.id);
                  setSearch("");
                  setFilter("All");
                }}
              >
                <t.icon size={19} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="library-body">
            {studioLibraryError && (
              <div className="library-refresh-error" role="status">
                <p>{studioLibraryError}</p>
                <button
                  className="text-button"
                  onClick={() => void refreshStudioLibrary()}
                >
                  Retry library
                </button>
              </div>
            )}
            <div className="search">
              <Search size={16} />
              <input
                aria-label="Search library"
                placeholder={`Find ${tab === "environments" ? "a set" : tab === "motions" ? "an action" : tab}…`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <span>⌕</span>
            </div>
            <div className="section-caption">
              <span>
                {tab === "characters"
                  ? "A CAST FOR EVERY STORY"
                  : tab === "props"
                    ? "THE LITTLE DETAILS"
                    : tab === "environments"
                      ? "SET THE SCENE"
                      : "MAKE YOUR NEXT MOVE"}
              </span>
              <span>
                {tab === "motions" ? libraryMotionList.length : filtered.length}
              </span>
            </div>
            {tab === "motions" ? (
              <ActionLibrary
                key={filter === "My actions" ? "mine" : "all"}
                motions={libraryMotionList}
                search={search}
                mine={privateMotionIds}
                deletable={privateMotionIds}
                usage={motionUsage}
                initialSource={filter === "My actions" ? "mine" : "all"}
                subtitle={(m) =>
                  motionDetails(m).captured
                    ? "Motion capture"
                    : motionDetails(m).authored
                      ? "Stylized animation"
                      : m.path
                        ? "Your route"
                        : isCharacter
                          ? `Adapt to ${entity!.name}`
                          : "From your files"
                }
                onAdd={addMotion}
                onPreview={(m) => {
                  try {
                    previewMotion(m, isCharacter ? entity!.id : undefined);
                  } catch (error) {
                    report((error as Error).message);
                  }
                }}
                onDelete={(ids) => void deleteFromLibrary(ids, "motion")}
                onImport={() => {
                  setImportCategory("characters");
                  setModal("import");
                }}
              />
            ) : (
              <AssetLibrary
                key={tab}
                assets={filtered}
                noun={tab === "environments" ? "sets" : tab}
                mine={privateAssetIds}
                usage={assetUsage}
                dependents={(ids) => ({
                  actors: scene.entities.filter((e) => ids.includes(e.assetId))
                    .length,
                  actions: scene.customMotions.filter((m) =>
                    ids.includes(m.sourceAssetId ?? ""),
                  ).length,
                })}
                subtitle={(a) =>
                  a.category === "characters"
                    ? a.style
                    : a.category === "environments"
                      ? setLayout(a.id)
                        ? `${setLayout(a.id)!.props.length} editable props`
                        : "Scene backdrop"
                      : seatProfile(a)
                        ? "Ready for sitting"
                        : furnitureEntry(a)?.collection || "Scene prop"
                }
                onAdd={(a) => {
                  if (!viewport.current?.suppressAssetClick()) add(a);
                }}
                onDragStart={(a, event) =>
                  viewport.current?.startAssetDrag(a, event.nativeEvent)
                }
                onDelete={(ids) => void deleteFromLibrary(ids, "asset")}
              />
            )}
            {tab === "motions" && (
              <button
                className="create-asset"
                onClick={() => {
                  if (!entity || !isCharacter) {
                    report("Choose a character in your scene first.");
                    return;
                  }
                  void openPathEditor(entity.id).catch((e) =>
                    report(e.message),
                  );
                }}
              >
                <Footprints size={16} />
                <span>
                  Draw a path
                  <small>Draw freely or plan a walk to an object</small>
                </span>
                <Plus size={14} />
              </button>
            )}
          </div>
          <button className="import-button" onClick={() => setModal("import")}>
            <Upload size={15} /> Import your own asset
            <ChevronRight size={15} />
          </button>
          <button
            className="import-button"
            onClick={() => setModal("generate")}
          >
            <Sparkles size={15} /> Generate with AI · Rig with Mixamo
            <ChevronRight size={15} />
          </button>
          <div className="scene-list">
            <div className="section-caption">
              <span>
                IN THIS SCENE <b>{scene.entities.length}</b>
              </span>
              <Layers size={15} />
            </div>
            {scene.entities.map((e) => (
              <div
                className={`scene-row ${selected === e.id ? "selected" : ""}`}
                key={e.id}
              >
                <button
                  className="scene-select"
                  onClick={() => {
                    setSelected(e.id);
                    setRightTab("details");
                    setPanel(true);
                  }}
                >
                  <span
                    className="object-dot"
                    style={{ background: e.color }}
                  />
                  {e.name}
                </button>
                <button
                  className="icon-button"
                  aria-label={`${e.visible ? "Hide" : "Show"} ${e.name}`}
                  onClick={() => update(e.id, { visible: !e.visible })}
                >
                  {e.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            ))}
          </div>
        </aside>
        <main className="main-workspace">
          <div className="scene-toolbar">
            <div className="scene-title">
              <Film size={17} />
              <input
                aria-label="Scene name"
                value={scene.name}
                onChange={(e) =>
                  execute(
                    [
                      {
                        type: "scene",
                        changes: { name: e.target.value || "Untitled scene" },
                      },
                    ],
                    "scene-name",
                  )
                }
              />
              <span className="draft-label">DRAFT</span>
            </div>
            <div className="row">
              <button
                className="text-button"
                onClick={() => setModal("clearScene")}
                disabled={!ready || busy || !!castProgress}
                title="Remove all scene objects, actions and dialogue. Undo restores them. Your library assets are kept."
              >
                <Trash2 size={15} />
                <span>Clear scene</span>
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setConversationOpen((v) => !v);
                  setPanel(false);
                }}
              >
                <MessageCircle size={15} />
                <span>Direct the cast</span>
              </button>
              <RestartStudio />
              <button
                className={`icon-button ${!panel ? "active" : ""}`}
                aria-label="Toggle side panel"
                aria-expanded={panel}
                aria-controls="studio-panel-content"
                onClick={() => {
                  setPanel(!panel);
                  setConversationOpen(false);
                }}
              >
                <PanelRightClose size={17} />
              </button>
            </div>
          </div>
          <section className="stage">
            <Viewport
              ref={viewport}
              scene={scene}
              selected={selected}
              onSelect={setSelected}
              time={time}
              playing={playing}
              onTime={publishTime}
              seekVersion={seekVersion}
              onNavigationResolved={(expected, next) => {
                if (sameContent(sceneRef.current) !== sameContent(expected))
                  return;
                // This is the consequence of the preceding edit, so retain its
                // undo entry instead of adding an automatic undo/redo loop.
                const resolved = {
                  ...next,
                  revision: sceneRef.current.revision,
                };
                sceneRef.current = resolved;
                setScene(resolved);
              }}
              onNavigationPending={pauseForNavigation}
              onNavigationSettled={resumeAfterNavigation}
              thinkingId={castProgress?.characterId}
              advanceTime={voice.advance}
              onPlaybackState={voice.playbackState}
              stopAtEnd={
                scene.transcript.length > 0 ||
                (recording === "recording" && sceneEnd > 0)
              }
              onEnded={() => {
                if (!conversationController.current) setPlaying(false);
              }}
              onMove={(id, position) => update(id, { position })}
              onTransform={(id, changes) => update(id, changes)}
              transformMode={transformMode}
              onAdd={(assetId, position) => {
                const asset = studioLibraryAssets(
                  sceneRef.current,
                  studioLibrary,
                ).find((item) => item.id === assetId);
                if (asset) add(asset, position);
              }}
              onEditStart={() => {
                setPlaying(false);
                cancelConversationForEdit();
              }}
              onError={report}
              onInteractionWarning={setInteractionWarning}
              move={move}
            />

            {interactionWarning && (
              <div className="interaction-hint" role="status">
                <Lightbulb size={16} />
                <span>{interactionWarning}</span>
              </div>
            )}
            {castProgress && !conversationOpen && (
              <div className="stage-progress">
                <CastProgress
                  progress={castProgress}
                  onStop={stopConversation}
                />
              </div>
            )}
            <div className="stage-top">
              {recording === "idle" ? (
                <span className="view-label">
                  <span className="status-dot" /> LIVE PREVIEW
                </span>
              ) : (
                <span className="view-label recording-label" role="status">
                  <span className="recording-dot" />
                  {recording === "recording" ? "REC" : "SAVING MP4…"}
                </span>
              )}
              {photoSetAsset(scene) ? (
                // A photographed set brings its own light; presets would
                // contradict the photo behind the cast.
                <div
                  className="stage-pill"
                  title="This set is lit by its own photograph"
                >
                  <Sun size={14} />
                  <span>Lit by the photo</span>
                </div>
              ) : (
                <div className="stage-pill">
                  <Sun size={14} />
                  <select
                    aria-label="Scene lighting"
                    value={scene.lighting}
                    onChange={(e) =>
                      execute([
                        {
                          type: "scene",
                          changes: {
                            lighting: e.target.value as Scene["lighting"],
                          },
                        },
                      ])
                    }
                  >
                    <option value="golden">Golden hour</option>
                    <option value="daylight">Soft daylight</option>
                    <option value="moonlight">Moonlight</option>
                  </select>
                </div>
              )}
            </div>
            <div className="stage-tools">
              <button
                className={!move ? "active" : ""}
                aria-label="Orbit view"
                title="Drag objects to move; drag empty space to orbit"
                onClick={() => setMove(false)}
              >
                <Move size={18} />
              </button>
              <button
                className={
                  move && transformMode === "translate" ? "active" : ""
                }
                aria-pressed={move && transformMode === "translate"}
                aria-label="Move selected object"
                title="Move selected object"
                onClick={() => {
                  setTransformMode("translate");
                  setMove(true);
                  setPlaying(false);
                }}
              >
                <Plus size={19} />
              </button>
              <button
                className={move && transformMode === "rotate" ? "active" : ""}
                aria-pressed={move && transformMode === "rotate"}
                aria-label="Rotate selected object"
                title="Rotate selected object around the vertical axis"
                onClick={() => {
                  setTransformMode("rotate");
                  setMove(true);
                  setPlaying(false);
                }}
              >
                <RotateCw size={18} />
              </button>
              <button
                className={move && transformMode === "scale" ? "active" : ""}
                aria-pressed={move && transformMode === "scale"}
                aria-label="Scale selected object"
                title="Scale selected object uniformly (0.1–10×)"
                onClick={() => {
                  setTransformMode("scale");
                  setMove(true);
                  setPlaying(false);
                }}
              >
                <Scaling size={18} />
              </button>
              <span />
              <button
                aria-label="Reset camera"
                title="Reset camera"
                onClick={() => viewport.current?.reset()}
              >
                <Maximize size={17} />
              </button>
              <button
                aria-label="Save image"
                title="Save image"
                onClick={() => viewport.current?.screenshot()}
              >
                <Camera size={18} />
              </button>
            </div>
            <div className="stage-bottom">
              <span>
                <span className="kbd">Drag objects</span> to move{" "}
                <span className="dot-separator">·</span>
                <span className="kbd">Empty space</span> to orbit · Shift snaps
                · Esc cancels
              </span>
              <span>
                {scene.environment === "room" &&
                scene.entities.some((item) => item.setDressing)
                  ? "Furnished room"
                  : scene.environment === "cafe"
                    ? "Corner café"
                    : (
                        environmentAsset(scene) ??
                        assets.find((a) => a.id === scene.environment)
                      )?.name}{" "}
                <span className="dot-separator">/</span> {cast.length}{" "}
                characters
              </span>
            </div>
          </section>
          <section className="timeline">
            <div className="timeline-toolbar">
              <div className="row">
                <span className="section-title">The sequence</span>
                <span className="sequence-hint">
                  A story, one action at a time.
                </span>
              </div>
              <div className="transport">
                <button
                  className="icon-button"
                  aria-label="Rewind"
                  onClick={() => {
                    setTime(0);
                    setPlaying(false);
                  }}
                >
                  <SkipBack size={16} />
                </button>
                <button
                  className="play-button"
                  aria-label={playing ? "Pause scene" : "Play scene"}
                  onClick={() => {
                    if (
                      !playing &&
                      scene.transcript.length &&
                      time >=
                        Math.max(
                          ...scene.entities.map((e) =>
                            e.clips.reduce((t, c) => t + c.duration, 0),
                          ),
                        )
                    )
                      setTime(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? (
                    <Pause size={15} fill="currentColor" />
                  ) : (
                    <Play size={15} fill="currentColor" />
                  )}
                </button>
                <RecordButton
                  status={recording}
                  recorder={activeTake}
                  label="Record the scene while it plays and save it as an MP4"
                  onStart={() => startRecording(!castProgress)}
                  onStop={stopRecording}
                />
                <span className="timecode">
                  {time.toFixed(1).padStart(4, "0")}{" "}
                  <span>/ {total.toFixed(1)}s</span>
                </span>
              </div>
              <button className="text-button" onClick={() => setTab("motions")}>
                <Plus size={14} /> Add action
              </button>
            </div>
            <div className="timeline-scroll">
              <div className="ruler">
                <span>CHARACTER</span>
                <div>
                  {Array.from({ length: 7 }, (_, i) => (
                    <span key={i}>{Math.round((total * i) / 6)}s</span>
                  ))}
                </div>
              </div>
              <div className="tracks">
                <div
                  className="playhead"
                  style={{
                    left: `calc(130px + (100% - 146px) * ${time / total})`,
                  }}
                />
                <input
                  className="scrubber"
                  aria-label="Scene playhead"
                  type="range"
                  min="0"
                  max={total}
                  step=".05"
                  value={time}
                  onChange={(e) => {
                    setPlaying(false);
                    setTime(Number(e.target.value));
                  }}
                />
                {cast.map((e, i) => (
                  <div
                    className={`track ${selected === e.id ? "selected" : ""}`}
                    key={e.id}
                  >
                    <button
                      className="track-character"
                      onClick={() => {
                        setSelected(e.id);
                        setRightTab("details");
                        setPanel(true);
                      }}
                    >
                      <span style={{ background: e.color }}>{e.name[0]}</span>
                      {e.name}
                    </button>
                    <div className="track-clips">
                      {e.clips.map((c) => (
                        <button
                          key={c.id}
                          className={`clip clip-${i % 3}`}
                          style={{ width: `${(c.duration / total) * 100}%` }}
                          onClick={() => {
                            setSelected(e.id);
                            setRightTab("details");
                            setPanel(true);
                          }}
                          title={`${c.routeWait ? "Wait for clear route" : allMotions(scene).find((m) => m.id === c.motionId)?.name} · ${Number(c.duration.toFixed(1))}s${!c.routeWait && c.playbackRate !== undefined ? ` · ${Number(c.playbackRate.toFixed(4))}×${c.legacyFit ? " (legacy fit)" : ""}` : ""}`}
                        >
                          {dialogueClips.has(`${e.id}:${c.id}`) ? (
                            <MessageCircle size={12} />
                          ) : (
                            <Footprints size={12} />
                          )}
                          {c.routeWait
                            ? "Wait for clear route"
                            : allMotions(scene).find((m) => m.id === c.motionId)
                                ?.name}
                        </button>
                      ))}
                      <button
                        className="add-clip"
                        aria-label={`Add action to ${e.name}`}
                        onClick={() => {
                          setSelected(e.id);
                          setTab("motions");
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {!cast.length && (
                  <p className="empty-state">
                    Add a character to start telling your story.
                  </p>
                )}
              </div>
            </div>
            <div className="timeline-footer">
              <span>
                <Lightbulb size={12} /> Chain actions to bring your characters
                to life.
              </span>
              <span>
                24 frames / second <span className="dot-separator">·</span>{" "}
                {ready &&
                !saveState.includes("not") &&
                !saveState.startsWith("Reconnect")
                  ? "Auto-save on"
                  : "Auto-save paused"}
              </span>
            </div>
          </section>
        </main>
        <ConversationAside
          open={conversationOpen}
          onToggle={() => {
            setConversationOpen((v) => !v);
            setPanel(false);
          }}
          voiceEnabled={voiceEnabled}
          onVoiceEnabled={setVoiceEnabled}
          groups={voiceCatalog.groups}
          catalogErrors={voiceCatalog.errors}
          catalogLoading={voiceCatalog.loading}
          cast={cast}
          choices={effectiveVoices}
          onChoice={(id, value) => {
            setVoiceChoices((previous) => {
              const next = { ...previous };
              delete next[id];
              return next;
            });
            update(id, { voice: value || undefined });
          }}
          onPreview={(id) => {
            const actor = cast.find((e) => e.id === id);
            previewVoice(
              effectiveVoices[id],
              actor?.name || "your character",
              conversationRate,
            ).catch((e) => report((e as Error).message));
          }}
          onMoreVoices={() => setModal("connections")}
          rate={conversationRate}
          onRate={setConversationRate}
        >
          <div className="conversation-content">
            <div className="cast-avatars">
              {cast.map((e) => (
                <span key={e.id} style={{ background: e.color }} title={e.name}>
                  {e.name[0]}
                </span>
              ))}
              <span className="muted small">
                {cast.map((e) => e.name).join(" + ") || "Add your cast first"}
              </span>
            </div>
            {cast.length > 0 && (
              <details className="cast-minds" open>
                <summary>Who speaks with which AI</summary>
                {cast.map((e) => (
                  <div className="cast-mind" key={e.id}>
                    <span
                      className="cast-mind-name"
                      style={{ borderColor: e.color }}
                    >
                      {e.name}
                    </span>
                    <CharacterModelPicker
                      compact
                      entity={e}
                      revision={connectionsRevision}
                      disabled={busy || !!castProgress}
                      onChange={(changes) => update(e.id, changes)}
                      onConnections={() => setModal("connections")}
                    />
                  </div>
                ))}
              </details>
            )}
            <label>
              The direction
              <textarea
                rows={3}
                value={scene.mission}
                disabled={!!castProgress}
                onChange={(e) =>
                  execute(
                    [{ type: "scene", changes: { mission: e.target.value } }],
                    "scene-mission",
                  )
                }
                placeholder="A mission, a question, a secret to uncover…"
              />
            </label>
            <div className="row spread">
              <label className="inline-label">
                Rounds
                <select
                  value={rounds}
                  disabled={!!castProgress}
                  onChange={(e) => setRounds(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                className="primary"
                disabled={
                  busy ||
                  modelSwitchBusy ||
                  cast.filter((e) => e.visible).length < 2
                }
                onClick={() => runConversation()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Play size={15} />
                )}{" "}
                {busy
                  ? "Your cast is thinking…"
                  : scene.transcript.length
                    ? "Continue the conversation"
                    : "Let them talk"}
              </button>
            </div>
            {recording === "idle" ? (
              <button
                className="record-conversation"
                disabled={
                  busy ||
                  modelSwitchBusy ||
                  !!castProgress ||
                  cast.filter((e) => e.visible).length < 2
                }
                title="Generate the conversation and record it to an MP4 as it plays. Waits for replies are left out."
                onClick={recordConversation}
              >
                <span className="record-dot" aria-hidden="true" />
                {scene.transcript.length
                  ? "Record while they continue"
                  : "Record while they talk"}
              </button>
            ) : (
              <div className="record-conversation-status">
                <RecordButton
                  status={recording}
                  recorder={activeTake}
                  onStart={() => {}}
                  onStop={stopRecording}
                />
                <span className="small muted">
                  {recording === "saving"
                    ? "Saving your MP4…"
                    : "Recording. The video skips the waits while the cast thinks."}
                </span>
              </div>
            )}
            {castProgress && (
              <CastProgress progress={castProgress} onStop={stopConversation} />
            )}
            <button
              className="text-button"
              onClick={() => {
                setSelected(null);
                viewport.current?.frame("conversation");
              }}
            >
              Frame the conversation
            </button>
            <p className="small muted">
              Turns play in the scene as they arrive. Collapse this panel to
              watch, or pause to change the direction.
            </p>
            <DialogueComposer
              scene={scene}
              disabled={busy || !!castProgress}
              onAdd={(id, speech) => {
                const next = appendSpeech(sceneRef.current, id, speech);
                change(next);
                setTime(dialogueTiming(next, next.transcript.at(-1)!)!.start);
                setPlaying(true);
                setSelected(null);
                viewport.current?.frame("conversation");
              }}
            />
            <DialogueTranscript
              scene={scene}
              disabled={busy || !!castProgress}
              onRevise={(index, text) =>
                change(reviseDialogue(sceneRef.current, index, text))
              }
              onPath={(id, clipId) =>
                void openPathEditor(id, clipId, true).catch((e) =>
                  report(e.message),
                )
              }
              onPreview={(start) => {
                setTime(start);
                setPlaying(true);
              }}
            />
            {scene.transcript.length > 0 && (
              <div className="row">
                <button
                  className="text-button"
                  onClick={() =>
                    download(
                      scene.transcript
                        .map((t) => `${t.name}: ${t.text}`)
                        .join("\n\n"),
                      "scene-dialogue.txt",
                      "text/plain",
                    )
                  }
                >
                  <Download size={14} /> Save dialogue
                </button>
                <button
                  className="text-button"
                  disabled={!dialogueClips.size}
                  onClick={() =>
                    download(
                      dialogueSubtitles(scene),
                      "scene-dialogue.srt",
                      "text/plain",
                    )
                  }
                >
                  <Download size={14} />
                  Save subtitles
                </button>
              </div>
            )}
          </div>
        </ConversationAside>
        <StudioAside
          open={panel}
          active={rightTab}
          onSelect={(tab) => {
            setRightTab(tab);
            setPanel(true);
          }}
          onCollapse={() => setPanel(false)}
        >
          {rightTab === "code" ? (
            <CodingAssistant
              revision={connectionsRevision}
              onConnections={() => setModal("connections")}
            />
          ) : rightTab === "assistant" ? (
            <>
              <div className="assistant-settings">
                <AssistantModelMenu
                  disabled={busy}
                  revision={connectionsRevision}
                  onBusyChange={setModelSwitchBusy}
                  onConnections={() => setModal("connections")}
                />
              </div>
              <div className="assistant-heading">
                <span className="assistant-orb">
                  <Sparkles size={22} />
                </span>
                <h2>
                  Your imagination.
                  <br />
                  <span>A little company.</span>
                </h2>
                <p>
                  A creative partner for every
                  <br />
                  “what if” and “let’s try”.
                </p>
              </div>
              <div className="chat-toolbar">
                <span>Conversation</span>
                <ChatExportMenu
                  disabled={messages.length <= 1}
                  build={(format) =>
                    exportAssistantChat(messages, format, { scene: scene.name })
                  }
                  filename={(format) =>
                    exportFilename("assistant", scene.id, format, new Date())
                  }
                />
                {clearedMessages ? (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      setMessages(clearedMessages);
                      setClearedMessages(null);
                    }}
                  >
                    <Undo2 size={13} /> Undo clear
                  </button>
                ) : (
                  <button
                    className="text-button"
                    disabled={busy || messages.length <= 1}
                    title={
                      busy
                        ? "Wait for this request to finish before clearing chat"
                        : "Clear the conversation history. Scene edits stay saved."
                    }
                    onClick={() => {
                      setClearedMessages(messages);
                      setMessages([welcomeMessage]);
                      requestAnimationFrame(() =>
                        document.getElementById("assistant-prompt")?.focus(),
                      );
                    }}
                  >
                    <Trash2 size={13} /> Clear chat
                  </button>
                )}
              </div>
              {clearedMessages && (
                <p className="chat-cleared" role="status">
                  Chat cleared. Your next message starts a fresh conversation.
                </p>
              )}
              <div className="chat-messages">
                {messages.map((m, i) => (
                  <div key={i} className={`message ${m.role}`}>
                    <div className="message-byline">
                      {m.role === "assistant" ? (
                        <>
                          <Sparkles size={12} /> SCENE ASSISTANT
                        </>
                      ) : (
                        "YOU"
                      )}
                      {m.mode === "offline" && <span>OFFLINE HELPER</span>}
                    </div>
                    {m.text && <p>{m.text}</p>}
                    {m.images && (
                      <div className="message-images">
                        {m.images.map((src, j) => (
                          <img key={j} src={src} alt="Attached reference" />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {messages.length === 1 && (
                  <div className="suggestions">
                    <span>LET’S START WITH SOMETHING</span>
                    {[
                      "Import a character of my own",
                      "Have my character walk then wave",
                      "Set the scene at moonlight",
                    ].map((text, i) => (
                      <button key={text} onClick={() => ask(text)}>
                        {i === 0 ? (
                          <Box size={14} />
                        ) : i === 1 ? (
                          <Footprints size={14} />
                        ) : (
                          <Sun size={14} />
                        )}
                        <span>{text}</span>
                        <ArrowUp size={13} />
                      </button>
                    ))}
                  </div>
                )}
                {busy && (
                  <div className="thinking">
                    <LoaderCircle size={14} className="spin" /> Finding the next
                    little possibility…
                  </div>
                )}
                <div ref={chatEnd} />
              </div>
              <form
                className={`prompt-box${imageDrop.dragging ? " dragging" : ""}`}
                {...imageDrop.handlers}
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <PendingChips items={images.items} onRemove={images.remove} />
                <textarea
                  id="assistant-prompt"
                  aria-label="Ask the scene assistant"
                  placeholder="What are we creating today?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onPaste={(e) => {
                    const files = pastedFiles(e);
                    if (!files.length) return;
                    e.preventDefault();
                    images.add(files);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void ask();
                    }
                  }}
                />
                <div>
                  <span>
                    <Sparkles size={12} /> Imagine. Ask. Create.
                  </span>
                  <div className="prompt-actions">
                    <AttachButton
                      onFiles={images.add}
                      accept="image/*"
                      label="Attach reference images (or drop or paste them here)"
                    />
                    <button
                      aria-label="Send message"
                      disabled={
                        busy ||
                        modelSwitchBusy ||
                        images.items.some((i) => i.status === "uploading") ||
                        (!prompt.trim() && !images.items.length)
                      }
                    >
                      <ArrowUp size={17} />
                    </button>
                  </div>
                </div>
              </form>
              <p className="assistant-footnote">
                Your ideas, with room to play.
              </p>
            </>
          ) : (
            <div className="details">
              {entity ? (
                <>
                  <div className="details-title">
                    <span
                      className="object-dot"
                      style={{ background: entity.color }}
                    />
                    <input
                      aria-label="Object name"
                      value={entity.name}
                      onChange={(e) =>
                        update(
                          entity.id,
                          { name: e.target.value || "Untitled" },
                          `name:${entity.id}`,
                        )
                      }
                    />
                    <button
                      className="icon-button danger"
                      aria-label="Delete selected object"
                      onClick={() => {
                        execute([{ type: "remove", id: entity.id }]);
                        setSelected(null);
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                  <div className="detail-actions">
                    <button
                      onClick={() => {
                        const id = uid();
                        const copy = {
                          ...structuredClone(entity),
                          id,
                          name: entity.name + " copy",
                          setDressing: false,
                          position: [
                            entity.position[0] + 0.6,
                            entity.position[1],
                            entity.position[2] + 0.6,
                          ] as Entity["position"],
                        };
                        change({
                          ...sceneRef.current,
                          entities: [...sceneRef.current.entities, copy],
                        });
                        setSelected(id);
                      }}
                    >
                      <Copy size={14} /> Duplicate
                    </button>
                    <button
                      onClick={() =>
                        update(entity.id, { visible: !entity.visible })
                      }
                    >
                      {entity.visible ? (
                        <EyeOff size={14} />
                      ) : (
                        <Eye size={14} />
                      )}{" "}
                      {entity.visible ? "Hide" : "Show"}
                    </button>
                  </div>
                  {entity.setDressing && (
                    <button
                      className="secondary full"
                      onClick={() => update(entity.id, { setDressing: false })}
                    >
                      Keep when switching sets
                    </button>
                  )}
                  <h3>Make it yours</h3>
                  {!selectedAsset?.url && (
                    <label className="color-label">
                      Signature color
                      <input
                        aria-label="Object color"
                        type="color"
                        value={entity.color}
                        onChange={(e) =>
                          update(entity.id, { color: e.target.value })
                        }
                      />
                    </label>
                  )}
                  <label>
                    Position
                    <div className="coordinates">
                      {["Left / right", "Up / down", "Near / far"].map(
                        (name, i) => (
                          <label key={name}>
                            <span>{name}</span>
                            <input
                              aria-label={name}
                              type="number"
                              step=".1"
                              value={entity.position[i]}
                              onChange={(e) => {
                                const pos = [
                                  ...entity.position,
                                ] as Entity["position"];
                                pos[i] = Number(e.target.value);
                                update(entity.id, { position: pos });
                              }}
                            />
                          </label>
                        ),
                      )}
                    </div>
                  </label>
                  <label>
                    Facing{" "}
                    <span>
                      {Math.round((entity.rotation * 180) / Math.PI)}°
                    </span>
                    <input
                      aria-label="Facing"
                      type="range"
                      min={-Math.PI}
                      max={Math.PI}
                      step=".05"
                      value={entity.rotation}
                      onChange={(e) =>
                        update(entity.id, {
                          rotation: Number(e.target.value),
                        })
                      }
                    />
                  </label>
                  <label>
                    Size <span>{entity.scale.toFixed(1)}×</span>
                    <input
                      aria-label="Size"
                      type="range"
                      min=".1"
                      max="10"
                      step=".1"
                      value={entity.scale}
                      onChange={(e) =>
                        update(entity.id, { scale: Number(e.target.value) })
                      }
                    />
                  </label>
                  {isCharacter && (
                    <>
                      {selectedAsset?.url &&
                        scene.customAssets.some(
                          (asset) => asset.id === selectedAsset.id,
                        ) && (
                          <RigMappingEditor
                            asset={selectedAsset}
                            onSave={(rigMapping) => {
                              const current = sceneRef.current;
                              change({
                                ...current,
                                customAssets: current.customAssets.map(
                                  (asset) =>
                                    asset.id === selectedAsset.id
                                      ? { ...asset, rigMapping }
                                      : asset,
                                ),
                              });
                            }}
                          />
                        )}
                      <h3>Their mind</h3>
                      <p className="muted small">
                        Which AI speaks for {entity.name} in conversations. Any
                        connected provider and model, saved with the scene.
                      </p>
                      <CharacterModelPicker
                        entity={entity}
                        revision={connectionsRevision}
                        disabled={busy || !!castProgress}
                        onChange={(changes) => update(entity.id, changes)}
                        onConnections={() => setModal("connections")}
                      />
                      <h3>A little personality</h3>
                      <p className="muted small">
                        Who are they? What do they want? Give your character a
                        point of view.
                      </p>
                      <textarea
                        aria-label="Character personality"
                        rows={4}
                        value={entity.personality}
                        onChange={(e) =>
                          update(
                            entity.id,
                            { personality: e.target.value },
                            `personality:${entity.id}`,
                          )
                        }
                      />
                      <button
                        className="secondary full"
                        onClick={() => {
                          setConversationOpen((v) => !v);
                          setPanel(false);
                        }}
                      >
                        <MessageCircle size={14} /> Direct the cast
                      </button>
                      <h3>
                        Their next moves{" "}
                        <span className="count">{entity.clips.length}</span>
                        {entity.clips.length > 0 && (
                          <button
                            className="text-button clear-clips"
                            title="Remove every action from this character. Undo restores them."
                            onClick={() =>
                              execute([
                                {
                                  type: "update",
                                  id: entity.id,
                                  changes: { clips: [] },
                                },
                              ])
                            }
                          >
                            Remove all actions
                          </button>
                        )}
                      </h3>
                      <div className="clip-list">
                        {entity.clips.map((c, i) => {
                          const motion = allMotions(scene).find(
                            (m) => m.id === c.motionId,
                          );
                          return (
                            <div className="clip-editor" key={c.id}>
                              <div>
                                <span className="clip-number">
                                  {String(i + 1).padStart(2, "0")}
                                </span>
                                <strong>
                                  {c.routeWait
                                    ? "Wait for clear route"
                                    : motion?.name}
                                </strong>
                                <button
                                  aria-label={`Remove action ${i + 1}`}
                                  className="icon-button"
                                  onClick={() =>
                                    execute([
                                      {
                                        type: "removeClip",
                                        id: entity.id,
                                        clipId: c.id,
                                      },
                                    ])
                                  }
                                >
                                  <X size={13} />
                                </button>
                              </div>
                              <div className="clip-controls">
                                <button
                                  aria-label={`Move action ${i + 1} earlier`}
                                  disabled={i === 0}
                                  onClick={() =>
                                    execute([
                                      {
                                        type: "reorderClip",
                                        id: entity.id,
                                        clipId: c.id,
                                        direction: "earlier",
                                      },
                                    ])
                                  }
                                >
                                  <ArrowLeft size={12} />
                                </button>
                                <button
                                  aria-label={`Move action ${i + 1} later`}
                                  disabled={i === entity.clips.length - 1}
                                  onClick={() =>
                                    execute([
                                      {
                                        type: "reorderClip",
                                        id: entity.id,
                                        clipId: c.id,
                                        direction: "later",
                                      },
                                    ])
                                  }
                                >
                                  <ArrowRight size={12} />
                                </button>
                                <input
                                  aria-label={`Action ${i + 1} duration`}
                                  type="number"
                                  min={Math.max(0.2, c.routeStop ?? 0)}
                                  max="60"
                                  step=".2"
                                  value={c.duration}
                                  onChange={(e) => {
                                    const seconds = Number(e.target.value);
                                    const active = routeActiveDuration(c);
                                    if (
                                      seconds >=
                                        Math.max(0.2, c.routeStop ?? 0) &&
                                      seconds <= 60
                                    )
                                      update(entity.id, {
                                        clips: entity.clips.map((x) =>
                                          x.id === c.id
                                            ? {
                                                ...x,
                                                duration: seconds,
                                                ...(x.routeStop !== undefined &&
                                                motion?.path
                                                  ? {
                                                      routeActive: active,
                                                      routeHold:
                                                        seconds > active
                                                          ? seconds - active
                                                          : undefined,
                                                    }
                                                  : {}),
                                              }
                                            : x,
                                        ),
                                      });
                                  }}
                                />
                                <span>sec</span>
                              </div>
                              {motion?.kind === "imported" && !c.routeWait && (
                                <ImportedClipTiming
                                  clip={c}
                                  motion={motion}
                                  index={i}
                                  onChange={(changes) =>
                                    update(entity.id, {
                                      clips: entity.clips.map((clip) =>
                                        clip.id === c.id
                                          ? { ...clip, ...changes }
                                          : clip,
                                      ),
                                    })
                                  }
                                />
                              )}
                              {i > 0 &&
                                !c.routeWait &&
                                !contactAction(scene, c) &&
                                !contactAction(scene, entity.clips[i - 1]) && (
                                  <label className="clip-transition">
                                    Into this action
                                    <select
                                      aria-label={`Action ${i + 1} transition`}
                                      value={c.transition || "cut"}
                                      onChange={(event) =>
                                        update(entity.id, {
                                          clips: entity.clips.map((clip) =>
                                            clip.id === c.id
                                              ? {
                                                  ...clip,
                                                  transition: event.target
                                                    .value as "smooth" | "cut",
                                                }
                                              : clip,
                                          ),
                                        })
                                      }
                                    >
                                      <option value="smooth">Smooth</option>
                                      <option value="cut">Cut</option>
                                    </select>
                                  </label>
                                )}
                              {!c.routeWait &&
                                allMotions(scene).find(
                                  (m) => m.id === c.motionId,
                                )?.path && (
                                  <button
                                    className="text-button"
                                    onClick={() =>
                                      void openPathEditor(
                                        entity.id,
                                        c.id,
                                      ).catch((e) => report(e.message))
                                    }
                                  >
                                    <Footprints size={13} /> Edit path
                                  </button>
                                )}
                              {[
                                "sip",
                                "pick",
                                "place",
                                "climb",
                                "sit",
                              ].includes(
                                allMotions(scene).find(
                                  (m) => m.id === c.motionId,
                                )?.kind || "",
                              ) && (
                                <select
                                  aria-label={`Action ${i + 1} prop`}
                                  value={c.targetId || ""}
                                  onChange={(event) =>
                                    update(entity.id, {
                                      clips: entity.clips.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              targetId:
                                                event.target.value || undefined,
                                            }
                                          : x,
                                      ),
                                    })
                                  }
                                >
                                  <option value="">
                                    {allMotions(scene).find(
                                      (m) => m.id === c.motionId,
                                    )?.role === "climb"
                                      ? "Choose a ladder…"
                                      : allMotions(scene).find(
                                            (m) => m.id === c.motionId,
                                          )?.role === "sit"
                                        ? "Choose a seat…"
                                        : "Choose a prop…"}
                                  </option>
                                  {scene.entities
                                    .filter((e) => {
                                      const asset = allAssets(scene).find(
                                        (a) => a.id === e.assetId,
                                      );
                                      return (
                                        asset?.category === "props" &&
                                        (allMotions(scene).find(
                                          (m) => m.id === c.motionId,
                                        )?.role !== "climb" ||
                                          ladderProfile(asset)) &&
                                        (allMotions(scene).find(
                                          (m) => m.id === c.motionId,
                                        )?.role !== "sit" ||
                                          seatProfile(asset))
                                      );
                                    })
                                    .map((e) => (
                                      <option value={e.id} key={e.id}>
                                        {e.name}
                                      </option>
                                    ))}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {entity.clips.length > 0 &&
                        !contactAction(scene, entity.clips.at(-1)!) && (
                          <label className="sequence-ending">
                            After the last action
                            <select
                              aria-label="After the last action"
                              value={entity.ending || "rest"}
                              onChange={(event) =>
                                update(entity.id, {
                                  ending: event.target.value as "hold" | "rest",
                                })
                              }
                            >
                              <option value="hold">Hold the final pose</option>
                              <option value="rest">Return to neutral</option>
                            </select>
                          </label>
                        )}
                      <button
                        className="dashed-button"
                        onClick={() => setTab("motions")}
                      >
                        <Plus size={14} /> Add an action
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="empty-details">
                  <Move size={26} />
                  <h3>A world of possibilities</h3>
                  <p>Select something in the scene to make it your own.</p>
                </div>
              )}
            </div>
          )}
        </StudioAside>
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" />
          <button
            className="studio-version"
            aria-label={`App version ${studioVersion}. Open version and updates`}
            title="Version and updates"
            onClick={() => setModal("settings")}
          >
            v{studioVersion} · build {studioBuild}
          </button>
        </span>
        <span>Made for the stories only you can tell.</span>
        <button onClick={() => setModal("settings")}>
          Studio guide <ChevronRight size={12} />
        </button>
      </footer>
      {error && !modal && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <input
        ref={fileInput}
        hidden
        type="file"
        accept=".json,.zip"
        onChange={(e) => {
          if (e.target.files?.[0]) void importProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <input
        ref={assetInput}
        hidden
        type="file"
        accept=".glb,.fbx,.bvh,.vrm"
        onChange={(e) => {
          if (e.target.files?.[0]) void importAsset(e.target.files[0]);
          e.target.value = "";
        }}
      />
      {previewAction && (
        <ActionPreview
          key={`${previewAction.motion.id}:${previewAction.actorId || "sample"}`}
          scene={previewAction.source}
          motion={previewAction.motion}
          actorId={previewAction.actorId}
          onClose={() => setPreviewAction(null)}
          onAdd={
            previewAction.actorId
              ? () => {
                  addMotion(previewAction.motion, previewAction.actorId);
                  setPreviewAction(null);
                }
              : undefined
          }
        />
      )}
      {modal === "path" && pathEdit && (
        <PathEditor
          scene={scene}
          actor={pathEdit.actor}
          frame={pathEdit.frame}
          footprints={pathEdit.footprints}
          onPlan={(targetId, movement, locomotion, measuredCycle) => {
            if (sameContent(sceneRef.current) !== pathEdit.content)
              throw Error(
                "The scene changed. Close this route and open it again.",
              );
            return viewport.current!.planRoute(
              pathEdit.actorId,
              targetId,
              movement,
              pathEdit.clipId,
              locomotion,
              measuredCycle,
            );
          }}
          speechDuration={
            pathEdit.dialogueClip
              ? (() => {
                  const clip = pathEdit.actor.clips.find(
                    (c) => c.id === pathEdit.clipId,
                  );
                  return clip ? routeActiveDuration(clip) : undefined;
                })()
              : undefined
          }
          motion={pathEdit.motion}
          onClose={() => setModal(null)}
          onSave={(motion, pointActions) => {
            if (sameContent(sceneRef.current) !== pathEdit.content)
              throw Error(
                "The scene changed while you were drawing. Close this path and open it again.",
              );
            const next = pathEdit.dialogueClip
              ? setDialoguePath(
                  sceneRef.current,
                  pathEdit.actorId,
                  pathEdit.clipId!,
                  motion,
                )
              : applyCommands(
                  sceneRef.current,
                  savePathCommands(
                    sceneRef.current,
                    pathEdit.actorId,
                    motion,
                    pathEdit.clipId,
                    pointActions,
                  ),
                );
            change(next);
            setSelected(pathEdit.actorId);
            const line = next.transcript.find(
              (l) =>
                l.characterId === pathEdit.actorId &&
                l.clipId === pathEdit.clipId,
            );
            setTime(line ? dialogueTiming(next, line)!.start : 0);
            if (pathEdit.dialogueClip) {
              setConversationOpen(true);
              setPanel(false);
            } else {
              setRightTab("details");
              setPanel(true);
            }
            setModal(null);
            toast(
              pathEdit.clipId ? "Path updated" : "Path added to the sequence",
            );
          }}
        />
      )}
      {modal === "settings" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Make yourself at home"
          onClose={() => setModal(null)}
        >
          <div className="settings-content">
            <p className="muted">
              Your ideas belong here. Everything you need to get your story
              moving is just a few clicks away.
            </p>
            <UpdateCheck />
            <label className="settings-card">
              <input
                type="checkbox"
                checked={scene.animationCollisions !== false}
                onChange={(event) =>
                  change(
                    applyCommands(sceneRef.current, [
                      {
                        type: "scene",
                        changes: { animationCollisions: event.target.checked },
                      },
                    ]),
                  )
                }
              />
              <span>
                <strong>Animation collision detection</strong>
                <small>
                  Check characters, props, and the set for overlaps during
                  playback.
                </small>
              </span>
            </label>
            <button
              className="settings-card"
              onClick={() => setModal("connections")}
            >
              <Settings2 size={22} />
              <span>
                <strong>Connections & advanced settings</strong>
                <small>Creative tools, AI providers, and character minds</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <button
              className="settings-card"
              onClick={() => {
                setModal(null);
                void openProjects();
              }}
            >
              <FolderOpen size={22} />
              <span>
                <strong>Your projects</strong>
                <small>Pick up a story or start something new</small>
              </span>
              <ChevronRight size={18} />
            </button>
            <div className="guide">
              <h3>A quick tour</h3>
              <p>
                <b>1.</b> Click a character, prop, or set in the library to add
                it.
              </p>
              <p>
                <b>2.</b> Select a character and add actions. They play in
                sequence.
              </p>
              <p>
                <b>3.</b> Give your cast personalities and a shared direction.
              </p>
              <p>
                <b>4.</b> Ask the assistant for changes, then export your scene.
              </p>
              <p className="small muted">
                Drag to orbit · Scroll to zoom · Space to play · Ctrl/Cmd + Z to
                undo
              </p>
            </div>
          </div>
        </Modal>
      )}
      {modal === "connections" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Connections"
          onClose={() => setModal(null)}
          wide
        >
          <Connections
            onChanged={() => setConnectionsRevision((v) => v + 1)}
            revision={connectionsRevision}
            scene={scene}
            onEntity={update}
            onBack={() => setModal("settings")}
            onDone={() => {
              setModal(null);
              setRightTab("assistant");
              setPanel(true);
              requestAnimationFrame(() =>
                document.getElementById("assistant-prompt")?.focus(),
              );
            }}
            onError={report}
          />
        </Modal>
      )}
      {modal === "projects" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Stories in the making"
          onClose={() => setModal(null)}
        >
          <div className="projects">
            <button
              className="dashed-button"
              onClick={async () => {
                try {
                  await saveOrThrow();
                  const next = blankScene();
                  next.name = "Untitled story";
                  loadScene(next);
                } catch (e) {
                  report((e as Error).message);
                }
              }}
            >
              <Plus size={18} /> Start a new scene
            </button>
            {projects.map((p) => (
              <button
                className="project-card"
                key={p.id}
                onClick={async () => {
                  try {
                    await saveOrThrow();
                    loadScene(
                      validateScene(await api("/api/projects/" + p.id)),
                    );
                  } catch (e) {
                    report((e as Error).message);
                  }
                }}
              >
                <Film size={22} />
                <span>
                  <strong>{p.name}</strong>
                  <small>
                    {p.environment} · {new Date(p.updated).toLocaleDateString()}
                  </small>
                </span>
                <ChevronRight size={17} />
              </button>
            ))}
            <button
              className="secondary full"
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={15} /> Open a scene file or package
            </button>
          </div>
        </Modal>
      )}
      {modal === "clearScene" && (
        <Modal title="Clear this scene?" onClose={() => setModal(null)}>
          <div className="confirm-body">
            <p>
              This removes every character, prop, action and dialogue line from{" "}
              <strong>{scene.name}</strong> and resets the set and lighting.
              Your library assets are kept.
            </p>
            <p className="muted">
              Undo (Ctrl/Cmd+Z) brings the scene back during this session, and
              the last 20 saves stay available as previous versions.
            </p>
            <div className="row confirm-actions">
              <button className="secondary" onClick={() => setModal(null)}>
                Keep the scene
              </button>
              <button className="danger-button" onClick={clearScene} autoFocus>
                <Trash2 size={15} /> Clear scene
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "conflict" && (
        <Modal
          title="This project changed in another window"
          onClose={() => setModal(null)}
        >
          <div className="confirm-body">
            <p>
              Another window saved a newer version of{" "}
              <strong>{scene.name}</strong>, so the changes here could not be
              saved on top of it. Choose which version to continue with; nothing
              is discarded until you pick.
            </p>
            <div className="conflict-versions">
              <div>
                <h4>This window</h4>
                <small>{versionSummary(scene)}</small>
              </div>
              <div>
                <h4>Saved version</h4>
                <small>
                  {conflict ? versionSummary(conflict) : "Could not be read."}
                </small>
              </div>
            </div>
            <div className="row confirm-actions">
              <button
                className="secondary"
                onClick={() =>
                  download(
                    JSON.stringify(scene, null, 2),
                    `${scene.name}.scene.json`,
                  )
                }
              >
                <Download size={15} /> Download my version
              </button>
              <button
                className="secondary"
                disabled={!conflict}
                onClick={reloadSaved}
              >
                Reload saved version
              </button>
              <button className="primary" onClick={keepMineAsCopy} autoFocus>
                Keep mine as a copy
              </button>
            </div>
          </div>
        </Modal>
      )}
      {modal === "character" && (
        <CharacterCreator
          onClose={() => setModal(null)}
          onCreate={(asset) => {
            const id = uid();
            execute([
              { type: "createAsset", asset },
              { type: "add", id, assetId: asset.id },
            ]);
            setModal(null);
            setSelected(id);
            setTab("characters");
            setFilter("My assets");
            setSearch("");
            toast(`${asset.name} is ready for your story`);
            void viewport
              .current!.waitForScene(sceneRef.current)
              .then(() => viewport.current!.frame("front", id))
              .catch((error) => report(error.message));
          }}
        />
      )}
      {modal === "export" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Take your story with you"
          onClose={() => {
            if (!exporting) setModal(null);
          }}
        >
          <div className="export-options">
            <p className="muted">
              Keep creating, wherever your story takes you.
            </p>
            <button disabled={exporting} onClick={() => exportScene("package")}>
              <span className="export-icon">
                <Film size={23} />
              </span>
              <span>
                <strong>
                  Production package <b>RECOMMENDED</b>
                </strong>
                <small>
                  Animated 3D scene, editable project, and original assets.
                  Includes Blender and Unreal project setup.
                </small>
              </span>
              <Download size={17} />
            </button>
            <button disabled={exporting} onClick={() => exportScene("project")}>
              <span className="export-icon">
                <Layers size={23} />
              </span>
              <span>
                <strong>Editable scene</strong>
                <small>
                  A lightweight project file. Imported assets remain on this
                  computer; use a package to move them.
                </small>
              </span>
              <Download size={17} />
            </button>
            <button disabled={exporting} onClick={() => exportScene("blender")}>
              <span className="export-icon">
                <Box size={23} />
              </span>
              <span>
                <strong>Blender project</strong>
                <small>
                  Create a ready-to-open project with your local Blender
                  connection.
                </small>
              </span>
              <Download size={17} />
            </button>
            <button disabled={exporting} onClick={() => exportScene("unreal")}>
              <span className="export-icon">
                <Film size={23} />
              </span>
              <span>
                <strong>Unreal project</strong>
                <small>
                  Unpack and open in Unreal Engine. Scene setup runs on first
                  launch.
                </small>
              </span>
              <Download size={17} />
            </button>
            {exporting && (
              <div className="thinking">
                <LoaderCircle className="spin" size={17} /> Preparing your
                scene. This can take a moment…
              </div>
            )}
          </div>
        </Modal>
      )}
      {modal === "generate" && (
        <Modal
          wide
          error={error}
          onDismissError={() => setError("")}
          title="Make something new"
          onClose={() => setModal(null)}
        >
          <GenerateAsset
            selected={(() => {
              const entity = scene.entities.find((e) => e.id === selected);
              const asset =
                entity && allAssets(scene).find((a) => a.id === entity.assetId);
              return asset && asset.category === "characters"
                ? { name: asset.name, url: asset.url }
                : undefined;
            })()}
            onPlace={placeGeneratedAsset}
            onImported={placeImportedModel}
            report={report}
          />
        </Modal>
      )}
      {modal === "import" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Bring your world along"
          onClose={() => setModal(null)}
        >
          <div className="import-content">
            <p className="muted">
              Bring in your own characters and props, including characters from
              Mixamo and VRoid, and BVH motion capture. Choose a GLB, FBX, VRM
              or BVH file, up to 100 MB.
            </p>
            <label>
              This asset is a…
              <select
                value={importCategory}
                onChange={(e) =>
                  setImportCategory(e.target.value as typeof importCategory)
                }
              >
                <option value="characters">Character</option>
                <option value="props">Prop</option>
              </select>
            </label>
            <button
              disabled={busy}
              className="upload-zone"
              onClick={() => assetInput.current?.click()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={32} />
              ) : (
                <Upload size={32} />
              )}
              <strong>
                {busy ? "Getting your asset ready…" : "Choose an asset"}
              </strong>
              <span>
                GLB, FBX, VRM or BVH · Your files stay on your computer
              </span>
            </button>
            <p className="small muted">
              FBX imports need a connected Blender installation. Set it up in
              Studio settings → Connections. Original animations come with your
              character. Studio actions adapt automatically when we can
              recognize its body. Select another character to reuse an imported
              action from the Actions library; compatible humanoid motions adapt
              to their body.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
