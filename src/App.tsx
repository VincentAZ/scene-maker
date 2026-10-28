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
  SlidersHorizontal,
  Lightbulb,
  PanelRightClose,
} from "lucide-react";
import JSZip from "jszip";
import { dialogueSubtitles } from "../shared/conversation";
import {
  readConversationStream,
  mergeConversationTurn,
} from "./conversationStream";
import {
  CastProgress,
  DialogueCaptions,
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
  starterScene,
  allAssets,
  allMotions,
  applyCommands,
  duration,
  validateScene,
  uid,
  assets,
} from "../shared/scene";
import { Viewport, type ViewportHandle } from "./Viewport";
import { AssetArt } from "./AssetArt";
import { Modal } from "./Modal";
import { Connections } from "./Connections";
import { api, download } from "./api";
type Tab = "characters" | "props" | "environments" | "motions";
type Message = { role: "user" | "assistant"; text: string; mode?: string };
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
    [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<Tab>("characters"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("All"),
    [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [move, setMove] = useState(false),
    [rightTab, setRightTab] = useState<"assistant" | "details">("assistant"),
    [panel, setPanel] = useState(true),
    [modal, setModal] = useState<
      | "settings"
      | "connections"
      | "projects"
      | "export"
      | "import"
      | "conversation"
      | null
    >(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [saveState, setSaveState] = useState("Opening studio…"),
    [messages, setMessages] = useState<Message[]>([
      {
        role: "assistant",
        text: "Every great scene starts with a little “what if”. Tell me what you have in mind, and let’s make it happen.",
        mode: "welcome",
      },
    ]),
    [prompt, setPrompt] = useState(""),
    [busy, setBusy] = useState(false),
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
  const conversationController = useRef<AbortController | null>(null);
  useEffect(() => () => conversationController.current?.abort(), []);
  const viewport = useRef<ViewportHandle>(null),
    sceneRef = useRef(scene),
    history = useRef<{ past: Scene[]; future: Scene[] }>({
      past: [],
      future: [],
    }),
    saveBlocked = useRef(false),
    saveRetries = useRef(0),
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
      saveRetries.current = 0;
      return true;
    } catch (e) {
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
    } catch (e) {
      report((e as Error).message);
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
        modal
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
  }, [selected, modal, historyVersion]);
  const entity = scene.entities.find((e) => e.id === selected);
  const isCharacter =
    entity &&
    allAssets(scene).find((a) => a.id === entity.assetId)?.category ===
      "characters";
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
  function add(asset: Asset) {
    const before = sceneRef.current.entities.length;
    execute([{ type: "add", assetId: asset.id }]);
    if (asset.category !== "environments") {
      const added = sceneRef.current.entities[before];
      if (added) {
        setSelected(added.id);
        toast(`${asset.name} added to your scene`);
      }
    } else toast(`${asset.name} is ready`);
  }
  async function ask(text = prompt) {
    if (!text.trim() || busy) return;
    setPrompt("");
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
  async function performStudioStep(
    step: Exclude<
      StudioStep,
      { type: "edit" | "newProject" | "copyProject" | "openProject" | "save" }
    >,
  ) {
    if (step.type === "select") {
      setSelected(step.id);
      return;
    }
    if (step.type === "playback") {
      if (step.mode === "play") setPlaying(true);
      else {
        setPlaying(false);
        if (step.mode === "rewind") setTime(0);
        if (step.mode === "seek") setTime(step.time!);
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
      else {
        setRightTab(step.panel);
        setPanel(true);
      }
    }
  }
  function stopConversation() {
    conversationController.current?.abort();
    setCastProgress((progress) =>
      progress ? { ...progress, stopping: true } : null,
    );
  }
  async function runConversation(roundCount = rounds, propagate = false) {
    if (conversationController.current)
      throw Error("A cast conversation is already running.");
    if (!propagate && busy) return;
    if (!propagate) setBusy(true);
    setPlaying(false);
    setError("");
    const controller = new AbortController();
    conversationController.current = controller;
    let completed = 0;
    setCastProgress({
      name: "",
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
          change(next, true);
          expected = structuredClone(next);
          completed = event.completed;
          setCastProgress((progress) => ({
            name: progress?.name || "",
            completed,
            total: event.total,
            stopping: controller.signal.aborted,
          }));
          await saveOrThrow();
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
    kind: "project" | "package" | "blender",
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
          const zip = new JSZip();
          zip.file("scene.json", JSON.stringify(snapshot, null, 2));
          zip.file("scene.glb", glb);
          const subtitles = dialogueSubtitles(snapshot);
          if (subtitles) zip.file("dialogue.srt", subtitles);
          for (const a of snapshot.customAssets) {
            if (a.url) {
              const res = await fetch(a.url);
              if (!res.ok)
                throw Error(
                  `Cannot package ${a.name}. Reimport the missing asset.`,
                );
              zip.file(
                "assets/" + a.url.split("/").pop(),
                await res.arrayBuffer(),
              );
            }
          }
          for (const name of ["blender_import.py", "unreal_import.py"]) {
            const r = await fetch("/engine/" + name);
            if (!r.ok) throw Error("The engine adapter could not be loaded.");
            zip.file(name, await r.text());
          }
          zip.file(
            "README.txt",
            "Scene Maker portable scene\n\nOpen scene.glb in a compatible 3D application. It includes skeletal animation, materials and scene transforms at 24 fps.\n\nBlender: blender --background --python blender_import.py -- scene.glb scene.blend\nUnreal: enable Python Editor Script and Interchange, then run unreal_import.py from this folder using Execute Python Script. Save the imported level.\n\nReopen this ZIP in Scene Maker to restore the editable project and original assets.\n",
          );
          const packageData = await zip.generateAsync({ type: "arraybuffer" });
          const form = new FormData();
          form.append(
            "file",
            new Blob([packageData], { type: "application/zip" }),
            "scene-maker-package.zip",
          );
          const saved = await api<{ url: string }>("/api/exports", {
            method: "POST",
            body: form,
          });
          const link = document.createElement("a");
          link.href = saved.url;
          link.download = "scene-maker-package.zip";
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
  const filtered = allAssets(scene).filter(
    (a) =>
      a.category === tab &&
      (filter !== "My assets" ||
        scene.customAssets.some((c) => c.id === a.id)) &&
      (filter !== "Professionals" ||
        !["Creative", "Everyday", "Mannequin"].includes(a.style)) &&
      (a.name + " " + a.style).toLowerCase().includes(search.toLowerCase()),
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
            {tab !== "motions" && (
              <div className="filters">
                {(tab === "characters"
                  ? ["All", "Professionals", "My assets"]
                  : ["All", "My assets"]
                ).map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "active" : ""}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                  </button>
                ))}
              </div>
            )}
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
                {tab === "motions" ? allMotions(scene).length : filtered.length}
              </span>
            </div>
            {tab === "motions" ? (
              <div className="motion-library">
                {allMotions(scene)
                  .filter((m) =>
                    m.name.toLowerCase().includes(search.toLowerCase()),
                  )
                  .map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        if (!entity || !isCharacter) {
                          report("Choose a character in your scene first.");
                          return;
                        }
                        execute([
                          { type: "chain", id: entity.id, motionId: m.id },
                        ]);
                        toast(`${m.name} added to ${entity.name}’s sequence`);
                      }}
                    >
                      <span className="motion-symbol">
                        <Footprints size={18} />
                      </span>
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {m.duration}s ·{" "}
                          {m.kind === "custom"
                            ? "Your creation"
                            : "Ready to use"}
                        </small>
                      </span>
                      <Plus size={15} />
                    </button>
                  ))}
              </div>
            ) : (
              <div className="asset-grid">
                {filtered.map((a) => (
                  <button
                    className="asset-card"
                    key={a.id}
                    onClick={() => add(a)}
                  >
                    <div className={`asset-art ${a.category}`}>
                      <AssetArt asset={a} />
                      <span className="add-badge">
                        <Plus size={13} />
                      </span>
                      {a.url && <span className="imported-badge">YOURS</span>}
                    </div>
                    <strong>{a.name}</strong>
                    <span>
                      {a.category === "characters"
                        ? a.style
                        : a.category === "environments"
                          ? "Complete set"
                          : "Scene prop"}
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
            <button
              className="create-asset"
              onClick={() => {
                setRightTab("assistant");
                setPanel(true);
                setPrompt(
                  tab === "motions"
                    ? "Create a new action where the character "
                    : tab === "characters"
                      ? "Create a new character who is "
                      : "Add a ",
                );
                document.getElementById("assistant-prompt")?.focus();
              }}
            >
              <Sparkles size={16} />
              <span>
                Create something new
                <small>A little imagination goes a long way</small>
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
                onClick={() => setModal("conversation")}
              >
                <MessageCircle size={15} />
                <span>Direct the cast</span>
              </button>
              <button
                className={`icon-button ${!panel ? "active" : ""}`}
                aria-label="Toggle side panel"
                onClick={() => setPanel(!panel)}
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
              onMove={(id, position) => update(id, { position })}
              onError={report}
              move={move}
            />
            <DialogueCaptions scene={scene} time={time} />
            {castProgress && (
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
                title="Orbit view"
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
                <span className="kbd">Drag</span> to orbit{" "}
                <span className="dot-separator">·</span>
                <span className="kbd">Scroll</span> to explore
              </span>
              <span>
                {scene.environment === "cafe"
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
                  onClick={() => setPlaying(!playing)}
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
                          title={`${allMotions(scene).find((m) => m.id === c.motionId)?.name} · ${c.duration}s`}
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
        {panel && (
          <aside className="right-panel">
            <div className="right-tabs">
              <button
                className={rightTab === "assistant" ? "active" : ""}
                onClick={() => setRightTab("assistant")}
              >
                <Sparkles size={16} /> Assistant
              </button>
              <button
                className={rightTab === "details" ? "active" : ""}
                onClick={() => setRightTab("details")}
              >
                <SlidersHorizontal size={15} /> Details
              </button>
            </div>
            {rightTab === "assistant" ? (
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
                      <LoaderCircle size={14} className="spin" /> Finding the
                      next little possibility…
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
                      disabled={busy || !prompt.trim()}
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
                    <h3>Make it yours</h3>
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
                          onClick={() => setModal("conversation")}
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
                                                duration: Number(
                                                  e.target.value,
                                                ),
                                              }
                                            : x,
                                        ),
                                      });
                                  }}
                                />
                                <span>sec</span>
                              </div>
                              {["sip", "pick"].includes(
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
                                  <option value="">Choose a prop…</option>
                                  {scene.entities
                                    .filter(
                                      (e) =>
                                        allAssets(scene).find(
                                          (a) => a.id === e.assetId,
                                        )?.category === "props",
                                    )
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
          </aside>
        )}
      </div>
      <footer className="statusbar">
        <span>
          <span className="status-dot" /> Your studio is ready
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
            scene={scene}
            onEntity={update}
            onBack={() => setModal("settings")}
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
                  <br />
                  Ready for Blender and Unreal Engine.
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
                  A lightweight project file. Imported assets remain
                  <br />
                  on this computer; use a package to move them.
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
                  Create a ready-to-open project with your local
                  <br />
                  Blender connection.
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
              Studio settings → Connections. Imported character rigs should use
              Mixamo bone names for built-in actions.
            </p>
          </div>
        </Modal>
      )}
      {modal === "conversation" && (
        <Modal
          error={error}
          onDismissError={() => setError("")}
          title="Give them something to talk about"
          onClose={() => setModal(null)}
          wide
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
                disabled={busy || cast.filter((e) => e.visible).length < 2}
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
            <p className="small muted">
              Each character uses their assigned AI model. Completed turns save
              as they arrive. Preview their words as captions alongside their
              actions; audio is not generated.
            </p>
            <DialogueTranscript
              scene={scene}
              onPreview={(start) => {
                setTime(start);
                setPlaying(true);
                setModal(null);
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
        </Modal>
      )}
    </div>
  );
}
