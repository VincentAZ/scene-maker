/**
 * AI 3D generation: text → textured mesh through the Meshy API, then a local
 * Blender cleanup pass so the result is a studio-sized, grounded, forward-facing
 * GLB (plus a Mixamo-ready FBX for characters). Jobs are tracked in memory;
 * finished files live in the uploads directory like any other import.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { assetSchema, type Asset } from "../shared/scene";
import { atomicWrite, dataDir } from "./storage";

const run = promisify(execFile);
export const MESHY_API = "https://api.meshy.ai";

export const generationRequestSchema = z.object({
  prompt: z.string().trim().min(3).max(600),
  provider: z.enum(["meshy", "local"]).default("meshy"),
  seed: z.number().int().min(0).max(4294967295).optional(),
  referenceUrl: z
    .string()
    .regex(/^\/uploads\/[a-zA-Z0-9_-]+\.png$/)
    .optional(),
  category: z.enum(["characters", "props"]),
  name: z.string().trim().min(1).max(100).optional(),
  /** Character height or the prop's longest side, in meters. */
  size: z.number().min(0.05).max(20).optional(),
  /** Skip the refine (texturing) stage: quicker, untextured preview only. */
  quick: z.boolean().optional(),
});
export type GenerationRequest = z.infer<typeof generationRequestSchema>;

export type GenerationStatus =
  | "queued"
  | "generating"
  | "texturing"
  | "preparing"
  | "done"
  | "failed"
  | "cancelled";

export type GenerationJob = {
  id: string;
  status: GenerationStatus;
  /** 0–100 across all stages. */
  progress: number;
  message: string;
  request: GenerationRequest;
  createdAt: number;
  finishedAt?: number;
  asset?: Asset;
  /** Mixamo-ready FBX of the cleaned mesh (characters only). */
  fbx?: string;
  stats?: Record<string, unknown>;
  provenance?: {
    service: "meshy" | "local-hunyuan";
    taskIds: string[];
    prompt: string;
  };
  reference?: string;
  quality?: "untextured-unrigged";
  error?: string;
};

type MeshyTask = {
  id: string;
  status: "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";
  progress?: number;
  model_urls?: { glb?: string };
  thumbnail_url?: string;
  task_error?: { message?: string };
};

export type GenerationDeps = {
  config: () => { blender: string; generation?: { meshy?: { key: string } } };
  fetch?: typeof fetch;
  /** Polling interval in ms; tests shrink it. */
  pollInterval?: number;
  uploads?: string;
  local?: { python: string; root: string };
};

/** Prompt guidance so generators return rig-friendly, studio-ready meshes. */
export function buildPrompt(
  request: Pick<GenerationRequest, "prompt" | "category">,
) {
  const base = request.prompt.replace(/\s+/g, " ").trim();
  const suffix =
    request.category === "characters"
      ? `. Full body, standing upright in a T-pose with arms straight out to the sides, legs slightly apart, neutral expression, facing forward, symmetrical, realistic proportions, clean separated hands and feet, no base or pedestal.`
      : `. Single object, realistic materials, resting flat on the ground, no base, no background, no people.`;
  return base.slice(0, 600 - suffix.length) + suffix;
}

export function createGenerationService(deps: GenerationDeps) {
  const jobs = new Map<string, GenerationJob & { abort: AbortController }>();
  const fetchImpl = deps.fetch || fetch;
  const uploads = deps.uploads || path.join(dataDir, "uploads");
  const pollInterval = deps.pollInterval ?? 5000;

  const key = () => deps.config().generation?.meshy?.key || "";

  async function meshy<T>(
    route: string,
    init: RequestInit,
    signal: AbortSignal,
  ): Promise<T> {
    const response = await fetchImpl(MESHY_API + route, {
      ...init,
      signal,
      headers: {
        Authorization: "Bearer " + key(),
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        detail = JSON.parse(text).message || detail;
      } catch {
        /* plain text */
      }
      if (response.status === 401 || response.status === 403)
        throw Error(
          "The 3D generation key was rejected. Check it in Studio settings → Connections.",
        );
      if (response.status === 402)
        throw Error(
          "The 3D generation account has no credits left. Top it up to generate more.",
        );
      throw Error(
        `3D generation request failed (${response.status}): ${detail}`,
      );
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  }

  const sleep = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  async function waitForTask(
    job: GenerationJob,
    taskId: string,
    signal: AbortSignal,
    range: [number, number],
  ): Promise<MeshyTask> {
    const deadline = Date.now() + 30 * 60 * 1000;
    for (;;) {
      if (Date.now() > deadline)
        throw Error(
          "3D generation timed out after 30 minutes. Check your provider dashboard before retrying.",
        );
      const task = await meshy<MeshyTask>(
        "/openapi/v2/text-to-3d/" + taskId,
        { method: "GET" },
        signal,
      );
      const fraction = Math.min(100, Math.max(0, task.progress ?? 0)) / 100;
      job.progress = Math.round(range[0] + (range[1] - range[0]) * fraction);
      if (task.status === "SUCCEEDED") return task;
      if (task.status === "FAILED" || task.status === "CANCELED")
        throw Error(
          task.task_error?.message ||
            "The 3D generation service could not make this model. Try rewording the description.",
        );
      await sleep(pollInterval, signal);
    }
  }

  async function download(url: string, file: string, signal: AbortSignal) {
    const response = await fetchImpl(url, { signal });
    if (!response.ok)
      throw Error(
        `Could not download the generated model (${response.status}).`,
      );
    const limit = 150 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit)
      throw Error("The generated file exceeds the 150 MB import limit.");
    const reader = response.body?.getReader();
    if (!reader) throw Error("The download returned no data.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit)
          throw Error("The generated file exceeds the 150 MB import limit.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    fs.writeFileSync(file, Buffer.concat(chunks), { mode: 0o600 });
  }

  async function execute(job: GenerationJob & { abort: AbortController }) {
    const signal = job.abort.signal;
    const { request } = job;
    const taskIds: string[] = [];
    const raw = path.join(uploads, job.id + "-raw.glb"),
      spec = path.join(uploads, job.id + "-spec.json"),
      glb = path.join(uploads, job.id + ".glb"),
      fbx = path.join(uploads, job.id + ".fbx"),
      png = path.join(uploads, job.id + ".png"),
      reference = path.join(uploads, job.id + "-reference.png"),
      localProvenance = path.join(uploads, job.id + "-local-provenance.json");
    try {
      if (request.provider === "local") {
        if (!deps.local) throw Error("Local 3D generation is not installed.");
        job.status = "generating";
        job.progress = 5;
        job.message = "Generating a reference and 3D shape locally…";
        const source = request.referenceUrl
          ? path.join(uploads, path.basename(request.referenceUrl))
          : undefined;
        if (source && !fs.existsSync(source))
          throw Error("The reference image is missing.");
        atomicWrite(spec, {
          prompt: request.prompt,
          category: request.category,
          seed: request.seed ?? 39004,
          ...(source ? { reference: source } : {}),
        });
        const localSpec = deps.local;
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            localSpec.python,
            [
              path.resolve("engine/local_generate.py"),
              "--",
              spec,
              raw,
              reference,
              localProvenance,
            ],
            {
              signal,
              timeout: 45 * 60 * 1000,
              maxBuffer: 4 * 1024 * 1024,
              env: {
                ...process.env,
                SCENE_MAKER_LOCAL_3D_ROOT: path.resolve(localSpec.root),
                HF_HOME: path.resolve(localSpec.root, "hf"),
                HF_HUB_DISABLE_IMPLICIT_TOKEN: "1",
              },
            },
            (error, _stdout, stderr) => {
              if (error) {
                const detail = /ERROR ([^\n]+)/.exec(stderr)?.[1];
                reject(
                  new Error(
                    detail ||
                      "Local 3D generation failed. Check that the cached models and CUDA runtime are installed.",
                    { cause: error },
                  ),
                );
              } else resolve();
            },
          );
          let pending = "";
          child.stdout?.on("data", (chunk: Buffer) => {
            pending += chunk.toString();
            const lines = pending.split("\n");
            pending = lines.pop() || "";
            for (const line of lines) {
              if (!line.startsWith("PROGRESS ")) continue;
              try {
                const step = JSON.parse(line.slice(9)) as {
                  stage: string;
                  progress: number;
                  message: string;
                };
                job.message = step.message;
                job.progress = Math.min(
                  85,
                  Math.max(
                    5,
                    step.stage === "reference"
                      ? 5 + step.progress * 0.3
                      : 35 + step.progress * 0.5,
                  ),
                );
              } catch {
                /* Ignore non-protocol subprocess output. */
              }
            }
          });
        });
        job.reference = "/uploads/" + job.id + "-reference.png";
        job.quality = "untextured-unrigged";
      } else {
        job.status = "generating";
        job.message = "Sculpting the shape…";
        const preview = await meshy<{ result: string }>(
          "/openapi/v2/text-to-3d",
          {
            method: "POST",
            body: JSON.stringify({
              mode: "preview",
              prompt: buildPrompt(request),
              art_style: "realistic",
              topology: "triangle",
              target_polycount:
                request.category === "characters" ? 60000 : 30000,
              should_remesh: true,
              symmetry_mode: request.category === "characters" ? "on" : "auto",
            }),
          },
          signal,
        );
        taskIds.push(preview.result);
        let task = await waitForTask(job, preview.result, signal, [5, 45]);
        if (!request.quick) {
          job.status = "texturing";
          job.message = "Painting materials…";
          const refine = await meshy<{ result: string }>(
            "/openapi/v2/text-to-3d",
            {
              method: "POST",
              body: JSON.stringify({
                mode: "refine",
                preview_task_id: preview.result,
                enable_pbr: true,
              }),
            },
            signal,
          );
          taskIds.push(refine.result);
          task = await waitForTask(job, refine.result, signal, [45, 85]);
        }
        if (!task.model_urls?.glb)
          throw Error("The generation finished without a downloadable model.");
        job.status = "preparing";
        job.message = "Cleaning up in Blender…";
        await download(task.model_urls.glb, raw, signal);
        if (task.thumbnail_url) {
          try {
            await download(task.thumbnail_url, png, signal);
          } catch {
            fs.rmSync(png, { force: true });
          }
        }
      }
      job.status = "preparing";
      job.message = "Cleaning up in Blender…";
      atomicWrite(spec, {
        category: request.category,
        height: request.category === "characters" ? request.size || 1.75 : 1.75,
        maxSize: request.category === "props" ? request.size || 1 : 1,
        faceLimit: request.category === "characters" ? 30000 : 15000,
        textureSize: 2048,
      });
      const { stdout } = await run(
        deps.config().blender,
        [
          "--background",
          "--factory-startup",
          "--disable-autoexec",
          "--threads",
          "4",
          "--python-exit-code",
          "1",
          "--python",
          path.resolve("engine/prepare_generated.py"),
          "--",
          spec,
          raw,
          glb,
          fbx,
        ],
        { timeout: 300000, maxBuffer: 4 * 1024 * 1024, signal },
      );
      const stats = stdout
        .split("\n")
        .reverse()
        .find((line) => line.startsWith("STATS "));
      job.stats = stats ? JSON.parse(stats.slice(6)) : undefined;
      job.progress = 95;
      const bytes = fs.readFileSync(glb);
      if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF")
        throw Error("The cleaned model is not a valid GLB.");
      if (request.provider === "local") {
        job.message = "Rendering the actual 3D preview…";
        await run(
          deps.config().blender,
          [
            "--background",
            "--factory-startup",
            "--disable-autoexec",
            "--threads",
            "4",
            "--python-exit-code",
            "1",
            "--python",
            path.resolve("engine/generated_preview.py"),
            "--",
            glb,
            png,
          ],
          { timeout: 120000, maxBuffer: 2 * 1024 * 1024, signal },
        );
      }
      const name =
        request.name ||
        request.prompt
          .split(/[,.;]/)[0]
          .trim()
          .slice(0, 60)
          .replace(/^\w/, (c) => c.toUpperCase());
      job.asset = assetSchema.parse({
        id: "generated-" + job.id,
        name,
        category: request.category,
        style: "Generated",
        color: "#a8b89b",
        skin: "#b98a69",
        body: "masculine",
        url: "/uploads/" + job.id + ".glb",
        ...(fs.existsSync(png)
          ? { thumbnail: "/uploads/" + job.id + ".png" }
          : {}),
        description: `${job.quality ? "Untextured, unrigged local AI prototype. " : ""}Generated from: ${request.prompt.slice(0, 200)}`,
      });
      if (request.category === "characters" && fs.existsSync(fbx))
        job.fbx = "/uploads/" + job.id + ".fbx";
      job.provenance = {
        service: request.provider === "local" ? "local-hunyuan" : "meshy",
        taskIds,
        prompt: request.prompt,
      };
      job.status = "done";
      job.progress = 100;
      job.message = job.quality
        ? "Shape ready — untextured and unrigged; review required."
        : "Ready to place.";
      atomicWrite(path.join(uploads, job.id + "-generation.json"), {
        request,
        provenance: job.provenance,
        stats: job.stats,
        ...(request.provider === "local" && fs.existsSync(localProvenance)
          ? {
              modelProvenance: JSON.parse(
                fs.readFileSync(localProvenance, "utf8"),
              ),
            }
          : {}),
      });
    } catch (error) {
      const failure = error as Error & { code?: string };
      job.status = signal.aborted ? "cancelled" : "failed";
      job.error =
        failure.code === "ENOENT"
          ? "Blender is needed to prepare generated models. Set it up in Studio settings → Connections."
          : signal.aborted
            ? "Generation cancelled."
            : failure.message;
      job.message = job.error;
      for (const file of [
        glb,
        fbx,
        png,
        reference,
        localProvenance,
        reference.replace(".png", "-shape-input.png"),
      ])
        fs.rmSync(file, { force: true });
    } finally {
      job.finishedAt = Date.now();
      for (const file of [raw, spec]) fs.rmSync(file, { force: true });
    }
  }

  return {
    configured: () => Boolean(key()) || Boolean(deps.local),
    providers: () => ({ meshy: Boolean(key()), local: Boolean(deps.local) }),
    start(input: unknown): GenerationJob {
      const request = generationRequestSchema.parse(input);
      const running = [...jobs.values()].filter(
        (j) => !["done", "failed", "cancelled"].includes(j.status),
      );
      if (
        running.length >= 3 ||
        (request.provider === "local" &&
          running.some((j) => j.request.provider === "local"))
      )
        throw Error(
          "A generation is already running. Wait for it to finish before starting another GPU job.",
        );
      if (request.provider === "local" && !deps.local)
        throw Error(
          "Local 3D generation is not installed. Configure SCENE_MAKER_LOCAL_3D_ROOT with an isolated model runtime.",
        );
      if (request.provider === "meshy" && !key())
        throw Error(
          "Add a Meshy API key under Studio settings → Connections → 3D generation to generate models.",
        );
      const job: GenerationJob & { abort: AbortController } = {
        id: crypto.randomUUID(),
        status: "queued",
        progress: 0,
        message: "Waiting to start…",
        request,
        createdAt: Date.now(),
        abort: new AbortController(),
      };
      fs.mkdirSync(uploads, { recursive: true, mode: 0o700 });
      if (jobs.size >= 50) {
        const expired = [...jobs.values()].find((j) => j.finishedAt);
        if (expired) jobs.delete(expired.id);
      }
      jobs.set(job.id, job);
      void execute(job);
      return publicJob(job);
    },
    get: (id: string) => {
      const job = jobs.get(id);
      return job ? publicJob(job) : undefined;
    },
    list: () =>
      [...jobs.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map(publicJob),
    cancel(id: string) {
      const job = jobs.get(id);
      if (!job) return false;
      if (["done", "failed", "cancelled"].includes(job.status)) return true;
      job.abort.abort();
      return true;
    },
  };
}

function publicJob(job: GenerationJob & { abort: AbortController }) {
  const { abort: _abort, ...rest } = job;
  void _abort;
  return structuredClone(rest) as GenerationJob;
}
