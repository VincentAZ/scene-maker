import {
  type Entity,
  type Motion,
  type Scene,
  allMotions,
  allAssets,
  boneNames,
} from "./scene";
import {
  ladderProfile,
  planLadder,
  sampleLadder,
  turnPoint,
  type LadderSample,
  type Point,
} from "./ladder";
import {
  planSeat,
  sampleSeat,
  seatProfile,
  type SeatSample,
  type SeatPlan,
  type SeatBody,
} from "./seating";
import { samplePath } from "./path";
export type Pose = {
  root: [number, number, number];
  rotations: Record<string, [number, number, number]>;
  heading?: number;
  climb?: LadderSample;
  seat?: SeatSample;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function motionPose(m: Motion, t: number): Pose {
  const p: Pose = {
    root: [0, 0, 0],
    rotations: Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]])),
  };
  const r = p.rotations,
    u = Math.max(0, Math.min(1, t)),
    s = Math.sin(u * Math.PI),
    cycle = Math.sin(u * Math.PI * 8);
  p.root[2] = m.distance * u;
  if (m.kind === "custom" && m.poses.length) {
    const frames = [...m.poses].sort((a, b) => a.at - b.at);
    const a = [...frames].reverse().find((f) => f.at <= u) || frames[0],
      b = frames.find((f) => f.at >= u) || frames.at(-1)!;
    const f = a === b ? 0 : (u - a.at) / (b.at - a.at);
    p.root = a.root.map((v, i) => mix(v, b.root[i], f)) as Pose["root"];
    for (const n of boneNames)
      p.rotations[n] = [0, 1, 2].map((i) =>
        mix(a.rotations[n]?.[i] || 0, b.rotations[n]?.[i] || 0, f),
      ) as Pose["root"];
    return p;
  }
  if (["walk", "run", "crawl", "climb"].includes(m.kind)) {
    const stride = m.kind === "run" ? 0.85 : 0.5;
    r.leftLeg[0] = cycle * stride;
    r.rightLeg[0] = -cycle * stride;
    r.leftArm[0] = -cycle * stride;
    r.rightArm[0] = cycle * stride;
    r.leftShin[0] = Math.max(0, -cycle) * 0.8;
    r.rightShin[0] = Math.max(0, cycle) * 0.8;
    p.root[1] = Math.abs(cycle) * 0.04;
  }
  if (m.kind === "idle") r.spine[0] = Math.sin(u * 2 * Math.PI) * 0.03;
  if (m.kind === "jump") {
    p.root[1] = s * 1;
    r.leftArm[2] = s * 0.8;
    r.rightArm[2] = -s * 0.8;
    r.leftLeg[0] = -0.3 * s;
    r.leftShin[0] = 0.5 * s;
  }
  if (m.kind === "wave") {
    r.rightArm[2] = -2.1 * s;
    r.rightForearm[0] = Math.sin(u * 20) * 0.4 * s;
  }
  if (m.kind === "talk") {
    r.rightArm[0] = -0.3 * s;
    r.rightForearm[0] = -0.4 + Math.sin(u * 14) * 0.15;
    r.head[1] = Math.sin(u * 8) * 0.12;
  }
  if (m.kind === "dance") {
    p.root[0] = cycle * 0.2;
    r.spine[2] = cycle * 0.2;
    r.leftArm[2] = 0.8 + cycle * 0.4;
    r.rightArm[2] = -0.8 + cycle * 0.4;
    p.root[1] = Math.abs(cycle) * 0.12;
  }
  if (m.kind === "sit") {
    const a = Math.min(1, u * 3);
    p.root[1] = -0.42 * a;
    r.leftLeg[0] = r.rightLeg[0] = -1.45 * a;
    r.leftShin[0] = r.rightShin[0] = 1.45 * a;
  }
  if (m.kind === "crawl") {
    p.root[1] = -0.65;
    r.spine[0] = 1.2;
    r.leftArm[0] = -1 + cycle * 0.3;
    r.rightArm[0] = -1 - cycle * 0.3;
    r.leftLeg[0] = -0.8 + cycle * 0.3;
    r.rightLeg[0] = -0.8 - cycle * 0.3;
    r.leftShin[0] = r.rightShin[0] = 1.5;
  }
  if (m.kind === "climb") {
    p.root[1] = m.distance * u;
    p.root[2] = 0;
    r.leftArm[0] = -2.7 + cycle * 0.4;
    r.rightArm[0] = -2.7 - cycle * 0.4;
  }
  if (m.kind === "pick" || m.kind === "place") {
    r.spine[0] = s * 0.8;
    r.rightArm[0] = -s * 0.7;
  }
  if (m.kind === "sip") {
    r.rightArm[0] = -s * 0.6;
    r.rightForearm[0] = -s * 2;
    r.head[0] = -s * 0.12;
  }
  if (m.kind === "bow") r.spine[0] = s * 0.8;
  return p;
}
export function entityPose(
  e: Entity,
  scene: Scene,
  time: number,
  options: {
    nativeRoot?: (
      motion: Motion,
      clip: Entity["clips"][number],
    ) =>
      | { start: Point; delta: Point; heading?: number; startHeading?: number }
      | undefined;
    canClimb?: boolean;
    seatBody?: SeatBody;
    canSit?: boolean;
  } = {},
): Pose {
  const p: Pose = {
    root: [...e.position],
    heading: e.rotation,
    rotations: Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]])),
  };
  let start = 0;
  let seated: SeatPlan | undefined;
  const library = allMotions(scene);
  const addRoot = (offset: Point) => {
    const world = turnPoint(
      offset.map((n) => n * e.scale) as Point,
      p.heading!,
    );
    p.root = p.root.map((n, i) => n + world[i]) as Point;
  };
  for (const clip of e.clips) {
    const m = library.find((m) => m.id === clip.motionId);
    if (!m) continue;
    const end = start + clip.duration;
    if (m.path) {
      p.climb = undefined;
      const u = Math.max(0, Math.min(1, (time - start) / clip.duration));
      const path = samplePath(m.path, u);
      addRoot(path.point);
      p.heading! += path.heading;
      p.rotations = Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]]));
      if (time < end) {
        const stride = m.kind === "run" ? 1.8 : 1.25;
        const gait = motionPose(
          { ...m, distance: 0 },
          ((path.travelled / stride) % 1) / 4,
        );
        const fade = Math.min(1, u / 0.06, (1 - u) / 0.06);
        for (const name of boneNames)
          p.rotations[name] = gait.rotations[name].map(
            (n) => n * fade,
          ) as Point;
        p.root[1] += gait.root[1] * e.scale * fade;
        return p;
      }
      start = end;
      continue;
    }
    const target =
      clip.targetId &&
      scene.entities.find((entity) => entity.id === clip.targetId);
    const asset =
      target && allAssets(scene).find((asset) => asset.id === target.assetId);
    if (m.kind === "sit" && target && asset && seatProfile(asset)) {
      seated = planSeat(
        p.root,
        p.heading!,
        e,
        target,
        asset,
        options.canSit !== false,
        options.seatBody,
      );
      const sample = sampleSeat(seated, (time - start) / clip.duration);
      p.root = sample.root;
      p.heading = sample.heading;
      p.seat = sample.seat;
      p.climb = undefined;
      p.rotations = motionPose(
        {
          ...m,
          kind: sample.seat.progress < 0.3 && !seated.warning ? "walk" : "idle",
          distance: 0,
        },
        sample.seat.progress / 0.3,
      ).rotations;
      if (time < end) return p;
      start = end;
      continue;
    }
    if (m.kind === "stand" && seated) {
      const sample = sampleSeat(seated, (time - start) / clip.duration, true);
      p.root = sample.root;
      p.heading = sample.heading;
      p.seat = sample.seat;
      p.climb = undefined;
      p.rotations = motionPose({ ...m, kind: "idle" }, 0).rotations;
      if (time < end) return p;
      seated = undefined;
      p.seat = undefined;
      start = end;
      continue;
    }
    if (m.kind === "climb" && target && asset && ladderProfile(asset)) {
      const plan = planLadder(
        p.root,
        p.heading!,
        e,
        target,
        asset,
        options.canClimb !== false,
      );
      const sample = sampleLadder(plan, (time - start) / clip.duration);
      p.climb = sample;
      p.root = sample.root;
      p.heading = sample.heading;
      p.rotations = motionPose({ ...m, kind: "idle" }, 0).rotations;
      if (sample.progress < 0.18 && !plan.warning)
        p.rotations = motionPose(
          { ...m, kind: "walk" },
          sample.progress / 0.18,
        ).rotations;
      if (time < end) return p;
      start = end;
      continue;
    }
    p.climb = undefined;
    const native =
      m.kind === "imported" ? options.nativeRoot?.(m, clip) : undefined;
    if (time >= end) {
      const last = motionPose(m, 1);
      if (!seated) addRoot(native?.delta || last.root);
      p.heading! += native?.heading || 0;
      start = end;
      continue;
    }
    const local = motionPose(m, (time - start) / clip.duration);
    if (clip.targetId && ["pick", "sip", "place"].includes(m.kind))
      for (const bone of ["spine", "head", "rightArm", "rightForearm"])
        local.rotations[bone] = [0, 0, 0];
    if (!seated)
      addRoot(native ? (native.start.map((n) => -n) as Point) : local.root);
    p.heading! -= native?.startHeading || 0;
    p.rotations = local.rotations;
    return p;
  }
  return p;
}
