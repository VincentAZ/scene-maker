import { expect, it } from "vitest";
import * as T from "three";
import {
  fitContactLanding,
  fitContactSwing,
  contactSwingBump,
  sampleLandingConstraints,
} from "../src/contactLanding";

it.each([0.01, 1, 100])(
  "fits a curved swing at scale %s while preserving endpoint motion and all correction bounds",
  (scale) => {
    const direction = new T.Vector3(0.3, 0, 0.7).normalize();
    const shape = { a: 5, b: 3 };
    const constraints = Array.from(
      { length: 63 },
      (_, i) => (i + 1) / 64,
    ).flatMap((phase) => {
      const influence = 1 - phase * phase * (3 - 2 * phase);
      const bump = contactSwingBump(phase, shape);
      const baseline = direction
        .clone()
        .multiplyScalar(-0.1 * scale * influence);
      return [
        {
          phase,
          influence,
          center: baseline.clone().negate().divideScalar(influence),
          radius: (0.2 * scale) / influence,
        },
        {
          phase,
          influence,
          center: direction
            .clone()
            .multiplyScalar((0.1 * scale * bump) / influence),
          radius: (0.001 * scale * bump) / influence,
        },
      ];
    });
    const fitted = fitContactSwing(constraints, new T.Vector3(), 0.2 * scale)!;
    expect(fitted).toBeDefined();
    const adjustment = (u: number) =>
      fitted.offset.clone().multiplyScalar(contactSwingBump(u, fitted));
    for (const end of [0, 1]) {
      expect(adjustment(end).length()).toBe(0);
      const h = 1e-5;
      expect(
        adjustment(end + h)
          .sub(adjustment(end - h))
          .length() /
          scale /
          (2 * h),
      ).toBeLessThan(1e-6);
      expect(
        adjustment(end + h)
          .add(adjustment(end - h))
          .length() /
          scale /
          (h * h),
      ).toBeLessThan(0.002);
    }
    for (let i = 0; i <= 1000; i++) {
      const u = i / 1000,
        influence = 1 - u * u * (3 - 2 * u);
      const baseline = direction
        .clone()
        .multiplyScalar(-0.1 * scale * influence);
      expect(
        baseline.clone().add(adjustment(u)).length() / scale,
      ).toBeLessThanOrEqual(0.20000001);
      expect(
        adjustment(u).distanceTo(
          direction
            .clone()
            .multiplyScalar(0.1 * scale * contactSwingBump(u, shape)),
        ) / scale,
      ).toBeLessThanOrEqual(0.00100001 * contactSwingBump(u, shape));
    }
  },
);

it("rejects an infeasible swing endpoint instead of hiding it with an interior bend", () => {
  expect(
    fitContactSwing(
      [{ phase: 0, influence: 1, center: new T.Vector3(2, 0, 0), radius: 1 }],
      new T.Vector3(),
      1,
    ),
  ).toBeUndefined();
});

it("retains authored peaks between coarse samples when fitting a landing", () => {
  const peak = 0.4571;
  const sample = (time: number) => [
    {
      center: new T.Vector3(
        1.2 * Math.exp(-(((time - peak) / 0.003) ** 2)),
        0,
        0,
      ),
      radius: 1,
    },
  ];
  const coarse = Array.from({ length: 61 }, (_, i) => i / 60);
  expect(fitContactLanding(coarse.flatMap(sample), 1).length()).toBe(0);
  const constraints = sampleLandingConstraints([...coarse, peak], sample, 1e-5);
  const result = fitContactLanding(constraints, 1);
  expect(result.x).toBeCloseTo(0.2, 10);
  for (let i = 0; i <= 1000; i++) {
    const disk = sample(i / 1000)[0];
    expect(result.distanceTo(disk.center)).toBeLessThanOrEqual(
      disk.radius + 1e-9,
    );
  }
});

it("refines curved geometry even when an inflection hides at the interval midpoint", () => {
  const sample = (time: number) => [
    {
      center: new T.Vector3(0, 0, 1 + 0.25 * Math.sin(2 * Math.PI * time)),
      radius: 1,
    },
  ];
  const result = fitContactLanding(
    sampleLandingConstraints([0, 1], sample, 1e-5),
    1,
  );
  expect(result.z).toBeCloseTo(0.25, 10);
  expect(result.y).toBe(0);
});

it("finds a bounded landing in nearly redundant disks without an iteration cutoff", () => {
  // Reduced from a repeated stance: the old 128-pass projection returned zero
  // even though these two measured constraints have a small feasible overlap.
  const disks = [
    {
      center: new T.Vector3(-0.009896958299428132, 0, -0.10287410583938406),
      radius: 0.08828395074307378,
    },
    {
      center: new T.Vector3(-0.011028463618399384, 0, -0.10508303705511635),
      radius: 0.09052157512826339,
    },
  ];
  const landing = fitContactLanding(disks, 0.08828395074307378);
  expect(landing.length()).toBeGreaterThan(0.01);
  expect(landing.length()).toBeLessThan(0.01518);
  for (const disk of disks)
    expect(landing.distanceTo(disk.center)).toBeLessThanOrEqual(
      disk.radius + 1e-10,
    );
});

it.each([1e-8, 1, 1e8])(
  "finds the closest two-boundary solution at scale %s",
  (scale) => {
    const disks = [-1, 1].map((x) => ({
      center: new T.Vector3(x * scale, 0, scale),
      radius: 1.2 * scale,
    }));
    const result = fitContactLanding(disks, scale);
    expect(result.x / scale).toBeCloseTo(0, 12);
    expect(result.z / scale).toBeCloseTo(1 - Math.sqrt(0.44), 12);
    expect(
      fitContactLanding([...disks].reverse(), scale).distanceTo(result) / scale,
    ).toBeLessThan(1e-12);
  },
);

it("handles a tangent solution and an empty three-disk intersection", () => {
  const tangent = fitContactLanding(
    [-1, 1].map((x) => ({
      center: new T.Vector3(x * 0.5, 0, 0.5),
      radius: 0.5,
    })),
    1,
  );
  expect(tangent.distanceTo(new T.Vector3(0, 0, 0.5))).toBeLessThan(1e-12);
  const empty = [0, 1, 2].map((i) => ({
    center: new T.Vector3(
      Math.cos((i * 2 * Math.PI) / 3),
      0,
      Math.sin((i * 2 * Math.PI) / 3),
    ).multiplyScalar(1.8 / Math.sqrt(3)),
    radius: 1,
  }));
  expect(fitContactLanding(empty, 3).length()).toBe(0);
});

it("satisfies varied feasible reach intersections without moving farther than a known solution", () => {
  let state = 8347;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let trial = 0; trial < 200; trial++) {
    const scale = 10 ** (12 * random() - 6);
    const angle = random() * 2 * Math.PI;
    const known = new T.Vector3(
      Math.cos(angle),
      0,
      Math.sin(angle),
    ).multiplyScalar(scale * (0.1 + 0.8 * random()));
    const disks = Array.from({ length: 2 + Math.floor(random() * 12) }, () => {
      const center = new T.Vector3(
        random() * 4 - 2,
        0,
        random() * 4 - 2,
      ).multiplyScalar(scale);
      return {
        center,
        radius: center.distanceTo(known) + scale * random() * 0.1,
      };
    });
    const result = fitContactLanding(disks, scale);
    for (const disk of disks)
      expect(result.distanceTo(disk.center) / scale).toBeLessThanOrEqual(
        disk.radius / scale + 1e-10,
      );
    expect(result.length() / scale).toBeLessThanOrEqual(
      known.length() / scale + 1e-10,
    );
  }
});

it.each([0.01, 1, 100])(
  "fits the nearest landing in rotated geometry at scale %s",
  (scale) => {
    const direction = new T.Vector3(0.3, 0, -0.7).normalize();
    const centers = [0, 0.2, 0.7, 1.2].map((distance) => ({
      center: direction.clone().multiplyScalar(distance * scale),
      radius: scale,
    }));
    const result = fitContactLanding(centers, scale);
    expect(
      result.distanceTo(direction.clone().multiplyScalar(0.2 * scale)) / scale,
    ).toBeLessThan(1e-7);
    for (const disk of centers)
      expect(result.distanceTo(disk.center) / scale).toBeLessThanOrEqual(
        disk.radius / scale + 1e-7,
      );
  },
);

it("retains the original landing when already feasible or when no bounded solution exists", () => {
  expect(
    fitContactLanding(
      [{ center: new T.Vector3(0.1, 0, 0), radius: 0.2 }],
      0.2,
    ).length(),
  ).toBe(0);
  expect(
    fitContactLanding(
      [
        { center: new T.Vector3(-1, 0, 0), radius: 0.1 },
        { center: new T.Vector3(1, 0, 0), radius: 0.1 },
      ],
      0.2,
    ).length(),
  ).toBe(0);
});

it("includes a stricter physical reach constraint rather than fitting only displacement", () => {
  const result = fitContactLanding(
    [
      { center: new T.Vector3(0.12, 0, 0), radius: 0.1 },
      { center: new T.Vector3(0, 0, 0.08), radius: 0.07 },
    ],
    0.1,
  );
  expect(result.x).toBeGreaterThan(0.02);
  expect(result.z).toBeGreaterThan(0);
  expect(result.distanceTo(new T.Vector3(0, 0, 0.08))).toBeLessThanOrEqual(
    0.07000001,
  );
  expect(result.distanceTo(new T.Vector3(0.12, 0, 0))).toBeLessThanOrEqual(
    0.10000001,
  );
});
