import * as T from "three";

/** Record the same evaluated transforms used by the preview, including imported parent nodes. */
export function bakeAnimation(
  objects: Iterable<T.Group>,
  total: number,
  renderAt: (time: number) => void,
  boundaries: number[] = [],
) {
  const nodes = new Set<T.Object3D>();
  const parents = new Set<T.Object3D>();
  for (const object of objects) {
    nodes.add(object);
    object.traverse((child) => {
      if (child instanceof T.Bone) {
        nodes.add(child);
        if (!object.userData.animations?.length) return;
        for (
          let parent = child.parent;
          parent && parent !== object.parent;
          parent = parent.parent
        )
          if (!(parent instanceof T.Bone)) parents.add(parent);
      }
    });
    const root = (
      object.userData.mixer as T.AnimationMixer | undefined
    )?.getRoot();
    if (root)
      for (const clip of (object.userData.animations ||
        []) as T.AnimationClip[])
        for (const track of clip.tracks) {
          const path = T.PropertyBinding.parseTrackName(track.name);
          const node = T.PropertyBinding.findNode(root, path.nodeName);
          if (node instanceof T.Object3D) nodes.add(node);
        }
  }
  // Use a stable coordinate frame for rig ancestors. Native clips can animate
  // an armature parent, then hand travel to the studio root at a clip boundary.
  // Interpolating those two compensating transforms independently creates a
  // visible arc between otherwise identical world poses.
  renderAt(0);
  const fixed = new Map<T.Object3D, T.Matrix4>();
  for (const parent of parents) {
    parent.updateWorldMatrix(true, true);
    fixed.set(parent, parent.matrix.clone());
    nodes.add(parent);
    for (const child of parent.children) nodes.add(child);
  }
  const samples = new Map(
    Array.from({ length: Math.ceil(total * 24) + 1 }, (_, i) => {
      const time = Math.min(i / 24, total);
      return [Math.fround(time), time];
    }),
  );
  for (const boundary of boundaries) {
    if (boundary <= 0 || boundary > total) continue;
    samples.set(Math.fround(boundary), boundary);
  }
  const keys = [...samples].sort(([a], [b]) => a - b);
  const times = keys.map(([time]) => time);
  const sampled = [...nodes].map((object) => ({
    object,
    positions: [] as number[],
    rotations: [] as number[],
    scales: [] as number[],
    weights: [] as number[],
  }));
  for (const [, time] of keys) {
    renderAt(time);
    const worlds = new Map<T.Object3D, T.Matrix4>();
    const exportWorld = (object: T.Object3D): T.Matrix4 => {
      const known = worlds.get(object);
      if (known) return known;
      object.updateWorldMatrix(true, false);
      const local = fixed.get(object);
      const matrix = local
        ? (object.parent
            ? exportWorld(object.parent).clone()
            : new T.Matrix4()
          ).multiply(local)
        : object.matrixWorld.clone();
      worlds.set(object, matrix);
      return matrix;
    };
    for (const sample of sampled) {
      const object = sample.object;
      const matrix =
        fixed.get(object) ||
        (object.parent
          ? exportWorld(object.parent)
              .clone()
              .invert()
              .multiply(exportWorld(object))
          : exportWorld(object));
      const position = new T.Vector3(),
        rotation = new T.Quaternion(),
        scale = new T.Vector3();
      matrix.decompose(position, rotation, scale);
      sample.positions.push(...position.toArray());
      sample.rotations.push(...rotation.toArray());
      sample.scales.push(...scale.toArray());
      if (
        sample.object instanceof T.Mesh &&
        sample.object.morphTargetInfluences
      )
        sample.weights.push(...sample.object.morphTargetInfluences);
    }
  }
  const tracks: T.KeyframeTrack[] = [];
  for (const sample of sampled) {
    const name = sample.object.uuid;
    tracks.push(
      new T.VectorKeyframeTrack(name + ".position", times, sample.positions),
      new T.QuaternionKeyframeTrack(
        name + ".quaternion",
        times,
        sample.rotations,
      ),
      new T.VectorKeyframeTrack(name + ".scale", times, sample.scales),
    );
    if (sample.weights.length)
      tracks.push(
        new T.NumberKeyframeTrack(
          name + ".morphTargetInfluences",
          times,
          sample.weights,
        ),
      );
  }
  return new T.AnimationClip("Scene Maker sequence", total, tracks);
}
