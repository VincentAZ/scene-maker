import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Server } from "node:http";
import {
  chooseRecordingFormat,
  recordingFileName,
  recordingSize,
  wrapText,
} from "../src/sceneRecorder";
import {
  mp4Arguments,
  recordingContainer,
  recordingsRouter,
} from "../server/recordings";

describe("recording helpers", () => {
  it("prefers native MP4 and falls back to WebM", () => {
    expect(chooseRecordingFormat(() => true)?.container).toBe("mp4");
    expect(
      chooseRecordingFormat((type) => type.startsWith("video/webm")),
    ).toEqual({ mimeType: "video/webm;codecs=vp9,opus", container: "webm" });
    expect(chooseRecordingFormat(() => false)).toBeNull();
  });
  it("sizes frames with even sides and a capped long edge", () => {
    expect(recordingSize(1281, 721)).toMatchObject({
      width: 1280,
      height: 720,
    });
    const big = recordingSize(3840, 2160);
    expect([big.width, big.height]).toEqual([1920, 1080]);
  });
  it("names files safely", () => {
    const date = new Date("2025-01-02T03:04:05Z");
    expect(recordingFileName("Café scene / take 1", date)).toBe(
      "Café-scene-take-1-2025-01-02-030405.mp4",
    );
    expect(recordingFileName("  ../  ", date)).toBe(
      "scene-2025-01-02-030405.mp4",
    );
  });
  it("wraps bubble text to the available width", () => {
    expect(wrapText("one two three four", 9, (t) => t.length)).toEqual([
      "one two",
      "three",
      "four",
    ]);
  });
  it("identifies containers by content and builds ffmpeg arguments", () => {
    expect(recordingContainer(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      "webm",
    );
    expect(recordingContainer(Buffer.from("\0\0\0\x18ftypmp42"))).toBe("mp4");
    expect(recordingContainer(Buffer.from("<html>"))).toBeNull();
    expect(mp4Arguments("mp4", "a", "b")).toContain("copy");
    expect(mp4Arguments("webm", "a", "b")).toContain("libx264");
  });
});

let hasFfmpeg = true;
try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
} catch {
  hasFfmpeg = false;
}

describe.skipIf(!hasFfmpeg)("MP4 conversion service", () => {
  let server: Server, base: string, dir: string;
  let ffmpeg = "ffmpeg";
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "scene-maker-recording-"));
    const app = express();
    app.use(
      "/api/recordings",
      recordingsRouter({ uploads: dir, ffmpeg: () => ffmpeg }),
    );
    app.use(
      (
        err: Error & { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(err.status || 400).json({ error: err.message });
      },
    );
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sample = (name: string, args: string[]) => {
    const file = path.join(dir, name);
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=321x181:rate=30:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      ...args,
      file,
    ]);
    return fs.readFileSync(file);
  };
  const post = (data: Uint8Array) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(data)]), "recording.webm");
    return fetch(base + "/api/recordings/mp4", { method: "POST", body: form });
  };
  const probe = (bytes: ArrayBuffer) => {
    const file = path.join(dir, "probe.mp4");
    fs.writeFileSync(file, Buffer.from(bytes));
    return execFileSync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "stream=codec_name,width,height:format=format_name",
      "-of",
      "json",
      file,
    ]).toString();
  };
  it("transcodes a WebM recording to H.264/AAC MP4 and cleans up", async () => {
    const webm = sample("in.webm", ["-c:v", "libvpx", "-c:a", "libopus"]);
    const before = fs.readdirSync(dir).sort();
    const res = await post(webm);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("video/mp4");
    const info = JSON.parse(probe(await res.arrayBuffer()));
    expect(info.format.format_name).toContain("mp4");
    const video = info.streams.find(
      (s: { codec_name: string }) => s.codec_name === "h264",
    );
    expect(video).toMatchObject({ width: 320, height: 180 });
    expect(
      info.streams.some((s: { codec_name: string }) => s.codec_name === "aac"),
    ).toBe(true);
    expect(
      fs
        .readdirSync(dir)
        .filter((f) => f !== "probe.mp4")
        .sort(),
    ).toEqual(before);
  });
  it("remuxes a native MP4 recording", async () => {
    const mp4 = sample("in.mp4", [
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=320:180",
      "-c:a",
      "aac",
      "-movflags",
      "frag_keyframe+empty_moov",
    ]);
    const res = await post(mp4);
    expect(res.status).toBe(200);
    expect(probe(await res.arrayBuffer())).toContain("h264");
  });
  it("rejects non-video uploads and explains a missing ffmpeg", async () => {
    const bad = await post(new TextEncoder().encode("<html>nope</html>"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain("not a WebM or MP4");
    ffmpeg = "/missing/ffmpeg";
    try {
      const webm = fs.readFileSync(path.join(dir, "in.webm"));
      const missing = await post(webm);
      expect(missing.status).toBe(501);
      expect((await missing.json()).error).toContain("ffmpeg");
    } finally {
      ffmpeg = "ffmpeg";
    }
  });
});
