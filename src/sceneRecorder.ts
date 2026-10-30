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

/** Recording frame size: canvas pixels, capped, with even sides for H.264. */
export function recordingSize(width: number, height: number, max = 1920) {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  const even = (n: number) => Math.max(2, Math.floor((n * scale) / 2) * 2);
  return { width: even(width), height: even(height), scale };
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

const roundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/**
 * Paint the in-scene dialogue bubbles (DOM overlays in the live view) onto
 * the recording frame, matching the .scene-bubble styling.
 */
export function drawBubbles(
  ctx: CanvasRenderingContext2D,
  layer: HTMLElement,
  origin: DOMRect,
  scale: number,
) {
  for (const bubble of Array.from(layer.children) as HTMLElement[]) {
    // Thinking bubbles mark live generation, not the finished scene.
    if (bubble.hidden || bubble.classList.contains("thought")) continue;
    const name = bubble.querySelector("strong")?.textContent ?? "";
    const words = bubble.querySelector("span");
    const text = words?.textContent ?? "";
    const rect = bubble.getBoundingClientRect();
    const textWidth =
      words?.getBoundingClientRect().width ?? Math.max(0, rect.width - 32);
    const family = getComputedStyle(bubble).fontFamily || "sans-serif";
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(rect.left - origin.left, rect.top - origin.top);
    const radius = 18;
    ctx.strokeStyle = "#819776";
    ctx.lineWidth = 1;
    ctx.shadowColor = "#263a2420";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#fffef8f5";
    roundRect(ctx, 0.5, 0.5, rect.width - 1, rect.height - 1, radius);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.stroke();
    // Tail below the bubble, pointing at the speaker.
    ctx.beginPath();
    ctx.moveTo(rect.width / 2 - 7, rect.height - 1);
    ctx.lineTo(rect.width / 2, rect.height + 7);
    ctx.lineTo(rect.width / 2 + 7, rect.height - 1);
    ctx.fillStyle = "#fffef8";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(rect.width / 2 - 7, rect.height - 0.5);
    ctx.lineTo(rect.width / 2, rect.height + 7);
    ctx.lineTo(rect.width / 2 + 7, rect.height - 0.5);
    ctx.stroke();
    ctx.textBaseline = "top";
    ctx.fillStyle = "#74846a";
    ctx.font = `600 10px ${family}`;
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0.8px";
    ctx.fillText(name.toUpperCase(), 16, 13);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    ctx.fillStyle = "#31452c";
    ctx.font = `14px ${family}`;
    wrapText(text, textWidth + 1, (t) => ctx.measureText(t).width).forEach(
      (line, i) => ctx.fillText(line, 16, 32 + i * 21),
    );
    ctx.restore();
  }
}

export type RecordingSurface = {
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
};

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
 * Records the live viewport in real time: every rendered frame is composited
 * (3D view + dialogue bubbles) onto an offscreen canvas captured by
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
    private surface: RecordingSurface,
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
    const size = recordingSize(surface.canvas.width, surface.canvas.height);
    this.frame = document.createElement("canvas");
    this.frame.width = size.width;
    this.frame.height = size.height;
    const ctx = this.frame.getContext("2d");
    if (!ctx) throw Error("This browser cannot record video.");
    this.ctx = ctx;
    this.paint();
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
    this.paint();
    if (step === "start") this.recorder.start(1000);
    if (step === "resume") this.recorder.resume();
  }
  private paint() {
    const { canvas, overlay } = this.surface;
    const { width, height } = this.frame;
    this.ctx.drawImage(canvas, 0, 0, width, height);
    const box = canvas.getBoundingClientRect();
    if (box.width) drawBubbles(this.ctx, overlay, box, width / box.width);
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
