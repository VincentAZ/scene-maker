import { useEffect, useState } from "react";
import { Check, Download, LoaderCircle, Trash2, Volume2 } from "lucide-react";
import { api } from "./api";
import type { ConnectionsData } from "./Connections";
import { previewVoice } from "./voiceCatalog";

type CatalogEntry = {
  id: string;
  name: string;
  language: string;
  languageName: string;
  quality: string;
  speakers: number;
  sizeBytes: number;
  installed: boolean;
};
type Job = {
  id: string;
  kind: "engine" | "voice";
  target: string;
  status: "running" | "done" | "failed";
  message: string;
};
const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6))} MB`;

/**
 * Voices section of Connections: ElevenLabs key, OpenAI status, and the local
 * Piper engine with its downloadable voice catalogue.
 */
export function VoicesSettings({
  data,
  onSave,
  onChanged,
  onError,
}: {
  data: ConnectionsData;
  onSave: (body: object) => Promise<void>;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [elevenKey, setElevenKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [piper, setPiper] = useState(
    data.speech?.piper ?? { engine: false, voices: 0 },
  );
  const [language, setLanguage] = useState("en");
  const [search, setSearch] = useState("");
  const running = jobs.some((j) => j.status === "running");

  async function loadCatalog() {
    try {
      const result = await api<{ voices: CatalogEntry[]; engine: boolean }>(
        "/api/speech/piper/catalog",
      );
      setCatalog(result.voices);
      setCatalogError("");
    } catch (e) {
      setCatalogError((e as Error).message);
    }
  }
  useEffect(() => {
    void loadCatalog();
  }, []);
  // Poll install jobs only while one is running.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const result = await api<{ jobs: Job[]; piper: typeof piper }>(
          "/api/speech/jobs",
        );
        setJobs(result.jobs);
        setPiper(result.piper);
        if (!result.jobs.some((j) => j.status === "running")) {
          void loadCatalog();
          onChanged();
        }
      } catch {}
    }, 1500);
    return () => clearInterval(timer);
  }, [running, onChanged]);

  const start = async (path: string, body?: object) => {
    try {
      const result = await api<{ job: Job }>(path, {
        method: "POST",
        body: JSON.stringify(body ?? {}),
      });
      setJobs((previous) => [
        result.job,
        ...previous.filter((j) => j.id !== result.job.id),
      ]);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  const languages = [
    ...new Set((catalog || []).map((v) => v.language.split("_")[0])),
  ].sort();
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const shown = (catalog || []).filter(
    (v) =>
      (language === "all" || v.language.startsWith(language)) &&
      `${v.name} ${v.language} ${v.languageName} ${v.quality}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const jobFor = (id: string) =>
    jobs.find((j) => j.target === id && j.status === "running");

  return (
    <div className="voices-settings">
      <h4>Cloud voices</h4>
      <p className="muted small">
        OpenAI voices use your saved OpenAI key
        {data.speech?.openai ? " (saved)" : " (not saved yet)"}. ElevenLabs
        needs its own key; both are billed by the provider per character
        generated. Generated lines are cached on this computer so replays are
        free.
      </p>
      <label>
        ElevenLabs API key{" "}
        {data.speech?.elevenlabs && (
          <small className="muted">· saved, paste to replace</small>
        )}
        <input
          type="password"
          autoComplete="off"
          value={elevenKey}
          placeholder={data.speech?.elevenlabs ? "Key saved" : "xi-…"}
          onChange={(e) => setElevenKey(e.target.value)}
        />
      </label>
      <div className="row">
        <button
          className="secondary"
          disabled={savingKey || !elevenKey.trim()}
          onClick={async () => {
            setSavingKey(true);
            try {
              await onSave({ elevenlabsKey: elevenKey.trim() });
              setElevenKey("");
            } catch (e) {
              onError((e as Error).message);
            } finally {
              setSavingKey(false);
            }
          }}
        >
          {savingKey ? "Saving…" : "Save ElevenLabs key"}
        </button>
        {data.speech?.elevenlabs && (
          <button
            className="text-button"
            disabled={savingKey}
            onClick={async () => {
              setSavingKey(true);
              try {
                await onSave({ elevenlabsKey: "" });
              } catch (e) {
                onError((e as Error).message);
              } finally {
                setSavingKey(false);
              }
            }}
          >
            Remove key
          </button>
        )}
      </div>

      <h4>Local voices · Piper</h4>
      <p className="muted small">
        Piper is a free neural speech engine that runs entirely on this
        computer. Install the engine once, then add any of the{" "}
        {catalog ? catalog.length : "140+"} voices in {languages.length || 40}+
        languages. Voice packs are 60 to 140 MB each.
      </p>
      <div className="row">
        {piper.engine ? (
          <span className="small" role="status">
            <Check size={13} /> Piper engine installed · {piper.voices} voice
            {piper.voices === 1 ? "" : "s"}
          </span>
        ) : (
          <button
            className="primary"
            disabled={!!jobFor("piper")}
            onClick={() => void start("/api/speech/piper/install")}
          >
            {jobFor("piper") ? (
              <>
                <LoaderCircle size={14} className="spin" /> Installing engine…
              </>
            ) : (
              <>
                <Download size={14} /> Install Piper engine (20 MB)
              </>
            )}
          </button>
        )}
      </div>
      {jobs
        .filter((j) => j.status !== "running")
        .slice(0, 3)
        .map((j) => (
          <p
            key={j.id}
            className={`small ${j.status === "failed" ? "danger" : "muted"}`}
            role="status"
          >
            {j.message}
          </p>
        ))}
      {catalogError && (
        <p className="connection-error" role="alert">
          {catalogError}{" "}
          <button className="text-button" onClick={() => void loadCatalog()}>
            Try again
          </button>
        </p>
      )}
      {catalog && (
        <>
          <div className="row voice-filters">
            <label className="inline-label">
              Language
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
              >
                <option value="en">English</option>
                <option value="all">All languages</option>
                {languages
                  .filter((l) => l !== "en")
                  .map((l) => (
                    <option key={l} value={l}>
                      {(() => {
                        try {
                          return names.of(l) || l;
                        } catch {
                          return l;
                        }
                      })()}
                    </option>
                  ))}
              </select>
            </label>
            <input
              type="search"
              aria-label="Search Piper voices"
              placeholder="Search voices…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="voice-catalog" role="list" aria-label="Piper voices">
            {shown.map((v) => {
              const job = jobFor(v.id);
              return (
                <div className="voice-row" role="listitem" key={v.id}>
                  <span>
                    <strong>{v.name}</strong>
                    <small>
                      {v.languageName} ({v.language}) · {v.quality}
                      {v.speakers > 1 ? ` · ${v.speakers} speakers` : ""} ·{" "}
                      {mb(v.sizeBytes)}
                    </small>
                  </span>
                  {v.installed ? (
                    <span className="row">
                      <button
                        className="icon-button"
                        aria-label={`Preview ${v.name}`}
                        title="Preview"
                        disabled={!piper.engine}
                        onClick={() =>
                          previewVoice(
                            `piper:${v.id}${v.speakers > 1 ? "#0" : ""}`,
                            v.name,
                            1,
                          ).catch((e) => onError((e as Error).message))
                        }
                      >
                        <Volume2 size={14} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Remove ${v.name}`}
                        title="Remove this voice"
                        onClick={async () => {
                          try {
                            await api(
                              `/api/speech/piper/voices/${encodeURIComponent(v.id)}`,
                              {
                                method: "DELETE",
                              },
                            );
                            await loadCatalog();
                            onChanged();
                          } catch (e) {
                            onError((e as Error).message);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ) : (
                    <button
                      className="secondary"
                      disabled={!!job || !piper.engine}
                      title={
                        piper.engine
                          ? "Download this voice"
                          : "Install the engine first"
                      }
                      onClick={() =>
                        void start("/api/speech/piper/voices", { id: v.id })
                      }
                    >
                      {job ? (
                        <>
                          <LoaderCircle size={13} className="spin" />{" "}
                          Installing…
                        </>
                      ) : (
                        <>
                          <Download size={13} /> Install
                        </>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
            {!shown.length && <p className="small muted">No voices match.</p>}
          </div>
        </>
      )}
    </div>
  );
}
