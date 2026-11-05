// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import * as T from "three";
import { createRoot, type Root } from "react-dom/client";
import { PathEditor } from "../src/PathEditor";
import { starterScene, validateScene, type Motion } from "../shared/scene";
import { capturedMotions, capturedRouteGaits } from "../shared/motionLibrary";

/** A recorded walk other than the studio stride, as an imported gait choice. */
const casualWalk = capturedMotions.find((m) => m.id === "captured-141-19")!;
import type { PointAction } from "../shared/path";
import { loadImportedAsset } from "../src/importedAsset";
import { locomotionProfile, locomotionScale } from "../src/locomotion";

vi.mock("../src/importedAsset", () => ({ loadImportedAsset: vi.fn() }));
vi.mock("../src/locomotion", async (original) => ({
  ...(await original<typeof import("../src/locomotion")>()),
  locomotionProfile: vi.fn(),
  locomotionScale: vi.fn(),
}));
const suppliedCycle = { distance: 1.5, duration: 1 };
const overrideCycle = () => suppliedCycle;

let container: HTMLDivElement, root: Root;
const onSave = vi.fn();
const route = (): Motion => ({
  id: "test-route",
  name: "My route",
  kind: "walk",
  duration: 12,
  distance: 0,
  poses: [],
  path: {
    smooth: true,
    points: [
      [0, 0, 0],
      [2, 0, 2],
      [4, 0, 0],
      [3, 0, -2],
      [0, 0, -1],
    ],
  },
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadImportedAsset).mockRejectedValue(
    new Error("Unexpected asset load in this test"),
  );
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    value: vi.fn(),
    configurable: true,
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    value: vi.fn(),
    configurable: true,
  });
  // jsdom lays nothing out: the map's scroll into view is a no-op here.
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: vi.fn(),
    configurable: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
function query<E extends Element>(selector: string): E {
  const result = container.querySelector<E>(selector);
  if (!result) throw Error(`Missing ${selector}`);
  return result;
}
async function render(
  options: {
    speechDuration?: number;
    motion?: Motion;
    locomotionCycle?: (
      motion: Motion,
    ) => { distance: number; duration: number } | undefined;
    onPlan?: (
      targetId: string,
      movement: "walk" | "run",
      locomotion?: Motion,
    ) => Motion;
    onClose?: () => void;
  } = {},
) {
  const scene = starterScene(),
    actor = scene.entities[0];
  actor.position = [0, 0, 0];
  actor.rotation = 0;
  actor.scale = 1;
  actor.clips = [];
  await act(async () =>
    root.render(
      createElement(PathEditor, {
        scene,
        actor,
        frame: { position: actor.position, heading: 0, scale: 1 },
        motion: route(),
        onSave,
        onClose: vi.fn(),
        locomotionCycle: overrideCycle,
        ...options,
      }),
    ),
  );
}
async function changeSelect(label: string, value: string) {
  await act(async () => {
    const select = query<HTMLSelectElement>(`select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function changeInput(label: string, value: string) {
  await act(async () => {
    const input = query<HTMLInputElement>(`input[aria-label="${label}"]`);
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) {
  const button = [
    ...container.querySelectorAll<HTMLButtonElement>("button"),
  ].find(
    (button) =>
      button.textContent?.includes(label) ||
      button.getAttribute("aria-label") === label,
  );
  if (!button) throw Error(`Missing button ${label}`);
  await act(async () => button.click());
}
function savedActions() {
  return onSave.mock.lastCall![1] as PointAction[] | undefined;
}

it("reopens a migrated procedural backward route on the recorded backward walk and keeps it through replanning and saves", async () => {
  // Procedural backpedalling is gone: loading migrates such a route onto the
  // captured "Walk backwards" take, whose body already faces away from travel.
  const scene = starterScene();
  scene.customMotions = [
    { ...route(), path: { ...route().path!, backward: true } },
  ];
  scene.entities[0].clips = [
    { id: "back", motionId: route().id, duration: 12 },
  ];
  const motion = validateScene(scene).customMotions[0];
  expect(motion).toMatchObject({
    kind: "imported",
    animationName: "143_39",
    path: { points: route().path!.points },
  });
  expect(motion.path!.backward).toBeUndefined();
  const onPlan = vi.fn<
    (targetId: string, movement: "walk" | "run", locomotion?: Motion) => Motion
  >(() => motion);
  await render({ motion, onPlan });
  expect(container.textContent).not.toContain("Move backward");
  const locomotion = query<HTMLSelectElement>(
    'select[aria-label="Route locomotion"]',
  );
  expect(
    locomotion.selectedOptions[0].textContent?.startsWith("Walk backwards"),
  ).toBe(true);
  const destination = query<HTMLSelectElement>(
    'select[aria-label="Route destination"]',
  );
  await changeSelect("Route destination", destination.options[1].value);
  await click("Plan a clear route");
  expect(onPlan.mock.calls[0]?.[2]).toMatchObject({
    kind: "imported",
    animationName: "143_39",
  });
  await changeInput("Point 1 across", "3");
  await click("Save path");
  expect(onSave.mock.lastCall![0]).toMatchObject({
    kind: "imported",
    sourceAssetId: motion.sourceAssetId,
    animationName: "143_39",
  });
  expect(onSave.mock.lastCall![0].path.backward).toBeUndefined();
});

describe("PathEditor waypoint actions", () => {
  it("provides a distinct action and duration for all four points, including the final point", async () => {
    await render();
    for (const [index, action] of ["wave", "bow", "talk", "idle"].entries()) {
      await changeSelect(`Point ${index + 1} action`, action);
      await changeInput(
        `Point ${index + 1} action duration`,
        String(index + 1),
      );
    }
    expect(container.textContent).toContain("22.0 seconds total");
    expect(container.textContent).toContain("edit each clip separately");
    await click("Save path");
    expect(savedActions()).toEqual([
      { pointIndex: 1, motionId: "wave", duration: 1 },
      { pointIndex: 2, motionId: "bow", duration: 2 },
      { pointIndex: 3, motionId: "talk", duration: 3 },
      { pointIndex: 4, motionId: "idle", duration: 4 },
    ]);
    expect(onSave.mock.lastCall![0].duration).toBe(12);
  });

  it("keeps actions on moved points, removes only the deleted point's action, and adds unassigned points", async () => {
    await render();
    await changeSelect("Point 1 action", "wave");
    await changeSelect("Point 2 action", "bow");
    await changeSelect("Point 3 action", "talk");
    await changeInput("Point 3 across", "7");
    await click("Remove point 2");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 2 action"]').value,
    ).toBe("talk");
    await click("Add point");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 4 action"]').value,
    ).toBe("");
    await click("Save path");
    expect(savedActions()?.map((a) => [a.pointIndex, a.motionId])).toEqual([
      [1, "wave"],
      [2, "talk"],
    ]);
    expect(onSave.mock.lastCall![0].path.points[2][0]).toBe(7);
  });

  it("matches actions to unchanged world points when replanning, never to a new point sharing an index", async () => {
    await render({
      onPlan: () => ({
        ...route(),
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            [1, 0, 1],
            [2, 0, 2],
            [0, 0, -1],
          ],
        },
      }),
    });
    await changeSelect("Point 1 action", "wave");
    await changeSelect("Point 2 action", "bow");
    await changeSelect("Point 4 action", "idle");
    const destination = query<HTMLSelectElement>(
      'select[aria-label="Route destination"]',
    );
    await changeSelect("Route destination", destination.options[1].value);
    await click("Plan a clear route");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 1 action"]').value,
    ).toBe("");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 2 action"]').value,
    ).toBe("wave");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 3 action"]').value,
    ).toBe("idle");
    expect(query<HTMLElement>('[role="status"]').textContent).toContain(
      "1 point action was removed",
    );
    await click("Save path");
    expect(savedActions()?.map((a) => [a.pointIndex, a.motionId])).toEqual([
      [2, "wave"],
      [3, "idle"],
    ]);
    // Undoing the plan brings the actions back and drops its notice.
    await click("Undo path edit");
    expect(container.textContent).not.toContain("1 point action was removed");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 1 action"]').value,
    ).toBe("wave");
  });

  it("keeps route-only saves unchanged and clears actions on start over", async () => {
    await render();
    await click("Save path");
    expect(savedActions()).toBeUndefined();
    await changeSelect("Point 1 action", "wave");
    await click("Start over");
    await click("Add point");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 1 action"]').value,
    ).toBe("");
  });

  it("does not allow invalid action durations or point actions on a dialogue route", async () => {
    await render();
    await changeSelect("Point 1 action", "wave");
    await changeInput("Point 1 action duration", "0");
    expect(query<HTMLButtonElement>(".path-footer .primary").disabled).toBe(
      true,
    );
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ speechDuration: 8 });
    expect(container.querySelector(".path-point-actions")).toBeNull();
    expect(container.textContent).toContain(
      "Point actions are unavailable on a dialogue route",
    );
    await click("Use for this line");
    expect(savedActions()).toBeUndefined();
    expect(onSave.mock.lastCall![0].duration).toBe(8);
  });
});

describe("PathEditor imported locomotion", () => {
  it("defaults new routes to a captured walking stride while keeping legacy route choices unchanged", async () => {
    await render({ motion: undefined });
    expect(
      query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
    ).toBe("captured-walking-stride");
    expect(container.textContent).toContain("Keeps the original animation");
    await click("Add point");
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      kind: "imported",
      sourceAssetId: "cmu-capture-35-01",
      animationName: "35_01",
      distance: 0,
      poses: [],
    });
  });

  it("saves the selected original gait identity, including the recorded take behind Run", async () => {
    await render();
    await changeSelect("Route locomotion", casualWalk.id);
    await click("Save path");
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      id: route().id,
      kind: "imported",
      sourceAssetId: "cmu-capture-141-19",
      animationName: "141_19",
      duration: 12,
      path: route().path,
    });
    await changeSelect("Route locomotion", "run");
    expect(
      query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
    ).toBe("run");
    await click("Save path");
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      kind: "imported",
      sourceAssetId: "cmu-capture-35-17",
      animationName: "35_17",
    });
  });

  it("reopens imported routes by source identity and keeps the gait through replanning", async () => {
    // The recorded running stride: its identity includes its source interval.
    const original = capturedRouteGaits[1];
    const onPlan = vi.fn(() => route());
    await render({
      motion: {
        ...route(),
        kind: "imported",
        sourceAssetId: original.sourceAssetId,
        animationName: original.animationName,
        path: {
          ...route().path!,
          sourceRange: { ...original.path!.sourceRange! },
        },
      },
      onPlan,
    });
    expect(
      query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
    ).toBe("captured-running-stride");
    const destination = query<HTMLSelectElement>(
      'select[aria-label="Route destination"]',
    );
    await changeSelect("Route destination", destination.options[1].value);
    await click("Plan a clear route");
    expect(onPlan).toHaveBeenCalledWith(
      destination.options[1].value,
      "run",
      original,
      suppliedCycle,
    );
    await click("Save path");
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      kind: "imported",
      sourceAssetId: original.sourceAssetId,
      animationName: original.animationName,
    });
  });

  it("uses loaded gait cycle measurements for natural pace", async () => {
    await render({
      motion: {
        ...route(),
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            [0, 0, 6],
          ],
        },
      },
      locomotionCycle: () => ({ distance: 1.5, duration: 1 }),
    });
    await changeSelect("Route locomotion", casualWalk.id);
    await click("Keep natural pace");
    await click("Save path");
    expect(onSave.mock.lastCall?.[0].duration).toBe(4);
    expect(container.textContent).not.toContain("Natural pace is estimated");
    expect(loadImportedAsset).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("preserves a selected source interval through edits and saves exact imported natural pace", async () => {
  const motion: Motion = {
    ...casualWalk,
    id: "window-route",
    duration: 8,
    path: {
      points: [
        [0, 0, 0],
        [0, 0, 2.34],
      ],
      smooth: false,
      sourceRange: { start: 0.2, end: 0.9 },
      strideScale: 1.05,
      sourceProgress: [0, 1],
    },
  };
  await render({
    motion,
    locomotionCycle: () => ({ distance: 1.5, duration: 1 }),
  });
  expect(
    query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
  ).toBe("window-route");
  expect(container.textContent).toContain(
    "Selected source interval: 0.2–0.9s.",
  );
  expect(container.textContent).toContain(
    "Average step length: 105% of the captured gait.",
  );
  await click("Keep natural pace");
  await click("Save path");
  expect(onSave.mock.lastCall![0].path.strideScale).toBe(1.05);
  expect(onSave.mock.lastCall![0].path.sourceProgress).toEqual([0, 1]);
  expect(onSave.mock.lastCall![0].duration).toBeCloseTo(1.56, 12);
  expect(container.textContent).toContain("Source playback: 1×.");
  expect(onSave.mock.lastCall![0].path.sourceRange).toEqual({
    start: 0.2,
    end: 0.9,
  });
  await changeInput("Route duration", "3.12");
  expect(container.textContent).toContain("Source playback: 0.5×.");
  await changeInput("Point 1 across", "0.2");
  await click("Save path");
  expect(onSave.mock.lastCall![0].path.sourceProgress).toBeUndefined();
  // Choosing the whole original take drops the saved interval and step scale.
  await changeSelect("Route locomotion", casualWalk.id);
  await click("Save path");
  expect(onSave.mock.lastCall![0].path.sourceRange).toBeUndefined();
  expect(onSave.mock.lastCall![0].path.strideScale).toBeUndefined();
});
function measuredSource(animationName = "35_01") {
  const source = new T.Group();
  source.userData.animations = [new T.AnimationClip(animationName, 2, [])];
  vi.mocked(locomotionProfile).mockImplementation((_source, clip, range) => ({
    frames: [],
    distance: 1.5,
    duration: range ? range.end - range.start : clip.duration,
    startHeading: 0,
    warning: "",
    mode: "travel",
  }));
  vi.mocked(locomotionScale).mockReturnValue(2);
  return source;
}

describe("PathEditor production gait measurement", () => {
  it("waits for the actual source then updates automatic duration without using route metadata", async () => {
    const pending = deferred<T.Group>();
    const source = measuredSource();
    vi.mocked(loadImportedAsset).mockReturnValue(pending.promise);
    await render({ motion: undefined, locomotionCycle: undefined });
    await click("Add point");
    await changeInput("Point 1 across", "6");
    expect(container.textContent).toContain("Measuring the original gait");
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("");
    expect(query<HTMLButtonElement>(".path-footer .primary").disabled).toBe(
      true,
    );
    await act(async () => pending.resolve(source));
    // 1.5 source metres * target/source ratio 2 over the selected 134/120-second
    // stride: the field shows it to the hundredth, the save keeps it exact.
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("2.23");
    expect(container.textContent).toContain("Measured natural pace: 2.69 m/s");
    expect(locomotionProfile).toHaveBeenCalledWith(
      source,
      source.userData.animations[0],
      { start: 1.1, end: 266 / 120 },
    );
    expect(loadImportedAsset).toHaveBeenCalledTimes(1);
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0].duration).toBeCloseTo(134 / 60, 10);
    // Keeping the duration keeps the number the creator saw.
    await click("Keep duration");
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("2.23");
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0].duration).toBe(2.23);
  });

  it("retains a manually chosen duration when asynchronous measurement finishes", async () => {
    const pending = deferred<T.Group>();
    const source = measuredSource();
    vi.mocked(loadImportedAsset).mockReturnValue(pending.promise);
    await render({ motion: undefined, locomotionCycle: undefined });
    await click("Add point");
    await changeInput("Route duration", "9");
    await act(async () => pending.resolve(source));
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("9");
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0].duration).toBe(9);
  });

  it("reports source loading failure, forbids guessed saves, and allows retry", async () => {
    vi.mocked(loadImportedAsset).mockRejectedValueOnce(
      new Error("Download failed (503)"),
    );
    await render({ motion: undefined, locomotionCycle: undefined });
    await click("Add point");
    expect(query<HTMLElement>('[role="alert"]').textContent).toContain(
      "Could not load gait source",
    );
    expect(container.textContent).toContain("Download failed (503)");
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("");
    await click("Add to sequence");
    expect(onSave).not.toHaveBeenCalled();
    vi.mocked(loadImportedAsset).mockResolvedValueOnce(measuredSource());
    await click("Retry gait measurement");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(query<HTMLButtonElement>(".path-footer .primary").disabled).toBe(
      false,
    );
  });

  it("ignores and disposes a stale source after changing gait", async () => {
    const stale = deferred<T.Group>(),
      current = deferred<T.Group>();
    const oldSource = measuredSource("35_01"),
      nextSource = measuredSource("35_17");
    const geometry = new T.BoxGeometry(),
      material = new T.MeshBasicMaterial();
    oldSource.add(new T.Mesh(geometry, material));
    const dispose = vi.spyOn(geometry, "dispose");
    vi.mocked(loadImportedAsset)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    await render({ motion: undefined, locomotionCycle: undefined });
    await click("Add point");
    // From the default walking stride to studio Run (the whole 35_17 take).
    await changeSelect("Route locomotion", "run");
    await act(async () => current.resolve(nextSource));
    const duration = query<HTMLInputElement>(
      'input[aria-label="Route duration"]',
    ).value;
    await act(async () => stale.resolve(oldSource));
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(locomotionProfile).toHaveBeenCalledTimes(1);
    expect(locomotionProfile).toHaveBeenCalledWith(
      nextSource,
      nextSource.userData.animations[0],
      undefined,
    );
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe(duration);
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0].animationName).toBe("35_17");
  });

  it("does not load assets or silently guess when an explicit override has no cycle", async () => {
    await render({ motion: undefined, locomotionCycle: () => undefined });
    expect(loadImportedAsset).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Measure this imported gait");
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("");
    // Studio Walk is a recording too: there is no fixed procedural pace to
    // fall back on, so it still needs a measured cycle.
    await changeSelect("Route locomotion", "walk");
    expect(
      query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
    ).toBe("walk");
    expect(container.textContent).toContain("Measure this imported gait");
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe("");
    expect(loadImportedAsset).not.toHaveBeenCalled();
  });
});

/** The map at its drawn size: one map unit per screen pixel. */
function mockMapRect() {
  const svg = query<SVGSVGElement>("svg.path-map");
  svg.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 600,
      bottom: 400,
      width: 600,
      height: 400,
      toJSON: () => ({}),
    }) as DOMRect;
  return svg;
}
function mapPositions(): [number, number][] {
  return [
    ...container.querySelectorAll<SVGGElement>(
      "svg.path-map .path-start, svg.path-map .path-point",
    ),
  ].map((group) => {
    const match = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(
      group.getAttribute("transform")!,
    )!;
    return [Number(match[1]), Number(match[2])];
  });
}
async function pointer(
  target: Element | Window,
  type: string,
  x: number,
  y: number,
  init: MouseEventInit = {},
) {
  await act(async () =>
    target.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        button: 0,
        ...init,
      }),
    ),
  );
}
async function keyEvent(
  type: "keydown" | "keyup",
  init: KeyboardEventInit,
  target: Element | Window = window,
) {
  const event = new KeyboardEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => target.dispatchEvent(event));
  return event;
}
const key = (init: KeyboardEventInit, target: Element | Window = window) =>
  keyEvent("keydown", init, target);
const asking = () => container.querySelector('[role="alertdialog"]') !== null;
const undoButton = () =>
  [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === "Undo path edit",
  )!;
const inputValue = (label: string) =>
  Number(query<HTMLInputElement>(`input[aria-label="${label}"]`).value);
const corner = (): Motion => ({
  ...route(),
  path: {
    smooth: false,
    points: [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 4],
    ],
  },
});

describe("PathEditor map editing", () => {
  beforeEach(() => {
    for (const method of [
      "setPointerCapture",
      "releasePointerCapture",
      "hasPointerCapture",
    ])
      Object.defineProperty(Element.prototype, method, {
        value: vi.fn(),
        configurable: true,
      });
  });

  it("inserts a point into the segment under a click on the route and appends elsewhere", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [start, first, second] = mapPositions();
    await pointer(
      svg,
      "click",
      (start[0] + first[0]) / 2,
      (start[1] + first[1]) / 2,
    );
    expect(mapPositions()).toHaveLength(4);
    expect(inputValue("Point 1 across")).toBeCloseTo(2, 1);
    expect(inputValue("Point 1 along")).toBeCloseTo(0, 1);
    expect(inputValue("Point 2 across")).toBeCloseTo(4, 1);
    // The new point is selected, with its remove control beside it.
    expect(container.querySelector(".path-point.selected")).not.toBeNull();
    expect(container.textContent).toContain("Point 1 is selected");
    await pointer(
      query('svg.path-map [aria-label="Remove point 1"]'),
      "click",
      0,
      0,
    );
    expect(mapPositions()).toHaveLength(3);
    // Away from the route a click still appends after the last point.
    await pointer(svg, "click", second[0] + 90, second[1] + 60);
    const scale = (first[0] - start[0]) / 4;
    expect(mapPositions()).toHaveLength(4);
    expect(inputValue("Point 3 across")).toBeCloseTo(4 + 90 / scale, 1);
    expect(inputValue("Point 3 along")).toBeCloseTo(4 + 60 / scale, 1);
  });

  it("inserts between the right pair of points on a smooth curve", async () => {
    await render();
    const svg = mockMapRect();
    const samples = query<SVGPolylineElement>("svg.path-map polyline")
      .getAttribute("points")!
      .split(" ")
      .map((pair) => pair.split(",").map(Number));
    // A sample well inside the second span, between points 1 and 2.
    const [x, y] = samples[60];
    await pointer(svg, "click", x, y);
    expect(mapPositions()).toHaveLength(6);
    const [start, first] = mapPositions();
    const scale = (first[0] - start[0]) / 2;
    expect(inputValue("Point 2 across")).toBeCloseTo((x - start[0]) / scale, 1);
    expect(inputValue("Point 2 along")).toBeCloseTo((y - start[1]) / scale, 1);
    expect(inputValue("Point 3 across")).toBeCloseTo(4, 1);
  });

  it("drags points with the pointer, swallows the click that ends a drag, and undoes and redoes the move", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [start, first] = mapPositions();
    const scale = (first[0] - start[0]) / 4;
    const point = query("svg.path-map .path-point");
    await pointer(point, "pointerdown", first[0], first[1]);
    await pointer(svg, "pointermove", first[0] + 1, first[1]);
    // A jiggle under the drag threshold leaves the point where it was.
    expect(inputValue("Point 1 across")).toBe(4);
    await pointer(svg, "pointermove", first[0] + 60, first[1] + 30);
    await pointer(svg, "pointerup", first[0] + 60, first[1] + 30);
    await pointer(svg, "click", first[0] + 60, first[1] + 30);
    expect(mapPositions()).toHaveLength(3);
    expect(mapPositions()[1][0]).toBeCloseTo(first[0] + 60, 6);
    expect(mapPositions()[1][1]).toBeCloseTo(first[1] + 30, 6);
    expect(inputValue("Point 1 across")).toBeCloseTo(4 + 60 / scale, 1);
    expect(inputValue("Point 1 along")).toBeCloseTo(30 / scale, 1);
    await key({ key: "z", ctrlKey: true });
    expect(inputValue("Point 1 across")).toBe(4);
    expect(inputValue("Point 1 along")).toBe(0);
    await key({ key: "z", ctrlKey: true, shiftKey: true });
    expect(inputValue("Point 1 across")).toBeCloseTo(4 + 60 / scale, 1);
    await key({ key: "z", metaKey: true });
    expect(inputValue("Point 1 across")).toBe(4);
    await key({ key: "y", ctrlKey: true });
    expect(inputValue("Point 1 across")).toBeCloseTo(4 + 60 / scale, 1);
    await click("Save path");
    expect(onSave.mock.lastCall![0].path.points[1][0]).toBeCloseTo(
      4 + 60 / scale,
      1,
    );
  });

  it("selects a point on the map and removes it with Delete or Backspace, never the start", async () => {
    await render();
    const svg = mockMapRect();
    const positions = mapPositions();
    const points = container.querySelectorAll("svg.path-map .path-point");
    await pointer(points[1], "pointerdown", ...positions[2]);
    await pointer(svg, "pointerup", ...positions[2]);
    expect(points[1].classList.contains("selected")).toBe(true);
    expect(container.textContent).toContain("Point 2 is selected");
    // Keys typed into a field belong to the field.
    await key({ key: "Delete" }, query('input[aria-label="Point 1 across"]'));
    expect(mapPositions()).toHaveLength(5);
    await key({ key: "Delete" });
    expect(mapPositions()).toHaveLength(4);
    expect(container.querySelector(".path-point.selected")).toBeNull();
    expect(inputValue("Point 2 across")).toBe(3);
    await pointer(
      query("svg.path-map .path-point"),
      "pointerdown",
      ...mapPositions()[1],
    );
    await pointer(svg, "pointerup", ...mapPositions()[1]);
    await key({ key: "Backspace" });
    expect(mapPositions()).toHaveLength(3);
    await pointer(query("svg.path-map .path-start"), "pointerdown", 0, 0);
    await pointer(svg, "pointerup", 0, 0);
    await key({ key: "Delete" });
    expect(mapPositions()).toHaveLength(3);
    expect(container.querySelector(".path-start.selected")).toBeNull();
  });

  it("nudges the selected point with the arrow keys", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [, first] = mapPositions();
    await pointer(query("svg.path-map .path-point"), "pointerdown", ...first);
    await pointer(svg, "pointerup", ...first);
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowUp", shiftKey: true });
    expect(inputValue("Point 1 across")).toBeCloseTo(4.02, 6);
    expect(inputValue("Point 1 along")).toBeCloseTo(-0.1, 6);
    // One undo step covers the run of nudges.
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBe(4);
    expect(inputValue("Point 1 along")).toBe(0);
  });

  it("offers Undo and Redo buttons over every waypoint change", async () => {
    await render();
    const undo = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Undo path edit",
      )!;
    const redo = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.getAttribute("aria-label") === "Redo path edit",
      )!;
    expect(undo().disabled).toBe(true);
    expect(redo().disabled).toBe(true);
    await click("Add point");
    await changeSelect("Point 5 action", "wave");
    expect(mapPositions()).toHaveLength(6);
    expect(undo().disabled).toBe(false);
    await click("Undo path edit");
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 5 action"]').value,
    ).toBe("");
    await click("Undo path edit");
    expect(mapPositions()).toHaveLength(5);
    expect(undo().disabled).toBe(true);
    expect(redo().disabled).toBe(false);
    await click("Redo path edit");
    await click("Redo path edit");
    expect(mapPositions()).toHaveLength(6);
    expect(
      query<HTMLSelectElement>('select[aria-label="Point 5 action"]').value,
    ).toBe("wave");
    await click("Start over");
    expect(mapPositions()).toHaveLength(1);
    await click("Undo path edit");
    expect(mapPositions()).toHaveLength(6);
  });

  it("zooms about the cursor with the wheel, pans by dragging the background, and refits", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const before = mapPositions();
    const wheel = new WheelEvent("wheel", {
      deltaY: -100,
      clientX: before[1][0],
      clientY: before[1][1],
      bubbles: true,
      cancelable: true,
    });
    await act(async () => svg.dispatchEvent(wheel));
    // The page must not scroll while the map zooms.
    expect(wheel.defaultPrevented).toBe(true);
    const zoomed = mapPositions();
    expect(zoomed[1][0]).toBeCloseTo(before[1][0], 6);
    expect(zoomed[1][1]).toBeCloseTo(before[1][1], 6);
    expect(zoomed[2][1] - zoomed[1][1]).toBeCloseTo(
      (before[2][1] - before[1][1]) * Math.exp(0.15),
      6,
    );
    await pointer(svg, "pointerdown", 300, 200);
    await pointer(svg, "pointermove", 340, 220);
    await pointer(svg, "pointerup", 340, 220);
    await pointer(svg, "click", 340, 220);
    const panned = mapPositions();
    expect(panned).toHaveLength(3);
    expect(panned[0][0]).toBeCloseTo(zoomed[0][0] + 40, 6);
    expect(panned[0][1]).toBeCloseTo(zoomed[0][1] + 20, 6);
    // Dragged points may leave the original frame: nothing clamps them.
    await pointer(
      query("svg.path-map .path-point"),
      "pointerdown",
      ...panned[1],
    );
    await pointer(svg, "pointermove", 700, -50);
    await pointer(svg, "pointerup", 700, -50);
    expect(mapPositions()[1][0]).toBeCloseTo(700, 6);
    expect(mapPositions()[1][1]).toBeCloseTo(-50, 6);
    await click("Fit");
    const fitted = mapPositions();
    expect(
      fitted.every(([x, y]) => x >= 0 && x <= 600 && y >= 0 && y <= 400),
    ).toBe(true);
  });

  it("warns live about points too close together or too far away and disables saving", async () => {
    await render({ motion: corner() });
    const save = () => query<HTMLButtonElement>(".path-footer .primary");
    expect(container.querySelector(".path-warning")).toBeNull();
    await changeInput("Point 1 across", "60");
    expect(query('[role="alert"]').textContent).toContain(
      "Point 1 is more than 50 m from the start",
    );
    expect(save().disabled).toBe(true);
    await changeInput("Point 1 across", "4");
    expect(container.querySelector(".path-warning")).toBeNull();
    expect(save().disabled).toBe(false);
    await changeInput("Point 2 along", "0.02");
    expect(query('[role="alert"]').textContent).toContain(
      "Point 2 is too close to point 1",
    );
    expect(save().disabled).toBe(true);
    await changeInput("Point 2 along", "4");
    await click("Save path");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("draws direction arrows and lets the arrival facing be dragged, kept and cleared", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    expect(
      container.querySelectorAll("svg.path-map .path-arrow").length,
    ).toBeGreaterThanOrEqual(5);
    const heading = query('svg.path-map [aria-label="Facing on arrival"]');
    expect(
      heading.closest(".path-heading")!.classList.contains("natural"),
    ).toBe(true);
    expect(container.textContent).not.toContain(
      "Use path direction on arrival",
    );
    const [, , last] = mapPositions();
    await pointer(heading, "pointerdown", last[0], last[1] + 46);
    // Towards +X from the last point: a quarter turn in path terms.
    await pointer(svg, "pointermove", last[0] + 80, last[1]);
    await pointer(svg, "pointerup", last[0] + 80, last[1]);
    expect(
      heading.closest(".path-heading")!.classList.contains("natural"),
    ).toBe(false);
    await click("Save path");
    expect(onSave.mock.lastCall![0].path.endHeading).toBeCloseTo(
      Math.PI / 2,
      6,
    );
    await click("Undo path edit");
    expect(container.textContent).not.toContain(
      "Use path direction on arrival",
    );
    await click("Redo path edit");
    await click("Use path direction on arrival");
    await click("Save path");
    expect(onSave.mock.lastCall![0].path.endHeading).toBeUndefined();
  });

  it("explains keeping the duration against the natural pace and switches between them", async () => {
    await render({
      motion: {
        ...route(),
        path: {
          smooth: false,
          points: [
            [0, 0, 0],
            [0, 0, 6],
          ],
        },
      },
    });
    const pressed = () =>
      query<HTMLButtonElement>(
        '[aria-label="Route timing"] button[aria-pressed="true"]',
      ).textContent;
    expect(pressed()).toBe("Keep duration");
    expect(inputValue("Route duration")).toBe(12);
    expect(container.textContent).toContain(
      "Keeping 12.0 s for 6.0 m: Mila moves at 0.50 m/s, against a natural 1.50 m/s.",
    );
    expect(container.textContent).toContain(
      "Keeping the duration changes this rate",
    );
    await click("Keep natural pace");
    expect(pressed()).toBe("Keep natural pace");
    expect(inputValue("Route duration")).toBe(4);
    expect(container.textContent).not.toContain("Keeping 4.0 s");
    expect(container.textContent).toContain(
      "Natural pace keeps the recording at its own speed",
    );
    // Shortening the route under natural pace shortens the duration…
    await changeInput("Point 1 along", "3");
    expect(inputValue("Route duration")).toBe(2);
    // …while keeping the duration locks the current value as the route changes.
    await click("Keep duration");
    expect(pressed()).toBe("Keep duration");
    expect(inputValue("Route duration")).toBe(2);
    await changeInput("Point 1 along", "6");
    expect(inputValue("Route duration")).toBe(2);
    expect(container.textContent).toContain("Mila moves at 3.00 m/s");
    await changeInput("Route duration", "9");
    expect(pressed()).toBe("Keep duration");
    await click("Save path");
    expect(onSave.mock.lastCall![0].duration).toBe(9);
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({ speechDuration: 8 });
    expect(container.querySelector('[aria-label="Route timing"]')).toBeNull();
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').disabled,
    ).toBe(true);
  });

  it("closes untouched routes at once but asks before discarding changes, from Cancel and Escape alike", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await click("Cancel");
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    root = createRoot(container);
    onClose.mockClear();
    await render({ onClose });
    await click("Add point");
    await click("Cancel");
    expect(onClose).not.toHaveBeenCalled();
    expect(query('[role="alertdialog"]').textContent).toContain(
      "Discard changes to this path?",
    );
    await click("Keep editing");
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Escape reaches the dialog as a cancel event and asks the same question.
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => query("dialog").dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    expect(query('[role="alertdialog"]').textContent).toContain(
      "Discard changes to this path?",
    );
    await click("Discard");
    expect(onClose).toHaveBeenCalledTimes(1);
    // Undoing back to the saved shape counts as untouched again.
    await act(async () => root.unmount());
    root = createRoot(container);
    onClose.mockClear();
    await render({ onClose });
    await click("Add point");
    await click("Undo path edit");
    await click("Cancel");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("takes Escape from its keydown, keeps editing on a second Escape or X, and hands focus back to the map", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    const svg = mockMapRect();
    expect(document.activeElement).toBe(svg);
    await click("Add point");
    const escape = await key({ key: "Escape" });
    // The browser's own close request is pre-empted, so it cannot force the
    // dialog shut on a repeat.
    expect(escape.defaultPrevented).toBe(true);
    expect(asking()).toBe(true);
    expect(document.activeElement?.textContent).toBe("Keep editing");
    // Holding the key does not flip the question away again.
    const held = await key({ key: "Escape", repeat: true });
    expect(held.defaultPrevented).toBe(true);
    expect(asking()).toBe(true);
    // A cancel event raised for the same press is not a second request.
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => query("dialog").dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(asking()).toBe(true);
    await keyEvent("keyup", { key: "Escape" });
    await key({ key: "Escape" });
    expect(asking()).toBe(false);
    expect(document.activeElement).toBe(svg);
    await click("Close dialog");
    expect(asking()).toBe(true);
    await click("Close dialog");
    expect(asking()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    // The question is not needed for an untouched route.
    await click("Undo path edit");
    await key({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cancels a drag in progress on Escape instead of asking to close", async () => {
    const onClose = vi.fn();
    await render({ motion: corner(), onClose });
    const svg = mockMapRect();
    const [, first] = mapPositions();
    await pointer(query("svg.path-map .path-point"), "pointerdown", ...first);
    await pointer(svg, "pointermove", first[0] + 60, first[1] + 30);
    expect(inputValue("Point 1 across")).not.toBe(4);
    await key({ key: "Escape" });
    expect(inputValue("Point 1 across")).toBe(4);
    expect(inputValue("Point 1 along")).toBe(0);
    expect(asking()).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    // The pointer is still down: moving no longer drags, and the release is
    // not a click that would add a point.
    await pointer(svg, "pointermove", first[0] + 90, first[1] + 90);
    await pointer(svg, "pointerup", first[0] + 90, first[1] + 90);
    await pointer(svg, "click", first[0] + 90, first[1] + 90);
    expect(mapPositions()).toHaveLength(3);
    expect(inputValue("Point 1 across")).toBe(4);
    // Nothing of the cancelled drag is left to undo.
    expect(undoButton().disabled).toBe(true);
    // The arrival handle and a pan are abandoned the same way.
    const [, , last] = mapPositions();
    await pointer(
      query('svg.path-map [aria-label="Facing on arrival"]'),
      "pointerdown",
      last[0],
      last[1] + 46,
    );
    await pointer(svg, "pointermove", last[0] + 80, last[1]);
    expect(container.textContent).toContain("Use path direction on arrival");
    await key({ key: "Escape" });
    expect(container.textContent).not.toContain(
      "Use path direction on arrival",
    );
    await pointer(svg, "pointerup", last[0] + 80, last[1]);
    const [start] = mapPositions();
    await pointer(svg, "pointerdown", 300, 200);
    await pointer(svg, "pointermove", 340, 220);
    expect(mapPositions()[0][0]).toBeCloseTo(start[0] + 40, 6);
    await key({ key: "Escape" });
    expect(mapPositions()[0]).toEqual(start);
    await pointer(svg, "pointerup", 340, 220);
    expect(mapPositions()[1]).toEqual(first);
    expect(undoButton().disabled).toBe(true);
    await key({ key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps point shortcuts while a map button has focus but not while the discard question shows", async () => {
    await render();
    // A clicked button keeps focus, so Add point then the arrows still nudge
    // the new point.
    const add = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Add point"),
    )!;
    await act(async () => {
      add.focus();
      add.click();
    });
    expect(container.textContent).toContain("Point 5 is selected");
    await key({ key: "ArrowRight" }, add);
    expect(inputValue("Point 5 across")).toBeCloseTo(1.01, 6);
    // A changed route asks before closing; the question keeps the keys.
    await click("Cancel");
    expect(asking()).toBe(true);
    await key({ key: "Delete" });
    await key({ key: "ArrowRight" });
    expect(mapPositions()).toHaveLength(6);
    expect(inputValue("Point 5 across")).toBeCloseTo(1.01, 6);
    await click("Keep editing");
    await key({ key: "Delete" }, add);
    expect(mapPositions()).toHaveLength(5);
  });

  it("keeps a drag that starts during a run of nudges as one step and holds keys until it ends", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [, first, second] = mapPositions();
    const points = container.querySelectorAll("svg.path-map .path-point");
    await pointer(points[0], "pointerdown", ...first);
    await pointer(svg, "pointerup", ...first);
    await key({ key: "ArrowRight" });
    // The pause that ends the nudge run falls inside this drag of point 2.
    await pointer(points[1], "pointerdown", ...second);
    await pointer(svg, "pointermove", second[0] + 30, second[1]);
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    await pointer(svg, "pointermove", second[0] + 60, second[1]);
    // Nothing is removed, nudged or undone under the pointer.
    await key({ key: "Delete" });
    await key({ key: "ArrowRight" });
    await key({ key: "z", ctrlKey: true });
    await pointer(svg, "pointerup", second[0] + 60, second[1]);
    expect(mapPositions()).toHaveLength(3);
    expect(mapPositions()[2][0]).toBeCloseTo(second[0] + 60, 6);
    await click("Undo path edit");
    expect(mapPositions()[2]).toEqual(second);
    expect(inputValue("Point 1 across")).toBeCloseTo(4.01, 6);
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBe(4);
  });

  it("forgets a held Space and abandons a drag when the window loses focus", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [start, first] = mapPositions();
    await key({ key: " " });
    // The Space keyup went to another window: the point drags, the map stays.
    await act(async () => window.dispatchEvent(new Event("blur")));
    await pointer(query("svg.path-map .path-point"), "pointerdown", ...first);
    await pointer(svg, "pointermove", first[0] + 60, first[1]);
    await pointer(svg, "pointerup", first[0] + 60, first[1]);
    expect(mapPositions()[0]).toEqual(start);
    const moved = mapPositions()[1];
    expect(moved[0]).toBeCloseTo(first[0] + 60, 6);
    await pointer(query("svg.path-map .path-point"), "pointerdown", ...moved);
    await pointer(svg, "pointermove", moved[0] + 50, moved[1] + 50);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(mapPositions()[1]).toEqual(moved);
  });

  it("shows long durations to the hundredth, saves an untouched one exactly and keeps typed text", async () => {
    const exact = 7.887670281609524;
    await render({ motion: { ...route(), duration: exact } });
    const field = () =>
      query<HTMLInputElement>('input[aria-label="Route duration"]');
    expect(field().value).toBe("7.89");
    // Already keeping the duration: pressing it again changes nothing.
    await click("Keep duration");
    await click("Save path");
    expect(onSave.mock.lastCall![0].duration).toBe(exact);
    await changeInput("Route duration", "7.125");
    expect(field().value).toBe("7.125");
    await click("Save path");
    expect(onSave.mock.lastCall![0].duration).toBe(7.125);
    await changeInput("Route duration", "");
    expect(field().value).toBe("");
    expect(query<HTMLButtonElement>(".path-footer .primary").disabled).toBe(
      true,
    );
    await click("Undo path edit");
    expect(field().value).toBe("7.89");
  });

  it("drops the discard question when undo makes the route clean again", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await click("Add point");
    await click("Cancel");
    expect(asking()).toBe(true);
    await click("Undo path edit");
    expect(asking()).toBe(false);
    // Changing the route again does not bring the question back by itself.
    await click("Add point");
    expect(asking()).toBe(false);
    await click("Undo path edit");
    await click("Cancel");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("seals a run of nudges after a pause and typed coordinates when the field is left", async () => {
    await render({ motion: corner() });
    const svg = mockMapRect();
    const [, first] = mapPositions();
    await pointer(query("svg.path-map .path-point"), "pointerdown", ...first);
    await pointer(svg, "pointerup", ...first);
    await key({ key: "ArrowRight" });
    await key({ key: "ArrowRight" });
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    await key({ key: "ArrowRight" });
    expect(inputValue("Point 1 across")).toBeCloseTo(4.03, 6);
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBeCloseTo(4.02, 6);
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBe(4);
    const across = query<HTMLInputElement>(
      'input[aria-label="Point 1 across"]',
    );
    await changeInput("Point 1 across", "5");
    await changeInput("Point 1 across", "6");
    await act(async () => {
      across.focus();
      across.blur();
    });
    await changeInput("Point 1 across", "7");
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBe(6);
    await click("Undo path edit");
    expect(inputValue("Point 1 across")).toBe(4);
  });

  it("starts over without the old arrival facing and takes a plan back whole", async () => {
    const onPlan = vi.fn(() => ({
      ...route(),
      name: "Planned route",
      path: {
        smooth: false,
        points: [
          [0, 0, 0],
          [1, 0, 1],
          [2, 0, 2],
        ] as [number, number, number][],
        endHeading: 2,
      },
    }));
    await render({
      motion: { ...route(), path: { ...route().path!, endHeading: 1 } },
      onPlan,
    });
    const nameField = () => query<HTMLInputElement>(".path-options input");
    const smoothBox = () => query<HTMLInputElement>(".path-smooth input");
    const pressed = () =>
      query<HTMLButtonElement>(
        '[aria-label="Route timing"] button[aria-pressed="true"]',
      ).textContent;
    expect(container.textContent).toContain("Use path direction on arrival");
    await click("Start over");
    await click("Add point");
    expect(container.textContent).not.toContain(
      "Use path direction on arrival",
    );
    expect(
      query('svg.path-map [aria-label="Facing on arrival"]')
        .closest(".path-heading")!
        .classList.contains("natural"),
    ).toBe(true);
    await click("Save path");
    expect(onSave.mock.lastCall![0].path.endHeading).toBeUndefined();
    await click("Undo path edit");
    await click("Undo path edit");
    expect(mapPositions()).toHaveLength(5);
    expect(container.textContent).toContain("Use path direction on arrival");
    // A plan changes the name, smoothing and timing along with the points.
    const destination = query<HTMLSelectElement>(
      'select[aria-label="Route destination"]',
    );
    await changeSelect("Route destination", destination.options[1].value);
    await click("Plan a clear route");
    expect(mapPositions()).toHaveLength(3);
    expect(nameField().value).toBe("Planned route");
    expect(smoothBox().checked).toBe(false);
    expect(pressed()).toBe("Keep natural pace");
    await click("Undo path edit");
    expect(mapPositions()).toHaveLength(5);
    expect(nameField().value).toBe("My route");
    expect(smoothBox().checked).toBe(true);
    expect(pressed()).toBe("Keep duration");
    expect(inputValue("Route duration")).toBe(12);
    await click("Save path");
    expect(onSave.mock.lastCall![0]).toMatchObject({
      name: "My route",
      duration: 12,
      path: { smooth: true, endHeading: 1 },
    });
    await click("Redo path edit");
    expect(nameField().value).toBe("Planned route");
    expect(pressed()).toBe("Keep natural pace");
    // Typing a name is one step until the field is left.
    await changeInput("Route duration", "9");
    await act(async () => {
      const field = nameField();
      field.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(field, "Walk over");
      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.blur();
    });
    await click("Undo path edit");
    expect(nameField().value).toBe("Planned route");
    expect(inputValue("Route duration")).toBe(9);
    await click("Undo path edit");
    expect(pressed()).toBe("Keep natural pace");
  });
});

it("closes on a backdrop click but not on a drag that starts inside and ends over the backdrop", async () => {
  const onClose = vi.fn();
  await render({ onClose });
  const dialog = query("dialog"),
    svg = mockMapRect();
  await pointer(svg, "pointerdown", 300, 200);
  await pointer(svg, "pointermove", 340, 220);
  await pointer(svg, "pointerup", 340, 220);
  await pointer(dialog, "click", -20, 220);
  expect(onClose).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  await pointer(dialog, "pointerdown", -20, 220);
  await pointer(dialog, "click", -20, 220);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the editor in step when the browser forces the dialog shut", async () => {
  const onClose = vi.fn();
  await render({ onClose });
  const dialog = query<HTMLDialogElement>("dialog");
  const reopen = vi.mocked(HTMLDialogElement.prototype.showModal);
  reopen.mockClear();
  // A changed route: the question appears and the dialog is shown again.
  await click("Add point");
  await act(async () => {
    dialog.dispatchEvent(new Event("close"));
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  expect(onClose).not.toHaveBeenCalled();
  expect(query('[role="alertdialog"]').textContent).toContain(
    "Discard changes to this path?",
  );
  expect(reopen).toHaveBeenCalledTimes(1);
  await click("Discard");
  expect(onClose).toHaveBeenCalledTimes(1);
});
