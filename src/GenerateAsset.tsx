import { useEffect, useRef, useState } from "react";
import {
  Download,
  ExternalLink,
  LoaderCircle,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Asset } from "../shared/scene";

type Job = {
  id: string;
  status:
    | "queued"
    | "generating"
    | "texturing"
    | "preparing"
    | "done"
    | "failed"
    | "cancelled";
  progress: number;
  message: string;
  request: { prompt: string; category: "characters" | "props" };
  asset?: Asset;
  fbx?: string;
  quality?: "untextured-unrigged";
  reference?: string;
  error?: string;
};
type DownloadFile = {
  token: string;
  name: string;
  size: number;
  modified: number;
  settled: boolean;
};
export type ImportedModel = {
  url: string;
  name: string;
  animations: { name: string; duration: number }[];
};

const ACTIVE = new Set(["queued", "generating", "texturing", "preparing"]);

/** Generate characters/props with an AI 3D service and rig them through Mixamo. */
export function GenerateAsset({
  selected,
  onPlace,
  onImported,
  report,
}: {
  /** The selected character, if any, so it can be sent to Mixamo for rigging. */
  selected?: { name: string; url?: string };
  onPlace: (asset: Asset) => void;
  onImported: (model: ImportedModel, category: "characters" | "props") => void;
  report: (message: string) => void;
}) {
  const [tab, setTab] = useState<"generate" | "mixamo">("generate");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [providers, setProviders] = useState({ meshy: false, local: false });
  const [provider, setProvider] = useState<"meshy" | "local">("meshy");
  const [localTerms, setLocalTerms] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState<"characters" | "props">(
    "characters",
  );
  const [size, setSize] = useState("");
  const [quick, setQuick] = useState(false);
  const [starting, setStarting] = useState(false);
  // Mixamo round trip
  const [fbx, setFbx] = useState<{ url: string; label: string } | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [watching, setWatching] = useState<string | null>(null);
  const [files, setFiles] = useState<DownloadFile[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const r = await api<{
        configured: boolean;
        providers: { meshy: boolean; local: boolean };
        jobs: Job[];
      }>("/api/generate");
      setConfigured(r.configured);
      setProviders(r.providers);
      setProvider((previous) =>
        !r.providers.meshy && r.providers.local ? "local" : previous,
      );
      setJobs(r.jobs);
    } catch (e) {
      report((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const active = jobs.some((j) => ACTIVE.has(j.status));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void refresh(), 2500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  useEffect(() => {
    if (!watching) return;
    const poll = async () => {
      try {
        const r = await api<{ files: DownloadFile[] }>("/api/mixamo/downloads");
        setFiles(r.files);
      } catch (e) {
        report((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watching]);

  async function start() {
    setStarting(true);
    try {
      const meters = Number(size);
      const job = await api<Job>("/api/generate", {
        method: "POST",
        body: JSON.stringify({
          prompt,
          provider,
          category,
          ...(size && meters > 0 ? { size: meters } : {}),
          quick,
        }),
      });
      setJobs((list) => [job, ...list]);
      setPrompt("");
    } catch (e) {
      report((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function prepareSelected() {
    if (!selected?.url) return;
    setPreparing(true);
    try {
      const r = await api<{ url: string }>("/api/mixamo/prepare", {
        method: "POST",
        body: JSON.stringify({ url: selected.url }),
      });
      setFbx({ url: r.url, label: selected.name });
    } catch (e) {
      report((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  async function openMixamo() {
    // Open during the user gesture so popup blockers do not discard it after await.
    window.open("https://www.mixamo.com/", "_blank", "noopener");
    try {
      const r = await api<{ directory: string }>("/api/mixamo/watch", {
        method: "POST",
      });
      setWatching(r.directory);
      setFiles([]);
      setPicked([]);
    } catch (e) {
      report((e as Error).message);
    }
  }
  async function importPicked() {
    setImporting(true);
    try {
      const r = await api<ImportedModel>("/api/mixamo/import", {
        method: "POST",
        body: JSON.stringify({ files: picked }),
      });
      onImported(r, "characters");
    } catch (e) {
      report((e as Error).message);
    } finally {
      setImporting(false);
    }
  }
  async function uploadFiles(list: FileList) {
    setImporting(true);
    try {
      const data = new FormData();
      for (const f of Array.from(list)) data.append("files", f);
      const r = await api<ImportedModel>("/api/mixamo/upload", {
        method: "POST",
        body: data,
      });
      onImported(r, "characters");
    } catch (e) {
      report((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="import-content generate">
      <div className="provider-tabs" role="group" aria-label="Creation method">
        <button
          className={tab === "generate" ? "active" : ""}
          onClick={() => setTab("generate")}
        >
          <Sparkles size={14} /> Generate with AI
        </button>
        <button
          className={tab === "mixamo" ? "active" : ""}
          onClick={() => setTab("mixamo")}
        >
          <Wand2 size={14} /> Rig &amp; animate with Mixamo
        </button>
      </div>
      {tab === "generate" && (
        <>
          <p className="muted">
            Describe a character or prop. The generator creates its shape (and
            textures, when supported), then Blender cleans it up to studio
            scale. Characters are requested in a T-pose; inspect their anatomy
            before sending them to Mixamo.
          </p>
          {configured === false && (
            <p className="small warning">
              Add a Meshy API key under Studio settings → Connections → 3D
              generation first.
            </p>
          )}
          <label>
            3D generator
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "meshy" | "local")}
            >
              <option value="meshy" disabled={!providers.meshy}>
                Meshy · textured models · paid credits
              </option>
              <option value="local" disabled={!providers.local}>
                Local SDXL + Hunyuan3D · untextured shapes · GPU
              </option>
            </select>
          </label>
          {provider === "local" && (
            <div className="warning small">
              <p>
                Local generation makes geometry, not textures or a rig. The
                preview shows the actual mesh, not the AI reference photo.
                Cached model weights and a CUDA runtime must already be
                installed.
              </p>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={localTerms}
                  onChange={(e) => setLocalTerms(e.target.checked)}
                />
                I have reviewed the{" "}
                <a
                  href="https://huggingface.co/tencent/Hunyuan3D-2/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                >
                  Hunyuan3D terms
                </a>
                , including EU, UK and South Korea exclusions. Review-only
                assets are not automatically cleared for redistribution.
              </label>
            </div>
          )}
          <label>
            Description
            <textarea
              rows={3}
              value={prompt}
              placeholder={
                category === "characters"
                  ? "A tired middle-aged detective in a rumpled trench coat"
                  : "A vintage brass desk lamp with a green glass shade"
              }
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          <div className="row">
            <label>
              This is a…
              <select
                value={category}
                onChange={(e) =>
                  setCategory(e.target.value as "characters" | "props")
                }
              >
                <option value="characters">Character</option>
                <option value="props">Prop</option>
              </select>
            </label>
            <label>
              {category === "characters" ? "Height (m)" : "Longest side (m)"}
              <input
                type="number"
                step="0.05"
                min="0.05"
                max="20"
                value={size}
                placeholder={category === "characters" ? "1.75" : "1.0"}
                onChange={(e) => setSize(e.target.value)}
              />
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={quick || provider === "local"}
                disabled={provider === "local"}
                onChange={(e) => setQuick(e.target.checked)}
              />
              Quick draft (no textures)
            </label>
          </div>
          <button
            className="primary"
            disabled={
              starting ||
              prompt.trim().length < 3 ||
              configured === false ||
              (provider === "local" && !localTerms)
            }
            onClick={() => void start()}
          >
            {starting ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Sparkles size={15} />
            )}{" "}
            Generate
          </button>
          {jobs.length > 0 && (
            <ul className="generation-list">
              {jobs.map((job) => (
                <li key={job.id} className={"generation " + job.status}>
                  <div className="generation-head">
                    {job.asset?.thumbnail ? (
                      <img src={job.asset.thumbnail} alt="" />
                    ) : (
                      <span className="generation-icon">
                        {ACTIVE.has(job.status) ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Sparkles size={16} />
                        )}
                      </span>
                    )}
                    <div>
                      <strong>{job.asset?.name || job.request.prompt}</strong>
                      <small className="muted">
                        {job.request.category === "characters"
                          ? "Character"
                          : "Prop"}{" "}
                        · {job.message}
                      </small>
                    </div>
                    {ACTIVE.has(job.status) && (
                      <button
                        className="icon"
                        title="Cancel"
                        onClick={() =>
                          void api("/api/generate/" + job.id, {
                            method: "DELETE",
                          }).then(refresh)
                        }
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {ACTIVE.has(job.status) && (
                    <progress max={100} value={job.progress} />
                  )}
                  {job.status === "done" && job.asset && (
                    <div className="row">
                      <button onClick={() => onPlace(job.asset!)}>
                        Place in scene
                      </button>
                      {job.fbx && (
                        <button
                          onClick={() => {
                            setFbx({
                              url: job.fbx!,
                              label: job.asset!.name,
                            });
                            setTab("mixamo");
                          }}
                        >
                          <Wand2 size={14} /> Rig with Mixamo
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {tab === "mixamo" && (
        <>
          <p className="muted">
            Mixamo rigs a character and offers thousands of animations, but it
            has no connection for apps. This guided round trip does the rest: we
            prepare the file, you upload it on mixamo.com, and we pick up your
            downloads automatically.
          </p>
          <ol className="steps">
            <li>
              <strong>Get a Mixamo-ready file.</strong>
              <div className="row">
                {fbx ? (
                  <a className="button" href={fbx.url} download>
                    <Download size={14} /> Download {fbx.label}.fbx
                  </a>
                ) : (
                  <button
                    disabled={!selected?.url || preparing}
                    onClick={() => void prepareSelected()}
                  >
                    {preparing ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <Download size={14} />
                    )}{" "}
                    {selected?.url
                      ? `Prepare ${selected.name} for Mixamo`
                      : "Select a character in the scene first"}
                  </button>
                )}
              </div>
              <small className="muted">
                Generated characters already have one. Library characters are
                flattened to an unrigged mesh so Mixamo can rig them.
              </small>
            </li>
            <li>
              <strong>Open Mixamo and upload it.</strong>
              <div className="row">
                <button onClick={() => void openMixamo()}>
                  <ExternalLink size={14} /> Open mixamo.com
                </button>
              </div>
              <small className="muted">
                Upload Character → choose the FBX → place the markers → Next.
                Then Download with Format <b>FBX Binary</b>, Pose <b>T-pose</b>,
                Skin <b>With Skin</b>. Pick any animations and download each one
                (choose <b>In Place</b> for walks and runs; skin optional).
              </small>
            </li>
            <li>
              <strong>Bring the downloads back.</strong>
              {watching ? (
                <>
                  <small className="muted">
                    Watching <code>{watching}</code>. Tick the character
                    (downloaded With Skin) first, then its animations.
                  </small>
                  {files.length === 0 && (
                    <p className="small muted">
                      <LoaderCircle className="spin" size={12} /> Waiting for
                      new FBX files…
                    </p>
                  )}
                  <ul className="download-list">
                    {files.map((f) => (
                      <li key={f.token}>
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            disabled={!f.settled}
                            checked={picked.includes(f.token)}
                            onChange={(e) =>
                              setPicked((list) =>
                                e.target.checked
                                  ? [...list, f.token]
                                  : list.filter((t) => t !== f.token),
                              )
                            }
                          />
                          {picked.includes(f.token) && (
                            <b>{picked.indexOf(f.token) + 1}.</b>
                          )}{" "}
                          {f.name}{" "}
                          <small className="muted">
                            {f.settled
                              ? (f.size / 1024 / 1024).toFixed(1) + " MB"
                              : "downloading…"}
                          </small>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <div className="row">
                    <button
                      className="primary"
                      disabled={!picked.length || importing}
                      onClick={() => void importPicked()}
                    >
                      {importing ? (
                        <LoaderCircle className="spin" size={14} />
                      ) : (
                        <Upload size={14} />
                      )}{" "}
                      Import {picked.length || ""} file
                      {picked.length === 1 ? "" : "s"} as one character
                    </button>
                    <button
                      disabled={importing}
                      onClick={() => fileInput.current?.click()}
                    >
                      Choose files instead…
                    </button>
                  </div>
                </>
              ) : (
                <div className="row">
                  <button
                    disabled={importing}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload size={14} /> Choose downloaded FBX files…
                  </button>
                </div>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".fbx"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </li>
          </ol>
          <p className="small muted">
            The character file and every animation are combined into one rigged
            GLB. Mixamo joint names are recognized and its animations appear in
            the Actions library. Preview studio actions before production:
            sitting, foot contact and prop handling still need validation on
            real generated characters.
          </p>
        </>
      )}
    </div>
  );
}
