import { thinkingLevels, thinkingChoices } from "../shared/thinking";
import { createCodingService, codingRouter } from "./coding";
import { codingPreview } from "./codingPreview";
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
} from "./storage";
import { assistant, type Config } from "./ai";
import { providerErrorMessage } from "./providerErrors";
import { listProviderModels } from "./providerModels";
import { conversationRoute } from "./conversationRoute";
import {
  validateScene,
  providers,
  assetSchema,
  type Asset,
  type Scene,
} from "../shared/scene";
import { generateCharacter } from "./characters";
import { conversationHistorySchema } from "../shared/studio";
const run = promisify(execFile);
const configFile = path.join(dataDir, "connections.json");
const config = () =>
  readJSON<Config>(configFile, {
    providers: {},
    assistant: null,
    blender: process.env.BLENDER_PATH || "blender",
  });
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
const codePreview = codingPreview(coding);
app.use(
  "/api/coding",
  codingRouter(coding, (task) => codePreview.open(task)),
);
app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/projects", (_req, res) => res.json(listProjects()));
app.get("/api/projects/:id", (req, res) =>
  res.json(readProject(String(req.params.id))),
);
app.put("/api/projects/:id", (req, res) => {
  if (req.body.id !== req.params.id) throw Error("Project ID mismatch.");
  res.json(saveProject(req.body));
});
function connectionSummary(c: Config) {
  return {
    assistant: c.assistant,
    blender: c.blender,
    providers: Object.fromEntries(
      providers.map((p) => [
        p,
        {
          connected: !!c.providers[p]?.key,
          model: c.providers[p]?.model || "",
          thinking: c.providers[p]?.thinking || "default",
        },
      ]),
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
  const key = body.key ?? config().providers[body.provider]?.key ?? "";
  res.json({ models: await listProviderModels(body.provider, key) });
});
app.put("/api/connections", (req, res) => {
  const body = z
      .object({
        provider: z.enum(providers).optional(),
        key: z.string().trim().max(1000).optional(),
        model: z.string().trim().max(200).optional(),
        thinking: z.enum(thinkingLevels).optional(),
        assistant: z.enum(providers).nullable().optional(),
        blender: z.string().min(1).max(1000).optional(),
      })
      .parse(req.body),
    c = config();
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
    c.providers[body.provider] = {
      key: body.key === undefined ? prev?.key || "" : body.key,
      model,
      thinking: thinkingChoices(body.provider, model).includes(thinking)
        ? thinking
        : "default",
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
  atomicWrite(configFile, c);
  res.json({ ok: true, ...connectionSummary(c) });
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
