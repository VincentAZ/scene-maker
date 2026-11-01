import * as T from "three";
import { expect, it } from "vitest";
import { starterScene } from "../shared/scene";
import { closeRouteLoopPose } from "../src/routeLoopPose";
import {
  routeSourceBoundaries,
  type LocomotionProfile,
} from "../src/locomotion";

function fixture(
  detached = false,
  amplitude = 0.08,
  scaling: boolean | number = false,
  accelerating = false,
  scaleParents = false,
) {
  const scene = starterScene(),
    entity = scene.entities[0];
  entity.position = [0, 0, 0];
  entity.rotation = 0;
  entity.scale = 1;
  const group = new T.Group(),
    hips = new T.Bone(),
    leg = new T.Bone(),
    shin = new T.Bone(),
    foot = new T.Bone(),
    spine = new T.Bone();
  hips.add(leg, spine);
  leg.add(shin);
  if (detached) group.add(foot, hips);
  else {
    group.add(hips);
    shin.add(foot);
  }
  group.userData.bones = {
    hips,
    spine,
    leftLeg: leg,
    leftShin: shin,
    leftFoot: foot,
  };
  if (detached) group.userData.detachedJointAnchors = new Map([[foot, shin]]);
  const face = new T.Mesh();
  face.morphTargetInfluences = [0];
  hips.add(face);
  const profile: LocomotionProfile = {
    duration: 1,
    distance: 1,
    startHeading: 0,
    mode: "in-place",
    warning: "",
    contactLoopSides: ["left", "right"],
    frames: [
      { time: 0, distance: 0, center: new T.Vector3(), heading: 0 },
      { time: 1, distance: 1, center: new T.Vector3(), heading: 0 },
    ],
  };
  const raw = (time: number) => {
    const phase = accelerating ? (time % 1) ** 2 : time % 1,
      heading = 0.4 * time;
    const root = new T.Vector3(
      entity.position[0],
      entity.position[1],
      entity.position[2] + time,
    );
    group.position.copy(root);
    group.rotation.set(0, heading, 0);
    hips.position.set(0, 1 + phase * 0.01, 0);
    hips.rotation.set(phase * 0.01 + (scaleParents ? 0.2 : 0), 0, 0);
    if (scaleParents) hips.scale.set(1.5 + phase * 4e-6, 1, 0.7);
    spine.position.set(0, 0.2, 0);
    spine.rotation.set(phase * amplitude, 0, 0);
    if (accelerating)
      spine.rotation.set(
        phase * amplitude,
        phase * phase * 0.12,
        Math.sin(phase) * 0.09,
      );
    leg.position.set(0.1, -0.1, 0);
    leg.rotation.set(phase * 0.04 + (scaleParents ? 0.25 : 0), 0, 0);
    if (scaleParents) leg.scale.set(1, 0.8 + phase * 4e-6, 1);
    shin.position.set(0, -0.4, 0);
    shin.rotation.set(-phase * 0.05 - (scaleParents ? 0.4 : 0), 0, 0);
    foot.position.set(0, -0.4, 0.03);
    foot.rotation.set(phase * 0.03 + (scaleParents ? 0.15 : 0), 0, 0);
    foot.scale.set(
      1 + phase * (typeof scaling === "number" ? scaling : scaling ? 0.01 : 0),
      1,
      1,
    );
    group.updateMatrixWorld(true);
    if (detached)
      foot.position.copy(
        group.worldToLocal(shin.localToWorld(new T.Vector3(0, -0.4, 0.03))),
      );
    face.morphTargetInfluences![0] = 0.1 + phase * 0.05;
    group.updateMatrixWorld(true);
    return { root, heading };
  };
  const sample = (time: number, sourceDuration = 2, rate = 1) => {
    const frame = raw(time * rate);
    closeRouteLoopPose(
      group,
      entity,
      scene,
      time,
      {
        profile,
        start: 0,
        duration: sourceDuration / rate,
        sourceDuration,
        sample: { time: (time * rate) % 1 },
        heading: frame.heading,
      },
      frame,
      (t) => raw(t * rate),
    );
    group.updateMatrixWorld(true);
    const inverse = new T.Quaternion().setFromAxisAngle(
      new T.Vector3(0, 1, 0),
      -frame.heading,
    );
    return {
      points: [hips, spine, leg, shin, foot].map((b) =>
        b
          .getWorldPosition(new T.Vector3())
          .sub(frame.root)
          .applyQuaternion(inverse),
      ),
      rotations: [hips, spine, leg, shin, foot].map((b) =>
        inverse
          .clone()
          .multiply(b.getWorldQuaternion(new T.Quaternion()))
          .normalize(),
      ),
      morph: face.morphTargetInfluences![0],
    };
  };
  return {
    group,
    scene,
    entity,
    hips,
    spine,
    leg,
    shin,
    foot,
    face,
    profile,
    raw,
    sample,
  };
}

it.each([false, true])(
  "closes at the actual endpoint rather than the nearby sampling time (detached=%s)",
  (detached) => {
    const f = fixture(detached);
    for (const rate of [0.75, 1, 1.6]) {
      const h = 1e-8,
        center = f.sample(1 / rate, 2, rate),
        before = f.sample((1 - h) / rate, 2, rate),
        after = f.sample((1 + h) / rate, 2, rate);
      center.points.forEach((p, i) => {
        expect(
          p
            .clone()
            .sub(before.points[i])
            .sub(after.points[i].clone().sub(p))
            .length() / h,
        ).toBeLessThan(1e-5);
      });
      expect(
        Math.abs(2 * center.morph - before.morph - after.morph) / h,
      ).toBeLessThan(1e-5);
    }
  },
);

it.each([false, true])(
  "closes a small repeated pose mismatch in the moving route frame (detached=%s)",
  (detached) => {
    const f = fixture(detached),
      before = f.sample(1 - 1e-7),
      after = f.sample(1 + 1e-7);
    before.points.forEach((p, i) =>
      expect(p.distanceTo(after.points[i])).toBeLessThan(2e-6),
    );
    before.rotations.forEach((q, i) =>
      expect(q.angleTo(after.rotations[i])).toBeLessThan(2e-6),
    );
    expect(before.morph).toBeCloseTo(after.morph, 6);
    expect(f.shin.position.length()).toBeCloseTo(0.4, 8);
    const expected = f.sample(0.93);
    f.sample(1.7);
    f.sample(0.1);
    const actual = f.sample(0.93);
    expected.points.forEach((p, i) =>
      expect(p.distanceTo(actual.points[i])).toBeLessThan(1e-9),
    );
    expected.rotations.forEach((q, i) =>
      expect(q.angleTo(actual.rotations[i])).toBeLessThan(1e-7),
    );
  },
);

it("preserves one-shot playback and the earlier part of repeated takes", () => {
  const f = fixture();
  for (const [time, duration] of [
    [0.95, 1],
    [0.6, 2],
  ]) {
    f.raw(time);
    const rotation = f.spine.quaternion.clone(),
      position = f.hips.position.clone(),
      morph = f.face.morphTargetInfluences![0];
    f.sample(time, duration);
    expect(f.spine.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    expect(f.hips.position.distanceTo(position)).toBeLessThan(1e-9);
    expect(f.face.morphTargetInfluences![0]).toBe(morph);
  }
});

it.each([false, true])(
  "matches endpoint derivatives without retaining the source sampling-interval bias (detached=%s)",
  (detached) => {
    const f = fixture(detached, 0.08, false, true);
    const h = 1e-5;
    for (const rate of [0.75, 1, 1.6]) {
      const frames = [-2, -1, 0, 1, 2].map((offset) =>
        f.sample((1 + offset * h) / rate, 2, rate),
      );
      // One-sided quadratic derivatives distinguish a velocity discontinuity
      // from the valid acceleration on either side of the join.
      for (let i = 0; i < frames[0].points.length; i++) {
        const residual = frames[2].points[i]
          .clone()
          .multiplyScalar(6)
          .addScaledVector(frames[1].points[i], -4)
          .add(frames[0].points[i])
          .addScaledVector(frames[3].points[i], -4)
          .add(frames[4].points[i])
          .divideScalar(2 * h);
        expect(residual.length()).toBeLessThan(5e-6);
      }
      expect(
        Math.abs(
          6 * frames[2].morph -
            4 * frames[1].morph +
            frames[0].morph -
            4 * frames[3].morph +
            frames[4].morph,
        ) /
          (2 * h),
      ).toBeLessThan(2e-6);
    }
  },
);

it.each([
  [false, 0.75],
  [false, 1.6],
  [true, 0.75],
  [true, 1.6],
] as const)(
  "matches visible pose velocities through a curved loop seam (detached=%s, rate=%s)",
  (detached, rate) => {
    const f = fixture(detached, 0.08, false, true),
      h = 1e-5,
      step = h / rate;
    const samples = [1 - 2 * h, 1 - h, 1 + h, 1 + 2 * h].map((t) =>
      f.sample(t / rate, 2, rate),
    );
    expect(f.group.userData.motionNotice).toBeUndefined();
    for (let i = 0; i < samples[0].points.length; i++) {
      const before = samples[1].points[i]
        .clone()
        .sub(samples[0].points[i])
        .divideScalar(step);
      const after = samples[3].points[i]
        .clone()
        .sub(samples[2].points[i])
        .divideScalar(step);
      expect(before.distanceTo(after)).toBeLessThan(0.001);
      const rotationDelta = (a: T.Quaternion, b: T.Quaternion) =>
        b.clone().multiply(a.clone().invert());
      const incoming = rotationDelta(
        samples[0].rotations[i],
        samples[1].rotations[i],
      );
      const outgoing = rotationDelta(
        samples[2].rotations[i],
        samples[3].rotations[i],
      );
      expect(incoming.angleTo(outgoing) / step).toBeLessThan(0.002);
    }
    expect(
      Math.abs(
        (samples[1].morph - samples[0].morph) / step -
          (samples[3].morph - samples[2].morph) / step,
      ),
    ).toBeLessThan(0.001);
  },
);

it("does not reject loop closure for exporter-scale rounding noise", () => {
  const f = fixture(false, 0.08, 4e-6);
  const before = f.sample(1 - 1e-7),
    after = f.sample(1 + 1e-7);
  expect(f.group.userData.motionNotice).toBeUndefined();
  before.points.forEach((point, i) =>
    expect(point.distanceTo(after.points[i])).toBeLessThan(2e-6),
  );
  before.rotations.forEach((rotation, i) =>
    expect(rotation.angleTo(after.rotations[i])).toBeLessThan(2e-6),
  );
});

it.each([false, true])(
  "closes material-point position through scaled rotating ancestors (detached=%s)",
  (detached) => {
    const f = fixture(detached, 0.08, 4e-6, true, true);
    for (const rate of [0.75, 1, 1.6]) {
      const h = 1e-7;
      const points = [-2, -1, 0, 1, 2].map((offset) => {
        f.sample((1 + offset * h) / rate, 2, rate);
        return f.foot.localToWorld(new T.Vector3(0.12, -0.03, 0.2));
      });
      const residual = points[2]
        .clone()
        .multiplyScalar(6)
        .addScaledVector(points[1], -4)
        .add(points[0])
        .addScaledVector(points[3], -4)
        .add(points[4])
        .divideScalar(2 * h);
      expect(f.group.userData.motionNotice).toBeUndefined();
      expect(residual.length()).toBeLessThan(1e-5);
    }
  },
);

it.each([false, true])(
  "closes visible material points affected by scale rounding (detached=%s)",
  (detached) => {
    const f = fixture(detached, 0.08, 4e-6, true);
    const materialPoint = (time: number, rate: number) => {
      f.sample(time / rate, 2, rate);
      return f.foot.localToWorld(new T.Vector3(0.12, -0.03, 0.2));
    };
    for (const rate of [0.75, 1, 1.6]) {
      for (const h of [1e-5, 1e-7]) {
        const before = materialPoint(1 - h, rate),
          center = materialPoint(1, rate),
          after = materialPoint(1 + h, rate);
        expect(
          center.clone().sub(before).sub(after.sub(center)).length() / h,
        ).toBeLessThan(0.001);
      }
    }
  },
);

it("discloses large pose or scale changes instead of forcing them into a loop", () => {
  for (const f of [fixture(false, 0.8), fixture(false, 0.08, true)]) {
    f.raw(0.95);
    const rotation = f.spine.quaternion.clone(),
      scale = f.foot.scale.clone();
    f.sample(0.95);
    expect(f.group.userData.motionNotice).toContain(
      "body motion does not join smoothly",
    );
    expect(f.spine.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    expect(f.foot.scale.toArray()).toEqual(scale.toArray());
  }
});

it("rejects a small endpoint pose when tangent correction would exceed the pose bound", () => {
  const f = fixture();
  const raw = (time: number) => {
    const frame = f.raw(time);
    f.spine.rotation.x = Math.max(0, (time % 1) - 0.999) * 80;
    f.group.updateMatrixWorld(true);
    return frame;
  };
  const time = 0.9999,
    frame = raw(time),
    rotation = f.spine.quaternion.clone();
  closeRouteLoopPose(
    f.group,
    f.entity,
    f.scene,
    time,
    {
      profile: f.profile,
      start: 0,
      duration: 2,
      sourceDuration: 2,
      sample: { time },
      heading: frame.heading,
    },
    frame,
    raw,
  );
  expect(f.spine.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  expect(f.group.userData.motionNotice).toContain(
    "body motion does not join smoothly",
  );
});

it("matches transferred clearance velocity as well as its endpoint height", () => {
  const f = fixture();
  const raw = (time: number) => ({
    ...f.raw(time),
    clearance: {
      left: 0.01 + 0.004 * (time % 1) ** 2,
      right: 0.01,
      bindFloor: 0.01,
    },
  });
  const sample = (time: number) => {
    const frame = raw(time);
    const correction = closeRouteLoopPose(
      f.group,
      f.entity,
      f.scene,
      time,
      {
        profile: f.profile,
        start: 0,
        duration: 2,
        sourceDuration: 2,
        sample: { time: time % 1 },
        heading: frame.heading,
      },
      frame,
      raw,
    );
    return (
      frame.clearance.left - frame.clearance.bindFloor + (correction?.left ?? 0)
    );
  };
  const h = 1e-5;
  const incoming = (sample(1 - h) - sample(1 - 2 * h)) / h;
  const outgoing = (sample(1 + 2 * h) - sample(1 + h)) / h;
  expect(Math.abs(incoming - outgoing)).toBeLessThan(1e-5);
});

it("shares a fast cyclic joint's tangent change while keeping its pose correction bounded", () => {
  const f = fixture();
  const raw = (time: number) => {
    const frame = f.raw(time),
      phase = time % 1;
    f.spine.rotation.x = 8 * phase * (1 - phase);
    f.group.updateMatrixWorld(true);
    return frame;
  };
  const sample = (time: number, duration = 2) => {
    const frame = raw(time),
      original = f.spine.getWorldQuaternion(new T.Quaternion());
    closeRouteLoopPose(
      f.group,
      f.entity,
      f.scene,
      time,
      {
        profile: f.profile,
        start: 0,
        duration,
        sourceDuration: duration,
        sample: { time: time % 1 },
        heading: frame.heading,
      },
      frame,
      raw,
    );
    expect(f.group.userData.motionNotice).toBeUndefined();
    expect(
      f.spine.getWorldQuaternion(new T.Quaternion()).angleTo(original),
    ).toBeLessThan(0.35);
    return f.spine.localToWorld(new T.Vector3(0, 0.2, 0));
  };
  for (let i = 0; i < 200; i++) sample(i / 100);
  const h = 1e-5;
  for (const boundary of [0.8, 1, 1.2]) {
    const before = sample(boundary - h),
      center = sample(boundary),
      after = sample(boundary + h);
    expect(
      center.clone().sub(before).sub(after.sub(center)).length() / h,
    ).toBeLessThan(0.001);
  }
  // A partial final cycle returns to the authored end rather than extending
  // the blend beyond the route or changing its source clock.
  sample(1.08, 1.1);
  const end = sample(1.1, 1.1);
  raw(1.1);
  expect(
    end.distanceTo(f.spine.localToWorld(new T.Vector3(0, 0.2, 0))),
  ).toBeLessThan(1e-8);
});

it("does not introduce a rotation-decomposition seam under near-uniform parent scales", () => {
  const f = fixture();
  const raw = (time: number) => {
    const frame = f.raw(time);
    f.leg.scale.set(1 + 4e-6, 1, 1);
    f.group.updateMatrixWorld(true);
    return frame;
  };
  const sample = (time: number) => {
    const frame = raw(time);
    closeRouteLoopPose(
      f.group,
      f.entity,
      f.scene,
      time,
      {
        profile: f.profile,
        start: 0,
        duration: 2,
        sourceDuration: 2,
        sample: { time: time % 1 },
        heading: frame.heading,
      },
      frame,
      raw,
    );
    return f.foot.localToWorld(new T.Vector3(0.12, -0.03, 0.2));
  };
  for (const boundary of [0.8, 1, 1.2]) {
    const h = 1e-7,
      before = sample(boundary - h),
      center = sample(boundary),
      after = sample(boundary + h);
    expect(
      center.clone().sub(before).sub(after.sub(center)).length() / h,
    ).toBeLessThan(1e-4);
  }
});

it("includes the repeated loop correction boundary in export samples", () => {
  const { profile } = fixture();
  expect(routeSourceBoundaries(profile, [], 2, 2)).toEqual([0.8, 1, 1.2, 1.8]);
  expect(routeSourceBoundaries(profile, [], 1, 1)).not.toContain(0.8);
});

it("closes transferred ground-clearance constraints along with the receiving pose", () => {
  const f = fixture();
  const raw = (time: number) => ({
    ...f.raw(time),
    clearance: {
      left: 0.02 + (time % 1) * 0.004,
      right: 0.01 + (time % 1) * 0.007,
      bindFloor: 0.01,
    },
  });
  const sample = (time: number, sourceDuration = 2) => {
    const frame = raw(time);
    const correction = closeRouteLoopPose(
      f.group,
      f.entity,
      f.scene,
      time,
      {
        profile: f.profile,
        start: 0,
        duration: sourceDuration,
        sourceDuration,
        sample: { time: time % 1 },
        heading: frame.heading,
      },
      frame,
      raw,
    );
    return ["left", "right"].map(
      (side) =>
        frame.clearance[side as "left" | "right"] -
        frame.clearance.bindFloor +
        (correction?.[side as "left" | "right"] ?? 0),
    );
  };
  const before = sample(1 - 1e-7),
    after = sample(1 + 1e-7);
  before.forEach((height, i) => expect(height).toBeCloseTo(after[i], 8));
  sample(0.5).forEach((height, i) =>
    expect(height).toBeCloseTo([0.012, 0.0035][i], 10),
  );
  const expected = sample(0.95);
  sample(1.5);
  expect(sample(0.95)).toEqual(expected);
  sample(0.95, 1).forEach((height, i) =>
    expect(height).toBeCloseTo([0.0138, 0.00665][i], 8),
  );
});
