import * as T from "three";
import type { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Entity, Scene } from "../shared/scene";
import {
  objectTransform,
  restoreTransform,
  entityTransformChanges,
  TransformCollisionGuard,
  sceneObstacles,
  type ObjectTransform,
  type TransformMode,
} from "./assetManipulation";

type Callbacks = {
  scene: Scene;
  transformMode?: TransformMode;
  onEditStart?: () => void;
  onMove: (id: string, position: Entity["position"]) => void;
  onTransform?: (
    id: string,
    changes: Pick<Entity, "position" | "rotation" | "scale">,
  ) => void;
};

type Gesture = {
  projectId: string;
  entity: Entity;
  entityData: string;
  object: T.Group;
  start: ObjectTransform;
  preview: ObjectTransform;
  guard: TransformCollisionGuard;
};

/** One validated preview per gesture, independent of the animation/render passes. */
export function gizmoEditing(options: {
  transform: TransformControls;
  objects: Map<string, T.Group>;
  current: () => Callbacks;
  orbit: { enabled: boolean };
  status: HTMLElement;
  environment: () => T.Object3D | null;
  canvas: HTMLCanvasElement;
}) {
  const { transform, objects, current, orbit, status, environment, canvas } =
    options;
  let gesture: Gesture | null = null;
  let disposed = false;
  const say = (message: string) => {
    status.textContent = message;
    status.hidden = !message;
  };
  const valid = (edit: Gesture) => {
    const { scene } = current();
    const entity = scene.entities.find((item) => item.id === edit.entity.id);
    return (
      scene.id === edit.projectId &&
      objects.get(edit.entity.id) === edit.object &&
      transform.object === edit.object &&
      entity !== undefined &&
      JSON.stringify(entity) === edit.entityData
    );
  };
  const cancel = () => {
    const edit = gesture;
    // Clear first: pointerUp dispatches dragging-changed synchronously. In
    // particular, reset() would dispatch objectChange through the collision
    // guard and can also dereference an object that has already been detached.
    gesture = null;
    if (edit) restoreTransform(edit.object, edit.start);
    if (transform.dragging) transform.pointerUp(null);
    orbit.enabled = true;
    say("");
  };
  const draggingChanged = (event: { value: unknown }) => {
    if (disposed) return;
    if (event.value) {
      const { scene, onEditStart } = current();
      const object = transform.object;
      const entity = scene.entities.find(
        (item) => item.id === object?.userData.entityId,
      );
      const group = entity ? objects.get(entity.id) : undefined;
      if (!object || !entity || !group || group !== object) {
        cancel();
        return;
      }
      const start = objectTransform(object);
      const captured = structuredClone(entity);
      gesture = {
        projectId: scene.id,
        entity: captured,
        entityData: JSON.stringify(captured),
        object: group,
        start,
        preview: start,
        guard: new TransformCollisionGuard(
          object,
          sceneObstacles(scene, objects, entity.id, environment()),
        ),
      };
      orbit.enabled = false;
      say("");
      onEditStart?.();
      return;
    }
    const edit = gesture;
    if (!edit) {
      orbit.enabled = true;
      say("");
      return;
    }
    if (!valid(edit)) {
      cancel();
      return;
    }
    gesture = null;
    orbit.enabled = true;
    say("");
    // Animation may have changed the root since the last pointer event. Only
    // the pose accepted by objectChange belongs to this transaction.
    restoreTransform(edit.object, edit.preview);
    const changed =
      edit.preview.position.distanceTo(edit.start.position) > 0.0001 ||
      edit.preview.quaternion.angleTo(edit.start.quaternion) > 0.0001 ||
      edit.preview.scale.distanceTo(edit.start.scale) > 0.0001;
    if (!changed) {
      restoreTransform(edit.object, edit.start);
      return;
    }
    const changes = entityTransformChanges(
      edit.entity,
      edit.start,
      edit.object,
    );
    const callbacks = current();
    if (callbacks.onTransform) callbacks.onTransform(edit.entity.id, changes);
    else callbacks.onMove(edit.entity.id, changes.position);
  };
  const objectChanged = () => {
    const edit = gesture;
    if (!edit || !transform.dragging || disposed) return;
    if (!valid(edit)) {
      cancel();
      return;
    }
    const { object, start, entity } = edit;
    const mode = current().transformMode ?? "translate";
    if (mode === "scale") {
      const axis = transform.axis?.includes("X")
        ? "x"
        : transform.axis?.includes("Y")
          ? "y"
          : "z";
      const ratio = object.scale[axis] / start.scale[axis];
      const scale = Math.max(0.1, Math.min(10, entity.scale * ratio));
      // Clamp the persisted scale, retaining the evaluated pose's scale delta.
      object.scale.setScalar((start.scale.x * scale) / entity.scale);
    } else if (mode === "rotate") {
      const forward = new T.Vector3(0, 0, 1).applyQuaternion(object.quaternion);
      object.rotation.set(0, Math.atan2(forward.x, forward.z), 0);
    }
    const blocked = edit.guard.check();
    edit.preview = objectTransform(object);
    say(blocked ? `Blocked by ${blocked} · Esc cancels` : "");
  };
  const render = () => {
    if (!gesture || disposed) return;
    if (!valid(gesture)) {
      cancel();
      return;
    }
    // Call after base animation, conversation, and interaction evaluation, so
    // bones can be resampled normally while the edited root remains stable.
    restoreTransform(gesture.object, gesture.preview);
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && (gesture || transform.dragging)) cancel();
  };
  const interrupted = () => {
    if (gesture || transform.dragging) cancel();
  };
  const lostCapture = () => {
    const edit = gesture;
    // Three releases capture before pointerUp. A normal release commits in
    // this turn; unexpected capture loss leaves dragging true in the microtask.
    queueMicrotask(() => {
      if (!disposed && edit && gesture === edit && transform.dragging) cancel();
    });
  };
  transform.addEventListener("dragging-changed", draggingChanged);
  transform.addEventListener("objectChange", objectChanged);
  window.addEventListener("keydown", keydown);
  window.addEventListener("blur", interrupted);
  canvas.addEventListener("pointercancel", interrupted, { capture: true });
  canvas.addEventListener("lostpointercapture", lostCapture);
  return {
    cancel,
    render,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      transform.removeEventListener("dragging-changed", draggingChanged);
      transform.removeEventListener("objectChange", objectChanged);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", interrupted);
      canvas.removeEventListener("pointercancel", interrupted, {
        capture: true,
      });
      canvas.removeEventListener("lostpointercapture", lostCapture);
    },
  };
}
