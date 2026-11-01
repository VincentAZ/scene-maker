import * as T from "three";

export type LandingDisk = { center: T.Vector3; radius: number };
export type LandingBlendConstraint = LandingDisk & {
  influence: number;
  phase: number;
};
export type ContactSwing = { offset: T.Vector3; a: number; b: number };
type SwingShape = Pick<ContactSwing, "a" | "b">;
const symmetricSwing = { a: 3, b: 3 };
export function contactSwingBump(
  u: number,
  shape: SwingShape = symmetricSwing,
) {
  if (u <= 0 || u >= 1) return 0;
  const peak = shape.a / (shape.a + shape.b);
  return (u / peak) ** shape.a * ((1 - u) / (1 - peak)) ** shape.b;
}
const swingShapes = [
  ...Array.from({ length: 14 }, (_, i) => ({ a: 3, b: i + 3 })),
  ...Array.from({ length: 13 }, (_, i) => ({ a: i + 4, b: 3 })),
].map((shape) => {
  // Compare the added acceleration energy of each normalized shape. The
  // interval duration is common to every candidate and cancels in ranking.
  let energy = 0;
  for (let i = 1; i < 128; i++) {
    const u = i / 128,
      { a, b } = shape;
    const second =
      contactSwingBump(u, shape) *
      ((a / u - b / (1 - u)) ** 2 - a / (u * u) - b / (1 - u) ** 2);
    energy += (second * second) / 128;
  }
  return { ...shape, energy };
});

/** Bend the interior of a swing correction while preserving its endpoint
 * position, velocity and acceleration. Choose the least added acceleration
 * among feasible shapes; actual correction and reach bounds stay unchanged. */
export function fitContactSwing(
  constraints: LandingBlendConstraint[],
  landing: T.Vector3,
  limit: number,
) {
  const fixed = constraints.filter(({ phase }) => phase <= 0 || phase >= 1);
  if (
    fixed.some(
      ({ center, radius }) =>
        landing.distanceTo(center) > radius + limit * 1e-10,
    )
  )
    return;
  constraints = constraints.filter(({ phase }) => phase > 0 && phase < 1);
  let best: ContactSwing | undefined;
  let cost = Infinity;
  for (const shape of swingShapes) {
    const disks = constraints.map(({ center, radius, influence, phase }) => {
      const weight = influence / contactSwingBump(phase, shape);
      return {
        center: center.clone().sub(landing).multiplyScalar(weight),
        radius: radius * weight,
      };
    });
    // The change between two bounded correction vectors can be twice their
    // allowance; each resulting correction is still constrained by its disk.
    const offset = fitContactLanding(disks, 2 * limit);
    if (
      !disks.every(
        ({ center, radius }) =>
          offset.distanceTo(center) <=
          radius +
            Number.EPSILON * 128 * Math.max(limit, radius, center.length()),
      )
    )
      continue;
    const energy = offset.lengthSq() * shape.energy;
    if (energy < cost) {
      best = { offset, a: shape.a, b: shape.b };
      cost = energy;
      if (cost === 0) return best;
    }
  }
  return best;
}

/** Refine measured constraints where the animated geometry bends away from a
 * straight interpolation. Seed with authored keys as well as coarse samples;
 * quarter points keep an inflection from hiding behind a linear midpoint. */
export function sampleLandingConstraints(
  times: number[],
  sample: (time: number) => LandingDisk[],
  tolerance: number,
) {
  const knots = [...new Set(times)].sort((a, b) => a - b);
  const frames = new Map<number, LandingDisk[]>();
  const at = (time: number) => {
    let value = frames.get(time);
    if (!value) frames.set(time, (value = sample(time)));
    return value;
  };
  const refine = (start: number, end: number, depth: number) => {
    const middle = (start + end) / 2;
    if (!(middle > start && middle < end)) return;
    const a = at(start),
      b = at(end),
      m = at(middle);
    const error =
      a.length !== b.length || a.length !== m.length
        ? Infinity
        : Math.max(
            0,
            ...m.map(
              (disk, i) =>
                disk.center.distanceTo(
                  a[i].center.clone().lerp(b[i].center, 0.5),
                ) + Math.abs(disk.radius - (a[i].radius + b[i].radius) / 2),
            ),
          );
    if (depth < 10 && (depth === 0 || error > tolerance)) {
      refine(start, middle, depth + 1);
      refine(middle, end, depth + 1);
    }
  };
  for (const time of knots) at(time);
  for (let i = 1; i < knots.length; i++) refine(knots[i - 1], knots[i], 0);
  return [...frames].sort(([a], [b]) => a - b).flatMap(([, disks]) => disks);
}

/** Nearest horizontal landing in the intersection of measured correction and
 * reach disks. The closest point is either a radial projection onto one circle
 * or an intersection of two boundaries; no iterative convergence is required. */
export function fitContactLanding(constraints: LandingDisk[], limit: number) {
  const zero = new T.Vector3();
  if (!(limit > 0) || !Number.isFinite(limit) || !constraints.length)
    return zero;
  if (
    constraints.some(
      ({ center, radius }) =>
        !Number.isFinite(center.lengthSq() + radius) || radius < 0,
    )
  )
    return zero;
  // Work in allowance units, retaining precision across imported model scales.
  const disks = [
    { x: 0, z: 0, r: 1 },
    ...constraints.map(({ center, radius }) => ({
      x: center.x / limit,
      z: center.z / limit,
      r: radius / limit,
    })),
  ];
  const tolerance = (disk: (typeof disks)[number]) =>
    Number.EPSILON *
    128 *
    Math.max(1, Math.abs(disk.x), Math.abs(disk.z), disk.r);
  const feasible = (x: number, z: number) =>
    disks.every(
      (disk) => Math.hypot(x - disk.x, z - disk.z) <= disk.r + tolerance(disk),
    );
  if (feasible(0, 0)) return zero;
  for (const disk of disks) {
    const distance = Math.hypot(disk.x, disk.z);
    if (distance <= disk.r) continue;
    const factor = (distance - disk.r) / distance;
    const x = disk.x * factor,
      z = disk.z * factor;
    // This is the nearest point in this individual disk. If it also satisfies
    // every other disk, it is the nearest point in their intersection.
    if (feasible(x, z)) return new T.Vector3(x * limit, 0, z * limit);
  }
  let best = Infinity;
  const result = new T.Vector3();
  const consider = (x: number, z: number) => {
    const distance = Math.hypot(x, z);
    if (distance < best && feasible(x, z)) {
      best = distance;
      result.set(x * limit, 0, z * limit);
    }
  };
  for (let i = 0; i < disks.length; i++)
    for (let j = 0; j < i; j++) {
      const a = disks[i],
        b = disks[j];
      const dx = b.x - a.x,
        dz = b.z - a.z,
        distance = Math.hypot(dx, dz);
      const epsilon = Math.max(tolerance(a), tolerance(b));
      if (
        distance === 0 ||
        distance > a.r + b.r + epsilon ||
        distance < Math.abs(a.r - b.r) - epsilon
      )
        continue;
      const along =
        ((a.r - b.r) * (a.r + b.r) + distance * distance) / (2 * distance);
      const heightSquared = (a.r - along) * (a.r + along);
      if (heightSquared < -epsilon * Math.max(1, a.r, b.r, distance)) continue;
      const height = Math.sqrt(Math.max(0, heightSquared));
      const x = a.x + (along * dx) / distance,
        z = a.z + (along * dz) / distance;
      consider(x - (height * dz) / distance, z + (height * dx) / distance);
      consider(x + (height * dz) / distance, z - (height * dx) / distance);
    }
  // Empty or numerically unverified intersections retain the original anchor.
  return result;
}
