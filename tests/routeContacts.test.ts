import { describe, it, expect } from "vitest";
import * as T from "three";
import {
  detectFootContacts,
  detectNativeFootContacts,
  correctFootContact,
  footPosition,
  contactPoint,
  supportRouteContactReach,
} from "../src/routeContacts";
import { applyRouteFootPlanting } from "../src/routeFootPlanting";
import { starterScene } from "../shared/scene";
import type { LocomotionProfile } from "../src/locomotion";
import { routeSourceBoundaries } from "../src/locomotion";
import {
  scheduleRouteContacts,
  scheduledContactPoint,
} from "../src/routeContactSchedule";

it.each([false, true])(
  "matches joined stance velocity while retaining captured points (continuous=%s)",
  (continuous) => {
    const contact = (times: number[], positions: number[]) => ({
      side: "left" as const,
      start: times[0],
      end: times.at(-1)!,
      samples: times.map((time, i) => ({
        time,
        point: new T.Vector3(positions[i], 0, 0),
      })),
    });
    const contacts = continuous
      ? [contact([0, 0.3, 0.8, 1], [0, 0.003, 0.007, 0.02])]
      : [
          contact([0, 0.1, 0.2], [0, 0.001, 0.004]),
          contact([0.7, 0.9, 1], [0.02, 0.025, 0.028]),
        ];
    const before = contacts.map((c) =>
      c.samples.map((sample) => sample.point.toArray()),
    );
    const scheduled = scheduleRouteContacts(contacts, 1, ["left"])[0];
    const sample = (time: number) => scheduledContactPoint(scheduled, time, 1);
    const h = 1e-6,
      center = sample(1);
    const incoming = center
        .clone()
        .sub(sample(1 - h))
        .divideScalar(h),
      outgoing = sample(1 + h)
        .sub(center)
        .divideScalar(h);
    expect(incoming.distanceTo(outgoing)).toBeLessThan(1e-5);
    for (const point of scheduled.contact.samples)
      expect(
        contactPoint(scheduled.contact, point.time).distanceTo(point.point),
      ).toBeLessThan(1e-12);
    expect(
      contacts.map((c) => c.samples.map((s) => s.point.toArray())),
    ).toEqual(before);
    expect(
      contacts.every((c) => c.samples.every((s) => !("velocity" in s))),
    ).toBe(true);
  },
);

it("requires measured ground for native contact and splits stance around unsupported intervals", () => {
  const frames = Array.from({ length: 61 }, (_, i) => ({
    time: i / 60,
    feet: [new T.Vector3(-0.1, 0.3, 0), new T.Vector3(0.1, 0.3, 0)],
    heights: [0.3, 0.3] as [number, number],
  }));
  // Relative ankle minima alone would incorrectly label this hovering take.
  expect(detectFootContacts(frames, 1)).toHaveLength(2);
  expect(detectNativeFootContacts(frames, 1)).toEqual([]);
  expect(
    detectNativeFootContacts(
      frames.map(({ heights: _, ...f }) => f),
      1,
    ),
  ).toEqual([]);
  const grounded = frames.map((f) => ({
    ...f,
    heights: [0, 0] as [number, number],
  }));
  expect(detectNativeFootContacts(grounded, 1)).toHaveLength(2);
  const broken = grounded.map((f) => ({
    ...f,
    heights: [f.time > 0.3 && f.time < 0.7 ? 0.2 : 0, 0] as [number, number],
  }));
  const contacts = detectNativeFootContacts(broken, 1);
  expect(
    contacts.filter((c) => c.side === "left").map((c) => [c.start, c.end]),
  ).toEqual([
    [0, 0.3],
    [0.7, 1],
  ]);
  expect(
    contacts.filter((c) => c.side === "right").map((c) => [c.start, c.end]),
  ).toEqual([[0, 1]]);
});

function rig() {
  const group = new T.Group(),
    upper = new T.Bone(),
    lower = new T.Bone(),
    foot = new T.Bone();
  upper.position.set(0, 0.85, 0);
  lower.position.set(0, -0.4, 0.1);
  foot.position.set(0, -0.4, -0.1);
  group.add(upper);
  upper.add(lower);
  lower.add(foot);
  group.userData.bones = { leftLeg: upper, leftShin: lower, leftFoot: foot };
  return { group, upper, lower, foot };
}

it.each([0.1, 1, 4])(
  "distinguishes capped contact displacement from physical reach at scale %s",
  (scale) => {
    for (const weight of [0.25, 1]) {
      const f = rig();
      f.group.scale.setScalar(scale);
      f.group.updateMatrixWorld(true);
      const before = footPosition(f.group, "left")!;
      // Horizontal planting must ignore the unrelated vertical offset.
      const desired = before
        .clone()
        .add(new T.Vector3(0.12, 3, 0).multiplyScalar(scale));
      const result = correctFootContact(
        f.group,
        "left",
        desired,
        weight,
        0.04 * scale,
      )!;
      expect(result.distanceLimited / scale).toBeCloseTo(0.08 * weight, 12);
      expect(result.reachLimited / scale).toBeLessThan(1e-8);
      expect(result.error / scale).toBeLessThan(1e-8);
      const after = footPosition(f.group, "left")!;
      expect((after.x - before.x) / scale).toBeCloseTo(0.04 * weight, 8);
      expect(after.y).toBeCloseTo(before.y, 8);
    }
  },
);

it("reports a zero contact allowance even when no IK solve is needed", () => {
  const f = rig();
  f.group.updateMatrixWorld(true);
  const before = footPosition(f.group, "left")!;
  const result = correctFootContact(
    f.group,
    "left",
    before.clone().add(new T.Vector3(0.1, 0, 0)),
    1,
    0,
  )!;
  expect(result.distanceLimited).toBeCloseTo(0.1, 12);
  expect(result.reachLimited).toBe(0);
  expect(result.correction).toBe(0);
  expect(result.error).toBe(0);
  expect(footPosition(f.group, "left")!.distanceTo(before)).toBe(0);
});

it.each([0.1, 1, 4])(
  "supports contact reach at scale %s without sliding, lifting feet or stretching either leg",
  (scale) => {
    const f = rig(),
      other = f.upper.clone(true) as T.Bone;
    other.position.x = 0.25;
    f.group.add(other);
    const otherLower = other.children[0] as T.Bone,
      otherFoot = otherLower.children[0] as T.Bone;
    Object.assign(f.group.userData.bones, {
      rightLeg: other,
      rightShin: otherLower,
      rightFoot: otherFoot,
    });
    const parent = new T.Group();
    parent.rotation.y = 0.73;
    parent.scale.setScalar(scale);
    parent.add(f.group);
    parent.updateMatrixWorld(true);
    const position = (node: T.Object3D) =>
      node.getWorldPosition(new T.Vector3());
    const reference = position(f.foot),
      passivePoint = position(otherFoot),
      rotation = f.foot.getWorldQuaternion(new T.Quaternion());
    const lengths = [
      position(f.upper).distanceTo(position(f.lower)),
      position(f.lower).distanceTo(reference),
      position(other).distanceTo(position(otherLower)),
      position(otherLower).distanceTo(passivePoint),
    ];
    const desired = reference.clone().add(new T.Vector3(0.22 * scale, 0, 0));
    const passive = supportRouteContactReach(f.group, [
      {
        side: "left",
        desired,
        endpoint: reference,
        weight: 1,
        limit: 0.3 * scale,
      },
    ]);
    expect(f.group.userData.routeContactSupport).toBeGreaterThan(0);
    expect(f.group.userData.routeContactSupport / scale).toBeLessThan(0.042);
    const result = correctFootContact(
      f.group,
      "left",
      desired,
      1,
      0.3 * scale,
      undefined,
      false,
      reference,
    )!;
    for (const contact of passive)
      correctFootContact(
        f.group,
        contact.side,
        contact.point,
        1,
        0,
        undefined,
        false,
        contact.point,
      );
    expect(result.reachLimited / scale).toBeLessThan(1e-5);
    expect(position(f.foot).distanceTo(desired) / scale).toBeLessThan(1e-5);
    expect(position(otherFoot).distanceTo(passivePoint) / scale).toBeLessThan(
      1e-7,
    );
    expect(
      f.foot.getWorldQuaternion(new T.Quaternion()).angleTo(rotation),
    ).toBeLessThan(1e-7);
    const actual = [
      position(f.upper).distanceTo(position(f.lower)),
      position(f.lower).distanceTo(position(f.foot)),
      position(other).distanceTo(position(otherLower)),
      position(otherLower).distanceTo(position(otherFoot)),
    ];
    actual.forEach((length, i) => expect(length).toBeCloseTo(lengths[i], 10));
  },
);

it("does not lower an unchanged contact even when the source knee is fully extended", () => {
  const f = rig();
  f.lower.position.z = 0;
  f.foot.position.z = 0;
  f.group.updateMatrixWorld(true);
  const endpoint = footPosition(f.group, "left")!,
    before = f.group.position.clone();
  supportRouteContactReach(f.group, [
    {
      side: "left",
      endpoint,
      desired: endpoint.clone(),
      weight: 1,
      limit: 0.2,
    },
  ]);
  expect(f.group.userData.routeContactSupport).toBe(0);
  expect(f.group.position.toArray()).toEqual(before.toArray());
});

it("keeps support velocity continuous when a contact crosses the original horizontal reach radius", () => {
  const f = rig();
  f.foot.position.z = 0.1;
  const sample = (t: number) => {
    f.group.position.set(0, 0, 0);
    f.group.updateMatrixWorld(true);
    const endpoint = footPosition(f.group, "left")!;
    const desired = endpoint
      .clone()
      .add(
        new T.Vector3(
          0.03,
          0,
          Math.sqrt(0.2 ** 2 - 0.03 ** 2) - 0.2 + t * 0.01,
        ),
      );
    supportRouteContactReach(f.group, [
      { side: "left", endpoint, desired, weight: 1, limit: 0.2 },
    ]);
    return f.group.userData.routeContactSupport as number;
  };
  const h = 1e-5,
    center = sample(0);
  expect(Math.abs(2 * center - sample(-h) - sample(h)) / h).toBeLessThan(1e-5);
});
describe("source-contact route correction", () => {
  it("prepares a reachable landing even when the entire correction stays within its distance allowance", () => {
    const f = rig(),
      scene = starterScene(),
      actor = scene.entities[0];
    actor.scale = 1;
    const profile: LocomotionProfile = {
      duration: 1,
      distance: 1,
      mode: "in-place",
      startHeading: 0,
      warning: "",
      frames: [],
      contactLoopSides: ["left"],
      contacts: [
        {
          side: "left",
          start: 0.3,
          end: 0.7,
          approachDuration: 0.2,
          samples: [0.3, 0.7].map((time) => ({ time, point: new T.Vector3() })),
        },
      ],
    };
    const raw = (time: number) => {
      f.group.position.set(-time * 0.3, 0, 0);
      f.upper.rotation.set(0, 0, 0.5);
      f.lower.quaternion.identity();
      f.foot.quaternion.identity();
      f.group.updateMatrixWorld(true);
      return { routeTime: time };
    };
    const sample = (time: number) => {
      raw(time);
      applyRouteFootPlanting(
        f.group,
        actor,
        scene,
        time,
        {
          profile,
          sample: { time },
          ratio: 1,
          start: 0,
          duration: 1,
          sourceDuration: 1,
        },
        true,
        raw,
      );
      expect(f.group.position.x).toBeCloseTo(-time * 0.3, 12);
      return footPosition(f.group, "left")!;
    };
    const landing = sample(0.3);
    for (let i = 0; i <= 40; i++) {
      const planted = sample(0.3 + i / 100);
      const report = f.group.userData.routeFootCorrection.left;
      expect(report.distanceLimited).toBeLessThan(1e-8);
      expect(report.reachLimited).toBeLessThan(1e-6);
      expect(planted.distanceTo(landing)).toBeLessThan(1e-5);
    }
  });

  it.each([0.05, 0.3])(
    "prepares a feasible landing from %ss without changing the route clock or initial pose",
    (start) => {
      const f = rig(),
        scene = starterScene(),
        actor = scene.entities[0];
      actor.scale = 1;
      const profile: LocomotionProfile = {
        duration: 1,
        distance: 1,
        mode: "in-place",
        startHeading: 0,
        warning: "",
        frames: [],
        contactLoopSides: ["left"],
        contacts: [
          {
            side: "left",
            start,
            end: start + 0.4,
            approachDuration: 0.2,
            samples: [start, start + 0.4].map((time) => ({
              time,
              point: new T.Vector3(),
            })),
          },
        ],
      };
      const raw = (time: number) => {
        f.group.position.set(time * 0.5, 0, 0);
        for (const bone of [f.upper, f.lower, f.foot])
          bone.quaternion.identity();
        f.group.updateMatrixWorld(true);
        return { routeTime: time };
      };
      const sample = (time: number) => {
        raw(time);
        applyRouteFootPlanting(
          f.group,
          actor,
          scene,
          time,
          {
            profile,
            sample: { time },
            ratio: 1,
            start: 0,
            duration: 1,
            sourceDuration: 1,
          },
          true,
          raw,
        );
        expect(f.group.position.x).toBeCloseTo(time * 0.5, 12);
        return footPosition(f.group, "left")!;
      };
      expect(sample(0).x).toBeCloseTo(0, 12);
      const landing = sample(start);
      // The original touchdown anchor used all of its .20m stance demand, exceeding
      // the unchanged .16m allowance. Prepare enough room for stance and release.
      expect(landing.x - start * 0.5).toBeGreaterThan(0.04);
      expect(landing.x - start * 0.5).toBeLessThan(0.08);
      for (const time of [
        start,
        start + 0.1,
        start + 0.2,
        start + 0.3,
        start + 0.4,
      ]) {
        expect(sample(time).distanceTo(landing)).toBeLessThan(1e-5);
        const report = f.group.userData.routeFootCorrection.left;
        expect(report.correction).toBeLessThanOrEqual(0.160001);
        expect(report.distanceLimited).toBeLessThan(1e-7);
      }
      for (const time of [
        ...(start > 0.2 ? [start - 0.2] : []),
        start,
        start + 0.4,
      ]) {
        const h = 1e-5,
          center = sample(time);
        expect(
          center
            .clone()
            .sub(sample(time - h))
            .sub(sample(time + h).sub(center))
            .length() / h,
        ).toBeLessThan(0.002);
      }
      sample(0.9);
      expect(sample(start + 0.15).distanceTo(landing)).toBeLessThan(1e-5);
    },
  );

  it("matches stance release velocity even when the source has no approach interval", () => {
    const f = rig(),
      scene = starterScene(),
      actor = scene.entities[0];
    actor.scale = 1;
    const profile: LocomotionProfile = {
      duration: 1,
      distance: 1,
      mode: "in-place",
      startHeading: 0,
      warning: "",
      frames: [],
      contacts: [
        {
          side: "left",
          start: 0,
          end: 0.6,
          samples: [0, 0.6].map((time) => ({ time, point: new T.Vector3() })),
        },
      ],
    };
    const raw = (time: number) => {
      f.group.position.set(0.1 * time, 0, 0);
      for (const bone of [f.upper, f.lower, f.foot]) bone.quaternion.identity();
      f.group.updateMatrixWorld(true);
    };
    const sample = (time: number) => {
      raw(time);
      applyRouteFootPlanting(
        f.group,
        actor,
        scene,
        time,
        {
          profile,
          sample: { time },
          ratio: 1,
          start: 0,
          duration: 1,
          sourceDuration: 1,
        },
        false,
        raw,
      );
      return footPosition(f.group, "left")!;
    };
    for (const boundary of [0.6, 0.95]) {
      const h = 1e-5,
        before = sample(boundary - h),
        center = sample(boundary),
        after = sample(boundary + h);
      expect(
        center.clone().sub(before).sub(after.sub(center)).length() / h,
      ).toBeLessThan(0.0001);
    }
  });
  it.each([
    [false, "travel"],
    [true, "travel"],
    [false, "in-place"],
    [true, "in-place"],
  ] as const)(
    "preserves captured travel without importing receiver stride drift into virtual travel (transferred=%s, mode=%s)",
    (transferred, mode) => {
      const f = rig(),
        scene = starterScene(),
        actor = scene.entities[0],
        up = new T.Vector3(0, 1, 0);
      actor.scale = 1;
      const profile: LocomotionProfile = {
        duration: 1,
        distance: 1,
        startHeading: 0.7,
        mode,
        warning: "",
        frames: [0, 1].map((time) => ({
          time,
          distance: time,
          center: new T.Vector3(),
          heading: 0.7,
        })),
        contacts: [
          {
            side: "left",
            start: 0.2,
            end: 0.6,
            approachDuration: 0.1,
            releaseDuration: 0.25,
            samples: [0.2, 0.6].map((time) => ({
              time,
              point: new T.Vector3(),
            })),
          },
        ],
      };
      const articulation = (time: number) => 0.15 * Math.sin(2 * time);
      const localPoint = (time: number, source = false) =>
        new T.Vector3(0, -0.4, -0.1)
          .applyAxisAngle(
            new T.Vector3(1, 0, 0),
            source && transferred
              ? 0.08 * Math.sin(2 * time)
              : articulation(time),
          )
          .add(new T.Vector3(0, 0.45, 0.1));
      const raw = (time: number) => {
        f.group.position.set(0.12 * time, 0, 0);
        f.group.rotation.y = 0.25 * time;
        f.upper.quaternion.identity();
        f.lower.rotation.set(articulation(time), 0, 0);
        f.foot.quaternion.identity();
        f.group.updateMatrixWorld(true);
        return {
          routeTime: time,
          root: f.group.position.clone(),
          routeCenter: new T.Vector3(),
        };
      };
      const sample = (time: number) => {
        const frame = raw(time);
        applyRouteFootPlanting(
          f.group,
          actor,
          scene,
          time,
          {
            profile,
            root: frame.root,
            sample: { time, center: frame.routeCenter },
            ratio: transferred ? 0.7 : 1,
            start: 0,
            duration: 1,
            sourceDuration: 1,
          },
          transferred,
          raw,
        );
        return footPosition(f.group, "left")!;
      };
      for (const time of [0.2, 0.3, 0.45, 0.6, 0.3]) {
        const captured = localPoint(time);
        if (mode === "in-place")
          captured.copy(localPoint(0.2)).setY(localPoint(time).y);
        const expected = captured
          .applyAxisAngle(up, 0.25 * 0.2)
          .add(new T.Vector3(0.12 * 0.2, 0, 0));
        expect(sample(time).distanceTo(expected)).toBeLessThan(1e-6);
      }
      for (const boundary of [0.2, 0.6, 0.85]) {
        const h = 1e-5,
          center = sample(boundary);
        const before = center
            .clone()
            .sub(sample(boundary - h))
            .divideScalar(h),
          after = sample(boundary + h)
            .sub(center)
            .divideScalar(h);
        expect(before.distanceTo(after)).toBeLessThan(0.005);
      }
      raw(0.9);
      const released = footPosition(f.group, "left")!;
      expect(sample(0.9).distanceTo(released)).toBeLessThan(1e-8);
    },
  );

  it.each([false, true])(
    "keeps captured foot articulation in the stance frame and smoothly releases route turning (transferred=%s)",
    (transferred) => {
      for (const rate of [0.75, 1, 1.6]) {
        const f = rig(),
          scene = starterScene(),
          actor = scene.entities[0];
        actor.scale = 1;
        const up = new T.Vector3(0, 1, 0);
        const yaw = (s: number) => 0.2 + 0.8 * s + 0.1 * s * s;
        const authored = (s: number) =>
          new T.Quaternion().setFromEuler(
            new T.Euler(
              0.2 * Math.sin(1.7 * s),
              0.15 * s,
              0.12 * Math.cos(0.5 * s),
            ),
          );
        const raw = (time: number) => {
          const phase = time * rate;
          f.group.rotation.y = yaw(phase);
          f.upper.quaternion.identity();
          f.lower.quaternion.identity();
          f.foot.quaternion.copy(authored(phase));
          f.group.updateMatrixWorld(true);
        };
        const profile: LocomotionProfile = {
          duration: 1,
          distance: 1,
          startHeading: 0.7,
          mode: "travel",
          warning: "",
          frames: [],
          contacts: [
            {
              side: "left",
              start: 0.3,
              end: 0.6,
              approachDuration: 0.2,
              releaseDuration: 0.25,
              samples: [0.3, 0.6].map((time) => ({
                time,
                point: new T.Vector3(),
              })),
            },
          ],
        };
        const sample = (phase: number) => {
          const time = phase / rate;
          raw(time);
          applyRouteFootPlanting(
            f.group,
            actor,
            scene,
            time,
            {
              profile,
              sample: { time: phase },
              ratio: 1,
              start: 0,
              duration: 1 / rate,
              sourceDuration: 1,
            },
            transferred,
            raw,
          );
          return f.foot.getWorldQuaternion(new T.Quaternion()).normalize();
        };
        for (const t of [0.3, 0.45, 0.6, 0.45]) {
          const expected = new T.Quaternion()
            .setFromAxisAngle(up, yaw(0.3))
            .multiply(authored(t));
          expect(sample(t).angleTo(expected)).toBeLessThan(1e-7);
        }
        const released = new T.Quaternion()
          .setFromAxisAngle(up, yaw(0.85))
          .multiply(authored(0.85));
        expect(sample(0.85).angleTo(released)).toBeLessThan(1e-7);
        const velocity = (a: T.Quaternion, b: T.Quaternion, h: number) => {
          const q = b.clone().multiply(a.clone().invert()).normalize();
          if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
          const axis = new T.Vector3(q.x, q.y, q.z),
            length = axis.length();
          return length
            ? axis.multiplyScalar((2 * Math.atan2(length, q.w)) / (length * h))
            : axis;
        };
        for (const boundary of [0.3, 0.6, 0.85]) {
          const h = 1e-5,
            center = sample(boundary);
          expect(
            velocity(sample(boundary - h), center, h).distanceTo(
              velocity(center, sample(boundary + h), h),
            ),
          ).toBeLessThan(0.002);
        }
        const before = sample(0.4);
        sample(0.8);
        expect(sample(0.4).angleTo(before)).toBeLessThan(1e-7);
      }
    },
  );

  it.each([0.75, 1.6])(
    "unfolds a repeated source frame without a stance rotation or velocity seam at rate %s",
    (rate) => {
      const f = rig(),
        scene = starterScene(),
        actor = scene.entities[0],
        up = new T.Vector3(0, 1, 0);
      actor.scale = 1;
      const profile: LocomotionProfile = {
        duration: 1,
        distance: 1,
        startHeading: 0,
        mode: "travel",
        warning: "",
        frames: Array.from({ length: 61 }, (_, i) => {
          const t = i / 60;
          return {
            time: t,
            distance: t,
            center: new T.Vector3(),
            heading: 0.2 * t + 0.3 * t * t,
          };
        }),
        contactLoopSides: ["left"],
        contacts: [
          {
            side: "left",
            start: 0,
            end: 1,
            samples: [0, 1].map((time) => ({ time, point: new T.Vector3() })),
          },
        ],
      };
      const raw = (time: number) => {
        const sourceTime = time * rate,
          phase = sourceTime % 1;
        const index = Math.min(59, Math.floor(phase * 60)),
          u = phase * 60 - index;
        const angle = T.MathUtils.lerp(
          profile.frames[index].heading,
          profile.frames[index + 1].heading,
          u,
        );
        f.group.rotation.y = 0.4 * sourceTime - angle;
        f.upper.quaternion.identity();
        f.lower.quaternion.identity();
        f.foot.quaternion
          .setFromAxisAngle(up, angle)
          .multiply(
            new T.Quaternion().setFromAxisAngle(
              new T.Vector3(1, 0, 0),
              0.1 * Math.sin(2 * Math.PI * phase),
            ),
          );
        f.group.updateMatrixWorld(true);
        return { routeTime: phase };
      };
      const sample = (sourceTime: number) => {
        const time = sourceTime / rate;
        const pose = raw(time);
        applyRouteFootPlanting(
          f.group,
          actor,
          scene,
          time,
          {
            profile,
            sample: { time: pose.routeTime },
            ratio: 1,
            start: 0,
            duration: 2.2 / rate,
            sourceDuration: 2.2,
          },
          false,
          raw,
        );
        return f.foot.getWorldQuaternion(new T.Quaternion()).normalize();
      };
      for (const boundary of [1, 2]) {
        expect(
          sample(boundary - 1e-7).angleTo(sample(boundary + 1e-7)),
        ).toBeLessThan(1e-6);
        const h = 1e-5,
          center = sample(boundary);
        const before = center.clone().multiply(sample(boundary - h).invert());
        const after = sample(boundary + h).multiply(center.clone().invert());
        expect(
          (new T.Vector3(
            before.x - after.x,
            before.y - after.y,
            before.z - after.z,
          ).length() *
            2) /
            h,
        ).toBeLessThan(0.002);
      }
    },
  );

  it("matches release velocity after a stance correction reaches its distance limit", () => {
    const f = rig(),
      scene = starterScene(),
      actor = scene.entities[0];
    actor.scale = 1;
    const rotations = [f.upper, f.lower, f.foot].map((bone) =>
      bone.quaternion.clone(),
    );
    const raw = (time: number) => {
      const phase = time - 0.3;
      f.group.position.set(4 * phase - 12 * phase * phase, 0, 0);
      [f.upper, f.lower, f.foot].forEach((bone, i) =>
        bone.quaternion.copy(rotations[i]),
      );
      f.group.updateMatrixWorld(true);
    };
    const profile: LocomotionProfile = {
      duration: 1,
      distance: 1,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [],
      contactLoopSides: ["left"],
      contacts: [
        {
          side: "left",
          start: 0.3,
          end: 0.5,
          approachDuration: 0.2,
          releaseDuration: 0.2,
          samples: [0.3, 0.5].map((time) => ({ time, point: new T.Vector3() })),
        },
      ],
    };
    const sample = (time: number) => {
      raw(time);
      applyRouteFootPlanting(
        f.group,
        actor,
        scene,
        time,
        {
          profile,
          sample: { time },
          ratio: 1,
          start: 0,
          duration: 1,
          sourceDuration: 1,
        },
        false,
        raw,
      );
      return footPosition(f.group, "left")!;
    };
    const step = 1e-5,
      at = sample(0.5);
    // The requested correction is larger than the allowed displacement.
    expect(at.x).toBeGreaterThan(0.1);
    const incoming = at
      .clone()
      .sub(sample(0.5 - step))
      .divideScalar(step);
    const outgoing = sample(0.5 + step)
      .sub(at)
      .divideScalar(step);
    expect(incoming.distanceTo(outgoing)).toBeLessThan(0.001);
  });

  it("prepares and releases a running contact smoothly without changing its stance anchor", () => {
    const f = rig(),
      scene = starterScene(),
      actor = scene.entities[0];
    actor.scale = 1;
    const rotations = [f.upper, f.lower, f.foot].map((bone) =>
      bone.quaternion.clone(),
    );
    const raw = (time: number) => {
      f.group.position.set(time * 0.12, 0, 0);
      [f.upper, f.lower, f.foot].forEach((bone, i) =>
        bone.quaternion.copy(rotations[i]),
      );
      f.group.updateMatrixWorld(true);
    };
    const profile: LocomotionProfile = {
      duration: 1,
      distance: 1,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [],
      contactLoopSides: ["left"],
      contacts: [
        {
          side: "left",
          start: 0.3,
          end: 0.5,
          approachDuration: 0.2,
          releaseDuration: 0.2,
          samples: [0.3, 0.5].map((time) => ({ time, point: new T.Vector3() })),
        },
      ],
    };
    const sample = (time: number, sourceDuration = 2) => {
      raw(time);
      applyRouteFootPlanting(
        f.group,
        actor,
        scene,
        time,
        {
          profile,
          sample: { time: time % 1 },
          ratio: 1,
          start: 0,
          duration: sourceDuration,
          sourceDuration,
        },
        false,
        raw,
      );
      return footPosition(f.group, "left")!;
    };
    expect(sample(0.1).x).toBeCloseTo(0.012, 7);
    expect(sample(0.2).x).toBeGreaterThan(0.024);
    expect(sample(0.2).x).toBeLessThan(0.048);
    for (const time of [0.3, 0.4, 0.5])
      expect(sample(time).x).toBeCloseTo(0.036, 7);
    expect(sample(0.6).x).toBeGreaterThan(0.036);
    expect(sample(0.6).x).toBeLessThan(0.072);
    for (const time of [0.1, 0.3, 0.5, 0.7, 1.1, 1.3]) {
      const before = sample(time - 1e-6),
        after = sample(time + 1e-6);
      expect(before.distanceTo(after)).toBeLessThan(1e-6);
    }
    for (const time of [0.1, 0.3, 0.5, 0.7, 1.1, 1.3]) {
      const step = 1e-5,
        at = sample(time);
      const incoming = at
        .clone()
        .sub(sample(time - step))
        .divideScalar(step);
      const outgoing = sample(time + step)
        .sub(at)
        .divideScalar(step);
      expect(incoming.distanceTo(outgoing)).toBeLessThan(1e-4);
    }
    const expected = sample(1.21);
    sample(0.8);
    sample(1.9);
    sample(0.1);
    expect(sample(1.21).distanceTo(expected)).toBeLessThan(1e-9);
    // Ending before a contact must not prepare a landing that never occurs.
    expect(sample(0.25, 0.28).x).toBeCloseTo(0.03, 7);
    // A route trimmed during stance retains its preceding landing blend.
    expect(sample(0.2, 0.4).distanceTo(sample(0.2))).toBeLessThan(1e-9);
  });

  it("limits downward ground correction without sliding the foot sideways or locking the knee", () => {
    const f = rig();
    f.upper.rotation.x = 0.35;
    f.foot.rotation.set(0.2, -0.1, 0.3);
    f.group.rotation.y = 0.7;
    f.group.scale.setScalar(1.4);
    f.group.updateMatrixWorld(true);
    const before = footPosition(f.group, "left")!;
    const rotation = f.foot.getWorldQuaternion(new T.Quaternion());
    const lengths = [f.lower.position.length(), f.foot.position.length()];
    const result = correctFootContact(
      f.group,
      "left",
      before.clone().add(new T.Vector3(0, -2, 0)),
      1,
      3,
      before,
      true,
    )!;
    const after = footPosition(f.group, "left")!;
    expect(after.x).toBeCloseTo(before.x, 7);
    expect(after.z).toBeCloseTo(before.z, 7);
    expect(after.y).toBeLessThan(before.y);
    expect(result.reachLimited).toBeGreaterThan(1.9);
    expect(result.error).toBeLessThan(1e-6);
    expect(
      f.foot.getWorldQuaternion(new T.Quaternion()).angleTo(rotation),
    ).toBeLessThan(1e-6);
    expect([f.lower.position.length(), f.foot.position.length()]).toEqual(
      lengths,
    );
    const hip = f.upper.getWorldPosition(new T.Vector3()),
      knee = f.lower.getWorldPosition(new T.Vector3());
    expect(hip.distanceTo(after)).toBeLessThan(
      hip.distanceTo(knee) + knee.distanceTo(after) - 0.001,
    );
  });

  it("allows lateral correction around a straight leg's reachable arc", () => {
    const f = rig();
    f.lower.position.set(0, -0.4, 0.02);
    f.foot.position.set(0, -0.4, 0.02);
    f.group.updateMatrixWorld(true);
    const before = footPosition(f.group, "left")!;
    const target = before.clone().add(new T.Vector3(0.03, 0, 0.005));
    const result = correctFootContact(f.group, "left", target, 1, 0.1)!;
    const after = footPosition(f.group, "left")!;
    expect(after.x - before.x).toBeGreaterThan(0.02);
    expect(Math.abs(after.y - before.y)).toBeLessThan(2e-6);
    expect(after.distanceTo(target)).toBeLessThan(
      before.distanceTo(target) * 0.5,
    );
    expect(result.reachLimited).toBeGreaterThan(0);
    expect(result.error).toBeLessThan(2e-6);
  });
  it("detects sustained low stationary feet without locking a swing or a brief touch", () => {
    const frames = Array.from({ length: 61 }, (_, i) => ({
      time: i / 60,
      feet: [new T.Vector3(0, 0, 0), new T.Vector3(0.2, 0.2, i / 60)],
    }));
    const contacts = detectFootContacts(frames, 1);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].side).toBe("left");
    expect(contacts[0].start).toBe(0);
    expect(contacts[0].end).toBe(1);
    expect(detectFootContacts(frames.slice(0, 4), 1)).toEqual([]);
  });
  it("corrects horizontal drift without changing foot orientation, height or bone lengths", () => {
    const f = rig();
    f.foot.rotation.set(0.3, 0.1, -0.2);
    f.group.rotation.y = 0.6;
    f.group.scale.setScalar(1.4);
    f.group.updateMatrixWorld(true);
    const before = footPosition(f.group, "left")!,
      orientation = f.foot.getWorldQuaternion(new T.Quaternion());
    const lengths = [f.lower.position.length(), f.foot.position.length()];
    const target = before.clone().add(new T.Vector3(0.06, 0, 0.02));
    const result = correctFootContact(f.group, "left", target, 1, 0.2)!;
    expect(result.error).toBeLessThan(1e-6);
    expect(footPosition(f.group, "left")!.distanceTo(target)).toBeLessThan(
      1e-6,
    );
    expect(
      f.foot.getWorldQuaternion(new T.Quaternion()).angleTo(orientation),
    ).toBeLessThan(1e-6);
    expect([f.lower.position.length(), f.foot.position.length()]).toEqual(
      lengths,
    );
  });
  it("releases unreachable horizontal goals without lifting the foot or straightening the knee completely", () => {
    const f = rig();
    f.group.position.set(2, 3, -1);
    f.group.rotation.y = 0.7;
    f.group.scale.setScalar(1.5);
    f.foot.rotation.set(0.2, -0.3, 0.1);
    f.group.updateMatrixWorld(true);
    const before = footPosition(f.group, "left")!;
    const orientation = f.foot.getWorldQuaternion(new T.Quaternion());
    const lengths = [f.lower.position.length(), f.foot.position.length()];
    const result = correctFootContact(
      f.group,
      "left",
      before.clone().add(new T.Vector3(2, 0, 1)),
      1,
      3,
    )!;
    const after = footPosition(f.group, "left")!;
    expect(result.reachLimited).toBeGreaterThan(1);
    expect(result.error).toBeLessThan(1e-6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(after.distanceTo(before)).toBeGreaterThan(0.05);
    expect(
      f.foot.getWorldQuaternion(new T.Quaternion()).angleTo(orientation),
    ).toBeLessThan(1e-6);
    expect([f.lower.position.length(), f.foot.position.length()]).toEqual(
      lengths,
    );
    const hip = f.upper.getWorldPosition(new T.Vector3()),
      knee = f.lower.getWorldPosition(new T.Vector3());
    expect(hip.distanceTo(after)).toBeLessThan(
      hip.distanceTo(knee) + knee.distanceTo(after) - 0.001,
    );
  });
  it("uses deterministic timeline anchors and invalidates them when route timing changes", () => {
    const f = rig(),
      scene = starterScene(),
      actor = scene.entities[0];
    actor.scale = 1;
    const rest = [
      f.upper.quaternion.clone(),
      f.lower.quaternion.clone(),
      f.foot.quaternion.clone(),
    ];
    const raw = (time: number) => {
      f.group.position.set(time * 0.06, 0, 0);
      [f.upper, f.lower, f.foot].forEach((bone, i) =>
        bone.quaternion.copy(rest[i]),
      );
      f.group.updateMatrixWorld(true);
    };
    const profile: LocomotionProfile = {
      distance: 1,
      duration: 1,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [],
      contacts: detectFootContacts(
        Array.from({ length: 61 }, (_, i) => ({
          time: i / 60,
          feet: [new T.Vector3(), new T.Vector3(i, 1, 0)],
        })),
        1,
      ),
    };
    profile.contacts![0].start = 0.2;
    profile.contacts![0].end = 0.6;
    profile.contacts![0].samples = profile
      .contacts![0].samples.filter(
        (frame) => frame.time >= 0.2 && frame.time <= 0.6,
      )
      .map((frame) => ({
        ...frame,
        // A source may have sole geometry when this receiver has only bones.
        // Its surface samples must not replace the receiver's ankle basis.
        sole: frame.point.clone().add(new T.Vector3(frame.time * 0.4, 0, 0)),
      }));
    const sample = (time: number, duration = 1) => {
      raw(time);
      applyRouteFootPlanting(
        f.group,
        actor,
        scene,
        time,
        {
          profile,
          sample: { time: time / duration },
          ratio: 1,
          start: 0,
          duration,
          sourceDuration: 1,
        },
        false,
        raw,
      );
      return footPosition(f.group, "left")!;
    };
    const expected = sample(0.25);
    expect(expected.x).toBeCloseTo(0.012, 6);
    for (const t of [0.8, 0.1, 0.7, 0.25]) sample(t);
    expect(sample(0.25).distanceTo(expected)).toBeLessThan(1e-7);
    expect(sample(0.5, 2).x).toBeCloseTo(0.024, 6);
    expect(sample(0.6 - 1e-6).distanceTo(sample(0.6 + 1e-6))).toBeLessThan(
      1e-6,
    );
    expect(sample(0.95 - 1e-6).distanceTo(sample(0.95 + 1e-6))).toBeLessThan(
      1e-6,
    );
    expect(sample(0.96).x).toBeCloseTo(0.96 * 0.06, 6);
  });

  it.each([false, true])(
    "keeps a stance anchored through repeated seams and reverse seeks (whole cycle=%s)",
    (wholeCycle) => {
      const f = rig(),
        scene = starterScene(),
        actor = scene.entities[0];
      actor.scale = 1;
      const rest = [f.upper, f.lower, f.foot].map((bone) =>
        bone.quaternion.clone(),
      );
      const raw = (time: number) => {
        f.group.position.set(time * 0.02, 0, 0);
        [f.upper, f.lower, f.foot].forEach((bone, i) =>
          bone.quaternion.copy(rest[i]),
        );
        f.group.updateMatrixWorld(true);
      };
      const contacts = (
        wholeCycle
          ? [[0, 1]]
          : [
              [0, 0.2],
              [0.7, 1],
            ]
      ).map(([start, end], i) => ({
        side: "left" as const,
        start,
        end,
        // The late contact is in the next stride's native coordinates. Joining
        // must not treat this source-coordinate reset as motion at the seam.
        samples: [start, end].map((time) => ({
          time,
          point: new T.Vector3(i, 0, 0),
        })),
      }));
      const profile: LocomotionProfile = {
        distance: 1,
        duration: 1,
        startHeading: 0,
        warning: "",
        mode: "travel",
        frames: [],
        contacts,
        contactLoopSides: ["left"],
      };
      const sample = (time: number) => {
        raw(time);
        applyRouteFootPlanting(
          f.group,
          actor,
          scene,
          time,
          {
            profile,
            sample: { time: time % 1 },
            ratio: 1,
            start: 0,
            duration: 2.15,
            sourceDuration: 2.15,
          },
          false,
          raw,
        );
        return footPosition(f.group, "left")!;
      };
      // Route begins midway through the joined stance, with no negative seek.
      expect(sample(0.1).x).toBeCloseTo(0, 6);
      for (const time of [1, 2]) {
        const before = sample(time - 1e-6),
          after = sample(time + 1e-6);
        expect(before.distanceTo(after)).toBeLessThan(1e-6);
        expect(after.x).toBeCloseTo(wholeCycle ? 0 : (time - 0.3) * 0.02, 6);
      }
      const expected = sample(2.149);
      for (const time of [0, 1.6, 0.8, 2.01, 0.25]) sample(time);
      expect(sample(2.149).distanceTo(expected)).toBeLessThan(1e-7);
      // Compare a cold anchor cache as well as previously visited timestamps.
      const freshActor = { ...actor };
      raw(1.01);
      applyRouteFootPlanting(
        f.group,
        freshActor,
        scene,
        1.01,
        {
          profile,
          sample: { time: 0.01 },
          ratio: 1,
          start: 0,
          duration: 2.15,
          sourceDuration: 2.15,
        },
        false,
        raw,
      );
      expect(
        footPosition(f.group, "left")!.distanceTo(sample(1.01)),
      ).toBeLessThan(1e-7);
    },
  );

  it("only joins verified seams and exports the wrapped release boundary", () => {
    const contact = (start: number, end: number) => ({
      side: "left" as const,
      start,
      end,
      samples: [start, end].map((time) => ({ time, point: new T.Vector3() })),
    });
    const contacts = [contact(0, 0.2), contact(0.7, 1)];
    expect(scheduleRouteContacts(contacts, 1)).toHaveLength(2);
    const joined = scheduleRouteContacts(contacts, 1, ["left"]);
    expect(joined).toHaveLength(1);
    expect(joined[0].contact.end).toBeCloseTo(1.2);
    expect(joined[0].releaseEnd).toBeCloseTo(1.55);
    const profile: LocomotionProfile = {
      distance: 1,
      duration: 1,
      startHeading: 0,
      warning: "",
      mode: "travel",
      frames: [0, 1].map((time) => ({
        time,
        distance: time,
        center: new T.Vector3(),
        heading: 0,
      })),
      contacts,
      contactLoopSides: ["left"],
    };
    const boundaries = routeSourceBoundaries(profile, [], 2.15, 4.3);
    expect(boundaries.some((time) => Math.abs(time - 3.1) < 1e-8)).toBe(true);
    expect(boundaries.every((time) => time > 0 && time < 4.3)).toBe(true);
    // Preparing the schedule leaves cached source evidence unchanged.
    expect(contacts.map(({ start, end }) => [start, end])).toEqual([
      [0, 0.2],
      [0.7, 1],
    ]);
  });
});
