import * as T from "three";
import { allMotions, type Motion, type Scene } from "../shared/scene";
import { importedClip, measureOnRig, standingHeight } from "./rig";

/** Measured evidence that an imported take is a standing performance: the
 * body stays in place, both feet stay at floor level and the take returns to
 * its opening pose, with little limb motion. Names play no part. */
export type StandingMeasure = {
  motion: Motion;
  clip: T.AnimationClip;
  travel: number;
  footLift: number;
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
  const samples = Math.max(8, Math.min(60, Math.round(clip.duration * 12)));
  const world = (bone: T.Object3D) => bone.getWorldPosition(new T.Vector3());
  const rotations: T.Quaternion[][] = [];
  const hips: T.Vector3[] = [];
  let footMin = Infinity,
    footMax = -Infinity;
  const tracked = Object.values(bones);
  measureOnRig(source, (sample) => {
    for (let i = 0; i <= samples; i++) {
      sample(clip, (clip.duration * i) / samples);
      hips.push(world(bones.hips));
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
    loopGap,
    energy,
  };
  cache.set(clip, result);
  return result;
}

/** The calmest standing loop the gait's own source provides, if any: a body
 * that has to wait before an obstacle stands and breathes with it instead of
 * freezing mid-stride. Without one, the caller keeps the stopped pose and
 * says so. */
export function standingPerformance(
  scene: Scene,
  source: T.Group,
  gait: Motion,
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
    if (
      !measure ||
      measure.travel > 0.15 ||
      measure.footLift > 0.04 ||
      measure.loopGap > 0.35
    )
      continue;
    if (!best || measure.energy < best.energy) best = measure;
  }
  return best;
}
