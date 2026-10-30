export type RecordingFormat = {
  mimeType: string;
  container: "mp4" | "webm";
};

// Native MP4 first (Chrome 126+, Safari); WebM is converted on the server.
const candidates: RecordingFormat[] = [
  { mimeType: "video/mp4;codecs=avc1.42E01F,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4;codecs=avc1,mp4a.40.2", container: "mp4" },
  { mimeType: "video/mp4;codecs=avc1", container: "mp4" },
  { mimeType: "video/mp4", container: "mp4" },
  { mimeType: "video/webm;codecs=vp9,opus", container: "webm" },
  { mimeType: "video/webm;codecs=vp8,opus", container: "webm" },
  { mimeType: "video/webm", container: "webm" },
];

export function chooseRecordingFormat(
  isTypeSupported: (type: string) => boolean,
): RecordingFormat | null {
  return candidates.find((c) => isTypeSupported(c.mimeType)) ?? null;
}

export function recordingFileName(name: string, date = new Date()) {
  const base =
    name
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "scene";
  const stamp = date
    .toISOString()
    .slice(0, 19)
    .replace("T", "-")
    .replace(/:/g, "");
  return `${base}-${stamp}.mp4`;
}

/** Break text into lines that fit `width` using the given measure. */
export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Cinematic output: Full HD, 16:9, regardless of the editor's layout. */
export const CINEMA = { width: 1920, height: 1080 } as const;

/**
 * Vertical field of view for the film camera so its 16:9 frame is the
 * largest centred 16:9 area of the preview: wide previews crop the sides
 * (same vertical view), tall previews crop top and bottom.
 */
export function cinemaFov(fov: number, viewAspect: number, aspect: number) {
  if (viewAspect >= aspect) return fov;
  const half = (fov * Math.PI) / 360;
  return (Math.atan((Math.tan(half) * viewAspect) / aspect) * 360) / Math.PI;
}

/** The largest centred rectangle of `aspect` inside a width × height view. */
export function frameGuide(width: number, height: number, aspect: number) {
  const w = Math.min(width, height * aspect);
  const h = w / aspect;
  return { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h };
}

export type Caption = { text: string };

/** Film-style subtitles: white, outlined, centred near the bottom. */
export function drawCaptions(
  ctx: CanvasRenderingContext2D,
  captions: Caption[],
  width: number,
  height: number,
) {
  if (!captions.length) return;
  const size = Math.round(height * 0.037);
  const lineHeight = size * 1.28;
  ctx.save();
  ctx.font = `500 ${size}px "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const lines = captions.flatMap((c) =>
    wrapText(
      (captions.length > 1 ? "– " : "") + c.text.replace(/\s+/g, " "),
      width * 0.72,
      (t) => ctx.measureText(t).width,
    ),
  );
  const bottom = height * 0.92;
  lines.forEach((line, i) => {
    const y = bottom - (lines.length - 1 - i) * lineHeight;
    ctx.shadowColor = "#000a";
    ctx.shadowBlur = size * 0.35;
    ctx.lineWidth = size * 0.14;
    ctx.strokeStyle = "#000c";
    ctx.strokeText(line, width / 2, y);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#fff";
    ctx.fillText(line, width / 2, y);
  });
  ctx.restore();
}

export type Recording = {
  blob: Blob;
  container: RecordingFormat["container"];
};

/**
 * Decides, frame by frame, whether the recording should be running. The take
 * follows the scene clock: it starts when scene time first moves and pauses
 * while time holds still (a cast still generating its next reply, a voice
 * line loading, the end of the sequence), so the video has no dead waits.
 */
export class RecordingClock {
  private last: number | null = null;
  private movedAt = 0;
  private segmentStart = 0;
  private total = 0;
  state: "waiting" | "recording" | "paused" = "waiting";
  constructor(private hold = 0.2) {}
  /** Feed the scene time shown this frame; returns what the recorder should do. */
  update(
    time: number,
    now: number,
  ): "start" | "resume" | "pause" | "draw" | "skip" {
    const moved = this.last !== null && Math.abs(time - this.last) > 1e-4;
    this.last = time;
    if (moved) this.movedAt = now;
    if (this.state === "waiting") {
      if (!moved) return "skip";
      this.state = "recording";
      this.segmentStart = now;
      return "start";
    }
    if (this.state === "paused") {
      if (!moved) return "skip";
      this.state = "recording";
      this.segmentStart = now;
      return "resume";
    }
    if (!moved && now - this.movedAt > this.hold * 1000) {
      this.state = "paused";
      this.total += now - this.segmentStart;
      return "pause";
    }
    return "draw";
  }
  /** Seconds of video recorded so far. */
  recorded(now: number) {
    return (
      (this.total +
        (this.state === "recording" ? now - this.segmentStart : 0)) /
      1000
    );
  }
}

/**
 * Records the film camera in real time: each frame of the dedicated 16:9
 * render (no editor helpers) gets film subtitles and is captured by
 * MediaRecorder, optionally with a voice audio track.
 */
export class SceneRecorder {
  private frame: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private stream: MediaStream;
  private done: Promise<Recording>;
  private clock = new RecordingClock();
  readonly format: RecordingFormat;
  constructor(
    private source: HTMLCanvasElement,
    private captions: (time: number) => Caption[],
    audio: MediaStreamTrack | null,
  ) {
    if (typeof MediaRecorder === "undefined")
      throw Error("This browser cannot record video. Try Chrome or Safari.");
    const format = chooseRecordingFormat((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    if (!format)
      throw Error("This browser cannot record video. Try Chrome or Safari.");
    this.format = format;
    this.frame = document.createElement("canvas");
    this.frame.width = source.width;
    this.frame.height = source.height;
    const ctx = this.frame.getContext("2d");
    if (!ctx) throw Error("This browser cannot record video.");
    this.ctx = ctx;
    this.paint(0);
    this.stream = this.frame.captureStream(30);
    if (audio) this.stream.addTrack(audio);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: format.mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 160_000,
    });
    this.recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) this.chunks.push(event.data);
    });
    this.done = new Promise((resolve, reject) => {
      this.recorder.addEventListener("stop", () => {
        const blob = new Blob(this.chunks, {
          type: format.mimeType.split(";")[0],
        });
        if (!blob.size)
          reject(Error("The recording is empty. Record for a little longer."));
        else resolve({ blob, container: format.container });
      });
      this.recorder.addEventListener("error", () =>
        reject(Error("The browser stopped the recording unexpectedly.")),
      );
    });
  }
  /** "waiting" until the scene first plays, "paused" while its clock holds. */
  get state() {
    return this.clock.state;
  }
  /** Seconds of video recorded so far. */
  get seconds() {
    return this.clock.recorded(performance.now());
  }
  /** Called after each rendered viewport frame with the scene time shown. */
  drawFrame(time: number) {
    const step = this.clock.update(time, performance.now());
    if (step === "skip") return;
    if (step === "pause") {
      this.recorder.pause();
      return;
    }
    this.paint(time);
    if (step === "start") this.recorder.start(1000);
    if (step === "resume") this.recorder.resume();
  }
  private paint(time: number) {
    const { width, height } = this.frame;
    this.ctx.drawImage(this.source, 0, 0, width, height);
    drawCaptions(this.ctx, this.captions(time), width, height);
  }
  stop(): Promise<Recording> {
    for (const track of this.stream.getVideoTracks()) track.stop();
    if (this.recorder.state === "inactive")
      return Promise.reject(
        Error("Nothing played while recording, so no video was saved."),
      );
    this.recorder.stop();
    return this.done;
  }
}

/** Turn a finished recording into a standard MP4 using the studio service. */
export async function recordingToMp4(recording: Recording): Promise<Blob> {
  const form = new FormData();
  form.append(
    "file",
    recording.blob,
    `recording.${recording.container === "mp4" ? "mp4" : "webm"}`,
  );
  try {
    const res = await fetch("/api/recordings/mp4", {
      method: "POST",
      headers: { "X-Scene-Maker": "1" },
      body: form,
    });
    if (!res.ok) {
      let message = "The studio service could not save the MP4.";
      try {
        message = (await res.json()).error || message;
      } catch {}
      throw Error(message);
    }
    return await res.blob();
  } catch (error) {
    // A native MP4 is already playable; keep it rather than lose the take.
    if (recording.container === "mp4") return recording.blob;
    throw error;
  }
}
