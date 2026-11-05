// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TimelineTrack, type TimelineTrackProps } from "../src/TimelineTrack";
import {
  allMotions,
  duration,
  starterScene,
  type Entity,
  type Motion,
  type Scene,
} from "../shared/scene";

type Clip = Entity["clips"][number];
const TRACK_WIDTH = 600;
let container: HTMLDivElement, root: Root;
const captured = new Set<number>();
const route = (): Motion => ({
  id: "imported-route",
  name: "Casual walking route",
  kind: "imported",
  sourceAssetId: "cmu-capture-141-19",
  animationName: "141_19",
  duration: 12,
  distance: 0,
  poses: [],
  path: {
    smooth: false,
    points: [
      [0, 0, 0],
      [0, 0, 2],
      [2, 0, 2],
    ],
  },
});
const routeClip = (over: Partial<Clip> = {}): Clip => ({
  id: "route-clip",
  motionId: "imported-route",
  duration: 6,
  playbackRate: 1,
  ...over,
});
/** The starter café, with a drawn route after Mila's wave and talk unless
 * the sequence is given. */
function fixture(clips?: Clip[]) {
  const scene = starterScene();
  scene.customMotions.push(route());
  if (clips) scene.entities[0].clips = clips;
  else scene.entities[0].clips.push(routeClip());
  return scene;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // jsdom has neither pointer capture nor layout; fake both.
  const capture: Record<string, (id: number) => boolean | void> = {
    setPointerCapture: (id) => {
      captured.add(id);
    },
    releasePointerCapture: (id) => {
      captured.delete(id);
    },
    hasPointerCapture: (id) => captured.has(id),
  };
  for (const [name, value] of Object.entries(capture))
    Object.defineProperty(Element.prototype, name, {
      value,
      configurable: true,
    });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: TRACK_WIDTH,
    bottom: 28,
    width: TRACK_WIDTH,
    height: 28,
    toJSON: () => ({}),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  captured.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function callbacks() {
  return {
    onSelect: vi.fn(),
    onAdd: vi.fn(),
    onEditStart: vi.fn(),
    onRetime: vi.fn(),
    onEditPath: vi.fn(),
    onRemoveClip: vi.fn(),
    onDeselectClip: vi.fn(),
  };
}
async function render(scene: Scene, over: Partial<TimelineTrackProps> = {}) {
  const cast = scene.entities.filter((e) => e.clips.length);
  const fns = callbacks();
  const props: TimelineTrackProps = {
    entity: cast[0],
    index: 0,
    total: duration(scene),
    cast,
    motions: new Map(allMotions(scene).map((m) => [m.id, m])),
    dialogueClips: new Set(),
    selected: true,
    selectedClipId: null,
    playhead: { current: 0 },
    shortcuts: true,
    ...fns,
    ...over,
  };
  await act(async () => root.render(h(TimelineTrack, props)));
  return { fns, props, entity: cast[0] };
}
/** A pointer event as React sees it; jsdom has no PointerEvent class. */
async function pointer(
  target: Element,
  type: string,
  init: { clientX: number; shiftKey?: boolean; altKey?: boolean },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  await act(async () => void target.dispatchEvent(event));
}
const key = (target: EventTarget, key: string, init: KeyboardEventInit = {}) =>
  act(
    async () =>
      void target.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      ),
  );
const chips = () => [...container.querySelectorAll<HTMLElement>(".clip")];
const label = () => container.querySelector(".clip-drag-label")?.textContent;
const tenth = (seconds: number) => Math.round(seconds * 10) / 10;

describe("timeline track", () => {
  it("renders the row as before: clicks select the character or a clip, plus adds", async () => {
    const { fns, entity } = await render(fixture());
    const [wave, talk, path] = chips();
    expect(chips()).toHaveLength(3);
    expect(wave.getAttribute("role")).toBe("button");
    expect(wave.style.width).toBe(
      `${(entity.clips[0].duration / 16.483333349227905) * 100}%`,
    );
    expect(wave.title).toContain("Wave hello · 2.5s · 1×");
    expect(wave.title).not.toContain("Double-click");
    expect(path.title).toContain("Double-click to edit the path");
    // Only standalone takes trim; every retimable chip has a right handle.
    expect(wave.querySelector(".clip-handle.start")).not.toBeNull();
    expect(talk.querySelector(".clip-handle.end")).not.toBeNull();
    expect(path.querySelector(".clip-handle.start")).toBeNull();
    expect(path.querySelector(".clip-handle.end")).not.toBeNull();
    await act(async () => wave.click());
    expect(fns.onSelect).toHaveBeenLastCalledWith(
      entity.id,
      entity.clips[0].id,
    );
    await act(async () =>
      container.querySelector<HTMLElement>(".track-character")!.click(),
    );
    expect(fns.onSelect).toHaveBeenLastCalledWith(entity.id, null);
    await act(async () =>
      container.querySelector<HTMLElement>(".add-clip")!.click(),
    );
    expect(fns.onAdd).toHaveBeenCalledWith(entity.id);
    await key(wave, "Enter");
    expect(fns.onSelect).toHaveBeenCalledTimes(3);
  });

  it("previews a right-edge drag, commits exactly one retime on release and swallows the click", async () => {
    const scene = fixture();
    const { fns, props, entity } = await render(scene);
    const clip = entity.clips[0];
    const expected = tenth(clip.duration + (40 * props.total) / TRACK_WIDTH);
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.end")!;
    await pointer(handle, "pointerdown", { clientX: 100 });
    expect(captured.has(1)).toBe(true);
    await pointer(handle, "pointermove", { clientX: 102 });
    expect(fns.onEditStart).not.toHaveBeenCalled();
    await pointer(handle, "pointermove", { clientX: 120 });
    await pointer(handle, "pointermove", { clientX: 140 });
    expect(fns.onEditStart).toHaveBeenCalledTimes(1);
    expect(fns.onRetime).not.toHaveBeenCalled();
    expect(label()).toBe(`${expected.toFixed(1)} s`);
    expect(chips()[0].style.width).toBe(`${(expected / props.total) * 100}%`);
    expect(chips()[0].classList.contains("dragging")).toBe(true);
    await pointer(handle, "pointerup", { clientX: 140 });
    expect(fns.onRetime).toHaveBeenCalledTimes(1);
    expect(fns.onRetime.mock.calls[0]).toEqual([
      {
        type: "retimeClip",
        id: entity.id,
        clipId: clip.id,
        duration: expected,
      },
      expected,
    ]);
    expect(label()).toBeUndefined();
    expect(captured.size).toBe(0);
    await act(async () => chips()[0].click());
    await act(
      async () =>
        void chips()[0].dispatchEvent(
          new MouseEvent("dblclick", { bubbles: true }),
        ),
    );
    expect(fns.onSelect).not.toHaveBeenCalled();
    expect(fns.onEditPath).not.toHaveBeenCalled();
  });

  it("cancels on Escape, pointer cancel and window blur without committing", async () => {
    const { fns, entity } = await render(fixture());
    const width = chips()[0].style.width;
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.end")!;
    for (const cancel of ["escape", "pointercancel", "blur"]) {
      await pointer(handle, "pointerdown", { clientX: 100 });
      await pointer(handle, "pointermove", { clientX: 160 });
      expect(label()).toBeDefined();
      if (cancel === "escape") await key(window, "Escape");
      if (cancel === "pointercancel")
        await pointer(handle, "pointercancel", { clientX: 160 });
      if (cancel === "blur")
        await act(async () => void window.dispatchEvent(new Event("blur")));
      expect(label()).toBeUndefined();
      expect(chips()[0].style.width).toBe(width);
      await pointer(handle, "pointerup", { clientX: 160 });
      expect(fns.onRetime).not.toHaveBeenCalled();
    }
    expect(fns.onDeselectClip).not.toHaveBeenCalled();
    expect(entity.clips[0].duration).toBeCloseTo(2.4833, 3);
  });

  it("snaps with Shift and stretches a take with Alt", async () => {
    const scene = fixture();
    const { fns, props, entity } = await render(scene, {
      playhead: { current: 4 },
    });
    const clip = entity.clips[0];
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.end")!;
    const px = (seconds: number) => (seconds * TRACK_WIDTH) / props.total;
    await pointer(handle, "pointerdown", { clientX: 100 });
    await pointer(handle, "pointermove", {
      clientX: 100 + px(4.04 - clip.duration),
      shiftKey: true,
    });
    expect(label()).toBe("4.0 s · snapped to the playhead");
    await pointer(handle, "pointermove", {
      clientX: 100 + px(4.04 - clip.duration),
      altKey: true,
    });
    const stretched = clip.duration / 4;
    expect(label()).toBe(`4.0 s · ${Number(stretched.toFixed(2))}×`);
    await pointer(handle, "pointerup", {
      clientX: 100 + px(4.04 - clip.duration),
      altKey: true,
    });
    expect(fns.onRetime).toHaveBeenCalledTimes(1);
    expect(fns.onRetime.mock.calls[0][0]).toEqual({
      type: "retimeClip",
      id: entity.id,
      clipId: clip.id,
      duration: 4,
      playbackRate: stretched,
    });
  });

  it("trims into a take from its left edge, previewing the row as it will land", async () => {
    const scene = fixture();
    const { fns, props, entity } = await render(scene);
    const clip = entity.clips[0];
    const talkWidth = chips()[1].style.width;
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.start")!;
    await pointer(handle, "pointerdown", { clientX: 10 });
    await pointer(handle, "pointermove", {
      clientX: 10 + (1 * TRACK_WIDTH) / props.total,
    });
    const trimmed = tenth(clip.duration - 1);
    expect(label()).toBe(
      `${trimmed.toFixed(1)} s · starts ${(clip.duration - trimmed).toFixed(2)} s into the recording`,
    );
    // No gap opens: the start stays put, the chip shrinks from its right edge
    // and the next chips follow it, exactly as the commit will lay them out.
    expect(chips()[0].style.marginLeft).toBe("");
    expect(chips()[0].style.width).toBe(`${(trimmed / props.total) * 100}%`);
    expect(chips()[1].style.width).toBe(talkWidth);
    await pointer(handle, "pointerup", {
      clientX: 10 + (1 * TRACK_WIDTH) / props.total,
    });
    expect(fns.onRetime).toHaveBeenCalledTimes(1);
    const [command, edgeTime] = fns.onRetime.mock.calls[0];
    expect(command).toMatchObject({
      type: "retimeClip",
      clipId: clip.id,
      duration: trimmed,
    });
    expect(command.sourceStart).toBeCloseTo(clip.duration - trimmed, 3);
    expect(edgeTime).toBe(0);
  });

  it("cuts a take to the frame under the playhead with Shift, only when it has that frame", async () => {
    const scene = fixture();
    scene.entities[0].clips[1].sourceStart = 1;
    const playhead = { current: 1 };
    const { props } = await render(scene, { playhead });
    const px = (seconds: number) => (seconds * TRACK_WIDTH) / props.total;
    const wave = chips()[0].querySelector<HTMLElement>(".clip-handle.start")!;
    await pointer(wave, "pointerdown", { clientX: 10 });
    await pointer(wave, "pointermove", {
      clientX: 10 + px(1.03),
      shiftKey: true,
    });
    expect(label()).toBe(
      "1.48 s · starts 1.0 s into the recording · cut to the playhead",
    );
    await pointer(wave, "pointercancel", { clientX: 10 + px(1.03) });
    // A playhead just before Talk is within snapping distance of its edge but
    // shows none of its frames, so restoring trimmed frames stays an ordinary
    // drag rather than a cut.
    playhead.current = 2.3;
    const talk = chips()[1].querySelector<HTMLElement>(".clip-handle.start")!;
    await pointer(talk, "pointerdown", { clientX: 100 });
    await pointer(talk, "pointermove", {
      clientX: 100 - px(0.2),
      shiftKey: true,
    });
    expect(label()).toBe("8.2 s · starts 0.8 s into the recording");
    await pointer(talk, "pointercancel", { clientX: 100 - px(0.2) });
  });

  it("commits nothing when the pointer comes back to where it pressed, yet swallows the click", async () => {
    const { fns, entity } = await render(fixture());
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.end")!;
    await pointer(handle, "pointerdown", { clientX: 100 });
    await pointer(handle, "pointermove", { clientX: 140 });
    await pointer(handle, "pointermove", { clientX: 101 });
    expect(label()).toBe("2.48 s");
    expect(chips()[0].style.width).toBe(
      `${(entity.clips[0].duration / 16.483333349227905) * 100}%`,
    );
    await pointer(handle, "pointerup", { clientX: 101 });
    expect(fns.onEditStart).toHaveBeenCalledTimes(1);
    expect(fns.onRetime).not.toHaveBeenCalled();
    await act(async () => chips()[0].click());
    expect(fns.onSelect).not.toHaveBeenCalled();
  });

  it("drags a stopped route by its right edge only and sends just the length", async () => {
    const scene = fixture([routeClip({ routeStop: 2 })]);
    const { fns, props, entity } = await render(scene);
    const [chip] = chips();
    expect(chip.querySelector(".clip-handle.start")).toBeNull();
    expect(chip.title).toContain("Drag the right edge");
    const handle = chip.querySelector<HTMLElement>(".clip-handle.end")!;
    await pointer(handle, "pointerdown", { clientX: 200 });
    await pointer(handle, "pointermove", {
      clientX: 200 + (1 * TRACK_WIDTH) / props.total,
    });
    // A stopped route keeps its walking time, so no speed hint.
    expect(label()).toBe("7.0 s");
    await pointer(handle, "pointerup", {
      clientX: 200 + (1 * TRACK_WIDTH) / props.total,
    });
    expect(fns.onRetime).toHaveBeenCalledWith(
      { type: "retimeClip", id: entity.id, clipId: "route-clip", duration: 7 },
      7,
    );
  });

  it("tells how a route's walking speed changes with its length", async () => {
    const { props } = await render(fixture([routeClip()]));
    const handle = chips()[0].querySelector<HTMLElement>(".clip-handle.end")!;
    await pointer(handle, "pointerdown", { clientX: 200 });
    await pointer(handle, "pointermove", {
      clientX: 200 + (6 * TRACK_WIDTH) / props.total,
    });
    expect(label()).toBe("12.0 s · 0.5× speed");
    await pointer(handle, "pointercancel", { clientX: 200 });
  });

  it("shows a frozen wait without handles or hints, yet lets Delete remove it", async () => {
    const scene = fixture([
      routeClip({ routeStop: 2 }),
      routeClip({
        id: "wait",
        duration: 3,
        routeWait: "route-clip",
        transition: "cut",
      }),
    ]);
    const { fns, entity } = await render(scene, { selectedClipId: "wait" });
    const wait = chips()[1];
    expect(wait.title).toBe("Wait for clear route · 3s");
    expect(wait.querySelector(".clip-handle")).toBeNull();
    expect(wait.classList.contains("selected")).toBe(true);
    await key(window, "Delete");
    expect(fns.onRemoveClip).toHaveBeenCalledWith(entity.id, "wait");
  });

  it("double-clicking a route chip asks to edit its path; other chips just select", async () => {
    const { fns, entity } = await render(fixture());
    const dblclick = (chip: Element) =>
      act(
        async () =>
          void chip.dispatchEvent(
            new MouseEvent("dblclick", { bubbles: true }),
          ),
      );
    await dblclick(chips()[2]);
    expect(fns.onEditPath).toHaveBeenCalledWith(entity.id, "route-clip");
    await dblclick(chips()[1]);
    expect(fns.onEditPath).toHaveBeenCalledTimes(1);
    expect(fns.onSelect).toHaveBeenLastCalledWith(
      entity.id,
      entity.clips[1].id,
    );
  });

  it("removes the selected clip with Delete or Backspace and clears it with Escape", async () => {
    const scene = fixture();
    const clip = scene.entities[0].clips[1];
    const { fns, entity } = await render(scene, { selectedClipId: clip.id });
    expect(chips()[1].classList.contains("selected")).toBe(true);
    await key(window, "Delete");
    expect(fns.onRemoveClip).toHaveBeenCalledWith(entity.id, clip.id);
    // A held key repeats; only the first press removes.
    await key(window, "Delete", { repeat: true });
    expect(fns.onRemoveClip).toHaveBeenCalledTimes(1);
    await key(document.body, "Backspace");
    expect(fns.onRemoveClip).toHaveBeenCalledTimes(2);
    // Typing in a field never deletes.
    const input = document.createElement("input");
    document.body.append(input);
    await key(input, "Delete");
    expect(fns.onRemoveClip).toHaveBeenCalledTimes(2);
    input.remove();
    await key(window, "Escape");
    expect(fns.onDeselectClip).toHaveBeenCalledTimes(1);
  });

  it("leaves the keyboard alone while a dialog is open or nothing is selected", async () => {
    const scene = fixture();
    const { fns } = await render(scene, {
      selectedClipId: scene.entities[0].clips[0].id,
      shortcuts: false,
    });
    await key(window, "Delete");
    const unselected = await render(scene);
    await key(window, "Delete");
    expect(fns.onRemoveClip).not.toHaveBeenCalled();
    expect(unselected.fns.onRemoveClip).not.toHaveBeenCalled();
  });
});
