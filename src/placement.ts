import * as T from "three";

export type Position = [number, number, number];
export const DRAG_THRESHOLD = 5;
export const PLACEMENT_LIMIT = 49;

/** Keep the original grab offset and elevation; Shift snaps the horizontal axes. */
export function draggedPosition(
  point: T.Vector3,
  offset: T.Vector3,
  height: number,
  snap = false,
): Position {
  const axis = (n: number) =>
    Math.max(
      -PLACEMENT_LIMIT,
      Math.min(PLACEMENT_LIMIT, snap ? Math.round(n * 4) / 4 : n),
    );
  return [axis(point.x + offset.x), height, axis(point.z + offset.z)];
}

/** Animation displacement is a preview, never part of the stored placement. */
export function movedBasePosition(
  base: Position,
  start: T.Vector3,
  end: T.Vector3,
): Position {
  return base.map(
    (value, i) => value + end.getComponent(i) - start.getComponent(i),
  ) as Position;
}

export function pointerRay(
  camera: T.Camera,
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
  x: number,
  y: number,
) {
  const ray = new T.Raycaster();
  ray.setFromCamera(
    new T.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      (-(y - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
  return ray;
}

export function visibleEntity(object: T.Object3D): T.Object3D | null {
  let entity: T.Object3D | null = null;
  for (let node: T.Object3D | null = object; node; node = node.parent) {
    if (!node.visible) return null;
    if (node.userData.entityId) entity = node;
  }
  return entity;
}
