import * as T from "three";
import {
  applyHumanoidPose,
  nativeRootMotion,
  sampleNativeClip,
  standingHeight,
} from "./rig";

type Frame = {
  time: number;
  distance: number;
  center: T.Vector3;
  heading: number;
};
export type LocomotionProfile = {
  frames: Frame[];
  distance: number;
  duration: number;
  startHeading: number;
  warning: string;
  mode: "travel" | "in-place";
};
const profiles = new WeakMap<
  T.Group,
  Map<T.AnimationClip, LocomotionProfile>
>();
const up = new T.Vector3(0, 1, 0);
const yaw = (q: T.Quaternion) => {
  const f = new T.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
};

/** One-time, deterministic measurement. Save/restore every local transform so
 * inspecting natural pace cannot change an actor's current viewport pose. */
export function locomotionProfile(
  source: T.Group,
  clip: T.AnimationClip,
): LocomotionProfile | undefined {
  const bones = source.userData.bones as Record<string, T.Bone> | undefined;
  const contacts = source.userData.contacts as
    Record<string, T.Vector3> | undefined;
  if (!bones?.hips || clip.duration <= 0) return;
  const foot = (side: "left" | "right") => {
    const bone = bones[`${side}Foot`];
    if (bone)
      return source.worldToLocal(bone.getWorldPosition(new T.Vector3()));
    const shin = bones[`${side}Shin`],
      offset = contacts?.[`${side}Foot`];
    return shin && offset
      ? source.worldToLocal(shin.localToWorld(offset.clone()))
      : undefined;
  };
  if (!foot("left") || !foot("right")) return;
  let cache = profiles.get(source);
  if (!cache) profiles.set(source, (cache = new Map()));
  const known = cache.get(clip);
  if (known) return known;
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
  const local = (node: T.Object3D) =>
    source.worldToLocal(node.getWorldPosition(new T.Vector3()));
  try {
    mixer.stopAllAction();
    applyHumanoidPose(source, {}, true);
    const inverse = source.getWorldQuaternion(new T.Quaternion()).invert();
    const facing = inverse
      .clone()
      .multiply(bones.hips.getWorldQuaternion(new T.Quaternion()))
      .invert();
    const root = nativeRootMotion(source, clip)!;
    const count = Math.max(2, Math.ceil(clip.duration * 60));
    const raw: {
      time: number;
      hip: T.Vector3;
      feet: T.Vector3[];
      heading: number;
    }[] = [];
    let heading = 0;
    for (let i = 0; i <= count; i++) {
      mixer.stopAllAction();
      applyHumanoidPose(source, {}, true);
      sampleNativeClip(source, clip, (i * clip.duration) / count);
      source.updateWorldMatrix(true, true);
      const angle = yaw(
        inverse
          .clone()
          .multiply(bones.hips.getWorldQuaternion(new T.Quaternion()))
          .multiply(facing),
      );
      heading = i
        ? heading +
          Math.atan2(Math.sin(angle - heading), Math.cos(angle - heading))
        : angle;
      raw.push({
        time: (i * clip.duration) / count,
        hip: local(bones.hips),
        feet: [foot("left")!, foot("right")!],
        heading,
      });
    }
    // Smooth only the trajectory, never joint rotations. Residual hip sway/bob
    // remains in the original sampled pose. A half-second window suppresses sway.
    const radius = Math.max(1, Math.round((count / clip.duration) * 0.25));
    const frames: Frame[] = raw.map((frame, index) => {
      const center = new T.Vector3();
      let angle = 0,
        weight = 0;
      // Linear endpoint extrapolation avoids easing the beginning/end to zero speed.
      for (let j = index - radius; j <= index + radius; j++) {
        const k = Math.max(0, Math.min(count, j)),
          sample = raw[k];
        const p = sample.hip.clone();
        let h = sample.heading;
        if (j !== k) {
          const next =
            k === 0 ? Math.min(radius, count) : Math.max(0, count - radius);
          const f = (j - k) / (next - k);
          p.addScaledVector(raw[next].hip.clone().sub(sample.hip), f);
          h += (raw[next].heading - sample.heading) * f;
        }
        center.add(p);
        angle += h;
        weight++;
      }
      return {
        time: frame.time,
        center: center.divideScalar(weight),
        heading: angle / weight,
        distance: 0,
      };
    });
    const span = new T.Box3()
      .setFromPoints(
        frames.map((f) => new T.Vector3(f.center.x, 0, f.center.z)),
      )
      .getSize(new T.Vector3())
      .length();
    const mode = span > 0.35 ? "travel" : "in-place";
    let distance = 0;
    for (let i = 1; i < frames.length; i++) {
      if (mode === "travel") {
        const delta = frames[i].center.clone().sub(frames[i - 1].center);
        delta.y = 0;
        distance += delta.length();
      } else {
        const forward = new T.Vector3(0, 0, 1).applyAxisAngle(
          up,
          frames[i].heading,
        );
        // Use the lowest foot (stance), not the faster swinging foot. Its
        // backward travel relative to the hips estimates a planted stride.
        const foot = raw[i].feet[0].y <= raw[i].feet[1].y ? 0 : 1;
        const change = raw[i].feet[foot]
          .clone()
          .sub(raw[i].hip)
          .sub(raw[i - 1].feet[foot].clone().sub(raw[i - 1].hip));
        distance += Math.max(0, -change.dot(forward));
      }
      frames[i].distance = distance;
    }
    const first = raw[0],
      last = raw.at(-1)!;
    const seam = Math.max(
      ...[0, 1].map((i) =>
        first.feet[i]
          .clone()
          .sub(first.hip)
          .applyAxisAngle(up, -first.heading)
          .distanceTo(
            last.feet[i]
              .clone()
              .sub(last.hip)
              .applyAxisAngle(up, -last.heading),
          ),
      ),
    );
    const warning =
      distance < 0.15 || distance / clip.duration < 0.05
        ? "This take has no reliable locomotion stride. Choose a walking/running cycle; no procedural gait has been substituted."
        : seam > 0.12
          ? "This take's foot poses do not match at its loop boundary. Repeating it may pop; use a seamless locomotion cycle for long routes."
          : "";
    const result = {
      frames,
      distance,
      duration: clip.duration,
      startHeading: root.startHeading,
      warning,
      mode,
    } as LocomotionProfile;
    cache.set(clip, result);
    return result;
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
export function sampleLocomotion(
  profile: LocomotionProfile,
  travelled: number,
) {
  const cycle = profile.distance;
  const distance = cycle > 0 ? ((travelled % cycle) + cycle) % cycle : 0;
  const frames = profile.frames;
  let low = 0,
    high = frames.length - 1;
  while (low + 1 < high) {
    const mid = (low + high) >> 1;
    if (frames[mid].distance < distance) low = mid;
    else high = mid;
  }
  const a = frames[low],
    b = frames[high];
  const f =
    b.distance > a.distance
      ? (distance - a.distance) / (b.distance - a.distance)
      : 0;
  return {
    time: T.MathUtils.lerp(a.time, b.time, f),
    center: a.center.clone().lerp(b.center, f),
    heading: T.MathUtils.lerp(a.heading, b.heading, f),
    repeated: travelled >= cycle,
  };
}
export function locomotionScale(source: T.Group, target: T.Group) {
  return standingHeight(target) / standingHeight(source);
}
