// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import * as T from "three";
import { createRoot, type Root } from "react-dom/client";
import { PathEditor } from "../src/PathEditor";
import { starterScene, validateScene, type Motion } from "../shared/scene";
import { libraryMotions } from "../shared/motionLibrary";
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
    await changeSelect("Route locomotion", "authored-walk-carry");
    await click("Save path");
    expect(onSave.mock.lastCall?.[0]).toMatchObject({
      id: route().id,
      kind: "imported",
      sourceAssetId: "quaternius-action-source",
      animationName: "Walk_Carry",
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
    const original = libraryMotions.find(
      (motion) => motion.id === "authored-run",
    )!;
    const onPlan = vi.fn(() => route());
    await render({
      motion: {
        ...route(),
        kind: "imported",
        sourceAssetId: original.sourceAssetId,
        animationName: original.animationName,
      },
      onPlan,
    });
    expect(
      query<HTMLSelectElement>('select[aria-label="Route locomotion"]').value,
    ).toBe("authored-run");
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
      animationName: "Run",
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
    await changeSelect("Route locomotion", "authored-walk");
    await click("Use natural pace");
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
  const original = libraryMotions.find((m) => m.id === "authored-walk")!;
  const motion: Motion = {
    ...original,
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
  await click("Use natural pace");
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
  await changeSelect("Route locomotion", "authored-walk");
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
    const oldSource = measuredSource("Walk"),
      nextSource = measuredSource("Run");
    const geometry = new T.BoxGeometry(),
      material = new T.MeshBasicMaterial();
    oldSource.add(new T.Mesh(geometry, material));
    const dispose = vi.spyOn(geometry, "dispose");
    vi.mocked(loadImportedAsset)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);
    await render({ motion: undefined, locomotionCycle: undefined });
    await click("Add point");
    await changeSelect("Route locomotion", "authored-run");
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
    expect(onSave.mock.lastCall?.[0].animationName).toBe("Run");
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
