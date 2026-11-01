import * as T from "three";
import { allMotions, type Scene } from "../shared/scene";
import {
  clipEffectiveEnd,
  routeActiveDuration,
  clipPlaybackRate,
  clipSourceEnd,
  clipSourceStart,
} from "../shared/clipTiming";
import { importedClip, motionSource } from "./rig";
import {
  locomotionProfile,
  locomotionScale,
  routeSourceBoundaries,
  sampleLocomotion,
} from "./locomotion";
import { samplePath } from "../shared/path";

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
 * Distance-driven routes invert their measured gait table to retain source keys
 * and phase samples even when several strides fit between timeline frames.
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
      if (clip.routeWait) {
        time += clip.duration;
        return [time];
      }
      // Most bone tracks share key times; deduplicate while collecting rather
      // than allocating one sample entry per bone per source frame.
      const boundaries = new Map<number, number>();
      const addBoundary = (value: number) =>
        boundaries.set(Math.fround(value), value);
      const motion = motions.get(clip.motionId);
      // The stopping instant need not fall on a source key or the bake grid.
      // Keep it explicitly so export cannot interpolate movement into a wait.
      if (clip.routeStop !== undefined) addBoundary(time + clip.routeStop);
      if (motion?.kind === "imported") {
        const source =
          motion.sourceAssetId === entity.assetId
            ? object
            : object && motion.sourceAssetId
              ? motionSource(object, motion.sourceAssetId)
              : undefined;
        const native = importedClip(
          source?.userData.animations || [],
          motion.animationName || "",
        );
        // Imported metadata can be rounded/stale: prefer the loaded take used
        // by preview, including when it comes from a separate motion source.
        const duration = native?.duration ?? motion.duration;
        const end = motion.path
          ? routeActiveDuration(clip)
          : clipEffectiveEnd(clip, duration);
        if (native && motion.path && source && object) {
          const profile = locomotionProfile(
            source,
            native,
            motion.path.sourceRange,
          );
          const ratio = source === object ? 1 : locomotionScale(source, object);
          if (
            profile &&
            ratio > 0 &&
            profile.distance >= 0.15 &&
            profile.distance / profile.duration >= 0.05
          ) {
            const keys = new Set<number>();
            for (const track of native.tracks)
              for (const key of track.times) keys.add(key);
            for (const progress of motion.path.sourceProgress ?? [])
              if (progress > 0 && progress < 1)
                keys.add(
                  sampleLocomotion(profile, progress * profile.distance)
                    .sourceTime,
                );
            for (const boundary of routeSourceBoundaries(
              profile,
              keys,
              samplePath(motion.path, 1).length /
                ratio /
                (motion.path.strideScale ?? 1),
              routeActiveDuration(clip),
            ))
              addBoundary(time + boundary);
          }
        }
        if (native && !motion.path) {
          const rate = clipPlaybackRate(clip, duration);
          const sourceEnd = clipSourceEnd(clip, duration);
          const sourceStart = clipSourceStart(clip, duration);
          if (Number.isFinite(rate) && rate > 0) {
            for (const track of native.tracks)
              for (const sourceTime of track.times)
                if (sourceTime > sourceStart && sourceTime < sourceEnd)
                  addBoundary(time + (sourceTime - sourceStart) / rate);
            // Sample in source space, not by multiplying the entire scheduled
            // slot's frame rate (which would oversample long held tails).
            if (rate > 1)
              for (
                let frame = 1;
                frame < Math.ceil((sourceEnd - sourceStart) * BAKE_SAMPLE_FPS);
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
        // Configured imported rigs also receive shared takes when their own
        // animation list is empty. Their armature/timeline frame changes need
        // the same stable export coordinates as a native animated rig.
        if (!object.userData.mixer) return;
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
  const times: number[] = [];
  const sampled = [...nodes].map((object) => ({
    object,
    positions: [] as number[],
    rotations: [] as number[],
    scales: [] as number[],
    weights: [] as number[],
  }));
  const indexByObject = new Map(
    sampled.map((sample, index) => [sample.object, index]),
  );
  const capture = (time: number) => {
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
    const values = sampled.map((sample) => {
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
      return {
        position,
        rotation: rotation.normalize(),
        scale,
        world: exportWorld(object),
        weights:
          object instanceof T.Mesh && object.morphTargetInfluences
            ? [...object.morphTargetInfluences]
            : undefined,
      };
    });
    return { time: Math.fround(time), values };
  };
  type Frame = ReturnType<typeof capture>;
  const append = (frame: Frame) => {
    times.push(frame.time);
    frame.values.forEach((value, index) => {
      const sample = sampled[index];
      sample.positions.push(...value.position.toArray());
      sample.rotations.push(...value.rotation.toArray());
      sample.scales.push(...value.scale.toArray());
      if (value.weights) sample.weights.push(...value.weights);
    });
  };
  const matchesInterpolation = (a: Frame, b: Frame, middle: Frame) => {
    const fraction = (middle.time - a.time) / (b.time - a.time);
    const worlds = new Map<T.Object3D, T.Matrix4>();
    const interpolateWorld = (object: T.Object3D): T.Matrix4 => {
      const cached = worlds.get(object);
      if (cached) return cached;
      const index = indexByObject.get(object);
      const local =
        index === undefined
          ? object.matrix.clone()
          : new T.Matrix4().compose(
              a.values[index].position
                .clone()
                .lerp(b.values[index].position, fraction),
              a.values[index].rotation
                .clone()
                .slerp(b.values[index].rotation, fraction),
              a.values[index].scale
                .clone()
                .lerp(b.values[index].scale, fraction),
            );
      const world = object.parent
        ? interpolateWorld(object.parent).clone().multiply(local)
        : local;
      worlds.set(object, world);
      return world;
    };
    for (const [index, sample] of sampled.entries()) {
      const actual = middle.values[index];
      const p = new T.Vector3(),
        q = new T.Quaternion(),
        s = new T.Vector3();
      const expectedP = new T.Vector3(),
        expectedQ = new T.Quaternion(),
        expectedS = new T.Vector3();
      interpolateWorld(sample.object).decompose(p, q, s);
      actual.world.decompose(expectedP, expectedQ, expectedS);
      if (
        // Leave headroom for skin vertices beyond joint centres and for
        // Float32 GLB interpolation. A .25 mm joint tolerance can exceed
        // .4 mm at the surface after composing the limb transforms.
        p.distanceTo(expectedP) > 0.0001 ||
        q.normalize().angleTo(expectedQ.normalize()) > 0.0005
      )
        return false;
      for (const axis of ["x", "y", "z"] as const)
        if (
          Math.abs(s[axis] - expectedS[axis]) >
          1e-4 * Math.max(Math.abs(s[axis]), Math.abs(expectedS[axis]), 1e-12)
        )
          return false;
      if (
        actual.weights?.some(
          (value, i) =>
            Math.abs(
              value -
                T.MathUtils.lerp(
                  a.values[index].weights![i],
                  b.values[index].weights![i],
                  fraction,
                ),
            ) > 1e-4,
        )
      )
        return false;
    }
    return true;
  };
  // Contact IK and composed retargeting are nonlinear between source keys.
  // Refine only intervals whose exported interpolation misses the evaluated
  // pose. Compare in world units, independent of imported bone units/scale.
  const refine = (
    a: Frame,
    b: Frame,
    depth: number,
    capturedMiddle?: Frame,
  ) => {
    const time = Math.fround((a.time + b.time) / 2);
    if (depth >= 8 || time <= a.time || time >= b.time) {
      append(a);
      return;
    }
    const middle = capturedMiddle || capture(time);
    let firstQuarter: Frame | undefined, lastQuarter: Frame | undefined;
    let matches = matchesInterpolation(a, b, middle);
    if (matches) {
      // An inflection can cross the interpolated pose at the midpoint while
      // deviating on either side. Check both halves before accepting it.
      const firstTime = Math.fround((a.time + middle.time) / 2),
        lastTime = Math.fround((middle.time + b.time) / 2);
      if (firstTime > a.time && firstTime < middle.time)
        firstQuarter = capture(firstTime);
      if (lastTime > middle.time && lastTime < b.time)
        lastQuarter = capture(lastTime);
      matches =
        (!firstQuarter || matchesInterpolation(a, b, firstQuarter)) &&
        (!lastQuarter || matchesInterpolation(a, b, lastQuarter));
    }
    if (matches) {
      append(a);
      return;
    }
    refine(a, middle, depth + 1, firstQuarter);
    refine(middle, b, depth + 1, lastQuarter);
  };
  let previous = capture(keys[0][1]);
  for (const [, time] of keys.slice(1)) {
    const next = capture(time);
    refine(previous, next, 0);
    previous = next;
  }
  append(previous);
  renderAt(total);
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
