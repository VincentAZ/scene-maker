import * as T from "three";
import { applyHumanoidPose, sampleNativeClip, standingHeight } from "./rig";
import type { LocomotionProfile } from "./locomotion";

export type SourcePose = {
  positions: T.Vector3[];
  rotations: T.Quaternion[];
  scales: T.Vector3[];
  morphs: number[];
};
export type SourceVelocity = {
  linear: T.Vector3[];
  angular: T.Vector3[];
  morphs: number[];
};

/** Relative quaternion atan2 remains accurate near identity, where acos(dot)
 * can give identical sampled poses a spurious angle from normalization noise. */
export function rotationDistance(a: T.Quaternion, b: T.Quaternion) {
  const delta = b.clone().multiply(a.clone().conjugate());
  return (
    2 * Math.atan2(Math.hypot(delta.x, delta.y, delta.z), Math.abs(delta.w))
  );
}

/** Isolated, cached original-source measurements in the captured travel frame.
 * Call restore in finally. No target retargeting or procedural pose participates
 * in compatibility decisions. Rigid render parts and skin-local transforms
 * are included alongside bones and every available morph channel. */
export function sourcePoseSampler(
  source: T.Group,
  take: T.AnimationClip,
  profile: LocomotionProfile,
) {
  const height = standingHeight(source),
    nodes: T.Object3D[] = [],
    bones: T.Bone[] = [],
    weighted = new Set<T.Object3D>(),
    skins: T.SkinnedMesh[] = [],
    meshes: T.Mesh[] = [];
  const saved: {
    node: T.Object3D;
    p: T.Vector3;
    q: T.Quaternion;
    s: T.Vector3;
    weights?: number[];
  }[] = [];
  source.traverse((node) => {
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
      weights:
        node instanceof T.Mesh
          ? node.morphTargetInfluences?.slice()
          : undefined,
    });
    if (node instanceof T.Bone) bones.push(node);
    if (node instanceof T.Mesh && !(node instanceof T.SkinnedMesh))
      weighted.add(node);
    if (node instanceof T.SkinnedMesh) {
      skins.push(node);
      const indices = node.geometry.attributes.skinIndex,
        weights = node.geometry.attributes.skinWeight;
      if (indices && weights)
        for (let i = 0; i < weights.count; i++)
          for (let c = 0; c < weights.itemSize; c++)
            if (weights.getComponent(i, c) > 0) {
              const bone = node.skeleton.bones[indices.getComponent(i, c)];
              if (bone) weighted.add(bone);
            }
    }
    if (node instanceof T.Mesh && node.morphTargetInfluences?.length)
      meshes.push(node);
  });
  // Unweighted control helpers contribute through their rendered descendants;
  // they must not reject an otherwise identical visible pose. Bare diagnostic
  // skeletons have no geometry, so retain their explicitly animated joints.
  nodes.push(...(weighted.size ? weighted : bones));
  const mixer = source.userData.mixer as T.AnimationMixer,
    previousTime = mixer.time;
  const cache = new Map<number, SourcePose>(),
    velocities = new Map<number, SourceVelocity>();
  const frameAt = (time: number) => {
    let low = 0,
      high = profile.frames.length - 1;
    while (low + 1 < high) {
      const mid = (low + high) >> 1;
      if (profile.frames[mid].time < time) low = mid;
      else high = mid;
    }
    const a = profile.frames[low],
      b = profile.frames[high],
      u = T.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1);
    return {
      center: a.center.clone().lerp(b.center, u),
      heading: T.MathUtils.lerp(a.heading, b.heading, u),
      distance: T.MathUtils.lerp(a.distance, b.distance, u),
    };
  };
  const poseAt = (time: number): SourcePose => {
    const known = cache.get(time);
    if (known) return known;
    mixer.stopAllAction();
    applyHumanoidPose(source, {}, true);
    sampleNativeClip(source, take, (profile.sourceStart ?? 0) + time);
    source.updateWorldMatrix(true, true);
    const frame = frameAt(time);
    frame.center.y = 0;
    const turn = new T.Quaternion().setFromAxisAngle(
        new T.Vector3(0, 1, 0),
        -frame.heading,
      ),
      inverse = source.getWorldQuaternion(new T.Quaternion()).invert();
    const pose = {
      positions: nodes
        .map((n) =>
          source
            .worldToLocal(n.getWorldPosition(new T.Vector3()))
            .sub(frame.center)
            .applyQuaternion(turn)
            .divideScalar(height),
        )
        .concat(skins.map((m) => m.position.clone().divideScalar(height))),
      rotations: nodes
        .map((n) =>
          n
            .getWorldQuaternion(new T.Quaternion())
            .premultiply(inverse)
            .premultiply(turn)
            .normalize(),
        )
        .concat(skins.map((m) => m.quaternion.clone().normalize())),
      scales: nodes
        .map((n) =>
          n
            .getWorldScale(new T.Vector3())
            .divide(source.getWorldScale(new T.Vector3())),
        )
        .concat(skins.map((n) => n.scale.clone())),
      morphs: meshes.flatMap((m) => m.morphTargetInfluences!),
    };
    cache.set(time, pose);
    return pose;
  };
  const velocityAt = (time: number): SourceVelocity => {
    const known = velocities.get(time);
    if (known) return known;
    const start = Math.max(0, time - 1 / 120),
      end = Math.min(profile.duration, time + 1 / 120),
      a = poseAt(start),
      b = poseAt(end),
      dt = end - start;
    const velocity = {
      linear: b.positions.map((p, i) =>
        p.clone().sub(a.positions[i]).divideScalar(dt),
      ),
      angular: b.rotations.map((q, i) => {
        const delta = q
          .clone()
          .multiply(a.rotations[i].clone().invert())
          .normalize();
        if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
        const sine = Math.hypot(delta.x, delta.y, delta.z);
        return sine > 1e-12
          ? new T.Vector3(delta.x, delta.y, delta.z).multiplyScalar(
              (2 * Math.atan2(sine, delta.w)) / sine / dt,
            )
          : new T.Vector3();
      }),
      morphs: b.morphs.map((v, i) => (v - a.morphs[i]) / dt),
    };
    velocities.set(time, velocity);
    return velocity;
  };
  const speedAt = (time: number) => {
    const a = Math.max(0, time - 0.05),
      b = Math.min(profile.duration, time + 0.05);
    return (frameAt(b).distance - frameAt(a).distance) / (b - a) / height;
  };
  const restore = () => {
    mixer.stopAllAction();
    mixer.time = previousTime;
    for (const { node, p, q, s, weights } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
      if (weights && node instanceof T.Mesh)
        node.morphTargetInfluences!.splice(0, weights.length, ...weights);
    }
    source.updateWorldMatrix(true, true);
  };
  return {
    height,
    labels: [...nodes, ...skins].map((n) => n.name || n.type),
    frameAt,
    poseAt,
    velocityAt,
    speedAt,
    restore,
  };
}

export function compareSourceJoin(
  a: SourcePose,
  b: SourcePose,
  va: SourceVelocity,
  vb: SourceVelocity,
  speedDifference: number,
  poseLimits = { position: 0.025, rotation: 0.2 },
) {
  const positionMax = Math.max(
    0,
    ...a.positions.map((p, i) => p.distanceTo(b.positions[i])),
  );
  const rotationMax = Math.max(
    0,
    ...a.rotations.map((q, i) => rotationDistance(q, b.rotations[i])),
  );
  const velocityMax = Math.max(
    0,
    ...va.linear.map((v, i) => v.distanceTo(vb.linear[i])),
  );
  const angularVelocityMax = Math.max(
    0,
    ...va.angular.map((v, i) => v.distanceTo(vb.angular[i])),
  );
  const scaleMax = Math.max(
    0,
    ...a.scales.flatMap((s, i) =>
      (["x", "y", "z"] as const).map(
        (k) =>
          Math.abs(s[k] - b.scales[i][k]) /
          Math.max(1e-10, Math.abs(s[k]), Math.abs(b.scales[i][k])),
      ),
    ),
  );
  const morphMax = Math.max(
    0,
    ...a.morphs.map((v, i) => Math.abs(v - b.morphs[i])),
  );
  const morphVelocityMax = Math.max(
    0,
    ...va.morphs.map((v, i) => Math.abs(v - vb.morphs[i])),
  );
  const allowed =
    a.positions.length > 0 &&
    positionMax <= poseLimits.position &&
    rotationMax <= poseLimits.rotation &&
    velocityMax <= 0.5 &&
    angularVelocityMax <= 2 &&
    scaleMax <= 1e-5 &&
    morphMax <= 0.05 &&
    morphVelocityMax <= 0.5 &&
    speedDifference <= 0.2;
  const score =
    positionMax +
    rotationMax * 0.15 +
    velocityMax * 0.05 +
    angularVelocityMax * 0.02 +
    scaleMax +
    speedDifference * 0.5 +
    morphMax * 0.1 +
    morphVelocityMax * 0.01;
  return {
    allowed,
    score,
    positionMax,
    rotationMax,
    velocityMax,
    angularVelocityMax,
    scaleMax,
    morphMax,
    morphVelocityMax,
    speedDifference,
  };
}
