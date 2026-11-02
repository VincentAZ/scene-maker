import * as T from "three";
import { allMotions, type Motion, type Scene } from "../shared/scene";
import { recordedStanding } from "../shared/motionLibrary";
import {
  importedClip,
  measureOnRig,
  motionSource,
  standingHeight,
} from "./rig";

/** Measured evidence that an imported take is a standing performance: the
 * body stays in place, both feet stay at floor level and the take returns to
 * its opening pose, with little limb motion. Names play no part. */
export type StandingMeasure = {
  motion: Motion;
  clip: T.AnimationClip;
  travel: number;
  footLift: number;
  footTravel: number;
  hipHeight: number;
  loopGap: number;
  energy: number;
};
const measured = new WeakMap<T.Group, Map<T.AnimationClip, StandingMeasure>>();

export function measureStanding(
  source: T.Group,
  motion: Motion,
  clip: T.AnimationClip,
): StandingMeasure | undefined {
  let cache = measured.get(source);
  if (!cache) {
    cache = new Map();
    measured.set(source, cache);
  }
  const known = cache.get(clip);
  // Only the measured geometry belongs to the take. Its library identity can
  // change on import, scene switch or catalogue edits while the rig is reused.
  if (known) return { ...known, motion };
  const bones = source.userData.bones as Record<string, T.Bone> | undefined;
  if (!bones?.hips || !bones.leftFoot || !bones.rightFoot) return;
  const height = standingHeight(source);
  if (!(height > 0)) return;
  if (!(clip.duration > 0) || clip.duration > 60) return;
  // A long standing take must not hide a short step between sparse samples.
  // Use the playback sampling density, with a bounded one-minute take size.
  const samples = Math.max(8, Math.ceil(clip.duration * 60));
  const world = (bone: T.Object3D) =>
    source.worldToLocal(bone.getWorldPosition(new T.Vector3()));
  const rotations: T.Quaternion[][] = [];
  const hips: T.Vector3[] = [];
  const feet: T.Vector3[][] = [];
  let hipHeight = Infinity;
  let footMin = Infinity,
    footMax = -Infinity;
  const tracked = Object.values(bones);
  measureOnRig(source, (sample) => {
    for (let i = 0; i <= samples; i++) {
      sample(clip, (clip.duration * i) / samples);
      hips.push(world(bones.hips));
      const soles = [bones.leftFoot, bones.rightFoot].map(world);
      feet.push(soles);
      hipHeight = Math.min(
        hipHeight,
        hips.at(-1)!.y - Math.max(...soles.map((p) => p.y)),
      );
      for (const foot of [bones.leftFoot, bones.rightFoot]) {
        const y = world(foot).y;
        footMin = Math.min(footMin, y);
        footMax = Math.max(footMax, y);
      }
      rotations.push(
        tracked.map((bone) => bone.getWorldQuaternion(new T.Quaternion())),
      );
    }
  });
  const first = hips[0];
  const travel = Math.max(
    ...hips.map((p) => Math.hypot(p.x - first.x, p.z - first.z)),
  );
  let energy = 0;
  for (let i = 1; i < rotations.length; i++)
    for (const [j, rotation] of rotations[i].entries())
      energy += rotation.angleTo(rotations[i - 1][j]);
  energy /= rotations.length - 1;
  const loopGap = Math.max(
    hips[0].distanceTo(hips.at(-1)!) / height,
    ...rotations[0].map((rotation, j) =>
      rotation.angleTo(rotations.at(-1)![j]),
    ),
  );
  const result = {
    motion,
    clip,
    travel: travel / height,
    footLift: (footMax - footMin) / height,
    footTravel:
      Math.max(
        ...feet.flatMap((sample) =>
          sample.map((p, side) =>
            Math.hypot(p.x - feet[0][side].x, p.z - feet[0][side].z),
          ),
        ),
      ) / height,
    hipHeight: hipHeight / height,
    loopGap,
    energy,
  };
  cache.set(clip, result);
  return result;
}

export function isStandingPerformance(measure: StandingMeasure) {
  return (
    measure.travel <= 0.25 &&
    measure.footTravel <= 0.035 &&
    measure.hipHeight >= 0.65 &&
    measure.footLift <= 0.04 &&
    measure.loopGap <= 0.35
  );
}

/** Prefer the gait's own measured standing performance, then a loaded recorded
 * fallback. Without a suitable take, retain the stopped pose and report why. */
export function standingPerformance(
  scene: Scene,
  source: T.Group,
  gait: Motion,
  target?: T.Group,
): StandingMeasure | undefined {
  const animations = (source.userData.animations ?? []) as T.AnimationClip[];
  const candidates = allMotions(scene).filter(
    (motion) =>
      motion.kind === "imported" &&
      motion.sourceAssetId === gait.sourceAssetId &&
      !motion.path &&
      motion.id !== gait.id &&
      motion.duration >= 0.8,
  );
  let best: StandingMeasure | undefined;
  for (const motion of candidates) {
    const clip = importedClip(animations, motion.animationName);
    if (!clip) continue;
    const measure = measureStanding(source, motion, clip);
    if (!measure || !isStandingPerformance(measure)) continue;
    if (!best || measure.energy < best.energy) best = measure;
  }
  if (!best && target)
    for (const motion of recordedStanding) {
      const source = motionSource(target, motion.sourceAssetId!);
      const clip =
        source &&
        importedClip(source.userData.animations ?? [], motion.animationName);
      const measure = source && clip && measureStanding(source, motion, clip);
      if (
        measure &&
        isStandingPerformance(measure) &&
        (!best || measure.energy < best.energy)
      )
        best = measure;
    }
  return best;
}
