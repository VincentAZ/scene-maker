import * as T from "three";
import {
  routeLocomotionProfile,
  routeSourceDuration,
  type LocomotionProfile,
} from "./locomotion";
import { measureOnRig, standingHeight } from "./rig";

const grounded = new WeakMap<
  T.Group,
  Map<T.AnimationClip, Map<string, number[]>>
>();

/** Source-local moments of a gait take at which both feet are nearest the
 * floor: the local minima of the higher foot's lift, within a small share of
 * the standing height. A walk gives its foot handovers; a take whose feet
 * never share the floor (a run's flight) gives only its most grounded
 * moment. Measured on the take itself, so names play no part. */
export function groundedPhases(
  source: T.Group,
  take: T.AnimationClip,
  interval?: { start: number; end: number },
): number[] {
  const start = interval?.start ?? 0,
    end = interval?.end ?? take.duration;
  const key = `${start}:${end}`;
  let byTake = grounded.get(source);
  if (!byTake) grounded.set(source, (byTake = new Map()));
  let byInterval = byTake.get(take);
  if (!byInterval) byTake.set(take, (byInterval = new Map()));
  const known = byInterval.get(key);
  if (known) return known;
  const bones = source.userData.bones as Record<string, T.Bone> | undefined;
  const height = standingHeight(source);
  const result: number[] = [];
  if (bones?.leftFoot && bones.rightFoot && height > 0 && end > start) {
    const samples = Math.max(8, Math.ceil((end - start) * 60));
    const left: number[] = [],
      right: number[] = [];
    const world = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
    measureOnRig(source, (sample) => {
      for (let i = 0; i <= samples; i++) {
        sample(take, start + ((end - start) * i) / samples);
        left.push(world(bones.leftFoot).y);
        right.push(world(bones.rightFoot).y);
      }
    });
    const floorLeft = Math.min(...left),
      floorRight = Math.min(...right);
    const lift = left.map((y, i) =>
      Math.max(y - floorLeft, right[i] - floorRight),
    );
    const band = 0.08 * height;
    const count = lift.length;
    // Local minima on the cyclic sequence (the last sample repeats the first
    // phase of a loop, so it is not a candidate of its own).
    for (let i = 0; i < count - 1; i++) {
      const before = lift[(i - 1 + (count - 1)) % (count - 1)],
        after = lift[(i + 1) % (count - 1)];
      if (lift[i] <= band && lift[i] <= before && lift[i] < after)
        result.push(((end - start) * i) / samples);
    }
    if (!result.length) {
      let lowest = 0;
      for (let i = 1; i < count - 1; i++)
        if (lift[i] < lift[lowest]) lowest = i;
      result.push(((end - start) * lowest) / samples);
    }
  }
  byInterval.set(key, result);
  return result;
}

/** Clip-local times at which an imported route can stop with its feet on the
 * floor, from the clip's own linear mapping of travelling time onto source
 * time. */
export function routeStopCandidates(
  source: T.Group,
  take: T.AnimationClip,
  measured: LocomotionProfile,
  sourceDistance: number,
  active: number,
): number[] {
  const profile = routeLocomotionProfile(measured, sourceDistance);
  const sourceDuration = routeSourceDuration(profile, sourceDistance);
  if (!(sourceDuration > 0 && active > 0)) return [];
  const start = profile.sourceStart ?? 0;
  const phases = groundedPhases(source, take, {
    start,
    end: start + profile.duration,
  });
  const times: number[] = [];
  for (let cycle = 0; cycle * profile.duration < sourceDuration; cycle++)
    for (const phase of phases) {
      const sourceTime = cycle * profile.duration + phase;
      if (sourceTime < sourceDuration)
        times.push((active * sourceTime) / sourceDuration);
    }
  return times.sort((a, b) => a - b);
}
