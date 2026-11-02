import { describe, expect, it } from "vitest";
import * as T from "three";
import {
  captureHandClearance,
  supportTransferredHands,
} from "../src/handClearance";

const position = (node: T.Object3D) => node.getWorldPosition(new T.Vector3());
type Fixture = ReturnType<typeof fixture>;

/** A receiving body: an open (non-watertight) cylinder skinned to the hips,
 * like a skirt, with hanging arms whose hands sit partly inside it. */
function fixture(radius = 0.22) {
  const group = new T.Group(),
    hips = new T.Bone();
  hips.name = "hips";
  hips.position.y = 1;
  group.add(hips);
  const bones: Record<string, T.Bone> = { hips };
  const add = (name: string, parent: T.Bone, xyz: number[]) => {
    const bone = new T.Bone();
    bone.name = name;
    bone.position.fromArray(xyz);
    parent.add(bone);
    bones[name] = bone;
    return bone;
  };
  const skin = (bone: T.Bone, geometry: T.BufferGeometry) => {
    const count = geometry.attributes.position.count;
    geometry.setAttribute(
      "skinIndex",
      new T.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
    );
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute(
      "skinWeight",
      new T.Float32BufferAttribute(weights, 4),
    );
    const mesh = new T.SkinnedMesh(geometry, new T.MeshBasicMaterial());
    group.add(mesh);
    group.updateMatrixWorld(true);
    mesh.bind(new T.Skeleton([bone]));
    return mesh;
  };
  for (const side of ["left", "right"]) {
    const sign = side === "left" ? 1 : -1;
    add(
      side + "Shin",
      add(side + "Leg", hips, [sign * 0.1, -0.05, 0]),
      [0, -0.45, 0],
    );
  }
  skin(
    hips,
    new T.CylinderGeometry(radius, radius, 0.8, 64, 24, true).translate(
      0,
      1,
      0,
    ),
  );
  const hands: T.SkinnedMesh[] = [];
  for (const side of ["left", "right"]) {
    const sign = side === "left" ? 1 : -1;
    const upper = add(side + "Arm", hips, [sign * 0.2, 0.5, 0]);
    const lower = add(side + "Forearm", upper, [0, -0.3, -0.03]);
    const hand = add(side + "Hand", lower, [0, -0.3, 0.03]);
    const finger = add(side + "Finger", hand, [0, -0.09, 0]);
    finger.rotation.x = 0.15;
    hands.push(
      skin(
        hand,
        new T.BoxGeometry(0.03, 0.16, 0.08, 2, 6, 3).translate(
          sign * 0.2,
          0.82,
          0,
        ),
      ),
    );
  }
  group.userData.bones = bones;
  group.updateMatrixWorld(true);
  captureHandClearance(group);
  const rest = Object.values(bones).map((b) => ({
    b,
    p: b.position.clone(),
    q: b.quaternion.clone(),
  }));
  const reset = () => {
    rest.forEach(({ b, p, q }) => {
      b.position.copy(p);
      b.quaternion.copy(q);
    });
    group.updateMatrixWorld(true);
  };
  return { group, bones, hands, reset };
}
/** Horizontal distance of every hand vertex from the body axis, in hips space. */
function handRadii(f: Fixture, side: number) {
  const mesh = f.hands[side],
    radii: number[] = [];
  for (let v = 0; v < mesh.geometry.attributes.position.count; v++) {
    const p = f.bones.hips.worldToLocal(
      mesh.getVertexPosition(v, new T.Vector3()).applyMatrix4(mesh.matrixWorld),
    );
    radii.push(Math.hypot(p.x, p.z));
  }
  return radii;
}
const pose = (f: Fixture, edit: () => void) => {
  f.reset();
  edit();
  f.group.updateMatrixWorld(true);
  supportTransferredHands(f.group);
  return Object.values(f.bones).map(position);
};

describe("receiving-body hand clearance", () => {
  it.each([0.6, 1, 1.8])(
    "clears hands from the body without changing lengths, wrists, fingers or root at scale %s",
    (scale) => {
      const f = fixture();
      f.group.scale.setScalar(scale);
      f.group.position.set(3, 2, -4);
      f.group.rotation.set(0.2, 1.3, -0.1);
      f.group.updateMatrixWorld(true);
      expect(Math.min(...handRadii(f, 0))).toBeLessThan(0.2);
      const hip = position(f.bones.hips),
        input = f.group.matrixWorld.clone();
      const before = ["left", "right"].map((side) => ({
        q: f.bones[side + "Hand"].getWorldQuaternion(new T.Quaternion()),
        finger: f.bones[side + "Finger"].quaternion.clone(),
        a: position(f.bones[side + "Arm"]).distanceTo(
          position(f.bones[side + "Forearm"]),
        ),
        b: position(f.bones[side + "Forearm"]).distanceTo(
          position(f.bones[side + "Hand"]),
        ),
      }));
      supportTransferredHands(f.group);
      expect(position(f.bones.hips).distanceTo(hip)).toBeLessThan(1e-12);
      expect(f.group.matrixWorld.equals(input)).toBe(true);
      const report = f.group.userData.handClearance;
      expect(report.left).toBeGreaterThan(0.02 * scale);
      expect(report.unresolved).toBeUndefined();
      for (const [i, side] of ["left", "right"].entries()) {
        expect(
          f.bones[side + "Hand"]
            .getWorldQuaternion(new T.Quaternion())
            .angleTo(before[i].q),
        ).toBeLessThan(1e-6);
        expect(
          f.bones[side + "Finger"].quaternion.equals(before[i].finger),
        ).toBe(true);
        const a = position(f.bones[side + "Arm"]).distanceTo(
            position(f.bones[side + "Forearm"]),
          ),
          b = position(f.bones[side + "Forearm"]).distanceTo(
            position(f.bones[side + "Hand"]),
          );
        expect(Math.abs(a - before[i].a)).toBeLessThan(1e-9 * scale);
        expect(Math.abs(b - before[i].b)).toBeLessThan(1e-9 * scale);
        // The body surface is reached within the kernel's smoothing.
        expect(Math.min(...handRadii(f, i))).toBeGreaterThan(0.215);
      }
    },
  );
  it("moves a hand embedded in the front of the body forward, keeping the contact", () => {
    const f = fixture();
    // Left hand reaches in front of the body on its own side, slightly inside.
    const edit = () => {
      f.bones.leftArm.rotation.set(-0.25, 0, -0.15);
      f.bones.leftForearm.rotation.set(-0.1, 0, 0);
    };
    f.reset();
    edit();
    f.group.updateMatrixWorld(true);
    const wrist = f.bones.hips.worldToLocal(position(f.bones.leftHand));
    expect(wrist.x).toBeGreaterThan(0.08);
    expect(Math.hypot(wrist.x, wrist.z)).toBeLessThan(0.21);
    pose(f, edit);
    const moved = f.bones.hips
      .worldToLocal(position(f.bones.leftHand))
      .sub(wrist);
    expect(f.group.userData.handClearance.left).toBeGreaterThan(0.005);
    expect(moved.z).toBeGreaterThan(0);
    expect(moved.z).toBeGreaterThan(Math.abs(moved.x));
    // Resting on, not thrown away from, the surface.
    expect(Math.min(...handRadii(f, 0))).toBeLessThan(0.26);
  });
  it("leaves clear, raised, crossed and behind-the-back hands unchanged", () => {
    const clear = fixture(0.12);
    const before = Object.values(clear.bones).map((b) => b.quaternion.clone());
    supportTransferredHands(clear.group);
    Object.values(clear.bones).forEach((b, i) =>
      expect(b.quaternion.equals(before[i])).toBe(true),
    );
    expect(clear.group.userData.handClearance).toEqual({});
    const f = fixture();
    for (const edit of [
      // raised to the side
      () => (f.bones.leftArm.rotation.z = Math.PI / 2),
      // crossed past the midline in front of the body
      () => f.bones.leftArm.rotation.set(-0.9, 0, -0.9),
      // reaching behind the back
      () => f.bones.leftArm.rotation.set(0.9, 0, -0.3),
      // at chest height
      () => f.bones.leftArm.rotation.set(-1.9, 0, 0.2),
    ]) {
      f.reset();
      edit();
      f.group.updateMatrixWorld(true);
      const q = f.bones.leftArm.quaternion.clone(),
        lower = f.bones.leftForearm.quaternion.clone();
      supportTransferredHands(f.group);
      expect(f.bones.leftArm.quaternion.equals(q)).toBe(true);
      expect(f.bones.leftForearm.quaternion.equals(lower)).toBe(true);
      expect(f.group.userData.handClearance.left).toBeUndefined();
    }
  });
  it("is a pure pose function: evaluation order does not matter", () => {
    const f = fixture();
    const at = (angle: number) =>
      pose(f, () => (f.bones.leftArm.rotation.z = angle));
    const expected = at(0.04);
    at(-0.2);
    at(0.3);
    at(0.04).forEach((p, i) =>
      expect(p.distanceTo(expected[i])).toBeLessThan(1e-12),
    );
  });
  it("changes continuously as a hand swings into and out of the body", () => {
    const f = fixture();
    const at = (angle: number) =>
      pose(f, () => {
        f.bones.leftArm.rotation.z = angle;
        f.bones.leftArm.rotation.x = angle * 0.5;
      });
    let previous = at(-0.15);
    for (let i = 1; i <= 300; i++) {
      // 1 mm of unconstrained hand travel per step.
      const next = at(-0.15 + i * 0.0017);
      next.forEach((p, j) =>
        expect(p.distanceTo(previous[j])).toBeLessThan(0.004),
      );
      previous = next;
    }
  });
  it("does not pop when the hand crosses an open hem", () => {
    const f = fixture();
    const at = (drop: number) => {
      f.reset();
      for (const side of ["left", "right"])
        f.bones[side + "Arm"].position.y -= drop;
      f.group.updateMatrixWorld(true);
      const before = position(f.bones.leftHand);
      supportTransferredHands(f.group);
      return position(f.bones.leftHand).sub(before);
    };
    // The cylinder ends 0.4 below the hips; the hand passes its open edge.
    let previous = at(0);
    for (let i = 1; i <= 300; i++) {
      const next = at(i * 0.001);
      expect(next.distanceTo(previous)).toBeLessThan(0.003);
      previous = next;
    }
    expect(previous.length()).toBeLessThan(1e-9);
  });
  it("uses anatomy rather than imported bone axes or names", () => {
    const a = fixture(),
      b = fixture();
    // Re-express every local bone frame while keeping anatomical points fixed,
    // then rebind the skins as an independent exporter would.
    for (const [i, bone] of Object.values(b.bones).entries()) {
      bone.name = "unfamiliar-joint-" + i;
      const q = new T.Quaternion().setFromEuler(
        new T.Euler(0.2 + i * 0.03, -0.4, 0.6),
      );
      bone.quaternion.multiply(q);
      for (const child of bone.children) {
        child.position.applyQuaternion(q.clone().invert());
        child.quaternion.premultiply(q.clone().invert());
      }
    }
    b.group.updateMatrixWorld(true);
    b.group.traverse((n) => {
      if (n instanceof T.SkinnedMesh) n.bind(new T.Skeleton(n.skeleton.bones));
    });
    captureHandClearance(b.group);
    supportTransferredHands(a.group);
    supportTransferredHands(b.group);
    expect(a.group.userData.handClearance.left).toBeGreaterThan(0.01);
    for (const name of Object.keys(a.bones))
      expect(
        position(a.bones[name]).distanceTo(position(b.bones[name])),
      ).toBeLessThan(1e-9);
  });
  it("bounds gross proportion mismatches and reports them as unresolved", () => {
    const f = fixture(0.45);
    const before = position(f.bones.leftHand);
    supportTransferredHands(f.group);
    const report = f.group.userData.handClearance;
    expect(report.unresolved).toEqual(["left", "right"]);
    // Arm reach is 0.6; the cap is 15% of it.
    expect(position(f.bones.leftHand).distanceTo(before)).toBeLessThan(0.091);
    expect(position(f.bones.leftHand).distanceTo(before)).toBeGreaterThan(0.05);
  });
  it("leaves detached hand joints and rigs without legs alone", () => {
    const detached = fixture();
    detached.group.attach(detached.bones.leftHand);
    detached.group.updateMatrixWorld(true);
    const q = detached.bones.leftArm.quaternion.clone(),
      p = position(detached.bones.leftHand);
    supportTransferredHands(detached.group);
    expect(detached.bones.leftArm.quaternion.equals(q)).toBe(true);
    expect(position(detached.bones.leftHand).distanceTo(p)).toBe(0);
    const legless = fixture();
    delete legless.bones.leftLeg;
    captureHandClearance(legless.group);
    const arm = legless.bones.leftArm.quaternion.clone();
    supportTransferredHands(legless.group);
    expect(legless.bones.leftArm.quaternion.equals(arm)).toBe(true);
  });
});
