import { describe, expect, it } from "vitest";
import * as T from "three";
import { starterScene, applyCommands } from "../shared/scene";
import { applyAnimatedEntityPose } from "../src/world";
import {
  objectTransform,
  restoreTransform,
  entityTransformChanges,
  sceneObstacles,
  sceneCollisionWarning,
  TransformCollisionGuard,
} from "../src/assetManipulation";
import { snapshotCollider } from "../src/collision";

function box(x = 0, size = [1, 1, 1]) {
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
function guard(object: T.Group, obstacle: T.Group) {
  return new TransformCollisionGuard(object, [
    { id: "wall", name: "Wall", collider: snapshotCollider(obstacle) },
  ]);
}

describe("asset gizmo persistence", () => {
  it("persists all transforms relative to the sampled pose and survives scene validation", () => {
    const scene = starterScene();
    const entity = scene.entities[0];
    entity.position = [1, 0, 2];
    entity.rotation = 2.6;
    entity.scale = 2;
    entity.clips = [];
    const object = box();
    object.position.set(4, 0, 6); // accumulated route endpoint
    object.rotation.y = 2.9;
    object.scale.setScalar(2);
    const start = objectTransform(object);
    object.position.add(new T.Vector3(2, 1, -3));
    object.rotation.y = -2.9; // crossing the +/- pi boundary
    object.scale.setScalar(3);
    const changes = entityTransformChanges(entity, start, object);
    expect(changes.position).toEqual([3, 1, -1]);
    expect(changes.rotation).toBeCloseTo(2.6 + Math.PI * 2 - 5.8);
    expect(changes.scale).toBe(3);
    const saved = applyCommands(scene, [
      { type: "update", id: entity.id, changes },
    ]);
    applyAnimatedEntityPose(object, saved.entities[0], saved, 0);
    expect(object.position.toArray()).toEqual(changes.position);
    expect(object.rotation.y).toBeCloseTo(changes.rotation);
    expect(object.scale.toArray()).toEqual([3, 3, 3]);
  });
  it("restores yaw beyond ninety degrees without an Euler flip", () => {
    const object = box();
    object.rotation.y = 2.6;
    const start = objectTransform(object);
    object.rotation.set(1, 0.5, 2);
    restoreTransform(object, start);
    expect(object.rotation.toArray()).toEqual(start.rotation.toArray());
  });
  it("clamps persisted uniform scale to the existing scene limits", () => {
    const entity = starterScene().entities[0];
    entity.scale = 1;
    const object = box();
    const start = objectTransform(object);
    object.scale.setScalar(100);
    expect(entityTransformChanges(entity, start, object).scale).toBe(10);
    object.scale.setScalar(-1);
    expect(entityTransformChanges(entity, start, object).scale).toBe(0.1);
  });
});

describe("collision-aware transform gestures", () => {
  it("prevents tunneling, restores the last valid translation, then permits a clear edit", () => {
    const object = box(-2),
      wall = box(0, [0.05, 3, 5]);
    const edit = guard(object, wall);
    object.position.x = -1;
    expect(edit.check()).toBeNull();
    object.position.x = 2;
    expect(edit.check()).toBe("Wall");
    expect(object.position.x).toBe(-1);
    object.position.z = 4;
    expect(edit.check()).toBeNull();
  });
  it("blocks moving an asset through the studio ground", () => {
    const scene = starterScene();
    scene.entities = [scene.entities[0]];
    const object = box();
    const objects = new Map([[scene.entities[0].id, object]]);
    const edit = new TransformCollisionGuard(
      object,
      sceneObstacles(scene, objects, scene.entities[0].id),
    );
    object.position.y = -4;
    expect(edit.check()).toBe("the ground");
    expect(object.position.y).toBe(0);
  });
  it("allows an already overlapping asset to move out", () => {
    const object = box(0.8),
      wall = box();
    const edit = guard(object, wall);
    object.position.x = 1.5;
    expect(edit.check()).toBeNull();
    object.position.x = 0.9;
    expect(edit.check()).toBe("Wall");
    expect(object.position.x).toBe(1.5);
  });
  it("blocks scale into another asset and restores uniform size", () => {
    const object = box(),
      wall = box(2);
    const edit = guard(object, wall);
    object.scale.setScalar(4);
    expect(edit.check()).toBe("Wall");
    expect(object.scale.toArray()).toEqual([1, 1, 1]);
  });
  it("checks intermediate rotations even when the final box is clear", () => {
    const object = box(0, [4, 1, 0.2]),
      wall = box(0, [0.2, 2, 0.2]);
    wall.position.z = 1.5;
    const edit = guard(object, wall);
    object.rotation.y = Math.PI;
    expect(edit.check()).toBe("Wall");
    expect(object.rotation.y).toBe(0);
  });
  it("includes scenery, ignores hidden assets, and reports detected scene overlaps", () => {
    const scene = starterScene();
    scene.entities = [
      scene.entities[0],
      { ...scene.entities[0], id: "other", name: "Crate" },
    ];
    const objects = new Map(scene.entities.map((entity) => [entity.id, box()]));
    const backdrop = box(6);
    expect(
      sceneObstacles(scene, objects, scene.entities[0].id, backdrop).map(
        (o) => o.id,
      ),
    ).toEqual(["other", "environment", "ground"]);
    expect(sceneCollisionWarning(sceneObstacles(scene, objects))).toContain(
      "overlaps Crate",
    );
    scene.entities[1].visible = false;
    expect(sceneCollisionWarning(sceneObstacles(scene, objects))).toBe("");
    backdrop.position.x = 0;
    expect(
      sceneCollisionWarning(
        sceneObstacles(scene, objects, undefined, backdrop),
      ),
    ).toContain("the backdrop");
  });
});
