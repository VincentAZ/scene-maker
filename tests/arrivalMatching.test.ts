import { expect, it } from "vitest";
import * as T from "three";
import { characters } from "../shared/scene";
import { createCharacter, disposeObject } from "../src/world";
import { configureImportedRig, sampleNativeClip } from "../src/rig";
import {
  matchCapturedArrival,
  matchCapturedArrivalSteps,
} from "../src/arrivalMatching";
import type { LocomotionProfile } from "../src/locomotion";
import { rotationDistance } from "../src/sourceJoins";

it("distinguishes tiny real rotations from identical or sign-equivalent poses", () => {
  const a = new T.Quaternion().setFromEuler(new T.Euler(0.7, -0.3, 0.8));
  expect(rotationDistance(a, a.clone())).toBe(0);
  expect(rotationDistance(a, new T.Quaternion(-a.x, -a.y, -a.z, -a.w))).toBe(0);
  const b = a
    .clone()
    .premultiply(
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), 1e-9),
    );
  expect(rotationDistance(a, b)).toBeCloseTo(1e-9, 14);
});
function fixture(armMismatch = false, extra?: "scale" | "morph" | "rigid") {
  const body = createCharacter(characters[0]),
    group = new T.Group();
  group.add(body);
  const arm = body.userData.bones.leftArm as T.Bone;
  const control = new T.Bone();
  control.name = "Unweighted_Control";
  body.add(control);
  const clip = new T.AnimationClip("Captured movement", 4, [
    new T.VectorKeyframeTrack(
      body.uuid + ".position",
      [0, 3, 4],
      [0, 0, 0, 0, 0, 3, 0, 0, 3],
    ),
    new T.QuaternionKeyframeTrack(
      control.uuid + ".quaternion",
      [0, 1.5, 2, 4],
      [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        1,
        ...new T.Quaternion()
          .setFromAxisAngle(new T.Vector3(1, 0, 0), 2)
          .toArray(),
        0,
        0,
        0,
        1,
      ],
    ),
    ...(armMismatch
      ? [
          new T.QuaternionKeyframeTrack(
            arm.uuid + ".quaternion",
            [0, 1.5, 2, 4],
            [
              0,
              0,
              0,
              1,
              0,
              0,
              0,
              1,
              ...new T.Quaternion()
                .setFromAxisAngle(new T.Vector3(1, 0, 0), 0.9)
                .toArray(),
              0,
              0,
              0,
              1,
            ],
          ),
        ]
      : []),
  ]);
  if (extra === "scale")
    clip.tracks.push(
      new T.VectorKeyframeTrack(
        arm.uuid + ".scale",
        [0, 1.5, 2, 4],
        [1, 1, 1, 1, 1, 1, 1.2, 1.2, 1.2, 1, 1, 1],
      ),
    );
  if (extra === "morph" || extra === "rigid") {
    const geometry = new T.BoxGeometry(0.1, 0.1, 0.1);
    if (extra === "morph") {
      geometry.morphAttributes.position = [
        geometry.attributes.position.clone(),
      ];
      geometry.morphTargetsRelative = true;
    }
    const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
    mesh.position.y = 1.7;
    body.add(mesh);
    clip.tracks.push(
      extra === "morph"
        ? new T.NumberKeyframeTrack(
            mesh.uuid + ".morphTargetInfluences[0]",
            [0, 1.5, 2, 4],
            [0, 0, 1, 0],
          )
        : new T.VectorKeyframeTrack(
            mesh.uuid + ".position",
            [0, 1.5, 2, 4],
            [0, 1.7, 0, 0, 1.7, 0, 0.4, 1.7, 0, 0, 1.7, 0],
          ),
    );
  }
  configureImportedRig(group, body, [clip]);
  const profile: LocomotionProfile = {
    duration: 4,
    distance: 3,
    startHeading: 0,
    mode: "travel",
    warning: "",
    frames: Array.from({ length: 81 }, (_, i) => ({
      time: i / 20,
      distance: Math.min(i / 20, 3),
      center: new T.Vector3(0, 0, Math.min(i / 20, 3)),
      heading: 0,
    })),
    contacts: [
      {
        side: "left",
        start: 0,
        end: 4,
        samples: [
          { time: 0, point: new T.Vector3() },
          { time: 4, point: new T.Vector3() },
        ],
      },
    ],
    stops: [
      {
        settled: 3,
        end: 4,
        sourceEnd: 3.5,
        entries: [{ time: 2, distance: 1, speed: 1, support: 1 }],
      },
    ],
  };
  return { group, body, clip, profile };
}
it("compares source poses in their travel frame, ignores unweighted controls, and restores live transforms", () => {
  const f = fixture();
  try {
    f.group.position.set(2, 0, -3);
    f.group.rotation.y = 0.7;
    f.group.scale.setScalar(1.8);
    sampleNativeClip(f.group, f.clip, 0.3);
    f.group.updateWorldMatrix(true, true);
    const before = new Map<T.Object3D, number[]>();
    f.group.traverse((n) =>
      before.set(n, [
        ...n.position.toArray(),
        ...n.quaternion.toArray(),
        ...n.scale.toArray(),
      ]),
    );
    const result = matchCapturedArrival(f.group, f.clip, f.profile, 2.5);
    expect(result.examined).toBe(1);
    expect(result.match).toBeDefined();
    expect(result.match!.sourceStart).toBe(2);
    expect(result.match!.prefixDistance).toBe(1.5);
    expect(result.match!.positionMax).toBeLessThan(1e-6);
    expect(result.match!.rotationMax).toBeLessThan(1e-6);
    expect(result.match!.angularVelocityRms).toBeLessThan(1e-5);
    f.group.traverse((n) =>
      expect([
        ...n.position.toArray(),
        ...n.quaternion.toArray(),
        ...n.scale.toArray(),
      ]).toEqual(before.get(n)),
    );
    expect(matchCapturedArrival(f.group, f.clip, f.profile, 2.5)).toEqual(
      result,
    );
  } finally {
    disposeObject(f.group);
  }
});
it("rejects a mismatched weighted limb pose and an incoming unsupported phase", () => {
  const f = fixture(true);
  try {
    const result = matchCapturedArrival(f.group, f.clip, f.profile, 2.5);
    expect(result.best).toBeDefined();
    expect(result.match).toBeUndefined();
    expect(result.best!.rotationMax).toBeGreaterThan(0.8);
    f.profile.contacts = [];
    expect(matchCapturedArrival(f.group, f.clip, f.profile, 2.5)).toEqual({
      examined: 0,
      matches: [],
    });
  } finally {
    disposeObject(f.group);
  }
});
it("requires measured stopping evidence and sufficient prefix travel", () => {
  const f = fixture();
  try {
    expect(matchCapturedArrival(f.group, f.clip, f.profile, 0.5)).toEqual({
      examined: 0,
      matches: [],
    });
    f.profile.stops = [];
    expect(matchCapturedArrival(f.group, f.clip, f.profile, 2.5)).toEqual({
      examined: 0,
      matches: [],
    });
  } finally {
    disposeObject(f.group);
  }
});

it("returns every compatible entry in deterministic quality order without admitting failed pose gates", () => {
  const f = fixture(true);
  try {
    f.profile.stops![0].entries = [2.25, 1.75, 2].map((time) => ({
      time,
      distance: 3 - time,
      speed: 1,
      support: 1,
    }));
    // Matching an entry to itself gives identical pose and velocity evidence.
    const result = matchCapturedArrival(
      f.group,
      f.clip,
      f.profile,
      3,
      (start) => start,
    );
    expect(result.matches.map((m) => m.sourceStart)).toEqual([1.75, 2, 2.25]);
    expect(result.match).toBe(result.matches[0]);
    expect(result.matches.every((m) => m.score < 1e-6)).toBe(true);
    const mismatched = matchCapturedArrival(
      f.group,
      f.clip,
      f.profile,
      3,
      () => 1,
    );
    expect(mismatched.matches).toEqual([]);
    expect(mismatched.best).toBeDefined();
    expect(mismatched.match).toBeUndefined();
  } finally {
    disposeObject(f.group);
  }
});

it.each(["scale", "morph", "rigid"] as const)(
  "rejects an incompatible %s channel even when the basic stance matches",
  (extra) => {
    const f = fixture(false, extra);
    try {
      const result = matchCapturedArrival(f.group, f.clip, f.profile, 2.5);
      expect(result.best).toBeDefined();
      expect(result.match).toBeUndefined();
      if (extra === "scale") expect(result.best!.scaleMax).toBeGreaterThan(0.1);
      if (extra === "morph") expect(result.best!.morphMax).toBe(1);
      if (extra === "rigid")
        expect(result.best!.positionMax).toBeGreaterThan(0.3);
    } finally {
      disposeObject(f.group);
    }
  },
);

it("matches the actual planned approach length instead of subtracting captured arc length", () => {
  const f = fixture(true);
  try {
    // The raw arc-length allocation reaches a different limb phase and fails.
    expect(
      matchCapturedArrival(f.group, f.clip, f.profile, 2.5).match,
    ).toBeUndefined();
    const calls: number[][] = [];
    const result = matchCapturedArrival(
      f.group,
      f.clip,
      f.profile,
      2.5,
      (...range) => {
        calls.push(range);
        // An obstacle-aware approach can reach the exact captured entry phase.
        return 2;
      },
    );
    expect(calls).toEqual([[2, 3.5, 1]]);
    expect(result.match?.prefixDistance).toBe(2);
    expect(result.match?.prefixSourceDuration).toBe(2);
    expect(result.match?.positionMax).toBeLessThan(1e-6);
    expect(result.match?.rotationMax).toBeLessThan(1e-6);
  } finally {
    disposeObject(f.group);
  }
});

it.each([undefined, NaN, Infinity, -1])(
  "rejects an unavailable or invalid planned approach (%s)",
  (distance) => {
    const f = fixture();
    try {
      expect(
        matchCapturedArrival(f.group, f.clip, f.profile, 2.5, () => distance),
      ).toEqual({ examined: 0, matches: [] });
    } finally {
      disposeObject(f.group);
    }
  },
);

it("restores the source pose when cooperative candidate matching is cancelled", () => {
  const f = fixture();
  try {
    f.profile.stops![0].entries.push({
      time: 2.1,
      distance: 0.9,
      speed: 1,
      support: 1,
    });
    sampleNativeClip(f.group, f.clip, 0.3);
    const before = new Map<T.Object3D, number[]>();
    f.group.traverse((node) =>
      before.set(node, [
        ...node.position.toArray(),
        ...node.quaternion.toArray(),
        ...node.scale.toArray(),
      ]),
    );
    const work = matchCapturedArrivalSteps(f.group, f.clip, f.profile, 2.5);
    expect(work.next().done).toBe(false);
    expect(work.next().done).toBe(false);
    work.return({ examined: 0, matches: [] });
    f.group.traverse((node) =>
      expect([
        ...node.position.toArray(),
        ...node.quaternion.toArray(),
        ...node.scale.toArray(),
      ]).toEqual(before.get(node)),
    );
  } finally {
    disposeObject(f.group);
  }
});

it("matches a selected source window using absolute timestamps for captured arrivals", () => {
  const f = fixture();
  try {
    const reference = matchCapturedArrival(
      f.group,
      f.clip,
      f.profile,
      2.5,
      () => 2,
    );
    f.clip.tracks.forEach((track) => track.shift(5));
    f.clip.duration = 9;
    f.profile.sourceStart = 5;
    const calls: number[][] = [];
    const result = matchCapturedArrival(
      f.group,
      f.clip,
      f.profile,
      2.5,
      (...range) => {
        calls.push(range);
        return 2;
      },
    );
    expect(calls).toEqual([[7, 8.5, 1]]);
    expect(result.match?.sourceStart).toBe(7);
    expect(result.match?.sourceEnd).toBe(8.5);
    expect(result.match?.prefixSourceDuration).toBe(
      reference.match?.prefixSourceDuration,
    );
    expect(result.match?.positionMax).toBeCloseTo(
      reference.match!.positionMax,
      10,
    );
    expect(result.match?.score).toBeCloseTo(reference.match!.score, 10);
  } finally {
    disposeObject(f.group);
  }
});
