import {
  type Entity,
  type Motion,
  type Scene,
  allMotions,
  boneNames,
} from "./scene";
export type Pose = {
  root: [number, number, number];
  rotations: Record<string, [number, number, number]>;
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
  if (m.kind === "pick") {
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
export function entityPose(e: Entity, scene: Scene, time: number): Pose {
  const p: Pose = {
    root: [...e.position],
    rotations: Object.fromEntries(boneNames.map((n) => [n, [0, 0, 0]])),
  };
  let start = 0,
    offset = [0, 0, 0];
  const library = allMotions(scene);
  for (const clip of e.clips) {
    const m = library.find((m) => m.id === clip.motionId);
    if (!m) continue;
    const end = start + clip.duration;
    if (time >= end) {
      const last = motionPose(m, 1);
      offset = offset.map((v, i) => v + last.root[i]);
      start = end;
      continue;
    }
    const local = motionPose(m, (time - start) / clip.duration);
    p.root = p.root.map(
      (v, i) => v + (offset[i] + local.root[i]) * e.scale,
    ) as Pose["root"];
    const dx = p.root[0] - e.position[0],
      dz = p.root[2] - e.position[2];
    p.root[0] =
      e.position[0] + dx * Math.cos(e.rotation) + dz * Math.sin(e.rotation);
    p.root[2] =
      e.position[2] - dx * Math.sin(e.rotation) + dz * Math.cos(e.rotation);
    p.rotations = local.rotations;
    return p;
  }
  const dx = offset[0] * e.scale,
    dz = offset[2] * e.scale;
  p.root = [
    e.position[0] + dx * Math.cos(e.rotation) + dz * Math.sin(e.rotation),
    e.position[1] + offset[1] * e.scale,
    e.position[2] - dx * Math.sin(e.rotation) + dz * Math.cos(e.rotation),
  ];
  return p;
}
