import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  draggedPosition,
  movedBasePosition,
  pointerRay,
  visibleEntity,
} from "../src/placement";

describe("scene placement", () => {
  it("keeps the grab offset and elevation with optional quarter-metre snapping", () => {
    const p = new T.Vector3(2.13, 0, -1.14),
      offset = new T.Vector3(-0.32, 0, 0.5);
    expect(draggedPosition(p, offset, 1.01)).toEqual([
      1.8099999999999998, 1.01, -0.6399999999999999,
    ]);
    expect(draggedPosition(p, offset, 1.01, true)).toEqual([1.75, 1.01, -0.75]);
  });
  it("does not bake existing animation displacement into the saved placement", () => {
    expect(
      movedBasePosition(
        [1, 0, 2],
        new T.Vector3(1, 0, 7),
        new T.Vector3(3, 0, 8),
      ),
    ).toEqual([3, 0, 3]);
  });
  it("resolves nested meshes to their visible entity and excludes hidden ancestors", () => {
    const root = new T.Group();
    root.userData.entityId = "actor";
    const nested = new T.Group(),
      mesh = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial());
    root.add(nested);
    nested.add(mesh);
    expect(visibleEntity(mesh)).toBe(root);
    nested.visible = false;
    expect(visibleEntity(mesh)).toBeNull();
    nested.visible = true;
    root.visible = false;
    expect(visibleEntity(mesh)).toBeNull();
  });
  it("lands at the same ground point in perspective, front and top views with a canvas offset", () => {
    const rect = { left: 320, top: 125, width: 800, height: 500 },
      target = new T.Vector3(1.7, 0, -0.8);
    for (const position of [
      [8, 6.5, 10],
      [0, 3, 12],
      [0.001, 12, 0.001],
    ]) {
      const camera = new T.PerspectiveCamera(
        38,
        rect.width / rect.height,
        0.1,
        100,
      );
      camera.position.fromArray(position);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);
      const projected = target.clone().project(camera),
        x = rect.left + ((projected.x + 1) * rect.width) / 2,
        y = rect.top + ((1 - projected.y) * rect.height) / 2;
      const hit = pointerRay(camera, rect, x, y).ray.intersectPlane(
        new T.Plane(new T.Vector3(0, 1, 0), 0),
        new T.Vector3(),
      );
      expect(hit!.distanceTo(target)).toBeLessThan(1e-9);
    }
  });
  it("clamps near-horizon placement to valid finite scene coordinates", () => {
    expect(
      draggedPosition(new T.Vector3(1000, 0, -1000), new T.Vector3(), 0),
    ).toEqual([49, 0, -49]);
  });
});
