/**
 * Shared audio bus for scene recordings. Synthesized voice lines created
 * while a recording is armed are routed through Web Audio so they are heard
 * as usual and also land in the recording's audio track. Browser speech
 * synthesis cannot be captured by web pages, so those lines stay silent in
 * recordings.
 */
let context: AudioContext | null = null;
let capture: MediaStreamAudioDestinationNode | null = null;
let armed = false;

function ensureContext() {
  if (typeof AudioContext === "undefined") return null;
  if (!context) {
    context = new AudioContext();
    capture = context.createMediaStreamDestination();
  }
  return context;
}

/** Start routing new voice audio into the recording; returns its audio track. */
export function armRecordingAudio(): MediaStreamTrack | null {
  const ctx = ensureContext();
  if (!ctx || !capture) return null;
  // Called from the Record click, so the browser allows resuming here.
  void ctx.resume().catch(() => {});
  armed = true;
  return capture.stream.getAudioTracks()[0] ?? null;
}

export function disarmRecordingAudio() {
  armed = false;
}

/** Wrap a newly created voice element so it is captured while recording. */
export function routeRecordingAudio<A extends HTMLMediaElement>(audio: A): A {
  if (!armed || !context || !capture) return audio;
  try {
    const source = context.createMediaElementSource(audio);
    source.connect(context.destination);
    source.connect(capture);
  } catch {
    // Keep normal playback if the element cannot join the graph.
  }
  return audio;
}
