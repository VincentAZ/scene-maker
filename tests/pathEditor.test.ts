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
    // 1.5 source metres * target/source ratio 2 over the selected 134/120-second stride.
    expect(
      query<HTMLInputElement>('input[aria-label="Route duration"]').value,
    ).toBe(String(134 / 60));
    expect(container.textContent).toContain("Measured natural pace: 2.69 m/s");
    expect(locomotionProfile).toHaveBeenCalledWith(
      source,
      source.userData.animations[0],
      { start: 1.1, end: 266 / 120 },
    );
    expect(loadImportedAsset).toHaveBeenCalledTimes(1);
    await click("Add to sequence");
    expect(onSave.mock.lastCall?.[0].duration).toBeCloseTo(134 / 60, 10);
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
async function key(init: KeyboardEventInit, target: Element | Window = window) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    ),
  );
}
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
