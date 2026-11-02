import { describe, expect, it } from "vitest";
import * as T from "three";
import { captureArmRest, normalizeArmRest } from "../src/restNeutral";

const point = (n: T.Object3D) => n.getWorldPosition(new T.Vector3());
function rotateWorld(bone: T.Object3D, q: T.Quaternion) {
  const world = bone.getWorldQuaternion(new T.Quaternion()).premultiply(q);
  bone.quaternion.copy(
    bone
      .parent!.getWorldQuaternion(new T.Quaternion())
      .invert()
      .multiply(world),
  );
  bone.updateWorldMatrix(true, true);
}
/** Left arm in a T-pose, palm down: +x out from the body, +z forward. Finger
 * bases spread across the palm (index forward, pinky back), thumb forward and
 * angled away. Optional bind variations: forearm roll, finger curl, local axes. */
function arm({ roll = 0, curl = 0, axes = false } = {}) {
  const root = new T.Group(),
    chest = new T.Bone();
  root.add(chest);
  const bone = (parent: T.Object3D, xyz: number[], name: string) => {
    const b = new T.Bone();
    b.name = name;
    b.position.fromArray(xyz);
    parent.add(b);
    return b;
  };
  const upper = bone(chest, [0.2, 1.4, 0], "a"),
    lower = bone(upper, [0.28, 0, 0], "b"),
    hand = bone(lower, [0.25, 0, 0], "c");
  const fingers = [0.03, 0.01, -0.01, -0.03].map((z, i) => {
    let parent = bone(hand, [0.09, 0, z], "f" + i + "0");
    const chain = [parent];
    for (let k = 1; k < 4; k++) {
      parent = bone(parent, [0.03, 0, 0], "f" + i + k);
      chain.push(parent);
    }
    return chain;
  });
  let t = bone(hand, [0.03, -0.01, 0.04], "t0");
  const thumb = [t];
  for (let k = 1; k < 4; k++) {
    t = bone(t, [0.02, 0, 0.02], "t" + k);
    thumb.push(t);
  }
  root.updateMatrixWorld(true);
  if (axes)
    root.traverse((b) => {
      if (!(b instanceof T.Bone) || b === chest) return;
      const q = new T.Quaternion().setFromEuler(new T.Euler(0.4, -0.7, 1.1));
      b.quaternion.multiply(q);
      for (const c of b.children) {
        c.position.applyQuaternion(q.clone().invert());
        c.quaternion.premultiply(q.clone().invert());
      }
    });
  root.updateMatrixWorld(true);
  const x = new T.Vector3(1, 0, 0);
  if (roll) rotateWorld(lower, new T.Quaternion().setFromAxisAngle(x, roll));
  if (curl)
    for (const chain of [...fingers, thumb])
      for (const b of chain.slice(0, -1)) {
        const axis = new T.Vector3()
          .crossVectors(
            point(b.children[0]).sub(point(b)),
            new T.Vector3(0, 1, 0),
          )
          .normalize();
        rotateWorld(b, new T.Quaternion().setFromAxisAngle(axis, curl));
      }
  return { root, upper, lower, hand, fingers, thumb };
}
const down = new T.Vector3(0, -1, 0),
  forward = new T.Vector3(0, 0, 1);
function neutral(a: ReturnType<typeof arm>) {
  const rest = captureArmRest(a.upper, a.lower, point(a.hand));
  const pointDown = (b: T.Bone, end: T.Vector3) =>
    rotateWorld(
      b,
      new T.Quaternion().setFromUnitVectors(
        end.sub(point(b)).normalize(),
        down,
      ),
    );
  pointDown(a.upper, point(a.lower));
  pointDown(a.lower, point(a.hand));
  normalizeArmRest(a.upper, a.lower, a.hand, rest, down, forward);
  const origin = point(a.hand);
  return [...a.fingers.flat(), ...a.thumb].map((b) => point(b).sub(origin));
}

describe("anatomical arm rest", () => {
  it("gives the same visible hand for differently authored binds", () => {
    const reference = neutral(arm());
    for (const variant of [
      { roll: 0.45 },
      { curl: 0.35 },
      { roll: -0.3, curl: 0.25, axes: true },
    ]) {
      const result = neutral(arm(variant));
      result.forEach((p, i) =>
        expect(p.distanceTo(reference[i])).toBeLessThan(1e-6),
      );
    }
  });
  it("turns the palm toward the body side and straightens the fingers", () => {
    const a = arm({ roll: 0.6, curl: 0.4 });
    neutral(a);
    // Index (first chain) is forward of the pinky (last chain).
    expect(point(a.fingers[0][0]).z).toBeGreaterThan(point(a.fingers[3][0]).z);
    for (const chain of a.fingers)
      for (let k = 0; k + 1 < chain.length; k++) {
        const segment = point(chain[k + 1])
          .sub(point(chain[k]))
          .normalize();
        expect(segment.dot(down)).toBeGreaterThan(1 - 1e-9);
      }
  });
  it("leaves hands without a recognisable palm untwisted", () => {
    const a = arm();
    // Only one finger chain: no palm line, no thumb.
    for (const chain of [...a.fingers.slice(1), a.thumb])
      chain[0].parent!.remove(chain[0]);
    a.root.updateMatrixWorld(true);
    const rest = captureArmRest(a.upper, a.lower, point(a.hand));
    // Point down as the importer does, then compare only the forearm's twist.
    rotateWorld(
      a.upper,
      new T.Quaternion().setFromUnitVectors(
        point(a.lower).sub(point(a.upper)).normalize(),
        down,
      ),
    );
    const pointed = a.lower.getWorldQuaternion(new T.Quaternion());
    normalizeArmRest(a.upper, a.lower, a.hand, rest, down, forward);
    expect(
      a.lower.getWorldQuaternion(new T.Quaternion()).angleTo(pointed),
    ).toBeLessThan(1e-9);
  });
});
