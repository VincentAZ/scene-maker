import * as T from "three";

/** Record the same evaluated transforms used by the preview, including imported parent nodes. */
export function bakeAnimation(
  objects: Iterable<T.Group>,
  total: number,
  renderAt: (time: number) => void,
) {
  const nodes = new Set<T.Object3D>();
  for (const object of objects) {
    nodes.add(object);
    object.traverse((child) => {
      if (child instanceof T.Bone) nodes.add(child);
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
  const times = Array.from({ length: Math.ceil(total * 24) + 1 }, (_, i) =>
    Math.min(i / 24, total),
  );
  const sampled = [...nodes].map((object) => ({
    object,
    positions: [] as number[],
    rotations: [] as number[],
    scales: [] as number[],
    weights: [] as number[],
  }));
  for (const time of times) {
    renderAt(time);
    for (const sample of sampled) {
      sample.positions.push(...sample.object.position.toArray());
      sample.rotations.push(...sample.object.quaternion.toArray());
      sample.scales.push(...sample.object.scale.toArray());
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
