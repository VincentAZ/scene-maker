import { expect, it } from "vitest";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { firstInterpolatedOverlap, snapshotCollider } from "../src/collision";

function fixture(indexed = true) {
  let geometry = mergeGeometries([
    new T.BoxGeometry(0.5, 1, 0.5).translate(-1, 0, 0),
    new T.BoxGeometry(0.5, 1, 0.5).translate(1, 0, 0),
  ])!;
  if (!indexed) geometry = geometry.toNonIndexed();
  const position = geometry.getAttribute("position"),
    indices = new Uint16Array(position.count * 4),
    weights = new Float32Array(position.count * 4);
  for (let i = 0; i < position.count; i++) {
    indices[i * 4] = position.getX(i) < 0 ? 0 : 1;
    weights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial()),
    bones = [new T.Bone(), new T.Bone()];
  mesh.add(...bones);
  mesh.bind(new T.Skeleton(bones));
  return { mesh, bones, geometry };
}
function coversTriangles(mesh: T.SkinnedMesh) {
  const collider = snapshotCollider(mesh),
    geometry = mesh.geometry,
    index = geometry.index,
    count = index?.count ?? geometry.attributes.position.count;
  for (let i = 0; i + 2 < count; i += 3) {
    const points = [0, 1, 2].map((corner) =>
      mesh
        .getVertexPosition(
          index ? index.getX(i + corner) : i + corner,
          new T.Vector3(),
        )
        .applyMatrix4(mesh.matrixWorld),
    );
    expect(
      collider.boxes.some((box) => points.every((p) => box.containsPoint(p))),
    ).toBe(true);
  }
  return collider;
}

it.each([true, false])(
  "keeps empty space between skin regions open and covers all triangles (indexed=%s)",
  (indexed) => {
    const { mesh, bones } = fixture(indexed),
      obstacle = new T.Mesh(
        new T.BoxGeometry(0.25, 0.25, 0.25),
        new T.MeshBasicMaterial(),
      );
    const body = coversTriangles(mesh),
      box = snapshotCollider(obstacle);
    expect(body.boxes).toHaveLength(2);
    expect(body.bounds.intersectsBox(box.bounds)).toBe(true);
    expect(firstInterpolatedOverlap(body, body, box, box)).toBeNull();
    bones[0].position.x = 1;
    const touching = coversTriangles(mesh);
    expect(firstInterpolatedOverlap(touching, touching, box, box)).toBe(0);
    bones[0].position.x = 2;
    const crossed = coversTriangles(mesh);
    expect(firstInterpolatedOverlap(body, crossed, box, box)).toBeGreaterThan(
      0,
    );
    expect(firstInterpolatedOverlap(body, crossed, box, box)).toBeLessThan(1);
  },
);

it("covers blended seam triangles after bone motion, morphing and nested nonuniform transforms", () => {
  const { mesh, bones, geometry } = fixture();
  // An added triangle bridges the two regions with different dominant weights
  // at each corner. Splitting only vertices would lose its interior entirely.
  geometry.setIndex([...geometry.index!.array, 0, 24, 25]);
  const weights = geometry.getAttribute("skinWeight"),
    indices = geometry.getAttribute("skinIndex");
  indices.setXYZW(0, 0, 1, 0, 0);
  weights.setXYZW(0, 0.55, 0.45, 0, 0);
  const morph = geometry.getAttribute("position").clone();
  for (let i = 0; i < morph.count; i++)
    morph.setY(i, morph.getY(i) + Math.sin(i) * 0.2);
  geometry.morphAttributes.position = [morph];
  mesh.updateMorphTargets();
  const parent = new T.Group();
  parent.scale.set(2, 0.7, 1.4);
  parent.rotation.set(0.3, 0.6, -0.2);
  parent.add(mesh);
  mesh.rotation.set(-0.2, 0.4, 0.1);
  mesh.position.set(3, 2, -1);
  for (const phase of [0, 0.3, 1, 0.7, 0]) {
    bones[0].rotation.y = phase;
    bones[1].rotation.z = phase * 0.7;
    mesh.morphTargetInfluences![0] = phase;
    coversTriangles(mesh);
  }
});

it("invalidates cached partitions when weights, indices or topology change", () => {
  const { mesh, geometry } = fixture();
  expect(coversTriangles(mesh).boxes).toHaveLength(2);
  const skinIndex = geometry.getAttribute("skinIndex");
  for (let i = 0; i < skinIndex.count; i++) skinIndex.setX(i, 0);
  skinIndex.needsUpdate = true;
  expect(coversTriangles(mesh).boxes).toHaveLength(1);
  for (let i = 0; i < skinIndex.count; i++) skinIndex.setY(i, 1);
  skinIndex.needsUpdate = true;
  const weights = geometry.getAttribute("skinWeight");
  for (let i = skinIndex.count / 2; i < skinIndex.count; i++)
    weights.setXYZW(i, 0, 1, 0, 0);
  weights.needsUpdate = true;
  expect(coversTriangles(mesh).boxes).toHaveLength(2);
  geometry.setIndex([...geometry.index!.array, 0, 24, 25]);
  coversTriangles(mesh);
});

it("handles interleaved skin attributes and their shared-buffer updates", () => {
  const { mesh, geometry } = fixture();
  for (const name of ["skinIndex", "skinWeight"]) {
    const original = geometry.getAttribute(name),
      data = new Float32Array(original.count * 6);
    for (let i = 0; i < original.count; i++)
      for (let c = 0; c < 4; c++)
        data[i * 6 + c + 1] = original.getComponent(i, c);
    geometry.setAttribute(
      name,
      new T.InterleavedBufferAttribute(new T.InterleavedBuffer(data, 6), 4, 1),
    );
  }
  expect(coversTriangles(mesh).boxes).toHaveLength(2);
  const indices = geometry.getAttribute(
    "skinIndex",
  ) as T.InterleavedBufferAttribute;
  for (let i = 0; i < indices.count; i++) indices.setX(i, 0);
  indices.data.needsUpdate = true;
  expect(coversTriangles(mesh).boxes).toHaveLength(1);
});
