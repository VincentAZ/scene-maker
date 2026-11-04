import type { Asset, Entity } from "./scene";
export type Point = [number, number, number];
export const defaultLadder = {
  height: 2.5,
  width: 0.6,
  firstRung: 0.2,
  spacing: 0.35,
  rungs: 7,
};
export const ladderProfile = (asset: Asset) =>
  asset.ladder ||
  (asset.style === "ladder" && !asset.url && !asset.parts?.length
    ? defaultLadder
    : undefined);
export function nearestLadder(
  entities: Entity[],
  assets: Asset[],
  actor: Entity,
) {
  return entities
    .filter(
      (e) =>
        e.id !== actor.id &&
        e.visible &&
        assets.some(
          (a) =>
            a.id === e.assetId && a.category === "props" && ladderProfile(a),
        ),
    )
    .sort(
      (a, b) =>
        a.position.reduce(
          (sum, n, i) => sum + (n - actor.position[i]) ** 2,
          0,
        ) -
        b.position.reduce((sum, n, i) => sum + (n - actor.position[i]) ** 2, 0),
    )[0];
}
export const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};
export const mixPoint = (a: Point, b: Point, t: number): Point =>
  a.map((n, i) => n + (b[i] - n) * t) as Point;
export function turnPoint(point: Point, heading: number): Point {
  return [
    point[0] * Math.cos(heading) + point[2] * Math.sin(heading),
    point[1],
    -point[0] * Math.sin(heading) + point[2] * Math.cos(heading),
  ];
}
export function ladderPoint(ladder: Entity, point: Point): Point {
  const rotated = turnPoint(
    point.map((n) => n * ladder.scale) as Point,
    ladder.rotation,
  );
  return rotated.map((n, i) => ladder.position[i] + n) as Point;
}
export type LadderPlan = {
  targetId: string;
  ladder: Entity;
  profile: typeof defaultLadder;
  from: Point;
  heading: number;
  facing: number;
  actorScale: number;
  steps: number;
  handLead: number;
  warning: string;
};
export function planLadder(
  from: Point,
  heading: number,
  actor: Entity,
  ladder: Entity,
  asset: Asset,
  supported = true,
): LadderPlan {
  const profile = ladderProfile(asset) || defaultLadder;
  const handLead = Math.max(
    1,
    Math.min(
      profile.rungs - 2,
      Math.round((1.05 * actor.scale) / (profile.spacing * ladder.scale)),
    ),
  );
  let warning = "";
  if (!supported)
    warning = `${actor.name} needs a recognizable arm and leg rig for this climb.`;
  else if (!ladder.visible)
    warning = `Show ${ladder.name} before starting the climb.`;
  else if (ladder.clips.length)
    warning = `Remove actions from ${ladder.name} to keep it still during the climb.`;
  else if (Math.abs(from[1] - ladder.position[1]) > 0.35 * actor.scale)
    warning = `Place ${actor.name} near the base height of ${ladder.name} before climbing.`;
  else if (
    profile.height * ladder.scale < 1.35 * actor.scale ||
    profile.width * ladder.scale < 0.3 * actor.scale ||
    profile.spacing * ladder.scale > 0.55 * actor.scale
  )
    warning = `Resize ${ladder.name} to fit ${actor.name} before climbing.`;
  return {
    targetId: ladder.id,
    ladder,
    profile,
    from: [...from],
    heading,
    facing: ladder.rotation + Math.PI,
    actorScale: actor.scale,
    handLead,
    steps: profile.rungs - 1 - handLead,
    warning,
  };
}
type Limb = "leftHand" | "rightHand" | "leftFoot" | "rightFoot";
export type LadderSample = {
  root: Point;
  heading: number;
  progress: number;
  plan: LadderPlan;
  contacts: Record<Limb, Point>;
  approach: number;
  grip: number;
  swing: Record<Limb, boolean>;
};
/** Hips behind the rung plane and below the feet' mean height while climbing
 * (per metre of actor scale), measured so knees clear the rungs. */
const CLIMB_STANDOFF = 0.42,
  CLIMB_DROP = 0.44;
export function sampleLadder(plan: LadderPlan, value: number): LadderSample {
  const progress = Math.max(0, Math.min(1, value)),
    { ladder, profile, actorScale, handLead, steps } = plan;
  const approach = ease(progress / 0.18),
    grip = ease((progress - 0.18) / 0.12);
  const travel = Math.max(0, Math.min(1, (progress - 0.3) / 0.6)) * steps;
  const cycle = Math.min(steps - 1, Math.floor(travel)),
    phase = travel - cycle;
  const phaseStart: Record<Limb, number> = {
    leftHand: 0,
    rightFoot: 0.25,
    rightHand: 0.5,
    leftFoot: 0.75,
  };
  const swing = {} as Record<Limb, boolean>,
    contacts = {} as Record<Limb, Point>;
  const rungAt = {} as Record<Limb, number>;
  for (const limb of Object.keys(phaseStart) as Limb[]) {
    const move = Math.max(0, Math.min(1, (phase - phaseStart[limb]) * 4));
    swing[limb] = move > 0 && move < 1;
    const hand = limb.endsWith("Hand"),
      side = limb.startsWith("left") ? -1 : 1;
    rungAt[limb] = cycle + ease(move) + (hand ? handLead : 0);
    const x =
      side *
      Math.min(
        profile.width * ladder.scale * 0.34,
        (hand ? 0.23 : 0.12) * actorScale,
      );
    const y =
      (profile.firstRung + rungAt[limb] * profile.spacing) * ladder.scale +
      (hand ? 0 : 0.0325 * ladder.scale + 0.065 * actorScale);
    const z =
      0.0325 * ladder.scale +
      Math.sin(move * Math.PI) * (hand ? 0.12 : 0.16) * actorScale;
    contacts[limb] = ladderPoint(ladder, [
      x / ladder.scale,
      y / ladder.scale,
      z / ladder.scale,
    ]);
  }
  // The upper stance straightens the legs first, then brings the hips in.
  const settleUp = ease((progress - 0.9) / 0.08),
    settleIn = ease((progress - 0.91) / 0.09);
  const footHeight = (contacts.leftFoot[1] + contacts.rightFoot[1]) / 2;
  // While stepping, the hips hang back and low enough that a knee raised to
  // the next rung stays in front of the rungs instead of passing through
  // them; the upper stance (both feet on one rung, legs straight) moves in.
  const climbRoot = ladderPoint(ladder, [
    0,
    0,
    ((CLIMB_STANDOFF - (CLIMB_STANDOFF - 0.18) * settleIn) * actorScale) /
      ladder.scale,
  ]);
  climbRoot[1] =
    footHeight - (CLIMB_DROP - (CLIMB_DROP - 0.13) * settleUp) * actorScale;
  const base = ladderPoint(ladder, [
    0,
    0,
    (CLIMB_STANDOFF * actorScale) / ladder.scale,
  ]);
  const root =
    progress < 0.18
      ? mixPoint(plan.from, base, approach)
      : progress < 0.3
        ? mixPoint(base, climbRoot, grip)
        : climbRoot;
  const angle = Math.atan2(
    Math.sin(plan.facing - plan.heading),
    Math.cos(plan.facing - plan.heading),
  );
  return {
    root: plan.warning ? [...plan.from] : root,
    heading: plan.warning ? plan.heading : plan.heading + angle * approach,
    progress,
    plan,
    contacts,
    approach,
    grip,
    swing,
  };
}
