// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { usePlayhead } from "../src/usePlayhead";

it("keeps a queued seek authoritative over late renderer updates, including a repeated timestamp", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let playhead!: ReturnType<typeof usePlayhead>;
  function Probe() {
    playhead = usePlayhead();
    return null;
  }
  const host = document.createElement("div"),
    root = createRoot(host);
  try {
    act(() => root.render(createElement(Probe)));
    act(() => playhead.publish(0.4, 0));
    expect(playhead.time).toBe(0.4);
    const oldPublish = playhead.publish;
    act(() => {
      playhead.seek(0);
      oldPublish(0.5, 0);
    });
    expect(playhead.time).toBe(0);
    expect(playhead.seekVersion).toBe(1);
    act(() => playhead.publish(0.3, 1));
    act(() => {
      playhead.seek(0);
      oldPublish(0.6, 0);
      oldPublish(0.4, 1);
    });
    expect(playhead.time).toBe(0);
    expect(playhead.seekVersion).toBe(2);
    act(() => playhead.publish(0.2, 2));
    expect(playhead.time).toBe(0.2);
  } finally {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
