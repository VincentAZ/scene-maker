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
import { assistant, conversation, type Config } from "./ai";
import { validateScene, providers, type Scene } from "../shared/scene";
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
  if (
    origin &&
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
  "/uploads",
  express.static(path.join(dataDir, "uploads"), {
    setHeaders: (r) => r.setHeader("X-Content-Type-Options", "nosniff"),
  }),
);
app.use("/engine", express.static(path.resolve("engine")));
fs.mkdirSync(path.join(dataDir, "exports"), { recursive: true, mode: 0o700 });
app.use(
  "/exports",
  express.static(path.join(dataDir, "exports"), {
    setHeaders: (r) => {
      r.setHeader("Content-Disposition", "attachment");
      r.setHeader("X-Content-Type-Options", "nosniff");
    },
  }),
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
app.get("/api/connections", (_req, res) => {
  const c = config();
  res.json({
    assistant: c.assistant,
    blender: c.blender,
    providers: Object.fromEntries(
      providers.map((p) => [
        p,
        {
          connected: !!c.providers[p]?.key,
          model: c.providers[p]?.model || "",
        },
      ]),
    ),
  });
});
app.put("/api/connections", (req, res) => {
  const body = z
      .object({
        provider: z.enum(providers).optional(),
        key: z.string().max(1000).optional(),
        model: z.string().max(200).optional(),
        assistant: z.enum(providers).nullable().optional(),
        blender: z.string().min(1).max(1000).optional(),
      })
      .parse(req.body),
    c = config();
  if (body.provider) {
    const prev = c.providers[body.provider];
    c.providers[body.provider] = {
      key: body.key === undefined ? prev?.key || "" : body.key,
      model: body.model ?? prev?.model ?? "",
    };
  }
  if (body.assistant !== undefined) c.assistant = body.assistant;
  if (body.blender !== undefined) c.blender = body.blender;
  atomicWrite(configFile, c);
  res.json({ ok: true });
});
app.post("/api/assistant", async (req, res) => {
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
      const id = crypto.randomUUID(),
        spec = path.join(dataDir, "uploads", id + ".json"),
        output = path.join(dataDir, "uploads", id + ".glb");
      try {
        atomicWrite(spec, command.asset);
        await run(
          config().blender,
          [
            "--background",
            "--factory-startup",
            "--python-exit-code",
            "1",
            "--python",
            path.resolve("engine/create_character.py"),
            "--",
            spec,
            output,
          ],
          { timeout: 120000, maxBuffer: 2 * 1024 * 1024 },
        );
        command.asset.url = "/uploads/" + id + ".glb";
      } finally {
        if (fs.existsSync(spec)) fs.unlinkSync(spec);
      }
    }
  }
  res.json(result);
});
app.post("/api/conversation", async (req, res) => {
  const scene = validateScene(req.body.scene),
    rounds = z
      .number()
      .int()
      .min(1)
      .max(5)
      .parse(req.body.rounds || 1);
  res.json(await conversation(config(), scene, rounds));
});
const upload = multer({
  dest: path.join(dataDir, "uploads"),
  limits: { fileSize: 100 * 1024 * 1024, files: 1 },
});
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
      error.code === "ENOENT"
        ? "Blender was not found. Set its path in Studio settings → Connections."
        : error.name.includes("API")
          ? "The AI provider could not complete this request. Check your connection, model, quota, and try again."
          : error instanceof z.ZodError
            ? "The supplied data is invalid. Check your file or request."
            : error.message?.slice(0, 400) || "Something went wrong.";
    res.status(error.status || 400).json({ error: safe });
  },
);
if (process.env.NODE_ENV !== "test")
  app.listen(Number(process.env.PORT) || 4311, "127.0.0.1", () =>
    console.log("Scene Maker service: http://127.0.0.1:4311"),
  );
