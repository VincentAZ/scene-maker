import { studioVersion, studioBuild } from "./version";
import { CodingAssistant } from "./CodingAssistant";
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
import { motionCollections, motionDetails } from "../shared/motionLibrary";
import { CharacterCreator } from "./CharacterCreator";
import { characterCollection, libraryEntry } from "../shared/characterLibrary";
import {
  furnitureCollections,
  furnitureEntry,
} from "../shared/furnitureLibrary";
import { setLayout } from "../shared/setLayouts";
import { seatProfile, nearestSeat } from "../shared/seating";
import { ladderProfile, nearestLadder } from "../shared/ladder";
import { contactAction } from "../shared/transitions";
import { savePathCommands, type PathFrame } from "../shared/path";
import { PathEditor } from "./PathEditor";
import type { Footprint } from "../shared/navigation";
import {
  dialogueSubtitles,
  dialogueTiming,
  appendSpeech,
  setDialoguePath,
} from "../shared/conversation";
import {
  readConversationStream,
  mergeConversationTurn,
} from "./conversationStream";
import {
  CastProgress,
  DialogueTranscript,
  type CastProgressState,
} from "./Dialogue";
import { type AssistantReply, type StudioStep } from "../shared/studio";
import { runStudioPlan, StudioPlanError } from "./studioRunner";
import { ProjectSaveQueue } from "./projectSave";
import {
  type Scene,
  type Entity,
  type Asset,
  type Command,
  type Motion,
  starterScene,
  allAssets,
  allMotions,
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
import { ManualDialogue } from "./ManualDialogue";
import { ConversationAside } from "./ConversationAside";
import { StudioAside } from "./StudioAside";
import { useConversationVoice } from "./conversationVoice";
import { Viewport, type ViewportHandle } from "./Viewport";
import { AssetArt } from "./AssetArt";
import { Modal } from "./Modal";
import { Connections } from "./Connections";
import { api, download } from "./api";
type Tab = "characters" | "props" | "environments" | "motions";
const characterFilters = [
  "All",
  "Everyday",
  "Professionals",
  "Adventure",
  "Fantasy",
  "Mannequins",
  "My assets",
];
type Message = { role: "user" | "assistant"; text: string; mode?: string };
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
export default function App() {
  const [scene, setScene] = useState<Scene>(starterScene),
    [ready, setReady] = useState(false),
    [selected, setSelectedState] = useState<string | null>(null),
    [tab, setTab] = useState<Tab>("characters"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [move, setMove] = useState(false),
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
      | "conversation"
      | "path"
      | "character"
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
    saveConversationPreferences({
      choices: voiceChoices,
      rate: conversationRate,
    });
  }, [voiceChoices, conversationRate]);
  const voice = useConversationVoice(
    scene,
    playing,
    voiceEnabled,
    voiceChoices,
    conversationRate,
    setError,
  );
  const conversationController = useRef<AbortController | null>(null);
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
    history = useRef<{ past: Scene[]; future: Scene[] }>({
      past: [],
      future: [],
    }),
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
  const toast = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(""), 4000);
  };
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
      }
      return false;
    }
  }, [report]);
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
        else loaded = starterScene();
        const recovery = localStorage.getItem("scene-maker-recovery");
        if (recovery) {
          try {
            const draft = validateScene(JSON.parse(recovery));
            if (draft.id === loaded.id && draft.revision === loaded.revision)
              loaded = draft;
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
              setSaveState("Reconnect to open projects");
            }
          } else {
            setSaveState("Reconnect to open projects");
          }
        }
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
  const change = (next: Scene, fromConversation = false) => {
    next = validateScene(next);
    if (!fromConversation) cancelConversationForEdit();
    history.current.past.push(structuredClone(sceneRef.current));
    if (history.current.past.length > 60) history.current.past.shift();
    history.current.future = [];
    sceneRef.current = next;
    setScene(next);
    setHistoryVersion((v) => v + 1);
  };
  const execute = (commands: Command[]) => {
    try {
      change(applyCommands(sceneRef.current, commands));
      return true;
    } catch (e) {
      report((e as Error).message);
      return false;
    }
  };
  const undo = () => {
    const old = history.current.past.pop();
    if (!old) return;
    cancelConversationForEdit();
    history.current.future.push(sceneRef.current);
    const next = { ...old, revision: sceneRef.current.revision };
    sceneRef.current = next;
    setScene(next);
    setHistoryVersion((v) => v + 1);
  };
  const clearScene = () => {
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
      if ((e.metaKey || e.ctrlKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.code === "Space") {
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
        ? { ...motion, duration: clip!.duration }
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
        scene.transcript
          .filter((line) => line.clipId)
          .map((line) => `${line.characterId}:${line.clipId}`),
      ),
    [scene.transcript],
  );
  const update = (id: string, changes: Partial<Entity>) =>
    execute([{ type: "update", id, changes }]);
  function add(asset: Asset, position?: [number, number, number]) {
    const before = sceneRef.current.entities.length;
    if (
      !execute([
        { type: "add", assetId: asset.id, ...(position ? { position } : {}) },
      ])
    )
      return;
    if (asset.category !== "environments") {
      const added = sceneRef.current.entities[before];
      if (added) {
        setSelected(added.id);
        toast(`${asset.name} added to your scene`);
      }
    } else toast(`${asset.name} is ready`);
  }
  async function ask(text = prompt) {
    if (!text.trim() || busy || modelSwitchBusy) return;
    setPrompt("");
    setClearedMessages(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    const starting = sceneRef.current;
    try {
      const result = await api<AssistantReply>("/api/assistant", {
        method: "POST",
        body: JSON.stringify({
          scene: starting,
          prompt: text,
          selected,
          playhead: time,
          stagingFeedback: interactionWarning,
          history: messages
            .filter((m) => m.mode !== "welcome" && m.mode !== "error")
            .slice(-20)
            .map(({ role, text }) => ({ role, text })),
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
        edit: (commands) => change(applyCommands(sceneRef.current, commands)),
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
      motion.kind === "climb"
        ? nearestLadder(current.entities, allAssets(current), actor)
        : undefined;
    if (motion.kind === "climb" && !ladder) {
      toast("Add a ladder from Props, then try this action.");
      return;
    }
    const seat =
      motion.kind === "sit"
        ? nearestSeat(current, allAssets(current), actor)
        : undefined;
    if (motion.kind === "sit" && !seat) {
      toast(
        "Add a chair with a sitting surface from Props, then try this action.",
      );
      return;
    }
    const added = execute([
      {
        type: "chain",
        id: actor.id,
        motionId: motion.id,
        ...(seat ? { targetId: seat.id } : {}),
        ...(ladder ? { targetId: ladder.id } : {}),
      },
    ]);
    if (added) toast(`${motion.name} added to ${actor.name}’s sequence`);
  }
  async function performStudioStep(
    step: Exclude<
      StudioStep,
      { type: "edit" | "newProject" | "copyProject" | "openProject" | "save" }
    >,
  ) {
    if (step.type === "walkTo") {
      setPlaying(false);
      cancelConversationForEdit();
      const snapshot = sceneRef.current;
      await viewport.current!.waitForScene(snapshot);
      if (sameContent(sceneRef.current) !== sameContent(snapshot))
        throw Error(
          "The scene changed while planning. Ask for the route again.",
        );
      const motion = viewport.current!.planRoute(
        step.actorId,
        step.targetId,
        step.movement,
      );
      change(
        applyCommands(
          snapshot,
          savePathCommands(snapshot, step.actorId, motion),
        ),
      );
      setSelected(step.actorId);
      setRightTab("details");
      setPanel(true);
      return;
    }
    if (step.type === "previewAction") {
      setPlaying(false);
      setPreviewAction({
        motion: allMotions(sceneRef.current).find(
          (m) => m.id === step.motionId,
        )!,
        source: structuredClone(sceneRef.current),
        actorId: step.actorId,
      });
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
      await saveOrThrow();
      controller.signal.throwIfAborted();
      let expected = structuredClone(sceneRef.current);
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          "X-Scene-Maker": "1",
        },
        body: JSON.stringify({ scene: expected, rounds: roundCount }),
        signal: controller.signal,
      });
      await readConversationStream(response, async (event) => {
        if (event.type === "thinking")
          setCastProgress({
            name: event.name,
            characterId: event.characterId,
            completed,
            total: event.total,
            stopping: controller.signal.aborted,
          });
        if (event.type === "turn") {
          const next = mergeConversationTurn(
            sceneRef.current,
            expected,
            event.scene,
          );
          const firstTurn = completed === 0;
          change(next, true);
          expected = structuredClone(next);
          completed = event.completed;
          setCastProgress({
            name: "",
            characterId: "",
            completed,
            total: event.total,
            stopping: controller.signal.aborted,
          });
          await saveOrThrow();
          if (firstTurn && !controller.signal.aborted) {
            await viewport.current?.waitForScene(next, controller.signal);
            const start =
              dialogueTiming(next, next.transcript.at(-1)!)?.start || 0;
            setTime(start);
            setPlaying(true);
            setSelected(null);
            viewport.current?.frame("conversation", undefined, start);
          }
        }
      });
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
      setCastProgress(null);
      if (!propagate) setBusy(false);
    }
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
    setPlaying(false);
    setTime(0);
    setSelected(next.entities[0]?.id || null);
    history.current = { past: [], future: [] };
    saveBlocked.current = false;
    sceneRef.current = next;
    setScene(next);
    setModal(null);
    setHistoryVersion((v) => v + 1);
    localStorage.setItem("scene-maker-last", next.id);
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
      const data = new FormData();
      data.append("file", file);
      const result = await api<{
        url: string;
        name: string;
        animations: { name: string; duration: number }[];
      }>("/api/import", { method: "POST", body: data });
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
      };
      execute([
        { type: "createAsset", asset },
        ...result.animations
          .filter((a) => a.duration <= 60)
          .map((a) => ({
            type: "createMotion" as const,
            motion: {
              id: uid(),
              name: a.name.slice(0, 100),
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
    } catch (e) {
      report((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function exportScene(
    kind: "project" | "package" | "blender" | "unreal",
    propagate = false,
  ) {
    const snapshot = structuredClone(sceneRef.current);
    setExporting(true);
    setPlaying(false);
    try {
      if (kind === "project") {
        download(JSON.stringify(snapshot, null, 2), "scene-maker.json");
      } else {
        await viewport.current!.waitForScene(snapshot);
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
  const filtered = allAssets(scene)
    .filter(
      (a) =>
        a.category === tab &&
        (filter !== "My assets" ||
          scene.customAssets.some((c) => c.id === a.id)) &&
        (["All", "My assets"].includes(filter) ||
          (tab === "characters"
            ? characterCollection(a)
            : furnitureEntry(a)?.collection || "Essentials") === filter) &&
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
  const collectionFilters =
    tab === "characters"
      ? characterFilters
      : tab === "props"
        ? ["All", ...furnitureCollections, "Essentials", "My assets"]
        : tab === "motions"
          ? motionCollections
          : ["All", "My assets"];
  const filteredMotions = allMotions(scene).filter(
    (m) =>
      (filter === "All" ||
        (filter === "My actions"
          ? scene.customMotions.some((custom) => custom.id === m.id)
          : motionDetails(m).collection === filter)) &&
      (m.name + " " + motionDetails(m).description)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
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
        <AssistantModelMenu
          disabled={busy}
          revision={connectionsRevision}
          onBusyChange={setModelSwitchBusy}
          onConnections={() => setModal("connections")}
        />
        <div className="top-actions">
          <span
            className={`save-label ${saveState.includes("not") ? "warning" : ""}`}
            onClick={() => {
              if (saveBlocked.current) {
                saveBlocked.current = false;
                void save();
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
            <select
              className="collection-picker"
              aria-label={
                tab === "characters"
                  ? "Character collection"
                  : tab === "motions"
                    ? "Action collection"
                    : "Asset collection"
              }
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              {collectionFilters.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <div className="filters">
              {collectionFilters.map((f) => (
                <button
                  key={f}
                  className={filter === f ? "active" : ""}
                  aria-pressed={filter === f}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
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
                {tab === "motions" ? filteredMotions.length : filtered.length}
              </span>
            </div>
            {tab === "environments" && (
              <p className="set-library-note">
                Furnished sets bring editable props. Switching sets replaces
                that furniture; your cast and props you added stay.
              </p>
            )}
            {tab === "motions" ? (
              <div className="motion-library">
                {filteredMotions.map((m) => (
                  <div className="motion-card" key={m.id}>
                    <button className="motion-add" onClick={() => addMotion(m)}>
                      <span className="motion-symbol">
                        <Footprints size={18} />
                      </span>
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {Number(m.duration.toFixed(1))}s ·{" "}
                          {motionDetails(m).authored
                            ? "Authored motion"
                            : m.kind === "imported"
                              ? isCharacter
                                ? `Adapt to ${entity!.name}`
                                : "From your files"
                              : m.kind === "custom"
                                ? "Your creation"
                                : "Ready to use"}
                        </small>
                      </span>
                      <Plus size={15} />
                    </button>
                    <button
                      className="motion-preview"
                      aria-label={`Preview ${m.name}`}
                      onClick={() => {
                        setPlaying(false);
                        setPreviewAction({
                          motion: m,
                          source: structuredClone(sceneRef.current),
                          actorId: isCharacter ? entity!.id : undefined,
                        });
                      }}
                    >
                      <Play size={12} /> Preview
                    </button>
                  </div>
                ))}
                {!filteredMotions.length && (
                  <p className="empty-state">
                    No actions match. Try another collection or search.
                  </p>
                )}
              </div>
            ) : (
              <div className="asset-grid">
                {filtered.map((a) => (
                  <button
                    className="asset-card"
                    key={a.id}
                    data-asset-id={a.id}
                    title={`Drag ${a.name} into the scene, or click to add`}
                    onPointerDown={(event) =>
                      viewport.current?.startAssetDrag(a, event.nativeEvent)
                    }
                    onDragStart={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!viewport.current?.suppressAssetClick()) add(a);
                    }}
                  >
                    <div className={`asset-art ${a.category}`}>
                      <AssetArt asset={a} />
                      <span className="add-badge">
                        <Plus size={13} />
                      </span>
                      {a.url && !libraryEntry(a) && !furnitureEntry(a) && (
                        <span className="imported-badge">YOURS</span>
                      )}
                    </div>
                    <strong>{a.name}</strong>
                    <span>
                      {a.category === "characters"
                        ? a.style
                        : a.category === "environments"
                          ? setLayout(a.id)
                            ? `${setLayout(a.id)!.props.length} editable props`
                            : "Scene backdrop"
                          : seatProfile(a)
                            ? "Ready for sitting"
                            : furnitureEntry(a)?.collection || "Scene prop"}
                    </span>
                  </button>
                ))}
                {!filtered.length && (
                  <div className="empty-state">
                    No assets here yet. Try another search or import one of your
                    own.
                  </div>
                )}
              </div>
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
            <button
              className="create-asset"
              onClick={() => {
                if (tab === "characters") {
                  setModal("character");
                  return;
                }
                setRightTab("assistant");
                setPanel(true);
                setPrompt(
                  tab === "motions"
                    ? "Create a new action where the character "
                    : "Add a ",
                );
                document.getElementById("assistant-prompt")?.focus();
              }}
            >
              <Sparkles size={16} />
              <span>
                {tab === "characters"
                  ? "Create a character"
                  : "Create something new"}
                <small>
                  {tab === "characters"
                    ? "Choose a look. Make it yours."
                    : "A little imagination goes a long way"}
                </small>
              </span>
              <Plus size={14} />
            </button>
          </div>
          <button className="import-button" onClick={() => setModal("import")}>
            <Upload size={15} /> Import your own asset
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
                  execute([
                    {
                      type: "scene",
                      changes: { name: e.target.value || "Untitled scene" },
                    },
                  ])
                }
              />
              <span className="draft-label">DRAFT</span>
            </div>
            <div className="row">
              <button
                className="text-button"
                onClick={clearScene}
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
              onTime={setTime}
              thinkingId={castProgress?.characterId}
              advanceTime={voice.advance}
              onPlaybackState={voice.playbackState}
              stopAtEnd={scene.transcript.length > 0}
              onEnded={() => {
                if (!conversationController.current) setPlaying(false);
              }}
              onMove={(id, position) => update(id, { position })}
              onAdd={(assetId, position) => {
                const asset = allAssets(sceneRef.current).find(
                  (item) => item.id === assetId,
                );
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
              <span className="view-label">
                <span className="status-dot" /> LIVE PREVIEW
              </span>
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
                className={move ? "active" : ""}
                aria-label="Move selected object"
                title="Move selected object"
                onClick={() => {
                  setMove(true);
                  setPlaying(false);
                }}
              >
                <Plus size={19} />
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
                    : assets.find((a) => a.id === scene.environment)?.name}{" "}
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
                          title={`${allMotions(scene).find((m) => m.id === c.motionId)?.name} · ${Number(c.duration.toFixed(1))}s`}
                        >
                          {dialogueClips.has(`${e.id}:${c.id}`) ? (
                            <MessageCircle size={12} />
                          ) : (
                            <Footprints size={12} />
                          )}
                          {
                            allMotions(scene).find((m) => m.id === c.motionId)
                              ?.name
                          }
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
                Auto-save on
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
          voices={voice.voices}
          cast={cast}
          choices={voiceChoices}
          onChoices={setVoiceChoices}
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
            <label>
              The direction
              <textarea
                rows={3}
                value={scene.mission}
                disabled={!!castProgress}
                onChange={(e) =>
                  execute([
                    { type: "scene", changes: { mission: e.target.value } },
                  ])
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
            <ManualDialogue
              cast={cast}
              disabled={busy || !!castProgress}
              onSpeak={(id, text) => {
                const next = appendSpeech(sceneRef.current, id, {
                  dialogue: text,
                  action: "talk",
                });
                change(next);
                setTime(dialogueTiming(next, next.transcript.at(-1)!)!.start);
                setPlaying(true);
                setSelected(null);
                viewport.current?.frame("conversation");
              }}
            />
            <DialogueTranscript
              scene={scene}
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
            <CodingAssistant />
          ) : rightTab === "assistant" ? (
            <>
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
                    <p>{m.text}</p>
                  </div>
                ))}
                {messages.length === 1 && (
                  <div className="suggestions">
                    <span>LET’S START WITH SOMETHING</span>
                    {[
                      "Add a coffee cup",
                      "Have Mila walk then wave",
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
                className="prompt-box"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask();
                }}
              >
                <textarea
                  id="assistant-prompt"
                  aria-label="Ask the scene assistant"
                  placeholder="What are we creating today?"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
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
                  <button
                    aria-label="Send message"
                    disabled={busy || modelSwitchBusy || !prompt.trim()}
                  >
                    <ArrowUp size={17} />
                  </button>
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
                        update(entity.id, {
                          name: e.target.value || "Untitled",
                        })
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
                      min=".2"
                      max="3"
                      step=".1"
                      value={entity.scale}
                      onChange={(e) =>
                        update(entity.id, { scale: Number(e.target.value) })
                      }
                    />
                  </label>
                  {isCharacter && (
                    <>
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
                          update(entity.id, { personality: e.target.value })
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
                      </h3>
                      <div className="clip-list">
                        {entity.clips.map((c, i) => (
                          <div className="clip-editor" key={c.id}>
                            <div>
                              <span className="clip-number">
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <strong>
                                {
                                  allMotions(scene).find(
                                    (m) => m.id === c.motionId,
                                  )?.name
                                }
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
                                min=".2"
                                max="60"
                                step=".2"
                                value={c.duration}
                                onChange={(e) => {
                                  if (Number(e.target.value) >= 0.2)
                                    update(entity.id, {
                                      clips: entity.clips.map((x) =>
                                        x.id === c.id
                                          ? {
                                              ...x,
                                              duration: Number(e.target.value),
                                            }
                                          : x,
                                      ),
                                    });
                                }}
                              />
                              <span>sec</span>
                            </div>
                            {i > 0 &&
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
                            {allMotions(scene).find((m) => m.id === c.motionId)
                              ?.path && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  void openPathEditor(entity.id, c.id).catch(
                                    (e) => report(e.message),
                                  )
                                }
                              >
                                <Footprints size={13} /> Edit path
                              </button>
                            )}
                            {["sip", "pick", "place", "climb", "sit"].includes(
                              allMotions(scene).find((m) => m.id === c.motionId)
                                ?.kind || "",
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
                                  )?.kind === "climb"
                                    ? "Choose a ladder…"
                                    : allMotions(scene).find(
                                          (m) => m.id === c.motionId,
                                        )?.kind === "sit"
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
                                      )?.kind !== "climb" ||
                                        ladderProfile(asset)) &&
                                      (allMotions(scene).find(
                                        (m) => m.id === c.motionId,
                                      )?.kind !== "sit" ||
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
                        ))}
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
          <span
            className="studio-version"
            aria-label="App version"
            title="Build timestamp in UTC"
          >
            v{studioVersion} · build {studioBuild}
          </span>
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
        accept=".glb,.fbx"
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
          onPlan={(targetId, movement) => {
            if (sameContent(sceneRef.current) !== pathEdit.content)
              throw Error(
                "The scene changed. Close this route and open it again.",
              );
            return viewport.current!.planRoute(
              pathEdit.actorId,
              targetId,
              movement,
              pathEdit.clipId,
            );
          }}
          speechDuration={
            pathEdit.dialogueClip
              ? pathEdit.actor.clips.find((c) => c.id === pathEdit.clipId)
                  ?.duration
              : undefined
          }
          motion={pathEdit.motion}
          onClose={() => setModal(null)}
          onSave={(motion) => {
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
                  const next = starterScene();
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
              Mixamo. Choose a GLB or FBX file, up to 100 MB.
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
              <span>GLB or FBX · Your files stay on your computer</span>
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
