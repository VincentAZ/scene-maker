import { thinkingLevels, thinkingChoices } from "../shared/thinking";
import { createCodingService, codingRouter, repositoryRoot } from "./coding";
import { scheduleRestart } from "./codingDeploy";
import { runShell } from "./codingAgent";
import { codingPreview } from "./codingPreview";
import { createSpeechService } from "./speech";
import { checkForUpdates, versionInfo } from "./updates";
import { recordingsRouter } from "./recordings";
import { readStudioLibrary } from "./studioLibrary";
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  dataDir,
  atomicWrite,
  readJSON,
  projectPath,
  saveProject,
  readProject,
  listProjects,
  listHistory,
  readHistory,
} from "./storage";
import { assistant, type Config } from "./ai";
import { providerErrorMessage } from "./providerErrors";
import { listChatGPTModels, listProviderModels } from "./providerModels";
import { providerAuthRouter } from "./providerAuthRoutes";
import {
  chatGPTAccessToken,
  useChatGPTCredentialStore,
} from "./chatgptTransport";
import { revokeChatGPTSession } from "./providerAuth";
import { conversationRoute } from "./conversationRoute";
import { parseInlineImages } from "./attachments";
import {
  validateScene,
  providers,
  assetSchema,
  type Asset,
  type Scene,
} from "../shared/scene";
import { generateCharacter } from "./characters";
import { createGenerationService } from "./generation";
import { createMixamoService } from "./mixamo";
import { conversationHistorySchema } from "../shared/studio";
const run = promisify(execFile);
const configFile = path.join(dataDir, "connections.json");
const config = () =>
  readJSON<Config>(configFile, {
    providers: {},
    assistant: null,
    blender: process.env.BLENDER_PATH || "blender",
  });
const saveConfig = (c: Config) => atomicWrite(configFile, c);
// Refreshed ChatGPT tokens are saved straight back to the connections file.
useChatGPTCredentialStore({ read: config, write: saveConfig });
export const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const host = req.headers.host || "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) {
    res.status(403).json({ error: "Local access only." });
    return;
  }
  // Module scripts send an Origin header even for same-origin loads, so a
  // custom PORT must accept its own origin alongside the default ports.
  if (
    origin &&
    origin !== `http://${host}` &&
    !/^http:\/\/(127\.0\.0\.1|localhost):(5173|4311)$/.test(origin)
  ) {
    res.status(403).json({ error: "Origin not allowed." });
    return;
  }
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers["x-scene-maker"] !== "1"
  ) {
    res.status(403).json({ error: "Missing studio request header." });
    return;
  }
  next();
});
// Assistant requests may carry a few reference images next to the scene.
app.use("/api/assistant", express.json({ limit: "32mb" }));
app.use(express.json({ limit: "8mb" }));
app.use(
  "/library",
  express.static(path.resolve("public/library"), { fallthrough: false }),
);
app.use(
  "/uploads",
  express.static(path.join(dataDir, "uploads"), {
    fallthrough: false,
    setHeaders: (r) => r.setHeader("X-Content-Type-Options", "nosniff"),
  }),
);
fs.mkdirSync(path.join(dataDir, "speech"), { recursive: true, mode: 0o700 });
app.use(
  "/speech",
  express.static(path.join(dataDir, "speech"), {
    fallthrough: false,
    immutable: true,
    maxAge: "30d",
    setHeaders: (r) => r.setHeader("X-Content-Type-Options", "nosniff"),
  }),
);
app.use(
  "/engine",
  express.static(path.resolve("engine"), { fallthrough: false }),
);
fs.mkdirSync(path.join(dataDir, "exports"), { recursive: true, mode: 0o700 });
app.use(
  "/exports",
  express.static(path.join(dataDir, "exports"), {
    fallthrough: false,
    setHeaders: (r) => {
      r.setHeader("Content-Disposition", "attachment");
      r.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
);
const coding = createCodingService(config);
const speech = createSpeechService({ config });
const codePreview = codingPreview(coding);
app.use(
  "/api/coding",
  codingRouter(coding, (task) => codePreview.open(task)),
);
app.get("/api/health", (_req, res) => res.json({ ok: true }));
/**
 * Rebuild and restart the studio service. Only available when the studio was
 * launched through start.sh, which knows how to bring it back. Running coding
 * tasks are stopped first (their conversation and changes are kept) unless
 * the caller has not confirmed that.
 */
app.post("/api/restart", async (req, res) => {
  const body = z
    .object({ force: z.boolean().optional(), rebuild: z.boolean().optional() })
    .parse(req.body ?? {});
  if (process.env.SCENE_MAKER_LAUNCHER !== "start.sh") {
    res.status(409).json({
      error:
        "Restart works when Scene Maker is opened from its app icon. In development, restart the dev server in its terminal.",
    });
    return;
  }
  const running = coding.busyCount();
  if (running && !body.force) {
    res.status(409).json({
      error: `${running} coding ${running === 1 ? "task is" : "tasks are"} running.`,
      running,
    });
    return;
  }
  if (body.rebuild !== false) {
    const build = await runShell(
      repositoryRoot,
      "npm run build",
      new AbortController().signal,
      0,
    );
    if (build.exitCode !== 0) {
      res.status(500).json({
        error: `The rebuild failed, so the studio was not restarted.\n${build.output.slice(-3000)}`,
      });
      return;
    }
  }
  coding.stopAll();
  scheduleRestart(repositoryRoot, 800);
  res.json({ ok: true, restarting: true });
});
app.get("/api/version", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await versionInfo());
});
app.post("/api/update/check", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await checkForUpdates({ fetch: process.env.NODE_ENV !== "test" }));
});
app.get("/api/library", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(readStudioLibrary());
});
app.get("/api/projects", (_req, res) => res.json(listProjects()));
app.get("/api/projects/:id", (req, res) =>
  res.json(readProject(String(req.params.id))),
);
app.get("/api/projects/:id/history", (req, res) =>
  res.json(listHistory(String(req.params.id))),
);
app.get("/api/projects/:id/history/:revision", (req, res) =>
  res.json(readHistory(String(req.params.id), Number(req.params.revision))),
);
app.put("/api/projects/:id", (req, res) => {
  if (req.body.id !== req.params.id) throw Error("Project ID mismatch.");
  res.json(saveProject(req.body));
});
function connectionSummary(c: Config) {
  return {
    assistant: c.assistant,
    blender: c.blender,
    speech: speech.summary(c),
    generation: { meshy: !!c.generation?.meshy?.key },
    mcpServers: Object.fromEntries(
      Object.entries(c.mcpServers || {}).map(([name, server]) => [
        name,
        server.transport === "stdio"
          ? {
              transport: "stdio",
              command: [server.command, ...(server.args || [])].join(" "),
              env: Object.keys(server.env || {}),
            }
          : {
              transport: server.transport,
              url: server.url,
              headers: Object.keys(server.headers || {}),
            },
      ]),
    ),
    // Status only: keys, tokens and account IDs never leave the server.
    providers: Object.fromEntries(
      providers.map((p) => {
        const entry = c.providers[p];
        const chatgpt =
          entry?.method === "chatgpt" && entry.chatgpt?.refreshToken
            ? entry.chatgpt
            : undefined;
        const connected = !!entry?.key;
        return [
          p,
          {
            connected,
            model: entry?.model || "",
            thinking: entry?.thinking || "default",
            ...(connected || chatgpt
              ? {
                  method: entry?.method || "key",
                  connectedAt: entry?.connectedAt,
                  verifiedAt: entry?.verifiedAt,
                }
              : {}),
            ...(chatgpt
              ? { account: chatgpt.email, planUsage: chatgpt.planUsage }
              : {}),
          },
        ];
      }),
    ),
  };
}
app.get("/api/connections", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(connectionSummary(config()));
});
app.post("/api/connections/models", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const body = z
    .object({
      provider: z.enum(providers),
      key: z.string().trim().min(1).max(1000).optional(),
    })
    .parse(req.body);
  const saved = config().providers[body.provider];
  if (!body.key && saved?.method === "chatgpt") {
    res.json({
      models: await listChatGPTModels(await chatGPTAccessToken(config())),
    });
    return;
  }
  const key = body.key ?? saved?.key ?? "";
  res.json({ models: await listProviderModels(body.provider, key) });
});
app.use("/api/connections", providerAuthRouter({ config, save: saveConfig }));
app.put("/api/connections", (req, res) => {
  const body = z
      .object({
        provider: z.enum(providers).optional(),
        key: z.string().trim().max(1000).optional(),
        model: z.string().trim().max(200).optional(),
        thinking: z.enum(thinkingLevels).optional(),
        assistant: z.enum(providers).nullable().optional(),
        blender: z.string().min(1).max(1000).optional(),
        elevenlabsKey: z.string().trim().max(1000).optional(),
        meshyKey: z.string().trim().max(1000).optional(),
        mcpServers: z
          .record(
            z.string().trim().min(1).max(60),
            z.discriminatedUnion("transport", [
              z.object({
                transport: z.literal("stdio"),
                command: z.string().trim().min(1).max(1000),
                args: z.array(z.string().max(2000)).max(100).optional(),
                env: z.record(z.string(), z.string().max(4000)).optional(),
                cwd: z.string().max(1000).optional(),
              }),
              z.object({
                transport: z.enum(["http", "sse"]),
                url: z.string().url().max(2000),
                headers: z.record(z.string(), z.string().max(4000)).optional(),
              }),
            ]),
          )
          .optional(),
        removeMcpServer: z.string().trim().min(1).max(60).optional(),
      })
      .parse(req.body),
    c = config();
  if (body.mcpServers !== undefined)
    c.mcpServers = { ...c.mcpServers, ...body.mcpServers };
  if (body.removeMcpServer && c.mcpServers) {
    delete c.mcpServers[body.removeMcpServer];
    if (!Object.keys(c.mcpServers).length) c.mcpServers = undefined;
  }
  if (body.elevenlabsKey !== undefined)
    c.speech = {
      ...c.speech,
      ...(body.elevenlabsKey
        ? { elevenlabs: { key: body.elevenlabsKey } }
        : { elevenlabs: undefined }),
    };
  if (body.meshyKey !== undefined)
    c.generation = {
      ...c.generation,
      ...(body.meshyKey
        ? { meshy: { key: body.meshyKey } }
        : { meshy: undefined }),
    };
  if (body.provider) {
    const prev = c.providers[body.provider];
    const model = body.model ?? prev?.model ?? "";
    const thinking = body.thinking ?? prev?.thinking ?? "default";
    if (
      body.thinking &&
      !thinkingChoices(body.provider, model).includes(body.thinking)
    )
      throw Error(
        "This thinking effort is not supported by the selected model.",
      );
    const replacing = body.key !== undefined && body.key !== prev?.key;
    if (replacing && prev?.chatgpt?.refreshToken)
      // A pasted key replaces a ChatGPT sign-in; end that session too.
      void revokeChatGPTSession(prev.chatgpt);
    c.providers[body.provider] = {
      ...(replacing ? {} : prev),
      key: body.key === undefined ? prev?.key || "" : body.key,
      model,
      thinking: thinkingChoices(body.provider, model).includes(thinking)
        ? thinking
        : "default",
      ...(replacing && body.key
        ? { method: "key" as const, connectedAt: new Date().toISOString() }
        : {}),
    };
  }
  if (body.assistant) {
    const selected = c.providers[body.assistant];
    if (!selected?.key || !selected.model)
      throw Error(
        "Save an API key and choose a model before using this provider.",
      );
  }
  if (body.assistant !== undefined) c.assistant = body.assistant;
  if (c.assistant && !c.providers[c.assistant]?.key) c.assistant = null;
  if (body.blender !== undefined) c.blender = body.blender;
  saveConfig(c);
  res.json({ ok: true, ...connectionSummary(c) });
});
// Spoken playback: catalogues, synthesis (cached on disk) and the local Piper engine.
app.get("/api/speech/voices", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await speech.voices());
});
app.get("/api/speech/piper/catalog", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    voices: await speech.piperCatalog(),
    engine: speech.summary(config()).piper.engine,
  });
});
app.get("/api/speech/jobs", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ jobs: speech.jobs(), piper: speech.summary(config()).piper });
});
app.post("/api/speech", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await speech.synthesize(req.body));
});
app.post("/api/speech/piper/install", (_req, res) => {
  res.json({ job: speech.installEngine() });
});
app.post("/api/speech/piper/voices", async (req, res) => {
  const { id } = z.object({ id: z.string().min(1).max(120) }).parse(req.body);
  res.json({ job: await speech.installVoice(id) });
});
app.delete("/api/speech/piper/voices/:id", (req, res) => {
  speech.removeVoice(String(req.params.id));
  res.json({ ok: true });
});
app.post("/api/assistant", async (req, res) => {
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", disconnected);
  const generated: Asset[] = [];
  try {
    const scene = validateScene(req.body.scene),
      prompt = z.string().min(1).max(8000).parse(req.body.prompt);
    const result = await assistant(
      config(),
      scene,
      prompt,
      req.body.selected,
      undefined,
      {
        projects: listProjects(),
        readProject,
        history: conversationHistorySchema.parse(req.body.history || []),
        playhead: z
          .number()
          .min(0)
          .max(6000)
          .optional()
          .parse(req.body.playhead),
        stagingFeedback: z
          .string()
          .max(1000)
          .optional()
          .parse(req.body.stagingFeedback),
        images: parseInlineImages(req.body.images),
      },
    );
    for (const command of result.steps.flatMap((step) =>
      step.type === "edit" ? step.commands : [],
    )) {
      if (
        command.type === "createAsset" &&
        command.asset.category === "characters" &&
        !command.asset.url
      ) {
        command.asset = await generateCharacter(
          command.asset,
          config().blender,
          controller.signal,
        );
        generated.push(command.asset);
      }
    }
    res.json(result);
  } catch (error) {
    for (const asset of generated)
      for (const url of [asset.url, asset.thumbnail])
        if (url)
          fs.rmSync(path.join(dataDir, "uploads", path.basename(url)), {
            force: true,
          });
    throw error;
  } finally {
    res.off("close", disconnected);
  }
});
app.post("/api/characters", async (req, res) => {
  const asset = assetSchema.parse(req.body);
  if (!asset.design) throw Error("Choose a starting look for your character.");
  const controller = new AbortController();
  const disconnected = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.once("close", disconnected);
  try {
    res.json(
      await generateCharacter(asset, config().blender, controller.signal),
    );
  } finally {
    res.off("close", disconnected);
  }
});
app.post("/api/conversation", conversationRoute(config));
const upload = multer({
  dest: path.join(dataDir, "uploads"),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
app.post(
  "/api/thumbnails",
  multer({
    dest: path.join(dataDir, "uploads"),
    limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  }).single("file"),
  (req, res) => {
    const file = req.file;
    if (!file) throw Error("The character preview is missing.");
    try {
      const bytes = fs.readFileSync(file.path);
      if (
        bytes.length < 33 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.toString("ascii", 12, 16) !== "IHDR" ||
        bytes.readUInt32BE(16) < 1 ||
        bytes.readUInt32BE(16) > 1024 ||
        bytes.readUInt32BE(20) < 1 ||
        bytes.readUInt32BE(20) > 1024
      )
        throw Error(
          "Choose a PNG character preview up to 1024 pixels wide and tall.",
        );
      const name = crypto.randomUUID() + ".png";
      fs.renameSync(file.path, path.join(dataDir, "uploads", name));
      res.json({ url: "/uploads/" + name });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  },
);
app.post("/api/exports", upload.single("file"), (req, res) => {
  const f = req.file;
  if (!f) throw Error("No package was supplied.");
  const name = crypto.randomUUID() + ".zip";
  fs.renameSync(f.path, path.join(dataDir, "exports", name));
  res.json({ url: "/exports/" + name });
});
app.use(
  "/api/recordings",
  recordingsRouter({
    uploads: path.join(dataDir, "uploads"),
    ffmpeg: () => process.env.FFMPEG_PATH || "ffmpeg",
  }),
);
app.post("/api/import", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) throw Error("Choose a GLB or FBX file.");
  const ext = path.extname(f.originalname).toLowerCase(),
    id = crypto.randomUUID(),
    output = path.join(dataDir, "uploads", id + ".glb");
  try {
    if (ext === ".glb") {
      const fd = fs.openSync(f.path, "r"),
        head = Buffer.alloc(12);
      fs.readSync(fd, head, 0, 12, 0);
      fs.closeSync(fd);
      if (
        head.toString("ascii", 0, 4) !== "glTF" ||
        head.readUInt32LE(4) !== 2 ||
        head.readUInt32LE(8) !== f.size
      )
        throw Error("This file is not a valid GLB 2.0 asset.");
      fs.renameSync(f.path, output);
    } else if (ext === ".fbx") {
      await run(
        config().blender,
        [
          "--background",
          "--factory-startup",
          "--python-exit-code",
          "1",
          "--python",
          path.resolve("engine/convert.py"),
          "--",
          f.path,
          output,
        ],
        { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
      );
    } else throw Error("Choose a GLB or FBX file.");
    const bytes = fs.readFileSync(output);
    const metadata = JSON.parse(
      bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString("utf8"),
    );
    if (
      [...(metadata.buffers || []), ...(metadata.images || [])].some(
        (entry: { uri?: string }) =>
          entry.uri && !entry.uri.startsWith("data:"),
      )
    ) {
      fs.unlinkSync(output);
      throw Error("Please export a self-contained GLB with embedded textures.");
    }
    const animations = (metadata.animations || []).map(
      (a: { name?: string; samplers: { input: number }[] }, i: number) => ({
        name: a.name || "Animation " + (i + 1),
        duration: Math.max(
          0.2,
          ...a.samplers.map(
            (sample) => metadata.accessors[sample.input]?.max?.[0] || 1,
          ),
        ),
      }),
    );
    res.json({
      url: "/uploads/" + id + ".glb",
      name: path.basename(f.originalname, ext),
      animations,
    });
  } catch (error) {
    if (fs.existsSync(output)) fs.unlinkSync(output);
    throw error;
  } finally {
    if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
  }
});
// AI 3D generation (Meshy) → Blender cleanup → studio asset.
const local3dRoot = path.resolve(
  process.env.SCENE_MAKER_LOCAL_3D_ROOT || path.join(dataDir, "ai-pilot"),
);
const local3dPython = path.join(local3dRoot, "venv", "bin", "python");
const generation = createGenerationService({
  config,
  ...(fs.existsSync(local3dPython) &&
  fs.existsSync(path.join(local3dRoot, "Hunyuan3D-2"))
    ? { local: { python: local3dPython, root: local3dRoot } }
    : {}),
});
app.get("/api/generate", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({
    configured: generation.configured(),
    providers: generation.providers(),
    jobs: generation.list(),
  });
});
app.post("/api/generate", (req, res) => {
  res.json(generation.start(req.body));
});
app.get("/api/generate/:id", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const job = generation.get(req.params.id);
  if (!job) {
    res.status(404).json({ error: "Unknown generation." });
    return;
  }
  res.json(job);
});
app.delete("/api/generate/:id", (req, res) => {
  res.json({ ok: generation.cancel(req.params.id) });
});
// Guided Mixamo round trip: prepare FBX → mixamo.com → import the downloads.
const mixamo = createMixamoService({ config });
app.post("/api/mixamo/prepare", async (req, res) => {
  const body = z.object({ url: z.string().max(500) }).parse(req.body);
  res.json({ ...(await mixamo.prepare(body.url)), mixamo: mixamo.url });
});
app.post("/api/mixamo/watch", (_req, res) => {
  res.json(mixamo.startWatch());
});
app.get("/api/mixamo/downloads", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ directory: mixamo.downloadsDirectory(), files: mixamo.poll() });
});
app.post("/api/mixamo/import", async (req, res) => {
  res.json(await mixamo.importBundle(req.body));
});
app.post(
  "/api/mixamo/upload",
  multer({
    dest: path.join(dataDir, "uploads"),
    limits: { fileSize: 100 * 1024 * 1024, files: 40 },
  }).array("files", 40),
  async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) || [];
    if (!files.length) throw Error("Choose the Mixamo FBX files to import.");
    const named: string[] = [];
    try {
      for (const f of files) {
        if (!/\.fbx$/i.test(f.originalname))
          throw Error("Mixamo downloads are FBX files.");
        const target = path.join(
          path.dirname(f.path),
          path.basename(f.path) +
            "-" +
            path.basename(f.originalname).replace(/[^a-zA-Z0-9_.-]/g, "_"),
        );
        fs.renameSync(f.path, target);
        named.push(target);
      }
      res.json(
        await mixamo.importFiles(
          named,
          files.map((f) => f.originalname),
        ),
      );
    } finally {
      for (const f of files) fs.rmSync(f.path, { force: true });
      for (const f of named) fs.rmSync(f, { force: true });
    }
  },
);
app.post("/api/blender", upload.single("file"), async (req, res) => {
  const f = req.file;
  if (!f) throw Error("No scene was supplied.");
  const id = crypto.randomUUID(),
    glb = path.join(dataDir, "uploads", id + ".glb"),
    output = path.join(dataDir, "uploads", id + ".blend");
  try {
    fs.renameSync(f.path, glb);
    await run(
      config().blender,
      [
        "--background",
        "--factory-startup",
        "--python-exit-code",
        "1",
        "--python",
        path.resolve("engine/blender_import.py"),
        "--",
        glb,
        output,
      ],
      { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
    );
    res.json({ url: "/uploads/" + id + ".blend" });
  } finally {
    if (fs.existsSync(glb)) fs.unlinkSync(glb);
  }
});
app.get("/api/engines", async (_req, res) => {
  let blender = false;
  try {
    await run(config().blender, ["--version"], { timeout: 5000 });
    blender = true;
  } catch {}
  res.json({ blender, unreal: "export", mixamo: "import" });
});
app.use(express.static(path.resolve("dist")));
app.get("/{*path}", (_req, res) =>
  res.sendFile(path.resolve("dist/index.html")),
);
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const error = err as Error & { status?: number; code?: string };
    const safe =
      providerErrorMessage(err) ??
      (error.status === 404
        ? "That file is no longer available. Export again or reimport the missing asset."
        : error.code === "ENOENT"
          ? "Blender was not found. Set its path in Studio settings → Connections."
          : error instanceof z.ZodError
            ? "The supplied data is invalid. Check your file or request."
            : error.message?.slice(0, 400) || "Something went wrong.");
    res.status(error.status || 400).json({ error: safe });
  },
);
if (process.env.NODE_ENV !== "test")
  app.listen(Number(process.env.PORT) || 4311, "127.0.0.1", () =>
    console.log("Scene Maker service: http://127.0.0.1:4311"),
  );
