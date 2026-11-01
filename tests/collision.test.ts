import { describe, expect, it, vi } from "vitest";
import * as T from "three";
import {
  COLLISION_EPSILON,
  collisionBetween,
  firstInterpolatedOverlap,
  snapshotCollider,
  type CollisionObstacle,
} from "../src/collision";

type XYZ = [number, number, number];
function mesh(size: XYZ = [1, 1, 1], position: XYZ = [0, 0, 0]) {
  const object = new T.Mesh(
    new T.BoxGeometry(...size),
    new T.MeshBasicMaterial(),
  );
  object.position.fromArray(position);
  return object;
}
function obstacle(object: T.Object3D, name = "Wall"): CollisionObstacle {
  return { id: object.uuid, name, collider: snapshotCollider(object) };
}
function motion(
  object: T.Object3D,
  destination: XYZ,
  fixed: T.Object3D,
  sweep = true,
) {
  const start = snapshotCollider(object);
  object.position.fromArray(destination);
  return collisionBetween(
    start,
    snapshotCollider(object),
    [obstacle(fixed)],
    sweep,
  );
}
function expectVector(actual: T.Vector3, expected: XYZ) {
  expected.forEach((n, i) => expect(actual.getComponent(i)).toBeCloseTo(n, 6));
}

it("detects opposing translations crossing between clear endpoint samples", () => {
  const a = mesh([1, 1, 1], [-5, 0, 0]),
    b = mesh([1, 1, 1], [5, 0, 0]);
  const a0 = snapshotCollider(a),
    b0 = snapshotCollider(b);
  a.position.x = 5;
  b.position.x = -5;
  const a1 = snapshotCollider(a),
    b1 = snapshotCollider(b);
  expect(a0.bounds.intersectsBox(b0.bounds)).toBe(false);
  expect(a1.bounds.intersectsBox(b1.bounds)).toBe(false);
  expect(firstInterpolatedOverlap(a0, a1, b0, b1)).toBeCloseTo(0.45, 5);
});

it("uses relative motion rather than overlapping whole-travel envelopes", () => {
  const a = mesh([1, 1, 1], [0, 0, 0]),
    b = mesh([1, 1, 1], [2, 0, 0]);
  const a0 = snapshotCollider(a),
    b0 = snapshotCollider(b);
  a.position.x = 20;
  b.position.x = 22;
  expect(
    firstInterpolatedOverlap(a0, snapshotCollider(a), b0, snapshotCollider(b)),
  ).toBeNull();
  a.position.set(0, 0, 1);
  const grazing = snapshotCollider(a);
  a.position.x = 4;
  expect(
    firstInterpolatedOverlap(grazing, snapshotCollider(a), b0, b0),
  ).toBeNull();
});

describe("visible asset collider snapshots", () => {
  it("keeps detached world AABBs for every mesh, including parent rotation and scale", () => {
    const parent = new T.Group(),
      root = new T.Group();
    parent.position.set(10, 2, -3);
    parent.rotation.y = Math.PI / 2;
    parent.scale.set(2, 3, 4);
    parent.add(root);
    const object = mesh([2, 2, 2], [1, 1, 0]);
    root.add(object);
    const snapshot = snapshotCollider(root);
    expect(snapshot.boxes).toHaveLength(1);
    expectVector(snapshot.bounds.min, [6, 2, -7]);
    expectVector(snapshot.bounds.max, [14, 8, -3]);
    root.position.x = 100;
    snapshotCollider(root);
    expectVector(snapshot.bounds.min, [6, 2, -7]);
    expect(snapshot.bounds).not.toBe(snapshot.boxes[0]);
  });

  it("excludes hidden meshes, hidden descendants and hidden ancestors outside the root", () => {
    const parent = new T.Group(),
      root = new T.Group(),
      hidden = new T.Group();
    parent.add(root);
    root.add(mesh(), hidden);
    hidden.add(mesh([100, 100, 100]));
    hidden.visible = false;
    const invisibleMesh = mesh();
    invisibleMesh.visible = false;
    root.add(
      invisibleMesh,
      new T.Line(new T.BufferGeometry(), new T.LineBasicMaterial()),
    );
    expect(snapshotCollider(root).boxes).toHaveLength(1);
    parent.visible = false;
    expect(snapshotCollider(root).boxes).toEqual([]);
    expect(snapshotCollider(root).bounds.isEmpty()).toBe(true);
  });

  it("ignores meshes whose materials are all invisible", () => {
    const object = mesh();
    object.material.visible = false;
    expect(snapshotCollider(object).boxes).toEqual([]);
  });

  it("caches static geometry bounding boxes instead of rescanning vertices", () => {
    const object = mesh();
    const compute = vi.spyOn(object.geometry, "computeBoundingBox");
    snapshotCollider(object);
    object.position.x = 5;
    const next = snapshotCollider(object);
    expect(compute).toHaveBeenCalledTimes(1);
    expectVector(next.bounds.min, [4.5, -0.5, -0.5]);
  });

  it("refreshes skinned bounds after a bone moves, without requiring a render", () => {
    const geometry = new T.BoxGeometry(1, 1, 1);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute(
      "skinIndex",
      new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(weights, 4),
    );
    const object = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    const bone = new T.Bone();
    object.add(bone);
    object.bind(new T.Skeleton([bone]));
    const start = snapshotCollider(object);
    bone.position.x = 3;
    const deformed = snapshotCollider(object);
    expectVector(start.bounds.min, [-0.5, -0.5, -0.5]);
    expectVector(deformed.bounds.min, [2.5, -0.5, -0.5]);
    object.position.x = 10;
    expectVector(snapshotCollider(object).bounds.min, [12.5, -0.5, -0.5]);
  });

  it("refreshes current morph bounds instead of caching a previous deformation", () => {
    const object = mesh();
    const position = object.geometry.getAttribute("position");
    const morph = position.clone();
    for (let i = 0; i < morph.count; i++) morph.setX(i, position.getX(i) + 3);
    object.geometry.morphAttributes.position = [morph];
    object.updateMorphTargets();
    object.morphTargetInfluences![0] = 1;
    expectVector(snapshotCollider(object).bounds.min, [2.5, -0.5, -0.5]);
    object.morphTargetInfluences![0] = 0.5;
    expectVector(snapshotCollider(object).bounds.min, [1, -0.5, -0.5]);
  });

  it("keeps separate instance boxes so the space between instances remains empty", () => {
    const object = new T.InstancedMesh(
      new T.BoxGeometry(),
      new T.MeshBasicMaterial(),
      2,
    );
    object.setMatrixAt(0, new T.Matrix4().makeTranslation(-4, 0, 0));
    object.setMatrixAt(1, new T.Matrix4().makeTranslation(4, 0, 0));
    const fixed = obstacle(object);
    expect(fixed.collider.boxes).toHaveLength(2);
    const actor = mesh();
    const start = snapshotCollider(actor);
    actor.position.z = 2;
    expect(
      collisionBetween(start, snapshotCollider(actor), [fixed]),
    ).toBeNull();
    object.setMatrixAt(0, new T.Matrix4().makeTranslation(-8, 0, 0));
    expect(snapshotCollider(object).bounds.min.x).toBe(-8.5);
  });

  it("does not turn an environment's floor and walls into one solid room box", () => {
    const room = new T.Group();
    room.add(
      mesh([1, 5, 10], [-5, 2.5, 0]),
      mesh([1, 5, 10], [5, 2.5, 0]),
      mesh([10, 0.2, 10], [0, -0.1, 0]),
    );
    const actor = mesh([1, 2, 1], [0, 1, 0]);
    expect(motion(actor, [3, 1, 0], room)).toBeNull();
    expect(motion(actor, [5, 1, 0], room)).toBe("Wall");
    expect(snapshotCollider(room).boxes).toHaveLength(3);
  });
});

describe("endpoint collision checks", () => {
  it("rejects a new overlap and returns the blocking obstacle's name", () => {
    expect(motion(mesh([1, 1, 1], [-3, 0, 0]), [0, 0, 0], mesh())).toBe("Wall");
  });

  it("falls back to an obstacle id if its display name is empty", () => {
    const object = mesh(),
      fixed = obstacle(mesh(), "");
    expect(
      collisionBetween(
        { boxes: [], bounds: new T.Box3() },
        snapshotCollider(object),
        [fixed],
      ),
    ).toBe(fixed.id);
  });

  it("allows exact face, edge and corner tangency", () => {
    for (const destination of [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ] as XYZ[])
      expect(
        motion(mesh([1, 1, 1], [3, 3, 3]), destination, mesh()),
      ).toBeNull();
  });

  it("allows tiny numerical penetration but blocks meaningful penetration", () => {
    expect(
      motion(
        mesh([1, 1, 1], [2, 0, 0]),
        [1 - COLLISION_EPSILON / 2, 0, 0],
        mesh(),
      ),
    ).toBeNull();
    expect(motion(mesh([1, 1, 1], [2, 0, 0]), [0.99, 0, 0], mesh())).toBe(
      "Wall",
    );
  });

  it("checks the new world AABB after rotation", () => {
    const object = mesh([4, 1, 0.5]);
    const start = snapshotCollider(object);
    object.rotation.y = Math.PI / 2;
    expect(
      collisionBetween(start, snapshotCollider(object), [
        obstacle(mesh([1, 1, 1], [0, 0, 1.5])),
      ]),
    ).toBe("Wall");
  });

  it("checks the new world AABB after scaling", () => {
    const object = mesh();
    const start = snapshotCollider(object);
    object.scale.x = 5;
    expect(
      collisionBetween(start, snapshotCollider(object), [
        obstacle(mesh([1, 1, 1], [2, 0, 0])),
      ]),
    ).toBe("Wall");
  });

  it("does not impose a ground constraint", () => {
    const object = mesh(),
      start = snapshotCollider(object);
    object.position.y = -5;
    expect(collisionBetween(start, snapshotCollider(object), [])).toBeNull();
  });
});

describe("recovering from existing overlaps", () => {
  it("allows an unchanged overlap, a shallower overlap and a full outward escape", () => {
    for (const x of [1.5, 1.75, 3])
      expect(
        motion(mesh([2, 2, 2], [1.5, 0, 0]), [x, 0, 0], mesh([2, 2, 2])),
      ).toBeNull();
  });

  it("rejects deeper overlap and an escape through the obstacle's far side", () => {
    for (const x of [1.25, -3])
      expect(
        motion(mesh([2, 2, 2], [1.5, 0, 0]), [x, 0, 0], mesh([2, 2, 2])),
      ).toBe("Wall");
  });

  it("uses penetration depth when an entirely contained box has unchanged intersection volume", () => {
    const wall = mesh([10, 10, 10]);
    expect(motion(mesh([1, 1, 1], [4, 0, 0]), [3, 0, 0], wall)).toBe("Wall");
    expect(motion(mesh([1, 1, 1], [4, 0, 0]), [6, 0, 0], wall)).toBeNull();
  });

  it("rejects increased overlap volume even when the minimum depth is unchanged", () => {
    expect(
      motion(mesh([2, 2, 2], [1, 1.5, 0]), [0.5, 1.5, 0], mesh([2, 2, 2])),
    ).toBe("Wall");
  });

  it("detects a transient volume peak during an escape with unchanged minimum depth", () => {
    expect(
      motion(mesh([2, 2, 2], [1.5, 0, 1.9]), [0, 3, 1.9], mesh([2, 2, 2])),
    ).toBe("Wall");
  });

  it("allows a diagonal escape whose overlap volume and depth never grow", () => {
    expect(
      motion(mesh([2, 2, 2], [1, 1, 0]), [0, 2, 0], mesh([2, 2, 2])),
    ).toBeNull();
  });

  it("does not transfer an overlap allowance from one mesh to another", () => {
    const object = new T.Group();
    object.add(mesh([1, 1, 1], [-0.5, 0, 0]), mesh([1, 1, 1], [2, 0, 0]));
    expect(motion(object, [-1.5, 0, 0], mesh())).toBe("Wall");
  });

  it("matches mesh identity rather than array index after visibility changes", () => {
    const object = new T.Group(),
      a = mesh(),
      b = mesh([1, 1, 1], [4, 0, 0]);
    object.add(a, b);
    const start = snapshotCollider(object);
    a.visible = false;
    b.position.x = 0;
    expect(
      collisionBetween(start, snapshotCollider(object), [obstacle(mesh())]),
    ).toBe("Wall");
  });
});

describe("continuous translation sweeps", () => {
  it.each([0.01, 0.0001])(
    "blocks tunneling through a %s-unit wall with a clear far-side endpoint",
    (width) => {
      expect(
        motion(mesh([1, 1, 1], [-10, 0, 0]), [10, 0, 0], mesh([width, 10, 10])),
      ).toBe("Wall");
    },
  );

  it("handles negative and diagonal translation velocities", () => {
    expect(
      motion(mesh([1, 1, 1], [10, 0, 0]), [-10, 0, 0], mesh([0.01, 5, 5])),
    ).toBe("Wall");
    expect(
      motion(mesh([1, 1, 1], [-10, 0, -10]), [10, 0, 10], mesh([0.01, 5, 5])),
    ).toBe("Wall");
  });

  it("blocks crossing a zero-thickness geometric plane", () => {
    const plane = new T.Mesh(
      new T.PlaneGeometry(10, 10),
      new T.MeshBasicMaterial(),
    );
    plane.rotation.y = Math.PI / 2;
    expect(motion(mesh([1, 1, 1], [-10, 0, 0]), [10, 0, 0], plane)).toBe(
      "Wall",
    );
  });

  it("allows sliding along a wall face and a path that only grazes a corner", () => {
    expect(motion(mesh([1, 1, 1], [-3, 1, 0]), [3, 1, 0], mesh())).toBeNull();
    expect(motion(mesh([1, 1, 1], [-2, 0, 0]), [0, 2, 0], mesh())).toBeNull();
  });

  it("does not confuse diagonal swept bounds with a genuine path intersection", () => {
    expect(motion(mesh([1, 1, 1], [-3, 0, 0]), [0, 0, 3], mesh())).toBeNull();
  });

  it("can explicitly disable sweep for teleportation or endpoint-only validation", () => {
    expect(
      motion(
        mesh([1, 1, 1], [-10, 0, 0]),
        [10, 0, 0],
        mesh([0.01, 5, 5]),
        false,
      ),
    ).toBeNull();
  });

  it("does not sweep resized boxes", () => {
    const object = mesh([1, 1, 1], [-3, 0, 0]);
    const start = snapshotCollider(object);
    object.position.x = 3;
    object.scale.setScalar(2);
    expect(
      collisionBetween(start, snapshotCollider(object), [
        obstacle(mesh([0.01, 5, 5])),
      ]),
    ).toBeNull();
  });

  it("does not infer a pure translation from equal-sized AABBs after a rotation", () => {
    const object = mesh([1, 1, 1], [-3, 0, 0]);
    const start = snapshotCollider(object);
    object.position.x = 3;
    object.rotation.y = Math.PI / 2;
    expect(
      collisionBetween(start, snapshotCollider(object), [
        obstacle(mesh([0.01, 5, 5])),
      ]),
    ).toBeNull();
  });
});
