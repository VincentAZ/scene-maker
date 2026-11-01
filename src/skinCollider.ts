import * as T from "three";

type Attribute = T.BufferAttribute | T.InterleavedBufferAttribute;
type Partition = {
  attributes: Attribute[];
  versions: number[];
  count: number;
  bones: number[];
  memberships: number[][];
};
const partitions = new WeakMap<T.BufferGeometry, Partition>();
const version = (attribute: Attribute) =>
  attribute instanceof T.InterleavedBufferAttribute
    ? attribute.data.version
    : attribute.version;

/** Assign complete triangles to skin regions, never just individual vertices.
 * The dominant combined influence names the region; every corner of every
 * assigned triangle contributes to its bounds, including blended seam vertices.
 * Thus regions cover the rendered surface without filling the empty space
 * between a character's limbs. No anatomical names or provider rules are used. */
function partition(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute("position"),
    indices = geometry.getAttribute("skinIndex"),
    weights = geometry.getAttribute("skinWeight"),
    triangles = geometry.getIndex();
  if (!position || !indices || !weights) return;
  const attributes = [
    position,
    indices,
    weights,
    ...(triangles ? [triangles] : []),
  ];
  const known = partitions.get(geometry);
  if (
    known &&
    known.count === position.count &&
    known.attributes.length === attributes.length &&
    attributes.every(
      (attribute, i) =>
        attribute === known.attributes[i] &&
        version(attribute) === known.versions[i],
    )
  )
    return known;
  const memberships = Array.from(
    { length: position.count },
    () => new Set<number>(),
  );
  const bones: number[] = [],
    slots = new Map<number, number>();
  const assign = (vertices: number[]) => {
    const influence = new Map<number, number>();
    for (const vertex of vertices)
      for (
        let component = 0;
        component < Math.min(4, weights.itemSize);
        component++
      ) {
        const bone = indices.getComponent(vertex, component),
          weight = weights.getComponent(vertex, component);
        if (weight > 0)
          influence.set(bone, (influence.get(bone) ?? 0) + weight);
      }
    let bone = -1,
      weight = -Infinity;
    for (const [candidate, total] of influence)
      if (total > weight) {
        bone = candidate;
        weight = total;
      }
    let slot = slots.get(bone);
    if (slot === undefined) {
      slot = bones.length;
      bones.push(bone);
      slots.set(bone, slot);
    }
    for (const vertex of vertices) memberships[vertex].add(slot);
  };
  const count = triangles?.count ?? position.count;
  for (let i = 0; i + 2 < count; i += 3)
    assign(
      [0, 1, 2].map((corner) =>
        triangles ? triangles.getX(i + corner) : i + corner,
      ),
    );
  // Preserve conservative bounds for unused vertices too. Draw ranges/material
  // groups are deliberately not interpreted by the collision approximation.
  for (let i = 0; i < position.count; i++)
    if (!memberships[i].size) assign([i]);
  const result: Partition = {
    attributes,
    versions: attributes.map(version),
    count: position.count,
    bones,
    memberships: memberships.map((set) => [...set]),
  };
  partitions.set(geometry, result);
  return result;
}

/** Current world bounds per complete skin region. The caller updates bones and
 * bind matrices first. Three's vertex evaluator includes skinning and morphs;
 * each vertex is evaluated once, even if it belongs to multiple seam regions. */
export function skinColliderRegions(mesh: T.SkinnedMesh) {
  const regions = partition(mesh.geometry);
  if (!regions) return;
  const boxes = regions.bones.map(() => new T.Box3()),
    vertex = new T.Vector3();
  for (let i = 0; i < regions.count; i++) {
    mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld);
    for (const region of regions.memberships[i])
      boxes[region].expandByPoint(vertex);
  }
  return boxes.map((box, i) => ({ box, bone: regions.bones[i] }));
}
