import * as T from "three";
import { allMotions, type Scene } from "../shared/scene";
import {
  clipEffectiveEnd,
  clipPlaybackRate,
  clipSourceEnd,
} from "../shared/clipTiming";
import { motionSource } from "./rig";

/**
 * Base timeline cadence. Imported takes also contribute their source keys and,
 * when accelerated, a 60 Hz source-time grid: a fixed timeline cadence alone
 * can erase a complete gesture between adjacent frames at up to 300x speed.
 */
export const BAKE_SAMPLE_FPS = 60;

/**
 * Map active source detail into timeline seconds, including trim/hold edges.
 * The extra grid preserves nonlinear interpolation and composed rotations even
 * on sparse takes, with cost proportional to consumed source time, not holds.
 * Distance-driven route cycles are not an affine playbackRate mapping; those
 * remain limited to the base timeline cadence until phase-aware baking exists.
 */
export function animationSampleBoundaries(
  scene: Scene,
  objects: ReadonlyMap<string, T.Group>,
) {
  const motions = new Map(
    allMotions(scene).map((motion) => [motion.id, motion]),
  );
  return scene.entities.flatMap((entity) => {
    const object = objects.get(entity.id);
    let time = 0;
    return entity.clips.flatMap((clip) => {
      // Most bone tracks share key times; deduplicate while collecting rather
      // than allocating one sample entry per bone per source frame.
      const boundaries = new Map<number, number>();
      const addBoundary = (value: number) =>
        boundaries.set(Math.fround(value), value);
      const motion = motions.get(clip.motionId);
      if (motion?.kind === "imported") {
        const source =
          motion.sourceAssetId === entity.assetId
            ? object
            : object && motion.sourceAssetId
              ? motionSource(object, motion.sourceAssetId)
              : undefined;
        const native = T.AnimationClip.findByName(
          source?.userData.animations || [],
          motion.animationName || "",
        );
        // Imported metadata can be rounded/stale: prefer the loaded take used
        // by preview, including when it comes from a separate motion source.
        const duration = native?.duration ?? motion.duration;
        const end = clipEffectiveEnd(clip, duration);
        if (native && !motion.path) {
          const rate = clipPlaybackRate(clip, duration);
          const sourceEnd = clipSourceEnd(clip, duration);
          if (Number.isFinite(rate) && rate > 0) {
            for (const track of native.tracks)
              for (const sourceTime of track.times)
                if (sourceTime > 0 && sourceTime < sourceEnd)
                  addBoundary(time + sourceTime / rate);
            // Sample in source space, not by multiplying the entire scheduled
            // slot's frame rate (which would oversample long held tails).
            if (rate > 1)
              for (
                let frame = 1;
                frame < Math.ceil(sourceEnd * BAKE_SAMPLE_FPS);
                frame++
              )
                addBoundary(time + frame / BAKE_SAMPLE_FPS / rate);
          }
        }
        if (
          end > 0 &&
          Math.fround(time + end) < Math.fround(time + clip.duration)
        )
          addBoundary(time + end);
      }
      time += clip.duration;
      addBoundary(time);
      // All emitted tracks store Float32 times; collapse source/grid/edge
      // collisions at that precision, keeping the exact clip/hold boundary.
      return [...boundaries.values()].sort((a, b) => a - b);
    });
  });
}

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
      // Transferred facial animation is evaluated onto the receiving mesh;
      // that target need not have any native clips or a mixer of its own.
      if (child instanceof T.Mesh && child.morphTargetInfluences?.length)
        nodes.add(child);
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
    Array.from({ length: Math.ceil(total * BAKE_SAMPLE_FPS) + 1 }, (_, i) => {
      const time = Math.min(i / BAKE_SAMPLE_FPS, total);
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
