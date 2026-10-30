import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { starterScene, type Scene } from "../shared/scene";
import { gizmoEditing } from "../src/gizmoEditing";
import { objectTransform } from "../src/assetManipulation";
import type { TransformMode } from "../src/assetManipulation";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.unstubAllGlobals();
});

function box(x = 0, size: [number, number, number] = [1, 1, 1]) {
  const object = new T.Group();
  const mesh = new T.Mesh(
    new T.BoxGeometry(...size),
    new T.MeshBasicMaterial(),
  );
  mesh.position.y = size[1] / 2;
  object.add(mesh);
  object.position.x = x;
  return object;
}

function setup(mode: TransformMode = "translate") {
  const win = new EventTarget();
  const canvas = new EventTarget();
  vi.stubGlobal("window", win);
  let scene: Scene = starterScene();
  scene.entities = [
    {
      ...scene.entities[0],
      id: "actor",
      position: [0, 0, 0],
      rotation: 0,
      scale: 1,
      clips: [],
    },
  ];
  const object = box();
  object.userData.entityId = "actor";
  const world = new T.Scene();
  world.add(object);
  const objects = new Map([["actor", object]]);
  const transform = new TransformControls(new T.PerspectiveCamera());
  transform.attach(object);
  transform.setMode(mode);
  const orbit = { enabled: true };
  const status = { textContent: "", hidden: true };
  const onEditStart = vi.fn();
  const onMove = vi.fn();
  const onTransform = vi.fn();
  let backdrop: T.Object3D | null = null;
  let useOnTransform = true;
  const editor = gizmoEditing({
    transform,
    objects,
    current: () => ({
      scene,
      transformMode: mode,
      onEditStart,
      onMove,
      onTransform: useOnTransform ? onTransform : undefined,
    }),
    orbit,
    status: status as HTMLElement,
    environment: () => backdrop,
    canvas: canvas as HTMLCanvasElement,
  });
  cleanups.push(() => {
    editor.dispose();
    world.traverse((node) => {
      if (node instanceof T.Mesh) {
        node.geometry.dispose();
        node.material.dispose();
      }
    });
  });
  const begin = (axis: TransformControls["axis"] = "X") => {
    transform.axis = axis;
    transform.dragging = true;
  };
  const change = () => transform.dispatchEvent({ type: "objectChange" });
  const end = () => transform.pointerUp(null);
  const obstacle = (x: number, size?: [number, number, number]) => {
    const other = box(x, size);
    world.add(other);
    objects.set("wall", other);
    scene.entities.push({
      ...structuredClone(scene.entities[0]),
      id: "wall",
      name: "Wall",
    });
    return other;
  };
  return {
    win,
    canvas,
    world,
    object,
    objects,
    transform,
    orbit,
    status,
    onEditStart,
    onMove,
    onTransform,
    editor,
    begin,
    change,
    end,
    obstacle,
    scene: () => scene,
    setScene: (next: Scene) => {
      scene = next;
    },
    environment: (next: T.Object3D) => {
      backdrop = next;
    },
    useMove: () => {
      useOnTransform = false;
    },
  };
}

function expectIdle(h: ReturnType<typeof setup>) {
  expect(h.transform.dragging).toBe(false);
  expect(h.orbit.enabled).toBe(true);
  expect(h.status.hidden).toBe(true);
  expect(h.status.textContent).toBe("");
}
function expectNoCommit(h: ReturnType<typeof setup>) {
  expect(h.onMove).not.toHaveBeenCalled();
  expect(h.onTransform).not.toHaveBeenCalled();
}

describe("gizmo edit lifecycle", () => {
  it("commits one accepted preview as a delta from the evaluated pose, not a later animated root", () => {
    const h = setup();
    h.scene().entities[0].position = [1, 0, 2];
    h.object.position.set(3, 0, 4);
    h.begin();
    expect(h.onEditStart).toHaveBeenCalledOnce();
    expect(h.orbit.enabled).toBe(false);
    h.object.position.set(5, 1, 3);
    h.change();
    // Conversation/interaction passes may run between the pointer event and release.
    h.object.position.set(99, 99, 99);
    h.object.rotation.y = 1;
    h.object.scale.setScalar(7);
    h.end();
    expect(h.onTransform).toHaveBeenCalledExactlyOnceWith("actor", {
      position: [3, 1, 1],
      rotation: 0,
      scale: 1,
    });
    expect(h.object.position.toArray()).toEqual([5, 1, 3]);
    expect(h.object.scale.toArray()).toEqual([1, 1, 1]);
    expect(h.onMove).not.toHaveBeenCalled();
    expectIdle(h);
    h.end();
    expect(h.onTransform).toHaveBeenCalledOnce();
  });

  it("supports the existing onMove-only callback", () => {
    const h = setup();
    h.useMove();
    h.begin();
    h.object.position.x = 2;
    h.change();
    h.end();
    expect(h.onMove).toHaveBeenCalledExactlyOnceWith("actor", [2, 0, 0]);
    expect(h.onTransform).not.toHaveBeenCalled();
  });

  it("does not commit a no-op or unvalidated animation mutation", () => {
    const h = setup();
    const start = objectTransform(h.object);
    h.begin();
    h.change();
    h.object.position.set(5, 2, 1);
    h.object.rotation.set(1, 2, 3);
    h.object.scale.setScalar(3);
    h.end();
    expect(objectTransform(h.object)).toEqual(start);
    expectNoCommit(h);
    expectIdle(h);
  });

  it("does not commit a gesture returned to its original pose", () => {
    const h = setup();
    h.begin();
    h.object.position.x = 2;
    h.change();
    h.object.position.x = 0;
    h.change();
    h.end();
    expectNoCommit(h);
    expectIdle(h);
  });

  it("cancels back into an original overlap without routing restoration through the guard or reset", () => {
    const h = setup();
    h.object.position.x = 0.8;
    h.obstacle(0);
    const reset = vi.spyOn(h.transform, "reset");
    const start = objectTransform(h.object);
    h.begin();
    h.object.position.x = 1.5; // Escape an existing overlap.
    h.change();
    expect(h.object.position.x).toBe(1.5);
    h.editor.cancel();
    expect(objectTransform(h.object)).toEqual(start);
    expect(reset).not.toHaveBeenCalled();
    expectNoCommit(h);
    expectIdle(h);
  });

  it("reapplies the collision-guarded preview after all root animation mutations", () => {
    const h = setup();
    h.object.position.x = -2;
    h.obstacle(0, [0.05, 3, 5]);
    h.begin();
    h.object.position.x = -1;
    h.change();
    h.object.position.x = 2;
    h.change();
    expect(h.object.position.x).toBe(-1);
    expect(h.status.textContent).toContain("Blocked by Wall");
    for (let frame = 0; frame < 3; frame++) {
      h.object.position.set(10, 20, 30);
      h.object.rotation.set(0.2, 1.4, 0.3);
      h.object.scale.setScalar(4);
      h.editor.render();
      expect(h.object.position.toArray()).toEqual([-1, 0, 0]);
      expect(h.object.rotation.toArray()).toEqual([0, 0, 0, "XYZ"]);
      expect(h.object.scale.toArray()).toEqual([1, 1, 1]);
    }
    h.end();
    expect(h.onTransform.mock.lastCall?.[1].position).toEqual([1, 0, 0]);
    expectIdle(h);
  });

  it("guards against the environment and does not commit a wholly blocked edit", () => {
    const h = setup();
    h.object.position.x = -2;
    const wall = box(0, [0.05, 3, 5]);
    h.world.add(wall);
    h.environment(wall);
    h.begin();
    h.object.position.x = 2;
    h.change();
    expect(h.status.textContent).toContain("the backdrop");
    expect(h.object.position.x).toBe(-2);
    h.end();
    expectNoCommit(h);
    expectIdle(h);
  });
});

describe("normalized gizmo transforms", () => {
  it.each(["X", "Y", "Z", "XYZ"] as const)(
    "keeps %s scale uniform and persists it",
    (axis) => {
      const h = setup("scale");
      h.scene().entities[0].scale = 2;
      h.object.scale.setScalar(2);
      h.begin(axis);
      h.object.scale[axis === "Y" ? "y" : axis === "Z" ? "z" : "x"] = 3;
      h.change();
      expect(h.object.scale.toArray()).toEqual([3, 3, 3]);
      h.object.scale.setScalar(2); // Later base-pose evaluation.
      h.editor.render();
      expect(h.object.scale.toArray()).toEqual([3, 3, 3]);
      h.end();
      expect(h.onTransform.mock.lastCall?.[1].scale).toBe(3);
    },
  );

  it.each([
    [100, 10],
    [-1, 0.1],
  ])("clamps a scale candidate of %s to %s", (candidate, expected) => {
    const h = setup("scale");
    h.begin("Y");
    h.object.scale.y = candidate;
    h.change();
    expect(h.object.scale.toArray()).toEqual([expected, expected, expected]);
    h.end();
    expect(h.onTransform.mock.lastCall?.[1].scale).toBeCloseTo(expected);
  });

  it("retains evaluated scale deltas when normalizing and persisting", () => {
    const h = setup("scale");
    h.scene().entities[0].scale = 2;
    h.object.scale.setScalar(3);
    h.begin("Z");
    h.object.scale.z = 6;
    h.change();
    expect(h.object.scale.toArray()).toEqual([6, 6, 6]);
    h.end();
    expect(h.onTransform.mock.lastCall?.[1].scale).toBe(4);
  });

  it("normalizes quaternion rotation to pure yaw and preserves it across animation", () => {
    const h = setup("rotate");
    h.scene().entities[0].rotation = 0.4;
    h.object.rotation.y = 0.6;
    h.begin("Y");
    h.object.rotation.set(0.3, 1.9, -0.2);
    const forward = new T.Vector3(0, 0, 1).applyQuaternion(h.object.quaternion);
    const yaw = Math.atan2(forward.x, forward.z);
    h.change();
    expect(h.object.rotation.x).toBe(0);
    expect(h.object.rotation.z).toBe(0);
    expect(h.object.rotation.y).toBeCloseTo(yaw);
    h.object.rotation.set(1, 0.1, 1);
    h.editor.render();
    expect(h.object.rotation.toArray()).toEqual([0, yaw, 0, "XYZ"]);
    h.end();
    expect(h.onTransform.mock.lastCall?.[1].rotation).toBeCloseTo(
      0.4 + yaw - 0.6,
    );
  });

  it("persists the short yaw delta when crossing the pi boundary", () => {
    const h = setup("rotate");
    h.scene().entities[0].rotation = 2.6;
    h.object.rotation.y = 2.8;
    h.begin("Y");
    h.object.rotation.y = -2.8;
    h.change();
    h.end();
    const saved = h.onTransform.mock.lastCall?.[1].rotation;
    expect(saved).toBeCloseTo(-3);
    expect(Math.cos(saved! - (2.6 + Math.PI * 2 - 5.6))).toBeCloseTo(1);
  });
});

describe("stale gizmo transactions", () => {
  const mutations: [string, (h: ReturnType<typeof setup>) => void][] = [
    [
      "detached object",
      (h) => {
        h.transform.detach();
      },
    ],
    [
      "replaced model",
      (h) => {
        const replacement = box(10);
        replacement.userData.entityId = "actor";
        h.world.add(replacement);
        h.objects.set("actor", replacement);
        h.transform.attach(replacement);
      },
    ],
    [
      "replaced map identity",
      (h) => {
        h.objects.set("actor", box(10));
      },
    ],
    [
      "project switch",
      (h) => {
        h.setScene({ ...h.scene(), id: "different-project" });
      },
    ],
    [
      "changed entity data",
      (h) => {
        h.scene().entities[0].name = "Renamed elsewhere";
      },
    ],
    [
      "changed nested entity data",
      (h) => {
        h.scene().entities[0].clips.push({
          id: "new-clip",
          motionId: "idle",
          duration: 2,
        });
      },
    ],
    [
      "removed entity",
      (h) => {
        h.scene().entities = [];
      },
    ],
  ];
  it.each(mutations)(
    "cancels a %s on render without crashing",
    (_name, mutate) => {
      const h = setup();
      h.begin();
      h.object.position.x = 2;
      h.change();
      mutate(h);
      expect(() => h.editor.render()).not.toThrow();
      expect(h.object.position.x).toBe(0);
      expectIdle(h);
      expectNoCommit(h);
    },
  );
  it.each(mutations)(
    "refuses to commit a %s even without an intervening render",
    (_name, mutate) => {
      const h = setup();
      h.begin();
      h.object.position.x = 2;
      h.change();
      mutate(h);
      expect(h.end).not.toThrow();
      expect(h.object.position.x).toBe(0);
      expectNoCommit(h);
      expectIdle(h);
    },
  );

  it("compares captured entity content rather than object identity or scene revision", () => {
    const h = setup();
    h.begin();
    h.object.position.x = 2;
    h.change();
    const next = structuredClone(h.scene());
    next.revision += 1;
    next.name = "Unrelated scene change";
    h.setScene(next);
    h.editor.render();
    h.end();
    expect(h.onTransform).toHaveBeenCalledOnce();
  });

  it("captures entity data before onEditStart and detects its later mutation", () => {
    const h = setup();
    h.onEditStart.mockImplementation(() => {
      h.scene().entities[0].position[0] = 4;
    });
    h.begin();
    h.object.position.x = 2;
    h.change();
    expectNoCommit(h);
    expectIdle(h);
    expect(h.object.position.x).toBe(0);
  });
});

describe("gizmo cancellation events", () => {
  it.each(["Escape", "blur", "pointercancel"])(
    "restores the original pose on %s",
    (type) => {
      const h = setup();
      h.begin();
      h.object.position.x = 2;
      h.change();
      if (type === "Escape")
        h.win.dispatchEvent(
          Object.assign(new Event("keydown"), { key: "Escape" }),
        );
      else (type === "blur" ? h.win : h.canvas).dispatchEvent(new Event(type));
      expect(h.object.position.x).toBe(0);
      expectNoCommit(h);
      expectIdle(h);
    },
  );

  it("ignores non-Escape keys", () => {
    const h = setup();
    h.begin();
    h.win.dispatchEvent(Object.assign(new Event("keydown"), { key: "x" }));
    expect(h.transform.dragging).toBe(true);
    expect(h.orbit.enabled).toBe(false);
  });

  it("defers unexpected capture-loss cancellation and restores the original pose", async () => {
    const h = setup();
    h.begin();
    h.object.position.x = 2;
    h.change();
    h.canvas.dispatchEvent(new Event("lostpointercapture"));
    expect(h.transform.dragging).toBe(true);
    await Promise.resolve();
    expect(h.object.position.x).toBe(0);
    expectNoCommit(h);
    expectIdle(h);
  });

  it("lets normal Three capture release before pointerUp commit the preview", async () => {
    const h = setup();
    h.begin();
    h.object.position.x = 2;
    h.change();
    h.canvas.dispatchEvent(new Event("lostpointercapture"));
    h.end();
    await Promise.resolve();
    expect(h.object.position.x).toBe(2);
    expect(h.onTransform).toHaveBeenCalledOnce();
    expectIdle(h);
  });

  it("does not cancel a subsequent gesture from an old capture-loss microtask", async () => {
    const h = setup();
    h.begin();
    h.canvas.dispatchEvent(new Event("lostpointercapture"));
    h.end();
    h.begin();
    h.object.position.x = 3;
    h.change();
    await Promise.resolve();
    expect(h.transform.dragging).toBe(true);
    h.end();
    expect(h.onTransform).toHaveBeenCalledOnce();
  });

  it("disposes all listeners, cancels any preview, and ignores pending microtasks", async () => {
    const h = setup();
    const removeWindow = vi.spyOn(h.win, "removeEventListener");
    const removeCanvas = vi.spyOn(h.canvas, "removeEventListener");
    const removeTransform = vi.spyOn(h.transform, "removeEventListener");
    h.begin();
    h.object.position.x = 2;
    h.change();
    h.canvas.dispatchEvent(new Event("lostpointercapture"));
    h.editor.dispose();
    await Promise.resolve();
    expect(h.object.position.x).toBe(0);
    expectNoCommit(h);
    expectIdle(h);
    expect(removeWindow.mock.calls.map(([type]) => type).sort()).toEqual([
      "blur",
      "keydown",
    ]);
    expect(removeCanvas.mock.calls.map(([type]) => type).sort()).toEqual([
      "lostpointercapture",
      "pointercancel",
    ]);
    expect(removeTransform.mock.calls.map(([type]) => type).sort()).toEqual([
      "dragging-changed",
      "objectChange",
    ]);
    h.begin();
    h.object.position.x = 4;
    h.change();
    h.win.dispatchEvent(new Event("blur"));
    h.canvas.dispatchEvent(new Event("pointercancel"));
    h.editor.render();
    expect(h.object.position.x).toBe(4);
    expect(h.transform.dragging).toBe(true);
    h.end();
    expectNoCommit(h);
    expect(h.onEditStart).toHaveBeenCalledOnce();
  });
});
