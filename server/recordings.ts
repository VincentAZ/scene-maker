import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type RecordingContainer = "mp4" | "webm";

/** Identify a browser recording by its leading bytes, not its claimed type. */
export function recordingContainer(head: Buffer): RecordingContainer | null {
  if (
    head.length >= 4 &&
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    return "webm";
  if (head.length >= 8 && head.toString("ascii", 4, 8) === "ftyp") return "mp4";
  return null;
}

/**
 * ffmpeg arguments that turn a browser recording into a widely playable MP4.
 * Native MP4 recordings are fragmented and often lack a duration, so they are
 * remuxed without re-encoding; WebM recordings are encoded to H.264 + AAC.
 */
export function mp4Arguments(
  container: RecordingContainer,
  input: string,
  output: string,
) {
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-i", input];
  const finish = ["-movflags", "+faststart", "-f", "mp4", output];
  if (container === "mp4") return [...common, "-c", "copy", ...finish];
  return [
    ...common,
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    // H.264 needs even dimensions.
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    ...finish,
  ];
}

/**
 * POST /api/recordings/mp4 with a multipart "file" holding a WebM or MP4
 * recording of the viewport; responds with the finished MP4 bytes.
 */
export function recordingsRouter(options: {
  uploads: string;
  ffmpeg: () => string;
}) {
  const router = express.Router();
  const upload = multer({
    dest: options.uploads,
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
  });
  router.post("/mp4", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) throw Error("No recording was supplied.");
    const output = path.join(
      options.uploads,
      `${crypto.randomUUID()}.recording.mp4`,
    );
    try {
      const head = Buffer.alloc(12);
      const fd = fs.openSync(file.path, "r");
      try {
        fs.readSync(fd, head, 0, head.length, 0);
      } finally {
        fs.closeSync(fd);
      }
      const container = recordingContainer(head);
      if (!container) throw Error("This recording is not a WebM or MP4 video.");
      try {
        await run(
          options.ffmpeg(),
          mp4Arguments(container, file.path, output),
          { timeout: 30 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
        );
      } catch (error) {
        const failure = error as Error & { code?: string; stderr?: string };
        if (failure.code === "ENOENT")
          throw Object.assign(
            Error(
              "Saving MP4 needs ffmpeg. Install ffmpeg or set FFMPEG_PATH, then record again.",
            ),
            { status: 501 },
          );
        throw Error(
          "The recording could not be converted to MP4." +
            (failure.stderr ? " " + failure.stderr.trim().slice(0, 240) : ""),
        );
      }
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("X-Content-Type-Options", "nosniff");
      await new Promise<void>((resolve, reject) =>
        res.sendFile(output, (error) => (error ? reject(error) : resolve())),
      );
    } finally {
      fs.rmSync(file.path, { force: true });
      fs.rmSync(output, { force: true });
    }
  });
  return router;
}
