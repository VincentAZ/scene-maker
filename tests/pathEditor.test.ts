// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PathEditor } from "../src/PathEditor";
import { starterScene, type Motion } from "../shared/scene";
import type { PointAction } from "../shared/path";

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
  vi.clearAllMocks();
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
    onPlan?: (targetId: string, movement: "walk" | "run") => Motion;
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
