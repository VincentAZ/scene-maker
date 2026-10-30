import * as T from "three";
import type { Entity, Scene } from "../shared/scene";
import {
  collisionBetween,
  snapshotCollider,
  type Collider,
  type CollisionObstacle,
} from "./collision";
import { movedBasePosition } from "./placement";

export type TransformMode = "translate" | "rotate" | "scale";
export type ObjectTransform = ReturnType<typeof objectTransform>;
export function objectTransform(object: T.Object3D) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    rotation: object.rotation.clone(),
    scale: object.scale.clone(),
  };
}
export function restoreTransform(object: T.Object3D, state: ObjectTransform) {
  object.position.copy(state.position);
  object.rotation.copy(state.rotation);
  object.scale.copy(state.scale);
  object.updateWorldMatrix(true, true);
}

/** Persist a gizmo edit as a delta from the evaluated pose, not from time zero. */
export function entityTransformChanges(
  entity: Entity,
  start: ObjectTransform,
  object: T.Object3D,
): Pick<Entity, "position" | "rotation" | "scale"> {
  const heading = start.rotation.y;
  const turn = object.rotation.y - heading;
  return {
    position: movedBasePosition(
      entity.position,
      start.position,
      object.position,
    ),
    rotation: Math.atan2(
      Math.sin(entity.rotation + turn),
      Math.cos(entity.rotation + turn),
    ),
    scale: Math.max(
      0.1,
      Math.min(10, (entity.scale * object.scale.x) / start.scale.x),
    ),
  };
}

export function sceneObstacles(
  scene: Scene,
  objects: Map<string, T.Group>,
  exclude?: string,
  environment?: T.Object3D | null,
): CollisionObstacle[] {
  const obstacles = scene.entities.flatMap((entity) => {
    const object = objects.get(entity.id);
    return entity.id !== exclude && entity.visible && object
      ? [
          {
            id: entity.id,
            name: entity.name,
            collider: snapshotCollider(object),
          },
        ]
      : [];
  });
  if (environment)
    obstacles.push({
      id: "environment",
      name: "the backdrop",
      collider: snapshotCollider(environment),
    });
  // Match the studio's visible level floor (Viewport.tsx), including an Empty room.
  const ground = new T.Box3(
    new T.Vector3(-1e6, -1e6, -1e6),
    new T.Vector3(1e6, -0.04, 1e6),
  );
  obstacles.push({
    id: "ground",
    name: "the ground",
    collider: { bounds: ground, boxes: [ground] },
  });
  return obstacles;
}

export const emptyCollider = (): Collider => ({
  boxes: [],
  bounds: new T.Box3(),
});

/** Last valid edit pose. Rotation/scale are checked along the gesture as well. */
export class TransformCollisionGuard {
  private accepted: ObjectTransform;
  private collider: Collider;
  constructor(
    private object: T.Object3D,
    private obstacles: CollisionObstacle[],
  ) {
    this.accepted = objectTransform(object);
    this.collider = snapshotCollider(object);
  }
  check(): string | null {
    const candidate = objectTransform(this.object);
    const angle = candidate.quaternion.angleTo(this.accepted.quaternion);
    const size = Math.max(
      ...candidate.scale
        .toArray()
        .map((n, i) => Math.abs(n - this.accepted.scale.getComponent(i))),
    );
    const steps = Math.max(
      1,
      Math.ceil(angle / (Math.PI / 36)),
      Math.ceil(size / 0.05),
    );
    let previous = this.collider;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      this.object.position.lerpVectors(
        this.accepted.position,
        candidate.position,
        t,
      );
      const turn = candidate.rotation.y - this.accepted.rotation.y;
      this.object.rotation.set(
        0,
        this.accepted.rotation.y +
          Math.atan2(Math.sin(turn), Math.cos(turn)) * t,
        0,
      );
      this.object.scale.lerpVectors(this.accepted.scale, candidate.scale, t);
      const next = snapshotCollider(this.object);
      const blocked = collisionBetween(previous, next, this.obstacles);
      if (blocked) {
        restoreTransform(this.object, this.accepted);
        return blocked;
      }
      previous = next;
    }
    restoreTransform(this.object, candidate);
    this.accepted = candidate;
    this.collider = previous;
    return null;
  }
}

/** Detection only: animation stays deterministic, including authored contacts. */
export function sceneCollisionWarning(obstacles: CollisionObstacle[]): string {
  const empty = emptyCollider();
  for (let i = 0; i < obstacles.length; i++) {
    const source = obstacles[i];
    if (source.id === "environment") continue;
    const blocked = collisionBetween(
      empty,
      source.collider,
      obstacles.slice(i + 1),
      false,
    );
    if (blocked)
      return `Collision: ${source.name} overlaps ${blocked}. Adjust placement or the route; playback does not resolve contacts.`;
  }
  return "";
}
