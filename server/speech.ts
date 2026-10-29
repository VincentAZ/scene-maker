import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Config } from "./ai";
import { dataDir, atomicWrite, readJSON } from "./storage";
import {
  openaiVoices,
  voiceChoiceId,
  type VoiceOption,
} from "../shared/voices";

const run = promisify(execFile);
export const PIPER_RELEASE =
  "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz";
export const PIPER_VOICES =
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";
const CACHE_LIMIT = 500 * 1024 * 1024;
const CATALOG_TTL = 24 * 3600 * 1000;
const ELEVENLABS_TTL = 10 * 60 * 1000;

export const synthesisSchema = z.object({
  provider: z.enum(["openai", "elevenlabs", "piper"]),
  voice: z.string().regex(/^[\w.-]{1,120}$/),
  speaker: z.number().int().min(0).max(5000).optional(),
  text: z.string().trim().min(1).max(1800),
});
export type SynthesisRequest = z.infer<typeof synthesisSchema>;
export type Alignment = { chars: string[]; starts: number[]; ends: number[] };
export type SpeechResult = {
  url: string;
  mime: string;
  alignment?: Alignment;
  cached: boolean;
};
export type Job = {
  id: string;
  kind: "engine" | "voice";
  target: string;
  status: "running" | "done" | "failed";
  message: string;
  started: number;
  finished?: number;
};
export type PiperCatalogEntry = {
  id: string;
  name: string;
  language: string;
  languageName: string;
  quality: string;
  speakers: number;
  sizeBytes: number;
  installed: boolean;
};
type PiperVoiceConfig = {
  num_speakers?: number;
  speaker_id_map?: Record<string, number>;
  language?: { code?: string; name_english?: string };
  dataset?: string;
  audio?: { quality?: string };
};
type PiperCatalogFile = Record<
  string,
  {
    key: string;
    name: string;
    language: { code: string; name_english: string };
    quality: string;
    num_speakers: number;
    files: Record<string, { size_bytes: number; md5_digest: string }>;
  }
>;

const titleCase = (s: string) =>
  s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export function createSpeechService(options: {
  config: () => Config;
  fetch?: typeof fetch;
  root?: string;
  piperBinary?: string;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const root = options.root ?? dataDir;
  const speechDir = path.join(root, "speech");
  const piperDir = path.join(root, "tools", "piper");
  const voicesDir = path.join(piperDir, "voices");
  const binary = options.piperBinary ?? path.join(piperDir, "piper", "piper");
  fs.mkdirSync(speechDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(voicesDir, { recursive: true, mode: 0o700 });
  const inflight = new Map<string, Promise<SpeechResult>>();
  const jobs = new Map<string, Job>();
  let elevenCache: { key: string; at: number; voices: VoiceOption[] } | null =
    null;

  const engineInstalled = () => {
    try {
      fs.accessSync(binary, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  };
  const installedVoiceIds = () =>
    fs
      .readdirSync(voicesDir)
      .filter(
        (f) =>
          f.endsWith(".onnx") &&
          fs.existsSync(path.join(voicesDir, f + ".json")),
      )
      .map((f) => f.slice(0, -5))
      .sort();
  const voiceConfig = (id: string): PiperVoiceConfig =>
    readJSON<PiperVoiceConfig>(path.join(voicesDir, id + ".onnx.json"), {});

  function piperVoices(): VoiceOption[] {
    const result: VoiceOption[] = [];
    for (const id of installedVoiceIds()) {
      const cfg = voiceConfig(id);
      const speakers = cfg.num_speakers || 1;
      const lang = cfg.language?.code || id.split("-")[0] || "en";
      const base = `${titleCase(id.split("-")[1] || id)} · ${cfg.language?.name_english || lang}`;
      const quality = cfg.audio?.quality ? ` · ${cfg.audio.quality}` : "";
      if (speakers <= 1) {
        result.push({
          id: `piper:${id}`,
          provider: "piper",
          voice: id,
          name: base,
          lang,
          description: `Piper${quality}`,
          local: true,
        });
        continue;
      }
      // Multi-speaker models: every speaker up to 24, otherwise an evenly
      // spaced sample so the selector stays usable (VCTK has 109, LibriTTS 904).
      const names = Object.entries(cfg.speaker_id_map || {}).sort(
        (a, b) => a[1] - b[1],
      );
      const indexes =
        speakers <= 24
          ? Array.from({ length: speakers }, (_, i) => i)
          : Array.from({ length: 16 }, (_, i) =>
              Math.floor((i * speakers) / 16),
            );
      for (const speaker of indexes) {
        const label = names.find(([, n]) => n === speaker)?.[0];
        result.push({
          id: `piper:${id}#${speaker}`,
          provider: "piper",
          voice: id,
          speaker,
          name: `${base} · ${label ? titleCase(label) : `speaker ${speaker}`}`,
          lang,
          description: `Piper${quality} · ${speakers} speakers`,
          local: true,
        });
      }
    }
    return result;
  }

  async function elevenVoices(key: string): Promise<VoiceOption[]> {
    if (
      elevenCache &&
      elevenCache.key === key &&
      Date.now() - elevenCache.at < ELEVENLABS_TTL
    )
      return elevenCache.voices;
    const voices: VoiceOption[] = [];
    let token: string | null = null;
    for (let page = 0; page < 5; page++) {
      const url = new URL("https://api.elevenlabs.io/v2/voices");
      url.searchParams.set("page_size", "100");
      url.searchParams.set("include_total_count", "false");
      if (token) url.searchParams.set("next_page_token", token);
      const response = await fetchImpl(url, {
        headers: { "xi-api-key": key },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "ElevenLabs rejected the saved API key."
            : `ElevenLabs could not list voices (${response.status}).`,
        );
      const body = (await response.json()) as {
        voices?: {
          voice_id: string;
          name: string;
          labels?: Record<string, string>;
          description?: string;
          preview_url?: string;
          category?: string;
        }[];
        has_more?: boolean;
        next_page_token?: string | null;
      };
      for (const v of body.voices || []) {
        if (!/^[\w.-]{1,120}$/.test(v.voice_id)) continue;
        const labels = v.labels || {};
        const gender =
          labels.gender === "female" || labels.gender === "male"
            ? labels.gender
            : labels.gender
              ? "neutral"
              : undefined;
        voices.push({
          id: `elevenlabs:${v.voice_id}`,
          provider: "elevenlabs",
          voice: v.voice_id,
          name: v.name,
          lang: labels.language || "multilingual",
          gender,
          description: [labels.accent, labels.age, labels.use_case, v.category]
            .filter(Boolean)
            .map((s) => titleCase(String(s)))
            .join(" · "),
          local: false,
          preview: v.preview_url,
        });
      }
      if (!body.has_more || !body.next_page_token) break;
      token = body.next_page_token;
    }
    elevenCache = { key, at: Date.now(), voices };
    return voices;
  }

  async function download(url: string, into: string, md5?: string) {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(10 * 60 * 1000),
    });
    if (!response.ok) throw Error(`Download failed (${response.status}).`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.length) throw Error("The download was empty.");
    if (md5 && crypto.createHash("md5").update(data).digest("hex") !== md5)
      throw Error("The downloaded voice did not match its checksum.");
    fs.mkdirSync(path.dirname(into), { recursive: true, mode: 0o700 });
    const temp = into + "." + crypto.randomUUID() + ".tmp";
    fs.writeFileSync(temp, data, { mode: 0o600 });
    fs.renameSync(temp, into);
    return data.length;
  }

  async function catalog(): Promise<PiperCatalogFile> {
    const file = path.join(piperDir, "voices.json");
    try {
      const stat = fs.statSync(file);
      if (Date.now() - stat.mtimeMs < CATALOG_TTL)
        return readJSON<PiperCatalogFile>(file, {});
    } catch {}
    try {
      await download(PIPER_VOICES + "voices.json", file);
    } catch (error) {
      if (fs.existsSync(file)) return readJSON<PiperCatalogFile>(file, {});
      throw Error(
        `The Piper voice list could not be downloaded. ${(error as Error).message}`,
      );
    }
    return readJSON<PiperCatalogFile>(file, {});
  }

  function startJob(
    kind: Job["kind"],
    target: string,
    work: () => Promise<void>,
  ) {
    const active = [...jobs.values()].find(
      (j) => j.status === "running" && j.kind === kind && j.target === target,
    );
    if (active) return active;
    const job: Job = {
      id: crypto.randomUUID(),
      kind,
      target,
      status: "running",
      message:
        kind === "engine"
          ? "Downloading the Piper engine…"
          : `Downloading ${target}…`,
      started: Date.now(),
    };
    jobs.set(job.id, job);
    void work().then(
      () => {
        job.status = "done";
        job.message =
          kind === "engine" ? "Piper is ready." : `${target} is installed.`;
        job.finished = Date.now();
      },
      (error: Error) => {
        job.status = "failed";
        job.message = error.message;
        job.finished = Date.now();
      },
    );
    return job;
  }

  function prune() {
    const files = fs
      .readdirSync(speechDir)
      .map((name) => {
        const file = path.join(speechDir, name);
        const stat = fs.statSync(file);
        return { file, size: stat.size, mtime: stat.mtimeMs };
      })
      .sort((a, b) => a.mtime - b.mtime);
    let total = files.reduce((n, f) => n + f.size, 0);
    for (const f of files) {
      if (total <= CACHE_LIMIT) break;
      fs.rmSync(f.file, { force: true });
      total -= f.size;
    }
  }

  async function produce(
    request: SynthesisRequest,
    key: string,
  ): Promise<SpeechResult> {
    const c = options.config();
    if (request.provider === "openai") {
      const apiKey = c.providers.openai?.key;
      if (!apiKey)
        throw Error(
          "Save an OpenAI API key in Connections to use OpenAI voices.",
        );
      if (!openaiVoices.some((v) => v.voice === request.voice))
        throw Error("That OpenAI voice is not available.");
      const response = await fetchImpl(
        "https://api.openai.com/v1/audio/speech",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o-mini-tts",
            voice: request.voice,
            input: request.text,
            response_format: "mp3",
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "OpenAI rejected the saved API key."
            : `OpenAI could not generate speech (${response.status}).`,
        );
      const file = path.join(speechDir, key + ".mp3");
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()), {
        mode: 0o600,
      });
      atomicWrite(path.join(speechDir, key + ".json"), { provider: "openai" });
      return { url: `/speech/${key}.mp3`, mime: "audio/mpeg", cached: false };
    }
    if (request.provider === "elevenlabs") {
      const apiKey = c.speech?.elevenlabs?.key;
      if (!apiKey)
        throw Error(
          "Save an ElevenLabs API key in Connections to use its voices.",
        );
      const response = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(request.voice)}/with-timestamps?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            text: request.text,
            model_id: "eleven_multilingual_v2",
          }),
          signal: AbortSignal.timeout(60000),
        },
      );
      if (!response.ok)
        throw Error(
          response.status === 401
            ? "ElevenLabs rejected the saved API key."
            : `ElevenLabs could not generate speech (${response.status}).`,
        );
      const body = (await response.json()) as {
        audio_base64: string;
        alignment?: {
          characters: string[];
          character_start_times_seconds: number[];
          character_end_times_seconds: number[];
        } | null;
      };
      if (!body.audio_base64) throw Error("ElevenLabs returned no audio.");
      const file = path.join(speechDir, key + ".mp3");
      fs.writeFileSync(file, Buffer.from(body.audio_base64, "base64"), {
        mode: 0o600,
      });
      const alignment = body.alignment
        ? {
            chars: body.alignment.characters,
            starts: body.alignment.character_start_times_seconds,
            ends: body.alignment.character_end_times_seconds,
          }
        : undefined;
      atomicWrite(path.join(speechDir, key + ".json"), {
        provider: "elevenlabs",
        alignment,
      });
      return {
        url: `/speech/${key}.mp3`,
        mime: "audio/mpeg",
        alignment,
        cached: false,
      };
    }
    // Piper: local neural engine, text on stdin, fixed arguments, no shell.
    if (!engineInstalled())
      throw Error("Install the Piper engine in Connections → Voices first.");
    if (!installedVoiceIds().includes(request.voice))
      throw Error(`The Piper voice ${request.voice} is not installed.`);
    const model = path.join(voicesDir, request.voice + ".onnx");
    const speakers = voiceConfig(request.voice).num_speakers || 1;
    if (request.speaker !== undefined && request.speaker >= speakers)
      throw Error("That speaker does not exist in this voice.");
    const file = path.join(speechDir, key + ".wav");
    await new Promise<void>((resolve, reject) => {
      const args = ["--model", model, "--output_file", file];
      if (request.speaker !== undefined)
        args.push("--speaker", String(request.speaker));
      const child = spawn(binary, args, {
        cwd: path.dirname(binary),
        stdio: ["pipe", "ignore", "pipe"],
        env: { PATH: process.env.PATH || "/usr/bin:/bin" },
      });
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(Error("Piper took too long to speak this line."));
      }, 60000);
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(Error(`Piper could not start: ${error.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(file)) resolve();
        else
          reject(
            Error(
              `Piper failed (${code}). ${stderr.trim().split("\n").pop() || ""}`.trim(),
            ),
          );
      });
      child.stdin.end(request.text.replace(/\s+/g, " ") + "\n");
    });
    atomicWrite(path.join(speechDir, key + ".json"), { provider: "piper" });
    return { url: `/speech/${key}.wav`, mime: "audio/wav", cached: false };
  }

  return {
    summary(c: Config) {
      return {
        openai: !!c.providers.openai?.key,
        elevenlabs: !!c.speech?.elevenlabs?.key,
        piper: {
          engine: engineInstalled(),
          voices: installedVoiceIds().length,
        },
      };
    },
    async voices() {
      const c = options.config();
      const result: {
        openai: VoiceOption[];
        elevenlabs: VoiceOption[];
        piper: VoiceOption[];
        piperEngine: boolean;
        errors: string[];
      } = {
        openai: c.providers.openai?.key ? openaiVoices : [],
        elevenlabs: [],
        piper: piperVoices(),
        piperEngine: engineInstalled(),
        errors: [],
      };
      if (c.speech?.elevenlabs?.key)
        try {
          result.elevenlabs = await elevenVoices(c.speech.elevenlabs.key);
        } catch (error) {
          result.errors.push((error as Error).message);
        }
      return result;
    },
    async piperCatalog(): Promise<PiperCatalogEntry[]> {
      const data = await catalog();
      const installed = new Set(installedVoiceIds());
      return Object.values(data)
        .map((v) => ({
          id: v.key,
          name: titleCase(v.name),
          language: v.language.code,
          languageName: v.language.name_english,
          quality: v.quality,
          speakers: v.num_speakers,
          sizeBytes: Object.values(v.files)
            .filter((_, i, all) => all.length)
            .reduce((n, f) => n + f.size_bytes, 0),
          installed: installed.has(v.key),
        }))
        .sort(
          (a, b) =>
            Number(b.language.startsWith("en")) -
              Number(a.language.startsWith("en")) ||
            a.language.localeCompare(b.language) ||
            a.name.localeCompare(b.name) ||
            a.quality.localeCompare(b.quality),
        );
    },
    installEngine() {
      if (engineInstalled())
        return {
          id: "",
          kind: "engine",
          target: "piper",
          status: "done",
          message: "Piper is ready.",
          started: Date.now(),
        } as Job;
      return startJob("engine", "piper", async () => {
        if (process.platform !== "linux" || process.arch !== "x64")
          throw Error("The bundled Piper build supports Linux x86_64 only.");
        const archive = path.join(piperDir, "piper.tar.gz");
        fs.mkdirSync(piperDir, { recursive: true, mode: 0o700 });
        await download(PIPER_RELEASE, archive);
        await run("tar", ["-xzf", archive, "-C", piperDir]);
        fs.rmSync(archive, { force: true });
        if (!engineInstalled())
          throw Error("The Piper archive did not contain a runnable engine.");
      });
    },
    async installVoice(id: string) {
      if (!/^[\w.-]{1,120}$/.test(id)) throw Error("Invalid voice identifier.");
      const data = await catalog();
      const entry = data[id];
      if (!entry) throw Error("That voice is not in the Piper catalogue.");
      return startJob("voice", id, async () => {
        for (const [file, meta] of Object.entries(entry.files)) {
          if (!file.endsWith(".onnx") && !file.endsWith(".onnx.json")) continue;
          const name = path.basename(file);
          await download(
            PIPER_VOICES + file,
            path.join(voicesDir, name),
            meta.md5_digest,
          );
        }
      });
    },
    removeVoice(id: string) {
      if (!/^[\w.-]{1,120}$/.test(id)) throw Error("Invalid voice identifier.");
      for (const suffix of [".onnx", ".onnx.json"])
        fs.rmSync(path.join(voicesDir, id + suffix), { force: true });
    },
    jobs(): Job[] {
      const now = Date.now();
      for (const [id, job] of jobs)
        if (job.finished && now - job.finished > 10 * 60 * 1000)
          jobs.delete(id);
      return [...jobs.values()].sort((a, b) => b.started - a.started);
    },
    cacheKey(request: SynthesisRequest) {
      return crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            request.provider,
            request.voice,
            request.speaker ?? null,
            request.text,
          ]),
        )
        .digest("hex");
    },
    async synthesize(input: unknown): Promise<SpeechResult> {
      const request = synthesisSchema.parse(input);
      const key = this.cacheKey(request);
      const ext = request.provider === "piper" ? "wav" : "mp3";
      const file = path.join(speechDir, `${key}.${ext}`);
      if (fs.existsSync(file)) {
        const now = new Date();
        fs.utimesSync(file, now, now);
        const meta = readJSON<{ alignment?: Alignment }>(
          path.join(speechDir, key + ".json"),
          {},
        );
        return {
          url: `/speech/${key}.${ext}`,
          mime: ext === "wav" ? "audio/wav" : "audio/mpeg",
          alignment: meta.alignment,
          cached: true,
        };
      }
      let pending = inflight.get(key);
      if (!pending) {
        pending = produce(request, key).finally(() => {
          inflight.delete(key);
          try {
            prune();
          } catch {}
        });
        inflight.set(key, pending);
      }
      return pending;
    },
    voiceOptionId: voiceChoiceId,
    paths: { speechDir, piperDir, voicesDir, binary },
  };
}
export type SpeechService = ReturnType<typeof createSpeechService>;
