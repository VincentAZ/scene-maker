import * as T from "three";
import { finishNavigationWork } from "./navigationWork";
import { rotationDistance } from "./sourceJoins";
import { applyHumanoidPose, sampleNativeClip, standingHeight } from "./rig";
import {
  sampleRouteLocomotion,
  routeSourceDuration,
  type LocomotionProfile,
} from "./locomotion";

export type ArrivalMatch = {
  sourceStart: number;
  sourceEnd: number;
  prefixDistance: number;
  prefixSourceDuration: number;
  tailDistance: number;
  support: number;
  positionRms: number;
  positionMax: number;
  rotationRms: number;
  rotationMax: number;
  velocityRms: number;
  angularVelocityRms: number;
  scaleMax: number;
  speedDifference: number;
  morphMax: number;
  score: number;
};
type Pose = {
  positions: T.Vector3[];
  rotations: T.Quaternion[];
  scales: T.Vector3[];
  morphs: number[];
};
const up = new T.Vector3(0, 1, 0);

/** Candidate matching only: this does not certify scene clearance or apply a
 * transition. Distances use source-local units. Compare a route's prospective
 * outgoing phase to captured deceleration entries in the same original take.
 * Only positively weighted or rigidly attached bones contribute, including
 * detached deformers. Stationary control bones cannot dominate the score. */
export function* matchCapturedArrivalSteps(
  source: T.Group,
  clip: T.AnimationClip,
  profile: LocomotionProfile,
  distance: number,
  prefixDistanceForEntry?: (
    sourceStart: number,
    sourceEnd: number,
    tailDistance: number,
  ) => number | undefined,
): Generator<
  void,
  {
    match?: ArrivalMatch;
    matches: ArrivalMatch[];
    best?: ArrivalMatch;
    examined: number;
  },
  unknown
> {
  if (
    !profile.stops?.length ||
    profile.frames.length < 2 ||
    !(distance > 0) ||
    !Number.isFinite(distance)
  )
    return { examined: 0, matches: [] };
  const height = standingHeight(source);
  if (!(height > 0) || !Number.isFinite(height))
    return { examined: 0, matches: [] };
  const weighted = new Set<T.Object3D>(),
    morphs: T.Mesh[] = [];
  source.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    if (node.morphTargetInfluences) morphs.push(node);
    if (node instanceof T.SkinnedMesh) {
      const indices = node.geometry.attributes.skinIndex,
        weights = node.geometry.attributes.skinWeight;
      if (!indices || !weights) return;
      for (let i = 0; i < weights.count; i++)
        for (let component = 0; component < weights.itemSize; component++)
          if (weights.getComponent(i, component) > 0) {
            const bone =
              node.skeleton.bones[indices.getComponent(i, component)];
            if (bone) weighted.add(bone);
          }
    } else {
      weighted.add(node);
      for (
        let parent = node.parent;
        parent && parent !== source;
        parent = parent.parent
      )
        if (parent instanceof T.Bone) {
          weighted.add(parent);
          break;
        }
    }
  });
  const bones = [...weighted];
  if (!bones.length) return { examined: 0, matches: [] };
  const saved: {
    node: T.Object3D;
    p: T.Vector3;
    q: T.Quaternion;
    s: T.Vector3;
    weights?: number[];
  }[] = [];
  source.traverse((node) =>
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
      weights:
        node instanceof T.Mesh
          ? node.morphTargetInfluences?.slice()
          : undefined,
    }),
  );
  const mixer = source.userData.mixer as T.AnimationMixer;
  const cache = new Map<number, Pose>();
  const frameAt = (time: number) => {
    let low = 0,
      high = profile.frames.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (profile.frames[mid].time < time) low = mid;
      else high = mid;
    }
    const a = profile.frames[low],
      b = profile.frames[high];
    const weight =
      b.time > a.time
        ? T.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1)
        : 0;
    return {
      center: a.center.clone().lerp(b.center, weight),
      heading: T.MathUtils.lerp(a.heading, b.heading, weight),
      distance: T.MathUtils.lerp(a.distance, b.distance, weight),
    };
  };
  const poseAt = (time: number) => {
    const cached = cache.get(time);
    if (cached) return cached;
    mixer.stopAllAction();
    applyHumanoidPose(source, {}, true);
    sampleNativeClip(source, clip, (profile.sourceStart ?? 0) + time);
    source.updateWorldMatrix(true, true);
    const frame = frameAt(time),
      inverse = source.getWorldQuaternion(new T.Quaternion()).invert();
    const turn = new T.Quaternion().setFromAxisAngle(up, -frame.heading);
    const sourceScale = source.getWorldScale(new T.Vector3());
    // Remove travel and heading, retaining vertical body motion and sway.
    const center = new T.Vector3(frame.center.x, 0, frame.center.z);
    const pose: Pose = {
      positions: bones.map((b) =>
        source
          .worldToLocal(b.getWorldPosition(new T.Vector3()))
          .sub(center)
          .applyQuaternion(turn)
          .divideScalar(height),
      ),
      rotations: bones.map((b) =>
        b
          .getWorldQuaternion(new T.Quaternion())
          .premultiply(inverse)
          .premultiply(turn)
          .normalize(),
      ),
      scales: bones.map((b) =>
        b.getWorldScale(new T.Vector3()).divide(sourceScale),
      ),
      morphs: morphs.flatMap((m) => m.morphTargetInfluences!),
    };
    cache.set(time, pose);
    return pose;
  };
  const velocityAt = (time: number) => {
    const a = Math.max(0, time - 1 / 120),
      b = Math.min(profile.duration, time + 1 / 120),
      before = poseAt(a),
      after = poseAt(b);
    return {
      linear: after.positions.map((p, i) =>
        p
          .clone()
          .sub(before.positions[i])
          .divideScalar(b - a),
      ),
      angular: after.rotations.map((q, i) => {
        const delta = q
          .clone()
          .multiply(before.rotations[i].clone().invert())
          .normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const sine = Math.hypot(delta.x, delta.y, delta.z);
        return sine > 1e-12
          ? new T.Vector3(delta.x, delta.y, delta.z).multiplyScalar(
              (2 * Math.atan2(sine, delta.w)) / (sine * (b - a)),
            )
          : new T.Vector3();
      }),
    };
  };
  const supportAt = (time: number) =>
    profile.contacts?.reduce(
      (mask, c) =>
        time >= c.start && time <= c.end
          ? mask | (c.side === "left" ? 1 : 2)
          : mask,
      0,
    ) ?? 0;
  const speedAt = (time: number) => {
    const a = Math.max(0, time - 0.05),
      b = Math.min(profile.duration, time + 0.05);
    return (frameAt(b).distance - frameAt(a).distance) / (b - a);
  };
  let best: ArrivalMatch | undefined,
    examined = 0;
  const matches: ArrivalMatch[] = [];
  try {
    for (const stop of profile.stops)
      for (const entry of stop.entries) {
        yield;
        // A captured stop's arc length is not its net displacement. A route
        // planner can supply the actual approach length after reserving that
        // displacement and final facing, including any obstacle detour.
        const prefixDistance = prefixDistanceForEntry
          ? prefixDistanceForEntry(
              (profile.sourceStart ?? 0) + entry.time,
              (profile.sourceStart ?? 0) + stop.sourceEnd,
              entry.distance,
            )
          : distance - entry.distance;
        if (
          prefixDistance === undefined ||
          !Number.isFinite(prefixDistance) ||
          prefixDistance < height * 0.15
        )
          continue;
        const incoming = sampleRouteLocomotion(profile, prefixDistance, 1),
          support = supportAt(incoming.time) & entry.support;
        if (!support) continue;
        const before = poseAt(incoming.time),
          after = poseAt(entry.time),
          v0 = velocityAt(incoming.time),
          v1 = velocityAt(entry.time);
        let positionSum = 0,
          positionMax = 0,
          rotationSum = 0,
          rotationMax = 0,
          velocitySum = 0,
          angularVelocitySum = 0,
          scaleMax = 0;
        for (let i = 0; i < bones.length; i++) {
          const p = before.positions[i].distanceTo(after.positions[i]),
            q = rotationDistance(before.rotations[i], after.rotations[i]),
            v = v0.linear[i].distanceTo(v1.linear[i]);
          positionSum += p * p;
          positionMax = Math.max(positionMax, p);
          rotationSum += q * q;
          rotationMax = Math.max(rotationMax, q);
          velocitySum += v * v;
          angularVelocitySum += v0.angular[i].distanceToSquared(v1.angular[i]);
          for (const axis of ["x", "y", "z"] as const) {
            const a = before.scales[i][axis],
              b = after.scales[i][axis];
            scaleMax = Math.max(
              scaleMax,
              Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-8),
            );
          }
        }
        const positionRms = Math.sqrt(positionSum / bones.length),
          rotationRms = Math.sqrt(rotationSum / bones.length),
          velocityRms = Math.sqrt(velocitySum / bones.length),
          angularVelocityRms = Math.sqrt(angularVelocitySum / bones.length);
        const speedDifference =
          Math.abs(speedAt(incoming.time) - entry.speed) / height;
        const morphMax = Math.max(
          0,
          ...before.morphs.map((v, i) => Math.abs(v - after.morphs[i])),
        );
        const score =
          positionRms +
          rotationRms * 0.15 +
          velocityRms * 0.05 +
          angularVelocityRms * 0.02 +
          scaleMax +
          speedDifference * 0.5 +
          morphMax * 0.1;
        if (!Number.isFinite(score + positionMax + rotationMax)) continue;
        const candidate: ArrivalMatch = {
          sourceStart: (profile.sourceStart ?? 0) + entry.time,
          sourceEnd: (profile.sourceStart ?? 0) + stop.sourceEnd,
          prefixDistance,
          prefixSourceDuration: routeSourceDuration(profile, prefixDistance),
          tailDistance: entry.distance,
          support,
          positionRms,
          positionMax,
          rotationRms,
          rotationMax,
          velocityRms,
          angularVelocityRms,
          scaleMax,
          speedDifference,
          morphMax,
          score,
        };
        examined++;
        if (!best || score < best.score) best = candidate;
        // A prospective blend, not permission for an instantaneous pose cut.
        if (
          positionMax <= 0.08 &&
          rotationMax <= 0.4 &&
          velocityRms <= 0.5 &&
          angularVelocityRms <= 2 &&
          scaleMax <= 0.02 &&
          speedDifference <= 0.25 &&
          morphMax <= 0.1
        )
          matches.push(candidate);
      }
    matches.sort(
      (a, b) =>
        a.score - b.score ||
        a.sourceStart - b.sourceStart ||
        a.sourceEnd - b.sourceEnd,
    );
    return { match: matches[0], matches, best, examined };
  } finally {
    mixer.stopAllAction();
    for (const { node, p, q, s, weights } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
      if (weights && node instanceof T.Mesh)
        node.morphTargetInfluences!.splice(0, weights.length, ...weights);
    }
    source.updateWorldMatrix(true, true);
  }
}

export function matchCapturedArrival(
  ...args: Parameters<typeof matchCapturedArrivalSteps>
) {
  return finishNavigationWork(matchCapturedArrivalSteps(...args));
}
