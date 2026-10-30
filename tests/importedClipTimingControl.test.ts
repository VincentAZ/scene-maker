// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportedClipTiming } from "../src/ImportedClipTiming";
import { allMotions, starterScene, type Entity } from "../shared/scene";

let container: HTMLDivElement;
let root: Root;
const motion = {
  ...allMotions(starterScene()).find((motion) => motion.kind === "imported")!,
  duration: 4,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(clip: Entity["clips"][number]) {
  const onChange = vi.fn();
  act(() =>
    root.render(h(ImportedClipTiming, { clip, motion, index: 0, onChange })),
  );
  return onChange;
}
function setRate(value: string) {
  const input = container.querySelector("input")!;
  const set = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("imported clip timing controls", () => {
  it("shows native trim/hold semantics and emits only an explicit speed edit", () => {
    const onChange = render({
      id: "clip",
      motionId: motion.id,
      duration: 6,
      playbackRate: 1,
    });
    expect(container.querySelector("input")!.value).toBe("1");
    expect(container.textContent).toContain("hold the final pose for 2s");
    expect(container.textContent).toContain("never changes speed");
    expect(container.querySelector('[role="status"]')).toBeNull();
    setRate("2");
    expect(onChange).toHaveBeenLastCalledWith({
      playbackRate: 2,
      legacyFit: undefined,
    });
    setRate("0");
    setRate("-1");
    setRate("301");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("allows incomplete fractional input without persisting an invalid zero rate", () => {
    const onChange = render({
      id: "clip",
      motionId: motion.id,
      duration: 4,
      playbackRate: 1,
    });
    setRate("0");
    expect(container.querySelector("input")!.value).toBe("0");
    expect(onChange).not.toHaveBeenCalled();
    setRate("0.5");
    expect(onChange).toHaveBeenCalledWith({
      playbackRate: 0.5,
      legacyFit: undefined,
    });
  });

  it("explains legacy fitting and lets the user opt into 1× without changing duration", () => {
    const onChange = render({
      id: "old",
      motionId: motion.id,
      duration: 8,
      playbackRate: 0.5,
      legacyFit: true,
    });
    expect(container.querySelector('[role="status"]')!.textContent).toContain(
      "Legacy fit preserved at 0.5×",
    );
    expect(container.querySelector("input")!.value).toBe("0.5");
    act(() => container.querySelector("button")!.click());
    expect(onChange).toHaveBeenCalledWith({
      playbackRate: 1,
      legacyFit: undefined,
    });
  });

  it("also labels unvalidated old clips rather than displaying them as native", () => {
    render({ id: "old", motionId: motion.id, duration: 2 });
    expect(container.querySelector("input")!.value).toBe("2");
    expect(container.textContent).toContain("Legacy fit preserved at 2×");
  });
});
