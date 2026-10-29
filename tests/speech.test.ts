import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createSpeechService,
  PIPER_VOICES,
  synthesisSchema,
} from "../server/speech";
import type { Config } from "../server/ai";
import {
  automaticVoices,
  parseVoiceChoice,
  voiceChoiceId,
  openaiVoices,
} from "../shared/voices";

let root: string;
const config: Config = {
  assistant: "openai",
  providers: { openai: { key: "openai-key", model: "gpt-6-luna" } },
  blender: "blender",
  speech: { elevenlabs: { key: "eleven-key" } },
};
const onnxBytes = Buffer.from("fake-onnx-model");
const onnxJson = Buffer.from(
  JSON.stringify({
    num_speakers: 1,
    language: { code: "en_US", name_english: "English" },
    audio: { quality: "medium" },
  }),
);
const md5 = (b: Buffer) => crypto.createHash("md5").update(b).digest("hex");
const calls: string[] = [];
const fakeFetch = vi.fn(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.startsWith("https://api.openai.com/v1/audio/speech")) {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-4o-mini-tts",
        response_format: "mp3",
      });
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer openai-key",
      );
      return new Response(Buffer.from("MP3:" + body.voice + ":" + body.input), {
        status: 200,
      });
    }
    if (url.includes("/v1/text-to-speech/")) {
      expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe(
        "eleven-key",
      );
      return Response.json({
        audio_base64: Buffer.from("ELEVEN-AUDIO").toString("base64"),
        alignment: {
          characters: ["H", "i"],
          character_start_times_seconds: [0, 0.2],
          character_end_times_seconds: [0.2, 0.4],
        },
      });
    }
    if (url.startsWith("https://api.elevenlabs.io/v2/voices")) {
      const page2 = url.includes("next_page_token=p2");
      return Response.json({
        voices: page2
          ? [
              {
                voice_id: "voiceB22222222222222",
                name: "Bram",
                labels: { gender: "male", accent: "british", age: "old" },
              },
            ]
          : [
              {
                voice_id: "voiceA11111111111111",
                name: "Aria",
                labels: {
                  gender: "female",
                  accent: "american",
                  use_case: "narration",
                },
                preview_url: "https://x/a.mp3",
                category: "premade",
              },
            ],
        has_more: !page2,
        next_page_token: page2 ? null : "p2",
      });
    }
    if (url === PIPER_VOICES + "voices.json")
      return Response.json({
        "en_US-lessac-medium": {
          key: "en_US-lessac-medium",
          name: "lessac",
          language: { code: "en_US", name_english: "English" },
          quality: "medium",
          num_speakers: 1,
          files: {
            "en/en_US/lessac/medium/en_US-lessac-medium.onnx": {
              size_bytes: onnxBytes.length,
              md5_digest: md5(onnxBytes),
            },
            "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json": {
              size_bytes: onnxJson.length,
              md5_digest: md5(onnxJson),
            },
            "en/en_US/lessac/medium/MODEL_CARD": {
              size_bytes: 10,
              md5_digest: "x",
            },
          },
        },
        "de_DE-thorsten-high": {
          key: "de_DE-thorsten-high",
          name: "thorsten",
          language: { code: "de_DE", name_english: "German" },
          quality: "high",
          num_speakers: 1,
          files: {
            "de/de_DE/thorsten/high/de_DE-thorsten-high.onnx": {
              size_bytes: 5,
              md5_digest: "0000",
            },
            "de/de_DE/thorsten/high/de_DE-thorsten-high.onnx.json": {
              size_bytes: 5,
              md5_digest: "0000",
            },
          },
        },
      });
    if (url.endsWith(".onnx")) return new Response(onnxBytes);
    if (url.endsWith(".onnx.json")) return new Response(onnxJson);
    return new Response("not found", { status: 404 });
  },
);

let service: ReturnType<typeof createSpeechService>;
let binary: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "scene-speech-"));
  binary = path.join(root, "fake-piper");
  // A stand-in engine: reads the line from stdin and writes a tiny WAV header.
  fs.writeFileSync(
    binary,
    `#!/bin/sh
out=""; spk=""
while [ $# -gt 0 ]; do case "$1" in --output_file) out="$2"; shift;; --speaker) spk="$2"; shift;; esac; shift; done
read -r line
printf 'RIFF%s|%s' "$spk" "$line" > "$out"
`,
    { mode: 0o755 },
  );
  service = createSpeechService({
    config: () => config,
    fetch: fakeFetch as unknown as typeof fetch,
    root,
    piperBinary: binary,
  });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const waitFor = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 20));
};

describe("voice choices", () => {
  it("parses and formats provider-qualified voices and keeps legacy browser URIs", () => {
    expect(parseVoiceChoice("openai:nova")).toEqual({
      provider: "openai",
      voice: "nova",
    });
    expect(parseVoiceChoice("piper:en_GB-vctk-medium#12")).toEqual({
      provider: "piper",
      voice: "en_GB-vctk-medium",
      speaker: 12,
    });
    expect(parseVoiceChoice("Google UK English Female")).toEqual({
      provider: "browser",
      voice: "Google UK English Female",
    });
    expect(parseVoiceChoice("")).toBeNull();
    expect(voiceChoiceId({ provider: "piper", voice: "a", speaker: 3 })).toBe(
      "piper:a#3",
    );
  });
  it("casts automatic voices with variety and determinism", () => {
    const pool = openaiVoices;
    const cast = automaticVoices(["a", "b", "c", "d"], pool);
    const ids = ["a", "b", "c", "d"].map((k) => cast[k]!.id);
    expect(new Set(ids).size).toBe(4);
    expect(cast.a!.gender).not.toBe(cast.b!.gender);
    expect(automaticVoices(["a", "b"], pool)).toEqual({ a: cast.a, b: cast.b });
    expect(automaticVoices(["a"], [])).toEqual({});
  });
  it("validates synthesis requests", () => {
    expect(() =>
      synthesisSchema.parse({
        provider: "openai",
        voice: "../etc",
        text: "hi",
      }),
    ).toThrow();
    expect(() =>
      synthesisSchema.parse({
        provider: "openai",
        voice: "nova",
        text: "x".repeat(1801),
      }),
    ).toThrow();
    expect(() =>
      synthesisSchema.parse({ provider: "tts", voice: "nova", text: "hi" }),
    ).toThrow();
  });
});

describe("speech synthesis service", () => {
  it("synthesizes OpenAI speech once, caches it on disk and dedupes concurrent requests", async () => {
    const before = fakeFetch.mock.calls.length;
    const [a, b] = await Promise.all([
      service.synthesize({
        provider: "openai",
        voice: "nova",
        text: "Hello there.",
      }),
      service.synthesize({
        provider: "openai",
        voice: "nova",
        text: "Hello there.",
      }),
    ]);
    expect(a.url).toMatch(/^\/speech\/[0-9a-f]{64}\.mp3$/);
    expect(a).toEqual(b);
    expect(fakeFetch.mock.calls.length - before).toBe(1);
    expect(
      fs.readFileSync(path.join(root, "speech", path.basename(a.url)), "utf8"),
    ).toBe("MP3:nova:Hello there.");
    const again = await service.synthesize({
      provider: "openai",
      voice: "nova",
      text: "Hello there.",
    });
    expect(again.cached).toBe(true);
    await expect(
      service.synthesize({ provider: "openai", voice: "robot", text: "x" }),
    ).rejects.toThrow("not available");
  });
  it("keeps ElevenLabs character timings beside the cached audio", async () => {
    const first = await service.synthesize({
      provider: "elevenlabs",
      voice: "voiceA11111111111111",
      text: "Hi",
    });
    expect(first.alignment).toEqual({
      chars: ["H", "i"],
      starts: [0, 0.2],
      ends: [0.2, 0.4],
    });
    const cached = await service.synthesize({
      provider: "elevenlabs",
      voice: "voiceA11111111111111",
      text: "Hi",
    });
    expect(cached.cached).toBe(true);
    expect(cached.alignment).toEqual(first.alignment);
  });
  it("lists cloud voices from saved keys and pages through ElevenLabs", async () => {
    const voices = await service.voices();
    expect(voices.openai.map((v) => v.voice)).toContain("nova");
    expect(voices.elevenlabs.map((v) => v.name)).toEqual(["Aria", "Bram"]);
    expect(voices.elevenlabs[0]).toMatchObject({
      id: "elevenlabs:voiceA11111111111111",
      gender: "female",
      local: false,
      preview: "https://x/a.mp3",
    });
    expect(voices.elevenlabs[0].description).toContain("Narration");
    const without = createSpeechService({
      config: () => ({ assistant: null, providers: {}, blender: "" }),
      fetch: fakeFetch as unknown as typeof fetch,
      root: path.join(root, "empty"),
    });
    const none = await without.voices();
    expect(none.openai).toEqual([]);
    expect(none.elevenlabs).toEqual([]);
    expect(none.piperEngine).toBe(false);
  });
  it("installs a Piper voice from the catalogue with checksum verification", async () => {
    const list = await service.piperCatalog();
    expect(list.map((v) => v.id)).toEqual([
      "en_US-lessac-medium",
      "de_DE-thorsten-high",
    ]);
    expect(list[0]).toMatchObject({
      languageName: "English",
      quality: "medium",
      speakers: 1,
      installed: false,
    });
    const job = await service.installVoice("en_US-lessac-medium");
    await waitFor(() =>
      service.jobs().some((j) => j.id === job.id && j.status !== "running"),
    );
    expect(service.jobs().find((j) => j.id === job.id)?.status).toBe("done");
    expect(
      fs.existsSync(
        path.join(service.paths.voicesDir, "en_US-lessac-medium.onnx.json"),
      ),
    ).toBe(true);
    expect((await service.piperCatalog())[0].installed).toBe(true);
    const bad = await service.installVoice("de_DE-thorsten-high");
    await waitFor(() =>
      service.jobs().some((j) => j.id === bad.id && j.status !== "running"),
    );
    expect(service.jobs().find((j) => j.id === bad.id)).toMatchObject({
      status: "failed",
      message: expect.stringContaining("checksum"),
    });
    await expect(service.installVoice("nope")).rejects.toThrow(
      "not in the Piper catalogue",
    );
  });
  it("speaks through the local Piper engine with fixed arguments and expands multi-speaker voices", async () => {
    const result = await service.synthesize({
      provider: "piper",
      voice: "en_US-lessac-medium",
      text: "Local   voice.",
    });
    expect(result.url).toMatch(/\.wav$/);
    expect(
      fs.readFileSync(
        path.join(root, "speech", path.basename(result.url)),
        "utf8",
      ),
    ).toBe("RIFF|Local voice.");
    fs.writeFileSync(
      path.join(service.paths.voicesDir, "en_GB-aru-medium.onnx"),
      "x",
    );
    fs.writeFileSync(
      path.join(service.paths.voicesDir, "en_GB-aru-medium.onnx.json"),
      JSON.stringify({
        num_speakers: 3,
        speaker_id_map: { p1: 0, p2: 1, p3: 2 },
        language: { code: "en_GB", name_english: "English" },
      }),
    );
    fs.writeFileSync(
      path.join(service.paths.voicesDir, "en_US-libritts-high.onnx"),
      "x",
    );
    fs.writeFileSync(
      path.join(service.paths.voicesDir, "en_US-libritts-high.onnx.json"),
      JSON.stringify({ num_speakers: 904, language: { code: "en_US" } }),
    );
    const voices = (await service.voices()).piper;
    expect(
      voices.filter((v) => v.voice === "en_GB-aru-medium").map((v) => v.id),
    ).toEqual([
      "piper:en_GB-aru-medium#0",
      "piper:en_GB-aru-medium#1",
      "piper:en_GB-aru-medium#2",
    ]);
    expect(
      voices.filter((v) => v.voice === "en_US-libritts-high"),
    ).toHaveLength(16);
    const spoken = await service.synthesize({
      provider: "piper",
      voice: "en_GB-aru-medium",
      speaker: 2,
      text: "Hi",
    });
    expect(
      fs.readFileSync(
        path.join(root, "speech", path.basename(spoken.url)),
        "utf8",
      ),
    ).toBe("RIFF2|Hi");
    await expect(
      service.synthesize({
        provider: "piper",
        voice: "en_GB-aru-medium",
        speaker: 7,
        text: "Hi",
      }),
    ).rejects.toThrow("speaker does not exist");
    await expect(
      service.synthesize({
        provider: "piper",
        voice: "fr_FR-siwis-low",
        text: "Hi",
      }),
    ).rejects.toThrow("not installed");
    service.removeVoice("en_GB-aru-medium");
    expect(
      (await service.voices()).piper.some(
        (v) => v.voice === "en_GB-aru-medium",
      ),
    ).toBe(false);
  });
  it("explains a missing engine instead of failing silently", async () => {
    const bare = createSpeechService({
      config: () => config,
      fetch: fakeFetch as unknown as typeof fetch,
      root: path.join(root, "noengine"),
    });
    await expect(
      bare.synthesize({
        provider: "piper",
        voice: "en_US-lessac-medium",
        text: "Hi",
      }),
    ).rejects.toThrow("Install the Piper engine");
    expect(bare.summary(config)).toEqual({
      openai: true,
      elevenlabs: true,
      piper: { engine: false, voices: 0 },
    });
  });
});
