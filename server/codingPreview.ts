import express from "express";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import { starterScene, validateScene } from "../shared/scene";
import type { CodingService } from "./coding";
import type { CodingTask } from "../shared/coding";
export function codingPreview(service: CodingService) {
  let server: Server | undefined;
  let starting: Promise<number> | undefined;
  const scenes = new Map<string, ReturnType<typeof starterScene>[]>();
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || "")) {
      res.sendStatus(403);
      return;
    }
    if (
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}`
    ) {
      res.sendStatus(403);
      return;
    }
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; object-src 'none'; form-action 'none'",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-scene-maker"] !== "1"
    ) {
      res.sendStatus(403);
      return;
    }
    next();
  });
  app.use(express.json({ limit: "8mb" }));
  app.use(
    "/library",
    express.static(path.join(service.options.root, "public/library")),
  );
  app.use("/api", (req, res) => {
    const id = /\/preview\/([0-9a-f-]{36})\//.exec(
      req.headers.referer || "",
    )?.[1];
    if (!id || !scenes.has(id)) {
      res.status(403).json({ error: "Open this task's preview first." });
      return;
    }
    const items = scenes.get(id)!;
    if (req.path === "/projects" && req.method === "GET") {
      res.json(
        items.map((s) => ({
          id: s.id,
          name: s.name,
          revision: s.revision,
          environment: s.environment,
          updated: 0,
        })),
      );
      return;
    }
    const project = /^\/projects\/([\w-]+)$/.exec(req.path)?.[1];
    if (project && req.method === "GET") {
      res.json(items.find((s) => s.id === project) || items[0]);
      return;
    }
    if (project && req.method === "PUT") {
      try {
        const scene = validateScene(req.body);
        if (scene.id !== project) throw Error("Project ID mismatch.");
        scene.revision++;
        const index = items.findIndex((s) => s.id === scene.id);
        if (index === -1) items.push(scene);
        else items[index] = scene;
        res.json(scene);
      } catch {
        res.status(400).json({ error: "Invalid preview scene." });
      }
      return;
    }
    if (req.path === "/connections" && req.method === "GET") {
      res.json({ assistant: null, blender: "", providers: {} });
      return;
    }
    if (req.path === "/engines") {
      res.json({ blender: false, unreal: "export", mixamo: "import" });
      return;
    }
    res
      .status(403)
      .json({
        error:
          "This is a UI preview with temporary scene data. AI, imports, Git and server changes are available only in the main studio.",
      });
  });
  app.get("/preview/:id/{*asset}", (req, res) => {
    try {
      const id = String(req.params.id);
      service.get(id);
      if (!scenes.has(id)) throw Error("Preview not opened.");
      const dist = path.join(service.checkout(id), "dist");
      const raw = req.params.asset;
      const name = (Array.isArray(raw) ? raw.join("/") : raw) || "index.html";
      const target = path.resolve(dist, name);
      if (!target.startsWith(dist + path.sep) || !fs.existsSync(target)) {
        res.sendStatus(404);
        return;
      }
      const real = fs.realpathSync(target);
      if (!real.startsWith(dist + path.sep) || !fs.statSync(real).isFile()) {
        res.sendStatus(403);
        return;
      }
      res.sendFile(real, { dotfiles: "allow" }, error => {
        if (error && !res.headersSent) res.sendStatus(404);
      });
    } catch {
      res.sendStatus(404);
    }
  });
  return {
    async open(task: CodingTask) {
      if (!starting)
        starting = new Promise<number>((resolve, reject) => {
          server = app.listen(0, "127.0.0.1", () =>
            resolve((server!.address() as { port: number }).port),
          );
          server.once("error", (error) => {
            starting = undefined;
            reject(error);
          });
          server.unref();
        });
      const port = await starting;
      if (!scenes.has(task.id)) {
        const scene = starterScene();
        scene.name = "Code preview · temporary scene";
        scenes.set(task.id, [scene]);
      }
      return `http://127.0.0.1:${port}/preview/${task.id}/`;
    },
    close() {
      server?.close();
      starting = undefined;
    },
  };
}
