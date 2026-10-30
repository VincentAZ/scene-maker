import { afterEach, describe, expect, it, vi } from "vitest";
import * as T from "three";
import { sceneDragging } from "../src/sceneDragging";
import { starterScene, props, environments, type Scene } from "../shared/scene";

class Surface extends EventTarget {
  classes = new Set<string>();
  classList = {
    add: (s: string) => this.classes.add(s),
    remove: (s: string) => this.classes.delete(s),
  };
  style = { cursor: "" };
  captured = new Set<number>();
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
    };
  }
  closest() {
    return this;
  }
  setPointerCapture(id: number) {
    this.captured.add(id);
  }
  releasePointerCapture(id: number) {
    this.captured.delete(id);
  }
  hasPointerCapture(id: number) {
    return this.captured.has(id);
  }
}
const event = (type: string, values: Record<string, unknown>) =>
  Object.assign(new Event(type, { cancelable: true }), {
    pointerId: 1,
    button: 0,
    clientX: 400,
    clientY: 300,
    ...values,
  });
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.unstubAllGlobals();
});
function setup() {
  const win = new EventTarget(),
    canvas = new Surface(),
    html = new Surface();
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", { documentElement: html });
  vi.stubGlobal("Element", Surface);
  const camera = new T.PerspectiveCamera(38, 800 / 600, 0.1, 100);
  camera.position.set(0, 6, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const world = new T.Scene(),
    object = new T.Group();
  object.userData.entityId = "actor";
  const mesh = new T.Mesh(
    new T.BoxGeometry(1, 2, 1),
    new T.MeshBasicMaterial(),
  );
  mesh.position.y = 1;
  object.add(mesh);
  world.add(object);
  world.updateMatrixWorld(true);
  let scene: Scene = starterScene();
  scene.entities = [
    { ...scene.entities[0], id: "actor", position: [0, 0, 0], clips: [] },
  ];
  const onMove = vi.fn(),
    onAdd = vi.fn(),
    onSelect = vi.fn(),
    onEditStart = vi.fn(),
    onError = vi.fn();
  const orbit = { enabled: true, enableDamping: true, update: vi.fn() },
    gizmo = { enabled: true, axis: null, dragging: false };
  const status = { textContent: "", hidden: true };
  const objects = new Map([["actor", object]]);
  const drag = sceneDragging({
    canvas: canvas as unknown as HTMLCanvasElement,
    camera,
    world,
    objects,
    current: () => ({ scene, onMove, onAdd, onSelect, onEditStart, onError }),
    orbit,
    gizmo,
    status: status as HTMLElement,
  });
  cleanups.push(() => drag.dispose());
  const point = new T.Vector3(0, 1, 0).project(camera),
    x = (point.x + 1) * 400,
    y = (1 - point.y) * 300;
  const down = () =>
    canvas.dispatchEvent(event("pointerdown", { clientX: x, clientY: y }));
  let last = { clientX: x, clientY: y };
  const move = (dx = 100, dy = 0, extra = {}) => {
    last = { clientX: x + dx, clientY: y + dy };
    return win.dispatchEvent(event("pointermove", { ...last, ...extra }));
  };
  const up = () => win.dispatchEvent(event("pointerup", last));
  return {
    win,
    canvas,
    object,
    objects,
    scene,
    drag,
    orbit,
    gizmo,
    status,
    onMove,
    onAdd,
    onEditStart,
    onSelect,
    down,
    move,
    up,
    setScene: (s: Scene) => {
      scene = s;
    },
  };
}
describe("direct manipulation lifecycle", () => {
  it("locks orbit, previews on every frame, commits once and restores controls", () => {
    const t = setup();
    t.down();
    expect(t.orbit.enabled).toBe(false);
    t.move();
    t.move(130);
    expect(t.onMove).not.toHaveBeenCalled();
    expect(t.object.position.x).toBeGreaterThan(0);
    t.object.position.set(0, 0, 0);
    t.drag.render();
    expect(t.object.position.x).toBeGreaterThan(0);
    t.up();
    expect(t.onMove).toHaveBeenCalledTimes(1);
    expect(t.onMove.mock.calls[0][0]).toBe("actor");
    expect(t.onMove.mock.calls[0][1][1]).toBe(0);
    expect(t.orbit.enabled).toBe(true);
    expect(t.gizmo.enabled).toBe(true);
    expect(t.drag.suppressClick()).toBe(true);
  });
  it("clicks select without creating an undo entry or pausing playback", () => {
    const t = setup();
    t.down();
    t.move(2);
    t.up();
    expect(t.onSelect).toHaveBeenCalledWith("actor");
    expect(t.onMove).not.toHaveBeenCalled();
    expect(t.onEditStart).not.toHaveBeenCalled();
  });
  it.each(["escape", "pointercancel", "blur", "outside", "project"])(
    "cancels %s without persisting the preview",
    (reason) => {
      const t = setup();
      t.down();
      t.move();
      if (reason === "escape")
        t.win.dispatchEvent(event("keydown", { key: "Escape" }));
      if (reason === "pointercancel")
        t.win.dispatchEvent(event("pointercancel", {}));
      if (reason === "blur") t.win.dispatchEvent(new Event("blur"));
      if (reason === "outside") {
        t.move(1000);
        t.up();
      }
      if (reason === "project") {
        t.setScene({ ...t.scene, id: "different" });
        t.drag.render();
      }
      expect(t.onMove).not.toHaveBeenCalled();
      expect(t.object.position.toArray()).toEqual([0, 0, 0]);
      expect(t.orbit.enabled).toBe(true);
      expect(t.status.hidden).toBe(true);
    },
  );
  it("ignores the secondary pointer without losing the captured drag", () => {
    const t = setup();
    t.down();
    t.move(100, 0, { pointerId: 2 });
    expect(t.drag.active()).toBe(false);
    t.move();
    t.win.dispatchEvent(event("pointerup", { pointerId: 2 }));
    expect(t.onMove).not.toHaveBeenCalled();
    t.up();
    expect(t.onMove).toHaveBeenCalledTimes(1);
  });
  it("reserves gizmo handles and Alt gestures for the existing camera controls", () => {
    const t = setup();
    t.canvas.dispatchEvent(event("pointerdown", { altKey: true }));
    expect(t.orbit.enabled).toBe(true);
    expect(t.onSelect).not.toHaveBeenCalled();
  });
});

describe("library gestures", () => {
  it("adds exactly one asset at the drop, with no premature scene mutation", () => {
    const t = setup(),
      card = new Surface();
    t.drag.startAsset(
      props.find((a) => a.id === "crate")!,
      {
        button: 0,
        pointerId: 1,
        clientX: -100,
        clientY: 100,
        target: card,
      } as unknown as PointerEvent,
    );
    t.move(150);
    expect(t.onAdd).not.toHaveBeenCalled();
    t.up();
    expect(t.onAdd).toHaveBeenCalledTimes(1);
    expect(t.onAdd.mock.calls[0][0]).toBe("crate");
    expect(t.onAdd.mock.calls[0][1][1]).toBe(0);
    expect(t.drag.suppressClick()).toBe(true);
  });
  it("keeps simple clicks available to the library button", () => {
    const t = setup(),
      card = new Surface();
    t.drag.startAsset(environments[0], {
      button: 0,
      pointerId: 1,
      clientX: 400,
      clientY: 300,
      target: card,
    } as unknown as PointerEvent);
    t.up();
    expect(t.onAdd).not.toHaveBeenCalled();
    expect(t.drag.suppressClick()).toBe(false);
  });
  it("cancels on lost capture and restores the camera", () => {
    const t = setup();
    t.down();
    t.move();
    t.canvas.dispatchEvent(event("lostpointercapture", {}));
    expect(t.onMove).not.toHaveBeenCalled();
    expect(t.orbit.enabled).toBe(true);
    expect(t.drag.active()).toBe(false);
  });
  it("uses the release location even when no final pointermove is delivered", () => {
    const t = setup();
    t.down();
    t.move();
    t.win.dispatchEvent(event("pointerup", { clientX: 900, clientY: 300 }));
    expect(t.onMove).not.toHaveBeenCalled();
    expect(t.object.position.toArray()).toEqual([0, 0, 0]);
  });
});

describe("collision-aware direct manipulation", () => {
  function obstacle(
    t: ReturnType<typeof setup>,
    size: [number, number, number],
    x = 0,
  ) {
    const object = new T.Group();
    const mesh = new T.Mesh(
      new T.BoxGeometry(...size),
      new T.MeshBasicMaterial(),
    );
    mesh.position.y = size[1] / 2;
    object.position.x = x;
    object.add(mesh);
    t.objects.set("obstacle", object);
    t.scene.entities.push({
      ...t.scene.entities[0],
      id: "obstacle",
      name: "Cabinet",
      position: [x, 0, 0],
    });
  }
  it("stops at the last clear point and commits only that point after a blocked drag", () => {
    const t = setup();
    obstacle(t, [0.1, 3, 20], 1.5);
    t.down();
    t.move(30);
    const accepted = t.object.position.clone();
    expect(accepted.x).toBeGreaterThan(0);
    t.move(300);
    expect(t.status.textContent).toContain("Blocked by Cabinet");
    expect(t.object.position.toArray()).toEqual(accepted.toArray());
    t.up();
    expect(t.onMove).toHaveBeenCalledTimes(1);
    expect(t.onMove.mock.calls[0][1]).toEqual(accepted.toArray());
  });
  it("rejects a new asset dropped inside occupied geometry", () => {
    const t = setup(),
      card = new Surface();
    obstacle(t, [100, 5, 100]);
    t.drag.startAsset(
      props.find((a) => a.id === "crate")!,
      {
        button: 0,
        pointerId: 1,
        clientX: -100,
        clientY: 100,
        target: card,
      } as unknown as PointerEvent,
    );
    t.move(150);
    t.drag.render();
    expect(t.status.textContent).toContain("Blocked by Cabinet");
    t.up();
    expect(t.onAdd).not.toHaveBeenCalled();
    expect(t.orbit.enabled).toBe(true);
    expect(t.status.hidden).toBe(true);
  });
});
