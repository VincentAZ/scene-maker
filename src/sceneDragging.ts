import * as T from "three";
import {
  allAssets,
  environmentSet,
  type Asset,
  type Entity,
  type Scene,
} from "../shared/scene";
import { keepOnSetFloor } from "../shared/sets";
import { loadImportedAsset } from "./importedAsset";
import { createCharacter, createProp, disposeObject } from "./world";
import {
  collisionBetween,
  snapshotCollider,
  type CollisionObstacle,
} from "./collision";
import {
  emptyCollider,
  sceneObstacles,
  TransformCollisionGuard,
} from "./assetManipulation";
import {
  DRAG_THRESHOLD,
  draggedPosition,
  movedBasePosition,
  pointerRay,
  visibleEntity,
  type Position,
} from "./placement";

type Callbacks = {
  scene: Scene;
  onSelect: (id: string | null) => void;
  onMove: (id: string, position: Position) => void;
  onAdd?: (assetId: string, position: Position) => void;
  onEditStart?: () => void;
  onError: (message: string) => void;
};
type Gesture = {
  pointerId: number;
  projectId: string;
  x: number;
  y: number;
  active: boolean;
  item?: T.Group;
  asset?: Asset;
  entity?: Entity;
  start: T.Vector3;
  position: T.Vector3;
  offset: T.Vector3;
  plane: T.Plane;
  valid: boolean;
  capture?: Element;
  obstacles?: CollisionObstacle[];
  guard?: TransformCollisionGuard;
  blocked?: string;
};

/** Direct manipulation stays outside React's render loop; a release is one scene edit. */
export function sceneDragging(options: {
  canvas: HTMLCanvasElement;
  camera: T.Camera;
  world: T.Scene;
  objects: Map<string, T.Group>;
  current: () => Callbacks;
  orbit: { enabled: boolean; update: () => void; enableDamping: boolean };
  gizmo: { dragging: boolean; axis: string | null; enabled: boolean };
  status: HTMLElement;
  environment?: () => T.Object3D | null;
  /** A 3D set's furniture meshes: a dragged prop can be put on them too. */
  surfaces?: () => T.Object3D[];
  /** The height a prop put on the set's furniture at x, z rests at. */
  restingHeight?: (x: number, z: number, y: number) => number;
}) {
  const { canvas, camera, world, objects, current, orbit, gizmo, status } =
    options;
  let gesture: Gesture | null = null,
    suppressClickUntil = 0,
    disposed = false;
  let previousOrbit = true,
    previousGizmo = true;
  const highlight = new T.BoxHelper(new T.Group(), 0x69864b);
  highlight.material.depthTest = false;
  highlight.material.transparent = true;
  highlight.material.opacity = 0.8;
  highlight.renderOrder = 10;
  highlight.visible = false;
  world.add(highlight);
  const marker = new T.Mesh(
    new T.RingGeometry(0.16, 0.2, 40),
    new T.MeshBasicMaterial({
      color: 0x69864b,
      side: T.DoubleSide,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    }),
  );
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  marker.renderOrder = 11;
  world.add(marker);
  const say = (text: string) => {
    status.textContent = text;
    status.hidden = !text;
  };
  const inside = (e: { clientX: number; clientY: number }) => {
    const r = canvas.getBoundingClientRect();
    return (
      e.clientX >= r.left &&
      e.clientX <= r.right &&
      e.clientY >= r.top &&
      e.clientY <= r.bottom
    );
  };
  const ray = (e: { clientX: number; clientY: number }) =>
    pointerRay(camera, canvas.getBoundingClientRect(), e.clientX, e.clientY);
  const hit = (e: PointerEvent) => {
    world.updateMatrixWorld(true);
    for (const h of ray(e).intersectObjects([...objects.values()], true)) {
      const root = visibleEntity(h.object);
      if (root) return root as T.Group;
    }
    return null;
  };
  const lostCapture = () => finish(true);
  const capture = (g: Gesture, target: Element) => {
    g.capture = target;
    target.addEventListener("lostpointercapture", lostCapture);
    try {
      target.setPointerCapture(g.pointerId);
    } catch {
      /* Window listeners still finish the gesture. */
    }
  };
  const lock = () => {
    previousOrbit = orbit.enabled;
    previousGizmo = gizmo.enabled;
    // Drain the last orbit damping delta before locking the camera under the pointer.
    const damping = orbit.enableDamping;
    orbit.enableDamping = false;
    orbit.update();
    orbit.enableDamping = damping;
    orbit.enabled = false;
    gizmo.enabled = false;
  };
  const startAsset = (asset: Asset, e: PointerEvent) => {
    if (gesture || e.button !== 0 || !current().onAdd) return;
    gesture = {
      pointerId: e.pointerId,
      projectId: current().scene.id,
      x: e.clientX,
      y: e.clientY,
      active: false,
      asset,
      start: new T.Vector3(),
      position: new T.Vector3(),
      offset: new T.Vector3(),
      plane: new T.Plane(new T.Vector3(0, 1, 0), 0),
      valid: false,
    };
    capture(
      gesture,
      (e.target as Element).closest("button") || (e.target as Element),
    );
  };
  const loadGhost = async (g: Gesture) => {
    const a = g.asset!;
    if (a.category === "environments") return;
    try {
      const object = a.url
        ? await loadImportedAsset(a)
        : a.category === "characters"
          ? createCharacter(a, a.color)
          : createProp(a.style, a.color, a.parts, a.ladder);
      if (disposed || gesture !== g) {
        disposeObject(object);
        return;
      }
      object.traverse((node) => {
        if (node instanceof T.Mesh) {
          const fade = (m: T.Material) => {
            m.transparent = true;
            m.opacity = 0.58;
            m.depthWrite = false;
            return m;
          };
          node.material = Array.isArray(node.material)
            ? node.material.map(fade)
            : fade(node.material);
        }
      });
      g.item = object;
      object.position.copy(g.position);
      object.visible = g.valid;
      world.add(object);
    } catch (error) {
      if (gesture === g) {
        current().onError(
          error instanceof Error
            ? error.message
            : "Could not preview this asset.",
        );
        finish(true);
      }
    }
  };
  const begin = (g: Gesture) => {
    g.active = true;
    g.obstacles = sceneObstacles(
      current().scene,
      objects,
      g.entity?.id,
      options.environment?.(),
    );
    if (g.item && g.entity)
      g.guard = new TransformCollisionGuard(g.item, g.obstacles);
    if (g.asset) lock();
    current().onEditStart?.();
    document.documentElement.classList.add("placing-scene-asset");
    canvas.classList.add("drop-target");
    if (g.asset) void loadGhost(g);
  };
  const down = (e: PointerEvent) => {
    if (
      e.button !== 0 ||
      e.altKey ||
      gesture ||
      !current().onEditStart ||
      gizmo.dragging ||
      (gizmo.enabled && gizmo.axis)
    )
      return;
    const object = hit(e);
    if (!object) return;
    const entity = current().scene.entities.find(
      (item) => item.id === object.userData.entityId,
    );
    if (!entity) return;
    // Capture before OrbitControls sees this pointer. Empty-space gestures still orbit normally.
    e.stopImmediatePropagation();
    e.preventDefault();
    lock();
    const plane = new T.Plane(new T.Vector3(0, 1, 0), -object.position.y);
    const point = ray(e).ray.intersectPlane(plane, new T.Vector3());
    if (!point) {
      orbit.enabled = previousOrbit;
      gizmo.enabled = previousGizmo;
      return;
    }
    gesture = {
      pointerId: e.pointerId,
      projectId: current().scene.id,
      x: e.clientX,
      y: e.clientY,
      active: false,
      item: object,
      entity: structuredClone(entity),
      start: object.position.clone(),
      position: object.position.clone(),
      offset: object.position.clone().sub(point),
      plane,
      valid: true,
    };
    capture(gesture, canvas);
    current().onSelect(entity.id);
  };
  const move = (e: PointerEvent) => {
    const g = gesture;
    if (!g) {
      if (e.target === canvas && !gizmo.dragging) {
        canvas.style.cursor = hit(e) ? "grab" : "";
      }
      return;
    }
    if (e.pointerId !== g.pointerId) return;
    if (
      !g.active &&
      Math.hypot(e.clientX - g.x, e.clientY - g.y) < DRAG_THRESHOLD
    )
      return;
    if (!g.active) begin(g);
    e.preventDefault();
    g.valid = inside(e);
    g.blocked = "";
    const pointer = ray(e);
    let p = pointer.ray.intersectPlane(g.plane, new T.Vector3());
    if (g.asset?.category === "props" && g.valid) {
      world.updateMatrixWorld(true);
      const scene = current().scene;
      const facesUp = (hit: T.Intersection) =>
        !!hit.face &&
        hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y >
          0.7;
      const surface = pointer
        .intersectObjects([...objects.values()], true)
        .find((hit) => {
          const root = visibleEntity(hit.object);
          const entity =
            root &&
            scene.entities.find((item) => item.id === root.userData.entityId);
          const asset =
            entity &&
            allAssets(scene).find((item) => item.id === entity.assetId);
          return asset?.category === "props" && facesUp(hit);
        });
      // The set's own table, bed or counter takes a prop as well, when it is
      // the first thing under the pointer.
      const furniture = pointer.intersectObjects(
        options.surfaces?.() ?? [],
        false,
      )[0];
      const nearest = [surface, furniture && facesUp(furniture) && furniture]
        .filter((hit): hit is T.Intersection => !!hit)
        .sort((a, b) => a.distance - b.distance)[0];
      if (nearest) {
        p = nearest.point.clone();
        if (nearest === furniture && options.restingHeight)
          p.y = options.restingHeight(p.x, p.z, p.y);
      }
    }
    if (!p) g.valid = false;
    if (g.valid && p) {
      // A drop lands on the set's open floor, never inside its walls.
      g.position.fromArray(
        keepOnSetFloor(
          environmentSet(current().scene),
          draggedPosition(p, g.offset, g.asset ? p.y : g.start.y, e.shiftKey),
        ),
      );
    }
    if (g.asset && g.item) g.item.visible = g.valid;
    marker.visible = g.valid;
    marker.position.copy(g.position);
    marker.position.y += 0.008;
    render();
  };
  const finish = (cancel = false) => {
    const g = gesture;
    if (!g) return;
    gesture = null;
    g.capture?.removeEventListener("lostpointercapture", lostCapture);
    if (g.capture?.hasPointerCapture(g.pointerId))
      g.capture.releasePointerCapture(g.pointerId);
    if (g.entity || g.active) {
      orbit.enabled = previousOrbit;
      gizmo.enabled = previousGizmo;
    }
    document.documentElement.classList.remove("placing-scene-asset");
    canvas.classList.remove("drop-target");
    canvas.style.cursor = "";
    marker.visible = false;
    highlight.visible = false;
    say("");
    if (g.active) suppressClickUntil = performance.now() + 500;
    if (
      g.asset &&
      g.asset.category !== "environments" &&
      !g.item &&
      g.active &&
      !cancel
    )
      current().onError(
        "This asset is still loading. Wait for its preview before dropping it.",
      );
    const geometryReady =
      !g.asset || g.asset.category === "environments" || !!g.item;
    if (g.item && g.asset) {
      world.remove(g.item);
      disposeObject(g.item);
    }
    if (g.entity && g.item) g.item.position.copy(g.start);
    if (
      cancel ||
      !g.active ||
      !g.valid ||
      !geometryReady ||
      current().scene.id !== g.projectId
    )
      return;
    if (g.asset)
      current().onAdd?.(g.asset.id, g.position.toArray() as Position);
    else if (g.entity && g.position.distanceTo(g.start) > 0.0001) {
      current().onMove(
        g.entity.id,
        movedBasePosition(g.entity.position, g.start, g.position),
      );
    }
  };
  const up = (e: PointerEvent) => {
    if (gesture?.pointerId === e.pointerId) {
      if (gesture.entity) e.stopImmediatePropagation();
      if (gesture.active) move(e);
      finish();
    }
  };
  const cancel = (e: PointerEvent) => {
    if (gesture?.pointerId === e.pointerId) finish(true);
  };
  const escape = (e: KeyboardEvent) => {
    if (gesture && e.key === "Escape") {
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(true);
    }
  };
  const blur = () => finish(true);
  function render() {
    const g = gesture;
    if (!g?.active) return;
    if (
      current().scene.id !== g.projectId ||
      (g.entity && !current().scene.entities.some((e) => e.id === g.entity!.id))
    ) {
      finish(true);
      return;
    }
    if (g.item) {
      g.item.position.copy(g.position);
      // The animation sampler runs before this preview each frame. Only the
      // pointer's new candidate is checked; a blocked move stays at the last
      // accepted point instead of snapping through the obstacle.
      if (g.entity && g.guard) {
        const blocked = g.guard.check();
        if (blocked) {
          g.blocked = blocked;
          g.position.copy(g.item.position);
        }
      } else if (g.asset && g.valid) {
        g.blocked =
          collisionBetween(
            emptyCollider(),
            snapshotCollider(g.item),
            g.obstacles ?? [],
            false,
          ) || "";
        if (g.blocked) g.valid = false;
      }
      g.item.updateMatrixWorld(true);
      highlight.setFromObject(g.item);
      highlight.material.color.set(g.blocked ? 0xc56b4f : 0x69864b);
      highlight.visible = !!g.blocked || g.valid;
    }
    marker.position.copy(g.position);
    marker.position.y += 0.008;
    say(
      g.blocked
        ? `Blocked by ${g.blocked} · Choose a clear position · Esc cancels`
        : g.valid
          ? `${g.asset?.name || g.entity?.name} · ${g.position.x.toFixed(2)}, ${g.position.z.toFixed(2)} · Shift snaps · Esc cancels`
          : "Drop inside the scene · Esc cancels",
    );
  }
  canvas.addEventListener("pointerdown", down, true);
  window.addEventListener("pointermove", move, {
    capture: true,
    passive: false,
  });
  window.addEventListener("pointerup", up, true);
  window.addEventListener("pointercancel", cancel, true);
  window.addEventListener("keydown", escape, true);
  window.addEventListener("blur", blur);
  return {
    startAsset,
    render,
    active: () => !!gesture?.active,
    suppressClick: () => performance.now() < suppressClickUntil,
    dispose() {
      disposed = true;
      finish(true);
      canvas.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", blur);
      world.remove(highlight, marker);
      highlight.geometry.dispose();
      highlight.material.dispose();
      marker.geometry.dispose();
      marker.material.dispose();
    },
  };
}
