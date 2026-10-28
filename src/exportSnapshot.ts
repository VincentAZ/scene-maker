import * as T from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";

// Keep exporter reads independent of later edits or scene disposal. The UUIDs
// match the baked animation bindings, while skeletons and mesh buffers are copied.
export function exportSnapshot(source: T.Group): T.Group {
  const originals: T.Object3D[] = [];
  const metadata = new Map<T.Object3D, T.Object3D["userData"]>();
  source.traverse((object) => {
    originals.push(object);
    metadata.set(object, object.userData);
    object.userData = {};
  });
  let snapshot: T.Group;
  try {
    snapshot = clone(source) as T.Group;
  } finally {
    for (const [object, data] of metadata) object.userData = data;
  }
  let index = 0;
  snapshot.traverse((object) => {
    object.uuid = originals[index++].uuid;
    if (object instanceof T.Mesh) {
      object.geometry = object.geometry.clone();
      object.material = Array.isArray(object.material)
        ? object.material.map((material) => material.clone())
        : object.material.clone();
    }
  });
  return snapshot;
}
